// Owner/manager-side dataset reads and writes, straight through the Hypha
// artifact-manager. No kernel involved: this is the frontend half of the
// architecture split in colab-rework-plan.md §1 — everything an
// owner/manager needs (their own dataset list, image list, label discovery,
// annotation browsing, stats, image deletion) works from direct artifact
// reads because they already hold `*` permission. Annotators go through
// `brokerApi.ts` instead (see F4a's rationale for why: a dataset only
// appears in "shared with you" once the broker has granted read access, so
// direct reads always succeed there too, but the broker index sidesteps
// stage/permission edge cases for a caller with only `r+`).

export const COLLECTION_ID = 'bioimage-io/colab-annotations';

const ARTIFACT_WORKSPACE = COLLECTION_ID.split('/')[0];

/**
 * Bare alias -> full artifact id (`bioimage-io/<alias>`) for artifact-manager
 * and broker calls. Already-qualified ids pass through unchanged, so old
 * bookmarked `#/colab/bioimage-io/<alias>` links still resolve.
 */
export function toArtifactId(idOrAlias: string): string {
  return idOrAlias.includes('/') ? idOrAlias : `${ARTIFACT_WORKSPACE}/${idOrAlias}`;
}

/** Full artifact id -> bare alias, for building `#/colab/<alias>` URLs (colab-rework-plan.md §11 item 5). */
export function toAlias(artifactId: string): string {
  return artifactId.startsWith(`${ARTIFACT_WORKSPACE}/`) ? artifactId.slice(ARTIFACT_WORKSPACE.length + 1) : artifactId;
}

/**
 * Build the query string for a `/colab/annotate` URL. Shared by
 * `DatasetOverview.tsx` (in-app navigation) and `ShareModal.tsx` (the
 * shareable annotation link + QR code) so the two never drift.
 */
export function buildAnnotateQuery(
  artifactId: string,
  label: string,
  imageStem?: string,
  usmSession?: { sessionId: string; modelType: string },
): string {
  const params = new URLSearchParams({ session_id: toAlias(artifactId), label });
  if (imageStem) params.set('image', imageStem);
  if (usmSession) {
    params.set('usm_session', usmSession.sessionId);
    params.set('usm_model', usmSession.modelType);
  }
  return params.toString();
}

// Session creation used to append "(Owner: <email>)" to every manifest
// description (public/colab_service.py), which was internal bookkeeping, not
// something to show collaborators. New artifacts no longer get the suffix
// (the owner is already stored structured in manifest.owner), but legacy
// artifacts still have it baked into stored data, so keep stripping it here.
const OWNER_SUFFIX_RE = /\s*\(Owner:\s*[^)]*\)\s*$/i;

/** Strip the legacy "(Owner: ...)" suffix and fall back to a placeholder when empty. */
export function formatDatasetDescription(description?: string | null): string {
  const stripped = (description ?? '').replace(OWNER_SUFFIX_RE, '').trim();
  return stripped || 'No description available.';
}

// {stem}-{YYYYMMDD-HHMMSS}.{png|geojson} — mirrors broker_core.py's
// ANNOTATION_FILENAME_RE. The timestamp itself contains a hyphen, so this
// anchors on the fixed-width digit groups rather than a naive split.
const ANNOTATION_FILENAME_RE = /^(.+)-(\d{8}-\d{6})\.(png|geojson)$/;

export interface DatasetSummary {
  artifact_id: string;
  name: string;
  description: string;
  labels: DatasetLabelRef[];
}

export interface DatasetLabelRef {
  name: string;
  description: string;
}

export interface DatasetImage {
  stem: string;
  name: string;
}

export interface AnnotationPair {
  userFolder: string;
  stem: string;
  timestamp: string;
  pngPath: string;
  geojsonPath: string;
}

export interface LabelUserRef {
  id?: string;
  email?: string;
}

/**
 * Retry *fn* up to `maxAttempts` times when it fails with a Hypha "not in
 * stage mode" error, matching the broker's own `ensure_staged` behavior.
 * Wrap every artifact-manager call that reads or writes the staged version.
 */
export async function withStageRetry<T>(
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
      const message = String((err as Error)?.message || err).toLowerCase();
      if (!message.includes('stage') || attempt === maxAttempts) {
        throw err;
      }
      await new Promise((resolve) => setTimeout(resolve, backoffMs));
    }
  }
  throw lastErr;
}

