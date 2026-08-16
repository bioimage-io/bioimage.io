// Service-ID and helpers for the cellpose4-runner Hypha service that backs
// AI segmentation with Cellpose-SAM (bioimage.io model 'idealistic-eagle').
//
// Like micro-sam (see utils/microSamService.ts) and unlike cellpose-finetuning
// (see utils/cellposeServicePin.ts), cellpose4-runner keeps no per-session
// state on a replica's local disk — the resident-pipeline cache it maintains
// (model_id + postprocessing overrides) is a pure performance optimization,
// not a correctness dependency. So there is nothing to pin: every call
// re-resolves a fresh handle and load-balances across whichever workers
// currently host the app.
//
// Unlike cellpose-finetuning's synchronous `infer(...)`, cellpose4-runner
// uses an async submit+poll contract: `infer(...)` returns a `request_id`
// immediately, and `get_infer_status(request_id)` is polled until its
// `result` field is populated (or holds `{error}` on failure).

// Workspace-scoped cellpose4-runner service name. Deliberately NOT
// client-qualified so it load-balances across every `bioimage-io` worker
// that registers `cellpose4-runner`.
export const CELLPOSE4_RUNNER_SERVICE_ID = 'bioimage-io/cellpose4-runner';

// The only model id cellpose4-runner currently accepts (Cellpose-SAM,
// 3-channel input, label output). There is no model picker in the UI: every
// call always targets this published model.
export const CELLPOSE4_RUNNER_MODEL_ID = 'idealistic-eagle';

const POLL_INTERVAL_MS = 2000;
// 180 polls * 2s = 6 minutes, matching the existing model-runner poll budget
// in src/utils/modelRun.js.
const MAX_POLLS = 180;

/**
 * Resolve a fresh handle to the cellpose4-runner service. Cheap (one
 * websocket round-trip) so callers re-resolve unconditionally instead of
 * caching, which sidesteps the `Method expired or not found` failure a
 * stale handle would raise.
 *
 * @param server A connected hypha-rpc server object.
 * @returns The cellpose4-runner service proxy.
 * @throws If the service cannot be reached.
 */
export async function resolveCellpose4RunnerService(server: any): Promise<any> {
  try {
    return await server.getService(CELLPOSE4_RUNNER_SERVICE_ID, {
      mode: 'select:min:get_load',
    });
  } catch (err) {
    throw new Error(
      `cellpose4-runner service is not available (${(err as Error)?.message || err})`,
    );
  }
}

function abortError(): Error {
  const err = new Error('cellpose4-runner inference cancelled.');
  err.name = 'AbortError';
  return err;
}

// Interruptible sleep — resolves early (without waiting out the full
// interval) the moment `signal` aborts, so a mid-poll cancel takes effect
// in milliseconds rather than up to POLL_INTERVAL_MS later.
function delay(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    const timer = setTimeout(resolve, ms);
    signal?.addEventListener('abort', () => {
      clearTimeout(timer);
      resolve();
    }, { once: true });
  });
}

/**
 * Poll `get_infer_status(request_id)` until the job's `result` is populated,
 * then return it. Throws if the job fails (`result.error`) or the poll
 * budget is exhausted.
 *
 * @param service The cellpose4-runner service proxy (from resolveCellpose4RunnerService).
 * @param requestId The `request_id` string returned by `infer(...)`.
 * @param signal When aborted, best-effort cancels the request server-side
 *   (`cancel_request` only actually cancels jobs still queued — a running or
 *   finished job is a harmless no-op) and throws an `AbortError` immediately
 *   instead of returning a late result.
 * @returns The job's `result` dict (member key `"labels"` or `"flows"`).
 */
export async function pollCellpose4Infer(service: any, requestId: string, signal?: AbortSignal): Promise<any> {
  for (let i = 0; i < MAX_POLLS; i++) {
    if (signal?.aborted) break;
    const status = await service.get_infer_status({ request_id: requestId, _rkwargs: true });
    if (signal?.aborted) break;
    if (status?.result != null) {
      if ('error' in status.result) {
        throw new Error(status.result.error);
      }
      return status.result;
    }
    await delay(POLL_INTERVAL_MS, signal);
  }
  if (signal?.aborted) {
    service.cancel_request({ request_id: requestId, _rkwargs: true }).catch(() => {});
    throw abortError();
  }
  throw new Error('cellpose4-runner inference timed out after 6 minutes.');
}
