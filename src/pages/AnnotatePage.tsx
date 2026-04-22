import React, { useEffect, useState, useCallback, useMemo, useRef } from 'react';
import { useLocation, Link, useNavigate } from 'react-router-dom';
import { Box, CircularProgress, Typography, Alert, Button as MuiButton, Tooltip } from '@mui/material';
import LoginButton from '../components/LoginButton';
import AnnotationViewer from '../components/annotate/AnnotationViewer';
import ToolBar from '../components/annotate/ToolBar';
import ConfirmDialog from '../components/annotate/ConfirmDialog';
import FloatingBanners, { useBanners } from '../components/annotate/FloatingBanners';
import { useCellposeConfig, DEFAULT_CELLPOSE_CONFIG, CellposeConfig } from '../components/annotate/CellposeConfigDialog';
import CLAHEDialog, { useCLAHE } from '../components/annotate/CLAHEDialog';
import { useColabKernel } from '../components/colab/useColabKernel';
import { useSharedKernelIfAvailable } from '../components/colab/KernelContext';
import MaskFilterDialog from '../components/annotate/MaskFilterDialog';
import HelpTutorial from '../components/annotate/HelpTutorial';
import { useHyphaService, AnnotationServiceConfig, AllAnnotatedResult, NoImagesResult } from '../components/annotate/hooks/useHyphaService';
import CheckCircleOutlineIcon from '@mui/icons-material/CheckCircleOutline';
import { exportGeoJSON, renderInstanceSegmentationPNG, importGeoJSON } from '../components/annotate/exportAnnotation';
import { useAnnotationStore } from '../store/annotationStore';
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

  const serviceConfig = useMemo<AnnotationServiceConfig | null>(() => {
    const searchParams = new URLSearchParams(location.search);
    const serverUrl = searchParams.get('server_url') || searchParams.get('serverUrl');
    const imageProviderId = searchParams.get('image_provider_id') || searchParams.get('imageProviderId');
    const label = searchParams.get('label') || undefined;
    if (!serverUrl || !imageProviderId) return null;
    return { serverUrl, imageProviderId, label };
  }, [location.search]);

  // Read cellpose model from URL (set by the session owner in the Colab page)
  const cellposeModelId = useMemo(() => {
    const searchParams = new URLSearchParams(location.search);
    return searchParams.get('cellpose_model') || undefined;
  }, [location.search]);

  // Read session ID from URL for "View Session" link
  const sessionId = useMemo(() => {
    const searchParams = new URLSearchParams(location.search);
    return searchParams.get('session_id') || undefined;
  }, [location.search]);

  const sessionUrl = useMemo(() => {
    if (!sessionId) return null;
    const labelParam = serviceConfig?.label ? `?label=${encodeURIComponent(serviceConfig.label)}` : '';
    return `${window.location.origin}${window.location.pathname}#/colab/${sessionId}${labelParam}`;
  }, [sessionId, serviceConfig?.label]);

  const backTarget = useMemo(() => {
    if (sessionId) {
      const labelParam = serviceConfig?.label ? `?label=${encodeURIComponent(serviceConfig.label)}` : '';
      return `/colab/${sessionId}${labelParam}`;
    }
    return backTo || '/colab';
  }, [sessionId, serviceConfig?.label, backTo]);

  const { service, loading: serviceLoading, error: serviceError, cellposeAvailable } = useHyphaService(serviceConfig);
  const { banners, addBanner, removeBanner } = useBanners();
  const runCellposeRef = React.useRef<(config: CellposeConfig) => void>(() => {});
  const [isRunningCellpose, setIsRunningCellpose] = useState(false);
  
  const [dynamicCellposeModel, setDynamicCellposeModel] = useState<string | undefined>(undefined);
  
  const { config: cellposeConfig, openDialog: openCellposeConfig, dialogElement: cellposeDialogElement, setConfig: setCellposeConfig } = useCellposeConfig({
    onRun: (config) => runCellposeRef.current(config),
    isRunning: isRunningCellpose,
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
  
  // Use either the dynamically loaded model or the one from the URL (for backward compatibility)
  const activeCellposeModel = dynamicCellposeModel || cellposeModelId || DEFAULT_CELLPOSE_CONFIG.model;
  
  // Sync the loaded model to the config dialog if it changes
  useEffect(() => {
    if (activeCellposeModel && activeCellposeModel !== cellposeConfig.model) {
      setCellposeConfig((prev: CellposeConfig) => ({ ...prev, model: activeCellposeModel }));
    }
  }, [activeCellposeModel, cellposeConfig.model, setCellposeConfig]);

  const { claheConfig, setClaheConfig, dialogOpen: claheDialogOpen, openDialog: openCLAHEDialog, closeDialog: closeCLAHEDialog } = useCLAHE();
  
  // Always call both hooks unconditionally (required by React Rules of Hooks)
  // Use shared kernel if available (when called from Colab), otherwise use local kernel
  const sharedKernel = useSharedKernelIfAvailable();
  const localKernel = useColabKernel();
  
  const kernel = sharedKernel || localKernel;
  const kernelReady = kernel.isReady;
  const executeCode = kernel.executeCode;
  
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

  const imageUrl = useAnnotationStore((s) => s.imageUrl);
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
  const [currentImageName, setCurrentImageName] = useState<string | null>(null);
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
  const [isCLAHEActive, setIsCLAHEActive] = useState(false);
  const [originalImageUrl, setOriginalImageUrl] = useState<string | null>(null);
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

  const [allAnnotatedInfo, setAllAnnotatedInfo] = useState<AllAnnotatedResult | null>(null);
  const [noImagesInfo, setNoImagesInfo] = useState<NoImagesResult | null>(null);

  const loadNewImage = useCallback(async (showBanner = true) => {
    if (!service) return;
    setIsLoadingImage(true);
    setError(null);
    setAllAnnotatedInfo(null);
    setNoImagesInfo(null);
    setIsCLAHEActive(false);
    setOriginalImageUrl(null);
    console.log('[AnnotatePage] Loading new image...');
    const bannerId = showBanner ? addBanner('Loading new image...', 'loading', 0) : 0;
    try {
      const result = await service.getImage();

      // Check for terminal status responses
      if (result && typeof result === 'object' && 'status' in result) {
        if (result.status === 'all_annotated') {
          console.log('[AnnotatePage] All images annotated:', result);
          setAllAnnotatedInfo(result as AllAnnotatedResult);
          setHasLoadedOnce(true);
          return;
        }
        if (result.status === 'no_images') {
          console.log('[AnnotatePage] No images available:', result);
          setNoImagesInfo(result as NoImagesResult);
          setHasLoadedOnce(true);
          return;
        }
      }

      const imageResult = result as { url: string; name: string; cellpose_model?: string };
      const url = imageResult.url;
      const imageName = imageResult.name || url.split('/').pop()?.split('?')[0] || 'image.png';

      if (imageResult.cellpose_model) {
        setDynamicCellposeModel(imageResult.cellpose_model);
      }

      console.log('[AnnotatePage] Got image URL for:', imageName);
      setCurrentImageName(imageName);

      const img = new Image();
      img.crossOrigin = 'anonymous';
      img.src = url;
      await new Promise<void>((resolve, reject) => {
        img.onload = () => resolve();
        img.onerror = () => reject(new Error('Failed to load image'));
      });
      console.log('[AnnotatePage] Image loaded:', img.naturalWidth, 'x', img.naturalHeight);
      setImageInfo(url, img.naturalWidth, img.naturalHeight);
      setHasLoadedOnce(true);
    } catch (err: any) {
      console.error('[AnnotatePage] Image load failed:', err);
      setError(err.message || 'Failed to load image');
    } finally {
      setIsLoadingImage(false);
      if (bannerId) removeBanner(bannerId);
    }
  }, [service, setImageInfo, setError, addBanner, removeBanner]);

  // Load the first image once the service is ready
  useEffect(() => {
    if (!service || hasLoadedOnce) return;
    setIsLoading(true);
    loadNewImage(false).finally(() => setIsLoading(false));
  }, [service, hasLoadedOnce, loadNewImage, setIsLoading]);

  const handleRunCellpose = useCallback(async (cfgOverride?: CellposeConfig) => {
    const cfg = cfgOverride || cellposeConfig;
    if (!service || !imageUrl) return;
    const sourceUrl = originalImageUrl || imageUrl;
    console.log('[AnnotatePage] Running Cellpose on image:', sourceUrl, `(${imageWidth}x${imageHeight})`);
    setIsRunningCellpose(true);
    const bannerId = addBanner('Running Cellpose segmentation...', 'loading', 0);
    try {
      const masks = await service.runCellpose(sourceUrl, imageWidth, imageHeight, {
        model: cfg.model,
        diameter: cfg.diameter,
        flow_threshold: cfg.flow_threshold,
        cellprob_threshold: cfg.cellprob_threshold,
        niter: cfg.niter,
        min_mask_area: cfg.min_mask_area,
        enable_clahe: isCLAHEActive || undefined,
      });

      removeBanner(bannerId);

      if (!masks || masks.length === 0) {
        console.log('[AnnotatePage] Cellpose returned no masks');
        addBanner('No masks detected by Cellpose', 'warning', 5000);
        return;
      }

      console.log('[AnnotatePage] Cellpose returned', masks.length, 'masks');

      const vs = getVectorSource?.();
      if (vs) {
        const GeoJSON = (await import('ol/format/GeoJSON')).default;
        const fmt = new GeoJSON();
        pushUndo({ geojson: fmt.writeFeatures(vs.getFeatures()) });

        for (const mask of masks) {
          const polygon = new OlPolygon(mask.coordinates);
          const feature = new Feature({ geometry: polygon });
          feature.setProperties({
            label: `cell_${mask.label}`,
            edge_color: '#0084ff',
            face_color: '#0084ff',
            edge_width: 2,
          });
          vs.addFeature(feature);
        }
        console.log('[AnnotatePage] Added', masks.length, 'cellpose masks to canvas');
      }

      addBanner(`Added ${masks.length} mask${masks.length !== 1 ? 's' : ''} from Cellpose`, 'success', 5000);
    } catch (err: any) {
      const fullError = err.message || 'Unknown error';
      console.error('[AnnotatePage] Cellpose failed:', fullError);
      removeBanner(bannerId);
      addBanner('Cellpose segmentation failed', 'error', 8000, fullError);
    } finally {
      setIsRunningCellpose(false);
    }
  }, [service, imageUrl, originalImageUrl, imageWidth, imageHeight, cellposeConfig, getVectorSource, pushUndo, addBanner, removeBanner]);

  // Keep ref in sync so the config dialog's Run button can trigger cellpose
  React.useEffect(() => {
    runCellposeRef.current = handleRunCellpose;
  }, [handleRunCellpose]);

  const handleSave = useCallback(async () => {
    const vs = getVectorSource?.();
    if (!vs) return;

    const features = vs.getFeatures();
    if (features.length === 0) {
      console.log('[AnnotatePage] No annotations to save, skipping');
      addBanner('No annotations to save, skipping', 'warning', 5000);
      await loadNewImage();
      return;
    }

    console.log('[AnnotatePage] Saving', features.length, 'annotations...');
    setIsSaving(true);
    const saveBannerId = addBanner('Saving annotation...', 'loading', 0);
    try {
      const imageName = currentImageName || imageUrl?.split('/').pop()?.split('?')[0] || 'annotation.png';

      if (service) {
        const saveUrls = await service.getSaveUrls(imageName);
        console.log('[AnnotatePage] Got save URLs for:', saveUrls.image_stem);

        const geojson = exportGeoJSON(vs, imageWidth > 0 ? imageHeight : undefined);
        const geojsonBlob = new Blob([JSON.stringify(geojson, null, 2)], { type: 'application/json' });
        await fetch(saveUrls.geojson_url, { method: 'PUT', body: geojsonBlob });
        console.log('[AnnotatePage] Uploaded GeoJSON');

        const pngBlob = renderInstanceSegmentationPNG(vs, imageWidth, imageHeight);
        await fetch(saveUrls.png_url, { method: 'PUT', body: pngBlob });
        console.log('[AnnotatePage] Uploaded PNG mask');
      }

      removeBanner(saveBannerId);
      addBanner('Annotation saved successfully', 'success', 5000);
      console.log('[AnnotatePage] Save complete');

      vs.clear();
      useAnnotationStore.setState({ undoStack: [], canUndo: false });
      await loadNewImage();
    } catch (err: any) {
      const fullError = err.message || 'Unknown error';
      console.error('[AnnotatePage] Save failed:', fullError);
      removeBanner(saveBannerId);
      addBanner('Failed to save annotation', 'error', 8000, fullError);
      setError(fullError);
    } finally {
      setIsSaving(false);
    }
  }, [service, imageUrl, originalImageUrl, imageWidth, imageHeight, setError, getVectorSource, loadNewImage, addBanner, removeBanner]);

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
      console.log('[AnnotatePage] Restored original image');
      addBanner('Original image restored', 'info', 3000);
    } else {
      openCLAHEDialog();
    }
  }, [isCLAHEActive, getImageLayer, originalImageUrl, openCLAHEDialog, addBanner]);

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

  const hasCustomCellposeConfig = useMemo(() => {
    return (
      cellposeConfig.model !== DEFAULT_CELLPOSE_CONFIG.model ||
      cellposeConfig.diameter !== DEFAULT_CELLPOSE_CONFIG.diameter ||
      cellposeConfig.flow_threshold !== DEFAULT_CELLPOSE_CONFIG.flow_threshold ||
      cellposeConfig.cellprob_threshold !== DEFAULT_CELLPOSE_CONFIG.cellprob_threshold ||
      cellposeConfig.niter !== DEFAULT_CELLPOSE_CONFIG.niter ||
      cellposeConfig.min_mask_area !== DEFAULT_CELLPOSE_CONFIG.min_mask_area
    );
  }, [cellposeConfig]);

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
          Missing service configuration. URL must include <code>server_url</code> and <code>image_provider_id</code> parameters.
        </Alert>
      </Box>
    );
  }

  // Determine the status message for the overlay
  const showStatusOverlay = serviceLoading || serviceError || (!hasLoadedOnce && !error) || (error && !hasLoadedOnce);
  let statusMessage = '';
  let statusSeverity: 'info' | 'error' = 'info';
  if (serviceLoading) {
    statusMessage = 'Connecting to annotation service...';
  } else if (serviceError) {
    statusMessage = `Service connection failed: ${serviceError}`;
    statusSeverity = 'error';
  } else if (error && !hasLoadedOnce) {
    statusMessage = error;
    statusSeverity = 'error';
  } else if (!hasLoadedOnce && !error) {
    statusMessage = 'Loading image...';
  }

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', height: '100vh' }}>
      {/* Compact header with logo and user button */}
      <div
        className="flex items-center justify-between px-4 h-10 flex-shrink-0 bg-gradient-to-r from-blue-100/90 via-purple-100/85 to-cyan-100/90 backdrop-blur-lg border-b border-blue-200/40 shadow-sm"
        style={{ position: 'relative', zIndex: 1000 }}
      >
        <div className="flex items-center gap-2 z-10">
          {sessionUrl && (
            <Tooltip title="Go back to the Colab session — view all images, annotation progress, and training">
              <MuiButton
                size="small"
                variant="outlined"
                startIcon={<span style={{ fontSize: 14, lineHeight: 1 }}>←</span>}
                onClick={() => navigate(backTarget)}
                sx={{
                  minWidth: 'auto',
                  padding: '3px 10px',
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
                Session overview
              </MuiButton>
            </Tooltip>
          )}
        </div>

        <div className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 flex items-center gap-3">
          <Link to="/" className="flex items-center group">
            <img
              src={`${process.env.PUBLIC_URL}/static/img/bioimage-io-logo.svg`}
              alt="BioImage.IO"
              className="h-7 group-hover:scale-105 transition-transform duration-300"
            />
          </Link>
          {serviceConfig?.label && (
            <span className="px-2.5 py-0.5 rounded-full text-xs font-semibold bg-purple-100 text-purple-800 border border-purple-300 tracking-wide">
              {serviceConfig.label}
            </span>
          )}
        </div>

        <div className="z-10">
          <LoginButton />
        </div>
      </div>

      {/* Main annotation area */}
      <Box sx={{ display: 'flex', flex: 1, overflow: 'hidden', position: 'relative' }}>
      <ToolBar
        onRunCellpose={handleRunCellpose}
        onOpenCellposeConfig={openCellposeConfig}
        onSave={handleSave}
        onUndo={handleUndo}
        onResetView={() => resetView?.()}
        onClearAll={handleClearAll}
        onToggleCLAHE={handleToggleCLAHE}
        onOpenMaskFilter={() => setMaskFilterOpen(true)}
        onHelp={() => setHelpOpen(true)}
        onUploadGeoJSON={handleUploadGeoJSON}
        imageName={currentImageName || undefined}
        cellposeModel={activeCellposeModel}
        cellposeAvailable={cellposeAvailable}
        isSaving={isSaving}
        isRunningCellpose={isRunningCellpose}
        isCLAHEActive={isCLAHEActive}
        hasCustomCellposeConfig={hasCustomCellposeConfig}
      />
      <Box sx={{ flex: 1, position: 'relative' }}>
        {imageUrl && !allAnnotatedInfo && !noImagesInfo && (
          <AnnotationViewer
            imageUrl={imageUrl}
            imageWidth={imageWidth}
            imageHeight={imageHeight}
            onResetViewReady={handleResetViewReady}
            onVectorSourceReady={handleVectorSourceReady}
            onImageLayerReady={handleImageLayerReady}
            onMapReady={handleMapReady}
          />
        )}

        {/* Diameter measurement overlay */}
        {measurePhase !== 'idle' && (
          <Box
            sx={{ position: 'absolute', inset: 0, zIndex: 500, cursor: 'crosshair' }}
            onClick={handleMeasureClick}
            onMouseMove={handleMeasureMouseMove}
          >
            {/* Instruction banner */}
            <Box sx={{
              position: 'absolute', top: 16, left: '50%', transform: 'translateX(-50%)',
              bgcolor: 'rgba(0,0,0,0.78)', color: '#fff',
              px: 3, py: 1.25, borderRadius: 2,
              fontSize: '0.875rem', pointerEvents: 'none', zIndex: 10,
              display: 'flex', alignItems: 'center', gap: 2, whiteSpace: 'nowrap',
            }}>
              {measurePhase === 'first'
                ? 'Click one edge of a representative cell'
                : 'Click the opposite edge to complete measurement'}
              <Box component="span" sx={{ fontSize: '0.75rem', opacity: 0.65 }}>Esc to cancel</Box>
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
              <MuiButton variant="outlined" onClick={() => loadNewImage()}>
                Retry
              </MuiButton>
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
              <Alert severity="error">{statusMessage}</Alert>
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

      <HelpTutorial open={helpOpen} onClose={() => setHelpOpen(false)} />
      </Box>
    </Box>
  );
};

export default AnnotatePage;