/** A small `p-limit`-style concurrency gate, no dependency needed for 4 slots. */
export function pLimit(concurrency: number) {
  let active = 0;
  const queue: Array<() => void> = [];

  const runNext = () => {
    active -= 1;
    const next = queue.shift();
    if (next) next();
  };

  return function limited<T>(fn: () => Promise<T>): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      const start = () => {
        active += 1;
        fn().then(
          (value) => {
            resolve(value);
            runNext();
          },
          (err) => {
            reject(err);
            runNext();
          },
        );
      };
      if (active < concurrency) start();
      else queue.push(start);
    });
  };
}

function isDirectoryEntry(entry: any): boolean {
  return entry?.type === 'directory' || entry?.is_dir === true;
}

function entryName(entry: any): string {
  return (entry?.name ?? entry?.path ?? String(entry ?? '')) as string;
}

async function listFilesSafe(
  artifactManager: any,
  artifactId: string,
  dirPath: string,
): Promise<any[]> {
  try {
    const files = await withStageRetry(() =>
      artifactManager.list_files({
        artifact_id: artifactId,
        dir_path: dirPath,
        stage: true,
        _rkwargs: true,
      }),
    );
    return files ?? [];
  } catch {
    return [];
  }
}

function parseAnnotationFilename(
  filename: string,
): { stem: string; timestamp: string; ext: 'png' | 'geojson' } | null {
  const match = ANNOTATION_FILENAME_RE.exec(filename);
  if (!match) return null;
  return { stem: match[1], timestamp: match[2], ext: match[3] as 'png' | 'geojson' };
}

/** `label_<label>` — matches the broker's `label_folder` (not `label:`; colons break URL/path layers). */
export function labelFolder(label: string): string {
  return `label_${label}`;
}

/**
 * Own datasets: staged + committed union under the collection, deduplicated
 * by id, filtered to artifacts the caller owns. Mirrors the pattern in
 * `SessionModal.tsx`'s `fetchUserArtifacts` (staged datasets are put back
 * into staging mode by `colab_service.py` on session resume, so both lists
 * matter). Full per-artifact reads pick up the current label list.
 */
export async function listMyDatasets(artifactManager: any, user: any): Promise<DatasetSummary[]> {
  if (!artifactManager || !user) return [];

  const [stagedResult, committedResult] = await Promise.allSettled([
    artifactManager.list({ parent_id: COLLECTION_ID, stage: true, _rkwargs: true }),
    artifactManager.list({ parent_id: COLLECTION_ID, _rkwargs: true }),
  ]);

  const seen = new Set<string>();
  const allArtifacts: any[] = [];
  for (const result of [stagedResult, committedResult]) {
    if (result.status === 'fulfilled') {
      for (const artifact of result.value ?? []) {
        if (!seen.has(artifact.id)) {
          seen.add(artifact.id);
          allArtifacts.push(artifact);
        }
      }
    }
  }

  const myArtifacts = allArtifacts.filter(
    (artifact) =>
      artifact.type === 'dataset' &&
      (artifact.manifest?.owner?.id === user.id || artifact.manifest?.created_by === user.id),
  );

  const limit = pLimit(4);
  const details = await Promise.all(
    myArtifacts.map((artifact) =>
      limit(async () => {
        let full = artifact;
        try {
          full = await withStageRetry(() =>
            artifactManager.read({ artifact_id: artifact.id, stage: true, _rkwargs: true }),
          );
        } catch {
          // fall back to the list entry
        }
        let labels: DatasetLabelRef[] = [];
        try {
          labels = await discoverLabels(artifactManager, artifact.id);
        } catch {
          // best-effort
        }
        return { artifact: full, labels };
      }),
    ),
  );

  return details.map(({ artifact, labels }) => ({
    artifact_id: artifact.id,
    name: artifact.manifest?.name ?? artifact.id,
    description: artifact.manifest?.description ?? '',
    labels,
  }));
}

export async function listImages(artifactManager: any, artifactId: string): Promise<DatasetImage[]> {
  const entries = await listFilesSafe(artifactManager, artifactId, 'images');
  return entries
    .filter((entry) => !isDirectoryEntry(entry))
    .map((entry) => entryName(entry))
    .filter(Boolean)
    .map((name) => ({ stem: name.replace(/\.[^./]+$/, ''), name }));
}

