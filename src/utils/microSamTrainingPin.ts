/**
 * Resolves the ``bioimage-io/bioimageio-finetune`` service (renamed from
 * ``micro-sam`` in round-29 Phase B, colab-rework-plan.md §29), pinning a
 * specific worker replica for the duration of the browser tab, for
 * fine-tuning calls (and export_model/get_export_status/push_export, which
 * share the training service's per-replica in-memory state) only.
 *
 * Why this differs from `microSamService.ts`'s `resolveMicroSamService`
 * -----------------------------------------------------------------------
 * Inference (`infer`, `compute_embedding`, `get_onnx_model`) is stateless
 * across replicas, so `resolveMicroSamService` deliberately re-resolves via
 * `select:min:get_load` on every call to spread load across every worker
 * (KTH + de.NBI) that registers `bioimageio-finetune`.
 *
 * Fine-tuning is the opposite: `training.py`'s session store
 * (`~/.bioengine/micro_sam_sessions/<session_id>/status.json` +
 * checkpoint) lives on the *replica's* local disk, and `list_training_sessions`
 * only returns sessions on the worker it happens to land on. With
 * load-balanced resolution, `start_training` might land on worker A while the
 * very next `get_training_status` call lands on worker B and reports
 * "no such session" (`training.get_status` returns `{status: "UNKNOWN"}` for
 * an unknown id, it does not raise). So every fine-tuning call for a given
 * training session must be pinned to the same replica, mirroring
 * `cellposeServicePin.ts`'s rationale for `cellpose-finetuning`.
 *
 * Session-level scope (`sessionStorage`) is intentional: training and its
 * status polling stay on the same replica across page navigations within a
 * tab, each tab gets independent load-balancing, and the pin clears when the
 * tab closes.
 */
import { MICRO_SAM_SERVICE_ID } from './microSamService';

const STORAGE_KEY = 'bioimage_pinned_microsam_training_service_id';

/** Pure read helper, exported for diagnostics / tests. */
export function getPinnedMicroSamTrainingServiceId(): string | null {
  try {
    return window.sessionStorage.getItem(STORAGE_KEY);
  } catch {
    return null;
  }
}

function setPinnedMicroSamTrainingServiceId(id: string): void {
  try {
    window.sessionStorage.setItem(STORAGE_KEY, id);
  } catch {
    // sessionStorage unavailable (private mode, embedded contexts).
    // We continue without persistence; the in-flight call still works,
    // but pinning won't survive across page navigations.
  }
}

function clearPinnedMicroSamTrainingServiceId(): void {
  try {
    window.sessionStorage.removeItem(STORAGE_KEY);
  } catch {
    // ignore
  }
}

/**
 * Resolve a BioImageIO Fine-tune service handle for fine-tuning calls,
 * pinning the worker replica for the rest of this tab's session. Hypha
 * service handles can expire mid-session, so callers should call this
 * *per RPC* rather than caching the returned handle.
 *
 * @param server  An already-connected hypha-rpc server proxy.
 * @returns       The remote service proxy from ``server.getService``.
 * @throws        Re-throws the underlying ``getService`` error when no
 *                replica can be found.
 */
export async function resolvePinnedMicroSamTrainingService(server: any): Promise<any> {
  if (!server || typeof server.getService !== 'function') {
    throw new Error('resolvePinnedMicroSamTrainingService: invalid server proxy');
  }
  const pinned = getPinnedMicroSamTrainingServiceId();
  if (pinned) {
    try {
      return await server.getService(pinned);
    } catch (err) {
      console.warn(
        '[resolvePinnedMicroSamTrainingService] Pinned id no longer reachable, re-resolving:',
        (err as Error)?.message || err,
      );
      clearPinnedMicroSamTrainingServiceId();
    }
  }
  const svc = await server.getService(MICRO_SAM_SERVICE_ID, { mode: 'random' });
  const id = (svc && (svc as any).id) as string | undefined;
  if (id) {
    setPinnedMicroSamTrainingServiceId(id);
    console.log('[resolvePinnedMicroSamTrainingService] Pinned bioimageio-finetune replica:', id);
  }
  return svc;
}
