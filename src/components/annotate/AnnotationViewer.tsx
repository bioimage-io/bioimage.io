import React, { useRef, useEffect } from 'react';
import { Box } from '@mui/material';
import 'ol/ol.css';
import Map from 'ol/Map';
import VectorSource from 'ol/source/Vector';
import ImageLayer from 'ol/layer/Image';
import { useAnnotationMap } from './hooks/useAnnotationMap';
import { useDrawInteraction } from './hooks/useDrawInteraction';

interface AnnotationViewerProps {
  imageUrl: string;
  imageWidth: number;
  imageHeight: number;
  onResetViewReady?: (resetView: () => void) => void;
  onVectorSourceReady?: (getVectorSource: () => VectorSource | null) => void;
  onImageLayerReady?: (getImageLayer: () => ImageLayer | null) => void;
  onMapReady?: (getMap: () => Map | null) => void;
  /** Fired with an OL-space box extent when the AI-box tool finishes a draw. */
  onSamBox?: (extent: number[]) => void;
  /** Whether the μSAM box tool is usable (gates its shortcut + interaction). */
  microSamAvailable?: boolean;
  /** Short message for a brief toast, e.g. when a merge attempt fails silently
   *  because the selected masks don't touch. */
  onToast?: (message: string) => void;
  /** Fired once with the Expand-Mask/merge handler so the parent can wire the
   *  toolbar button to the same selection-aware logic as the "A" shortcut. */
  onExpanderActionReady?: (attemptExpanderOrMerge: () => void) => void;
}

const AnnotationViewer: React.FC<AnnotationViewerProps> = ({
  imageUrl,
  imageWidth,
  imageHeight,
  onResetViewReady,
  onVectorSourceReady,
  onImageLayerReady,
  onMapReady,
  onSamBox,
  microSamAvailable,
  onToast,
  onExpanderActionReady,
}) => {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const { map, vectorSource, imageLayerRef } = useAnnotationMap(
    containerRef,
    imageUrl,
    imageWidth,
    imageHeight,
  );
  const { attemptExpanderOrMerge } = useDrawInteraction(map, vectorSource, {
    onSamBox,
    microSamAvailable,
    onToast,
  });

  // Expose the selection-aware Expand-Mask/merge handler to the parent so the
  // toolbar button can trigger the same logic as the "A" shortcut.
  useEffect(() => {
    onExpanderActionReady?.(attemptExpanderOrMerge);
  }, [attemptExpanderOrMerge, onExpanderActionReady]);

  // Expose map getter to parent (for coordinate conversion, e.g. diameter measurement)
  useEffect(() => {
    onMapReady?.(() => map.current);
  }, [map, onMapReady]);

  // Expose vectorSource getter to parent
  useEffect(() => {
    onVectorSourceReady?.(() => vectorSource.current);
  }, [vectorSource, onVectorSourceReady]);

  // Expose imageLayer getter to parent
  useEffect(() => {
    onImageLayerReady?.(() => imageLayerRef.current);
  }, [imageLayerRef, onImageLayerReady]);

  // Expose resetView to parent
  useEffect(() => {
    if (!onResetViewReady) return;
    onResetViewReady(() => {
      const m = map.current;
      if (!m) return;
      const extent = [0, 0, imageWidth, imageHeight];
      m.getView().fit(extent, { padding: [40, 40, 40, 40], duration: 300 });
    });
  }, [map, imageWidth, imageHeight, onResetViewReady]);

  // Resize map when container changes
  useEffect(() => {
    const m = map.current;
    if (!m) return;
    const observer = new ResizeObserver(() => {
      m.updateSize();
    });
    if (containerRef.current) {
      observer.observe(containerRef.current);
    }
    return () => observer.disconnect();
  }, [map, imageUrl]);

  return (
    <Box
      ref={containerRef}
      data-testid="annotation-viewer"
      sx={{
        flex: 1,
        width: '100%',
        height: '100%',
        position: 'relative',
        bgcolor: '#1a1a2e',
      }}
    />
  );
};

export default AnnotationViewer;
