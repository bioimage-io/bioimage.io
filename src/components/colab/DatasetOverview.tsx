import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useSharedKernel } from './KernelContext';
import { ImagePreview } from './ImagePreview';
import {
  AnnotationPair,
  DatasetImage,
  DatasetLabelRef,
  LabelTotals,
  LabelUserRef,
  buildAnnotateQuery,
  deleteImageEverywhere,
  discoverLabels,
  formatDatasetDescription,
  getAnnotatedStems,
  getLabelStats,
  getLabelTotals,
  getLabelUsers,
  listAnnotationPairs,
  listImages,
  pLimit,
  toAlias,
  withStageRetry,
} from './datasetApi';
import { BrokerAccessError, BrokerErrorCode, BrokerRole, DatasetWithRole, getDataset } from './brokerApi';
import LabelManager from './LabelManager';
import AnnotationStatsView from './AnnotationStatsView';
import LabelSelectDialog from './LabelSelectDialog';
import TrainingModal from './TrainingModal';
import ShareModal from './ShareModal';
import DeleteArtifactModal from './DeleteArtifactModal';

export interface DatasetOverviewProps {
  artifactId: string;
  server: any;
  user: any;
  artifactManager: any;
  // A folder handle carried over from CreateDatasetModal via router state
  // (colab-rework-plan.md §11 item 1-2): creation never mounts or uploads
  // anything, so if the user picked a folder there, we mount it lazily here
  // instead of asking them to pick it again.
  initialFolderHandle?: any;
  // Rendered inline in the header row so the Guide button and kernel-status
  // pill sit level with the back button and dataset name instead of a
  // separate header row above (colab-rework-plan.md #14 item 7).
  kernelStatus?: 'idle' | 'busy' | 'starting' | 'error';
  onOpenGuide?: () => void;
}

interface ImageRow {
  stem: string;
  name: string;
  format?: string;
  isCloud: boolean;
}

