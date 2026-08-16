// Typed client for the `annotation-broker` BioEngine app: the standing
// authority for dataset roles, permissions, label creation, and presigned
// URL handout for shared annotation datasets (see colab-rework-plan.md §4).
//
// Service resolution follows the pattern in `src/utils/microSamService.ts`
// (unqualified `bioimage-io/annotation-broker` name, `select:min:get_load`
// so calls load-balance across every worker that deploys the app), but
// unlike μSAM the resolved handle is cached as a single shared promise —
// the broker is a stateful singleton (min_replicas 1), so there is no
// load-balancing benefit to re-resolving on every call. The cache is
// cleared on resolution failure so a later call can retry.
//
// Stale-connection recovery (colab-rework-plan.md §14b): a resolved handle
// can go stale mid-session (websocket drop, token expiry) without the
// resolution itself ever failing, so every exported call routes through
// `callBroker`, which detects connection-shaped errors, drops the cache,
// reconnects the shared Hypha store, and retries once before giving up.

import { useHyphaStore } from '../../store/hyphaStore';

export const ANNOTATION_BROKER_SERVICE_ID = 'bioimage-io/annotation-broker';

export type BrokerRole = 'owner' | 'manager' | 'annotator' | 'public' | 'none';

export interface BrokerUserRef {
  id?: string;
  email?: string;
}

export interface DatasetLabel {
  name: string;
  description: string;
}

export interface AccessRequest {
  id: string;
  email: string;
  requested_role: string;
  requested_at: string;
}

export interface DatasetMetadata {
  artifact_id: string;
  owner: BrokerUserRef;
  managers: BrokerUserRef[];
  annotators: BrokerUserRef[];
  public: boolean;
  labels: DatasetLabel[];
  access_requests: AccessRequest[];
  created_at: string;
  updated_at: string;
}

export interface DatasetWithRole extends DatasetMetadata {
  role: BrokerRole;
}

export interface SharedDatasetSummary {
  artifact_id: string;
  name: string;
  description: string;
  role: BrokerRole;
  labels: DatasetLabel[];
}

export interface DatasetIndexImage {
  stem: string;
}

export interface DatasetIndexEmbedding {
  model_type: string;
}

export interface DatasetIndexAnnotation {
  latest_ts: string;
}

export interface DatasetIndex {
  images: DatasetIndexImage[];
  embeddings: Record<string, DatasetIndexEmbedding>;
  labels: DatasetLabel[];
  my_annotations: Record<string, Record<string, DatasetIndexAnnotation>>;
  role: BrokerRole;
}

export interface ImageUrl {
  stem: string;
  read_url: string;
}

export type MyAnnotationUrl =
  | { exists: false }
  | { exists: true; latest_ts: string; geojson_read_url: string };

export interface DeleteLabelResult {
  failed_files: string[];
  [key: string]: any;
}

export type EmbeddingUrls =
  | { exists: true; read_url: string }
  | { exists: false; image_read_url: string; embedding_put_url: string };

export interface SaveUrls {
  timestamp: string;
  png_put_url: string;
  geojson_put_url: string;
}

/**
 * Per-label, named, add-only data split snapshot (broker v0.7.0,
 * colab-rework-plan.md §23.1). `checkpoint` is set once a training session
 * has been started against this split, after which the split can still be
 * extended (add-only) but the backend has no way to resume training from a
 * checkpoint, so the frontend must not offer to start a new run against a
 * checkpointed split.
 */
export interface SplitDoc {
  name: string;
  label: string;
  created_at: string;
  created_by: string;
  updated_at: string;
  updated_by: string;
  ratio: number;
  train: string[];
  test: string[];
  annotation_counts: Record<string, number>;
  history: any[];
  checkpoint: { session_id: string; model_type: string; [key: string]: any } | null;
}

/**
 * Compact listing row returned by `list_splits` (broker v0.7.0,
 * `broker_core.split_summary`). Deliberately omits `train`/`test`/
 * `annotation_counts`/`created_by`/`history` — anything needing per-stem
 * membership must fetch the full doc via `getSplit`.
 */
export interface SplitSummary {
  name: string;
  label: string;
  n_train: number;
  n_test: number;
  ratio: number;
  created_at: string;
  updated_at: string;
  checkpoint: { session_id: string; model_type: string; [key: string]: any } | null;
}

