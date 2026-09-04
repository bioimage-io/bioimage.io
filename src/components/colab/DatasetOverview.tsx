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
  getLabelTotals,
  getLabelUsers,
  listAnnotationPairs,
  listImages,
  pLimit,
  toAlias,
  withStageRetry,
} from './datasetApi';
import {
  BrokerAccessError,
  BrokerErrorCode,
  BrokerRole,
  DatasetWithRole,
  SplitDoc,
  SplitSummary,
  createSplit,
  deleteAnnotation,
  getDataset,
  getDatasetIndex,
  getSplit,
  getTrainingUrls,
  listSplits,
  resetBrokerServiceCache,
  setSplitCheckpoint,
  splitDocToSummary,
  updateSplit,
} from './brokerApi';
import { resolvePinnedMicroSamTrainingService } from '../../utils/microSamTrainingPin';
import { useTrainingCapabilities } from '../../hooks/useTrainingCapabilities';
import { isSmallImageDims, readImageDimensions, SMALL_IMAGE_WARNING_TEXT } from '../../utils/imageSize';
import LabelManager from './LabelManager';
import FinetuneView from './FinetuneView';
import AnnotationStatsView from './AnnotationStatsView';
import LabelSelectDialog from './LabelSelectDialog';
import ShareModal from './ShareModal';
import DeleteArtifactModal from './DeleteArtifactModal';
import LoginButton, { hasSavedToken } from '../LoginButton';

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
  // Round-31 follow-up: from the broker's dataset index (annotation-broker
  // 0.8.0+), absent when unreadable/non-PNG or not indexed yet. Never treat
  // absence as "small" -- isSmallImageDims already returns false for 0/undefined.
  width?: number;
  height?: number;
}

