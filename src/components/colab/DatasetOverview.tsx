import React, { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useSharedKernel } from './KernelContext';
import { ImagePreview } from './ImagePreview';
import {
  AnnotationPair,
  DatasetImage,
  DatasetLabelRef,
  LabelUserRef,
  deleteImageEverywhere,
  discoverLabels,
  getAnnotatedStems,
  getLabelStats,
  getLabelUsers,
  listAnnotationPairs,
  listImages,
  pLimit,
  withStageRetry,
} from './datasetApi';
import { BrokerRole, DatasetWithRole, getDataset } from './brokerApi';
import LabelManager from './LabelManager';
import LabelStatsChart from './LabelStatsChart';
import SharingPanel from './SharingPanel';
import LabelSelectDialog from './LabelSelectDialog';
import TrainingModal from './TrainingModal';
import ShareModal from './ShareModal';
import DeleteArtifactModal from './DeleteArtifactModal';

export interface DatasetOverviewProps {
  artifactId: string;
  server: any;
  user: any;
  artifactManager: any;
}

// Shared by the action-bar "Annotate" button and LabelManager's inline
// per-row action (colab-rework-plan.md F4a's provisional owner/manager
// entry point) so relocating where annotation starts stays a one-line
// change, per the plan's explicit note that this entry point is provisional.
const buildAnnotateQuery = (artifactId: string, label: string, cellposeModel?: string) => {
  const params = new URLSearchParams({ session_id: artifactId, label });
  if (cellposeModel) params.set('cellpose_model', cellposeModel);
  return params.toString();
};

const navigateToAnnotate = (
  navigate: ReturnType<typeof useNavigate>,
  artifactId: string,
  label: string,
  cellposeModel?: string,
) => {
  navigate(`/colab/annotate?${buildAnnotateQuery(artifactId, label, cellposeModel)}`);
};

const modelStorageKey = (artifactId: string, label: string) => `colab_cellpose_model:${artifactId}:${label}`;

const formatTimestamp = (ts: string): string => {
  const m = /^(\d{4})(\d{2})(\d{2})-(\d{2})(\d{2})(\d{2})$/.exec(ts);
  if (!m) return ts;
  return `${m[1]}-${m[2]}-${m[3]} ${m[4]}:${m[5]}:${m[6]}`;
};

const Spinner: React.FC<{ className?: string }> = ({ className = 'w-8 h-8 text-purple-600' }) => (
  <svg className={`animate-spin ${className}`} fill="none" viewBox="0 0 24 24">
    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
    <path
      className="opacity-75"
      fill="currentColor"
      d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
    />
  </svg>
);