/** Derive a listing-row summary from a full split doc, e.g. to keep a
 * compact-summary list in sync after `createSplit`/`updateSplit` return the
 * full doc directly. */
export function splitDocToSummary(doc: SplitDoc): SplitSummary {
  return {
    name: doc.name,
    label: doc.label,
    n_train: doc.train.length,
    n_test: doc.test.length,
    ratio: doc.ratio,
    created_at: doc.created_at,
    updated_at: doc.updated_at,
    checkpoint: doc.checkpoint,
  };
}

/** One image+annotation pair url resolved for fine-tuning (broker v0.7.0). */
export interface TrainingUrlEntry {
  stem: string;
  user: string;
  image_url: string;
  geojson_url: string;
}

export interface TrainingUrls {
  train: TrainingUrlEntry[];
  test: TrainingUrlEntry[];
  split: SplitDoc;
}

/**
 * Retry *fn* up to `maxAttempts` times with a fixed backoff between
 * attempts. Unlike `datasetApi.ts`'s `withStageRetry` (which only retries
 * "not in stage mode" errors), this retries on any error: the broker's own
 * write-path RPCs already self-heal stage-mode issues internally, but
 * read-path RPCs (`get_dataset_index`, `get_embedding_urls`) do not, and
 * broker RPCs in general should tolerate a transient network/Ray hiccup
 * (colab-rework-plan.md F5).
 */
export async function withRetry<T>(
  fn: () => Promise<T>,
  maxAttempts = 3,
  backoffMs = 1000,
): Promise<T> {
  let lastErr: unknown;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastErr = err;
      if (attempt === maxAttempts) throw err;
      await new Promise((resolve) => setTimeout(resolve, backoffMs));
    }
  }
  throw lastErr;
}

let brokerServicePromise: Promise<any> | null = null;

/**
 * Resolve a handle to the annotation-broker service, sharing one in-flight
 * (and then resolved) promise across every caller in this session. Clears
 * the cache on failure so a subsequent call retries a fresh resolution.
 *
 * @param server A connected hypha-rpc server object.
 * @returns The annotation-broker service proxy.
 * @throws If the service cannot be reached.
 */
export async function resolveBrokerService(server: any): Promise<any> {
  if (!brokerServicePromise) {
    brokerServicePromise = server
      .getService(ANNOTATION_BROKER_SERVICE_ID, { mode: 'select:min:get_load' })
      .catch((err: any) => {
        brokerServicePromise = null;
        throw new Error(
          `annotation-broker service is not available (${(err as Error)?.message || err})`,
        );
      });
  }
  return brokerServicePromise;
}

/** Drop the cached service handle so the next call resolves fresh. Used by
 * `callBroker`'s own retry path and by UI "Try again" actions that must not
 * re-await a handle that's already known to be dead. */
export function resetBrokerServiceCache(): void {
  brokerServicePromise = null;
}

/**
 * A failed RPC whose *shape* points at a dead transport (closed socket,
 * timeout, "service not found" right after a reconnect) rather than at the
 * call's own arguments or the callee's own logic. These are exactly the
 * failures a reconnect+retry can plausibly fix; anything else (a real
 * permission/validation error from the broker) should surface immediately.
 */
function isConnectionShapedError(err: unknown): boolean {
  const message = String((err as Error)?.message ?? err ?? '');
  return /connection is closed|websocket|not connected|timed?\s?out|timeout|service not found|not available/i.test(
    message,
  );
}

const AUTH_EXPIRED_MESSAGE = 'Your session has expired. Please log in again.';

/** Marks an error as "reconnect could not recover this", which callers
 * distinguish from a generic connection failure by classifying the message
 * against `AUTH_EXPIRED_MESSAGE` (see `classifyBrokerError`). */
class BrokerReconnectFailedError extends Error {}

/**
 * Run *fn* against a resolved broker handle. On a connection-shaped
 * failure, drop the cached handle, ask the shared Hypha store to reconnect
 * (it dedupes/rate-limits/retries internally — see `hyphaStore.ts`), and
 * retry the call exactly once against the refreshed server. Only surfaces
 * the error to the caller if that retry also fails, or if the failure
 * wasn't connection-shaped to begin with (colab-rework-plan.md §14b item 1).
 */
