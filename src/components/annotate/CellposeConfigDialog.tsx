import React, { useState, useCallback, useEffect } from 'react';
import {
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  Button,
  TextField,
  Select,
  MenuItem,
  Slider,
  Typography,
  IconButton,
  Tooltip,
  FormControl,
  InputLabel,
  Grid,
  Box,
} from '@mui/material';
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
  cellprob_threshold: 0.0,
  niter: null,
  min_mask_area: 0,
};

const MODEL_OPTIONS = [
  'cpsam',
  'cyto3',
  'cyto2',
  'cyto',
  'nuclei',
  'livecell',
  'tissuenet',
];

const PARAM_DESCRIPTIONS: Record<string, string> = {
  model:
    "The pretrained Cellpose model to use. 'cpsam' is the latest SAM-based model with best general performance. 'cyto3'/'cyto2'/'cyto' are cytoplasm models. 'nuclei' segments cell nuclei. 'livecell' and 'tissuenet' are trained on specific datasets.",
  diameter:
    'Approximate cell diameter in pixels. Set to 0 or leave empty for automatic estimation. Larger values detect larger objects.',
  flow_threshold:
    'Flow error threshold for dynamics. Higher values allow more masks but may include poorly-shaped ones. Decrease if you see too many ill-shaped ROIs. Range: 0-3, default: 0.4',
  cellprob_threshold:
    'Cell probability threshold. Decrease to find more cells (including dim ones), increase to filter out weak detections. Range: -6 to 6, default: 0.0',
  niter:
    'Number of iterations for flow dynamics. Leave empty for automatic (based on diameter). Use higher values (e.g., 250) for better convergence on complex shapes.',
  min_mask_area:
    'Minimum mask area in pixels. Masks smaller than this will be filtered out. Set to 0 to keep all masks. Useful for removing small spurious detections.',
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
    config.model !== DEFAULT_CELLPOSE_CONFIG.model ||
    config.diameter !== DEFAULT_CELLPOSE_CONFIG.diameter ||
    config.flow_threshold !== DEFAULT_CELLPOSE_CONFIG.flow_threshold ||
    config.cellprob_threshold !== DEFAULT_CELLPOSE_CONFIG.cellprob_threshold ||
    config.niter !== DEFAULT_CELLPOSE_CONFIG.niter ||
    config.min_mask_area !== DEFAULT_CELLPOSE_CONFIG.min_mask_area
  );
}

interface InfoButtonProps {
  paramKey: string;
}

const InfoButton: React.FC<InfoButtonProps> = ({ paramKey }) => (
  <Tooltip title={PARAM_DESCRIPTIONS[paramKey]} arrow placement="top">
    <IconButton size="small" sx={{ ml: 0.5 }}>
      <InfoOutlinedIcon fontSize="small" />
    </IconButton>
  </Tooltip>
);

interface ParamLabelProps {
  label: string;
  paramKey: string;
}

const ParamLabel: React.FC<ParamLabelProps> = ({ label, paramKey }) => (
  <Box sx={{ display: 'flex', alignItems: 'center', mb: 0.5 }}>
    <Typography variant="body2" fontWeight={500}>
      {label}
    </Typography>
    <InfoButton paramKey={paramKey} />
  </Box>
);

interface CellposeConfigDialogProps {
  open: boolean;
  config: CellposeConfig;
  onClose: () => void;
  onApply: (config: CellposeConfig) => void;
  onRun?: (config: CellposeConfig) => void;
  isRunning?: boolean;
}