// Shared by the action-bar "Annotate" button and LabelManager's inline
// per-row action (colab-rework-plan.md F4a's provisional owner/manager
// entry point) so relocating where annotation starts stays a one-line
// change, per the plan's explicit note that this entry point is provisional.
const navigateToAnnotate = (
  navigate: ReturnType<typeof useNavigate>,
  artifactId: string,
  label: string,
  imageStem?: string,
) => {
  navigate(`/colab/annotate?${buildAnnotateQuery(artifactId, label, imageStem)}`);
};

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

  // A state-backed callback ref (not useRef) so attaching the node itself
  // triggers the measurement effect below, instead of racing the effect
  // that fires when the description text first arrives from the fetch.
  const [descriptionNode, setDescriptionNode] = useState<HTMLParagraphElement | null>(null);
  const [descExpanded, setDescExpanded] = useState(false);
  const [descTruncated, setDescTruncated] = useState(false);

  // "Try again" on the guard-error screen (colab-rework-plan.md §14b item 2):
  // must not just re-await whatever's cached, since a stale cached service
  // handle is exactly what caused the error in the first place. Drop the
  // cache first so this always resolves a fresh handle before retrying.
  const [retryingGuard, setRetryingGuard] = useState(false);
  const retryGuardLoad = async () => {
    setRetryingGuard(true);
    resetBrokerServiceCache();
    try {
      const d = await getDataset(server, artifactId);
      setDataset(d);
      setGuardError(null);
      setGuardErrorCode(null);
    } catch (err) {
      setGuardError((err as Error).message || 'Access denied.');
      setGuardErrorCode(err instanceof BrokerAccessError ? err.code : 'unknown');
    } finally {
      setRetryingGuard(false);
    }
  };

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
  // Round-31: non-blocking count of picked local images under 256px on a
  // side, from a background dims scan of the mounted folder handle.
  const [smallImageCount, setSmallImageCount] = useState(0);
  // colab-rework-plan.md §14 item 9: a folder picked before the kernel has
  // finished starting is queued here instead of erroring, and mounted
  // automatically once executeCode/mountDirectory become available.
  const pendingMountHandleRef = useRef<any>(null);
  const [waitingForKernel, setWaitingForKernel] = useState(false);

  const [labels, setLabels] = useState<DatasetLabelRef[] | null>(null);
  const [selectedLabel, setSelectedLabel] = useState('');
  // Round 35: lets the images-loading effect below read the current label
  // without depending on it directly, so a label switch alone doesn't
  // re-trigger a full image-list refetch.
  const selectedLabelRef = useRef(selectedLabel);
  useEffect(() => {
    selectedLabelRef.current = selectedLabel;
  }, [selectedLabel]);
  const [labelTotals, setLabelTotals] = useState<Record<string, LabelTotals>>({});
  const [annotatedStems, setAnnotatedStems] = useState<Set<string>>(new Set());
  const [labelStats, setLabelStats] = useState<Record<string, number>>({});
  const [statsLoading, setStatsLoading] = useState(false);

  const [imageUrl, setImageUrl] = useState('');
  // Round 35: whether the raw-image URL fetch for the current selection is
  // in flight. The URL itself is never cleared until the new one resolves
  // (see the effect below), so this only drives an overlay spinner on top
  // of the still-visible previous image, never a blank state.
  const [imageLoading, setImageLoading] = useState(false);
  const [pairs, setPairs] = useState<AnnotationPair[]>([]);
  // Round 35: drives the "Browse annotations" button's spinner while the
  // per-image annotation-availability check is in flight.
  const [pairsLoading, setPairsLoading] = useState(false);
  // Which image the center preview shows while browsing annotations
  // (colab-rework-plan.md §19 item 7): decoupled from browserIndex so
  // clicking the displayed image can flip it back and forth for an A/B
  // comparison without changing position.
  const [previewMode, setPreviewMode] = useState<'raw' | 'annotated'>('raw');
  const [statsViewOpen, setStatsViewOpen] = useState(false);
  // Position 0 is always the raw image; 1..pairs.length step through
  // annotation files newest-first (colab-rework-plan.md §23.3). Reset to 0
  // whenever the selected image or label changes, both handled by the
  // pairs-loading effect below.
  const [browserIndex, setBrowserIndex] = useState(0);
  const [labelUsers, setLabelUsers] = useState<Record<string, LabelUserRef>>({});
  const [annotationUrl, setAnnotationUrl] = useState('');
  // Scroll targets for the left image-file list, so a progress-view row
  // click can scroll the file list to the matching image (§19 item 6,
  // mirroring AnnotationStatsView's own highlightStem scroll-into-view).
  const imageRowRefs = useRef<Record<string, HTMLDivElement | null>>({});

  const [showAnnotateDialog, setShowAnnotateDialog] = useState(false);
  const [showShareModal, setShowShareModal] = useState(false);
  const [showDeleteDatasetModal, setShowDeleteDatasetModal] = useState(false);
  const [deleteLabelTarget, setDeleteLabelTarget] = useState<string | null>(null);
  const [uploadProgress, setUploadProgress] = useState<{ current: number; total: number } | null>(null);
  const [error, setError] = useState<string | null>(null);

  // --- Finetune view (colab-rework-plan.md §23.2) ---
  // Reuses `selectedLabel` as the finetune view's active label, so the
  // existing annotatedStems effect (keyed on selectedLabel) doubles as the
  // "images with annotations for this label" filter with no new fetching.
  const [showFinetuneLabelDialog, setShowFinetuneLabelDialog] = useState(false);
  const [finetuneViewOpen, setFinetuneViewOpen] = useState(false);

  // Only offer expand/collapse when the (collapsed, single-line) description
  // actually overflows — re-measure whenever the text or view changes.
  useEffect(() => {
    if (finetuneViewOpen || descExpanded || !descriptionNode) return;
    const measure = () => setDescTruncated(descriptionNode.scrollWidth > descriptionNode.clientWidth);
    measure();
    window.addEventListener('resize', measure);
    return () => window.removeEventListener('resize', measure);
  }, [datasetMeta?.description, finetuneViewOpen, descExpanded, descriptionNode]);

  // --- Split authoring (broker v0.7.0, colab-rework-plan.md §23.1/§23.4) ---
  // Per-label, named, add-only splits. Lifted up here (rather than local to
  // FinetuneView) because the per-row assignment badges rendered by
  // renderImageRow (left panel) and the split-builder controls (right panel,
  // FinetuneView) both need to read/write the same `assignment` state.
  const [existingSplits, setExistingSplits] = useState<SplitSummary[]>([]);
  const [splitsLoading, setSplitsLoading] = useState(false);
  const [activeSplitName, setActiveSplitName] = useState<string | null>(null);
  // Full doc (train/test membership, annotation_counts, checkpoint) for
  // whichever split is active. `list_splits` only returns compact summaries
  // (no membership arrays), so this is fetched separately via `getSplit`
  // whenever `activeSplitName` changes — reading `.train`/`.test` off a
  // summary object crashes every consumer below (§23.4-era bug, fixed by
  // never letting a compact summary flow into this variable).
  const [activeSplitLoading, setActiveSplitLoading] = useState(false);
  const [newSplitName, setNewSplitName] = useState('default');
  const [trainPercent, setTrainPercent] = useState(80);
  const [assignment, setAssignment] = useState<Record<string, 'train' | 'test' | 'unused'>>({});
  const [isSavingSplit, setIsSavingSplit] = useState(false);
  const [splitSaveError, setSplitSaveError] = useState<string | null>(null);
  const [showEmptyTestWarning, setShowEmptyTestWarning] = useState(false);
  const [ftModelType, setFtModelType] = useState<string>('vit_t_lm');
  // Which base models the pinned model-finetune replica's GPU can actually
  // fit. Fetched here rather than in FinetuneView because that panel is
  // presentational and has no `server`; see utils/trainingCapabilities.ts for
  // why this must come from the same pinned replica that runs the training.
  const { capabilities: trainingCapabilities, loading: trainingCapabilitiesLoading } =
    useTrainingCapabilities(finetuneViewOpen ? server : null);
  const [ftShowAdvanced, setFtShowAdvanced] = useState(false);
  const [ftNEpochs, setFtNEpochs] = useState(5);
  const [ftNObjectsPerBatch, setFtNObjectsPerBatch] = useState(8);
  const [ftPatchSize, setFtPatchSize] = useState(512);
  const [ftBatchSize, setFtBatchSize] = useState(1);
  const [ftLearningRate, setFtLearningRate] = useState(1e-5);
  const [isStartingTraining, setIsStartingTraining] = useState(false);
  const [startTrainingError, setStartTrainingError] = useState<string | null>(null);
  // A cloud image that's a member of some split, blocking delete (§23.4
  // supersedes §20 item 4's "remove from split and delete": splits are
  // add-only now, so there's no clean removal path, only a block).
  const [blockedDeleteInfo, setBlockedDeleteInfo] = useState<{ stem: string; label: string; splitName: string } | null>(null);

  const [activeSplit, setActiveSplit] = useState<SplitDoc | null>(null);

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
  // Round 35: this is the sole trigger for the images-list refresh button's
  // spinner (both the button click and the 30s auto-poll below reuse this
  // same flag). It stays true through two sequential phases -- the file
  // list, then the per-label annotation-availability check -- so the
  // spinner covers the whole duration instead of dropping as soon as the
  // file list resolves while the availability check is still in flight.
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

        const label = selectedLabelRef.current;
        if (label) {
          setStatsLoading(true);
          try {
            const [stems, totals] = await Promise.all([
              getAnnotatedStems(artifactManager, artifactId, label),
              getLabelTotals(artifactManager, artifactId, label),
            ]);
            if (active) {
              setAnnotatedStems(stems);
              setLabelStats(totals.perStemCounts);
            }
          } finally {
            if (active) setStatsLoading(false);
          }
        }
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

  // Round-31 follow-up: per-image dims from the broker's dataset index,
  // keyed by stem, for the small-image list badge. Best-effort -- a missing
  // or failed fetch just means no row gets a badge, not an error banner.
  const [imageDims, setImageDims] = useState<Record<string, { width?: number; height?: number }>>({});
  useEffect(() => {
    if (!server || !canManage) return;
    let active = true;
    (async () => {
      try {
        const idx = await getDatasetIndex(server, artifactId);
        if (!active) return;
        const dims: Record<string, { width?: number; height?: number }> = {};
        for (const img of idx.images) {
          if (img.width !== undefined || img.height !== undefined) {
            dims[img.stem] = { width: img.width, height: img.height };
          }
        }
        setImageDims(dims);
      } catch {
        // Advisory only.
      }
    })();
    return () => {
      active = false;
    };
  }, [server, artifactId, canManage, refreshTick]);

  // --- Splits for the finetune view's active label (broker v0.7.0) ---
  const [splitsRefreshTick, setSplitsRefreshTick] = useState(0);
  useEffect(() => {
    if (!canManage || !finetuneViewOpen || !selectedLabel) {
      setExistingSplits([]);
      setActiveSplitName(null);
      return;
    }
    let active = true;
    setSplitsLoading(true);
    (async () => {
      try {
        const found = await listSplits(server, artifactId, selectedLabel);
        if (!active) return;
        setExistingSplits(found);
        setActiveSplitName((prev) => (prev && found.some((s) => s.name === prev) ? prev : found[0]?.name ?? null));
      } catch (err) {
        if (active) setSplitSaveError((err as Error).message || 'Failed to load splits.');
      } finally {
        if (active) setSplitsLoading(false);
      }
    })();
    return () => {
      active = false;
    };
  }, [server, artifactId, canManage, finetuneViewOpen, selectedLabel, splitsRefreshTick]);

  // Full doc for the active split, fetched separately from the compact
  // `existingSplits` summaries above (broker v0.7.0 `list_splits` never
  // returns `train`/`test` membership).
  useEffect(() => {
    if (!canManage || !finetuneViewOpen || !selectedLabel || !activeSplitName) {
      setActiveSplit(null);
      return;
    }
    let active = true;
    setActiveSplitLoading(true);
    (async () => {
      try {
        const doc = await getSplit(server, artifactId, selectedLabel, activeSplitName);
        if (active) setActiveSplit(doc);
      } catch (err) {
        if (active) setSplitSaveError((err as Error).message || 'Failed to load split.');
      } finally {
        if (active) setActiveSplitLoading(false);
      }
    })();
    return () => {
      active = false;
    };
  }, [server, artifactId, canManage, finetuneViewOpen, selectedLabel, activeSplitName]);

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
  // Round 35: no longer keyed on refreshTick -- a manual/auto refresh's
  // annotation-availability check is handled sequentially inside the images
  // effect above (file list first, this check second). This effect now only
  // reacts to the user actually switching labels.
  useEffect(() => {
    if (!canManage || !selectedLabel) {
      setAnnotatedStems(new Set());
      setLabelStats({});
      return;
    }
    let active = true;
    setStatsLoading(true);
    (async () => {
      try {
        const [stems, totals] = await Promise.all([
          getAnnotatedStems(artifactManager, artifactId, selectedLabel),
          getLabelTotals(artifactManager, artifactId, selectedLabel),
        ]);
        if (active) {
          setAnnotatedStems(stems);
          setLabelStats(totals.perStemCounts);
        }
      } catch {
        // best-effort
      } finally {
        if (active) setStatsLoading(false);
      }
    })();
    return () => {
      active = false;
    };
  }, [artifactManager, artifactId, selectedLabel, canManage]);

  // On label switch, the preview reverts to the raw image rather than
  // staying on the previous label's annotation overlay (§19 item 5).
  useEffect(() => {
    setPreviewMode('raw');
  }, [selectedLabel]);

  // Bidirectional scroll sync with the annotation-progress view (§19 item
  // 6): AnnotationStatsView already scrolls to `highlightStem` on its own
  // rows; this mirrors that behavior for the file list, so a progress-row
  // click (which calls setSelectedStem) scrolls the file list too, not just
  // the other way around.
  useEffect(() => {
    if (selectedStem) {
      imageRowRefs.current[selectedStem]?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    }
  }, [selectedStem]);

  // --- Local folder re-enumeration on Refresh (colab-rework-plan.md §15
  // item 4): mountLocalFolder only lists local files once at mount time, so
  // the Refresh button re-scans the already-mounted folder too, matching the
  // same cloud-stem filter used there, instead of only refetching remote
  // state.
  useEffect(() => {
    if (!dataServiceRef.current) return;
    let active = true;
    (async () => {
      try {
        const localList: Array<{ stem: string; format: string }> = await dataServiceRef.current.list_local_images();
        if (!active) return;
        const cloudStems = new Set((images ?? []).map((i) => i.stem));
        setLocalImages(localList.filter((l) => !cloudStems.has(l.stem)));
      } catch {
        // best-effort; a failed local re-scan shouldn't block the remote refresh
      }
    })();
    return () => {
      active = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [refreshTick]);

  // --- 30s periodic remote sync (colab-rework-plan.md §15 item 5): re-poll
  // images/ and the selected label folder only (not a full index refetch),
  // diffing against current state so a quiet dataset produces no re-renders.
  // This is what lets a teammate's save show up here within ~30s without a
  // manual refresh.
  useEffect(() => {
    if (!canManage || !artifactManager) return;
    const id = setInterval(async () => {
      // Round 35: the refresh button should spin through an auto-poll cycle
      // exactly like a manual refresh, file list first, then the
      // annotation-availability check, same as the images effect above.
      setImagesLoading(true);
      try {
        const imgs = await listImages(artifactManager, artifactId);
        setImages((prev) => {
          const prevKey = (prev ?? []).map((i) => i.stem).sort().join(',');
          const nextKey = imgs.map((i) => i.stem).sort().join(',');
          return prevKey === nextKey ? prev : imgs;
        });

        if (selectedLabel) {
          setStatsLoading(true);
          try {
            const [stems, totals] = await Promise.all([
              getAnnotatedStems(artifactManager, artifactId, selectedLabel),
              getLabelTotals(artifactManager, artifactId, selectedLabel),
            ]);
            setAnnotatedStems((prev) => {
              const prevKey = [...prev].sort().join(',');
              const nextKey = [...stems].sort().join(',');
              return prevKey === nextKey ? prev : stems;
            });
            setLabelStats((prev) => (JSON.stringify(prev) === JSON.stringify(totals.perStemCounts) ? prev : totals.perStemCounts));
          } finally {
            setStatsLoading(false);
          }
        }
      } catch {
        // silent -- a transient poll failure just waits for the next tick
      } finally {
        setImagesLoading(false);
      }
    }, 30_000);
    return () => clearInterval(id);
  }, [canManage, artifactManager, artifactId, selectedLabel]);

  // --- Annotation pairs for the selected image + label, newest first ---
  useEffect(() => {
    if (!canManage || !selectedStem || !selectedLabel) {
      setPairs([]);
      setBrowserIndex(0);
      setPairsLoading(false);
      return;
    }
    let active = true;
    setPairsLoading(true);
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
      } finally {
        if (active) setPairsLoading(false);
      }
    })();
    return () => {
      active = false;
    };
  }, [artifactManager, artifactId, selectedStem, selectedLabel, canManage, refreshTick]);

  // --- Raw image URL for the selected image ---
  // `imageUrl` is left holding the previous selection's URL while a new fetch
  // is in flight (only cleared on a real miss/error) purely so a fetch that
  // resolves after the user has already switched away doesn't need extra
  // bookkeeping to ignore it. Round 35b: `ImagePreview` itself never renders
  // this stale value while `imageLoading` is true, so the display always
  // shows the loading placeholder rather than the outgoing image.
  useEffect(() => {
    if (!canManage || !selectedStem || !images) {
      setImageUrl('');
      setImageLoading(false);
      return;
    }
    const image = images.find((i) => i.stem === selectedStem);
    if (!image) {
      setImageUrl('');
      setImageLoading(false);
      return;
    }
    let active = true;
    setImageLoading(true);
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
      } finally {
        if (active) setImageLoading(false);
      }
    })();
    return () => {
      active = false;
    };
  }, [artifactManager, artifactId, selectedStem, images, canManage]);

  // --- Mask URL for the currently browsed annotation pair ---
  // browserIndex 0 has no pair (it's the raw image); 1..pairs.length map to
  // pairs[0..pairs.length-1] (colab-rework-plan.md §23.3).
  const currentPair = browserIndex > 0 ? pairs[browserIndex - 1] ?? null : null;

  // The preview follows position: raw at 0, the annotation overlay
  // elsewhere. Hold-to-compare (onHoldChange below) can still flip it
  // momentarily without moving position.
  useEffect(() => {
    setPreviewMode(browserIndex === 0 ? 'raw' : 'annotated');
  }, [browserIndex]);

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

  const isOwnPair = !!(currentPair && user?.id && labelUsers[currentPair.userFolder]?.id === user.id);
  const canDeletePair = canManage || isOwnPair;

  const [isDeletingPair, setIsDeletingPair] = useState(false);

  const handleDeletePair = useCallback(async () => {
    if (!currentPair || !selectedLabel) return;
    if (!window.confirm('Delete this annotation? This cannot be undone.')) return;
    setIsDeletingPair(true);
    try {
      await deleteAnnotation(
        server,
        artifactId,
        selectedLabel,
        currentPair.userFolder,
        currentPair.stem,
        currentPair.timestamp,
      );
      handleRefresh();
    } catch (err) {
      window.alert((err as Error).message || 'Failed to delete the annotation.');
    } finally {
      setIsDeletingPair(false);
    }
  }, [server, artifactId, selectedLabel, currentPair]);

  // Round-31: dims are free client-side from a picked FileSystemDirectoryHandle
  // (no Python/Pyodide round trip needed), so this scans in the background
  // whenever a folder is mounted and just counts how many images are under
  // the 256px floor. Non-blocking by design, runs alongside mountLocalFolder
  // rather than gating it.
  const scanFolderForSmallImages = useCallback(async (dirHandle: any) => {
    let small = 0;
    try {
      for await (const entry of dirHandle.values()) {
        if (entry.kind !== 'file') continue;
        const ext = entry.name.slice(entry.name.lastIndexOf('.')).toLowerCase();
        if (!['.png', '.jpg', '.jpeg', '.tif', '.tiff'].includes(ext)) continue;
        const file = await entry.getFile();
        const dims = await readImageDimensions(file);
        if (dims && isSmallImageDims(dims.width, dims.height)) small += 1;
      }
    } catch {
      // Advisory scan only, ignore failures.
    }
    setSmallImageCount(small);
  }, []);

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
      setSmallImageCount(0);
      scanFolderForSmallImages(dirHandle);
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
    [executeCode, mountDirectory, requestKernel, server, user, artifactId, images, scanFolderForSmallImages],
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
    setSmallImageCount(0);
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

  const performDeleteCloudImage = async (stem: string) => {
    try {
      await deleteImageEverywhere(artifactManager, artifactId, stem);
      if (selectedStem === stem) setSelectedStem(null);
      handleRefresh();
    } catch (err) {
      setError((err as Error).message || 'Failed to delete image.');
    }
  };

  // §23.4 supersedes §20 item 4: splits are add-only now (broker v0.7.0), so
  // there is no clean "remove from split" path. A stem that's a member of
  // any split, for any label, simply cannot be deleted, hence a live
  // all-labels lookup instead of the old single dataset-global split state.
  const handleDeleteCloudImage = async (stem: string, e: React.MouseEvent) => {
    e.stopPropagation();
    try {
      // `listSplits` only returns compact summaries (no membership arrays),
      // so per-stem ownership has to be resolved with a follow-up `getSplit`
      // per split name.
      const summaries = await listSplits(server, artifactId);
      const docs = await Promise.all(summaries.map((s) => getSplit(server, artifactId, s.label, s.name)));
      const owner = docs.find((s) => s.train.includes(stem) || s.test.includes(stem));
      if (owner) {
        setBlockedDeleteInfo({ stem, label: owner.label, splitName: owner.name });
        return;
      }
    } catch (err) {
      setError((err as Error).message || 'Failed to check dataset splits.');
      return;
    }
    if (!window.confirm(`Delete image "${stem}" and all of its annotations? This cannot be undone.`)) return;
    await performDeleteCloudImage(stem);
  };

  const imageRows: ImageRow[] = useMemo(() => {
    const cloudRows: ImageRow[] = (images ?? []).map((img) => ({
      stem: img.stem,
      name: img.name,
      isCloud: true,
      width: imageDims[img.stem]?.width,
      height: imageDims[img.stem]?.height,
    }));
    const localRows: ImageRow[] = localImages.map((li) => ({
      stem: li.stem,
      name: `${li.stem}.${li.format}`,
      format: li.format,
      isCloud: false,
    }));
    return [...cloudRows, ...localRows];
  }, [images, localImages, imageDims]);

  const cloudImageRows = useMemo(() => imageRows.filter((r) => r.isCloud), [imageRows]);

  // Finetune view (colab-rework-plan.md §23.2): the image list is filtered
  // to cloud images with >0 annotation files for the selected label,
  // reusing the annotatedStems set already fetched for the Labels box.
  const displayedImageRows = useMemo(
    () => (finetuneViewOpen ? cloudImageRows.filter((r) => annotatedStems.has(r.stem)) : imageRows),
    [finetuneViewOpen, cloudImageRows, annotatedStems, imageRows],
  );

  // Drop the selection if it falls outside the finetune-filtered list, e.g.
  // right after entering the view with an unannotated image selected.
  useEffect(() => {
    if (!finetuneViewOpen) return;
    if (selectedStem && !displayedImageRows.some((r) => r.stem === selectedStem)) {
      setSelectedStem(null);
    }
  }, [finetuneViewOpen, displayedImageRows, selectedStem]);

  // §23.4 item 3 (revised, message HaWNeJ1HaN): the finetune-view image list
  // groups rows into Train / Test / Unused sections with headers, mirroring
  // the old dataset-global split UI's layout, rather than a flat list with
  // only a per-row badge. Locked (already-committed) split members render
  // read-only under their split's section; everything else lives under
  // Unused until `cycleAssignment` moves it, which re-sorts it into its new
  // section on the next render.
  const splitSections = useMemo(() => {
    const train: ImageRow[] = [];
    const test: ImageRow[] = [];
    const unused: ImageRow[] = [];
    for (const row of displayedImageRows) {
      const locked = activeSplit?.train.includes(row.stem)
        ? 'train'
        : activeSplit?.test.includes(row.stem)
        ? 'test'
        : null;
      const value = locked ?? assignment[row.stem] ?? 'unused';
      (value === 'train' ? train : value === 'test' ? test : unused).push(row);
    }
    return { train, test, unused };
  }, [displayedImageRows, activeSplit, assignment]);

  // Seed/reconcile the editable assignment whenever the active split or the
  // displayed row set changes: locked (already-committed) stems are never
  // stored here, they render read-only straight from `activeSplit`; every
  // other displayed stem defaults to 'unused' unless already staged.
  useEffect(() => {
    setAssignment((prev) => {
      const lockedTrain = new Set(activeSplit?.train ?? []);
      const lockedTest = new Set(activeSplit?.test ?? []);
      const next: Record<string, 'train' | 'test' | 'unused'> = {};
      for (const row of displayedImageRows) {
        if (lockedTrain.has(row.stem) || lockedTest.has(row.stem)) continue;
        next[row.stem] = prev[row.stem] ?? 'unused';
      }
      return next;
    });
  }, [activeSplit, displayedImageRows]);

  // Click-to-cycle assignment badge (§23.4 item 3, replacing the old §20
  // drag-and-drop interaction). No-op on a stem that's already a locked
  // member of the active split — add-only splits can't un-assign a member.
  const cycleAssignment = useCallback((stem: string) => {
    if (activeSplit?.train.includes(stem) || activeSplit?.test.includes(stem)) return;
    setAssignment((prev) => {
      const current = prev[stem] ?? 'unused';
      const next: 'train' | 'test' | 'unused' = current === 'unused' ? 'train' : current === 'train' ? 'test' : 'unused';
      return { ...prev, [stem]: next };
    });
  }, [activeSplit]);

  // Shuffle only the unused pool (unlocked, currently-displayed stems) into
  // train/test at `trainPercent`; locked split members are never touched.
  const autoDistribute = useCallback(() => {
    const lockedTrain = new Set(activeSplit?.train ?? []);
    const lockedTest = new Set(activeSplit?.test ?? []);
    const pool = displayedImageRows.filter((r) => !lockedTrain.has(r.stem) && !lockedTest.has(r.stem));
    const shuffled = [...pool].sort(() => Math.random() - 0.5);
    const trainCount = Math.round((shuffled.length * trainPercent) / 100);
    const next: Record<string, 'train' | 'test' | 'unused'> = {};
    shuffled.forEach((row, i) => {
      next[row.stem] = i < trainCount ? 'train' : 'test';
    });
    setAssignment(next);
  }, [activeSplit, displayedImageRows, trainPercent]);

  const handleSaveSplit = async () => {
    setIsSavingSplit(true);
    setSplitSaveError(null);
    try {
      const train = Object.entries(assignment).filter(([, v]) => v === 'train').map(([stem]) => stem);
      const test = Object.entries(assignment).filter(([, v]) => v === 'test').map(([stem]) => stem);
      let result: SplitDoc;
      if (activeSplitName === null) {
        result = await createSplit(server, artifactId, selectedLabel, newSplitName, train, test, trainPercent / 100);
        setExistingSplits((prev) => [...prev, splitDocToSummary(result)]);
        setActiveSplitName(newSplitName);
      } else {
        result = await updateSplit(server, artifactId, selectedLabel, activeSplitName, train, test);
        setExistingSplits((prev) => prev.map((s) => (s.name === result.name ? splitDocToSummary(result) : s)));
      }
      // `create_split`/`update_split` already return the full doc, so set it
      // directly rather than waiting on the `activeSplitName` fetch effect
      // (which still fires for the create case, since the name just changed).
      setActiveSplit(result);
      setAssignment({});
    } catch (err) {
      setSplitSaveError((err as Error).message || 'Failed to save the split.');
    } finally {
      setIsSavingSplit(false);
    }
  };

  const handleStartTraining = async (skipEmptyTestWarning = false) => {
    if (!activeSplitName) return;
    if (!skipEmptyTestWarning && (activeSplit?.test.length ?? 0) === 0) {
      setShowEmptyTestWarning(true);
      return;
    }
    setShowEmptyTestWarning(false);
    setIsStartingTraining(true);
    setStartTrainingError(null);
    try {
      const urls = await getTrainingUrls(server, artifactId, selectedLabel, activeSplitName);
      if (urls.train.length === 0) {
        setStartTrainingError(`Split "${activeSplitName}" has no training images yet.`);
        return;
      }
      // A checkpointed split resumes from its prior session and is locked to
      // that session's model type — the server rejects a mismatched
      // model_type, so this can't drift from what start_training was
      // actually trained with.
      const modelType = activeSplit?.checkpoint ? activeSplit.checkpoint.model_type : ftModelType;
      const params: any = {
        train_images: urls.train.map((e) => e.image_url),
        train_labels: urls.train.map((e) => e.geojson_url),
        model_type: modelType,
        n_epochs: ftNEpochs,
        n_objects_per_batch: ftNObjectsPerBatch,
        patch_size: ftPatchSize,
        batch_size: ftBatchSize,
        learning_rate: ftLearningRate,
        label: `${toAlias(artifactId)}/${selectedLabel}`,
        _rkwargs: true,
      };
      if (urls.test.length > 0) {
        params.val_images = urls.test.map((e) => e.image_url);
        params.val_labels = urls.test.map((e) => e.geojson_url);
      }
      if (activeSplit?.checkpoint) {
        params.resume_session_id = activeSplit.checkpoint.session_id;
      }
      const svc = await resolvePinnedMicroSamTrainingService(server);
      const status = await svc.start_training(params);
      const updated = await setSplitCheckpoint(server, artifactId, selectedLabel, activeSplitName, {
        session_id: status.session_id,
        model_type: modelType,
      });
      setExistingSplits((prev) => prev.map((s) => (s.name === updated.name ? splitDocToSummary(updated) : s)));
      setActiveSplit(updated);
    } catch (err) {
      setStartTrainingError((err as Error).message || 'Failed to start training.');
    } finally {
      setIsStartingTraining(false);
    }
  };

  // colab-rework-plan.md §23.4 item 3: split-assignment badge shown per row
  // while the finetune view is open, replacing the plain emerald checkmark.
  // Locked (already-committed split member) badges are read-only static
  // labels; everything else cycles unused -> train -> test -> unused on
  // click, mirroring the FinetuneView skeleton's original badge styling.
  const splitBadgeClass = (value: 'train' | 'test' | 'unused') =>
    value === 'train'
      ? 'bg-blue-100 text-blue-700'
      : value === 'test'
      ? 'bg-amber-100 text-amber-700'
      : 'bg-gray-100 text-gray-500';

  const renderFinetuneBadge = (row: ImageRow) => {
    const isLocked = activeSplit?.train.includes(row.stem) || activeSplit?.test.includes(row.stem);
    if (isLocked) {
      const value: 'train' | 'test' = activeSplit!.train.includes(row.stem) ? 'train' : 'test';
      const priorCount = activeSplit!.annotation_counts[row.stem] ?? 0;
      const currentCount = labelStats[row.stem] ?? 0;
      const newCount = currentCount - priorCount;
      return (
        <span className="flex items-center gap-1 shrink-0">
          <span className={`px-2.5 py-1 rounded-full text-xs font-medium capitalize ${splitBadgeClass(value)}`}>
            {value}
          </span>
          {newCount > 0 && (
            <span className="px-1.5 py-0.5 rounded-full text-[10px] font-medium bg-emerald-100 text-emerald-700">
              +{newCount} new
            </span>
          )}
        </span>
      );
    }
    const value = assignment[row.stem] ?? 'unused';
    return (
      <button
        onClick={(e) => {
          e.stopPropagation();
          cycleAssignment(row.stem);
        }}
        className={`px-2.5 py-1 rounded-full text-xs font-medium capitalize transition-colors shrink-0 ${splitBadgeClass(value)}`}
        title="Click to cycle: train, test, unused"
      >
        {value}
      </button>
    );
  };

  const renderImageRow = (row: ImageRow) => {
    return (
      <div
        key={row.stem}
        ref={(el) => { imageRowRefs.current[row.stem] = el; }}
        className="group relative"
      >
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
            {isSmallImageDims(row.width ?? 0, row.height ?? 0) && (
              <svg
                className="w-3.5 h-3.5 text-amber-500 shrink-0"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
                aria-hidden="true"
              >
                <title>{SMALL_IMAGE_WARNING_TEXT}</title>
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126ZM12 15.75h.007v.008H12v-.008Z"
                />
              </svg>
            )}
          </div>
          {finetuneViewOpen && row.isCloud ? (
            renderFinetuneBadge(row)
          ) : (
            row.isCloud && annotatedStems.has(row.stem) && (
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
            )
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
    );
  };

  const downloadZipUrl = server?.config?.publicBaseUrl
    ? `${server.config.publicBaseUrl}/${artifactId.split('/')[0]}/artifacts/${artifactId
        .split('/')
        .slice(1)
        .join('/')}/create-zip-file`
    : '';

  // --- Guard states ---
  if (!server || !user) {
    // No saved token means the store's auto-login effect will never fire, so
    // `server` would otherwise stay null forever and this would spin
    // indefinitely (colab-rework-plan.md §21 item 2). Show the login prompt
    // directly instead. A saved token means an auto-login attempt is
    // actually in flight, so a brief spinner here is accurate.
    if (!hasSavedToken()) {
      return (
        <div className="max-w-lg mx-auto text-center py-16">
          <div className="w-14 h-14 mx-auto mb-4 rounded-2xl bg-gray-100 flex items-center justify-center">
            <svg className="w-7 h-7 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={1.5}
                d="M11 16l-4-4m0 0l4-4m-4 4h14m-5 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h7a3 3 0 013 3v1"
              />
            </svg>
          </div>
          <h2 className="text-lg font-semibold text-gray-900 mb-1">Log in to view this dataset</h2>
          <p className="text-sm text-gray-500 mb-6">You need to be logged in to open a dataset overview.</p>
          <div className="flex justify-center">
            <LoginButton />
          </div>
        </div>
      );
    }
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
    // A stale connection whose reconnect failed because the token itself is
    // expired/invalid reads differently again: retrying won't help, logging
    // back in will (colab-rework-plan.md §14b item 3).
    const isAuthExpired = !isRealDenial && guardErrorCode === 'auth-expired';
    if (isAuthExpired) {
      return (
        <div className="max-w-lg mx-auto text-center py-16">
          <div className="w-14 h-14 mx-auto mb-4 rounded-2xl bg-gray-100 flex items-center justify-center">
            <svg className="w-7 h-7 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={1.5}
                d="M11 16l-4-4m0 0l4-4m-4 4h14m-5 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h7a3 3 0 013 3v1"
              />
            </svg>
          </div>
          <h2 className="text-lg font-semibold text-gray-900 mb-1">Your session has expired</h2>
          <p className="text-sm text-gray-500 mb-6">Please log in again to continue.</p>
          <div className="flex justify-center">
            <LoginButton />
          </div>
        </div>
      );
    }
    const heading = isRealDenial
      ? 'You do not have access to this dataset overview'
      : guardErrorCode === 'not-registered'
        ? 'This dataset could not be found'
        : 'This dataset could not be loaded';
    const body = isRealDenial
      ? 'Only the dataset owner and its managers can open this page.'
      : guardErrorCode === 'not-registered'
        ? 'It may have been deleted, or the link is incorrect.'
        : 'There was a problem connecting to the annotation service.';
    // A transport hiccup (not a real denial, not a missing dataset) is the
    // one case retrying can actually fix.
    const canRetry = !isRealDenial && guardErrorCode !== 'not-registered';
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
        <div className="flex items-center justify-center gap-3">
          {canRetry && (
            <button
              onClick={retryGuardLoad}
              disabled={retryingGuard}
              className="px-5 py-2.5 bg-white border border-gray-200 rounded-xl hover:bg-gray-50 text-gray-900 font-medium shadow-sm hover:shadow-md active:scale-[0.98] transition-all disabled:opacity-60 disabled:active:scale-100"
            >
              {retryingGuard ? 'Trying again...' : 'Try again'}
            </button>
          )}
          {canAnnotate && (
            <button
              onClick={() => setShowAnnotateDialog(true)}
              className="px-5 py-2.5 bg-gradient-to-r from-purple-600 to-pink-600 text-white rounded-xl hover:from-purple-700 hover:to-pink-700 font-medium shadow-sm hover:shadow-md active:scale-[0.98] transition-all"
            >
              Annotate this dataset
            </button>
          )}
        </div>
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
            onClick={() => (finetuneViewOpen ? setFinetuneViewOpen(false) : navigate('/colab'))}
            className="flex items-center text-blue-600 hover:text-blue-800 transition-colors duration-200 mr-4 shrink-0"
            title={finetuneViewOpen ? 'Back to dataset overview' : 'Back to Colab'}
          >
            <svg className="w-5 h-5 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
            </svg>
            <span className="text-sm font-medium">Back</span>
          </button>
          <div className="min-w-0">
            <h1 className="text-2xl font-bold text-gray-900 truncate">
              {finetuneViewOpen ? `Finetune: ${selectedLabel}` : (datasetMeta?.name ?? toAlias(artifactId))}
            </h1>
            <p
              ref={finetuneViewOpen ? undefined : setDescriptionNode}
              onClick={!finetuneViewOpen && descTruncated ? () => setDescExpanded((v) => !v) : undefined}
              className={`text-sm text-gray-600 mt-0.5 ${
                !finetuneViewOpen && !descExpanded ? 'truncate' : ''
              } ${!finetuneViewOpen && descTruncated ? 'cursor-pointer hover:text-gray-800' : ''}`}
              title={!finetuneViewOpen && descTruncated ? (descExpanded ? 'Click to collapse' : 'Click to expand') : undefined}
            >
              {finetuneViewOpen
                ? (datasetMeta?.name ?? toAlias(artifactId))
                : formatDatasetDescription(datasetMeta?.description)}
            </p>
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
        {!finetuneViewOpen && (
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
        )}
        {!finetuneViewOpen && localImages.length > 0 && (
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
            {statsViewOpen ? 'Show image preview' : 'Show annotation progress'}
          </button>
        )}
        <div className="ml-auto flex items-center gap-2">
          {!finetuneViewOpen && (
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
          )}
          {!finetuneViewOpen && (
            <button
              onClick={() => setShowFinetuneLabelDialog(true)}
              disabled={!labels || labels.length === 0}
              className="px-3.5 py-2 bg-white border border-gray-200 rounded-lg hover:border-purple-300 hover:bg-purple-50 text-sm font-medium text-gray-700 transition-colors disabled:opacity-50"
            >
              Finetune
            </button>
          )}
          {!finetuneViewOpen && (
            <a
              href={downloadZipUrl}
              className="px-3.5 py-2 bg-white border border-gray-200 rounded-lg hover:border-purple-300 hover:bg-purple-50 text-sm font-medium text-gray-700 transition-colors"
            >
              Download
            </a>
          )}
          {!finetuneViewOpen && role === 'owner' && (
            <button
              onClick={() => setShowDeleteDatasetModal(true)}
              className="px-3.5 py-2 bg-white border border-gray-200 rounded-lg hover:border-red-300 hover:bg-red-50 text-sm font-medium text-gray-900 hover:text-red-600 transition-colors"
            >
              Delete
            </button>
          )}
        </div>
      </div>

      {!finetuneViewOpen && smallImageCount > 0 && (
        <p className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-3 py-1.5 mb-4">
          {smallImageCount} local image{smallImageCount === 1 ? ' is' : 's are'} below 256 px on a side. AI segmentation quality may be reduced for {smallImageCount === 1 ? 'it' : 'those'}.
        </p>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-[260px_1fr_320px] gap-4">
        {/* Left: image list */}
        <div className="bg-white rounded-2xl border border-gray-200 overflow-hidden flex flex-col max-h-[70vh]">
          <div className="px-4 py-3 border-b border-gray-100 flex items-center justify-between gap-2">
            <div>
              <h3 className="text-sm font-semibold text-gray-900">Images</h3>
              <p className="text-xs text-gray-400">
                {finetuneViewOpen
                  ? `${displayedImageRows.length} annotated`
                  : `${imageRows.length} total${localImages.length > 0 ? ` · ${localImages.length} pending upload` : ''}`}
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
          <div className="overflow-y-auto flex-1">
            {images === null ? (
              <div className="flex items-center justify-center py-8">
                <Spinner className="w-6 h-6 text-purple-600" />
              </div>
            ) : finetuneViewOpen ? (
              displayedImageRows.length === 0 ? (
                <p className="text-sm text-gray-400 text-center py-8 px-4">
                  No annotated images yet for this label.
                </p>
              ) : (
                <div>
                  {(
                    [
                      ['train', 'Train', splitSections.train, 'bg-blue-50 text-blue-700'],
                      ['test', 'Test', splitSections.test, 'bg-amber-50 text-amber-700'],
                      ['unused', 'Unused', splitSections.unused, 'bg-gray-50 text-gray-500'],
                    ] as const
                  ).map(([key, title, rows, headerClass]) => (
                    <div key={key} className="border-b border-gray-100">
                      <div className={`px-4 py-1.5 text-xs font-semibold uppercase tracking-wide ${headerClass}`}>
                        {title} ({rows.length})
                      </div>
                      {rows.length === 0 ? (
                        <p className="text-xs text-gray-400 text-center py-3 px-4">No images</p>
                      ) : (
                        <div className="divide-y divide-gray-100">{rows.map((row) => renderImageRow(row))}</div>
                      )}
                    </div>
                  ))}
                </div>
              )
            ) : imageRows.length === 0 ? (
              <p className="text-sm text-gray-400 text-center py-8 px-4">No images yet. Mount a folder to get started.</p>
            ) : (
              <div className="divide-y divide-gray-100">{imageRows.map((row) => renderImageRow(row))}</div>
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
                onSelectStem={setSelectedStem}
                loading={statsLoading}
              />
            ) : selectedStem ? (
              imageRows.find((r) => r.stem === selectedStem)?.isCloud ? (
                <ImagePreview
                  viewMode={previewMode}
                  imageUrl={imageUrl}
                  imageLoading={imageLoading}
                  annotationUrl={annotationUrl}
                  hasAnnotation={!!currentPair}
                  alt={selectedStem}
                  onHoldChange={
                    currentPair ? (holding) => setPreviewMode(holding ? 'raw' : 'annotated') : undefined
                  }
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

          {/* Annotation browser strip (colab-rework-plan.md §23.3): always
              visible whenever an image+label are selected. Position 0 is
              the raw image; the right arrow steps forward through
              annotation files, the left arrow steps back toward 0. */}
          {selectedStem && selectedLabel && !statsViewOpen && (
            <div className="mt-3 border-t border-gray-100 pt-3">
              <div className="flex items-center justify-between gap-3">
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
                  {browserIndex > 0 && (
                    <>
                      <div className="flex items-center justify-center gap-1.5">
                        <p className="text-sm font-medium text-gray-800">
                          {currentPair
                            ? labelUsers[currentPair.userFolder]?.email || currentPair.userFolder
                            : ' '}
                        </p>
                        {currentPair && canDeletePair && (
                          <button
                            onClick={handleDeletePair}
                            disabled={isDeletingPair}
                            title="Delete this annotation"
                            aria-label="Delete this annotation"
                            className="p-0.5 rounded text-gray-300 hover:text-red-500 hover:bg-red-50 active:scale-90 transition-all disabled:opacity-40"
                          >
                            <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path
                                strokeLinecap="round"
                                strokeLinejoin="round"
                                strokeWidth={2}
                                d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6M9 7V4a1 1 0 011-1h4a1 1 0 011 1v3M4 7h16"
                              />
                            </svg>
                          </button>
                        )}
                      </div>
                      <p className="text-xs text-gray-400">
                        {currentPair
                          ? `${formatTimestamp(currentPair.timestamp)} · ${browserIndex} of ${pairs.length}`
                          : ' '}
                      </p>
                    </>
                  )}
                </div>
                <button
                  onClick={() => setBrowserIndex((i) => Math.min(pairs.length, i + 1))}
                  disabled={pairsLoading || browserIndex >= pairs.length}
                  className="flex items-center gap-1.5 p-1.5 rounded-lg hover:bg-gray-100 disabled:opacity-30 transition-colors"
                >
                  {browserIndex === 0 && !pairsLoading && (
                    <span className="text-sm font-medium text-gray-700">Browse annotations</span>
                  )}
                  {pairsLoading ? (
                    <svg className="w-4 h-4 animate-spin text-gray-400" fill="none" viewBox="0 0 24 24">
                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth={4} />
                      <path
                        className="opacity-75"
                        fill="currentColor"
                        d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"
                      />
                    </svg>
                  ) : (
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                    </svg>
                  )}
                </button>
              </div>
            </div>
          )}
        </div>

        {/* Right: labels, stats */}
        <div className="flex flex-col gap-4 max-h-[70vh]">
          <div className="flex-1 min-h-0">
            {finetuneViewOpen ? (
              <FinetuneView
                label={selectedLabel}
                alias={toAlias(artifactId)}
                existingSplits={existingSplits}
                splitsLoading={splitsLoading}
                activeSplitName={activeSplitName}
                activeSplit={activeSplit}
                activeSplitLoading={activeSplitLoading}
                onSelectSplit={setActiveSplitName}
                newSplitName={newSplitName}
                onNewSplitNameChange={setNewSplitName}
                trainPercent={trainPercent}
                onTrainPercentChange={setTrainPercent}
                onAutoDistribute={autoDistribute}
                rows={displayedImageRows.map((r) => ({ stem: r.stem, annotationCount: labelStats[r.stem] ?? 0 }))}
                assignment={assignment}
                isSaving={isSavingSplit}
                saveError={splitSaveError}
                onSaveSplit={handleSaveSplit}
                modelType={ftModelType}
                onModelTypeChange={setFtModelType}
                trainingCapabilities={trainingCapabilities}
                trainingCapabilitiesLoading={trainingCapabilitiesLoading}
                showAdvanced={ftShowAdvanced}
                onToggleAdvanced={() => setFtShowAdvanced((v) => !v)}
                nEpochs={ftNEpochs}
                onNEpochsChange={setFtNEpochs}
                nObjectsPerBatch={ftNObjectsPerBatch}
                onNObjectsPerBatchChange={setFtNObjectsPerBatch}
                patchSize={ftPatchSize}
                onPatchSizeChange={setFtPatchSize}
                batchSize={ftBatchSize}
                onBatchSizeChange={setFtBatchSize}
                learningRate={ftLearningRate}
                onLearningRateChange={setFtLearningRate}
                isStartingTraining={isStartingTraining}
                startTrainingError={startTrainingError}
                onStartTraining={() => handleStartTraining()}
                showEmptyTestWarning={showEmptyTestWarning}
                onDismissEmptyTestWarning={() => setShowEmptyTestWarning(false)}
                onConfirmStartWithEmptyTest={() => handleStartTraining(true)}
              />
            ) : (
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
                  selectedStem && imageRows.find((r) => r.stem === selectedStem)?.isCloud ? selectedStem : undefined,
                )}
                onDeleteLabel={(l) => setDeleteLabelTarget(l)}
              />
            )}
          </div>
        </div>
      </div>

      {showAnnotateDialog && (
        <LabelSelectDialog
          artifactManager={artifactManager}
          artifactId={artifactId}
          role={role}
          onClose={() => setShowAnnotateDialog(false)}
          onSelect={(l) => navigateToAnnotate(navigate, artifactId, l)}
        />
      )}

      {showFinetuneLabelDialog && (
        <LabelSelectDialog
          artifactManager={artifactManager}
          artifactId={artifactId}
          role={role}
          onClose={() => setShowFinetuneLabelDialog(false)}
          onSelect={(l) => {
            setSelectedLabel(l);
            setShowFinetuneLabelDialog(false);
            setFinetuneViewOpen(true);
          }}
        />
      )}

      {showShareModal && (
        <ShareModal
          server={server}
          artifactId={artifactId}
          role={role as BrokerRole}
          dataset={dataset}
          datasetName={datasetMeta?.name ?? toAlias(artifactId)}
          selectedLabel={selectedLabel}
          onSelectLabel={setSelectedLabel}
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

      {blockedDeleteInfo && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-50 animate-fadeIn p-4">
          <div className="bg-white rounded-2xl shadow-lg max-w-sm w-full border border-gray-100">
            <div className="p-6">
              <h3 className="text-base font-semibold text-gray-900 mb-1">Image is part of a split</h3>
              <p className="text-sm text-gray-500">
                "{blockedDeleteInfo.stem}" is part of the "{blockedDeleteInfo.splitName}" split for label "
                {blockedDeleteInfo.label}". Splits are add-only, so it cannot be deleted while it's a split member.
              </p>
            </div>
            <div className="px-6 py-4 border-t border-gray-100 flex justify-end">
              <button
                onClick={() => setBlockedDeleteInfo(null)}
                className="px-3.5 py-2 bg-white border border-gray-200 rounded-lg hover:border-purple-300 hover:bg-purple-50 text-sm font-medium text-gray-700 transition-colors"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default DatasetOverview;
