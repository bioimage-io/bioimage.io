/**
 * Resolves the fine-tuning service (`bioimage-io/model-finetune`), pinning one
 * worker replica for the duration of the browser tab, and lets the user point
 * the whole fine-tuning UI at a different service id.
 *
 * Renamed from `microSamTrainingPin.ts`: model-finetune serves both micro-sam
 * and Cellpose fine-tuning, so nothing about this module is micro-sam specific
 * any more.
 *
 * Why a pin at all
 * ----------------
 * Inference (`infer`, `compute_embedding`, `get_onnx_model`) is stateless
 * across replicas, so `microSamService.ts`'s `resolveMicroSamService`
 * deliberately re-resolves via `select:min:get_load` on every call to spread
 * load across every worker (KTH + de.NBI) that registers `model-finetune`.
 *
 * Fine-tuning is the opposite: a session's store
 * (`~/.bioengine/micro_sam_sessions/<session_id>/status.json` + checkpoint)
 * lives on the *replica's* local disk, and `list_training_sessions` only
 * returns sessions on the worker it happens to land on. With load-balanced
 * resolution, `start_training` might land on worker A while the very next
 * `get_training_status` call lands on worker B and reports "no such session"
 * (`training.get_status` returns `{status: "UNKNOWN"}` for an unknown id, it
 * does not raise). So every fine-tuning call for a given training session must
 * be pinned to the same replica, and so must `resume_session_id`, which
 * resolves against that worker's disk too.
 *
 * Session-level scope (`sessionStorage`) for the pin is intentional: training
 * and its status polling stay on the same replica across page navigations
 * within a tab, each tab gets independent load-balancing, and the pin clears
 * when the tab closes.
 *
 * The override, by contrast, lives in `localStorage`: it is a deliberate
 * choice ("train on my own deployment of the app"), and having to re-enter it
 * in every tab would be a papercut. It is always visible in the UI with a
 * reset next to it, so it cannot silently outlive its usefulness.
 */
import { MICRO_SAM_SERVICE_ID } from './microSamService';

/** The service every fine-tuning call targets unless overridden. */
export const DEFAULT_TRAINING_SERVICE_ID = MICRO_SAM_SERVICE_ID;

// Kept at the historical name so an existing tab's pin survives the rename.
const PIN_KEY = 'bioimage_pinned_microsam_training_service_id';
// The base id the pin was resolved from, so changing the override discards a
// pin that belongs to the previous service rather than reusing it blindly.
const PIN_BASE_KEY = 'bioimage_pinned_training_service_base';
const OVERRIDE_KEY = 'bioimage_training_service_override';

type Listener = () => void;
const listeners = new Set<Listener>();

/** Subscribe to override changes so every mounted picker re-reads at once. */
export function subscribeTrainingServiceOverride(listener: Listener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** The user's custom service id, or `null` when the default is in use. */
export function getTrainingServiceOverride(): string | null {
  try {
    const value = window.localStorage.getItem(OVERRIDE_KEY);
    return value && value.trim() ? value.trim() : null;
  } catch {
    return null;
  }
}

/**
 * Point the fine-tuning UI at another service id. Pass `null` (or an empty
 * string) to go back to the default.
 *
 * Always drops the replica pin: the old pin names a client of the *previous*
 * service, so reusing it would silently keep training where it was.
 */
export function setTrainingServiceOverride(id: string | null): void {
  const next = id && id.trim() ? id.trim() : null;
  try {
    if (next) window.localStorage.setItem(OVERRIDE_KEY, next);
    else window.localStorage.removeItem(OVERRIDE_KEY);
  } catch {
    // localStorage unavailable (private mode, embedded contexts). The
    // override then only applies to calls made before the next reload.
  }
  clearTrainingServicePin();
  listeners.forEach((listener) => listener());
}

/** The id `resolvePinnedTrainingService` will resolve, override included. */
export function getEffectiveTrainingServiceId(): string {
  return getTrainingServiceOverride() ?? DEFAULT_TRAINING_SERVICE_ID;
}

/** The replica currently pinned, for display. `null` before the first call. */
export function getPinnedTrainingServiceId(): string | null {
  try {
    if (window.sessionStorage.getItem(PIN_BASE_KEY) !== getEffectiveTrainingServiceId()) {
      return null;
    }
    return window.sessionStorage.getItem(PIN_KEY);
  } catch {
    return null;
  }
}

function setPin(id: string, base: string): void {
  try {
    window.sessionStorage.setItem(PIN_KEY, id);
    window.sessionStorage.setItem(PIN_BASE_KEY, base);
  } catch {
    // sessionStorage unavailable. The in-flight call still works, but the pin
    // won't survive across page navigations.
  }
}

/** Forget the pinned replica so the next call re-resolves. */
export function clearTrainingServicePin(): void {
  try {
    window.sessionStorage.removeItem(PIN_KEY);
    window.sessionStorage.removeItem(PIN_BASE_KEY);
  } catch {
    // ignore
  }
}

/**
 * Resolve a fine-tuning service handle, pinning the worker replica for the
 * rest of this tab's session. Hypha service handles can expire mid-session, so
 * callers should call this *per RPC* rather than caching the returned handle.
 *
 * A fully qualified override (`<workspace>/<client>:model-finetune`) resolves
 * to exactly that replica, so the pin is a no-op for it. An unqualified one
 * still gets pinned, which is what makes session affinity hold either way.
 *
 * @param server  An already-connected hypha-rpc server proxy.
 * @returns       The remote service proxy from ``server.getService``.
 * @throws        Re-throws the underlying ``getService`` error when no
 *                replica can be found.
 */
export async function resolvePinnedTrainingService(server: any): Promise<any> {
  if (!server || typeof server.getService !== 'function') {
    throw new Error('resolvePinnedTrainingService: invalid server proxy');
  }
  const base = getEffectiveTrainingServiceId();
  const pinned = getPinnedTrainingServiceId();
  if (pinned) {
    try {
      return await server.getService(pinned);
    } catch (err) {
      console.warn(
        '[resolvePinnedTrainingService] Pinned id no longer reachable, re-resolving:',
        (err as Error)?.message || err,
      );
      clearTrainingServicePin();
    }
  }
  // `mode` only means anything for an unqualified name, where more than one
  // replica can answer. A fully qualified id (`workspace/client:service`)
  // already names one client, so it is resolved as given.
  const svc = base.includes(':')
    ? await server.getService(base)
    : await server.getService(base, { mode: 'random' });
  const id = (svc && (svc as any).id) as string | undefined;
  if (id) {
    setPin(id, base);
    console.log('[resolvePinnedTrainingService] Pinned fine-tuning replica:', id);
  }
  return svc;
}
