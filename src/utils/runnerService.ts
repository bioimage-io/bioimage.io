// Shared client helpers for the BioEngine inference runners that use the
// async submit+poll contract: `infer(...)` returns a `request_id` immediately
// and `get_infer_status(request_id)` is polled until its `result` field is
// populated (or holds `{error}` on failure).
//
// Both runners the website talks to expose that contract identically:
//   * `bioimage-io/model-runner`     — every zoo model except Cellpose-3,
//                                      including the Cellpose-SAM / micro-SAM
//                                      foundation models.
//   * `bioimage-io/cellpose3-runner` — the Cellpose-3 models, whose
//                                      architecture needs a Cellpose 3.x
//                                      runtime.
//
// Like micro-sam (see utils/microSamService.ts) and unlike cellpose-finetuning
// (see utils/cellposeServicePin.ts), neither runner keeps per-session state on
// a replica's local disk — the resident-pipeline cache they maintain (model_id
// + pre/postprocessing overrides) is a pure performance optimization, not a
// correctness dependency. So there is nothing to pin: every call re-resolves a
// fresh handle and load-balances across whichever workers currently host the
// app.

const POLL_INTERVAL_MS = 2000;
// 180 polls * 2s = 6 minutes, matching the existing model-runner poll budget
// in src/utils/modelRun.js.
const MAX_POLLS = 180;

/**
 * Resolve a fresh handle to an inference runner service. Cheap (one websocket
 * round-trip) so callers re-resolve unconditionally instead of caching, which
 * sidesteps the `Method expired or not found` failure a stale handle would
 * raise.
 *
 * @param server A connected hypha-rpc server object.
 * @param serviceId The runner's service id (see utils/bioengineService.ts).
 * @returns The runner service proxy.
 * @throws If the service cannot be reached.
 */
export async function resolveRunnerService(server: any, serviceId: string): Promise<any> {
  try {
    return await server.getService(serviceId, {
      mode: 'select:min:get_load',
    });
  } catch (err) {
    throw new Error(
      `${serviceId} service is not available (${(err as Error)?.message || err})`,
    );
  }
}

function abortError(serviceId: string): Error {
  const err = new Error(`${serviceId} inference cancelled.`);
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
 * @param service The runner service proxy (from resolveRunnerService).
 * @param requestId The `request_id` string returned by `infer(...)`.
 * @param signal When aborted, best-effort cancels the request server-side
 *   (`cancel_request` only actually cancels jobs still queued — a running or
 *   finished job is a harmless no-op) and throws an `AbortError` immediately
 *   instead of returning a late result.
 * @param label Service name used in error messages, for a caller-recognisable
 *   failure rather than a generic one.
 * @returns The job's `result` dict, keyed by the model's output member ids.
 */
export async function pollRunnerInfer(
  service: any,
  requestId: string,
  signal?: AbortSignal,
  label = 'Runner',
): Promise<any> {
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
    throw abortError(label);
  }
  throw new Error(`${label} inference timed out after 6 minutes.`);
}

/**
 * Pull the single output array out of a runner `result` dict.
 *
 * The runners key their result by the model's declared output member ids, so
 * a single-output model yields e.g. `{labels: ndarray}`. Callers that dropped
 * a postprocessing op still get the member under its declared id (the raw
 * tensor, not a renamed one), so read the sole member rather than guessing a
 * name.
 *
 * @param result The `result` dict from pollRunnerInfer.
 * @param preferredKey Tried first when present, for models whose output id is
 *   known up front.
 * @returns The output value, or undefined when the dict holds no members.
 */
export function singleOutput(result: any, preferredKey?: string): any {
  if (!result || typeof result !== 'object') return undefined;
  if (preferredKey && result[preferredKey] != null) return result[preferredKey];
  const values = Object.values(result);
  return values.length === 1 ? values[0] : undefined;
}
