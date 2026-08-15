import React, { useState, useCallback, useEffect, useRef } from 'react';
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
  Select,
  MenuItem,
  Collapse,
} from '@mui/material';
import { alpha } from '@mui/material/styles';
import InfoOutlinedIcon from '@mui/icons-material/InfoOutlined';
import ExpandMoreIcon from '@mui/icons-material/ExpandMore';
import ExpandLessIcon from '@mui/icons-material/ExpandLess';
import StraightenIcon from '@mui/icons-material/Straighten';
import InputAdornment from '@mui/material/InputAdornment';

/** Which segmentation backend the Full Image Segmentation dialog runs.
 *  ``cellpose`` = Cellpose-SAM (the flows + Pyodide mask-gen path), always
 *  the published 'idealistic-eagle' model via cellpose4-runner.
 *  ``microsam`` = μSAM automatic instance segmentation (server-side, no knobs). */
export type SegBackend = 'cellpose' | 'microsam';

export interface CellposeConfig {
  backend: SegBackend;
  flow_threshold: number;
  cellprob_threshold: number;
  niter: number | null;
  min_mask_area: number;
  /** Representative object diameter in display-space pixels. When set, the
   *  image is rescaled client-side (Cellpose-SAM only) so objects match the
   *  network's expected ~30 px working diameter. Null runs at original scale. */
  diameter: number | null;
}

export const DEFAULT_CELLPOSE_CONFIG: CellposeConfig = {
  backend: 'microsam',
  flow_threshold: 0.4,
  cellprob_threshold: -1.0,
  niter: null,
  min_mask_area: 30,
  diameter: null,
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
    config.flow_threshold !== DEFAULT_CELLPOSE_CONFIG.flow_threshold ||
    config.cellprob_threshold !== DEFAULT_CELLPOSE_CONFIG.cellprob_threshold ||
    config.niter !== DEFAULT_CELLPOSE_CONFIG.niter ||
    config.min_mask_area !== DEFAULT_CELLPOSE_CONFIG.min_mask_area ||
    config.diameter !== DEFAULT_CELLPOSE_CONFIG.diameter
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
  /** When true, the parent has already cached (dP, cellprob) for the current
   *  image and the instant-group sliders re-run mask gen locally in Pyodide.
   *  In that mode each instant slider drag debounce-fires
   *  ``onInstantConfigChange`` and the dialog stays open after Run. */
  livePreviewReady?: boolean;
  /** Fires on every instant-group slider change while ``livePreviewReady``;
   *  callers are expected to debounce + run compute_masks_np locally. */
  onInstantConfigChange?: (config: CellposeConfig) => void;
  /** Whether the μSAM backend is reachable. Gates the μSAM option in the
   *  backend selector. */
  microSamAvailable?: boolean;
  /** When provided, shows a "Measure in image" button next to the diameter
   *  field. Called with the current config; the caller closes/hides the
   *  dialog, lets the user click a representative object in the image, then
   *  invokes ``onMeasured`` with the measured diameter in display px. */
  onMeasureDiameter?: (currentConfig: CellposeConfig, onMeasured: (px: number) => void) => void;
}

/** Collapsible section header: click to toggle, chevron shows current state. */
const SectionHeader: React.FC<{ title: string; subtitle?: string; open: boolean; onToggle: () => void }> = ({
  title,
  subtitle,
  open,
  onToggle,
}) => (
  <Box
    component="button"
    type="button"
    onClick={onToggle}
    aria-expanded={open}
    sx={{
      display: 'flex', alignItems: 'center', width: '100%',
      px: 1.25, py: 0.75,
      borderRadius: 1.5, border: 'none', cursor: 'pointer', font: 'inherit', textAlign: 'left',
      bgcolor: 'action.hover',
      '&:hover': { bgcolor: 'action.selected' },
    }}
  >
    <Box sx={{ flex: 1, minWidth: 0 }}>
      <Typography variant="body2" fontWeight={600}>{title}</Typography>
      {subtitle && (
        <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 0.1 }}>
          {subtitle}
        </Typography>
      )}
    </Box>
    {open ? <ExpandLessIcon fontSize="small" sx={{ flexShrink: 0, ml: 1 }} /> : <ExpandMoreIcon fontSize="small" sx={{ flexShrink: 0, ml: 1 }} />}
  </Box>
);