async function callBroker<T>(server: any, fn: (broker: any, server: any) => Promise<T>): Promise<T> {
  try {
    const broker = await resolveBrokerService(server);
    return await fn(broker, server);
  } catch (err) {
    if (!isConnectionShapedError(err)) throw err;
    resetBrokerServiceCache();
    const reconnected = await useHyphaStore.getState().attemptReconnect();
    if (!reconnected) {
      const isLoggedIn = useHyphaStore.getState().isLoggedIn;
      throw new BrokerReconnectFailedError(isLoggedIn ? (err as Error)?.message || String(err) : AUTH_EXPIRED_MESSAGE);
    }
    const freshServer = useHyphaStore.getState().server;
    const broker = await resolveBrokerService(freshServer);
    return await fn(broker, freshServer);
  }
}

export async function registerDataset(server: any, artifactId: string): Promise<DatasetMetadata> {
  return callBroker(server, (broker) => broker.register_dataset({ artifact_id: artifactId, _rkwargs: true }));
}

export async function listMyDatasets(server: any): Promise<{ shared: SharedDatasetSummary[] }> {
  return callBroker(server, (broker) => broker.list_my_datasets({ _rkwargs: true }));
}

/**
 * Coarse classification of a failed broker call, distinguishing a genuine
 * access denial from "the dataset isn't registered" or a transport hiccup —
 * the three fail differently and read the RPC error message text because
 * hypha-rpc does not carry the remote Python exception's class across the
 * wire, only `str(exception)`. Matches broker.py's `_metadata_or_raise` /
 * `_require_role` message shapes; update alongside those if they change.
 */
export type BrokerErrorCode =
  | 'not-registered'
  | 'permission-denied'
  | 'unavailable'
  | 'auth-expired'
  | 'unknown';

export class BrokerAccessError extends Error {
  code: BrokerErrorCode;
  constructor(message: string, code: BrokerErrorCode) {
    super(message);
    this.name = 'BrokerAccessError';
    this.code = code;
  }
}

export function classifyBrokerError(err: unknown): BrokerErrorCode {
  if (err instanceof BrokerReconnectFailedError) {
    return err.message === AUTH_EXPIRED_MESSAGE ? 'auth-expired' : 'unavailable';
  }
  const message = String((err as Error)?.message ?? err);
  if (/annotation-broker service is not available/.test(message)) return 'unavailable';
  if (/is not registered with the broker/.test(message)) return 'not-registered';
  if (/or higher is required/.test(message)) return 'permission-denied';
  return 'unknown';
}

export async function getDataset(server: any, artifactId: string): Promise<DatasetWithRole> {
  try {
    return await callBroker(server, (broker) => broker.get_dataset({ artifact_id: artifactId, _rkwargs: true }));
  } catch (err) {
    throw new BrokerAccessError((err as Error)?.message || 'Failed to load dataset.', classifyBrokerError(err));
  }
}

export async function setRole(
  server: any,
  artifactId: string,
  user: BrokerUserRef,
  role: 'manager' | 'annotator',
): Promise<DatasetMetadata> {
  return callBroker(server, (broker) => broker.set_role({ artifact_id: artifactId, user, role, _rkwargs: true }));
}

export async function removeUser(
  server: any,
  artifactId: string,
  user: BrokerUserRef,
): Promise<DatasetMetadata> {
  return callBroker(server, (broker) => broker.remove_user({ artifact_id: artifactId, user, _rkwargs: true }));
}

export async function setPublic(
  server: any,
  artifactId: string,
  isPublic: boolean,
): Promise<DatasetMetadata> {
  return callBroker(server, (broker) =>
    broker.set_public({ artifact_id: artifactId, is_public: isPublic, _rkwargs: true }),
  );
}

/**
 * Batched ACL update (broker v0.3.1): stage any mix of role grants, removals,
 * and a public-flag change into a single `update_sharing` call instead of
 * firing `setRole`/`removeUser`/`setPublic` one at a time. Access-request
 * entries matching an `add` are auto-cleared server-side. A no-op call (no
 * actual change) returns instantly without touching the artifact.
 */
