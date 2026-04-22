import React, { useState, useCallback, useEffect } from 'react';
import {
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  Button,
  TextField,
  Slider,
  Typography,
  IconButton,
  Tooltip,
  Grid,
  Box,
  InputAdornment,
} from '@mui/material';
import StraightenIcon from '@mui/icons-material/Straighten';

export interface CellposeConfig {
  model: string;
  diameter: number | null;
  flow_threshold: number;
  cellprob_threshold: number;
  niter: number | null;
  min_mask_area: number;
}

export const DEFAULT_CELLPOSE_CONFIG: CellposeConfig = {
  model: 'cpsam',
  diameter: null,
  flow_threshold: 0.4,
  cellprob_threshold: -1.0,
  niter: null,
  min_mask_area: 100,
};

const STORAGE_KEY = 'cellpose-config';

function loadConfig(): CellposeConfig {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored) {
      const parsed = JSON.parse(stored);
      return { ...DEFAULT_CELLPOSE_CONFIG, ...parsed };
    }
  } catch {
    // ignore parse errors
  }
  return { ...DEFAULT_CELLPOSE_CONFIG };
}

function saveConfig(config: CellposeConfig): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(config));
  } catch {
    // ignore storage errors
  }
}

function configDiffersFromDefault(config: CellposeConfig): boolean {
  return (
    config.diameter !== DEFAULT_CELLPOSE_CONFIG.diameter ||
    config.flow_threshold !== DEFAULT_CELLPOSE_CONFIG.flow_threshold ||
    config.cellprob_threshold !== DEFAULT_CELLPOSE_CONFIG.cellprob_threshold ||
    config.niter !== DEFAULT_CELLPOSE_CONFIG.niter ||
    config.min_mask_area !== DEFAULT_CELLPOSE_CONFIG.min_mask_area
  );
}

interface CellposeConfigDialogProps {
  open: boolean;
  config: CellposeConfig;
  onClose: () => void;
  onApply: (config: CellposeConfig) => void;
  onRun?: (config: CellposeConfig) => void;
  isRunning?: boolean;
  /** Called when user wants to measure a cell diameter in the image. */
  onMeasureDiameter?: (currentConfig: CellposeConfig, onMeasured: (px: number) => void) => void;
}

