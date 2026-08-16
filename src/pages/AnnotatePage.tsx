import React, { useEffect, useState, useCallback, useMemo, useRef } from 'react';
import { useLocation, Link, useNavigate } from 'react-router-dom';
import { Box, CircularProgress, Typography, Alert, Button as MuiButton, Tooltip, useMediaQuery, useTheme, Dialog, DialogTitle, DialogContent, DialogActions, List, ListItemButton, ListItemText, ListItemIcon } from '@mui/material';
import LoginButton from '../components/LoginButton';
import AnnotationViewer from '../components/annotate/AnnotationViewer';
import ToolBar from '../components/annotate/ToolBar';
import ActionPanel from '../components/annotate/ActionPanel';
import ConfirmDialog from '../components/annotate/ConfirmDialog';
import FloatingBanners, { useBanners } from '../components/annotate/FloatingBanners';
import { useCellposeConfig, CellposeConfig } from '../components/annotate/CellposeConfigDialog';
import CLAHEDialog, { useCLAHE } from '../components/annotate/CLAHEDialog';
import { useColabKernel } from '../components/colab/useColabKernel';
import { useSharedKernelIfAvailable } from '../components/colab/KernelContext';
import MaskFilterDialog from '../components/annotate/MaskFilterDialog';
import HelpTutorial from '../components/annotate/HelpTutorial';
import { useHyphaService, AnnotationServiceConfig, AllAnnotatedResult, NoImagesResult, CellposeFlowsResult, maskDataToPolygons } from '../components/annotate/hooks/useHyphaService';
import { DatasetIndex, BrokerRole, classifyBrokerError, getDataset } from '../components/colab/brokerApi';
import { toArtifactId } from '../components/colab/datasetApi';
import { useCellposeMaskGen } from '../components/annotate/hooks/useCellposeMaskGen';
import { useMicroSamDecoder } from '../components/annotate/hooks/useMicroSamDecoder';
import CheckCircleOutlineIcon from '@mui/icons-material/CheckCircleOutline';
import { exportGeoJSON, renderInstanceSegmentationPNG, importGeoJSON } from '../components/annotate/exportAnnotation';
import { useAnnotationStore } from '../store/annotationStore';
import { useHyphaStore } from '../store/hyphaStore';
import { snapshotMaskPolygons, excludeAgainstMaskPolygons } from '../components/annotate/hooks/useDrawInteraction';
import VectorSource from 'ol/source/Vector';
import ImageLayer from 'ol/layer/Image';
import OlMap from 'ol/Map';
import Static from 'ol/source/ImageStatic';
import Feature from 'ol/Feature';
import { Polygon as OlPolygon } from 'ol/geom';

interface AnnotatePageProps {
  backTo?: string;
}

