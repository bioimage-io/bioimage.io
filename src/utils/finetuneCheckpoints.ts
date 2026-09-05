/**
 * The third place a fine-tuning run can start from: a model the user already
 * exported to bioimage.io.
 *
 * Why this exists
 * ---------------
 * The other two sources are the base weights (nothing to look up) and a prior
 * session's checkpoint on the trainer's own disk. That second one is
 * replica-local by construction: the checkpoint lives under
 * `~/.bioengine/micro_sam_sessions/<id>/` on whichever worker ran it, so it is
 * gone the moment the pod restarts or the tab pins a different replica. An
 * exported model is the durable version of the same thing. It sits in the
 * user's own artifact, survives every restart, and can be picked up from any
 * worker, because `start_training(init_checkpoint=<url>)` just downloads it.
 *
 * How the frontend knows which artifacts qualify
 * ---------------------------------------------
 * It does not guess a filename. `get_export_status` reports
 * `resume_checkpoint_file`, naming the resumable weights inside the package
 * (`vit_t_lm.pt` for micro-sam, `model_weights.pth` for Cellpose), and
 * `ExportModelDialog` records that name, together with the architecture it was
 * trained as, into the draft artifact's `config.finetune_resume`. So the
 * listing below is a filter on data the exporter wrote, not on a convention,
 * and a package layout change on the backend cannot silently break it.
 *
 * Models exported before that field existed simply do not carry the key and are
 * not offered. That is the correct outcome rather than a bug to work around:
 * without the recorded architecture there is no safe way to know which
 * `model_type` the weights can be resumed as, and `start_training` rejects a
 * mismatch.
 */
import { withStageRetry } from '../components/colab/datasetApi';

/** Where `ExportModelDialog` records the resume metadata on a draft model. */
export const FINETUNE_RESUME_CONFIG_KEY = 'finetune_resume';

/** What the exporter writes under that key. */
export interface FinetuneResumeConfig {
  /** Package member holding the resumable weights, from `get_export_status`. */
  checkpoint_file: string;
  /** The architecture the checkpoint was trained as, e.g. 'vit_t_lm'. */
  model_type: string;
  /** The fine-tuning session it came from, for provenance. */
  session_id?: string;
}

/** One exported model offered as a starting checkpoint. */
export interface ExportedCheckpoint {
  artifactId: string;
  name: string;
  modelType: string;
  checkpointFile: string;
  /** Unpublished drafts need `stage: true` on every artifact-manager call. */
  staged: boolean;
  createdAt?: number;
}

const COLLECTION = 'bioimage-io/bioimage.io';

const toCheckpoint = (artifact: any, staged: boolean): ExportedCheckpoint | null => {
  const resume: FinetuneResumeConfig | undefined = artifact?.config?.[FINETUNE_RESUME_CONFIG_KEY];
  if (!resume?.checkpoint_file || !resume?.model_type) return null;
  return {
    artifactId: artifact.id,
    name: artifact?.manifest?.name || artifact.id,
    modelType: resume.model_type,
    checkpointFile: resume.checkpoint_file,
    staged,
    createdAt: artifact?.created_at,
  };
};

/**
 * List the user's exported fine-tuned models that can be resumed from.
 *
 * Two queries, for the same reason `MyArtifacts` runs two: committed artifacts
 * are server-side indexed and can be filtered by `created_by`, staged ones are
 * not indexed at all, so a filtered staged query comes back empty and the only
 * way to find them is to fetch the collection's staged children and filter
 * here. Exports start life staged, so the second query is the one that matters.
 *
 * Never throws. A listing failure means "no durable checkpoints to offer",
 * which degrades to the other two sources rather than blocking the page.
 */
export async function listExportedCheckpoints(
  artifactManager: any,
  user: any,
): Promise<ExportedCheckpoint[]> {
  if (!artifactManager || !user) return [];

  const [committed, staged] = await Promise.all([
    artifactManager
      .list({
        parent_id: COLLECTION,
        stage: false,
        limit: 100,
        filters: { created_by: user.id },
        _rkwargs: true,
      })
      .catch(() => []),
    artifactManager
      .list({ parent_id: COLLECTION, stage: true, limit: 1000, _rkwargs: true })
      .catch(() => []),
  ]);

  const email = user?.email?.toLowerCase();
  const isMine = (a: any) =>
    a?.created_by === user.id ||
    (email && a?.manifest?.uploader?.email?.toLowerCase() === email);

  const found = new Map<string, ExportedCheckpoint>();
  // Staged first: an artifact that appears in both lists is one the user has
  // an open draft on, and the draft is the copy the checkpoint file is in.
  for (const artifact of staged || []) {
    if (!isMine(artifact)) continue;
    const entry = toCheckpoint(artifact, true);
    if (entry) found.set(entry.artifactId, entry);
  }
  for (const artifact of committed || []) {
    const entry = toCheckpoint(artifact, false);
    if (entry && !found.has(entry.artifactId)) found.set(entry.artifactId, entry);
  }

  return Array.from(found.values()).sort((a, b) => (b.createdAt ?? 0) - (a.createdAt ?? 0));
}

/**
 * Mint a URL the trainer can download the checkpoint from.
 *
 * The artifact is the user's own draft, so the file is not public. `get_file`
 * signs a time-limited URL against the caller's token, which the BioEngine
 * worker then fetches with a plain GET. That keeps the user's credentials on
 * the client: the worker only ever sees the signed URL, never a token.
 */
export async function resolveInitCheckpointUrl(
  artifactManager: any,
  checkpoint: ExportedCheckpoint,
): Promise<string> {
  const url = await withStageRetry(() =>
    artifactManager.get_file({
      artifact_id: checkpoint.artifactId,
      file_path: checkpoint.checkpointFile,
      stage: checkpoint.staged,
      _rkwargs: true,
    }),
  );
  if (!url) {
    throw new Error(`Could not resolve ${checkpoint.checkpointFile} in ${checkpoint.artifactId}.`);
  }
  return url;
}