const CellposeConfigDialog: React.FC<CellposeConfigDialogProps> = ({
  open,
  config: initialConfig,
  onClose,
  onApply,
  onRun,
  isRunning,
}) => {
  const [config, setConfig] = useState<CellposeConfig>(initialConfig);

  useEffect(() => {
    if (open) {
      setConfig(initialConfig);
    }
  }, [open, initialConfig]);

  const update = <K extends keyof CellposeConfig>(
    key: K,
    value: CellposeConfig[K]
  ) => {
    setConfig((prev) => ({ ...prev, [key]: value }));
  };

  const handleReset = () => {
    setConfig({ ...DEFAULT_CELLPOSE_CONFIG });
  };

  const handleApply = () => {
    onApply(config);
  };

  const showReset = configDiffersFromDefault(config);

  return (
    <Dialog open={open} onClose={onClose} maxWidth="sm" fullWidth>
      <DialogTitle>Cellpose Configuration</DialogTitle>
      <DialogContent dividers>
        <Grid container spacing={2.5} sx={{ pt: 0.5 }}>
          {/* Model */}
          <Grid size={12}>
            <ParamLabel label="Model" paramKey="model" />
            <FormControl fullWidth size="small">
              <Select
                value={config.model}
                onChange={(e) => update('model', e.target.value)}
              >
                {MODEL_OPTIONS.map((m) => (
                  <MenuItem key={m} value={m}>
                    {m}
                  </MenuItem>
                ))}
              </Select>
            </FormControl>
          </Grid>

          {/* Diameter */}
          <Grid size={6}>
            <ParamLabel label="Diameter" paramKey="diameter" />
            <TextField
              fullWidth
              size="small"
              type="number"
              placeholder="Auto"
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
              slotProps={{
                input: { inputProps: { min: 0 } },
              }}
            />
          </Grid>

          {/* Min Mask Area */}
          <Grid size={6}>
            <ParamLabel label="Min Mask Area" paramKey="min_mask_area" />
            <TextField
              fullWidth
              size="small"
              type="number"
              value={config.min_mask_area}
              onChange={(e) => {
                const num = parseInt(e.target.value, 10);
                if (!isNaN(num) && num >= 0) {
                  update('min_mask_area', num);
                }
              }}
              slotProps={{
                input: { inputProps: { min: 0 } },
              }}
            />
          </Grid>

          {/* Flow Threshold */}
          <Grid size={6}>
            <ParamLabel label="Flow Threshold" paramKey="flow_threshold" />
            <Box sx={{ px: 1 }}>
              <Slider
                value={config.flow_threshold}
                onChange={(_, val) => update('flow_threshold', val as number)}
                min={0}
                max={3}
                step={0.1}
                valueLabelDisplay="auto"
                size="small"
              />
            </Box>
            <Typography variant="caption" color="text.secondary" sx={{ pl: 1 }}>
              {config.flow_threshold.toFixed(1)}
            </Typography>
          </Grid>

          {/* Cell Probability Threshold */}
          <Grid size={6}>
            <ParamLabel
              label="Cell Prob Threshold"
              paramKey="cellprob_threshold"
            />
            <Box sx={{ px: 1 }}>
              <Slider
                value={config.cellprob_threshold}
                onChange={(_, val) =>
                  update('cellprob_threshold', val as number)
                }
                min={-6}
                max={6}
                step={0.1}
                valueLabelDisplay="auto"
                size="small"
              />
            </Box>
            <Typography variant="caption" color="text.secondary" sx={{ pl: 1 }}>
              {config.cellprob_threshold.toFixed(1)}
            </Typography>
          </Grid>

          {/* Niter */}
          <Grid size={6}>
            <ParamLabel label="Iterations (niter)" paramKey="niter" />
            <TextField
              fullWidth
              size="small"
              type="number"
              placeholder="Auto"
              value={config.niter === null ? '' : config.niter}
              onChange={(e) => {
                const val = e.target.value;
                if (val === '') {
                  update('niter', null);
                } else {
                  const num = parseInt(val, 10);
                  if (!isNaN(num) && num >= 0) {
                    update('niter', num === 0 ? null : num);
                  }
                }
              }}
              slotProps={{
                input: { inputProps: { min: 0 } },
              }}
            />
          </Grid>
        </Grid>
      </DialogContent>
      <DialogActions>
        {showReset && (
          <Button onClick={handleReset} color="inherit" sx={{ mr: 'auto' }}>
            Reset to Defaults
          </Button>
        )}
        <Button onClick={onClose} color="inherit">
          Cancel
        </Button>
        <Button onClick={handleApply} variant="contained" color="primary">
          Apply
        </Button>
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
}): {
  config: CellposeConfig;
  openDialog: () => void;
  dialogElement: React.ReactNode;
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

  const dialogElement = (
    <CellposeConfigDialog
      open={dialogOpen}
      config={config}
      onClose={handleClose}
      onApply={handleApply}
      onRun={opts?.onRun}
      isRunning={opts?.isRunning}
    />
  );

  return { config, openDialog, dialogElement };
}

export default CellposeConfigDialog;