export async function updateSharing(
  server: any,
  artifactId: string,
  changes: {
    add?: Array<{ user: BrokerUserRef; role: 'manager' | 'annotator' }>;
    remove?: BrokerUserRef[];
    set_public?: boolean;
  },
): Promise<DatasetMetadata> {
  return callBroker(server, (broker) =>
    broker.update_sharing({ artifact_id: artifactId, ...changes, _rkwargs: true }),
  );
}

/**
 * Ask the broker for a role on a dataset the caller doesn't have one on yet
 * (colab-rework-plan.md §13). Anonymous callers are rejected server-side
 * with a PermissionError asking them to log in first; callers should check
 * `useHyphaStore().user?.email` before calling this.
 */
export async function requestAccess(
  server: any,
  artifactId: string,
  role: 'annotator' | 'manager' = 'annotator',
): Promise<{ status: 'requested' | 'already_has_access'; [key: string]: any }> {
  return callBroker(server, (broker) => broker.request_access({ artifact_id: artifactId, role, _rkwargs: true }));
}

/**
 * Reject a pending access request (manager+ only). Unlike `setRole`, this
 * does not grant a role, it just clears the request. `user` identifies the
 * requester the same way as `setRole`/`removeUser` (`{id}` or `{email}`),
 * not the request's own `id` field.
 */
export async function dismissAccessRequest(
  server: any,
  artifactId: string,
  user: BrokerUserRef,
): Promise<DatasetMetadata> {
  return callBroker(server, (broker) => broker.dismiss_access_request({ artifact_id: artifactId, user, _rkwargs: true }));
}

export async function createLabel(
  server: any,
  artifactId: string,
  name: string,
  description = '',
): Promise<DatasetMetadata> {
  return callBroker(server, (broker) =>
    broker.create_label({ artifact_id: artifactId, name, description, _rkwargs: true }),
  );
}

export async function getDatasetIndex(server: any, artifactId: string): Promise<DatasetIndex> {
  return callBroker(server, (broker) => broker.get_dataset_index({ artifact_id: artifactId, _rkwargs: true }));
}

/**
 * Resolve a fresh presigned read URL for one image (broker v0.5.0). Public-min
 * role, safe to call before the caller's role on the dataset is known — this
 * is what lets the `&image=<stem>` deep link render before `get_dataset_index`
 * or the auth/role check resolves.
 */
export async function getImageUrl(server: any, artifactId: string, imageStem: string): Promise<ImageUrl> {
  return callBroker(server, (broker) =>
    broker.get_image_url({ artifact_id: artifactId, image_stem: imageStem, _rkwargs: true }),
  );
}

/**
 * Resolve the caller's own latest annotation for one image+label (broker
 * v0.5.0), replacing the presigned URLs `get_dataset_index` used to embed in
 * `my_annotations`. Annotator-min role.
 */
export async function getMyAnnotationUrl(
  server: any,
  artifactId: string,
  label: string,
  imageStem: string,
): Promise<MyAnnotationUrl> {
  return callBroker(server, (broker) =>
    broker.get_my_annotation_url({ artifact_id: artifactId, label, image_stem: imageStem, _rkwargs: true }),
  );
}

/**
 * Recursively delete a label's `label_<name>/` folder server-side in one
 * call (broker v0.5.0), replacing the old client-side per-file recursive
 * delete. Manager-min role. Any files that could not be removed are
 * returned in `failed_files` rather than throwing.
 */
export async function deleteLabel(server: any, artifactId: string, name: string): Promise<DeleteLabelResult> {
  return callBroker(server, (broker) => broker.delete_label({ artifact_id: artifactId, name, _rkwargs: true }));
}

export async function getEmbeddingUrls(
  server: any,
  artifactId: string,
  imageStem: string,
  modelType: string,
): Promise<EmbeddingUrls> {
  return callBroker(server, (broker) =>
    broker.get_embedding_urls({
      artifact_id: artifactId,
      image_stem: imageStem,
      model_type: modelType,
      _rkwargs: true,
    }),
  );
}

export async function getSaveUrls(
  server: any,
  artifactId: string,
  label: string,
  imageStem: string,
): Promise<SaveUrls> {
  return callBroker(server, (broker) =>
    broker.get_save_urls({
      artifact_id: artifactId,
      label,
      image_stem: imageStem,
      _rkwargs: true,
    }),
  );
}