/**
 * Label discovery lives entirely in `label_*` top-level directories; the
 * artifact manifest is never read or written for labels (colab-rework-plan.md
 * §11 item 7). Each folder's description comes from its own
 * `label_<label>/metadata.json`, written by the broker's `create_label`. A
 * folder without metadata (created out-of-band) still surfaces, with an
 * empty description.
 */
export async function discoverLabels(
  artifactManager: any,
  artifactId: string,
): Promise<DatasetLabelRef[]> {
  const rootEntries = await listFilesSafe(artifactManager, artifactId, '');
  const labelNames = rootEntries
    .filter(isDirectoryEntry)
    .map(entryName)
    .filter((name) => name.startsWith('label_'))
    .map((name) => name.slice('label_'.length))
    .filter(Boolean);

  const limit = pLimit(4);
  return Promise.all(
    labelNames.map((label) =>
      limit(async (): Promise<DatasetLabelRef> => {
        try {
          const url = await withStageRetry(() =>
            artifactManager.get_file({
              artifact_id: artifactId,
              file_path: `${labelFolder(label)}/metadata.json`,
              stage: true,
              _rkwargs: true,
            }),
          );
          const response = await fetch(url);
          if (response.ok) {
            const meta = await response.json();
            return { name: label, description: meta?.description ?? '' };
          }
        } catch {
          // metadata.json may not exist yet (label folder created out-of-band)
        }
        return { name: label, description: '' };
      }),
    ),
  );
}

/**
 * All `(user, stem)` pairs annotated for *label*, across every user folder,
 * keeping only each user's latest (lexicographically greatest, i.e. most
 * recent) timestamp per stem — mirrors broker_core.py's
 * `latest_pairs_by_stem`, applied per user directory then unioned.
 */
async function walkLatestPairsByUser(
  artifactManager: any,
  artifactId: string,
  label: string,
): Promise<Map<string, Map<string, { timestamp: string; pngPath: string; geojsonPath: string }>>> {
  const folder = labelFolder(label);
  const userDirs = (await listFilesSafe(artifactManager, artifactId, folder)).filter(isDirectoryEntry);

  const result = new Map<string, Map<string, { timestamp: string; pngPath: string; geojsonPath: string }>>();

  const limit = pLimit(4);
  await Promise.all(
    userDirs.map((dirEntry) =>
      limit(async () => {
        const userFolder = entryName(dirEntry);
        if (!userFolder.startsWith('user-')) return;
        const dirPath = `${folder}/${userFolder}`;
        const files = await listFilesSafe(artifactManager, artifactId, dirPath);

        const byStemTs = new Map<string, Map<string, { png?: string; geojson?: string }>>();
        for (const file of files) {
          const parsed = parseAnnotationFilename(entryName(file));
          if (!parsed) continue;
          const tsMap = byStemTs.get(parsed.stem) ?? new Map();
          const pair = tsMap.get(parsed.timestamp) ?? {};
          pair[parsed.ext] = entryName(file);
          tsMap.set(parsed.timestamp, pair);
          byStemTs.set(parsed.stem, tsMap);
        }

        const stemMap = new Map<string, { timestamp: string; pngPath: string; geojsonPath: string }>();
        for (const [stem, tsMap] of byStemTs) {
          const complete = Array.from(tsMap.entries()).filter(([, files]) => files.png && files.geojson);
          if (complete.length === 0) continue;
          complete.sort(([a], [b]) => (a < b ? 1 : a > b ? -1 : 0));
          const [timestamp, pair] = complete[0];
          stemMap.set(stem, {
            timestamp,
            pngPath: `${dirPath}/${pair.png}`,
            geojsonPath: `${dirPath}/${pair.geojson}`,
          });
        }
        if (stemMap.size > 0) result.set(userFolder, stemMap);
      }),
    ),
  );

  return result;
}

/** Stems with at least one complete annotation pair, by any user, for *label*. */
export async function getAnnotatedStems(
  artifactManager: any,
  artifactId: string,
  label: string,
): Promise<Set<string>> {
  const byUser = await walkLatestPairsByUser(artifactManager, artifactId, label);
  const stems = new Set<string>();
  for (const stemMap of byUser.values()) {
    for (const stem of stemMap.keys()) stems.add(stem);
  }
  return stems;
}

export interface TrainingPair {
  image: string;
  annotation: string;
  userFolder: string;
  stem: string;
}

