import React, { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { resolvePinnedTrainingService } from '../../utils/trainingServicePin';
import { buildReviewerPermissions } from '../../utils/roles';
import { FINETUNE_RESUME_CONFIG_KEY } from '../../utils/finetuneCheckpoints';
import { Spinner } from './Finetune';

export interface ExportModelDialogProps {
  open: boolean;
  onClose: () => void;
  server: any;
  artifactManager: any;
  user: any;
  datasetArtifactId: string;
  annotationLabel: string;
  session: { session_id: string; model_type?: string };
  /** Omitted when the run could not be attributed to a split, see
   * Finetune.tsx's resolveExportSplit. The export runs either way. */
  splitName?: string;
  onExported: (exportedModelId: string) => void;
}

interface AuthorRow {
  name: string;
  affiliation: string;
}

type Phase = 'form' | 'building' | 'creating' | 'pushing' | 'done' | 'error';

type ExportStatus = {
  status: 'PENDING' | 'BUILDING' | 'READY' | 'FAILED';
  progress?: number;
  message?: string;
  download_url?: string;
  size_bytes?: number;
  files?: { name: string; size: number }[];
  /**
   * The package member holding resumable weights, so a later run can start
   * from this model. Added in model-finetune 0.15.0 and absent before it, in
   * which case the draft is created without resume metadata and simply is not
   * offered as a starting checkpoint.
   */
  resume_checkpoint_file?: string;
  error?: string;
};

/**
 * micro-sam packages carry an AIS decoder and a prompt head, Cellpose packages
 * are a plain pytorch state dict. Tagging every export as micro-sam was correct
 * while that was the only backend and is not any more.
 */
const tagsForModel = (modelType?: string): string[] =>
  modelType && modelType.startsWith('cp')
    ? ['cellpose', 'instance-segmentation']
    : ['micro-sam', 'prompt-free', 'instance-segmentation'];

const findEmoji = (config: any, type: string, name: string): string => {
  const category = type === 'model' ? 'animal' : type === 'application' ? 'object' : type === 'dataset' ? 'fruit' : null;
  if (!category || !config?.id_parts?.[category]) return '🦒';
  const names = config.id_parts[category];
  const emojis = config.id_parts[`${category}_emoji`];
  const index = names.indexOf(name);
  return index >= 0 ? emojis[index] : '🦒';
};

const extractNounFromId = (id: string): string => {
  const parts = id.split('-');
  return parts[parts.length - 1];
};

const VIT_SIZE_LABELS: Record<string, string> = { t: 'ViT-T', b: 'ViT-B', l: 'ViT-L', h: 'ViT-H' };

const CELLPOSE_NAMES: Record<string, string> = {
  cpsam: 'Cellpose-SAM',
  cpdino: 'Cellpose-DINO',
  'cpdino-vitb': 'Cellpose-DINO (ViT-B)',
};

/**
 * Human-readable default title for a model fine-tuned from `modelType`, so a
 * draft never lands in the zoo carrying an underscored `model_type`-style name.
 * Both backends are covered, keyed on the same `cp` prefix `tagsForModel` uses
 * so the title and the tags can never disagree about which one a run came from.
 * An unrecognised type degrades to the bare architecture family rather than
 * echoing the raw id back at the user.
 */
const defaultModelName = (modelType?: string): string => {
  const mt = (modelType || '').trim().toLowerCase();
  if (!mt) return 'Fine-tuned model';
  if (mt.startsWith('cp')) return `Fine-tuned ${CELLPOSE_NAMES[mt] || 'Cellpose'}`;
  const size = VIT_SIZE_LABELS[mt.match(/^vit_([tblh])/)?.[1] ?? ''];
  const modality = mt.includes('_em_organelles') ? 'EM Organelles' : mt.includes('_lm') ? 'LM Generalist' : '';
  return ['Fine-tuned SAM', modality, size && `(${size})`].filter(Boolean).join(' ');
};

const ExportModelDialog: React.FC<ExportModelDialogProps> = ({
  open,
  onClose,
  server,
  artifactManager,
  user,
  datasetArtifactId,
  annotationLabel,
  session,
  splitName,
  onExported,
}) => {
  const [name, setName] = useState(() => defaultModelName(session.model_type));
  const [description, setDescription] = useState('');
  const [license, setLicense] = useState('CC-BY-4.0');
  const [authors, setAuthors] = useState<AuthorRow[]>([{ name: user?.email || '', affiliation: '' }]);

  const [phase, setPhase] = useState<Phase>('form');
  const [statusMessage, setStatusMessage] = useState('');
  const [exportStatus, setExportStatus] = useState<ExportStatus | null>(null);
  const [errorMessage, setErrorMessage] = useState('');
  const [artifactId, setArtifactId] = useState<string | null>(null);

  const abortRef = useRef<{ aborted: boolean }>({ aborted: false });

  useEffect(() => {
    return () => {
      abortRef.current.aborted = true;
    };
  }, []);

  if (!open) return null;

  const handleClose = () => {
    if (phase !== 'form' && phase !== 'done' && phase !== 'error') return;
    abortRef.current.aborted = true;
    onClose();
  };

  const runExport = async () => {
    abortRef.current = { aborted: false };
    const localAbort = abortRef.current;
    setErrorMessage('');

    try {
      setPhase('building');
      setStatusMessage('Requesting export...');
      const svc = await resolvePinnedTrainingService(server);
      const { export_id } = await svc.export_model({
        session_id: session.session_id,
        name,
        description,
        authors: authors.filter((a) => a.name.trim().length > 0),
        license,
        provenance: {
          dataset_artifact_id: datasetArtifactId,
          label: annotationLabel,
          ...(splitName ? { split_name: splitName } : {}),
          session_lineage: [session.session_id],
        },
        _rkwargs: true,
      });

      // NO ESTIMATE. This said "usually about 20 seconds" and was measured at
      // fifteen times that: a cpsam export spent about five minutes building
      // and was still staging ten minutes later. A number that wrong is worse
      // than none, because a user reads it and concludes the page has hung,
      // which is what the first measured run looked like from the outside.
      //
      // It is also set ONCE, before the poll loop, so it could not have
      // followed the work even if the number were right. The service reports
      // its own sub-phases in `status.message`, and that is what the panel
      // shows underneath now.
      setStatusMessage('Building the package. This can take several minutes for a large model.');
      let finalStatus: ExportStatus | null = null;
      while (!localAbort.aborted) {
        const status: ExportStatus = await svc.get_export_status({ export_id, _rkwargs: true });
        if (localAbort.aborted) return;
        setExportStatus(status);
        if (status.status === 'READY') {
          finalStatus = status;
          break;
        }
        if (status.status === 'FAILED') {
          throw new Error(status.error || status.message || 'Export failed while building the package.');
        }
        await new Promise((resolve) => setTimeout(resolve, 2000));
      }
      if (localAbort.aborted || !finalStatus) return;

      // The build's last sub-phase goes with the build: polling stops at
      // READY, so leaving the MESSAGE in place shows "staging package"
      // frozen under the two phases that follow, which is the same
      // stale-sub-phase defect this dialog was just fixed for, one phase
      // along.
      //
      // The message only, NOT the whole status. Clearing the status dropped
      // the done panel's Download link with it, because that link reads
      // `exportStatus.download_url`, and the live run caught an export that
      // finished with nothing to download.
      setExportStatus({ ...finalStatus, message: undefined });
      setPhase('creating');
      setStatusMessage('Creating the model artifact...');
      const collection = await artifactManager.read({ artifact_id: 'bioimage-io/bioimage.io', _rkwargs: true });
      const reviewerPermissions = buildReviewerPermissions(collection?.config, undefined);

      const manifest = {
        type: 'model',
        name,
        description,
        authors: authors.filter((a) => a.name.trim().length > 0),
        license,
        tags: tagsForModel(session.model_type),
        uploader: { email: user?.email },
      };

      // Record where the resumable weights sit inside the package, so this
      // model can later be picked as a starting checkpoint for another run.
      // The filename comes from the backend rather than a convention here, and
      // the architecture comes with it because start_training rejects a resume
      // whose model_type does not match the checkpoint. See
      // utils/finetuneCheckpoints.ts, which is the only reader of this key.
      const config: Record<string, any> = {
        publish_to: 'sandbox_zenodo',
        permissions: reviewerPermissions,
      };
      if (finalStatus.resume_checkpoint_file && session.model_type) {
        config[FINETUNE_RESUME_CONFIG_KEY] = {
          checkpoint_file: finalStatus.resume_checkpoint_file,
          model_type: session.model_type,
          session_id: session.session_id,
        };
      }

      const artifact = await artifactManager.create({
        parent_id: 'bioimage-io/bioimage.io',
        alias: '{animal_adjective}-{animal}',
        type: 'model',
        manifest,
        config,
        stage: true,
        _rkwargs: true,
        overwrite: true,
      });

      const shortId = artifact.id.split('/').pop() || '';
      const noun = extractNounFromId(shortId);
      const emoji = findEmoji(collection.config, 'model', noun);
      const updatedManifest = { ...manifest, id: shortId, id_emoji: emoji, status: 'draft' };
      await artifactManager.edit({ artifact_id: artifact.id, manifest: updatedManifest, stage: true, _rkwargs: true });
      setArtifactId(artifact.id);

      if (localAbort.aborted) return;
      setPhase('pushing');
      // The SIZE, because it is the only thing that predicts this wait and it
      // is known by now. Measured on a cpsam export: 1.07 GB of package, of
      // which model_weights.pth is 1.22 GB uncompressed. The bytes do not
      // pass through the browser (the service PUTs them to the presigned URLs
      // minted just above), but the user is still waiting on them.
      setStatusMessage(
        finalStatus.size_bytes
          ? `Uploading model files (${(finalStatus.size_bytes / 1e9).toFixed(2)} GB)...`
          : 'Uploading model files...',
      );
      const filesMap: Record<string, string> = {};
      for (const f of finalStatus.files || []) {
        const putUrl = await artifactManager.put_file({ artifact_id: artifact.id, file_path: f.name, _rkwargs: true });
        filesMap[f.name] = putUrl;
      }
      await svc.push_export({ export_id, files: filesMap, _rkwargs: true });

      if (localAbort.aborted) return;
      onExported(artifact.id);
      setPhase('done');
    } catch (err) {
      if (localAbort.aborted) return;
      setErrorMessage((err as Error).message || 'Export failed.');
      setPhase('error');
    }
  };

  return (
    <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-50" onClick={handleClose}>
      {/* A dialog ROLE, like the import dialog next door. Without it this was
          a plain overlay: a screen reader announced nothing, and nothing could
          address it as a dialog. Found by writing the end-to-end export check,
          which could locate the button that opens it and then not the thing it
          opened. */}
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="export-model-dialog-title"
        className="bg-white rounded-2xl shadow-lg max-w-lg w-full mx-4 max-h-[85vh] flex flex-col animate-scaleIn"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="p-5 border-b border-gray-200 flex items-center justify-between">
          <h2 id="export-model-dialog-title" className="text-base font-semibold text-gray-900">
            Export as model
          </h2>
          {(phase === 'form' || phase === 'done' || phase === 'error') && (
            <button onClick={handleClose} className="text-gray-400 hover:text-gray-600 transition-colors">
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          )}
        </div>

        <div className="p-5 overflow-y-auto space-y-4">
          {phase === 'form' && (
            <>
              <div className="p-3 bg-purple-50 border border-purple-200 rounded-lg text-xs text-purple-800 space-y-1">
                <p>
                  The exported model outputs the three AIS (automatic instance segmentation) maps and runs
                  prompt-free in the Model Zoo.
                </p>
                <p>Instance labels come from micro-sam's watershed postprocessing on those maps.</p>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1.5">Model name</label>
                <input
                  type="text"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="e.g. My Cell Segmentation Model"
                  className="w-full px-3.5 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-purple-500 focus:border-purple-500"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1.5">Description (optional)</label>
                <textarea
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  rows={3}
                  className="w-full px-3.5 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-purple-500 focus:border-purple-500"
                />
              </div>

              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <label className="block text-sm font-medium text-gray-700">Authors</label>
                  <button
                    type="button"
                    onClick={() => setAuthors((prev) => [...prev, { name: '', affiliation: '' }])}
                    className="px-2.5 py-1 text-xs font-medium text-purple-700 bg-purple-50 border border-purple-200 rounded-md hover:bg-purple-100 transition-colors active:scale-[0.97]"
                  >
                    Add author
                  </button>
                </div>
                {authors.map((author, index) => (
                  <div key={`author-${index}`} className="grid grid-cols-1 md:grid-cols-12 gap-2">
                    <input
                      type="text"
                      value={author.name}
                      onChange={(e) => {
                        const value = e.target.value;
                        setAuthors((prev) => prev.map((a, i) => (i === index ? { ...a, name: value } : a)));
                      }}
                      placeholder="Author name"
                      className="md:col-span-5 px-3 py-1.5 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-purple-500 focus:border-purple-500"
                    />
                    <input
                      type="text"
                      value={author.affiliation}
                      onChange={(e) => {
                        const value = e.target.value;
                        setAuthors((prev) => prev.map((a, i) => (i === index ? { ...a, affiliation: value } : a)));
                      }}
                      placeholder="Affiliation (optional)"
                      className="md:col-span-6 px-3 py-1.5 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-purple-500 focus:border-purple-500"
                    />
                    <button
                      type="button"
                      onClick={() =>
                        setAuthors((prev) => (prev.length === 1 ? [{ name: '', affiliation: '' }] : prev.filter((_, i) => i !== index)))
                      }
                      className="md:col-span-1 px-2 py-1.5 text-xs font-medium text-red-700 bg-red-50 border border-red-200 rounded-lg hover:bg-red-100 transition-colors"
                      aria-label={`Remove author ${index + 1}`}
                    >
                      Remove
                    </button>
                  </div>
                ))}
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1.5">License</label>
                <input
                  type="text"
                  value={license}
                  onChange={(e) => setLicense(e.target.value)}
                  className="w-full px-3.5 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-purple-500 focus:border-purple-500"
                />
              </div>
            </>
          )}

          {(phase === 'building' || phase === 'creating' || phase === 'pushing') && (
            <div className="flex flex-col items-center justify-center py-10 text-center">
              <Spinner className="w-8 h-8 text-purple-600 mb-4" />
              <p className="text-sm text-gray-700 font-medium">{statusMessage}</p>
              {phase === 'building' && exportStatus?.progress != null && (
                <div className="w-full max-w-xs mt-4 bg-gray-100 rounded-full h-1.5 overflow-hidden">
                  <div
                    className="h-1.5 bg-purple-600 transition-[width] duration-200 ease-out"
                    style={{ width: `${Math.min(100, Math.round(exportStatus.progress * 100))}%` }}
                  />
                </div>
              )}
              {/* In EVERY in-progress phase, not only while building. The
                  service names its own sub-phases here ("staging package"),
                  and hiding them after the build is what left the panel
                  saying one frozen sentence for ten minutes. */}
              {exportStatus?.message && (
                <p className="text-xs text-gray-400 mt-2">{exportStatus.message}</p>
              )}
              {/* Said BEFORE the loss rather than after it, because after it
                  there is nothing left to say it with.

                  THE REASON IS THIS PAGE, not the sign-in. The export id
                  lives only in this component: nothing writes it to storage
                  or to the url, so a reload unmounts the dialog and the id is
                  gone. The service carries on building, the page cannot ask
                  about it again, and the user is shown nothing at all rather
                  than a refusal.

                  An earlier version of this comment and of the sentence below
                  blamed the identity, on the reasoning that a reload arrives
                  as a different caller. MEASURED, and it is not so: only a
                  signed-in owner can reach this dialog, that token is in
                  localStorage and survives the reload, and a second
                  connection carrying it polled an export the first connection
                  had started. The export is bound to the USER, not to the
                  socket. So keeping the id across a reload WOULD be enough to
                  re-attach, which makes recovery a piece of work rather than
                  an identity problem, and it is proposed on the issue rather
                  than built here. */}
              <p className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-md px-3 py-2 mt-4 max-w-sm">
                Keep this tab open. This page does not keep track of an export across a reload, so
                reloading or closing it loses this one and you would have to start it again.
                {/* NOT "the export carries on". A review caught that as a
                    promise of something that never arrives: the service does
                    finish building the package, but it is this PAGE that
                    turns it into an artifact and uploads the files, so once
                    the page is gone nothing collects the result. A reader
                    told the export continues waits for a model that will
                    not appear.

                    KEYED OFF THE ARTIFACT, not the phase. `creating` begins
                    before `artifactManager.create` returns, so a phase test
                    announces a draft that does not exist yet. */}
                {artifactId && (
                  <>
                    {' '}
                    A draft model has already been created and will stay empty, so delete it from
                    My Artifacts before exporting again.
                  </>
                )}
              </p>
            </div>
          )}

          {phase === 'error' && (
            <div className="space-y-3">
              <div className="p-3 bg-red-50 border border-red-200 rounded-lg text-sm text-red-600">{errorMessage}</div>
              <button
                type="button"
                onClick={() => setPhase('form')}
                className="px-4 py-2 bg-white border border-gray-200 rounded-lg text-sm font-medium text-gray-700 hover:bg-gray-50 transition-colors active:scale-[0.97]"
              >
                Try again
              </button>
            </div>
          )}

          {phase === 'done' && artifactId && (
            <div className="space-y-4">
              <div className="p-3 bg-emerald-50 border border-emerald-200 rounded-lg text-sm text-emerald-700">
                Model exported and staged for review.
              </div>
              <div className="flex flex-col gap-2">
                <Link
                  to={`/edit/${encodeURIComponent(artifactId)}/stage`}
                  className="px-4 py-2 bg-purple-600 text-white rounded-lg text-sm font-medium text-center hover:bg-purple-700 transition-colors active:scale-[0.97]"
                >
                  Open artifact page
                </Link>
                <Link
                  to="/my-artifacts"
                  className="px-4 py-2 bg-white border border-gray-200 rounded-lg text-sm font-medium text-gray-700 text-center hover:bg-gray-50 transition-colors active:scale-[0.97]"
                >
                  View in My Artifacts
                </Link>
                {exportStatus?.download_url && (
                  <a
                    href={exportStatus.download_url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="px-4 py-2 bg-white border border-gray-200 rounded-lg text-sm font-medium text-gray-700 text-center hover:bg-gray-50 transition-colors active:scale-[0.97]"
                  >
                    Download package
                  </a>
                )}
                {exportStatus?.download_url && (
                  <p className="text-xs text-gray-400 text-center">(download link expires in 6 hours)</p>
                )}
              </div>
            </div>
          )}
        </div>

        <div className="p-5 border-t border-gray-200 flex items-center justify-end gap-2">
          {phase === 'form' && (
            <>
              <button
                type="button"
                onClick={handleClose}
                className="px-4 py-2 text-sm font-medium text-gray-600 hover:text-gray-800 transition-colors"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={runExport}
                disabled={name.trim().length === 0}
                className="px-4 py-2 bg-purple-600 text-white rounded-lg text-sm font-medium hover:bg-purple-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors active:scale-[0.97]"
              >
                Export as model
              </button>
            </>
          )}
          {phase === 'done' && (
            <button
              type="button"
              onClick={handleClose}
              className="px-4 py-2 bg-white border border-gray-200 rounded-lg text-sm font-medium text-gray-700 hover:bg-gray-50 transition-colors active:scale-[0.97]"
            >
              Close
            </button>
          )}
        </div>
      </div>
    </div>
  );
};

export default ExportModelDialog;
