import React, { useEffect, useState, useCallback, useMemo } from 'react';
import { useLocation } from 'react-router-dom';
import { Box, CircularProgress, Typography, Alert } from '@mui/material';
import AnnotationViewer from '../components/annotate/AnnotationViewer';
import ToolBar from '../components/annotate/ToolBar';
import ConfirmDialog from '../components/annotate/ConfirmDialog';
import FloatingBanners, { useBanners } from '../components/annotate/FloatingBanners';
import { useCellposeConfig, DEFAULT_CELLPOSE_CONFIG, CellposeConfig } from '../components/annotate/CellposeConfigDialog';
import CLAHEDialog, { useCLAHE } from '../components/annotate/CLAHEDialog';
import MaskFilterDialog from '../components/annotate/MaskFilterDialog';
import HelpTutorial from '../components/annotate/HelpTutorial';
import { useHyphaService, AnnotationServiceConfig } from '../components/annotate/hooks/useHyphaService';
import { exportGeoJSON, renderInstanceSegmentationPNG } from '../components/annotate/exportAnnotation';
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

  const { service, loading: serviceLoading, error: serviceError } = useHyphaService(serviceConfig);
  const { banners, addBanner, removeBanner } = useBanners();
  const runCellposeRef = React.useRef<(config: CellposeConfig) => void>(() => {});
  const [isRunningCellpose, setIsRunningCellpose] = useState(false);
  const { config: cellposeConfig, openDialog: openCellposeConfig, dialogElement: cellposeDialogElement } = useCellposeConfig({
    onRun: (config) => runCellposeRef.current(config),
    isRunning: isRunningCellpose,
  });
  const { claheConfig, setClaheConfig, dialogOpen: claheDialogOpen, openDialog: openCLAHEDialog, closeDialog: closeCLAHEDialog, applyToImage } = useCLAHE();

  const imageUrl = useAnnotationStore((s) => s.imageUrl);
  const imageWidth = useAnnotationStore((s) => s.imageWidth);
  const imageHeight = useAnnotationStore((s) => s.imageHeight);
  const setImageInfo = useAnnotationStore((s) => s.setImageInfo);
  const setIsLoading = useAnnotationStore((s) => s.setIsLoading);
  const error = useAnnotationStore((s) => s.error);
  const setError = useAnnotationStore((s) => s.setError);
  const pushUndo = useAnnotationStore((s) => s.pushUndo);

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
  const [getImageLayer, setGetImageLayer] = useState<(() => ImageLayer | null) | undefined>(undefined);

  const loadNewImage = useCallback(async (showBanner = true) => {
    if (!service) return;
    setIsLoadingImage(true);
    setError(null);
    setIsCLAHEActive(false);
    setOriginalImageUrl(null);
    console.log('[AnnotatePage] Loading new image...');
    const bannerId = showBanner ? addBanner('Loading new image...', 'loading', 0) : 0;
    try {
      const url = await service.getImage();
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

        const geojson = exportGeoJSON(vs);
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

  const handleCLAHEApply = useCallback(() => {
    if (!imageUrl) return;
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => {
      applyToImage(img).then((url) => {
        const layer = getImageLayer?.();
        if (layer) {
          const source = layer.getSource() as Static;
          if (source) {
            if (!originalImageUrl) setOriginalImageUrl(imageUrl);
            layer.setSource(new Static({
              url: url,
              projection: source.getProjection()!,
              imageExtent: source.getImageExtent(),
              crossOrigin: 'anonymous',
            }));
          }
        }
        setIsCLAHEActive(true);
        closeCLAHEDialog();
        console.log('[AnnotatePage] CLAHE applied');
        addBanner('CLAHE contrast enhancement applied', 'success', 3000);
      });
    };
    img.src = originalImageUrl || imageUrl;
  }, [imageUrl, originalImageUrl, getImageLayer, applyToImage, closeCLAHEDialog, addBanner]);

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

  if (!serviceConfig) {
    return (
      <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100vh', p: 4 }}>
        <Alert severity="warning">
          Missing service configuration. URL must include <code>server_url</code> and <code>image_provider_id</code> parameters.
        </Alert>
      </Box>
    );
  }

  if (serviceLoading) {
    return (
      <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100vh', flexDirection: 'column', gap: 2 }}>
        <CircularProgress />
        <Typography variant="body2" color="text.secondary">Connecting to annotation service...</Typography>
      </Box>
    );
  }

  if (serviceError) {
    return (
      <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100vh', p: 4 }}>
        <Alert severity="error">Service connection failed: {serviceError}</Alert>
      </Box>
    );
  }

  if (!hasLoadedOnce && !error) {
    return (
      <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100vh', flexDirection: 'column', gap: 2 }}>
        <CircularProgress />
        <Typography variant="body2" color="text.secondary">Loading image...</Typography>
      </Box>
    );
  }

  if (error && !hasLoadedOnce) {
    return (
      <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100vh', p: 4 }}>
        <Alert severity="error">{error}</Alert>
      </Box>
    );
  }

  return (
    <Box sx={{ display: 'flex', height: 'calc(100vh - 64px)', overflow: 'hidden', position: 'relative' }}>
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
        isSaving={isSaving}
        isRunningCellpose={isRunningCellpose}
        isCLAHEActive={isCLAHEActive}
        hasCustomCellposeConfig={hasCustomCellposeConfig}
      />
      <Box sx={{ flex: 1, position: 'relative' }}>
        {imageUrl && (
          <AnnotationViewer
            imageUrl={imageUrl}
            imageWidth={imageWidth}
            imageHeight={imageHeight}
            onResetViewReady={(fn) => setResetView(() => fn)}
            onVectorSourceReady={(fn) => setGetVectorSource(() => fn)}
            onImageLayerReady={(fn) => setGetImageLayer(() => fn)}
          />
        )}

        {(isLoadingImage || isSaving || isRunningCellpose) && (
          <Box
            sx={{
              position: 'absolute',
              inset: 0,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              bgcolor: 'rgba(0,0,0,0.35)',
              zIndex: 1100,
              pointerEvents: 'all',
            }}
          >
            <CircularProgress size={48} sx={{ color: '#fff' }} />
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
  );
};

export default AnnotatePage;