/**
 * Explicit `(image, annotation)` training pairs for *label*: the latest
 * saved annotation per `(user, stem)`, across every annotator.
 * cellpose-finetuning's glob-based `train_annotations` has no notion of
 * "latest" — under the timestamped never-overwrite layout a glob over
 * `label_<label>/*​/*.geojson` matches every historical save, not just the
 * current one, which would feed stale/duplicate masks into training. So
 * training data is built from this explicit list (uploaded as a metadata
 * manifest and passed via `start_training`'s `metadata_dir`) instead of
 * glob patterns — see colab-rework-plan.md F6.
 */
export async function getTrainingPairs(
  artifactManager: any,
  artifactId: string,
  label: string,
): Promise<TrainingPair[]> {
  const [byUser, images] = await Promise.all([
    walkLatestPairsByUser(artifactManager, artifactId, label),
    listImages(artifactManager, artifactId),
  ]);
  const imageNameByStem = new Map(images.map((img) => [img.stem, img.name]));

  const pairs: TrainingPair[] = [];
  for (const [userFolder, stemMap] of byUser) {
    for (const [stem, entry] of stemMap) {
      const imageName = imageNameByStem.get(stem);
      if (!imageName) continue; // source image was deleted after the annotation was saved
      pairs.push({
        image: `images/${imageName}`,
        annotation: entry.geojsonPath,
        userFolder,
        stem,
      });
    }
  }
  return pairs;
}

/**
 * Every complete annotation pair for one image stem, across every user
 * folder AND every saved timestamp, newest first — feeds the dataset
 * overview's annotation browser (prev/next through who annotated what and
 * when). Unlike `walkLatestPairsByUser`, this does not collapse to one pair
 * per user: a user who saved the same image 3 times shows up as 3 entries
 * (colab-rework-plan.md §19b item 2 — browse must step through ALL pairs,
 * not just each user's latest).
 */
export async function listAnnotationPairs(
  artifactManager: any,
  artifactId: string,
  label: string,
  stem: string,
): Promise<AnnotationPair[]> {
  const folder = labelFolder(label);
  const userDirs = (await listFilesSafe(artifactManager, artifactId, folder)).filter(isDirectoryEntry);

  const pairs: AnnotationPair[] = [];
  const limit = pLimit(4);
  await Promise.all(
    userDirs.map((dirEntry) =>
      limit(async () => {
        const userFolder = entryName(dirEntry);
        if (!userFolder.startsWith('user-')) return;
        const dirPath = `${folder}/${userFolder}`;
        const files = await listFilesSafe(artifactManager, artifactId, dirPath);

        const tsMap = new Map<string, { png?: string; geojson?: string }>();
        for (const file of files) {
          const parsed = parseAnnotationFilename(entryName(file));
          if (!parsed || parsed.stem !== stem) continue;
          const pair = tsMap.get(parsed.timestamp) ?? {};
          pair[parsed.ext] = entryName(file);
          tsMap.set(parsed.timestamp, pair);
        }
        for (const [timestamp, pair] of tsMap) {
          if (pair.png && pair.geojson) {
            pairs.push({
              userFolder,
              stem,
              timestamp,
              pngPath: `${dirPath}/${pair.png}`,
              geojsonPath: `${dirPath}/${pair.geojson}`,
            });
          }
        }
      }),
    ),
  );

  pairs.sort((a, b) => (a.timestamp < b.timestamp ? 1 : a.timestamp > b.timestamp ? -1 : 0));
  return pairs;
}

const labelUsersCache = new Map<string, Record<string, LabelUserRef>>();

/** Fetch (and cache) `label_<label>/users.json`: sanitized user folder -> `{id, email}`. */
export async function getLabelUsers(
  artifactManager: any,
  artifactId: string,
  label: string,
  force = false,
): Promise<Record<string, LabelUserRef>> {
  const cacheKey = `${artifactId}::${label}`;
  if (!force && labelUsersCache.has(cacheKey)) {
    return labelUsersCache.get(cacheKey)!;
  }

  let users: Record<string, LabelUserRef> = {};
  try {
    const url = await withStageRetry(() =>
      artifactManager.get_file({
        artifact_id: artifactId,
        file_path: `${labelFolder(label)}/users.json`,
        stage: true,
        _rkwargs: true,
      }),
    );
    const response = await fetch(url);
    if (response.ok) {
      users = await response.json();
    }
  } catch {
    // users.json may not exist yet — no annotations saved for this label.
  }

  labelUsersCache.set(cacheKey, users);
  return users;
}

