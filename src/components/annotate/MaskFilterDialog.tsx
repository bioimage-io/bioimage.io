import React, { useState, useCallback } from 'react';
import {
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  Button,
  TextField,
  ToggleButton,
  ToggleButtonGroup,
  Typography,
  Box,
  IconButton,
} from '@mui/material';
import CloseIcon from '@mui/icons-material/Close';
import VectorSource from 'ol/source/Vector';
import Feature from 'ol/Feature';
import { Geometry } from 'ol/geom';
import GeoJSON from 'ol/format/GeoJSON';
import { Style, Fill, Stroke } from 'ol/style';

const geojsonFormat = new GeoJSON();

const SELECTED_STYLE = new Style({
  fill: new Fill({ color: 'rgba(255, 255, 0, 0.3)' }),
  stroke: new Stroke({ color: '#ffff00', width: 3 }),
});

/** Compute polygon area in pixel² using the shoelace formula */
function getFeatureAreaPixels(feature: Feature<Geometry>): number {
  const geojson = geojsonFormat.writeFeatureObject(feature);
  if (geojson.geometry.type !== 'Polygon') return 0;
  const coords = (geojson.geometry as any).coordinates[0] as number[][];
  if (!coords || coords.length < 3) return 0;
  let area = 0;
  for (let i = 0; i < coords.length - 1; i++) {
    area += coords[i][0] * coords[i + 1][1] - coords[i + 1][0] * coords[i][1];
  }
  return Math.abs(area) / 2;
}

interface MaskFilterDialogProps {
  open: boolean;
  onClose: () => void;
  getVectorSource: (() => VectorSource | null) | undefined;
  onSaveUndo: () => void;
  onBanner: (msg: string, type: 'info' | 'success' | 'warning', timeout: number) => void;
}

const MaskFilterDialog: React.FC<MaskFilterDialogProps> = ({
  open,
  onClose,
  getVectorSource,
  onSaveUndo,
  onBanner,
}) => {
  const [threshold, setThreshold] = useState<number>(500);
  const [mode, setMode] = useState<'below' | 'above'>('below');
  const [preview, setPreview] = useState<{ total: number; matching: number } | null>(null);

  const handleCount = useCallback(() => {
    const vs = getVectorSource?.();
    if (!vs) return;
    const features = vs.getFeatures();
    let matching = 0;
    for (const f of features) {
      const area = getFeatureAreaPixels(f);
      if (mode === 'below' && area < threshold) matching++;
      if (mode === 'above' && area > threshold) matching++;
    }
    setPreview({ total: features.length, matching });
  }, [getVectorSource, threshold, mode]);

  const handleSelect = useCallback(() => {
    const vs = getVectorSource?.();
    if (!vs) return;
    const features = vs.getFeatures();
    // Clear all styles first
    features.forEach((f) => f.setStyle(undefined as any));
    let count = 0;
    for (const f of features) {
      const area = getFeatureAreaPixels(f);
      const matches = mode === 'below' ? area < threshold : area > threshold;
      if (matches) {
        f.setStyle(SELECTED_STYLE);
        count++;
      }
    }
    onBanner(`Selected ${count} mask${count !== 1 ? 's' : ''}`, 'info', 3000);
    onClose();
  }, [getVectorSource, threshold, mode, onClose, onBanner]);

  const handleDelete = useCallback(() => {
    const vs = getVectorSource?.();
    if (!vs) return;
    onSaveUndo();
    const features = vs.getFeatures();
    const toRemove: Feature<Geometry>[] = [];
    for (const f of features) {
      const area = getFeatureAreaPixels(f);
      if (mode === 'below' && area < threshold) toRemove.push(f);
      if (mode === 'above' && area > threshold) toRemove.push(f);
    }
    toRemove.forEach((f) => vs.removeFeature(f));
    onBanner(`Removed ${toRemove.length} mask${toRemove.length !== 1 ? 's' : ''}`, 'success', 3000);
    setPreview(null);
    onClose();
  }, [getVectorSource, threshold, mode, onSaveUndo, onClose, onBanner]);

  return (
    <Dialog open={open} onClose={onClose} maxWidth="xs" fullWidth>
      <DialogTitle sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        Filter Masks by Area
        <IconButton size="small" onClick={onClose} sx={{ mr: -1 }}>
          <CloseIcon fontSize="small" />
        </IconButton>
      </DialogTitle>
      <DialogContent>
        <Box sx={{ display: 'flex', gap: 2, alignItems: 'center', mt: 1, mb: 2 }}>
          <ToggleButtonGroup
            value={mode}
            exclusive
            onChange={(_, v) => v && setMode(v)}
            size="small"
          >
            <ToggleButton value="below">Below</ToggleButton>
            <ToggleButton value="above">Above</ToggleButton>
          </ToggleButtonGroup>
          <TextField
            size="small"
            type="number"
            label="Area (px²)"
            value={threshold}
            onChange={(e) => {
              const n = parseFloat(e.target.value);
              if (!isNaN(n) && n >= 0) setThreshold(n);
            }}
            sx={{ width: 140 }}
            slotProps={{ input: { inputProps: { min: 0 } } }}
          />
        </Box>
        {preview && (
          <Typography variant="body2" color="text.secondary">
            {preview.matching} of {preview.total} masks match the filter.
          </Typography>
        )}
      </DialogContent>
      <DialogActions>
        <Button onClick={handleCount} color="inherit" size="small">
          Count
        </Button>
        <Button onClick={handleSelect} color="inherit" size="small">
          Select
        </Button>
        <Button onClick={handleDelete} size="small" sx={{ color: 'error.main' }}>
          Delete Matching
        </Button>
      </DialogActions>
    </Dialog>
  );
};

export default MaskFilterDialog;