// Shared by the action-bar "Annotate" button and LabelManager's inline
// per-row action (colab-rework-plan.md F4a's provisional owner/manager
// entry point) so relocating where annotation starts stays a one-line
// change, per the plan's explicit note that this entry point is provisional.
const navigateToAnnotate = (
  navigate: ReturnType<typeof useNavigate>,
  artifactId: string,
  label: string,
  cellposeModel?: string,
  imageStem?: string,
) => {
  navigate(`/colab/annotate?${buildAnnotateQuery(artifactId, label, cellposeModel, imageStem)}`);
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
const DatasetOverview: React.FC<DatasetOverviewProps> = ({
  artifactId,
  server,
  user,
  artifactManager,
  initialFolderHandle,
  kernelStatus,
  onOpenGuide,
}) => {
  const navigate = useNavigate();
  const { executeCode, mountDirectory, requestKernel } = useSharedKernel();

  const [dataset, setDataset] = useState<DatasetWithRole | null>(null);
  const [datasetMeta, setDatasetMeta] = useState<{ name: string; description: string } | null>(null);
  const [guardError, setGuardError] = useState<string | null>(null);
  const [guardErrorCode, setGuardErrorCode] = useState<BrokerErrorCode | null>(null);
  const [refreshTick, setRefreshTick] = useState(0);
  const handleRefresh = () => setRefreshTick((t) => t + 1);

  // Awaitable variant for ShareModal's Apply flow: fetches the dataset
  // directly and resolves only once `dataset` state actually reflects the
  // change, so the caller can hold off clearing its own pending-change state
  // until the checkbox/list would render the correct value (otherwise there's
  // a window where the stale dataset is still shown alongside a cleared
  // pending value). Also bumps refreshTick so the other refreshTick-keyed
  // effects (labels, images, stats) stay in sync.
  const refreshDatasetNow = async () => {
    const d = await getDataset(server, artifactId);
    setDataset(d);
    setGuardError(null);
    setGuardErrorCode(null);
    setRefreshTick((t) => t + 1);
  };

  const [images, setImages] = useState<DatasetImage[] | null>(null);
  const [selectedStem, setSelectedStem] = useState<string | null>(null);

  // Local-only images: mounted via the kernel but not yet uploaded to the
  // artifact (colab-rework-plan.md §11 items 1-4). dataServiceRef holds the
  // Python-side data-provider service registered by the mount, reused for
  // every subsequent per-image or bulk upload call without re-mounting.
  const dataServiceRef = useRef<any>(null);
  const autoMountedRef = useRef(false);
  const [localImages, setLocalImages] = useState<{ stem: string; format: string }[]>([]);
  const [uploadingStems, setUploadingStems] = useState<Set<string>>(new Set());
  const [mounting, setMounting] = useState(false);
  const [folderMounted, setFolderMounted] = useState(false);
  // colab-rework-plan.md §14 item 9: a folder picked before the kernel has
  // finished starting is queued here instead of erroring, and mounted
  // automatically once executeCode/mountDirectory become available.
  const pendingMountHandleRef = useRef<any>(null);
  const [waitingForKernel, setWaitingForKernel] = useState(false);

  const [labels, setLabels] = useState<DatasetLabelRef[] | null>(null);
  const [selectedLabel, setSelectedLabel] = useState('');
  const [labelTotals, setLabelTotals] = useState<Record<string, LabelTotals>>({});
  const [annotatedStems, setAnnotatedStems] = useState<Set<string>>(new Set());
  const [labelStats, setLabelStats] = useState<Record<string, number>>({});

  const [imageUrl, setImageUrl] = useState('');
  const [pairs, setPairs] = useState<AnnotationPair[]>([]);
  const [browserOpen, setBrowserOpen] = useState(false);
  const [statsViewOpen, setStatsViewOpen] = useState(false);
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
          setGuardErrorCode(null);
        }
      } catch (err) {
        if (active) {
          setGuardError((err as Error).message || 'Access denied.');
          setGuardErrorCode(err instanceof BrokerAccessError ? err.code : 'unknown');
        }
      }
    })();
    return () => {
      active = false;
    };
  }, [server, user, artifactId, refreshTick]);

  // --- Manifest name/description for the header (§13 item 1) ---
  useEffect(() => {
    if (!artifactManager) return;
    let active = true;
    (async () => {
      try {
        const artifact = await withStageRetry(() =>
          artifactManager.read({ artifact_id: artifactId, stage: true, _rkwargs: true }),
        );
        if (active) {
          setDatasetMeta({
            name: artifact.manifest?.name ?? toAlias(artifactId),
            description: artifact.manifest?.description ?? '',
          });
        }
      } catch {
        // best-effort; header falls back to the bare alias
      }
    })();
    return () => {
      active = false;
    };
  }, [artifactManager, artifactId]);

  const role: BrokerRole | undefined = dataset?.role;
  const canManage = role === 'owner' || role === 'manager';

  // --- Images ---
  const [imagesLoading, setImagesLoading] = useState(false);
  useEffect(() => {
    if (!canManage) return;
    let active = true;
    setImagesLoading(true);
    (async () => {
      try {
        const imgs = await listImages(artifactManager, artifactId);
        if (!active) return;
        setImages(imgs);
        setSelectedStem((prev) => (prev && imgs.some((i) => i.stem === prev) ? prev : imgs[0]?.stem ?? null));
      } catch (err) {
        if (active) setError((err as Error).message || 'Failed to load images.');
      } finally {
        if (active) setImagesLoading(false);
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
              const totals = await getLabelTotals(artifactManager, artifactId, l.name);
              setLabelTotals((prev) => ({ ...prev, [l.name]: totals }));
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

  // Sort by percentage-of-images-annotated desc, then total annotations desc
  // (colab-rework-plan.md §13 item 5), so the labels closest to done float
  // to the top of the Labels box.
  const totalImages = images?.length ?? 0;
  const sortedLabels = useMemo(() => {
    if (!labels) return [];
    const pct = (name: string) => {
      const t = labelTotals[name];
      return t && totalImages > 0 ? t.annotatedStems.size / totalImages : 0;
    };
    return [...labels].sort((a, b) => {
      const pctDiff = pct(b.name) - pct(a.name);
      if (pctDiff !== 0) return pctDiff;
      return (labelTotals[b.name]?.totalAnnotations ?? 0) - (labelTotals[a.name]?.totalAnnotations ?? 0);
    });
  }, [labels, labelTotals, totalImages]);

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

  // colab-rework-plan.md §11 item 2: mounting a folder never uploads
  // anything by itself, it only registers the Python data-provider service
  // (reused by uploadSingleImage/handleUploadAll below) and lists which
  // local images are not yet in the cloud `images/` folder.
  const mountLocalFolder = useCallback(
    async (dirHandle: any) => {
      if (!executeCode || !mountDirectory) {
        pendingMountHandleRef.current = dirHandle;
        setWaitingForKernel(true);
        requestKernel();
        return;
      }
      setMounting(true);
      try {
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

        const localList: Array<{ stem: string; format: string }> = await dataService.list_local_images();
        const cloudStems = new Set((images ?? []).map((i) => i.stem));
        dataServiceRef.current = dataService;
        setLocalImages(localList.filter((l) => !cloudStems.has(l.stem)));
        setFolderMounted(true);
      } catch (err) {
        setError((err as Error).message || 'Failed to mount local folder.');
      } finally {
        setMounting(false);
      }
    },
    [executeCode, mountDirectory, requestKernel, server, user, artifactId, images],
  );

  // Completes a mount that was queued in mountLocalFolder because the kernel
  // wasn't ready yet (colab-rework-plan.md §14 item 9).
  useEffect(() => {
    if (!waitingForKernel || !executeCode || !mountDirectory || !pendingMountHandleRef.current) return;
    const handle = pendingMountHandleRef.current;
    pendingMountHandleRef.current = null;
    setWaitingForKernel(false);
    mountLocalFolder(handle);
  }, [waitingForKernel, executeCode, mountDirectory, mountLocalFolder]);

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
    await mountLocalFolder(dirHandle);
  };

  // Releases this session's reference to the mounted folder (data-provider
  // service handle, not-yet-uploaded local image list) so the UI flips back
  // to "Mount local folder". The kernel keeps running, files already
  // uploaded stay in the cloud dataset; a fresh mount just re-picks a folder.
  const handleUnmount = () => {
    dataServiceRef.current = null;
    setLocalImages([]);
    setUploadingStems(new Set());
    setUploadProgress(null);
    setFolderMounted(false);
  };

  // Auto-mount the folder handed over from CreateDatasetModal, if any, so
  // the user doesn't have to pick it a second time.
  useEffect(() => {
    if (!initialFolderHandle || autoMountedRef.current || !canManage) return;
    autoMountedRef.current = true;
    requestKernel();
    mountLocalFolder(initialFolderHandle);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialFolderHandle, canManage]);

  // colab-rework-plan.md §11 item 2: per-image lazy upload, triggered either
  // by the row's own upload-outstanding icon or by selecting the row (i.e.
  // "opening" it) to preview it.
  const uploadSingleImage = useCallback(async (item: { stem: string; format: string }) => {
    if (!dataServiceRef.current) return;
    setUploadingStems((prev) => new Set(prev).add(item.stem));
    try {
      await dataServiceRef.current.upload_image(`${item.stem}.${item.format}`);
      setLocalImages((prev) => prev.filter((i) => i.stem !== item.stem));
      setImages((prev) => [...(prev ?? []), { stem: item.stem, name: `${item.stem}.png` }]);
    } catch (err) {
      setError(`Failed to upload "${item.stem}": ${(err as Error).message || 'unknown error'}`);
    } finally {
      setUploadingStems((prev) => {
        const next = new Set(prev);
        next.delete(item.stem);
        return next;
      });
    }
  }, []);

  const handleUploadAll = async () => {
    if (!dataServiceRef.current || localImages.length === 0) return;
    const items = [...localImages];
    setUploadProgress({ current: 0, total: items.length });
    for (let i = 0; i < items.length; i++) {
      await uploadSingleImage(items[i]);
      setUploadProgress({ current: i + 1, total: items.length });
    }
    setUploadProgress(null);
  };

  const handleSelectImage = (row: ImageRow) => {
    setSelectedStem(row.stem);
    if (!row.isCloud && !uploadingStems.has(row.stem)) {
      uploadSingleImage({ stem: row.stem, format: row.format! });
    }
  };

  const handleDeleteCloudImage = async (stem: string, e: React.MouseEvent) => {
    e.stopPropagation();
    if (!window.confirm(`Delete image "${stem}" and all of its annotations? This cannot be undone.`)) return;
    try {
      await deleteImageEverywhere(artifactManager, artifactId, stem);
      if (selectedStem === stem) setSelectedStem(null);
      handleRefresh();
    } catch (err) {
      setError((err as Error).message || 'Failed to delete image.');
    }
  };

  const imageRows: ImageRow[] = useMemo(() => {
    const cloudRows: ImageRow[] = (images ?? []).map((img) => ({ stem: img.stem, name: img.name, isCloud: true }));
    const localRows: ImageRow[] = localImages.map((li) => ({
      stem: li.stem,
      name: `${li.stem}.${li.format}`,
      format: li.format,
      isCloud: false,
    }));
    return [...cloudRows, ...localRows];
  }, [images, localImages]);

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
    // A real access denial (dataset && !canManage, or the broker's
    // PermissionError) reads differently from "this dataset isn't
    // registered" or a transport hiccup — those aren't about permissions at
    // all, and telling a user "you don't have access" when the dataset just
    // failed to load is misleading (colab-rework-plan.md §11 item 6).
    const isRealDenial = !guardError || guardErrorCode === 'permission-denied';
    const heading = isRealDenial
      ? 'You do not have access to this dataset overview'
      : guardErrorCode === 'not-registered'
        ? 'This dataset could not be found'
        : 'This dataset could not be loaded';
    const body = isRealDenial
      ? 'Only the dataset owner and its managers can open this page.'
      : guardErrorCode === 'not-registered'
        ? 'It may have been deleted, or the link is incorrect.'
        : 'There was a problem connecting to the annotation service. Please try again.';
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
        <h2 className="text-lg font-semibold text-gray-900 mb-1">{heading}</h2>
        <p className="text-sm text-gray-500 mb-6">{body}</p>
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

      {/* Header */}
      <div className="flex items-center justify-between mb-5 gap-4">
        <div className="flex items-center min-w-0">
          <button
            onClick={() => navigate('/colab')}
            className="flex items-center text-blue-600 hover:text-blue-800 transition-colors duration-200 mr-4 shrink-0"
            title="Back to Colab"
          >
            <svg className="w-5 h-5 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
            </svg>
            <span className="text-sm font-medium">Back</span>
          </button>
          <div className="min-w-0">
            <h1 className="text-2xl font-bold text-gray-900 truncate">
              {datasetMeta?.name ?? toAlias(artifactId)}
            </h1>
            <p className="text-sm text-gray-600 mt-0.5">{formatDatasetDescription(datasetMeta?.description)}</p>
            <p className="text-xs text-gray-400 mt-0.5">{toAlias(artifactId)}</p>
          </div>
        </div>
        {(onOpenGuide || kernelStatus) && (
          <div className="flex items-center gap-3 shrink-0">
            {onOpenGuide && (
              <button
                onClick={onOpenGuide}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full border border-purple-200 bg-white/80 text-purple-700 text-xs font-medium hover:bg-purple-50 transition-colors shadow-sm"
              >
                <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
                Guide
              </button>
            )}
            {kernelStatus && (
              <div className={`inline-flex items-center gap-2 px-3 py-1.5 rounded-full border shadow-sm transition-all ${
                kernelStatus === 'idle' ? 'bg-emerald-50 border-emerald-200' :
                kernelStatus === 'busy' ? 'bg-amber-50 border-amber-200' :
                kernelStatus === 'starting' ? 'bg-blue-50 border-blue-200' :
                'bg-red-50 border-red-200'
              }`}>
                <div className={`w-2 h-2 rounded-full ${
                  kernelStatus === 'idle' ? 'bg-emerald-500 shadow-emerald-500/50 shadow-sm' :
                  kernelStatus === 'busy' ? 'bg-amber-500 animate-pulse shadow-amber-500/50 shadow-sm' :
                  kernelStatus === 'starting' ? 'bg-blue-500 animate-pulse shadow-blue-500/50 shadow-sm' :
                  'bg-red-500 shadow-red-500/50 shadow-sm'
                }`} />
                <span className={`text-xs font-medium ${
                  kernelStatus === 'idle' ? 'text-emerald-700' :
                  kernelStatus === 'busy' ? 'text-amber-700' :
                  kernelStatus === 'starting' ? 'text-blue-700' :
                  'text-red-700'
                }`}>
                  {kernelStatus === 'idle' ? 'Ready' :
                   kernelStatus === 'busy' ? 'Busy' :
                   kernelStatus === 'starting' ? 'Starting...' :
                   'Error'}
                </span>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Action bar */}
      <div className="flex flex-wrap items-center gap-2 mb-4">
        <button
          onClick={folderMounted ? handleUnmount : handleUploadClick}
          disabled={mounting || waitingForKernel}
          className="px-3.5 py-2 bg-white border border-gray-200 rounded-lg hover:border-purple-300 hover:bg-purple-50 text-sm font-medium text-gray-700 transition-colors disabled:opacity-60"
        >
          {waitingForKernel
            ? 'Waiting for kernel...'
            : mounting
            ? 'Mounting...'
            : folderMounted
            ? 'Unmount folder'
            : 'Mount local folder'}
        </button>
        {localImages.length > 0 && (
          <button
            onClick={handleUploadAll}
            disabled={!!uploadProgress}
            className={`px-3.5 py-2 rounded-lg text-sm font-medium shadow-sm transition-all flex items-center gap-1.5 ${
              uploadProgress
                ? 'bg-gray-100 text-gray-400 cursor-not-allowed'
                : 'bg-gradient-to-r from-blue-50 to-indigo-50 text-blue-700 border border-blue-200 hover:from-blue-100 hover:to-indigo-100 hover:shadow-md active:scale-[0.98]'
            }`}
          >
            {uploadProgress ? (
              <>
                <svg className="w-3.5 h-3.5 animate-spin" fill="none" viewBox="0 0 24 24">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                  <path
                    className="opacity-75"
                    fill="currentColor"
                    d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
                  />
                </svg>
                Uploading {uploadProgress.current}/{uploadProgress.total}...
              </>
            ) : (
              <>
                <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12" />
                </svg>
                Upload all
              </>
            )}
          </button>
        )}
        {selectedLabel && (
          <button
            onClick={() => setStatsViewOpen((v) => !v)}
            className="px-3.5 py-2 bg-white border border-gray-200 rounded-lg hover:border-purple-300 hover:bg-purple-50 text-sm font-medium text-gray-700 transition-colors"
          >
            {statsViewOpen ? 'Show image preview' : 'Show annotation stats'}
          </button>
        )}
        <div className="ml-auto flex items-center gap-2">
          <button
            onClick={() => setShowShareModal(true)}
            className="relative px-3.5 py-2 bg-gradient-to-r from-purple-600 to-pink-600 text-white rounded-lg hover:from-purple-700 hover:to-pink-700 text-sm font-medium shadow-sm transition-all"
          >
            Share
            {!!dataset?.access_requests?.length && (
              <span className="absolute -top-1.5 -right-1.5 min-w-[1.15rem] h-[1.15rem] px-1 flex items-center justify-center rounded-full bg-red-500 text-white text-[10px] font-semibold shadow-sm">
                {dataset.access_requests.length}
              </span>
            )}
          </button>
          <button
            onClick={() => setShowTrainingModal(true)}
            disabled={!selectedLabel}
            className="px-3.5 py-2 bg-white border border-gray-200 rounded-lg hover:border-purple-300 hover:bg-purple-50 text-sm font-medium text-gray-700 transition-colors disabled:opacity-50"
          >
            Finetune
          </button>
          <a
            href={downloadZipUrl}
            className="px-3.5 py-2 bg-white border border-gray-200 rounded-lg hover:border-purple-300 hover:bg-purple-50 text-sm font-medium text-gray-700 transition-colors"
          >
            Download
          </a>
          {role === 'owner' && (
            <button
              onClick={() => setShowDeleteDatasetModal(true)}
              className="px-3.5 py-2 bg-white border border-gray-200 rounded-lg hover:border-red-300 hover:bg-red-50 text-sm font-medium text-gray-900 hover:text-red-600 transition-colors"
            >
              Delete
            </button>
          )}
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-[260px_1fr_320px] gap-4">
        {/* Left: image list */}
        <div className="bg-white rounded-2xl border border-gray-200 overflow-hidden flex flex-col max-h-[70vh]">
          <div className="px-4 py-3 border-b border-gray-100 flex items-center justify-between gap-2">
            <div>
              <h3 className="text-sm font-semibold text-gray-900">Images</h3>
              <p className="text-xs text-gray-400">
                {imageRows.length} total{localImages.length > 0 ? ` · ${localImages.length} pending upload` : ''}
              </p>
            </div>
            <button
              onClick={handleRefresh}
              disabled={imagesLoading}
              className={`px-3 py-1.5 text-xs font-medium rounded-lg transition-all flex items-center border shadow-sm shrink-0 ${
                imagesLoading
                  ? 'bg-gray-100 text-gray-400 border-gray-200 cursor-not-allowed'
                  : 'bg-gradient-to-r from-purple-50 to-pink-50 text-purple-700 hover:from-purple-100 hover:to-pink-100 border-purple-200 hover:shadow-md'
              }`}
              title="Refresh image list"
            >
              <svg
                className={`w-3.5 h-3.5 ${imagesLoading ? 'animate-spin' : ''}`}
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"
                />
              </svg>
            </button>
          </div>
          <div className="overflow-y-auto divide-y divide-gray-100 flex-1">
            {images === null ? (
              <div className="flex items-center justify-center py-8">
                <Spinner className="w-6 h-6 text-purple-600" />
              </div>
            ) : imageRows.length === 0 ? (
              <p className="text-sm text-gray-400 text-center py-8 px-4">No images yet. Mount a folder to get started.</p>
            ) : (
              imageRows.map((row) => (
                <div key={row.stem} className="group relative">
                  <button
                    onClick={() => handleSelectImage(row)}
                    className={`w-full text-left px-4 py-2.5 flex items-center justify-between gap-2 transition-colors ${
                      selectedStem === row.stem
                        ? 'bg-purple-50 border-l-2 border-purple-500'
                        : 'hover:bg-gray-50 border-l-2 border-transparent'
                    }`}
                  >
                    <div className="flex items-center flex-1 min-w-0 gap-2">
                      {row.isCloud ? (
                        <svg className="w-4 h-4 text-blue-500 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 15a4 4 0 004 4h9a5 5 0 10-.1-9.999 5.002 5.002 0 10-9.78 2.096A4.001 4.001 0 003 15z" />
                        </svg>
                      ) : uploadingStems.has(row.stem) ? (
                        <Spinner className="w-4 h-4 text-purple-500 shrink-0" />
                      ) : (
                        <div
                          className="shrink-0 cursor-pointer text-gray-400 hover:text-blue-500 active:scale-90 transition-all"
                          onClick={(e) => {
                            e.stopPropagation();
                            uploadSingleImage({ stem: row.stem, format: row.format! });
                          }}
                          title="Upload to the dataset"
                        >
                          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12" />
                          </svg>
                        </div>
                      )}
                      <span className="text-sm text-gray-700 truncate">{row.stem}</span>
                    </div>
                    {row.isCloud && annotatedStems.has(row.stem) && (
                      <svg
                        className={`w-4 h-4 text-emerald-500 shrink-0 transition-opacity ${
                          row.isCloud ? 'group-hover:opacity-0' : ''
                        }`}
                        fill="none"
                        stroke="currentColor"
                        viewBox="0 0 24 24"
                      >
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                      </svg>
                    )}
                  </button>
                  {row.isCloud && (
                    <button
                      onClick={(e) => handleDeleteCloudImage(row.stem, e)}
                      title="Delete image from the dataset"
                      aria-label="Delete image from the dataset"
                      className="absolute right-2 top-1/2 -translate-y-1/2 opacity-0 group-hover:opacity-100 p-1 hover:bg-red-100 rounded transition-opacity"
                    >
                      <svg className="w-4 h-4 text-red-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                      </svg>
                    </button>
                  )}
                </div>
              ))
            )}
          </div>
        </div>

        {/* Center: preview + annotation browser */}
        <div className="bg-white rounded-2xl border border-gray-200 p-4 flex flex-col max-h-[70vh] overflow-hidden">
          <div className="flex-1 min-h-[360px] flex items-center justify-center bg-gray-50 rounded-xl overflow-hidden">
            {statsViewOpen && selectedLabel ? (
              <AnnotationStatsView
                images={images ?? []}
                stats={labelStats}
                label={selectedLabel}
                highlightStem={selectedStem}
              />
            ) : selectedStem ? (
              imageRows.find((r) => r.stem === selectedStem)?.isCloud ? (
                <ImagePreview
                  viewMode={browserOpen ? 'annotated' : 'raw'}
                  imageUrl={imageUrl}
                  annotationUrl={annotationUrl}
                  hasAnnotation={!!currentPair}
                  alt={selectedStem}
                />
              ) : (
                <div className="text-center text-sm text-gray-400">
                  {uploadingStems.has(selectedStem) ? (
                    <>
                      <Spinner className="w-6 h-6 text-purple-600 mx-auto mb-2" />
                      Uploading...
                    </>
                  ) : (
                    'This image has not been uploaded yet.'
                  )}
                </div>
              )
            ) : (
              <p className="text-sm text-gray-400">Select an image to preview it.</p>
            )}
          </div>

          {selectedStem && selectedLabel && !statsViewOpen && (
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

        {/* Right: labels, stats */}
        <div className="flex flex-col gap-4 max-h-[70vh]">
          <div className="flex-1 min-h-0">
            <LabelManager
              server={server}
              artifactId={artifactId}
              role={role as 'owner' | 'manager'}
              labels={sortedLabels}
              labelTotals={labelTotals}
              totalImages={totalImages}
              selectedLabel={selectedLabel}
              onSelectLabel={setSelectedLabel}
              onLabelsChanged={reloadLabels}
              onAnnotateLabel={(l) => navigateToAnnotate(
                navigate,
                artifactId,
                l,
                cellposeModel,
                selectedStem && imageRows.find((r) => r.stem === selectedStem)?.isCloud ? selectedStem : undefined,
              )}
              onDeleteLabel={(l) => setDeleteLabelTarget(l)}
            />
          </div>
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

      {showShareModal && (
        <ShareModal
          server={server}
          artifactId={artifactId}
          role={role as BrokerRole}
          dataset={dataset}
          selectedLabel={selectedLabel}
          onSelectLabel={setSelectedLabel}
          cellposeModel={cellposeModel}
          onChanged={refreshDatasetNow}
          setShowShareModal={setShowShareModal}
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