export interface LabelTotals {
  /** Every complete png+geojson pair, across all users and all timestamps
   *  (never deduped to "latest per user" like getAnnotatedStems). */
  totalAnnotations: number;
  /** Stems with at least one complete pair, from any user, at any timestamp. */
  annotatedStems: Set<string>;
  /** Per-stem count of complete png+geojson pairs, across all users and all
   *  timestamps (i.e. totalAnnotations broken down by image). This is a file
   *  count, not a mask-instance count: one saved annotation, however many
   *  masks it contains, is one file pair. */
  perStemCounts: Record<string, number>;
}

/**
 * Full annotation history for *label*, unlike getAnnotatedStems, which only
 * looks at each user's latest save per stem. Walks every
 * `label_<label>/user-*` directory and counts every (stem, timestamp) with
 * both a `.png` and a `.geojson`, so 50 images saved 8 times each by one
 * user reports totalAnnotations=400 (colab-rework-plan.md §13 item 5).
 */
export async function getLabelTotals(
  artifactManager: any,
  artifactId: string,
  label: string,
): Promise<LabelTotals> {
  const folder = labelFolder(label);
  const userDirs = (await listFilesSafe(artifactManager, artifactId, folder)).filter(isDirectoryEntry);

  let totalAnnotations = 0;
  const annotatedStems = new Set<string>();
  const perStemCounts: Record<string, number> = {};

  const limit = pLimit(4);
  await Promise.all(
    userDirs.map((dirEntry) =>
      limit(async () => {
        const userFolder = entryName(dirEntry);
        if (!userFolder.startsWith('user-')) return;
        const dirPath = `${folder}/${userFolder}`;
        const files = await listFilesSafe(artifactManager, artifactId, dirPath);

        const byStemTs = new Map<string, Map<string, { png?: string; geojson?: string }>>();
        for (const file of files) {
          const parsed = parseAnnotationFilename(entryName(file));
          if (!parsed) continue;
          const tsMap = byStemTs.get(parsed.stem) ?? new Map();
          const pair = tsMap.get(parsed.timestamp) ?? {};
          pair[parsed.ext] = entryName(file);
          tsMap.set(parsed.timestamp, pair);
          byStemTs.set(parsed.stem, tsMap);
        }

        for (const [stem, tsMap] of byStemTs) {
          for (const pair of tsMap.values()) {
            if (pair.png && pair.geojson) {
              totalAnnotations += 1;
              annotatedStems.add(stem);
              perStemCounts[stem] = (perStemCounts[stem] ?? 0) + 1;
            }
          }
        }
      }),
    ),
  );

  return { totalAnnotations, annotatedStems, perStemCounts };
}

/**
 * Remove every trace of an image: `images/{stem}.png`, every
 * annotation pair under each `label_<name>/user-<id>` folder, and
 * `embeddings/{stem}_<model>.npz`. Best-effort per file so one
 * missing/already-removed entry does not abort the rest.
 */
export async function deleteImageEverywhere(
  artifactManager: any,
  artifactId: string,
  stem: string,
): Promise<void> {
  const removeFile = async (filePath: string) => {
    try {
      await withStageRetry(() =>
        artifactManager.remove_file({ artifact_id: artifactId, file_path: filePath, _rkwargs: true }),
      );
    } catch {
      // best-effort
    }
  };

  const images = await listImages(artifactManager, artifactId);
  const imageEntry = images.find((image) => image.stem === stem);
  if (imageEntry) {
    await removeFile(`images/${imageEntry.name}`);
  }

  const embeddingEntries = await listFilesSafe(artifactManager, artifactId, 'embeddings');
  for (const entry of embeddingEntries) {
    const name = entryName(entry);
    if (name.startsWith(`${stem}_`) && name.endsWith('.npz')) {
      await removeFile(`embeddings/${name}`);
    }
  }

  const labels = await discoverLabels(artifactManager, artifactId);
  for (const label of labels) {
    const folder = labelFolder(label.name);
    const userDirs = (await listFilesSafe(artifactManager, artifactId, folder)).filter(isDirectoryEntry);
    for (const dirEntry of userDirs) {
      const userFolder = entryName(dirEntry);
      const dirPath = `${folder}/${userFolder}`;
      const files = await listFilesSafe(artifactManager, artifactId, dirPath);
      for (const file of files) {
        const name = entryName(file);
        const parsed = parseAnnotationFilename(name);
        if (parsed && parsed.stem === stem) {
          await removeFile(`${dirPath}/${name}`);
        }
      }
    }
  }
}
