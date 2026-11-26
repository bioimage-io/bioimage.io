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
import type { ImageSourceRef } from './imageSource';
import type { PixelRegion } from './ngffLayout';

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

export type ImageState = 'local' | 'remote';

export interface DatasetIndexImage {
  stem: string;
  // annotation-broker 0.8.0+: cached PNG-header read at registration/upload
  // time. Absent when unreadable, non-PNG, or on a first-call race — treat
  // missing as "unknown", never warn on it (round-31 follow-up).
  width?: number;
  height?: number;
  // annotation-broker 0.10.0+: image-manifest fields. `state` is 'local' when
  // the pixels are a file in the artifact and 'remote' when the manifest only
  // references an external source. `path` is the artifact-relative file path,
  // absent for a not-yet-materialised remote entry. Both are absent on a
  // pre-0.10.0 broker, where every image is by definition local — treat
  // `state === undefined` as 'local', never as "unknown".
  state?: ImageState;
  path?: string;
}

export interface SyncImageManifestResult {
  /** True when the manifest file was actually rewritten. */
  changed: boolean;
  /** Total entries in the reconciled manifest. */
  images: number;
  /** How many of those are `remote` (no file in the artifact). */
  remote: number;
}

export interface DatasetIndexEmbedding {
  model_type: string;
  // annotation-broker 0.9.0+: every model type that currently has a stored
  // embedding for this stem. Absent means only `model_type` is known
  // (0.8.0 back-compat) -- treat a missing field as a single-entry list of
  // `model_type`, not as "no embeddings."
  model_types?: string[];
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

/**
 * Where to read one image from (broker v0.10.0).
 *
 * `kind: 'file'` is the pre-0.10.0 shape with a discriminator added, so the
 * `read_url` field is in the same place it always was. `kind: 'ngff'` is a
 * remote OME-Zarr source the browser reads directly, with any credential
 * already spliced into the path by the broker (never stored in the artifact).
 *
 * `kind` is optional on the type because a broker older than 0.10.0 omits it;
 * `imageSourceRefFor` treats a missing `kind` with a `read_url` as a file.
 */
export type ImageUrl =
  | { stem: string; kind?: 'file'; read_url: string }
  | {
      stem: string;
      kind: 'ngff';
      store_root: string;
      multiscale_path?: string | null;
      /** Set when the image is a patch of a larger slide (broker v0.12.0). */
      region?: PixelRegion | null;
      /**
       * The slice this source was recorded on at import, by axis name, and the
       * shape those indices were measured against (broker v0.12.6 records
       * them; a release that also RETURNS them here is still owed).
       *
       * Without both, the page that draws the annotation cannot derive the
       * recorded plane and falls back to each level's own middle slice, which
       * on a pyramid that resamples z is a different slice from the recorded
       * one. `openNgffPyramid` refuses such a source rather than drawing the
       * wrong plane, so an absent field is reported rather than silent.
       */
      planes?: Record<string, number> | null;
      level0_shape?: number[] | null;
    };

/**
 * A rectangle of a store, in level-0 pixel coordinates (design §2).
 *
 * Re-exported rather than redeclared. `ngffLayout` owns it because that is
 * where the arithmetic on it lives, and it has no imports of its own to drag
 * along; this is a type-only re-export, so nothing is added to the bundle.
 */
export type { PixelRegion } from './ngffLayout';

export interface ImportNgffResult {
  stem: string;
  state: 'remote';
  /** The patch's dimensions when `source.region` is set, the store's otherwise. */
  width: number;
  height: number;
  dtype?: string;
  channels?: string[];
  levels?: number;
  source: {
    kind: 'ngff';
    store_root: string;
    multiscale_path: string | null;
    region: PixelRegion | null;
    fetched_at: string;
    content_hint: string | null;
  };
}

/**
 * What the broker learned about a store without writing anything (v0.12.0).
 *
 * Same metadata read and same CORS preflight `import_ngff_image` runs, split
 * out so the import UI can show the slide and its size before the user has
 * committed to a patch. Doing the check here rather than in the browser is
 * deliberate and unchanged from §7: a CORS rejection is opaque to JS, so the
 * broker is the only place that can turn one into a sentence worth reading.
 */
export interface NgffProbe {
  store_root: string;
  multiscale_path: string | null;
  width: number;
  height: number;
  dtype: string;
  /**
   * Channel names, or NULL when the store names none.
   *
   * THREE cases produce null, not one. A review found the first version of
   * this comment said only "no omero metadata", which is the commonest of
   * them and narrower than the truth: `ngff_channel_names` also returns None
   * when an omero block is PRESENT with an empty `channels` list, and when no
   * channel in it carries a `label` or a `name`. A caller reading the narrow
   * version would think a store with an omero block is safe.
   *
   * Declared as a plain array until a store without that block was tried in a
   * browser: the broker sends null, two unguarded `probe.channels.length`
   * reads threw, and the whole page unmounted to an empty body. Stores written
   * by anything other than a converter that emits omero (plain `zarr`, a
   * `coarsen`-built pyramid) hit this on the FIRST action of the import flow.
   * The type now says what the service sends, so a new reader is warned by
   * tsc rather than by a blank page.
   */
  channels: string[] | null;
  levels: number;
  content_hint: string | null;
  /** Default stem the broker would derive from the URL, for the name field. */
  stem: string;
  /**
   * Largest image the browser is allowed to materialise, in bytes of decoded
   * samples. Sent by the broker rather than hard-coded here so the picker's
   * guard cannot drift from the gate that actually enforces it.
   */
  max_materialise_bytes: number;
  /**
   * The store's own axis NAMES, in its order, e.g. `["t","c","z","y","x"]`.
   *
   * Absent from a broker older than v0.12.6. Declared here only now, though
   * the broker has sent it for longer: a key nothing declares is a key nothing
   * can use, and this one is what tells a z-stack from a 2-D image before an
   * import is written. See `displayedPlanesForProbe` in ngffLayout.
   */
  axes?: string[];
  /** Role to axis INDEX, as the broker resolved it. Absent before v0.12.6. */
  axis_roles?: { y: number; x: number; c: number | null };
  /** Level 0's dimensions in the store's axis order. Absent before v0.12.6. */
  level0_shape?: number[];
  /** Level 0 FIRST, named as the store names them, so not reliably `"0"`. */
  dataset_paths?: string[];
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
/**
 * Where a training image's pixels are. A materialised image has a presigned
 * `image_url`; a remote OME-Zarr one has an `image_source` describing the store
 * and the region to read, and no url at all.
 */
export interface RemoteImageSource {
  kind: 'ngff';
  /** The store URL. A credential is spliced in per response, so do not log it. */
  store_root: string;
  multiscale_path: string | null;
  /** `null` means the whole image rather than a crop. */
  region: { x: number; y: number; width: number; height: number } | null;
  /** Level 0 FIRST, named as the store names them, so not reliably "0". */
  dataset_paths: string[];
  axis_roles: { y: number; x: number; c: number | null };
  /** In the store's own axis order. */
  level0_shape: number[];
  /** The axis NAMES, e.g. ["c","y","x"]. */
  axes: string[];
  planes: Record<string, number> | null;
}

/**
 * One image+annotation pair resolved for fine-tuning.
 *
 * The two shapes are told apart by which key is PRESENT, and this is a
 * DISCRIMINATED UNION rather than one shape with two optional keys. With both
 * keys optional, a caller could write `e.image_url` for a region row, get
 * `undefined`, and have nothing to object: the hole then went into
 * `start_training(train_images=[...])`, which either failed deep in the
 * backend naming a missing source, or trained only on the subset that happened
 * to be materialised.
 *
 * WHAT THE UNION DOES AND DOES NOT STOP, measured rather than assumed. The
 * union refuses a row carrying BOTH keys and one carrying NEITHER, by two
 * DIFFERENT mechanisms, so neither half is redundant: the required key in each
 * member is what refuses NEITHER, and the `?: never` partner is what refuses
 * BOTH. Measured by deleting the two `?: never` members and recompiling: a
 * both-key row then compiles with no error at all, while a neither-key row
 * still fails. TypeScript's excess-property check on a union admits a key that
 * exists in any member, so without the partner there is nothing left to object.
 * Deleting them as redundant would silently re-admit both-key rows. It does
 * NOT stop a caller reading `e.image_url` off an unnarrowed entry: both members
 * declare the key, so the access types as `string | undefined` and compiles.
 * Under `tsc --strict` it errors only where that value is assigned to a
 * non-optional slot, which is what the typed builder in
 * `utils/startTrainingCall.ts` provides and what `call: any` in Finetune.tsx
 * still does not. So the guarantee is the BUILDER's, not the type's: go through
 * `trainingImageRef` below.
 */
export type TrainingUrlEntry =
  | { stem: string; user: string; geojson_url: string; image_url: string; image_source?: never }
  | { stem: string; user: string; geojson_url: string; image_source: RemoteImageSource; image_url?: never };

/**
 * What to hand `start_training` for one training image.
 *
 * `start_training` accepts a url string OR the source object, so the page does
 * not have to understand the object: it passes through whichever the broker
 * sent. Returns `undefined` when an entry carries neither, which is a broker
 * answer this build does not understand, and the caller refuses rather than
 * sending a hole in the array.
 */
export function trainingImageRef(
  entry: TrainingUrlEntry,
): string | RemoteImageSource | undefined {
  if (entry.image_url) return entry.image_url;
  if (entry.image_source) return entry.image_source;
  return undefined;
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
 * Reconcile `images/manifest.json` against the actual `images/` listing
 * (broker v0.10.0). Manager-min role. Call it after uploading or deleting
 * image files.
 *
 * Best-effort by design: the broker unions the manifest with the listing on
 * every read, so a failed or skipped sync costs those stems their manifest
 * metadata (dimensions, source provenance), never their visibility. Callers
 * should therefore log a failure and carry on rather than surfacing it.
 */
export async function syncImageManifest(
  server: any,
  artifactId: string,
): Promise<SyncImageManifestResult> {
  return callBroker(server, (broker) => broker.sync_image_manifest({ artifact_id: artifactId, _rkwargs: true }));
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
 * A recorded plane, or `null` when what arrived cannot be used as one.
 *
 * "Both halves or neither" was the rule and this is what enforces it. An empty
 * array is TRUTHY, so a check for the field's presence let `level0_shape: []`
 * through as a whole record: the mapping then read a missing reference size,
 * defaulted it to one slice, and returned index 8 of 9 for a recorded slice 4,
 * with no error anywhere. A wrong slice that reports success is the failure
 * this whole mechanism exists to prevent, so a shape that is not a non-empty
 * list of positive integers is no shape at all.
 *
 * Exported for its own test: the condition can only be produced by a service
 * this repository does not control.
 */
export function usableRecord(
  planes: Record<string, number> | null | undefined,
  shape: number[] | null | undefined,
): { planes: Record<string, number>; shape: number[] } | null {
  if (!planes || Object.keys(planes).length === 0) return null;
  if (!Array.isArray(shape) || shape.length === 0) return null;
  if (!shape.every((n) => typeof n === 'number' && Number.isInteger(n) && n > 0)) return null;
  return { planes, shape };
}

/**
 * Turn a broker `ImageUrl` into something `openImageSource` accepts.
 *
 * The two live in different modules on purpose: `imageSource` knows how to
 * decode and nothing about the broker, and this is the one place the wire
 * shape is translated.
 */
export function imageSourceRefFor(url: ImageUrl): ImageSourceRef {
  if (url.kind === 'ngff') {
    return {
      kind: 'ngff',
      storeRoot: url.store_root,
      multiscalePath: url.multiscale_path ?? undefined,
      region: url.region ?? null,
      // Both halves or neither: an index without the shape it was measured
      // against cannot be placed on another level, so half a record is no
      // record and must not look like one.
      planes: usableRecord(url.planes, url.level0_shape),
    };
  }
  return url.read_url;
}

/**
 * Read a store's metadata without importing it (broker v0.12.0). Manager-min
 * role, and it writes nothing: this is what the import dialog calls to render
 * a preview of the slide before the user picks the patch to take from it.
 */
export async function probeNgffSource(
  server: any,
  storeRoot: string,
  multiscalePath?: string,
): Promise<NgffProbe> {
  return callBroker(server, (broker) =>
    broker.probe_ngff_source({
      store_root: storeRoot,
      multiscale_path: multiscalePath || null,
      origin: window.location.origin,
      _rkwargs: true,
    }),
  );
}

/**
 * Add a remote OME-Zarr source to a dataset (broker v0.10.0). Manager-min
 * role. Nothing is copied: the broker reads the store's metadata, fetches a
 * single chunk to prove the browser will be able to read it, and records the
 * result. A source that fails that check is rejected here with a reason,
 * rather than importing and then failing on every image open.
 */
export async function importNgffImage(
  server: any,
  artifactId: string,
  storeRoot: string,
  stem?: string,
  multiscalePath?: string,
  /** A patch of the store rather than the whole of it (broker v0.12.0). */
  region?: PixelRegion | null,
  /**
   * Which slice of each non-spatial axis the annotator is showing, by axis
   * name (broker v0.12.6). Required for a store whose t or z is larger than
   * one: training refuses such a source with no plane recorded rather than
   * reading index 0, because index 0 would pair the polygons with another
   * slice's pixels and still reach COMPLETED. `displayedPlanesForProbe`
   * computes it from the same rule the viewer displays with.
   */
  planes?: Record<string, number> | null,
): Promise<ImportNgffResult> {
  const wanted = planes && Object.keys(planes).length > 0 ? planes : undefined;
  return callBroker(server, async (broker) => {
    // The key is OMITTED, not sent as null, when there is no plane to record.
    //
    // Measured against the deployed service: it raises `TypeError: got an
    // unexpected keyword argument 'planes'` at argument binding, exactly as it
    // does for a nonsense kwarg, because the version accepting one is merged
    // but not yet rolled out. Sending `planes: null` on every import would
    // therefore have broken EVERY remote import, including the 2-D ones that
    // have no plane to record and nothing to gain from the field.
    //
    // So the only calls that can meet an older service are the multi-slice
    // ones, which is the case that cannot be done correctly there anyway.
    const payload: Record<string, unknown> = {
      artifact_id: artifactId,
      store_root: storeRoot,
      stem: stem || null,
      multiscale_path: multiscalePath || null,
      region: region || null,
      origin: window.location.origin,
      _rkwargs: true,
    };
    if (wanted) payload.planes = wanted;
    try {
      return await broker.import_ngff_image(payload);
    } catch (err) {
      throw rewriteMissingPlanesSupport(err, wanted);
    }
  });
}

/**
 * Turn "unexpected keyword argument 'planes'" into a sentence worth reading.
 *
 * The raw error is a Python traceback from inside an RPC worker, and the thing
 * it means is specific: this annotation service is older than the import being
 * attempted, and recording the slice is not optional for the source in hand.
 * Everything else passes through untouched, because a message rewritten for
 * the wrong error is worse than a traceback.
 *
 * Exported for its own test. The condition it matches can only be produced by
 * a service this repository does not control, so a unit test is the only place
 * the mapping can be checked at all.
 */
export function rewriteMissingPlanesSupport(err: unknown, wanted: unknown): unknown {
  const text = String((err as any)?.message ?? err ?? '');
  if (!wanted || !/unexpected keyword argument '?planes'?/.test(text)) return err;
  return new Error(
    'This source has more than one slice, so which slice an annotation is ' +
      'drawn on has to be recorded with the import. The annotation service ' +
      'running here is too old to record it (it needs v0.12.6 or newer). ' +
      'Importing it without that would produce a source that cannot be ' +
      'trained on, so the import was refused instead.',
  );
}

/**
 * What the STARTING call of a local-image upload answers (broker v0.12.11+).
 *
 * Two shapes, discriminated by `already`. A stem the dataset already has is
 * not an error: the user picked a file whose name is taken, and the page says
 * so rather than overwriting somebody's image and orphaning its annotations.
 */
export type LocalImageUploadStart =
  | {
      already: false;
      stem: string;
      path: string;
      put_url: string;
      max_bytes: number;
      /**
       * Names the marker the starting call wrote, and the finishing call
       * REQUIRES it. The finish may have to delete the object, because the
       * size ceiling is enforced after the bytes land, and the one thing it
       * must never delete is an image the dataset already had. No listing can
       * tell those apart, so the fact is recorded when it is created.
       */
      mint_id: string;
    }
  | { already: true; stem: string; path: string };

/**
 * Mint a presigned PUT for ONE local image (broker v0.12.11+). Manager role.
 *
 * The only route by which an image the user holds locally enters a dataset
 * without mounting a folder, which is what a browser with no File System
 * Access API cannot do.
 *
 * The manifest entry is NOT written by this call. The object lands at
 * `images/<stem><ext>` and the ordinary listing reconciliation turns it into a
 * `local` entry, which is exactly what happens to an image uploaded through a
 * mount. That is what makes the two indistinguishable afterwards rather than
 * merely similar.
 */
export async function startLocalImageUpload(
  server: any,
  artifactId: string,
  filename: string,
): Promise<LocalImageUploadStart> {
  return callBroker(server, (broker) =>
    broker.upload_local_image({
      artifact_id: artifactId,
      filename,
      done: false,
      _rkwargs: true,
    }),
  );
}

/**
 * Finish a local-image upload, after the bytes have landed.
 *
 * `mintId` is the `mint_id` the starting call returned. A finish without it,
 * or with one minted for a different path, is refused and changes nothing at
 * all, so there is no version of this worth calling without the value.
 */
export async function finishLocalImageUpload(
  server: any,
  artifactId: string,
  filename: string,
  mintId: string,
): Promise<{ stem: string; path: string }> {
  return callBroker(server, (broker) =>
    broker.upload_local_image({
      artifact_id: artifactId,
      filename,
      done: true,
      mint_id: mintId,
      _rkwargs: true,
    }),
  );
}

/**
 * Undo an `importNgffImage` (broker v0.10.0). Manager-min role.
 *
 * A remote entry has no file, so deleting one is not "remove the file and
 * re-sync": `syncImageManifest` deliberately never prunes a remote entry,
 * because absence of a file proves nothing about it. This RPC is the only
 * way one leaves the manifest. It refuses on a local image.
 */
export async function forgetRemoteImage(
  server: any,
  artifactId: string,
  stem: string,
): Promise<{ stem: string; forgotten: boolean; images: number }> {
  return callBroker(server, (broker) =>
    broker.forget_remote_image({ artifact_id: artifactId, stem, _rkwargs: true }),
  );
}

export interface MaterialiseStart {
  already: false;
  stem: string;
  path: string;
  put_url: string;
  max_bytes: number;
}

export interface MaterialiseAlreadyDone {
  already: true;
  stem: string;
  path: string;
}

export type MaterialiseResult = MaterialiseStart | MaterialiseAlreadyDone;

/**
 * Begin turning a remote source into a file in the artifact (broker v0.11.0).
 * Annotator-min role, because materialisation is triggered by opening an
 * image and every annotator can open one.
 *
 * Returns `{ already: true }` when another annotator already did it, which is
 * the normal outcome for every open after the first, not an error.
 */
export async function startMaterialiseImage(
  server: any,
  artifactId: string,
  stem: string,
): Promise<MaterialiseResult> {
  return callBroker(server, (broker) =>
    broker.materialise_image({ artifact_id: artifactId, stem, done: false, _rkwargs: true }),
  );
}

/**
 * Finish a materialisation: the broker reads the uploaded object back, checks
 * it is a TIFF, and flips the manifest entry to `local` (broker v0.11.0).
 *
 * Call only after the PUT has resolved. Skipping it is recoverable but not
 * free: the file is there, so the next manifest read promotes the entry
 * anyway, but until something triggers that read the image stays listed as
 * remote and stays excluded from training.
 */
export async function finishMaterialiseImage(
  server: any,
  artifactId: string,
  stem: string,
  levels: number,
): Promise<{ already: boolean; stem: string; path?: string }> {
  return callBroker(server, (broker) =>
    broker.materialise_image({
      artifact_id: artifactId,
      stem,
      done: true,
      levels,
      _rkwargs: true,
    }),
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

/**
 * Clear a stem's cached μSAM embedding(s) (annotation-broker 0.9.1+,
 * `remove_embedding`). Passing `modelType` clears only that model's cached
 * `.npz`; omitting it clears every known model type plus the legacy
 * suffix-less file. Annotator role.
 */
export async function removeEmbedding(
  server: any,
  artifactId: string,
  imageStem: string,
  modelType?: string,
): Promise<{ removed: string[] }> {
  return callBroker(server, (broker) =>
    broker.remove_embedding({
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