const INSTANT_KEYS: (keyof CellposeConfig)[] = [
  'flow_threshold',
  'cellprob_threshold',
  'niter',
  'min_mask_area',
];

const CellposeConfigDialog: React.FC<CellposeConfigDialogProps> = ({
  open,
  config: initialConfig,
  onClose,
  onApply,
  onRun,
  isRunning,
  livePreviewReady,
  onInstantConfigChange,
  microSamAvailable,
  onMeasureDiameter,
}) => {
  const [config, setConfig] = useState<CellposeConfig>(initialConfig);

  useEffect(() => {
    if (open) {
      setConfig(initialConfig);
    }
  }, [open, initialConfig]);

  // Fire instant-group updates back to the caller (debounced by the caller's
  // own debouncer; we just propagate every state change). React batches the
  // setState above so we read the latest config from the next render.
  const instantConfigChangeRef = useRef(onInstantConfigChange);
  instantConfigChangeRef.current = onInstantConfigChange;

  const update = <K extends keyof CellposeConfig>(key: K, value: CellposeConfig[K]) => {
    setConfig((prev) => {
      const next = { ...prev, [key]: value };
      if (livePreviewReady && INSTANT_KEYS.includes(key)) {
        instantConfigChangeRef.current?.(next);
      }
      return next;
    });
  };

  const handleReset = () => {
    setConfig((prev) => ({ ...DEFAULT_CELLPOSE_CONFIG, backend: prev.backend }));
  };

  const handleApply = () => {
    onApply(config);
  };

  const handleMeasure = () => {
    if (!onMeasureDiameter) return;
    onApply(config);
    onMeasureDiameter(config, () => {});
  };

  const isMicroSam = config.backend === 'microsam';
  const showReset = configDiffersFromDefault(config);

  // Section 1 ("Run") starts open and Section 2 ("Refine Results") starts
  // closed. Reopening the dialog after a run restores whichever state
  // matches the current readiness instead of always resetting to defaults.
  const [runSectionOpen, setRunSectionOpen] = useState(!livePreviewReady);
  const [refineSectionOpen, setRefineSectionOpen] = useState(!!livePreviewReady);

  useEffect(() => {
    if (open) {
      setRunSectionOpen(!livePreviewReady);
      setRefineSectionOpen(!!livePreviewReady);
    }
    // Only re-derive on the open transition, not on every livePreviewReady
    // change while open (that case is handled by the effect below).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const prevLivePreviewReady = useRef(livePreviewReady);
  useEffect(() => {
    if (livePreviewReady && !prevLivePreviewReady.current) {
      setRunSectionOpen(false);
      setRefineSectionOpen(true);
    }
    prevLivePreviewReady.current = livePreviewReady;
  }, [livePreviewReady]);

  // Flow Threshold and Cell Probability Threshold repaint the mask overlay
  // live, so while either is being dragged the dialog fades out to reveal
  // the image underneath. The slider itself stays fully opaque (only the
  // Paper/backdrop backgrounds lose alpha), and the dialog restores on release.
  const [draggingSlider, setDraggingSlider] = useState(false);
  const startSliderDrag = () => setDraggingSlider(true);
  const endSliderDrag = () => setDraggingSlider(false);

  return (
    <Dialog
      open={open}
      onClose={onClose}
      maxWidth="sm"
      fullWidth
      PaperProps={{
        sx: (theme) => ({
          borderRadius: 3,
          transition: 'background-color 180ms ease, box-shadow 180ms ease',
          ...(draggingSlider && {
            bgcolor: alpha(theme.palette.background.paper, 0.1),
            boxShadow: 'none',
          }),
        }),
      }}
      slotProps={{
        backdrop: {
          sx: {
            transition: 'background-color 180ms ease',
            ...(draggingSlider && { bgcolor: 'rgba(0,0,0,0.04)' }),
          },
        },
      }}
    >
      <DialogTitle sx={{ fontWeight: 600, pb: 1 }}>Full Image Segmentation</DialogTitle>
      <DialogContent dividers>
        <Grid container spacing={2} sx={{ pt: 0.5 }}>

          {/* Backend selector — always visible, not part of either section */}
          <Grid item xs={12}>
            <Box sx={{
              display: 'flex', alignItems: 'center', gap: 1,
              px: 1.25, py: 0.6, bgcolor: 'action.hover', borderRadius: 1.5,
            }}>
              <Typography variant="caption" color="text.secondary" sx={{ flexShrink: 0 }}>
                Model:
              </Typography>
              <Select
                size="small"
                variant="standard"
                disableUnderline
                value={config.backend}
                onChange={(e) => update('backend', e.target.value as SegBackend)}
                sx={{ fontSize: '0.8rem', fontWeight: 700, ml: 'auto', minWidth: 150 }}
              >
                <MenuItem value="microsam" disabled={!microSamAvailable} sx={{ fontSize: '0.8rem' }}>
                  {microSamAvailable ? 'μSAM' : 'μSAM (unavailable)'}
                </MenuItem>
                <MenuItem value="cellpose" sx={{ fontSize: '0.8rem' }}>Cellpose-SAM</MenuItem>
              </Select>
            </Box>
            {isMicroSam && (
              <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 0.75, px: 0.5 }}>
                μSAM segments every object automatically. It takes no Cellpose tuning parameters.
              </Typography>
            )}
          </Grid>

          {/* ── μSAM: single field, no sections (nothing here is tunable after a run) ── */}
          {isMicroSam && (
            <Grid item xs={12}>
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
              {onRun && (
                <Button
                  onClick={() => { handleApply(); onRun(config); }}
                  variant="contained"
                  color="secondary"
                  disabled={isRunning}
                  fullWidth
                  sx={{ mt: 2 }}
                >
                  Run Segmentation
                </Button>
              )}
            </Grid>
          )}

          {/* ── Cellpose: two collapsible sections ── */}
          {!isMicroSam && (
            <>
              {/* Section 1: Compute Flow Field — collapses once flows come back from the server */}
              <Grid item xs={12}>
                <SectionHeader
                  title="Compute Flow Field"
                  subtitle={livePreviewReady
                    ? 'Segmented. Adjust the sliders below to refine the result.'
                    : 'One server call computes the network output.'}
                  open={runSectionOpen}
                  onToggle={() => setRunSectionOpen((v) => !v)}
                />
                <Collapse in={runSectionOpen}>
                  <Box sx={{ px: 1.25, pt: 1, pb: 1 }}>
                    <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mb: 1.25 }}>
                      {livePreviewReady
                        ? 'The image has already been segmented. Open Refine Results below to tune the mask output instantly, or click Re-run to segment again.'
                        : 'Click Compute Flow Field to send the image to the server. After that, the sliders below update the preview instantly with no extra server calls.'}
                    </Typography>

                    <Box sx={{ display: 'flex', alignItems: 'center', mb: 0.5 }}>
                      <Typography variant="body2" fontWeight={500}>Cell Diameter (px)</Typography>
                      <InfoTip text="Cellpose-SAM works best when objects are about 30 px across. Diameter rescales the image so objects match that size before segmentation. Leave empty to run at the original scale. Use Measure in image to pick a representative object's diameter directly from the image." />
                      {onMeasureDiameter && (
                        <Tooltip title="Measure a representative object in the image to set the diameter automatically" placement="top" arrow>
                          <Button
                            size="small"
                            variant="outlined"
                            startIcon={<StraightenIcon fontSize="small" />}
                            onClick={handleMeasure}
                            sx={{ ml: 'auto', textTransform: 'none' }}
                          >
                            Measure in image
                          </Button>
                        </Tooltip>
                      )}
                    </Box>
                    <TextField
                      fullWidth size="small" type="number" placeholder="No rescaling (original scale)"
                      value={config.diameter === null ? '' : config.diameter}
                      onChange={(e) => {
                        const val = e.target.value;
                        if (val === '') {
                          update('diameter', null);
                        } else {
                          const num = parseFloat(val);
                          if (!isNaN(num) && num >= 0) update('diameter', num === 0 ? null : num);
                        }
                      }}
                      slotProps={{
                        input: {
                          inputProps: { min: 0 },
                          endAdornment: <InputAdornment position="end">px</InputAdornment>,
                        },
                      }}
                      sx={{ mb: 1.5 }}
                    />

                    {onRun && (
                      <Button
                        onClick={() => { handleApply(); onRun(config); }}
                        variant="contained"
                        color="secondary"
                        disabled={isRunning}
                        fullWidth
                      >
                        {livePreviewReady ? 'Re-run on Server' : 'Compute Flow Field'}
                      </Button>
                    )}
                  </Box>
                </Collapse>
              </Grid>

              {/* Section 2: Refine Results — opens once flows come back */}
              <Grid item xs={12}>
                <SectionHeader
                  title="Refine Results"
                  subtitle={livePreviewReady
                    ? 'Updates the preview instantly as you drag.'
                    : 'Available after you click Compute Flow Field.'}
                  open={refineSectionOpen}
                  onToggle={() => setRefineSectionOpen((v) => !v)}
                />
                <Collapse in={refineSectionOpen}>
                  <Grid container spacing={2} sx={{ px: 1.25, pt: 1.25, pb: 0.5 }}>

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
                          onChangeCommitted={endSliderDrag}
                          onPointerDown={startSliderDrag}
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
                          onChangeCommitted={endSliderDrag}
                          onPointerDown={startSliderDrag}
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
                </Collapse>
              </Grid>
            </>
          )}

        </Grid>
      </DialogContent>
      <DialogActions>
        {showReset && (
          <Button onClick={handleReset} color="inherit" sx={{ mr: 'auto' }}>
            Reset to Default
          </Button>
        )}
        <Button onClick={onClose} color="inherit">Cancel</Button>
        {onInstantConfigChange && livePreviewReady && (
          <Button onClick={handleApply} color="primary" variant="outlined">
            Done
          </Button>
        )}
      </DialogActions>
    </Dialog>
  );
};

