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
  role: BrokerRole;
  labels: DatasetLabel[];
}

export interface DatasetIndexImage {
  stem: string;
  read_url: string;
}

export interface DatasetIndexEmbedding {
  model_type: string;
  read_url: string;
}

export interface DatasetIndexAnnotation {
  latest_ts: string;
  geojson_read_url: string;
}

export interface DatasetIndex {
  images: DatasetIndexImage[];
  embeddings: Record<string, DatasetIndexEmbedding>;
  labels: DatasetLabel[];
  my_annotations: Record<string, Record<string, DatasetIndexAnnotation>>;
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

export async function registerDataset(server: any, artifactId: string): Promise<DatasetMetadata> {
  const broker = await resolveBrokerService(server);
  return broker.register_dataset({ artifact_id: artifactId, _rkwargs: true });
}

export async function listMyDatasets(server: any): Promise<{ shared: SharedDatasetSummary[] }> {
  const broker = await resolveBrokerService(server);
  return broker.list_my_datasets({ _rkwargs: true });
}

/**
 * Coarse classification of a failed broker call, distinguishing a genuine
 * access denial from "the dataset isn't registered" or a transport hiccup —
 * the three fail differently and read the RPC error message text because
 * hypha-rpc does not carry the remote Python exception's class across the
 * wire, only `str(exception)`. Matches broker.py's `_metadata_or_raise` /
 * `_require_role` message shapes; update alongside those if they change.
 */
export type BrokerErrorCode = 'not-registered' | 'permission-denied' | 'unavailable' | 'unknown';

export class BrokerAccessError extends Error {
  code: BrokerErrorCode;
  constructor(message: string, code: BrokerErrorCode) {
    super(message);
    this.name = 'BrokerAccessError';
    this.code = code;
  }
}

export function classifyBrokerError(err: unknown): BrokerErrorCode {
  const message = String((err as Error)?.message ?? err);
  if (/annotation-broker service is not available/.test(message)) return 'unavailable';
  if (/is not registered with the broker/.test(message)) return 'not-registered';
  if (/or higher is required/.test(message)) return 'permission-denied';
  return 'unknown';
}

export async function getDataset(server: any, artifactId: string): Promise<DatasetWithRole> {
  try {
    const broker = await resolveBrokerService(server);
    return await broker.get_dataset({ artifact_id: artifactId, _rkwargs: true });
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
  const broker = await resolveBrokerService(server);
  return broker.set_role({ artifact_id: artifactId, user, role, _rkwargs: true });
}

export async function removeUser(
  server: any,
  artifactId: string,
  user: BrokerUserRef,
): Promise<DatasetMetadata> {
  const broker = await resolveBrokerService(server);
  return broker.remove_user({ artifact_id: artifactId, user, _rkwargs: true });
}

export async function setPublic(
  server: any,
  artifactId: string,
  isPublic: boolean,
): Promise<DatasetMetadata> {
  const broker = await resolveBrokerService(server);
  return broker.set_public({ artifact_id: artifactId, is_public: isPublic, _rkwargs: true });
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
  const broker = await resolveBrokerService(server);
  return broker.request_access({ artifact_id: artifactId, role, _rkwargs: true });
}

/**
 * Reject a pending access request (manager+ only). Unlike `setRole`, this
 * does not grant a role, it just clears the request.
 */
export async function dismissAccessRequest(
  server: any,
  artifactId: string,
  user: string,
): Promise<DatasetMetadata> {
  const broker = await resolveBrokerService(server);
  return broker.dismiss_access_request({ artifact_id: artifactId, user, _rkwargs: true });
}

export async function createLabel(
  server: any,
  artifactId: string,
  name: string,
  description = '',
): Promise<DatasetMetadata> {
  const broker = await resolveBrokerService(server);
  return broker.create_label({ artifact_id: artifactId, name, description, _rkwargs: true });
}

export async function getDatasetIndex(server: any, artifactId: string): Promise<DatasetIndex> {
  const broker = await resolveBrokerService(server);
  return broker.get_dataset_index({ artifact_id: artifactId, _rkwargs: true });
}

export async function getEmbeddingUrls(
  server: any,
  artifactId: string,
  imageStem: string,
  modelType: string,
): Promise<EmbeddingUrls> {
  const broker = await resolveBrokerService(server);
  return broker.get_embedding_urls({
    artifact_id: artifactId,
    image_stem: imageStem,
    model_type: modelType,
    _rkwargs: true,
  });
}

export async function getSaveUrls(
  server: any,
  artifactId: string,
  label: string,
  imageStem: string,
): Promise<SaveUrls> {
  const broker = await resolveBrokerService(server);
  return broker.get_save_urls({
    artifact_id: artifactId,
    label,
    image_stem: imageStem,
    _rkwargs: true,
  });
}

export async function deleteDatasetRecord(
  server: any,
  artifactId: string,
): Promise<{ deleted: boolean }> {
  const broker = await resolveBrokerService(server);
  return broker.delete_dataset_record({ artifact_id: artifactId, _rkwargs: true });
}