const AnnotatePage: React.FC<AnnotatePageProps> = ({ backTo }) => {
  const location = useLocation();
  const navigate = useNavigate();

  // Read session ID from URL for "View Session" link
  const sessionId = useMemo(() => {
    const searchParams = new URLSearchParams(location.search);
    return searchParams.get('session_id') || undefined;
  }, [location.search]);

  const serviceConfig = useMemo<AnnotationServiceConfig | null>(() => {
    const searchParams = new URLSearchParams(location.search);
    const label = searchParams.get('label');
    if (!sessionId || !label) return null;
    // Fine-tuned micro-sam session override (colab-rework-plan.md §20 item
    // 2), set by the Finetune page's "Use for annotation" action. Both
    // params must be present, a session id without its base model_type is
    // unusable server-side.
    const usmSessionId = searchParams.get('usm_session');
    const usmModelType = searchParams.get('usm_model');
    const microSamSession = usmSessionId && usmModelType
      ? { sessionId: usmSessionId, modelType: usmModelType }
      : undefined;
    return { artifactId: sessionId, label, microSamSession };
  }, [sessionId, location.search]);

  // Deep link from the overview's Labels box (colab-rework-plan.md §14 item
  // 10): open exactly this image instead of the next-unannotated pick.
  const initialImageStem = useMemo(() => {
    const searchParams = new URLSearchParams(location.search);
    return searchParams.get('image') || undefined;
  }, [location.search]);

  const sessionUrl = useMemo(() => {
    if (!sessionId) return null;
    const labelParam = serviceConfig?.label ? `?label=${encodeURIComponent(serviceConfig.label)}` : '';
    return `${window.location.origin}${window.location.pathname}#/colab/${sessionId}${labelParam}`;
  }, [sessionId, serviceConfig?.label]);

  // Role-aware back navigation (colab-rework-plan.md §14 item 4): only an
  // owner or manager can see the dataset overview, so the back button leads
  // there for them and to the colab landing page for everyone else
  // (annotator, public, or logged-out visitors).
  const { server, user } = useHyphaStore();
  const [callerRole, setCallerRole] = useState<BrokerRole | null>(null);

  useEffect(() => {
    if (!sessionId || !user?.email || !server) {
      setCallerRole(null);
      return;
    }
    let cancelled = false;
    getDataset(server, toArtifactId(sessionId))
      .then((dataset) => {
        if (!cancelled) setCallerRole(dataset.role);
      })
      .catch(() => {
        if (!cancelled) setCallerRole(null);
      });
    return () => { cancelled = true; };
  }, [sessionId, user?.email, server]);

  const backTarget = useMemo(() => {
    if (sessionId && (callerRole === 'owner' || callerRole === 'manager')) {
      const labelParam = serviceConfig?.label ? `?label=${encodeURIComponent(serviceConfig.label)}` : '';
      return `/colab/${sessionId}${labelParam}`;
    }
    return backTo || '/colab';
  }, [sessionId, callerRole, serviceConfig?.label, backTo]);

  const theme = useTheme();
  const isMobile = useMediaQuery(theme.breakpoints.down('sm')); // < 600px

  const { service, loading: serviceLoading, error: serviceError, cellposeAvailable, microSamAvailable, retry: retryService } = useHyphaService(serviceConfig);
  const { banners, addBanner, removeBanner } = useBanners();
  const runCellposeRef = React.useRef<(config: CellposeConfig) => void>(() => {});
  const instantConfigChangeRef = React.useRef<(config: CellposeConfig) => void>(() => {});
  const [isRunningCellpose, setIsRunningCellpose] = useState(false);
  const [livePreviewReady, setLivePreviewReady] = useState(false);
  // Declared ahead of its usual position (alongside the other CLAHE state
  // below) so it can be passed into useCellposeConfig's opts here.
  const [isCLAHEActive, setIsCLAHEActive] = useState(false);

  const { config: cellposeConfig, setConfig: setCellposeConfig, openDialog: openCellposeConfig, dialogOpen: cellposeConfigOpen, dialogElement: cellposeDialogElement } = useCellposeConfig({
    onRun: (config) => runCellposeRef.current(config),
    isRunning: isRunningCellpose,
    // The flows + Pyodide path keeps the dialog open so the instant sliders
    // can keep tweaking the preview without forcing the user to re-open it.
    keepOpenAfterApply: true,
    livePreviewReady,
    microSamAvailable,
    claheActive: isCLAHEActive,
    onInstantConfigChange: (config) => instantConfigChangeRef.current(config),
    onMeasureDiameter: (currentConfig, onMeasured) => {
      setCellposeConfig(currentConfig);
      measureCallbackRef.current = (px: number) => {
        setCellposeConfig((prev: CellposeConfig) => ({ ...prev, diameter: Math.round(px) }));
        openCellposeConfig();
        onMeasured(px);
      };
      setMeasurePhase('first');
      setMeasurePt1(null);
      setMeasureScreenPt1(null);
      setMeasureScreenMouse(null);
    },
  });

  const { claheConfig, setClaheConfig, dialogOpen: claheDialogOpen, openDialog: openCLAHEDialog, closeDialog: closeCLAHEDialog } = useCLAHE();
  
  // Always call both hooks unconditionally (required by React Rules of Hooks)
  // Use shared kernel if available (when called from Colab), otherwise use local kernel
  const sharedKernel = useSharedKernelIfAvailable();
  const localKernel = useColabKernel();
  
  const kernel = sharedKernel || localKernel;
  const kernelReady = kernel.isReady;
  const executeCode = kernel.executeCode;

  // Pyodide-side mask gen — only used when the server returns flows-only.
  // The hook lazily installs scipy + execs public/cellpose_mask_gen.py on the
  // first compute. While the kernel boots silently, the AI tool stays on the
  // existing server path (runCellpose) automatically — see handleRunCellpose.
  const maskGen = useCellposeMaskGen(executeCode, kernelReady);

  // Declared ahead of its usual position (alongside the other
  // useAnnotationStore selectors below) so useMicroSamDecoder can gate its
  // ONNX decoder download on "an image has actually rendered" rather than
  // firing as soon as the service connects (see the hook's own comment).
  const imageUrl = useAnnotationStore((s) => s.imageUrl);

  // In-browser μSAM box decoder: fetches the ONNX decoder once the current
  // image has rendered, embeds each image once, decodes each drawn box
  // locally. See handleSamBox below.
  const {
    decodeBox: decodeSamBox,
    reset: resetSamDecoder,
    setEmbeddingLoader,
    decoderReady,
  } = useMicroSamDecoder(service, !!imageUrl);
  // Guards against overlapping box decodes (dev-rule #10).
  const samDecodeInFlightRef = useRef(false);
  // Mirror of currentImageStem for use inside stable callbacks/effects.
  const currentImageStemRef = useRef<string | null>(null);
  // Per-image memoization of the compute+upload step (the expensive part) so
  // eager-load, AIS, and the box loader all dedupe to a single encode. Presigned
  // GET urls expire, so only the "is it stored" promise is cached here; a fresh
  // download url is fetched on each use.
  const ensuredEmbeddingRef = useRef<Map<string, Promise<void>>>(new Map());
  // Set to the image stem once its embedding is confirmed stored (12A: drives
  // the AI Box tool's "ready" state, distinct from the service being reachable).
  const [embeddingReadyStem, setEmbeddingReadyStem] = useState<string | null>(null);

  // Ensure the μSAM embedding for `imageName` is computed and stored in the
  // session artifact (once per image, keyed by stem + model server-side), then
  // return a fresh presigned GET url for the stored `.npz`. The expensive
  // encode+upload is memoized; the GET url is re-fetched each call because
  // presigned urls expire. Both the box decoder and AIS pre-seg read the same
  // `.npz` this produces.
  const ensureStoredEmbedding = useCallback(
    async (
      imageStem: string,
      sourceUrl: string,
      width: number,
      height: number,
    ): Promise<string> => {
      if (!service) throw new Error('μSAM service unavailable');
      const cache = ensuredEmbeddingRef.current;
      let stored = cache.get(imageStem);
      if (!stored) {
        stored = (async () => {
          const urls = await service.getEmbeddingUrls(imageStem);
          if (urls.exists) return;
          await service.computeMicroSamEmbeddingToArtifact(sourceUrl, width, height, urls.embedding_put_url);
        })().catch((e) => {
          // Drop the entry so a later box/AIS request retries the encode+upload.
          cache.delete(imageStem);
          throw e;
        });
        cache.set(imageStem, stored);
      }
      await stored;
      const urls = await service.getEmbeddingUrls(imageStem);
      if (!urls.exists) throw new Error('μSAM embedding is unavailable after upload');
      return urls.read_url;
    },
    [service],
  );

  // Cache for the network's raw (dP, cellprob). One entry per unique
  // (image, model, diameter, clahe) combination — any change there needs a
  // fresh GPU round-trip. The instant sliders read this cache and never hit
  // the network.
  const flowsCacheRef = useRef<({ cacheKey: string } & CellposeFlowsResult) | null>(null);
  // OL features added by the latest Cellpose run. Replaced wholesale on each
  // instant-slider recompute so the preview stays in sync.
  const previewFeaturesRef = useRef<Feature[]>([]);
  // Debounce timer for instant-config slider drags.
  const instantRecomputeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const [kernelPackagesInstalled, setKernelPackagesInstalled] = useState(false);

  // Install scikit-image in the kernel once it's ready
  useEffect(() => {
    if (!kernelReady || !executeCode || kernelPackagesInstalled) return;
    const install = async () => {
      console.log('[AnnotatePage] Installing CLAHE packages in kernel...');
      await executeCode(`
import micropip
await micropip.install(['scikit-image', 'numpy', 'Pillow'])
print('CLAHE packages ready')
`, {
        onOutput: (o) => console.log('[Kernel]', o.content),
      });
      setKernelPackagesInstalled(true);
      console.log('[AnnotatePage] CLAHE kernel packages installed');
    };
    install();
  }, [kernelReady, executeCode, kernelPackagesInstalled]);

  const imageWidth = useAnnotationStore((s) => s.imageWidth);
  const imageHeight = useAnnotationStore((s) => s.imageHeight);
  const setImageInfo = useAnnotationStore((s) => s.setImageInfo);
  const setIsLoading = useAnnotationStore((s) => s.setIsLoading);
  const error = useAnnotationStore((s) => s.error);
  const setError = useAnnotationStore((s) => s.setError);
  const pushUndo = useAnnotationStore((s) => s.pushUndo);
  const activeLabel = useAnnotationStore((s) => s.activeLabel);

  const [isSaving, setIsSaving] = useState(false);
  const [isLoadingImage, setIsLoadingImage] = useState(false);
  const [hasLoadedOnce, setHasLoadedOnce] = useState(false);
  const [currentImageStem, setCurrentImageStem] = useState<string | null>(null);
  const [clearConfirmOpen, setClearConfirmOpen] = useState(false);
  const [maskFilterOpen, setMaskFilterOpen] = useState(false);
  const [helpOpen, setHelpOpen] = useState(false);

  // Auto-open tutorial on first visit
  useEffect(() => {
    try {
      const seen = localStorage.getItem('bioimage-annotation-tutorial-seen');
      if (!seen) {
        setHelpOpen(true);
        localStorage.setItem('bioimage-annotation-tutorial-seen', '1');
      }
    } catch { /* ignore */ }
  }, []);
  const [isLowContrast, setIsLowContrast] = useState(false);
  const [originalImageUrl, setOriginalImageUrl] = useState<string | null>(null);
  // Data URL of the CLAHE-enhanced pixels (set alongside isCLAHEActive).
  // Segmentation defaults to the raw image; this is only sent to either
  // backend when the "Use contrast enhanced image" checkbox in the Full
  // Image Segmentation dialog is checked (see handleRunCellpose).
  const [claheEnhancedUrl, setClaheEnhancedUrl] = useState<string | null>(null);
  const [resetView, setResetView] = useState<(() => void) | undefined>(undefined);
  const [getVectorSource, setGetVectorSource] = useState<(() => VectorSource | null) | undefined>(undefined);
  const [getImageLayer, setGetImageLayer] = useState<(() => ImageLayer<Static> | null) | undefined>(undefined);
  const [getOlMap, setGetOlMap] = useState<(() => OlMap | null) | undefined>(undefined);

  // Diameter measurement state
  type MeasurePhase = 'idle' | 'first' | 'second';
  const [measurePhase, setMeasurePhase] = useState<MeasurePhase>('idle');
  const [measurePt1, setMeasurePt1] = useState<[number, number] | null>(null);
  const [measureScreenPt1, setMeasureScreenPt1] = useState<[number, number] | null>(null);
  const [measureScreenMouse, setMeasureScreenMouse] = useState<[number, number] | null>(null);
  const measureCallbackRef = useRef<((px: number) => void) | null>(null);

  const handleResetViewReady = useCallback((fn: () => void) => {
    setResetView(() => fn);
  }, []);

  const handleVectorSourceReady = useCallback((fn: () => VectorSource | null) => {
    setGetVectorSource(() => fn);
  }, []);

  const handleImageLayerReady = useCallback((fn: () => ImageLayer<Static> | null) => {
    setGetImageLayer(() => fn);
  }, []);

  const handleMapReady = useCallback((fn: () => OlMap | null) => {
    setGetOlMap(() => fn);
  }, []);

  const handleZoomIn = useCallback(() => {
    const view = getOlMap?.()?.getView();
    if (view) view.animate({ zoom: (view.getZoom() ?? 0) + 1, duration: 200 });
  }, [getOlMap]);

  const handleZoomOut = useCallback(() => {
    const view = getOlMap?.()?.getView();
    if (view) view.animate({ zoom: (view.getZoom() ?? 0) - 1, duration: 200 });
  }, [getOlMap]);

  const [allAnnotatedInfo, setAllAnnotatedInfo] = useState<AllAnnotatedResult | null>(null);
  const [noImagesInfo, setNoImagesInfo] = useState<NoImagesResult | null>(null);

  // Full broker-index snapshot for this dataset: every image plus this
  // user's own latest annotation per (label, stem). Drives image picking
  // and the always-available image browser (colab-rework-plan.md F5).
  const [datasetIndex, setDatasetIndex] = useState<DatasetIndex | null>(null);
  // Timestamp of the last successful index fetch, used to decide whether a
  // tab refocus should silently refetch (colab-rework-plan.md §14b item 4).
  const lastIndexFetchAtRef = useRef<number>(0);

  // Image picker: lets a user jump to any image in the dataset (already
  // annotated or not). Every image opens with a clean slate; no prior
  // annotation is auto-loaded.
  const [refinePickerOpen, setRefinePickerOpen] = useState(false);

  // Set when the broker rejects get_dataset_index with a role-too-low
  // PermissionError (colab-rework-plan.md F5: private datasets require
  // login; anonymous/under-privileged callers get a login prompt instead
  // of the generic error banner).
  const [permissionDenied, setPermissionDenied] = useState(false);

  // Request-access flow (colab-rework-plan.md §13 item 4): a logged-in,
  // permission-denied visitor can ask the broker for a role instead of
  // just staring at a dead end. `already_has_access` means a role was
  // granted moments ago and the page's stale permission check just needs
  // to re-run, so it reuses the same reconnect path as a manual retry.
  const [requestAccessState, setRequestAccessState] = useState<'idle' | 'requesting' | 'requested' | 'error'>('idle');
  const [requestAccessError, setRequestAccessError] = useState<string | null>(null);

  // Fetch the dataset index once the broker connection is up.
  useEffect(() => {
    if (!service) return;
    let cancelled = false;
    setPermissionDenied(false);
    setRequestAccessState('idle');
    setRequestAccessError(null);
    service.getDatasetIndex()
      .then((index) => {
        if (!cancelled) {
          setDatasetIndex(index);
          lastIndexFetchAtRef.current = Date.now();
        }
      })
      .catch((err: any) => {
        if (!cancelled) {
          console.error('[AnnotatePage] Failed to load dataset index:', err);
          const message = err.message || 'Failed to load dataset index';
          if (/PermissionError/i.test(message) || /or higher is required/i.test(message)) {
            setPermissionDenied(true);
          } else {
            setError(message);
          }
        }
      });
    return () => { cancelled = true; };
  }, [service, setError]);

  // Presigned read URLs (image, embedding, geojson) expire after about an
  // hour; a long-idle tab can sit well past that. On tab refocus, silently
  // refetch the index if it is more than ~20 minutes old so the URLs are
  // fresh again (colab-rework-plan.md §14b item 4). No user-facing error on
  // failure: this is a best-effort background refresh, not a load path.
  useEffect(() => {
    const STALE_MS = 20 * 60 * 1000;
    const handleVisibility = () => {
      if (document.visibilityState !== 'visible') return;
      if (!service) return;
      if (Date.now() - lastIndexFetchAtRef.current < STALE_MS) return;
      service.getDatasetIndex()
        .then((index) => {
          setDatasetIndex(index);
          lastIndexFetchAtRef.current = Date.now();
        })
        .catch((err: any) => {
          console.warn('[AnnotatePage] Silent index refetch on visibilitychange failed:', err);
        });
    };
    document.addEventListener('visibilitychange', handleVisibility);
    return () => document.removeEventListener('visibilitychange', handleVisibility);
  }, [service]);

  // Retry after a connect or dataset-index failure: clear the stale error
  // and tear the Hypha connection down so useHyphaService reconnects from
  // scratch, which in turn re-triggers the dataset-index fetch above once
  // the new `service` lands.
  const handleRetryConnection = useCallback(() => {
    setError(null);
    setPermissionDenied(false);
    retryService();
  }, [setError, retryService]);

  // Auto-recheck access while the "Access needed" dialog is shown (§22 item
  // 6): an owner approving a pending request should make the dialog vanish
  // and unblock the page on its own, without a manual reload. Reuses the
  // same getDatasetIndex() call as the initial load, since success both
  // confirms the new role and supplies the index needed to proceed.
  useEffect(() => {
    if (!permissionDenied || !service) return;
    const poll = async () => {
      try {
        const index = await service.getDatasetIndex();
        setDatasetIndex(index);
        lastIndexFetchAtRef.current = Date.now();
        setPermissionDenied(false);
      } catch {
        // still denied, wait for the next tick
      }
    };
    const id = setInterval(poll, 12_000);
    return () => clearInterval(id);
  }, [permissionDenied, service]);

  const handleRequestAccess = useCallback(async () => {
    if (!service) return;
    setRequestAccessState('requesting');
    setRequestAccessError(null);
    try {
      const result = await service.requestAccess('annotator');
      if (result.status === 'already_has_access') {
        handleRetryConnection();
      } else {
        setRequestAccessState('requested');
      }
    } catch (err: any) {
      setRequestAccessState('error');
      setRequestAccessError(err.message || 'Failed to request access.');
    }
  }, [service, handleRetryConnection]);

  // Pick a random stem from `index` that this user hasn't annotated yet
  // under `label`. Returns null when everything is annotated.
  const pickNextUnannotated = useCallback((index: DatasetIndex, label: string): string | null => {
    const annotated = index.my_annotations[label] || {};
    const remaining = index.images.filter((img) => !annotated[img.stem]);
    if (remaining.length === 0) return null;
    return remaining[Math.floor(Math.random() * remaining.length)].stem;
  }, []);

  // Detect low contrast by sampling luminance values from the loaded image.
  // Returns true when the 5th–95th percentile luminance range is below 60/255.
  const detectLowContrast = useCallback((img: HTMLImageElement): boolean => {
    try {
      const SAMPLE = 256; // downscale to at most 256×256 for speed
      const scale = Math.min(1, SAMPLE / Math.max(img.naturalWidth, img.naturalHeight));
      const w = Math.max(1, Math.round(img.naturalWidth * scale));
      const h = Math.max(1, Math.round(img.naturalHeight * scale));
      const canvas = document.createElement('canvas');
      canvas.width = w;
      canvas.height = h;
      const ctx = canvas.getContext('2d')!;
      ctx.drawImage(img, 0, 0, w, h);
      const data = ctx.getImageData(0, 0, w, h).data;
      const lumas: number[] = [];
      for (let i = 0; i < data.length; i += 4) {
        lumas.push(0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2]);
      }
      lumas.sort((a, b) => a - b);
      const p5 = lumas[Math.floor(lumas.length * 0.05)];
      const p95 = lumas[Math.floor(lumas.length * 0.95)];
      return (p95 - p5) < 60;
    } catch {
      return false;
    }
  }, []);

  // Load one image by stem: fetches a fresh presigned read url for just this
  // image (broker v0.5.0's `get_image_url`, public-min role) instead of
  // looking it up in a full index fetch. Every image opens with a clean
  // slate — any prior annotation for this (label, stem) pair is never
  // auto-loaded; `get_my_annotation_url` is reserved for explicit user
  // actions. This call doesn't depend on `datasetIndex`, which is what lets
  // an `&image=<stem>` deep link render before the index or the μSAM probe
  // resolve.
  const loadImageByStem = useCallback(async (stem: string, showBanner = true) => {
    if (!service || !serviceConfig) return;
    setIsLoadingImage(true);
    setError(null);
    setAllAnnotatedInfo(null);
    setNoImagesInfo(null);
    setIsCLAHEActive(false);
    setIsLowContrast(false);
    setOriginalImageUrl(null);
    setClaheEnhancedUrl(null);
    const bannerId = showBanner ? addBanner('Loading image...', 'loading', 0) : 0;
    try {
      const { read_url: url } = await service.getImageUrl(stem);
      setCurrentImageStem(stem);

      const img = new Image();
      img.crossOrigin = 'anonymous';
      img.src = url;
      await new Promise<void>((resolve, reject) => {
        img.onload = () => resolve();
        img.onerror = () => reject(new Error('Failed to load image'));
      });
      console.log('[AnnotatePage] Image loaded:', img.naturalWidth, 'x', img.naturalHeight);
      setIsLowContrast(detectLowContrast(img));
      setImageInfo(url, img.naturalWidth, img.naturalHeight);
      setHasLoadedOnce(true);
    } catch (err: any) {
      console.error('[AnnotatePage] loadImageByStem failed:', err);
      setError(err.message || 'Failed to load image');
    } finally {
      setIsLoadingImage(false);
      if (bannerId) removeBanner(bannerId);
    }
  }, [service, serviceConfig, setImageInfo, setError, addBanner, removeBanner, detectLowContrast]);

  // Deep-link fast path: as soon as the service is ready, render the
  // `&image=<stem>` image immediately, independent of the dataset index or
  // the μSAM probe (both now run in parallel with this instead of gating
  // it — broker v0.5.0 / colab-rework-plan.md §15 item 1).
  useEffect(() => {
    if (hasLoadedOnce || !serviceConfig || !service || !initialImageStem) return;
    setIsLoading(true);
    setHasLoadedOnce(true);
    loadImageByStem(initialImageStem, false).finally(() => setIsLoading(false));
  }, [service, hasLoadedOnce, serviceConfig, initialImageStem, loadImageByStem, setIsLoading]);

  // No-deep-link path: once the dataset index is in, pick an unannotated
  // image (or show a terminal state) and load it. Guarded off whenever
  // `initialImageStem` is set so this doesn't race the fast path above.
  useEffect(() => {
    if (!datasetIndex || hasLoadedOnce || !serviceConfig || initialImageStem) return;
    if (datasetIndex.images.length === 0) {
      setNoImagesInfo({ status: 'no_images', message: 'This dataset has no images yet.' });
      setHasLoadedOnce(true);
      return;
    }
    const stem = pickNextUnannotated(datasetIndex, serviceConfig.label);
    if (!stem) {
      const annotatedCount = Object.keys(datasetIndex.my_annotations[serviceConfig.label] || {}).length;
      setAllAnnotatedInfo({
        status: 'all_annotated',
        total: datasetIndex.images.length,
        annotated: annotatedCount,
        label: serviceConfig.label,
        message: `You have annotated all ${datasetIndex.images.length} image${datasetIndex.images.length !== 1 ? 's' : ''} for "${serviceConfig.label}".`,
      });
      setHasLoadedOnce(true);
      return;
    }
    setIsLoading(true);
    loadImageByStem(stem, false).finally(() => setIsLoading(false));
  }, [datasetIndex, hasLoadedOnce, serviceConfig, initialImageStem, pickNextUnannotated, loadImageByStem, setIsLoading]);

  // Refetch the dataset index and load the next unannotated image (or show
  // a terminal state). Called after a save and from the "Retry"/"Check for
  // new images" actions, so newly added images or teammates' progress are
  // picked up without a full page reload.
  const advanceToNextImage = useCallback(async () => {
    if (!service || !serviceConfig) return;
    try {
      const index = await service.getDatasetIndex();
      setDatasetIndex(index);
      if (index.images.length === 0) {
        setNoImagesInfo({ status: 'no_images', message: 'This dataset has no images yet.' });
        return;
      }
      const stem = pickNextUnannotated(index, serviceConfig.label);
      if (!stem) {
        const annotatedCount = Object.keys(index.my_annotations[serviceConfig.label] || {}).length;
        setAllAnnotatedInfo({
          status: 'all_annotated',
          total: index.images.length,
          annotated: annotatedCount,
          label: serviceConfig.label,
          message: `You have annotated all ${index.images.length} image${index.images.length !== 1 ? 's' : ''} for "${serviceConfig.label}".`,
        });
        return;
      }
      setAllAnnotatedInfo(null);
      setNoImagesInfo(null);
      await loadImageByStem(stem);
    } catch (err: any) {
      console.error('[AnnotatePage] Failed to advance to next image:', err);
      setError(err.message || 'Failed to load next image');
    }
  }, [service, serviceConfig, pickNextUnannotated, loadImageByStem, setError]);

  // Open the image picker. The dataset index is already loaded, so this is
  // just a visibility toggle.
  const handleOpenRefinePicker = useCallback(() => {
    setRefinePickerOpen(true);
  }, []);

  const handlePickRefineImage = useCallback((stem: string) => {
    setRefinePickerOpen(false);
    loadImageByStem(stem);
  }, [loadImageByStem]);

  // Cellpose feature-replacement helper: removes everything we added on the
  // previous run/preview and stamps in the new polygons. Non-Cellpose
  // features (user-drawn polygons, Cellpose masks the user *accepted* and
  // re-labelled, GeoJSON imports) are untouched because they're tracked by
  // identity in `previewFeaturesRef`.
  const applyPolygonsAsPreview = useCallback(
    (vs: VectorSource | null, polygons: { label: number; coordinates: number[][][] }[]): number => {
      if (!vs) return 0;
      for (const f of previewFeaturesRef.current) {
        try { vs.removeFeature(f); } catch { /* feature may already be gone */ }
      }
      previewFeaturesRef.current = [];

      // Exclude the AI preview against already-existing annotations so no
      // pixel is claimed by both a saved mask and a preview mask.
      const existingPolys = snapshotMaskPolygons(vs.getFeatures());

      const added: Feature[] = [];
      for (const m of polygons) {
        const rawPolygon = new OlPolygon(m.coordinates);
        const pieces = excludeAgainstMaskPolygons(rawPolygon, existingPolys);
        for (const polygon of pieces) {
          const feature = new Feature({ geometry: polygon });
          feature.setProperties({
            label: `cell_${m.label}`,
            edge_color: '#0084ff',
            face_color: '#0084ff',
            edge_width: 2,
            _cellpose_preview: true,
          });
          vs.addFeature(feature);
          added.push(feature);
        }
      }
      previewFeaturesRef.current = added;
      return added.length;
    },
    [],
  );

  // Drop the cached μSAM embedding whenever the source image changes so a new
  // image never decodes against a stale embedding.
  useEffect(() => {
    resetSamDecoder();
  }, [imageUrl, originalImageUrl, resetSamDecoder]);

  // Keep the ref in sync so the stable box embedding loader can read the current
  // image stem without being torn down and re-registered on every image switch.
  useEffect(() => {
    currentImageStemRef.current = currentImageStem;
  }, [currentImageStem]);

  // Eagerly compute + store the μSAM embedding as soon as an image is ready so
  // the first box draw and the first AIS run reuse it instead of each encoding
  // from scratch. Memoization (ensuredEmbeddingRef) makes CLAHE toggles and
  // reloads of the same image a no-op, so this only fires once per image.
  useEffect(() => {
    if (!microSamAvailable || !service) return;
    if (!currentImageStem || imageWidth <= 0 || imageHeight <= 0) return;
    const sourceUrl = originalImageUrl || imageUrl;
    if (!sourceUrl) return;
    const stem = currentImageStem;
    // Already computing/computed for this image: skip the banner flicker, but
    // still await the (already-memoized) promise so embeddingReadyStem catches up.
    const alreadyEnsured = ensuredEmbeddingRef.current.has(stem);
    const bannerId = alreadyEnsured ? null : addBanner('Preparing μSAM...', 'loading', 0);
    ensureStoredEmbedding(stem, sourceUrl, imageWidth, imageHeight)
      .then(() => setEmbeddingReadyStem(stem))
      .catch((e) => {
        // Non-fatal: the box and AIS tools retry on demand. Keep it quiet.
        console.warn('[AnnotatePage] micro-sam embedding precompute failed:', e?.message || e);
      })
      .finally(() => { if (bannerId) removeBanner(bannerId); });
    return () => { if (bannerId) removeBanner(bannerId); };
  }, [
    microSamAvailable, service, currentImageStem, imageWidth, imageHeight,
    imageUrl, originalImageUrl, ensureStoredEmbedding, addBanner, removeBanner,
  ]);

  // Feed the in-browser box decoder from the shared stored embedding instead of
  // letting it encode inline, so the box tool and AIS pre-seg reuse one encode.
  useEffect(() => {
    if (!service) return;
    setEmbeddingLoader(async (url, width, height) => {
      const stem = currentImageStemRef.current;
      if (!stem) throw new Error('no active image for μSAM');
      const npzUrl = await ensureStoredEmbedding(stem, url, width, height);
      return service.loadMicroSamEmbedding(npzUrl);
    });
    return () => setEmbeddingLoader(null);
  }, [service, setEmbeddingLoader, ensureStoredEmbedding]);

  // AI-box tool: decode the drawn box into one mask locally and commit it as a
  // feature styled with the active label. Undo-snapshotted before mutation.
  const handleSamBox = useCallback(
    async (extent: number[]) => {
      if (!service || !imageUrl || imageWidth <= 0 || imageHeight <= 0) return;
      // One decode at a time (dev-rule #10); ignore boxes drawn mid-decode.
      if (samDecodeInFlightRef.current) return;
      samDecodeInFlightRef.current = true;
      const sourceUrl = originalImageUrl || imageUrl;
      const bannerId = addBanner('Decoding box with μSAM...', 'loading', 0);
      try {
        const polygons = await decodeSamBox(extent, imageWidth, imageHeight, sourceUrl);
        removeBanner(bannerId);
        if (!polygons || polygons.length === 0) {
          addBanner('No mask found in that box', 'warning', 4000);
          return;
        }
        const vs = getVectorSource?.();
        if (!vs) return;
        // dev-rule #7: snapshot before mutating the vector source.
        const GeoJSON = (await import('ol/format/GeoJSON')).default;
        const fmt = new GeoJSON();
        pushUndo({ geojson: fmt.writeFeatures(vs.getFeatures()) });
        // Exclude the AI-decoded mask against already-existing annotations
        // so it never overwrites area a saved mask already claims.
        const existingPolys = snapshotMaskPolygons(vs.getFeatures());
        const label = activeLabel;
        let added = 0;
        for (const m of polygons) {
          const rawPolygon = new OlPolygon(m.coordinates);
          const pieces = excludeAgainstMaskPolygons(rawPolygon, existingPolys);
          for (const polygon of pieces) {
            const feature = new Feature({ geometry: polygon });
            feature.setProperties({
              label: label.id,
              edge_color: label.color,
              face_color: label.color,
              edge_width: 2,
            });
            vs.addFeature(feature);
            added++;
          }
        }
        if (added === 0) {
          addBanner('That box only covered existing annotations, no new mask added', 'warning', 4000);
        } else {
          console.log('[AnnotatePage] micro-sam box added', added, 'masks');
          addBanner(`Added ${added} mask${added !== 1 ? 's' : ''} from μSAM`, 'success', 4000);
        }
      } catch (err: any) {
        removeBanner(bannerId);
        const msg = err?.message || 'Unknown error';
        console.error('[AnnotatePage] micro-sam box decode failed:', msg);
        addBanner('micro-sam box decode failed', 'error', 8000, msg);
      } finally {
        samDecodeInFlightRef.current = false;
      }
    },
    [
      service, imageUrl, originalImageUrl, imageWidth, imageHeight,
      decodeSamBox, getVectorSource, pushUndo, activeLabel, addBanner, removeBanner,
    ],
  );

  // Drop any cached flows: every server-affecting param change must trigger a
  // fresh GPU round-trip. Cache eviction also resets livePreviewReady so the
  // dialog goes back to "click Run to fetch".
  const invalidateFlowsCache = useCallback(() => {
    if (flowsCacheRef.current) {
      console.log('[AnnotatePage] Flows cache invalidated');
    }
    flowsCacheRef.current = null;
    setLivePreviewReady(false);
  }, []);

  // Cellpose can return a fresh (dP, cellprob) over the wire when the
  // image/CLAHE flag changed, OR we can recompute locally from the cached
  // flows when only the instant-group sliders moved. Both paths converge in
  // the same polygon-replacement logic below.
  const runCellposeFlowsPipeline = useCallback(
    async (cfg: CellposeConfig, sourceUrl: string) => {
      if (!service || !imageWidth || !imageHeight) return;

      // Server-affecting params decide whether the cache is still valid.
      // `sourceUrl` already differs when the CLAHE-enhanced pixels are in
      // play (see handleRunCellpose), so no separate CLAHE flag is needed.
      // `diameter` drives the client-side rescale before the network call, so
      // it also invalidates the cache.
      const cacheKey = JSON.stringify({ u: sourceUrl, d: cfg.diameter ?? null });

      let cached = flowsCacheRef.current;
      if (!cached || cached.cacheKey !== cacheKey) {
        const fetchBanner = addBanner('Fetching flows from server...', 'loading', 0);
        try {
          const flows = await service.runCellposeFlows(sourceUrl, imageWidth, imageHeight, { diameter: cfg.diameter });
          cached = { cacheKey, ...flows };
          flowsCacheRef.current = cached;
        } finally {
          removeBanner(fetchBanner);
        }
      }

      // Local mask gen via Pyodide.
      const mask = await maskGen.compute(
        cached.dP,
        cached.cellprob,
        cached.scaledH,
        cached.scaledW,
        {
          niter: cfg.niter && cfg.niter > 0 ? cfg.niter : 200,
          cellprob_threshold: cfg.cellprob_threshold,
          flow_threshold: cfg.flow_threshold,
          // Cellpose's min_size is in (downsampled) network-space pixels.
          // The colab UI's min_mask_area is in display-space pixels²; the
          // polygonisation pass below also filters by display area, so the
          // network-space drop here is intentionally permissive.
          min_size: 1,
          max_size_fraction: 0.4,
        },
      );

      const polygons = maskDataToPolygons(
        mask.data,
        cached.scaledW,
        cached.scaledH,
        cached.displayW,
        cached.displayH,
        cfg.min_mask_area ?? 0,
      );

      const vs = getVectorSource?.();
      if (vs && !livePreviewReady) {
        // Only the first server-fetched run snapshots undo. Subsequent live
        // recomputes replace the preview features in place; user can still
        // get back to pre-Cellpose state via Ctrl+Z.
        const GeoJSON = (await import('ol/format/GeoJSON')).default;
        const fmt = new GeoJSON();
        const baseline = vs.getFeatures().filter((f) => !f.get('_cellpose_preview'));
        pushUndo({ geojson: fmt.writeFeatures(baseline) });
      }
      const n = applyPolygonsAsPreview(vs ?? null, polygons);
      return n;
    },
    [
      service, imageWidth, imageHeight,
      addBanner, removeBanner, maskGen, getVectorSource,
      pushUndo, applyPolygonsAsPreview, livePreviewReady,
    ],
  );

  const handleRunCellpose = useCallback(async (cfgOverride?: CellposeConfig) => {
    const cfg = cfgOverride || cellposeConfig;
    if (!service || !imageUrl) return;
    // Segmentation uses the raw image by default. The "Use contrast enhanced
    // image" checkbox (only shown while CLAHE is active) opts a run into
    // sending the enhanced pixels instead.
    const useEnhanced = !!(cfg.useEnhancedImage && isCLAHEActive && claheEnhancedUrl);
    const sourceUrl = useEnhanced ? (claheEnhancedUrl as string) : imageUrl;
    console.log('[AnnotatePage] Running Cellpose on image:', sourceUrl, `(${imageWidth}x${imageHeight})`);
    setIsRunningCellpose(true);
    const bannerId = addBanner(
      cfg.backend === 'microsam' ? 'Running μSAM segmentation...' : 'Running Cellpose segmentation...',
      'loading',
      0,
    );
    try {
      // μSAM automatic segmentation is a server-side infer drop-in: no flows,
      // no Pyodide mask-gen, no tuning knobs. Handle it in its own branch and
      // route the masks through the same preview + undo machinery Cellpose uses.
      if (cfg.backend === 'microsam') {
        try {
          let masks;
          if (useEnhanced) {
            // Bypass the stored (raw) embedding entirely: infer directly on
            // the enhanced pixels so the shared raw embedding is never
            // overwritten with enhanced data.
            masks = await service.runMicroSam(claheEnhancedUrl as string, imageWidth, imageHeight, {
              min_mask_area: cfg.min_mask_area,
            });
          } else {
            // Reuse the precomputed embedding: AIS runs fully server-side from
            // the stored `.npz` link (the browser never pulls the ~4 MB
            // features). Always anchored to the raw imageUrl, never enhanced
            // pixels, since this embedding is memoized for the whole session.
            const npzUrl = await ensureStoredEmbedding(
              currentImageStem ?? imageUrl,
              imageUrl,
              imageWidth,
              imageHeight,
            );
            masks = await service.runMicroSamFromEmbedding(npzUrl, imageWidth, imageHeight, {
              min_mask_area: cfg.min_mask_area,
            });
          }
          let n = 0;
          if (masks && masks.length > 0) {
            const vs = getVectorSource?.();
            if (vs) {
              const GeoJSON = (await import('ol/format/GeoJSON')).default;
              const fmt = new GeoJSON();
              pushUndo({ geojson: fmt.writeFeatures(vs.getFeatures()) });
              n = applyPolygonsAsPreview(vs, masks);
            }
          }
          removeBanner(bannerId);
          if (n === 0) {
            addBanner('No masks detected by μSAM', 'warning', 5000);
          } else {
            console.log('[AnnotatePage] micro-sam added', n, 'masks');
            addBanner(`Added ${n} mask${n !== 1 ? 's' : ''} from μSAM`, 'success', 5000);
          }
        } catch (msErr: any) {
          removeBanner(bannerId);
          const msg = msErr?.message || 'Unknown error';
          console.error('[AnnotatePage] micro-sam failed:', msg);
          addBanner('μSAM segmentation failed', 'error', 8000, msg);
        }
        return;
      }

      // Prefer the flows + Pyodide path when the kernel is healthy. If
      // anything throws, fall back to the all-server path so the user
      // always gets a result.
      let n: number | undefined;
      let usedLocalPath = false;
      if (kernelReady) {
        try {
          n = await runCellposeFlowsPipeline(cfg, sourceUrl);
          usedLocalPath = true;
        } catch (flowsErr: any) {
          console.warn(
            '[AnnotatePage] Flows-path failed, falling back to server mask-gen:',
            flowsErr,
          );
        }
      }

      if (!usedLocalPath) {
        const masks = await service.runCellpose(sourceUrl, imageWidth, imageHeight, {
          flow_threshold: cfg.flow_threshold,
          cellprob_threshold: cfg.cellprob_threshold,
          niter: cfg.niter,
          min_mask_area: cfg.min_mask_area,
          diameter: cfg.diameter,
        });
        if (masks && masks.length > 0) {
          const vs = getVectorSource?.();
          if (vs) {
            const GeoJSON = (await import('ol/format/GeoJSON')).default;
            const fmt = new GeoJSON();
            pushUndo({ geojson: fmt.writeFeatures(vs.getFeatures()) });
            n = applyPolygonsAsPreview(vs, masks);
          }
        } else {
          n = 0;
        }
      }

      removeBanner(bannerId);

      if (n === undefined || n === 0) {
        addBanner('No masks detected by Cellpose', 'warning', 5000);
        return;
      }
      console.log('[AnnotatePage] Cellpose added', n, 'masks (local=' + usedLocalPath + ')');
      if (usedLocalPath) setLivePreviewReady(true);
      addBanner(`Added ${n} mask${n !== 1 ? 's' : ''} from Cellpose`, 'success', 5000);
    } catch (err: any) {
      const fullError = err.message || 'Unknown error';
      console.error('[AnnotatePage] Cellpose failed:', fullError);
      removeBanner(bannerId);
      addBanner('Cellpose segmentation failed', 'error', 8000, fullError);
    } finally {
      setIsRunningCellpose(false);
    }
  }, [
    service, imageUrl, originalImageUrl, imageWidth, imageHeight,
    cellposeConfig, isCLAHEActive, claheEnhancedUrl, kernelReady, currentImageStem,
    ensureStoredEmbedding, runCellposeFlowsPipeline, applyPolygonsAsPreview,
    getVectorSource, pushUndo, addBanner, removeBanner,
  ]);

  // Re-run mask gen using the cached flows on every instant-config drag.
  // Debounced so a fast slider sweep only fires one Pyodide call.
  const handleInstantConfigChange = useCallback((cfg: CellposeConfig) => {
    if (!flowsCacheRef.current) return;
    if (instantRecomputeTimerRef.current) clearTimeout(instantRecomputeTimerRef.current);
    instantRecomputeTimerRef.current = setTimeout(async () => {
      try {
        // Match handleRunCellpose's sourceUrl choice so the cache key here
        // agrees with the one the last full run computed against.
        const useEnhanced = !!(cfg.useEnhancedImage && isCLAHEActive && claheEnhancedUrl);
        const sourceUrl = useEnhanced ? claheEnhancedUrl : (originalImageUrl || imageUrl);
        if (!sourceUrl) return;
        const n = await runCellposeFlowsPipeline(cfg, sourceUrl);
        if (n !== undefined) {
          console.log('[AnnotatePage] Live preview: %d masks', n);
        }
      } catch (err: any) {
        console.warn('[AnnotatePage] Live preview failed:', err);
      }
    }, 150);
  }, [imageUrl, originalImageUrl, isCLAHEActive, claheEnhancedUrl, runCellposeFlowsPipeline]);

  // Keep refs in sync so the config dialog's Run button + instant-config
  // callback can trigger the latest closures without a re-render of the dialog.
  React.useEffect(() => {
    runCellposeRef.current = handleRunCellpose;
  }, [handleRunCellpose]);
  React.useEffect(() => {
    instantConfigChangeRef.current = handleInstantConfigChange;
  }, [handleInstantConfigChange]);

  // Invalidate the flows cache whenever the source image changes — different
  // image, the cached network outputs no longer apply.
  React.useEffect(() => {
    invalidateFlowsCache();
    previewFeaturesRef.current = [];
  }, [imageUrl, invalidateFlowsCache]);

  // CLAHE toggling changes what the server sees, so the cached flows go
  // stale too.
  React.useEffect(() => {
    invalidateFlowsCache();
  }, [isCLAHEActive, invalidateFlowsCache]);

  const handleSave = useCallback(async () => {
    const vs = getVectorSource?.();
    if (!vs) return;

    const features = vs.getFeatures();
    if (features.length === 0) {
      console.log('[AnnotatePage] No annotations to save, skipping');
      addBanner('No annotations to save, skipping', 'warning', 5000);
      await advanceToNextImage();
      return;
    }

    if (!service || !currentImageStem) return;

    console.log('[AnnotatePage] Saving', features.length, 'annotations...');
    setIsSaving(true);
    const saveBannerId = addBanner('Saving annotation...', 'loading', 0);
    try {
      const saveUrls = await service.getSaveUrls(currentImageStem);
      console.log('[AnnotatePage] Got save URLs, timestamp:', saveUrls.timestamp);

      const geojson = exportGeoJSON(vs, imageWidth > 0 ? imageHeight : undefined);
      const geojsonBlob = new Blob([JSON.stringify(geojson, null, 2)], { type: 'application/json' });
      await fetch(saveUrls.geojson_put_url, { method: 'PUT', body: geojsonBlob });
      console.log('[AnnotatePage] Uploaded GeoJSON');

      const pngBlob = renderInstanceSegmentationPNG(vs, imageWidth, imageHeight);
      await fetch(saveUrls.png_put_url, { method: 'PUT', body: pngBlob });
      console.log('[AnnotatePage] Uploaded PNG mask');

      removeBanner(saveBannerId);
      addBanner('Annotation saved successfully', 'success', 5000);
      console.log('[AnnotatePage] Save complete');

      vs.clear();
      useAnnotationStore.setState({ undoStack: [], canUndo: false });
      await advanceToNextImage();
    } catch (err: any) {
      const fullError = err.message || 'Unknown error';
      console.error('[AnnotatePage] Save failed:', fullError);
      removeBanner(saveBannerId);
      if (/PermissionError/i.test(fullError) || /or higher is required/i.test(fullError)) {
        // Public datasets allow anonymous viewing but saving always
        // requires a Hypha login (colab-rework-plan.md F5, revised).
        addBanner('Log in to save annotations', 'warning', 8000);
        setPermissionDenied(true);
      } else {
        addBanner('Failed to save annotation', 'error', 8000, fullError);
        setError(fullError);
      }
    } finally {
      setIsSaving(false);
    }
  }, [service, currentImageStem, imageWidth, imageHeight, setError, getVectorSource, advanceToNextImage, addBanner, removeBanner]);

  const handleUndo = useCallback(() => {
    console.log('[AnnotatePage] Undo triggered');
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'z', ctrlKey: true }));
  }, []);

  const handleClearAll = useCallback(() => {
    const vs = getVectorSource?.();
    if (!vs || vs.getFeatures().length === 0) {
      addBanner('No annotations to clear', 'info', 3000);
      return;
    }
    setClearConfirmOpen(true);
  }, [getVectorSource, addBanner]);

  const handleConfirmClear = useCallback(() => {
    const vs = getVectorSource?.();
    if (vs) {
      const featureCount = vs.getFeatures().length;
      const GeoJSON = require('ol/format/GeoJSON').default;
      const fmt = new GeoJSON();
      pushUndo({ geojson: fmt.writeFeatures(vs.getFeatures()) });
      vs.clear();
      console.log('[AnnotatePage] Cleared', featureCount, 'annotations');
      addBanner('All annotations cleared', 'info', 3000);
    }
    setClearConfirmOpen(false);
  }, [getVectorSource, pushUndo, addBanner]);

  // CLAHE toggle handler
  const handleToggleCLAHE = useCallback(() => {
    if (isCLAHEActive) {
      // Restore original image
      const layer = getImageLayer?.();
      if (layer && originalImageUrl) {
        const source = layer.getSource() as Static;
        if (source) {
          layer.setSource(new Static({
            url: originalImageUrl,
            projection: source.getProjection()!,
            imageExtent: source.getImageExtent(),
            crossOrigin: 'anonymous',
          }));
        }
      }
      setIsCLAHEActive(false);
      setOriginalImageUrl(null);
      setClaheEnhancedUrl(null);
      console.log('[AnnotatePage] Restored original image');
      addBanner('Original image restored', 'info', 3000);
    } else {
      // The shared kernel (from ColabPage's KernelProvider) stays idle until
      // something asks for it. CLAHE is the only feature on this page that
      // needs Python, so request it here instead of on every page load.
      sharedKernel?.requestKernel?.();
      openCLAHEDialog();
    }
  }, [isCLAHEActive, getImageLayer, originalImageUrl, openCLAHEDialog, addBanner, sharedKernel]);

  const [isApplyingCLAHE, setIsApplyingCLAHE] = useState(false);

  const handleCLAHEApply = useCallback(async () => {
    if (!imageUrl || !executeCode || !kernelPackagesInstalled) return;
    const sourceUrl = originalImageUrl || imageUrl;

    setIsApplyingCLAHE(true);
    closeCLAHEDialog();
    const bannerId = addBanner('Applying CLAHE contrast enhancement...', 'loading', 0);

    try {
      // Fetch image as blob, convert to base64
      const res = await fetch(sourceUrl);
      const blob = await res.blob();
      const arrayBuffer = await blob.arrayBuffer();
      const bytes = new Uint8Array(arrayBuffer);
      let binary = '';
      for (let i = 0; i < bytes.length; i++) {
        binary += String.fromCharCode(bytes[i]);
      }
      const base64 = btoa(binary);

      // Send to Python kernel for CLAHE processing
      const { clipLimit, tileGridSize } = claheConfig;
      let resultBase64 = '';
      let hasError = false;

      await executeCode(`
import base64
import io
import numpy as np
from PIL import Image
from skimage import exposure

# Decode input image
img_bytes = base64.b64decode("""${base64}""")
img = Image.open(io.BytesIO(img_bytes))
img_array = np.array(img)

# Apply CLAHE
clip_limit = ${clipLimit / 100}
grid_size = ${tileGridSize}

if img_array.ndim == 2:
    enhanced = exposure.equalize_adapthist(img_array, kernel_size=grid_size, clip_limit=clip_limit)
    enhanced = (enhanced * 255).astype(np.uint8)
elif img_array.ndim == 3:
    # Apply to each channel or convert to LAB
    from skimage import color
    if img_array.shape[2] >= 3:
        lab = color.rgb2lab(img_array[:, :, :3])
        lab[:, :, 0] = exposure.equalize_adapthist(lab[:, :, 0] / 100, kernel_size=grid_size, clip_limit=clip_limit) * 100
        rgb_enhanced = color.lab2rgb(lab)
        enhanced = (rgb_enhanced * 255).astype(np.uint8)
        if img_array.shape[2] == 4:
            enhanced = np.dstack([enhanced, img_array[:, :, 3]])
    else:
        enhanced = img_array.copy()
        for c in range(img_array.shape[2]):
            enhanced[:, :, c] = (exposure.equalize_adapthist(img_array[:, :, c], kernel_size=grid_size, clip_limit=clip_limit) * 255).astype(np.uint8)
else:
    enhanced = img_array

# Encode result
result_img = Image.fromarray(enhanced)
buf = io.BytesIO()
result_img.save(buf, format='PNG')
result_b64 = base64.b64encode(buf.getvalue()).decode('ascii')
print("CLAHE_RESULT:" + result_b64)
`, {
        onOutput: (output) => {
          if (output.type === 'error') {
            hasError = true;
            console.error('[CLAHE Python]', output.content);
          } else if (output.content.startsWith('CLAHE_RESULT:')) {
            resultBase64 = output.content.substring('CLAHE_RESULT:'.length).trim();
          }
        },
      });

      if (hasError || !resultBase64) {
        removeBanner(bannerId);
        addBanner('CLAHE processing failed', 'error', 5000);
        setIsApplyingCLAHE(false);
        return;
      }

      // Apply result to OpenLayers layer
      const dataUrl = `data:image/png;base64,${resultBase64}`;
      const layer = getImageLayer?.();
      if (layer) {
        const source = layer.getSource() as Static;
        if (source) {
          if (!originalImageUrl) setOriginalImageUrl(imageUrl);
          layer.setSource(new Static({
            url: dataUrl,
            projection: source.getProjection()!,
            imageExtent: source.getImageExtent(),
          }));
        }
      }
      setIsCLAHEActive(true);
      setClaheEnhancedUrl(dataUrl);
      removeBanner(bannerId);
      addBanner('CLAHE contrast enhancement applied', 'success', 3000);
    } catch (err: any) {
      console.error('[AnnotatePage] CLAHE failed:', err);
      removeBanner(bannerId);
      addBanner('CLAHE failed: ' + (err.message || 'Unknown error'), 'error', 5000);
    } finally {
      setIsApplyingCLAHE(false);
    }
  }, [imageUrl, originalImageUrl, getImageLayer, executeCode, kernelPackagesInstalled, claheConfig, closeCLAHEDialog, addBanner, removeBanner]);

  const handleSaveUndo = useCallback(() => {
    const vs = getVectorSource?.();
    if (vs) {
      const GeoJSON = require('ol/format/GeoJSON').default;
      const fmt = new GeoJSON();
      pushUndo({ geojson: fmt.writeFeatures(vs.getFeatures()) });
    }
  }, [getVectorSource, pushUndo]);

  // Escape to cancel diameter measurement and reopen dialog
  useEffect(() => {
    if (measurePhase === 'idle') return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setMeasurePhase('idle');
        setMeasurePt1(null);
        setMeasureScreenPt1(null);
        setMeasureScreenMouse(null);
        measureCallbackRef.current = null;
        openCellposeConfig();
      }
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [measurePhase, openCellposeConfig]);

  const handleMeasureMouseMove = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
    if (measurePhase === 'idle') return;
    const rect = e.currentTarget.getBoundingClientRect();
    setMeasureScreenMouse([e.clientX - rect.left, e.clientY - rect.top]);
  }, [measurePhase]);

  const handleMeasureClick = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
    const map = getOlMap?.();
    if (!map) return;
    const coord = map.getEventCoordinate(e.nativeEvent);
    const rect = e.currentTarget.getBoundingClientRect();
    const screenPos: [number, number] = [e.clientX - rect.left, e.clientY - rect.top];

    if (measurePhase === 'first') {
      setMeasurePt1([coord[0], coord[1]]);
      setMeasureScreenPt1(screenPos);
      setMeasurePhase('second');
    } else if (measurePhase === 'second' && measurePt1) {
      const dx = coord[0] - measurePt1[0];
      const dy = coord[1] - measurePt1[1];
      const dist = Math.sqrt(dx * dx + dy * dy);
      measureCallbackRef.current?.(dist);
      measureCallbackRef.current = null;
      setMeasurePhase('idle');
      setMeasurePt1(null);
      setMeasureScreenPt1(null);
      setMeasureScreenMouse(null);
    }
  }, [measurePhase, measurePt1, getOlMap]);

  // Touch equivalents for the measurement overlay (mobile/tablet support)
  const handleMeasureTouchMove = useCallback((e: React.TouchEvent<HTMLDivElement>) => {
    if (measurePhase === 'idle') return;
    const touch = e.touches[0];
    if (!touch) return;
    const rect = e.currentTarget.getBoundingClientRect();
    setMeasureScreenMouse([touch.clientX - rect.left, touch.clientY - rect.top]);
  }, [measurePhase]);

  const handleMeasureTouchEnd = useCallback((e: React.TouchEvent<HTMLDivElement>) => {
    const map = getOlMap?.();
    if (!map) return;
    // Use changedTouches (the finger that was lifted)
    const touch = e.changedTouches[0];
    if (!touch) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const pixel: [number, number] = [touch.clientX - rect.left, touch.clientY - rect.top];
    const coord = map.getCoordinateFromPixel(pixel);
    const screenPos: [number, number] = pixel;

    if (measurePhase === 'first') {
      setMeasurePt1([coord[0], coord[1]]);
      setMeasureScreenPt1(screenPos);
      setMeasurePhase('second');
    } else if (measurePhase === 'second' && measurePt1) {
      const dx = coord[0] - measurePt1[0];
      const dy = coord[1] - measurePt1[1];
      const dist = Math.sqrt(dx * dx + dy * dy);
      measureCallbackRef.current?.(dist);
      measureCallbackRef.current = null;
      setMeasurePhase('idle');
      setMeasurePt1(null);
      setMeasureScreenPt1(null);
      setMeasureScreenMouse(null);
    }
  }, [measurePhase, measurePt1, getOlMap]);

  const handleUploadGeoJSON = useCallback((file: File) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const content = e.target?.result as string;
        const data = JSON.parse(content);
        const vs = getVectorSource?.();
        if (vs) {
          handleSaveUndo(); // Save current state to undo stack before loading
          importGeoJSON(vs, data, imageHeight, activeLabel);
          addBanner('GeoJSON loaded successfully', 'success');
        }
      } catch (err: any) {
        console.error('Failed to parse GeoJSON:', err);
        addBanner('Failed to load GeoJSON: ' + err.message, 'error');
      }
    };
    reader.readAsText(file);
  }, [getVectorSource, imageHeight, activeLabel, addBanner, handleSaveUndo]);

  if (!serviceConfig) {
    return (
      <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100vh', p: 4 }}>
        <Alert severity="warning">
          Missing service configuration. URL must include <code>session_id</code> and <code>label</code> parameters.
        </Alert>
      </Box>
    );
  }

  // AI Box readiness (12A): the service being reachable (microSamAvailable) is
  // not enough to draw a useful box — the ONNX decoder and this image's stored
  // embedding both need to finish warming up first. ToolBar shows a spinner
  // for the gap between "available" and "ready"; AnnotationViewer only installs
  // the box-draw interaction once actually ready.
  const embeddingReady = embeddingReadyStem !== null && embeddingReadyStem === currentImageStem;
  const aiBoxReady = microSamAvailable && embeddingReady && decoderReady;

  // Determine the status message for the overlay
  const showStatusOverlay = !permissionDenied && (
    serviceLoading || serviceError || (!hasLoadedOnce && !error) || (error && !hasLoadedOnce)
  );
  let statusMessage = '';
  let statusSeverity: 'info' | 'error' = 'info';
  let statusHeading = '';
  let statusBody = '';
  if (serviceLoading) {
    statusMessage = 'Connecting to annotation service...';
  } else if (serviceError || (error && !hasLoadedOnce)) {
    // The raw message can be a full Ray traceback (broker/service errors
    // cross the wire as plain str(exception), not a typed error) — log it
    // for debugging but show a short, classified message to the user.
    statusSeverity = 'error';
    const rawMessage = serviceError || error || '';
    console.error('[AnnotatePage] Connection error:', rawMessage);
    const errorCode = classifyBrokerError(rawMessage);
    statusHeading = errorCode === 'not-registered'
      ? 'This dataset could not be found'
      : errorCode === 'unavailable'
        ? 'Annotation service is unavailable'
        : 'Something went wrong';
    statusBody = errorCode === 'not-registered'
      ? 'It may have been deleted, or the link is incorrect.'
      : errorCode === 'unavailable'
        ? 'The annotation service is temporarily down. Try again in a moment.'
        : 'There was a problem connecting to the annotation service.';
  } else if (!hasLoadedOnce && !error) {
    statusMessage = 'Loading image...';
  }

  return (
    <Box
      sx={{ position: 'relative', height: '100vh', overflow: 'hidden' }}
      style={{ '--annotate-header-h': isMobile ? '48px' : '40px' } as React.CSSProperties}
    >
      {/* Floating header bar (Google-Maps-like: spans full width, overlays the
          fullscreen viewer rather than pushing it down) */}
      <div
        className="flex items-center justify-between px-3 bg-gradient-to-r from-blue-100/90 via-purple-100/85 to-cyan-100/90 backdrop-blur-lg border-b border-blue-200/40 shadow-sm"
        style={{ position: 'absolute', top: 0, left: 0, right: 0, zIndex: 1200, height: isMobile ? 48 : 40 }}
      >
        <div className="flex items-center gap-2 z-10 flex-shrink-0">
          {sessionUrl && (
            <Tooltip title="Go back to the Colab session: view all images, annotation progress, and training">
              <MuiButton
                size="small"
                variant="outlined"
                startIcon={<span style={{ fontSize: 14, lineHeight: 1 }}>←</span>}
                onClick={() => navigate(backTarget)}
                sx={{
                  minWidth: 'auto',
                  padding: isMobile ? '5px 8px' : '3px 10px',
                  color: '#1976d2',
                  borderColor: 'rgba(25,118,210,0.45)',
                  bgcolor: 'rgba(255,255,255,0.7)',
                  fontSize: '0.75rem',
                  fontWeight: 600,
                  textTransform: 'none',
                  borderRadius: 2,
                  '&:hover': {
                    bgcolor: 'rgba(25,118,210,0.08)',
                    borderColor: '#1976d2',
                  }
                }}
              >
                {/* Hide text on phones to save space */}
                <Box component="span" sx={{ display: { xs: 'none', sm: 'inline' } }}>
                  Session overview
                </Box>
              </MuiButton>
            </Tooltip>
          )}
        </div>

        <div className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 flex items-center gap-2">
          <Link to="/" className="flex items-center group flex-shrink-0">
            <img
              src={`${process.env.PUBLIC_URL}/static/img/bioimage-io-logo.svg`}
              alt="BioImage.IO"
              className="h-7 group-hover:scale-105 transition-transform duration-300"
            />
          </Link>
          {serviceConfig?.label && (
            <span className="px-2 py-0.5 rounded-full text-xs font-semibold bg-purple-100 text-purple-800 border border-purple-300 tracking-wide max-w-[120px] truncate sm:max-w-none">
              {serviceConfig.label}
            </span>
          )}
          {serviceConfig?.microSamSession && (
            <Tooltip title={`Using the fine-tuned model from session ${serviceConfig.microSamSession.sessionId}`}>
              <span className="px-2 py-0.5 rounded-full text-xs font-semibold bg-emerald-100 text-emerald-800 border border-emerald-300 tracking-wide">
                Fine-tuned model
              </span>
            </Tooltip>
          )}
        </div>

        <div className="z-10 flex-shrink-0">
          <LoginButton />
        </div>
      </div>

      {/* Fullscreen annotation area — the viewer fills the entire route;
          tools and actions float on top as separate edge-anchored panels
          (left/right in landscape, top/bottom in portrait). */}
      <Box sx={{ position: 'absolute', inset: 0, overflow: 'hidden' }}>
      <ToolBar
        onOpenCellposeConfig={openCellposeConfig}
        cellposeConfigOpen={cellposeConfigOpen}
        cellposeAvailable={cellposeAvailable}
        microSamAvailable={microSamAvailable}
        aiBoxReady={aiBoxReady}
        isRunningCellpose={isRunningCellpose}
        disabled={!!permissionDenied}
      />
      <ActionPanel
        onSave={handleSave}
        onUndo={handleUndo}
        onResetView={() => resetView?.()}
        onZoomIn={handleZoomIn}
        onZoomOut={handleZoomOut}
        onClearAll={handleClearAll}
        onToggleCLAHE={handleToggleCLAHE}
        onOpenMaskFilter={() => setMaskFilterOpen(true)}
        onHelp={() => setHelpOpen(true)}
        onUploadGeoJSON={handleUploadGeoJSON}
        imageName={currentImageStem || undefined}
        isSaving={isSaving}
        isCLAHEActive={isCLAHEActive}
        isLowContrast={isLowContrast}
        disabled={!!permissionDenied}
      />
      {/* Bounded to the area below the floating header bar (not the full page
          height), so the map's own fit-to-image centering matches what is
          actually visible instead of centering behind the header. */}
      <Box sx={{ position: 'absolute', top: 'var(--annotate-header-h)', left: 0, right: 0, bottom: 0 }}>
        {imageUrl && !allAnnotatedInfo && !noImagesInfo && (
          <AnnotationViewer
            imageUrl={imageUrl}
            imageWidth={imageWidth}
            imageHeight={imageHeight}
            onResetViewReady={handleResetViewReady}
            onVectorSourceReady={handleVectorSourceReady}
            onImageLayerReady={handleImageLayerReady}
            onMapReady={handleMapReady}
            onSamBox={handleSamBox}
            microSamAvailable={aiBoxReady}
          />
        )}

        {/* Diameter measurement overlay */}
        {measurePhase !== 'idle' && (
          <Box
            sx={{ position: 'absolute', inset: 0, zIndex: 500, cursor: 'crosshair', touchAction: 'none' }}
            onClick={handleMeasureClick}
            onMouseMove={handleMeasureMouseMove}
            onTouchMove={handleMeasureTouchMove}
            onTouchEnd={handleMeasureTouchEnd}
          >
            {/* Instruction banner */}
            <Box sx={{
              position: 'absolute', top: 16, left: '50%', transform: 'translateX(-50%)',
              bgcolor: 'rgba(0,0,0,0.78)', color: '#fff',
              px: { xs: 2, sm: 3 }, py: 1.25, borderRadius: 2,
              fontSize: { xs: '0.8rem', sm: '0.875rem' }, pointerEvents: 'none', zIndex: 10,
              display: 'flex', alignItems: 'center', gap: { xs: 1, sm: 2 },
              whiteSpace: 'normal', textAlign: 'center',
              maxWidth: { xs: 'calc(100% - 32px)', sm: 'none' },
            }}>
              {measurePhase === 'first'
                ? 'Tap one edge of a representative object'
                : 'Tap the opposite edge to complete measurement'}
              <Box component="span" sx={{ fontSize: '0.75rem', opacity: 0.65, display: { xs: 'none', sm: 'inline' } }}>Esc to cancel</Box>
            </Box>

            {/* SVG ruler line */}
            {measureScreenPt1 && measureScreenMouse && (
              <svg style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', pointerEvents: 'none' }}>
                <line
                  x1={measureScreenPt1[0]} y1={measureScreenPt1[1]}
                  x2={measureScreenMouse[0]} y2={measureScreenMouse[1]}
                  stroke="rgba(255,220,0,0.9)" strokeWidth={2} strokeDasharray="6,3"
                />
                <circle cx={measureScreenPt1[0]} cy={measureScreenPt1[1]} r={5} fill="rgba(255,220,0,0.9)" />
                <circle cx={measureScreenMouse[0]} cy={measureScreenMouse[1]} r={4} fill="rgba(255,220,0,0.75)" />
              </svg>
            )}
            {measureScreenPt1 && !measureScreenMouse && (
              <svg style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', pointerEvents: 'none' }}>
                <circle cx={measureScreenPt1[0]} cy={measureScreenPt1[1]} r={5} fill="rgba(255,220,0,0.9)" />
              </svg>
            )}
          </Box>
        )}

        {allAnnotatedInfo && (
          <Box
            sx={{
              position: 'absolute',
              inset: 0,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              bgcolor: 'rgba(0,0,0,0.03)',
              zIndex: 1100,
            }}
          >
            <Box
              sx={{
                textAlign: 'center',
                p: 5,
                maxWidth: 480,
                bgcolor: 'white',
                borderRadius: 3,
                boxShadow: '0 8px 32px rgba(0,0,0,0.12)',
              }}
            >
              <CheckCircleOutlineIcon sx={{ fontSize: 64, color: 'success.main', mb: 2 }} />
              <Typography variant="h5" fontWeight={600} gutterBottom>
                All Images Annotated
              </Typography>
              <Typography variant="body1" color="text.secondary" sx={{ mb: 3 }}>
                {allAnnotatedInfo.message}
              </Typography>
              <Box sx={{ display: 'flex', gap: 1.5, justifyContent: 'center', flexWrap: 'wrap' }}>
                <MuiButton
                  variant="contained"
                  color="primary"
                  onClick={() => advanceToNextImage()}
                  sx={{ textTransform: 'none' }}
                >
                  Check for new images
                </MuiButton>
                <MuiButton
                  variant="outlined"
                  color="primary"
                  onClick={handleOpenRefinePicker}
                  sx={{ textTransform: 'none' }}
                >
                  Browse images
                </MuiButton>
              </Box>
            </Box>
          </Box>
        )}

        {noImagesInfo && (
          <Box
            sx={{
              position: 'absolute',
              inset: 0,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              bgcolor: 'rgba(0,0,0,0.03)',
              zIndex: 1100,
            }}
          >
            <Box
              sx={{
                textAlign: 'center',
                p: 5,
                maxWidth: 480,
                bgcolor: 'white',
                borderRadius: 3,
                boxShadow: '0 8px 32px rgba(0,0,0,0.12)',
              }}
            >
              <Typography variant="h5" fontWeight={600} gutterBottom>
                No Images Available
              </Typography>
              <Typography variant="body1" color="text.secondary" sx={{ mb: 3 }}>
                {noImagesInfo.message}
              </Typography>
              <MuiButton variant="outlined" onClick={() => advanceToNextImage()}>
                Retry
              </MuiButton>
            </Box>
          </Box>
        )}

        {permissionDenied && (
          <Box
            sx={{
              position: 'absolute',
              inset: 0,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              bgcolor: 'rgba(0,0,0,0.03)',
              zIndex: 1100,
            }}
          >
            <Box
              sx={{
                textAlign: 'center',
                p: 5,
                maxWidth: 480,
                bgcolor: 'white',
                borderRadius: 3,
                boxShadow: '0 8px 32px rgba(0,0,0,0.12)',
              }}
            >
              {user?.email ? (
                <>
                  <Typography variant="h5" fontWeight={600} gutterBottom>
                    Access needed
                  </Typography>
                  <Typography variant="body1" color="text.secondary" sx={{ mb: 3 }}>
                    This dataset is private and {user.email} does not have access to it yet. Request access
                    and an owner or manager can grant it.
                  </Typography>
                  {requestAccessState === 'requested' ? (
                    <Typography variant="body2" color="success.main" sx={{ fontWeight: 500 }}>
                      Access requested. An owner or manager will need to approve it.
                    </Typography>
                  ) : (
                    <Box sx={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 1 }}>
                      <MuiButton
                        variant="contained"
                        onClick={handleRequestAccess}
                        disabled={requestAccessState === 'requesting'}
                      >
                        {requestAccessState === 'requesting' ? 'Requesting...' : 'Request access'}
                      </MuiButton>
                      {requestAccessState === 'error' && (
                        <Typography variant="body2" color="error.main">
                          {requestAccessError}
                        </Typography>
                      )}
                    </Box>
                  )}
                </>
              ) : (
                <>
                  <Typography variant="h5" fontWeight={600} gutterBottom>
                    Log in to continue
                  </Typography>
                  <Typography variant="body1" color="text.secondary" sx={{ mb: 3 }}>
                    This dataset is private. Log in with an account that has access to view and annotate it.
                  </Typography>
                  <Box sx={{ display: 'flex', justifyContent: 'center' }}>
                    <LoginButton />
                  </Box>
                </>
              )}
            </Box>
          </Box>
        )}

        {(showStatusOverlay || isLoadingImage || isSaving || isRunningCellpose) && (
          <Box
            sx={{
              position: 'absolute',
              inset: 0,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              flexDirection: 'column',
              gap: 2,
              bgcolor: 'rgba(0,0,0,0.35)',
              zIndex: 1100,
              pointerEvents: showStatusOverlay ? 'all' : 'all',
            }}
          >
            {statusSeverity === 'error' ? (
              <Box
                sx={{
                  bgcolor: '#fff',
                  borderRadius: 3,
                  p: 3,
                  maxWidth: 360,
                  textAlign: 'center',
                  boxShadow: '0 8px 32px rgba(0,0,0,0.25)',
                }}
              >
                <Typography variant="subtitle1" fontWeight={600} gutterBottom>
                  {statusHeading}
                </Typography>
                <Typography variant="body2" color="text.secondary" sx={{ mb: 2.5 }}>
                  {statusBody}
                </Typography>
                <MuiButton variant="contained" onClick={handleRetryConnection}>
                  Try again
                </MuiButton>
              </Box>
            ) : (
              <>
                <CircularProgress size={48} sx={{ color: '#fff' }} />
                {statusMessage && (
                  <Typography variant="body2" sx={{ color: '#fff' }}>{statusMessage}</Typography>
                )}
              </>
            )}
          </Box>
        )}

        <FloatingBanners banners={banners} />
      </Box>

      <ConfirmDialog
        open={clearConfirmOpen}
        title="Clear All Annotations"
        message="Are you sure you want to clear all annotations? This action can be undone with Ctrl+Z."
        confirmLabel="Clear All"
        cancelLabel="Cancel"
        onConfirm={handleConfirmClear}
        onCancel={() => setClearConfirmOpen(false)}
      />

      {cellposeDialogElement}

      <CLAHEDialog
        open={claheDialogOpen}
        config={claheConfig}
        onConfigChange={setClaheConfig}
        onApply={handleCLAHEApply}
        onClose={closeCLAHEDialog}
        kernelReady={kernelPackagesInstalled}
        isApplying={isApplyingCLAHE}
      />

      <MaskFilterDialog
        open={maskFilterOpen}
        onClose={() => setMaskFilterOpen(false)}
        getVectorSource={getVectorSource}
        onSaveUndo={handleSaveUndo}
        onBanner={addBanner}
      />

      {/* Never show the first-visit tutorial on top of the connecting/error
          overlay (bug reported by keen-puma) — it stays queued in `helpOpen`
          and appears once the overlay clears. */}
      <HelpTutorial open={helpOpen && !showStatusOverlay} onClose={() => setHelpOpen(false)} />

      <Dialog
        open={refinePickerOpen}
        onClose={() => setRefinePickerOpen(false)}
        maxWidth="sm"
        fullWidth
      >
        <DialogTitle>
          Browse images
        </DialogTitle>
        <DialogContent dividers sx={{ p: 0 }}>
          {!datasetIndex ? (
            <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'center', py: 4 }}>
              <CircularProgress size={28} />
            </Box>
          ) : datasetIndex.images.length === 0 ? (
            <Box sx={{ p: 3, textAlign: 'center' }}>
              <Typography variant="body2" color="text.secondary">
                No images in this dataset.
              </Typography>
            </Box>
          ) : (
            <List dense sx={{ maxHeight: 360, overflowY: 'auto' }}>
              {datasetIndex.images.map((img) => {
                const isAnnotated = Boolean(
                  serviceConfig && datasetIndex.my_annotations[serviceConfig.label]?.[img.stem],
                );
                return (
                  <ListItemButton
                    key={img.stem}
                    onClick={() => handlePickRefineImage(img.stem)}
                  >
                    <ListItemIcon sx={{ minWidth: 36 }}>
                      {isAnnotated ? (
                        <CheckCircleOutlineIcon sx={{ color: 'success.main', fontSize: 20 }} />
                      ) : (
                        <Box sx={{ width: 20, height: 20 }} />
                      )}
                    </ListItemIcon>
                    <ListItemText
                      primary={img.stem}
                      secondary={isAnnotated ? 'Annotated' : 'Not annotated'}
                    />
                  </ListItemButton>
                );
              })}
            </List>
          )}
        </DialogContent>
        <DialogActions>
          <MuiButton onClick={() => setRefinePickerOpen(false)} sx={{ textTransform: 'none' }}>
            Cancel
          </MuiButton>
        </DialogActions>
      </Dialog>
      </Box>
    </Box>
  );
};

export default AnnotatePage;