// F4 (colab-rework-plan.md): the owner/manager dataset overview at
// `/colab/<id>`. Guarded by the broker's role check (annotators/public
// visitors who reach this route directly get a friendly denial card with a
// link into LabelSelectDialog instead of the overview). Images and labels
// are read directly through the artifact-manager (datasetApi.ts) since an
// owner/manager already holds `*`/`rw+` ACL; role, sharing, and label
// creation go through the broker (brokerApi.ts), which is the source of
// truth for those.
const DatasetOverview: React.FC<DatasetOverviewProps> = ({ artifactId, server, user, artifactManager }) => {
  const navigate = useNavigate();
  const { executeCode, mountDirectory, requestKernel } = useSharedKernel();

  const [dataset, setDataset] = useState<DatasetWithRole | null>(null);
  const [guardError, setGuardError] = useState<string | null>(null);
  const [refreshTick, setRefreshTick] = useState(0);
  const handleRefresh = () => setRefreshTick((t) => t + 1);

  const [images, setImages] = useState<DatasetImage[] | null>(null);
  const [selectedStem, setSelectedStem] = useState<string | null>(null);

  const [labels, setLabels] = useState<DatasetLabelRef[] | null>(null);
  const [selectedLabel, setSelectedLabel] = useState('');
  const [labelCounts, setLabelCounts] = useState<Record<string, number>>({});
  const [annotatedStems, setAnnotatedStems] = useState<Set<string>>(new Set());
  const [labelStats, setLabelStats] = useState<Record<string, number>>({});

  const [imageUrl, setImageUrl] = useState('');
  const [pairs, setPairs] = useState<AnnotationPair[]>([]);
  const [browserOpen, setBrowserOpen] = useState(false);
  const [browserIndex, setBrowserIndex] = useState(0);
  const [labelUsers, setLabelUsers] = useState<Record<string, LabelUserRef>>({});
  const [annotationUrl, setAnnotationUrl] = useState('');

  const [showAnnotateDialog, setShowAnnotateDialog] = useState(false);
  const [showTrainingModal, setShowTrainingModal] = useState(false);
  const [showShareModal, setShowShareModal] = useState(false);
  const [showDeleteDatasetModal, setShowDeleteDatasetModal] = useState(false);
  const [deleteLabelTarget, setDeleteLabelTarget] = useState<string | null>(null);
  const [cellposeModel, setCellposeModel] = useState('cpsam');
  const [uploadProgress, setUploadProgress] = useState<{ current: number; total: number } | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Restore the last-used model whenever the selected label changes, so
  // switching labels keeps its own model choice (models are fine-tuned
  // per label, not per dataset).
  useEffect(() => {
    if (!selectedLabel) return;
    const stored = localStorage.getItem(modelStorageKey(artifactId, selectedLabel));
    setCellposeModel(stored || 'cpsam');
  }, [artifactId, selectedLabel]);

  const handleCellposeModelChange = (model: string) => {
    setCellposeModel(model);
    if (selectedLabel) {
      localStorage.setItem(modelStorageKey(artifactId, selectedLabel), model);
    }
  };

  // --- Role guard ---
  useEffect(() => {
    if (!server || !user) return;
    let active = true;
    (async () => {
      try {
        const d = await getDataset(server, artifactId);
        if (active) {
          setDataset(d);
          setGuardError(null);
        }
      } catch (err) {
        if (active) setGuardError((err as Error).message || 'Access denied.');
      }
    })();
    return () => {
      active = false;
    };
  }, [server, user, artifactId, refreshTick]);

  const role: BrokerRole | undefined = dataset?.role;
  const canManage = role === 'owner' || role === 'manager';

  // --- Images ---
  useEffect(() => {
    if (!canManage) return;
    let active = true;
    (async () => {
      try {
        const imgs = await listImages(artifactManager, artifactId);
        if (!active) return;
        setImages(imgs);
        setSelectedStem((prev) => (prev && imgs.some((i) => i.stem === prev) ? prev : imgs[0]?.stem ?? null));
      } catch (err) {
        if (active) setError((err as Error).message || 'Failed to load images.');
      }
    })();
    return () => {
      active = false;
    };
  }, [artifactManager, artifactId, canManage, refreshTick]);

  // --- Labels + per-label annotated counts ---
  const reloadLabels = useCallback(async () => {
    try {
      const found = await discoverLabels(artifactManager, artifactId);
      setLabels(found);
      setSelectedLabel((prev) => (prev && found.some((l) => l.name === prev) ? prev : found[0]?.name ?? ''));

      const limit = pLimit(4);
      await Promise.all(
        found.map((l) =>
          limit(async () => {
            try {
              const stems = await getAnnotatedStems(artifactManager, artifactId, l.name);
              setLabelCounts((prev) => ({ ...prev, [l.name]: stems.size }));
            } catch {
              // best-effort count
            }
          }),
        ),
      );
    } catch (err) {
      setError((err as Error).message || 'Failed to load labels.');
    }
  }, [artifactManager, artifactId]);

  useEffect(() => {
    if (!canManage) return;
    reloadLabels();
  }, [canManage, refreshTick, reloadLabels]);

  // --- Annotated stems + stats for the selected label ---
  useEffect(() => {
    if (!canManage || !selectedLabel) {
      setAnnotatedStems(new Set());
      setLabelStats({});
      return;
    }
    let active = true;
    (async () => {
      try {
        const [stems, stats] = await Promise.all([
          getAnnotatedStems(artifactManager, artifactId, selectedLabel),
          getLabelStats(artifactManager, artifactId, selectedLabel),
        ]);
        if (active) {
          setAnnotatedStems(stems);
          setLabelStats(stats);
        }
      } catch {
        // best-effort
      }
    })();
    return () => {
      active = false;
    };
  }, [artifactManager, artifactId, selectedLabel, canManage, refreshTick]);

  // --- Annotation pairs for the selected image + label, newest first ---
  useEffect(() => {
    if (!canManage || !selectedStem || !selectedLabel) {
      setPairs([]);
      setBrowserIndex(0);
      return;
    }
    let active = true;
    (async () => {
      try {
        const [found, users] = await Promise.all([
          listAnnotationPairs(artifactManager, artifactId, selectedLabel, selectedStem),
          getLabelUsers(artifactManager, artifactId, selectedLabel),
        ]);
        if (!active) return;
        setPairs(found);
        setBrowserIndex(0);
        setLabelUsers(users);
      } catch {
        if (active) setPairs([]);
      }
    })();
    return () => {
      active = false;
    };
  }, [artifactManager, artifactId, selectedStem, selectedLabel, canManage, refreshTick]);

  // --- Raw image URL for the selected image ---
  useEffect(() => {
    if (!canManage || !selectedStem || !images) {
      setImageUrl('');
      return;
    }
    const image = images.find((i) => i.stem === selectedStem);
    if (!image) {
      setImageUrl('');
      return;
    }
    let active = true;
    (async () => {
      try {
        const url = await withStageRetry(() =>
          artifactManager.get_file({
            artifact_id: artifactId,
            file_path: `images/${image.name}`,
            stage: true,
            _rkwargs: true,
          }),
        );
        if (active) setImageUrl(url);
      } catch {
        if (active) setImageUrl('');
      }
    })();
    return () => {
      active = false;
    };
  }, [artifactManager, artifactId, selectedStem, images, canManage]);

  // --- Mask URL for the currently browsed annotation pair (newest by default) ---
  const currentPair = pairs[browserIndex] ?? null;
  useEffect(() => {
    if (!currentPair) {
      setAnnotationUrl('');
      return;
    }
    let active = true;
    (async () => {
      try {
        const url = await withStageRetry(() =>
          artifactManager.get_file({
            artifact_id: artifactId,
            file_path: currentPair.pngPath,
            stage: true,
            _rkwargs: true,
          }),
        );
        if (active) setAnnotationUrl(url);
      } catch {
        if (active) setAnnotationUrl('');
      }
    })();
    return () => {
      active = false;
    };
  }, [artifactManager, artifactId, currentPair]);

  const handleDeleteImage = async () => {
    if (!selectedStem) return;
    if (!window.confirm(`Delete image "${selectedStem}" and all of its annotations? This cannot be undone.`)) {
      return;
    }
    try {
      await deleteImageEverywhere(artifactManager, artifactId, selectedStem);
      setSelectedStem(null);
      handleRefresh();
    } catch (err) {
      setError((err as Error).message || 'Failed to delete image.');
    }
  };

  const handleUploadClick = async () => {
    requestKernel();
    let dirHandle: any;
    try {
      dirHandle = await (window as any).showDirectoryPicker();
    } catch (err) {
      if ((err as Error).name !== 'AbortError') {
        setError((err as Error).message || 'Failed to select folder.');
      }
      return;
    }

    try {
      if (!executeCode || !mountDirectory) {
        throw new Error('Python kernel is not ready. Please wait a moment and try again.');
      }

      let token = localStorage.getItem('token') || '';
      if (!token && typeof server?.generateToken === 'function') {
        token = await server.generateToken();
      }
      if (!token) throw new Error('Authentication token missing. Please log in again.');

      const runCode = async (code: string) => {
        let failed = false;
        let message = '';
        await executeCode(code, {
          onOutput: (output: any) => {
            if (output.type === 'error') {
              failed = true;
              message = output.content || output.short_content || 'Unknown Python error';
            }
          },
        });
        if (failed) throw new Error(message);
      };

      setUploadProgress({ current: 0, total: 0 });

      await runCode(`
import micropip
await micropip.install(['numpy', 'Pillow', 'hypha-rpc', 'tifffile==2024.7.24'])
print("Packages installed", end='')
`);

      const serviceCode = await (await fetch(`${process.env.PUBLIC_URL}/colab_service.py`)).text();
      await runCode(serviceCode);

      const mounted = await mountDirectory('/mnt', dirHandle);
      if (!mounted) throw new Error('Failed to mount the local folder.');

      const alias = artifactId.split('/').slice(1).join('/');
      const clientId = `colab-client-${Date.now()}`;
      const serviceId = `data-provider-${Date.now()}`;

      await runCode(`
service_info = await register_service(
    server_url=${JSON.stringify(server.config.publicBaseUrl)},
    token=${JSON.stringify(token)},
    name=${JSON.stringify(alias)},
    description="",
    artifact_alias=${JSON.stringify(alias)},
    images_path="/mnt",
    client_id=${JSON.stringify(clientId)},
    service_id=${JSON.stringify(serviceId)},
    user_id=${JSON.stringify(user?.id || '')},
    user_email=${JSON.stringify(user?.email || '')}
)
print("Service registered successfully", end='')
`);

      const fullServiceId = `${server.config.workspace}/${clientId}:${serviceId}`;
      const dataService = await server.getService(fullServiceId);
      await dataService.create_dataset();

      const localImages: Array<{ stem: string; format: string }> = await dataService.list_local_images();
      setUploadProgress({ current: 0, total: localImages.length });
      for (let i = 0; i < localImages.length; i++) {
        const image = localImages[i];
        await dataService.upload_image(`${image.stem}.${image.format}`);
        setUploadProgress({ current: i + 1, total: localImages.length });
      }

      handleRefresh();
    } catch (err) {
      setError((err as Error).message || 'Failed to upload images.');
    } finally {
      setUploadProgress(null);
    }
  };

  const downloadZipUrl = server?.config?.publicBaseUrl
    ? `${server.config.publicBaseUrl}/${artifactId.split('/')[0]}/artifacts/${artifactId
        .split('/')
        .slice(1)
        .join('/')}/create-zip-file`
    : '';

  // --- Guard states ---
  if (!server || !user) {
    return (
      <div className="flex items-center justify-center h-64">
        <Spinner />
      </div>
    );
  }

  if (guardError || (dataset && !canManage)) {
    const canAnnotate = dataset?.role === 'annotator' || dataset?.role === 'public';
    return (
      <div className="max-w-lg mx-auto text-center py-16">
        <div className="w-14 h-14 mx-auto mb-4 rounded-2xl bg-gray-100 flex items-center justify-center">
          <svg className="w-7 h-7 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={1.5}
              d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z"
            />
          </svg>
        </div>
        <h2 className="text-lg font-semibold text-gray-900 mb-1">You do not have access to this dataset overview</h2>
        <p className="text-sm text-gray-500 mb-6">Only the dataset owner and its managers can open this page.</p>
        {canAnnotate && (
          <button
            onClick={() => setShowAnnotateDialog(true)}
            className="px-5 py-2.5 bg-gradient-to-r from-purple-600 to-pink-600 text-white rounded-xl hover:from-purple-700 hover:to-pink-700 font-medium shadow-sm hover:shadow-md active:scale-[0.98] transition-all"
          >
            Annotate this dataset
          </button>
        )}
        {showAnnotateDialog && (
          <LabelSelectDialog
            artifactManager={artifactManager}
            artifactId={artifactId}
            role={dataset?.role}
            onClose={() => setShowAnnotateDialog(false)}
            onSelect={(l) => navigateToAnnotate(navigate, artifactId, l)}
          />
        )}
      </div>
    );
  }

  if (!dataset) {
    return (
      <div className="flex items-center justify-center h-64">
        <Spinner />
      </div>
    );
  }

  return (
    <div className="max-w-7xl mx-auto pb-10">
      {error && (
        <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded-lg text-sm text-red-600 flex items-center justify-between">
          {error}
          <button onClick={() => setError(null)} className="text-red-400 hover:text-red-600 ml-3 shrink-0">
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>
      )}

      {/* Action bar */}
      <div className="flex flex-wrap items-center gap-2 mb-4">
        <button
          onClick={handleUploadClick}
          disabled={!!uploadProgress}
          className="px-3.5 py-2 bg-white border border-gray-200 rounded-lg hover:border-purple-300 hover:bg-purple-50 text-sm font-medium text-gray-700 transition-colors disabled:opacity-60"
        >
          {uploadProgress
            ? `Uploading ${uploadProgress.current}/${uploadProgress.total}...`
            : 'Mount folder / Upload images'}
        </button>
        <button
          onClick={handleRefresh}
          className="px-3.5 py-2 bg-white border border-gray-200 rounded-lg hover:border-purple-300 hover:bg-purple-50 text-sm font-medium text-gray-700 transition-colors"
        >
          Refresh
        </button>
        <button
          onClick={handleDeleteImage}
          disabled={!selectedStem}
          className="px-3.5 py-2 bg-white border border-gray-200 rounded-lg hover:border-red-300 hover:bg-red-50 text-sm font-medium text-gray-700 transition-colors disabled:opacity-50"
        >
          Delete image
        </button>
        <a
          href={downloadZipUrl}
          className="px-3.5 py-2 bg-white border border-gray-200 rounded-lg hover:border-purple-300 hover:bg-purple-50 text-sm font-medium text-gray-700 transition-colors"
        >
          Download ZIP
        </a>
        <button
          onClick={() => setShowAnnotateDialog(true)}
          className="px-3.5 py-2 bg-purple-50 text-purple-700 rounded-lg hover:bg-purple-100 text-sm font-medium transition-colors"
        >
          Annotate
        </button>
        <button
          onClick={() => setShowTrainingModal(true)}
          disabled={!selectedLabel}
          className="px-3.5 py-2 bg-gradient-to-r from-blue-500 to-indigo-600 text-white rounded-lg hover:from-blue-600 hover:to-indigo-700 text-sm font-medium shadow-sm transition-all disabled:opacity-50"
        >
          Train
        </button>
        <button
          onClick={() => setShowShareModal(true)}
          disabled={!selectedLabel}
          className="px-3.5 py-2 bg-white border border-gray-200 rounded-lg hover:border-purple-300 hover:bg-purple-50 text-sm font-medium text-gray-700 transition-colors disabled:opacity-50"
        >
          Share
        </button>
        {role === 'owner' && (
          <button
            onClick={() => setShowDeleteDatasetModal(true)}
            className="ml-auto px-3.5 py-2 bg-white border border-gray-200 rounded-lg hover:border-red-300 hover:bg-red-50 text-sm font-medium text-red-600 transition-colors"
          >
            Delete dataset
          </button>
        )}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-[260px_1fr_320px] gap-4">
        {/* Left: image list */}
        <div className="bg-white rounded-2xl border border-gray-200 overflow-hidden flex flex-col max-h-[70vh]">
          <div className="px-4 py-3 border-b border-gray-100">
            <h3 className="text-sm font-semibold text-gray-900">Images</h3>
            <p className="text-xs text-gray-400">{images?.length ?? 0} total</p>
          </div>
          <div className="overflow-y-auto divide-y divide-gray-100 flex-1">
            {images === null ? (
              <div className="flex items-center justify-center py-8">
                <Spinner className="w-6 h-6 text-purple-600" />
              </div>
            ) : images.length === 0 ? (
              <p className="text-sm text-gray-400 text-center py-8 px-4">No images yet. Upload some to get started.</p>
            ) : (
              images.map((image) => (
                <button
                  key={image.stem}
                  onClick={() => setSelectedStem(image.stem)}
                  className={`w-full text-left px-4 py-2.5 flex items-center justify-between gap-2 transition-colors ${
                    selectedStem === image.stem
                      ? 'bg-purple-50 border-l-2 border-purple-500'
                      : 'hover:bg-gray-50 border-l-2 border-transparent'
                  }`}
                >
                  <span className="text-sm text-gray-700 truncate">{image.stem}</span>
                  {annotatedStems.has(image.stem) && (
                    <svg className="w-4 h-4 text-emerald-500 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                    </svg>
                  )}
                </button>
              ))
            )}
          </div>
        </div>

        {/* Center: preview + annotation browser */}
        <div className="bg-white rounded-2xl border border-gray-200 p-4 flex flex-col">
          <div className="flex-1 min-h-[360px] flex items-center justify-center bg-gray-50 rounded-xl overflow-hidden">
            {selectedStem ? (
              <ImagePreview
                viewMode={browserOpen ? 'annotated' : 'raw'}
                imageUrl={imageUrl}
                annotationUrl={annotationUrl}
                hasAnnotation={!!currentPair}
                alt={selectedStem}
              />
            ) : (
              <p className="text-sm text-gray-400">Select an image to preview it.</p>
            )}
          </div>

          {selectedStem && selectedLabel && (
            <div className="mt-3 border-t border-gray-100 pt-3">
              <button
                onClick={() => setBrowserOpen((v) => !v)}
                disabled={pairs.length === 0}
                className="text-sm font-medium text-purple-600 hover:text-purple-700 disabled:text-gray-300 transition-colors"
              >
                {browserOpen ? 'Hide annotations' : `Browse annotations${pairs.length ? ` (${pairs.length})` : ''}`}
              </button>

              {browserOpen && currentPair && (
                <div className="mt-2 flex items-center justify-between gap-3">
                  <button
                    onClick={() => setBrowserIndex((i) => Math.max(0, i - 1))}
                    disabled={browserIndex === 0}
                    className="p-1.5 rounded-lg hover:bg-gray-100 disabled:opacity-30 transition-colors"
                  >
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
                    </svg>
                  </button>
                  <div className="text-center">
                    <p className="text-sm font-medium text-gray-800">
                      {labelUsers[currentPair.userFolder]?.email || currentPair.userFolder}
                    </p>
                    <p className="text-xs text-gray-400">
                      {formatTimestamp(currentPair.timestamp)} &middot; {browserIndex + 1} of {pairs.length}
                    </p>
                  </div>
                  <button
                    onClick={() => setBrowserIndex((i) => Math.min(pairs.length - 1, i + 1))}
                    disabled={browserIndex === pairs.length - 1}
                    className="p-1.5 rounded-lg hover:bg-gray-100 disabled:opacity-30 transition-colors"
                  >
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                    </svg>
                  </button>
                </div>
              )}
            </div>
          )}
        </div>

        {/* Right: labels, stats, sharing */}
        <div className="space-y-4 max-h-[70vh] overflow-y-auto pr-0.5">
          <LabelManager
            server={server}
            artifactId={artifactId}
            role={role as 'owner' | 'manager'}
            labels={labels ?? []}
            labelCounts={labelCounts}
            selectedLabel={selectedLabel}
            onSelectLabel={setSelectedLabel}
            onLabelsChanged={reloadLabels}
            onAnnotateLabel={(l) => navigateToAnnotate(navigate, artifactId, l, cellposeModel)}
            onDeleteLabel={(l) => setDeleteLabelTarget(l)}
          />

          {selectedLabel && (
            <LabelStatsChart totalImages={images?.length ?? 0} annotatedCount={annotatedStems.size} stats={labelStats} />
          )}

          <SharingPanel
            server={server}
            artifactId={artifactId}
            role={role as BrokerRole}
            dataset={dataset}
            onChanged={handleRefresh}
          />
        </div>
      </div>

      {showAnnotateDialog && (
        <LabelSelectDialog
          artifactManager={artifactManager}
          artifactId={artifactId}
          role={role}
          onClose={() => setShowAnnotateDialog(false)}
          onSelect={(l) => navigateToAnnotate(navigate, artifactId, l, cellposeModel)}
        />
      )}

      {showTrainingModal && selectedLabel && (
        <TrainingModal
          setShowTrainingModal={setShowTrainingModal}
          dataArtifactId={artifactId}
          label={selectedLabel}
          server={server}
          artifactManager={artifactManager}
          cellposeModel={cellposeModel}
          onCellposeModelChange={handleCellposeModelChange}
        />
      )}

      {showShareModal && selectedLabel && (
        <ShareModal
          setShowShareModal={setShowShareModal}
          label={selectedLabel}
          annotationURL={`${window.location.origin}/colab/annotate?${buildAnnotateQuery(artifactId, selectedLabel, cellposeModel)}`}
        />
      )}

      {showDeleteDatasetModal && (
        <DeleteArtifactModal
          setShowDeleteModal={setShowDeleteDatasetModal}
          dataArtifactId={artifactId}
          currentLabel={selectedLabel}
          artifactManager={artifactManager}
          server={server}
          initialMode="artifact"
          onDeleteSuccess={() => navigate('/colab')}
        />
      )}

      {deleteLabelTarget && (
        <DeleteArtifactModal
          setShowDeleteModal={() => setDeleteLabelTarget(null)}
          dataArtifactId={artifactId}
          currentLabel={deleteLabelTarget}
          artifactManager={artifactManager}
          server={server}
          initialMode="label"
          onDeleteSuccess={() => setDeleteLabelTarget(null)}
          onLabelDeleteSuccess={() => {
            setDeleteLabelTarget(null);
            reloadLabels();
          }}
        />
      )}
    </div>
  );
};

export default DatasetOverview;