const CellposeConfigDialog: React.FC<CellposeConfigDialogProps> = ({
  open,
  config: initialConfig,
  onClose,
  onApply,
  onRun,
  isRunning,
  onMeasureDiameter,
}) => {
  const [config, setConfig] = useState<CellposeConfig>(initialConfig);

  useEffect(() => {
    if (open) {
      setConfig(initialConfig);
    }
  }, [open, initialConfig]);

  const update = <K extends keyof CellposeConfig>(key: K, value: CellposeConfig[K]) => {
    setConfig((prev) => ({ ...prev, [key]: value }));
  };

  const handleReset = () => {
    setConfig((prev) => ({ ...DEFAULT_CELLPOSE_CONFIG, model: prev.model }));
  };

  const handleApply = () => {
    onApply(config);
  };

  const handleMeasure = () => {
    if (!onMeasureDiameter) return;
    // Save current state before closing, then start measurement
    onApply(config);  // persist state to parent before dialog closes
    onMeasureDiameter(config, (px) => {
      // Parent will update config and reopen dialog
    });
  };

  const isBaseModel = !config.model || config.model === 'cpsam';
  const showReset = configDiffersFromDefault(config);

  return (
    <Dialog open={open} onClose={onClose} maxWidth="sm" fullWidth PaperProps={{ sx: { borderRadius: 3 } }}>
      <DialogTitle sx={{ fontWeight: 600, pb: 1 }}>AI Pre-Segmentation Settings</DialogTitle>
      <DialogContent dividers>
        <Grid container spacing={2} sx={{ pt: 0.5 }}>

          {/* Model info */}
          <Grid item xs={12}>
            <Box sx={{
              display: 'flex', alignItems: 'center', gap: 1,
              px: 1.25, py: 0.85, bgcolor: 'action.hover', borderRadius: 1.5,
            }}>
              <Typography variant="caption" color="text.secondary" sx={{ flexShrink: 0 }}>
                Model:
              </Typography>
              <Typography variant="caption" fontWeight={700} noWrap>
                {isBaseModel ? 'Base (Cellpose-SAM)' : config.model}
              </Typography>
              <Typography variant="caption" color="text.secondary" sx={{ ml: 'auto', flexShrink: 0, fontStyle: 'italic' }}>
                set from session
              </Typography>
            </Box>
          </Grid>

          {/* ── Diameter (base model only) ── */}
          {isBaseModel && (
            <Grid item xs={12}>
              <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 0.5 }}>
                <Typography variant="body2" fontWeight={500}>Cell Diameter (px)</Typography>
                {onMeasureDiameter && (
                  <Tooltip title="Measure a representative cell in the image to set the diameter automatically">
                    <Button
                      size="small"
                      variant="outlined"
                      startIcon={<StraightenIcon fontSize="small" />}
                      onClick={handleMeasure}
                      sx={{ textTransform: 'none', py: 0.25, px: 1, borderRadius: 1.5, fontSize: '0.72rem' }}
                    >
                      Measure in image
                    </Button>
                  </Tooltip>
                )}
              </Box>
              <TextField
                fullWidth
                size="small"
                type="number"
                placeholder="Auto-estimate"
                value={config.diameter === null ? '' : config.diameter}
                onChange={(e) => {
                  const val = e.target.value;
                  if (val === '') {
                    update('diameter', null);
                  } else {
                    const num = parseFloat(val);
                    if (!isNaN(num) && num >= 0) {
                      update('diameter', num === 0 ? null : num);
                    }
                  }
                }}
                slotProps={{ input: { inputProps: { min: 0 }, endAdornment: <InputAdornment position="end">px</InputAdornment> } }}
              />
              <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 0.5, lineHeight: 1.4 }}>
                Cellpose rescales the image so cells appear ~30 px before segmentation.
                Set this to your typical cell diameter in the original image.
                Leave empty to auto-estimate (slower and less reliable).{' '}
                <Typography component="span" variant="caption" color="info.main">
                  Tip: cells below ~120 px rarely need a manual value.
                </Typography>
              </Typography>
            </Grid>
          )}

          {/* ── Flow Threshold ── */}
          <Grid item xs={12}>
            <Typography variant="body2" fontWeight={500} gutterBottom>
              Flow Threshold
              <Typography component="span" variant="caption" color="text.secondary" sx={{ ml: 1 }}>
                {config.flow_threshold.toFixed(1)}
              </Typography>
            </Typography>
            <Box sx={{ px: 0.5 }}>
              <Slider
                value={config.flow_threshold}
                onChange={(_, val) => update('flow_threshold', val as number)}
                min={0} max={3} step={0.1}
                valueLabelDisplay="auto"
                size="small"
              />
            </Box>
            <Typography variant="caption" color="text.secondary" sx={{ lineHeight: 1.4 }}>
              Controls how strict the shape of accepted masks is.{' '}
              <strong>Higher</strong> → more masks accepted, including irregular shapes.{' '}
              <strong>Lower</strong> → only well-formed masks kept.
              Decrease if you see too many oddly-shaped detections.
            </Typography>
          </Grid>

          {/* ── Cell Probability Threshold ── */}
          <Grid item xs={12}>
            <Typography variant="body2" fontWeight={500} gutterBottom>
              Cell Probability Threshold
              <Typography component="span" variant="caption" color="text.secondary" sx={{ ml: 1 }}>
                {config.cellprob_threshold.toFixed(1)}
              </Typography>
            </Typography>
            <Box sx={{ px: 0.5 }}>
              <Slider
                value={config.cellprob_threshold}
                onChange={(_, val) => update('cellprob_threshold', val as number)}
                min={-6} max={6} step={0.1}
                valueLabelDisplay="auto"
                size="small"
              />
            </Box>
            <Typography variant="caption" color="text.secondary" sx={{ lineHeight: 1.4 }}>
              Sets the minimum confidence to call a pixel a cell.{' '}
              <strong>Decrease</strong> → detect more cells, including faint ones.{' '}
              <strong>Increase</strong> → only high-confidence detections.
            </Typography>
          </Grid>

          {/* ── Niter + Min Mask Area (side by side) ── */}
          <Grid item xs={6}>
            <Typography variant="body2" fontWeight={500} gutterBottom>Iterations (niter)</Typography>
            <TextField
              fullWidth size="small" type="number" placeholder="Auto"
              value={config.niter === null ? '' : config.niter}
              onChange={(e) => {
                const val = e.target.value;
                if (val === '') {
                  update('niter', null);
                } else {
                  const num = parseInt(val, 10);
                  if (!isNaN(num) && num >= 0) update('niter', num === 0 ? null : num);
                }
              }}
              slotProps={{ input: { inputProps: { min: 0 } } }}
            />
            <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 0.5, lineHeight: 1.3 }}>
              Flow dynamics iterations. Leave empty for auto. Use ~250 for complex shapes.
            </Typography>
          </Grid>

          <Grid item xs={6}>
            <Typography variant="body2" fontWeight={500} gutterBottom>Min Mask Area (px²)</Typography>
            <TextField
              fullWidth size="small" type="number"
              value={config.min_mask_area}
              onChange={(e) => {
                const num = parseInt(e.target.value, 10);
                if (!isNaN(num) && num >= 0) update('min_mask_area', num);
              }}
              slotProps={{ input: { inputProps: { min: 0 } } }}
            />
            <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 0.5, lineHeight: 1.3 }}>
              Masks smaller than this area are discarded. Useful to remove spurious small detections.
            </Typography>
          </Grid>

        </Grid>
      </DialogContent>
      <DialogActions>
        {showReset && (
          <Button onClick={handleReset} color="inherit" sx={{ mr: 'auto' }}>
            Reset to Default
          </Button>
        )}
        <Button onClick={onClose} color="inherit">Cancel</Button>
        {onRun && (
          <Button
            onClick={() => { handleApply(); onRun(config); }}
            variant="contained"
            color="secondary"
            disabled={isRunning}
          >
            Run Segmentation
          </Button>
        )}
      </DialogActions>
    </Dialog>
  );
};

