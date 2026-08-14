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

export interface DatasetMetadata {
  artifact_id: string;
  owner: BrokerUserRef;
  managers: BrokerUserRef[];
  annotators: BrokerUserRef[];
  public: boolean;
  labels: DatasetLabel[];
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

export async function getDataset(server: any, artifactId: string): Promise<DatasetWithRole> {
  const broker = await resolveBrokerService(server);
  return broker.get_dataset({ artifact_id: artifactId, _rkwargs: true });
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
