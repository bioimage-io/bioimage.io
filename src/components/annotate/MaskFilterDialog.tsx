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
} from '@mui/material';
import VectorSource from 'ol/source/Vector';
import Feature from 'ol/Feature';
import { Geometry } from 'ol/geom';
import * as turf from '@turf/turf';
import GeoJSON from 'ol/format/GeoJSON';

const geojsonFormat = new GeoJSON();

function getFeatureArea(feature: Feature<Geometry>): number {
  const geojson = geojsonFormat.writeFeatureObject(feature);
  if (geojson.geometry.type !== 'Polygon') return 0;
  return turf.area(geojson as turf.Feature<turf.Polygon>);
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
  const [threshold, setThreshold] = useState<number>(100);
  const [mode, setMode] = useState<'below' | 'above'>('below');
  const [preview, setPreview] = useState<{ total: number; matching: number } | null>(null);

  const handlePreview = useCallback(() => {
    const vs = getVectorSource?.();
    if (!vs) return;
    const features = vs.getFeatures();
    let matching = 0;
    for (const f of features) {
      const area = getFeatureArea(f);
      if (mode === 'below' && area < threshold) matching++;
      if (mode === 'above' && area > threshold) matching++;
    }
    setPreview({ total: features.length, matching });
  }, [getVectorSource, threshold, mode]);

  const handleSelect = useCallback(() => {
    const vs = getVectorSource?.();
    if (!vs) return;
    const features = vs.getFeatures();
    let count = 0;
    for (const f of features) {
      const area = getFeatureArea(f);
      const matches = mode === 'below' ? area < threshold : area > threshold;
      if (matches) {
        f.setProperties({ _selected: true });
        count++;
      } else {
        f.unset('_selected');
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
      const area = getFeatureArea(f);
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
      <DialogTitle>Filter Masks by Area</DialogTitle>
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
        <Button onClick={handlePreview} color="inherit">
          Count
        </Button>
        <Button onClick={handleSelect} color="primary">
          Select
        </Button>
        <Button onClick={handleDelete} color="error" variant="contained">
          Delete Matching
        </Button>
      </DialogActions>
    </Dialog>
  );
};

export default MaskFilterDialog;
