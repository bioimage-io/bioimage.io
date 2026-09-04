/**
 * Live "which base models can this trainer actually fine-tune?" verdict, from
 * `get_training_capabilities()` on `bioimage-io/model-finetune` (0.14.0+).
 *
 * Why this exists
 * ---------------
 * The base-model pickers used to filter against a `trainableOnT4` boolean
 * hardcoded in `microSamService.ts`. That boolean was measured once against
 * de.NBI's Tesla T4 and then went stale by construction: upgrade the training
 * GPU, or bring a second site with a bigger card online, and the picker keeps
 * hiding models that would now train fine, with nothing to alert anyone. The
 * backend now answers the question itself, so ask it.
 *
 * Which GPU is being described
 * ----------------------------
 * Deliberately resolved through `resolvePinnedMicroSamTrainingService`, NOT
 * the load-balanced `resolveMicroSamService`. A fine-tuning session's state
 * (checkpoints, status.json) lives on one replica's local disk, so every
 * training call is already pinned to a single worker for the tab's lifetime.
 * Routing capabilities through that same pin makes "the GPU that answered" and
 * "the GPU that will run start_training" the same card by construction, rather
 * than by luck. Without the pin, a second site with different hardware would
 * silently make the picker advertise one worker's VRAM while training ran on
 * another's.
 *
 * `trainable` is a hardware verdict, not a right-now verdict
 * ---------------------------------------------------------
 * The backend compares each model's minimum against the card's TOTAL memory,
 * not its free memory, and that is intentional: a picker should answer "can
 * this card ever train this model", not "is the card busy this second". A
 * model can therefore read `trainable: true` and still OOM if another job holds
 * the GPU. That surfaces as a clear `start_training` error, which is a better
 * experience than a button that flickers with someone else's load. Never gate
 * the UI on `free_mb`.
 */
import { resolvePinnedMicroSamTrainingService } from './microSamTrainingPin';

/** Per-backend GPU report. `available: false` means that runtime is down. */
export interface TrainingGpuInfo {
  available: boolean;
  total_mb?: number;
  free_mb?: number;
  device_name?: string;
}

/**
 * One model's verdict. `trainable` is `null` (not `false`) when the backend's
 * runtime is unavailable, so "too big for this card" and "we cannot tell right
 * now" stay distinguishable; the UI disables both, but only the former can
 * quote a memory shortfall.
 */
export interface TrainingModelCapability {
  model_type: string;
  /** 'microsam' | 'cellpose' today; treat as an open string set. */
  backend: string;
  min_gpu_memory_mb?: number;
  trainable: boolean | null;
  /** Human-readable, e.g. 'fits' or 'needs ~24000 MB, GPU has 14912 MB'. */
  reason?: string;
}

export interface TrainingCapabilities {
  gpus: Record<string, TrainingGpuInfo>;
  models: TrainingModelCapability[];
}

/**
 * Cached across the tab: capabilities describe hardware, which does not change
 * between two clicks, and the pinned replica does not change either. Stored as
 * the in-flight promise so concurrent mounts share one round-trip. Only the
 * plain response is cached, never a service proxy (those expire).
 */
let capabilitiesPromise: Promise<TrainingCapabilities> | null = null;

/** Drop the cache so the next read re-asks. Call after a Hypha reconnect. */
export function resetTrainingCapabilitiesCache(): void {
  capabilitiesPromise = null;
}

/**
 * Fetch the trainer's capabilities, once per tab.
 *
 * @param server A connected hypha-rpc server proxy.
 * @throws Whatever the RPC threw. Callers decide the fallback; see
 *         `useTrainingCapabilities` for the one the pickers use.
 */
export async function fetchTrainingCapabilities(server: any): Promise<TrainingCapabilities> {
  if (!capabilitiesPromise) {
    capabilitiesPromise = (async () => {
      const svc = await resolvePinnedMicroSamTrainingService(server);
      const caps = await svc.get_training_capabilities();
      if (!caps || !Array.isArray(caps.models)) {
        throw new Error('get_training_capabilities returned an unexpected shape');
      }
      return caps as TrainingCapabilities;
    })().catch((err) => {
      // Don't cache a failure: a trainer that was down when the page loaded
      // should become usable again without a reload.
      capabilitiesPromise = null;
      throw err;
    });
  }
  return capabilitiesPromise;
}

/**
 * Look one model up. Returns `undefined` for a model the backend doesn't know,
 * which callers must treat as "no verdict", not as "not trainable" (see
 * `isModelTrainable`).
 */
export function findModelCapability(
  caps: TrainingCapabilities | null,
  modelType: string,
): TrainingModelCapability | undefined {
  return caps?.models.find((m) => m.model_type === modelType);
}

/**
 * Should the picker offer this model?
 *
 * Fails OPEN: with no capabilities (call failed, still loading, or the backend
 * doesn't list this model) every model stays clickable. This is a deliberate
 * choice over failing closed. A greyed-out picker is a dead end the user cannot
 * argue with, whereas an over-permissive one costs at most one rejected click:
 * `start_training` hard-rejects an unfit model with a message naming the
 * shortfall and the models that do fit, so a bypass always fails safe.
 */
export function isModelTrainable(
  caps: TrainingCapabilities | null,
  modelType: string,
): boolean {
  const entry = findModelCapability(caps, modelType);
  if (!entry) return true;
  return entry.trainable !== false && entry.trainable !== null;
}

/**
 * Short sentence naming the card the verdicts came from, for the line under a
 * picker that has greyed-out entries. Returns null when the backend reported no
 * usable GPU for that backend, in which case there is no number worth showing.
 */
export function describeTrainingGpu(
  caps: TrainingCapabilities | null,
  backend: string,
): string | null {
  const gpu = caps?.gpus?.[backend];
  if (!gpu || !gpu.available) return null;
  const name = gpu.device_name || 'the training GPU';
  return gpu.total_mb ? `${name} (${gpu.total_mb} MB)` : name;
}
