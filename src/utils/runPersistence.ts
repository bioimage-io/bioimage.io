// Persist an in-flight model-runner run id (test_run_id / infer request_id) so a
// long-running test or inference survives a page refresh and can be resumed. The
// id is cached per-model with a 3h TTL — long enough to outlive a slow conda
// env build + queue wait, short enough that a stale id is dropped rather than
// resurfacing days later. Mirrors the 3h token expiry in LoginButton and the
// per-model key namespacing used elsewhere (e.g. ColabPage).

export type RunKind = 'test' | 'infer';

const TTL_MS = 3 * 60 * 60 * 1000; // 3 hours

const keyFor = (kind: RunKind, modelId: string): string =>
  `bioimageio:runid:${kind}:${modelId}`;

interface StoredRun {
  runId: string;
  expiry: number; // Date.now() ms when this entry becomes stale
}

/** Persist a run id for a model, valid for 3 hours. */
export const saveRunId = (kind: RunKind, modelId: string, runId: string): void => {
  if (!modelId || !runId) return;
  try {
    const entry: StoredRun = { runId, expiry: Date.now() + TTL_MS };
    localStorage.setItem(keyFor(kind, modelId), JSON.stringify(entry));
  } catch {
    // localStorage may be unavailable (private mode / quota) — persistence is a
    // best-effort convenience, never required for a run to work.
  }
};

/** Return a non-expired run id for a model, or null. Expired entries are removed. */
export const loadRunId = (kind: RunKind, modelId: string): string | null => {
  if (!modelId) return null;
  try {
    const raw = localStorage.getItem(keyFor(kind, modelId));
    if (!raw) return null;
    const entry = JSON.parse(raw) as StoredRun;
    if (!entry?.runId || typeof entry.expiry !== 'number' || entry.expiry <= Date.now()) {
      localStorage.removeItem(keyFor(kind, modelId));
      return null;
    }
    return entry.runId;
  } catch {
    return null;
  }
};

/** Drop the persisted run id for a model (call on completion / failure). */
export const clearRunId = (kind: RunKind, modelId: string): void => {
  if (!modelId) return;
  try {
    localStorage.removeItem(keyFor(kind, modelId));
  } catch {
    // ignore
  }
};