/**
 * Create a new named split for one label (broker v0.7.0, colab-rework-plan.md
 * §23.1). Manager-min role. `ratio` is the intended train fraction (0..1),
 * used later to guide auto-distribution when the split is extended; omit it
 * to let the server default to the actual train/(train+test) at creation.
 */
export async function createSplit(
  server: any,
  artifactId: string,
  label: string,
  name: string,
  train: string[],
  test: string[],
  ratio?: number,
): Promise<SplitDoc> {
  return callBroker(server, (broker) =>
    broker.create_split({ artifact_id: artifactId, label, name, train, test, ratio, _rkwargs: true }),
  );
}

/**
 * Extend an existing split (broker v0.7.0). Add-only: `addTrain`/`addTest`
 * are appended to the split's existing membership. The server enforces the
 * ever-trained-to-test guard (a stem once in `train` can never move to
 * `test`) and raises a plain, user-readable `ValueError` on violation.
 */
export async function updateSplit(
  server: any,
  artifactId: string,
  label: string,
  name: string,
  addTrain: string[],
  addTest: string[],
): Promise<SplitDoc> {
  return callBroker(server, (broker) =>
    broker.update_split({ artifact_id: artifactId, label, name, add_train: addTrain, add_test: addTest, _rkwargs: true }),
  );
}

/** Read one named split for one label (broker v0.7.0). Annotator-min role. */
export async function getSplit(server: any, artifactId: string, label: string, name: string): Promise<SplitDoc> {
  return callBroker(server, (broker) => broker.get_split({ artifact_id: artifactId, label, name, _rkwargs: true }));
}

/**
 * List splits for one label, or across all labels when `label` is omitted
 * (broker v0.7.0). Returns compact summaries only (no `train`/`test`
 * membership arrays) — use `getSplit` for one split's full doc. The
 * all-labels form powers the image-delete guard: a stem that's a member of
 * any split, for any label, cannot be deleted, but resolving *which* split
 * owns a given stem requires following up with `getSplit` per name.
 */
export async function listSplits(server: any, artifactId: string, label?: string): Promise<SplitSummary[]> {
  return callBroker(server, (broker) => broker.list_splits({ artifact_id: artifactId, label, _rkwargs: true }));
}

/** Delete a named split (broker v0.7.0). Only allowed while `checkpoint` is null. */
export async function deleteSplit(server: any, artifactId: string, label: string, name: string): Promise<{ deleted: boolean }> {
  return callBroker(server, (broker) => broker.delete_split({ artifact_id: artifactId, label, name, _rkwargs: true }));
}

export async function deleteAnnotation(
  server: any,
  artifactId: string,
  label: string,
  userFolder: string,
  stem: string,
  timestamp: string,
): Promise<{ deleted: boolean }> {
  return callBroker(server, (broker) =>
    broker.delete_annotation({
      artifact_id: artifactId,
      label,
      user_folder: userFolder,
      stem,
      timestamp,
      _rkwargs: true,
    }),
  );
}

/**
 * Record that a training session was started against this split (broker
 * v0.7.0). Called once `start_training` returns a session id, so the split
 * can no longer be picked to start a fresh run (the backend can't resume
 * from a checkpoint), while still allowing add-only extension.
 */
export async function setSplitCheckpoint(
  server: any,
  artifactId: string,
  label: string,
  name: string,
  checkpoint: { session_id: string; model_type: string; [key: string]: any },
): Promise<SplitDoc> {
  return callBroker(server, (broker) =>
    broker.set_split_checkpoint({ artifact_id: artifactId, label, name, checkpoint, _rkwargs: true }),
  );
}

/**
 * Resolve the latest-pair-per-(user,stem) presigned image+geojson URLs for
 * one label, partitioned by the given split (broker v0.7.0). Manager-min
 * role. The response echoes the resolved split doc under `split`.
 */
export async function getTrainingUrls(
  server: any,
  artifactId: string,
  label: string,
  splitName: string,
): Promise<TrainingUrls> {
  return callBroker(server, (broker) =>
    broker.get_training_urls({ artifact_id: artifactId, label, split_name: splitName, _rkwargs: true }),
  );
}

export async function deleteDatasetRecord(
  server: any,
  artifactId: string,
): Promise<{ deleted: boolean }> {
  return callBroker(server, (broker) => broker.delete_dataset_record({ artifact_id: artifactId, _rkwargs: true }));
}