export function useCellposeConfig(opts?: {
  onRun?: (config: CellposeConfig) => void;
  isRunning?: boolean;
  /** When true, the dialog keeps the (dP, cellprob) flows path active: the
   *  Apply / Run path does NOT close the dialog so the instant-group
   *  sliders can keep updating the preview. ``Done`` saves + closes;
   *  Cancel closes without saving. Pass this when the parent has wired
   *  the Pyodide compute_masks call back through onInstantConfigChange. */
  keepOpenAfterApply?: boolean;
  livePreviewReady?: boolean;
  onInstantConfigChange?: (config: CellposeConfig) => void;
  microSamAvailable?: boolean;
  /** When set, the dialog shows a "Measure in image" button. Called with the
   *  config to apply and a callback the page invokes once the user has
   *  clicked a representative object, with the measured diameter in px. */
  onMeasureDiameter?: (currentConfig: CellposeConfig, onMeasured: (px: number) => void) => void;
}): {
  config: CellposeConfig;
  openDialog: () => void;
  closeDialog: () => void;
  dialogOpen: boolean;
  dialogElement: React.ReactNode;
  setConfig: React.Dispatch<React.SetStateAction<CellposeConfig>>;
} {
  const [config, setConfig] = useState<CellposeConfig>(loadConfig);
  const [dialogOpen, setDialogOpen] = useState(false);

  const openDialog = useCallback(() => {
    setDialogOpen(true);
  }, []);

  const closeDialog = useCallback(() => {
    setDialogOpen(false);
  }, []);

  const handleApply = useCallback((newConfig: CellposeConfig) => {
    setConfig(newConfig);
    saveConfig(newConfig);
    if (!opts?.keepOpenAfterApply) {
      setDialogOpen(false);
    }
  }, [opts?.keepOpenAfterApply]);

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
      livePreviewReady={opts?.livePreviewReady}
      onInstantConfigChange={opts?.onInstantConfigChange}
      microSamAvailable={opts?.microSamAvailable}
      onMeasureDiameter={opts?.onMeasureDiameter ? handleMeasureDiameter : undefined}
    />
  );

  return { config, openDialog, closeDialog, dialogOpen, dialogElement, setConfig };
}

export default CellposeConfigDialog;
