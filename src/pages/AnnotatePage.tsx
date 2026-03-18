import React, { useEffect, useState, useCallback, useMemo } from 'react';
import { useLocation, Link } from 'react-router-dom';
import { Box, CircularProgress, Typography, Alert } from '@mui/material';
import LoginButton from '../components/LoginButton';
import AnnotationViewer from '../components/annotate/AnnotationViewer';
import ToolBar from '../components/annotate/ToolBar';
import ConfirmDialog from '../components/annotate/ConfirmDialog';
import FloatingBanners, { useBanners } from '../components/annotate/FloatingBanners';
import { useCellposeConfig, DEFAULT_CELLPOSE_CONFIG, CellposeConfig } from '../components/annotate/CellposeConfigDialog';
import CLAHEDialog, { useCLAHE } from '../components/annotate/CLAHEDialog';
import { useColabKernel } from '../components/Colab/useColabKernel';
import MaskFilterDialog from '../components/annotate/MaskFilterDialog';
import HelpTutorial from '../components/annotate/HelpTutorial';
import { useHyphaService, AnnotationServiceConfig, AllAnnotatedResult } from '../components/annotate/hooks/useHyphaService';
import Button from '@mui/material/Button';
import CheckCircleOutlineIcon from '@mui/icons-material/CheckCircleOutline';
import OpenInNewIcon from '@mui/icons-material/OpenInNew';
import { exportGeoJSON, renderInstanceSegmentationPNG, importGeoJSON } from '../components/annotate/exportAnnotation';
import { useAnnotationStore } from '../store/annotationStore';
import VectorSource from 'ol/source/Vector';
import ImageLayer from 'ol/layer/Image';
import Static from 'ol/source/ImageStatic';
import Feature from 'ol/Feature';
import { Polygon as OlPolygon } from 'ol/geom';

const AnnotatePage: React.FC = () => {
  const location = useLocation();

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
    return `${window.location.origin}${window.location.pathname}#/colab/${sessionId}`;
  }, [sessionId]);

  const { service, loading: serviceLoading, error: serviceError } = useHyphaService(serviceConfig);
  const { banners, addBanner, removeBanner } = useBanners();
  const runCellposeRef = React.useRef<(config: CellposeConfig) => void>(() => {});
  const [isRunningCellpose, setIsRunningCellpose] = useState(false);
  
  const [dynamicCellposeModel, setDynamicCellposeModel] = useState<string | undefined>(undefined);
  
  const { config: cellposeConfig, openDialog: openCellposeConfig, dialogElement: cellposeDialogElement, setConfig: setCellposeConfig } = useCellposeConfig({
    onRun: (config) => runCellposeRef.current(config),
    isRunning: isRunningCellpose,
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
  const { isReady: kernelReady, kernelStatus, executeCode } = useColabKernel();
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
  const [clearConfirmOpen, setClearConfirmOpen] = useState(false);
  const [maskFilterOpen, setMaskFilterOpen] = useState(false);
  const [helpOpen, setHelpOpen] = useState(false);
  const [isCLAHEActive, setIsCLAHEActive] = useState(false);
  const [originalImageUrl, setOriginalImageUrl] = useState<string | null>(null);
  const [resetView, setResetView] = useState<(() => void) | undefined>(undefined);
  const [getVectorSource, setGetVectorSource] = useState<(() => VectorSource | null) | undefined>(undefined);
  const [getImageLayer, setGetImageLayer] = useState<(() => ImageLayer<Static> | null) | undefined>(undefined);

  const handleResetViewReady = useCallback((fn: () => void) => {
    setResetView(() => fn);
  }, []);

  const handleVectorSourceReady = useCallback((fn: () => VectorSource | null) => {
    setGetVectorSource(() => fn);
  }, []);

  const handleImageLayerReady = useCallback((fn: () => ImageLayer<Static> | null) => {
    setGetImageLayer(() => fn);
  }, []);

  const [allAnnotatedInfo, setAllAnnotatedInfo] = useState<AllAnnotatedResult | null>(null);

  const loadNewImage = useCallback(async (showBanner = true) => {
    if (!service) return;
    setIsLoadingImage(true);
    setError(null);
    setAllAnnotatedInfo(null);
    setIsCLAHEActive(false);
    setOriginalImageUrl(null);
    console.log('[AnnotatePage] Loading new image...');
    const bannerId = showBanner ? addBanner('Loading new image...', 'loading', 0) : 0;
    try {
      const result = await service.getImage();

      // Check if all images are annotated
      if (result && typeof result === 'object' && 'status' in result && result.status === 'all_annotated') {
        console.log('[AnnotatePage] All images annotated:', result);
        setAllAnnotatedInfo(result as AllAnnotatedResult);
        setHasLoadedOnce(true);
        return;
      }

      const imageResult = result as { url: string; cellpose_model?: string };
      const url = imageResult.url;
      
      if (imageResult.cellpose_model) {
        setDynamicCellposeModel(imageResult.cellpose_model);
      }
      
      console.log('[AnnotatePage] Got image URL:', url);
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
      const sourceUrl = originalImageUrl || imageUrl;
      const imageName = sourceUrl?.split('/').pop() || 'annotation.png';

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
        <Link to="/" className="flex items-center group">
          <img
            src={`${process.env.PUBLIC_URL}/static/img/bioimage-io-logo.svg`}
            alt="BioImage.IO"
            className="h-7 group-hover:scale-105 transition-transform duration-300"
          />
        </Link>
        <LoginButton />
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
        sessionUrl={sessionUrl}
        imageName={(originalImageUrl || imageUrl)?.split('/').pop()}
        isSaving={isSaving}
        isRunningCellpose={isRunningCellpose}
        isCLAHEActive={isCLAHEActive}
        hasCustomCellposeConfig={hasCustomCellposeConfig}
      />
      <Box sx={{ flex: 1, position: 'relative' }}>
        {imageUrl && !allAnnotatedInfo && (
          <AnnotationViewer
            imageUrl={imageUrl}
            imageWidth={imageWidth}
            imageHeight={imageHeight}
            onResetViewReady={handleResetViewReady}
            onVectorSourceReady={handleVectorSourceReady}
            onImageLayerReady={handleImageLayerReady}
          />
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
              {sessionUrl && (
                <Button
                  variant="contained"
                  startIcon={<OpenInNewIcon />}
                  onClick={() => window.open(sessionUrl, '_blank', 'noopener,noreferrer')}
                  sx={{
                    borderRadius: 2,
                    textTransform: 'none',
                    px: 3,
                    py: 1,
                    background: 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)',
                  }}
                >
                  View Session
                </Button>
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
