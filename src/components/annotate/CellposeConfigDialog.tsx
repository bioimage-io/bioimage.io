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
import InfoOutlinedIcon from '@mui/icons-material/InfoOutlined';

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
  min_mask_area: 0,
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

/** Small inline info icon with tooltip — replaces paragraph help text */
const InfoTip: React.FC<{ text: string }> = ({ text }) => (
  <Tooltip title={text} placement="top" arrow>
    <InfoOutlinedIcon sx={{ fontSize: '0.95rem', color: 'text.disabled', ml: 0.5, cursor: 'help', verticalAlign: 'middle' }} />
  </Tooltip>
);

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
    onApply(config);
    onMeasureDiameter(config, (_px) => {});
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
                <Box sx={{ display: 'flex', alignItems: 'center' }}>
                  <Typography variant="body2" fontWeight={500}>Cell Diameter (px)</Typography>
                  <InfoTip text="Cellpose-SAM was trained on cell diameters from 7.5 to 120 px. When set, the image is rescaled so cells appear ~30 px (scale = 30 ÷ diameter). Leave empty to run at original scale — safe when cells are roughly in the 7.5–120 px range. Set this if your cells are outside that range." />
                </Box>
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
                placeholder="No rescaling (original scale)"
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
            </Grid>
          )}

          {/* ── Flow Threshold ── */}
          <Grid item xs={12}>
            <Box sx={{ display: 'flex', alignItems: 'center', mb: 0.25 }}>
              <Typography variant="body2" fontWeight={500}>
                Flow Threshold
              </Typography>
              <Typography component="span" variant="caption" color="text.secondary" sx={{ ml: 1 }}>
                {config.flow_threshold.toFixed(1)}
              </Typography>
              <InfoTip text="Controls how strictly Cellpose checks that predicted flows are consistent with a valid cell shape. Higher → more masks accepted, including irregular shapes. Lower → only well-formed, round-ish masks kept. Decrease if you see too many oddly-shaped detections." />
            </Box>
            <Box sx={{ px: 0.5 }}>
              <Slider
                value={config.flow_threshold}
                onChange={(_, val) => update('flow_threshold', val as number)}
                min={0} max={3} step={0.1}
                valueLabelDisplay="auto"
                size="small"
              />
            </Box>
          </Grid>

          {/* ── Cell Probability Threshold ── */}
          <Grid item xs={12}>
            <Box sx={{ display: 'flex', alignItems: 'center', mb: 0.25 }}>
              <Typography variant="body2" fontWeight={500}>
                Cell Probability Threshold
              </Typography>
              <Typography component="span" variant="caption" color="text.secondary" sx={{ ml: 1 }}>
                {config.cellprob_threshold.toFixed(1)}
              </Typography>
              <InfoTip text="Minimum confidence score for a pixel to be considered part of a cell. Decrease → detect more cells, including faint or dim ones. Increase → only high-confidence detections are kept." />
            </Box>
            <Box sx={{ px: 0.5 }}>
              <Slider
                value={config.cellprob_threshold}
                onChange={(_, val) => update('cellprob_threshold', val as number)}
                min={-6} max={6} step={0.1}
                valueLabelDisplay="auto"
                size="small"
              />
            </Box>
          </Grid>

          {/* ── Niter + Min Mask Area (side by side) ── */}
          <Grid item xs={6}>
            <Box sx={{ display: 'flex', alignItems: 'center', mb: 0.5 }}>
              <Typography variant="body2" fontWeight={500}>Iterations (niter)</Typography>
              <InfoTip text="Number of flow dynamics iterations. Leave empty for the default (200). Increase to ~250 for complex or concave cell shapes where the default may fragment masks." />
            </Box>
            <TextField
              fullWidth size="small" type="number" placeholder="Default (200)"
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
          </Grid>

          <Grid item xs={6}>
            <Box sx={{ display: 'flex', alignItems: 'center', mb: 0.5 }}>
              <Typography variant="body2" fontWeight={500}>Min Mask Area (px²)</Typography>
              <InfoTip text="Masks smaller than this area (in pixels²) are discarded after segmentation. Useful for removing small spurious detections. Set to 0 to keep all masks." />
            </Box>
            <TextField
              fullWidth size="small" type="number"
              value={config.min_mask_area}
              onChange={(e) => {
                const num = parseInt(e.target.value, 10);
                if (!isNaN(num) && num >= 0) update('min_mask_area', num);
              }}
              slotProps={{ input: { inputProps: { min: 0 } } }}
            />
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