export function useCellposeConfig(opts?: {
  onRun?: (config: CellposeConfig) => void;
  isRunning?: boolean;
  onMeasureDiameter?: (currentConfig: CellposeConfig, onMeasured: (px: number) => void) => void;
}): {
  config: CellposeConfig;
  openDialog: () => void;
  dialogElement: React.ReactNode;
  setConfig: React.Dispatch<React.SetStateAction<CellposeConfig>>;
} {
  const [config, setConfig] = useState<CellposeConfig>(loadConfig);
  const [dialogOpen, setDialogOpen] = useState(false);

  const openDialog = useCallback(() => {
    setDialogOpen(true);
  }, []);

  const handleApply = useCallback((newConfig: CellposeConfig) => {
    setConfig(newConfig);
    saveConfig(newConfig);
    setDialogOpen(false);
  }, []);

  const handleClose = useCallback(() => {
    setDialogOpen(false);
  }, []);

  // onMeasureDiameter: save config state, close dialog, let parent handle measurement
  const handleMeasureDiameter = useCallback((currentConfig: CellposeConfig, onMeasured: (px: number) => void) => {
    setConfig(currentConfig);
    saveConfig(currentConfig);
    setDialogOpen(false);
    opts?.onMeasureDiameter?.(currentConfig, onMeasured);
  }, [opts]);

  const dialogElement = (
    <CellposeConfigDialog
      open={dialogOpen}
      config={config}
      onClose={handleClose}
      onApply={handleApply}
      onRun={opts?.onRun}
      isRunning={opts?.isRunning}
      onMeasureDiameter={opts?.onMeasureDiameter ? handleMeasureDiameter : undefined}
    />
  );

  return { config, openDialog, dialogElement, setConfig };
}

export default CellposeConfigDialog;
