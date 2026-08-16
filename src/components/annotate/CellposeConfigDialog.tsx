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
  Checkbox,
  FormControlLabel,
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
  /** When true and CLAHE is active, both backends segment the contrast
   *  enhanced pixels instead of the raw image. Never persisted across
   *  sessions (stripped in saveConfig) so it always starts unchecked. */
  useEnhancedImage: boolean;
  /** Cellpose-SAM only. When true, the model runs twice: the first pass
   *  produces a raw flow field (postprocessing skipped), the second pass
   *  feeds that flow field back through the model as input, and the
   *  flow-dynamics postprocessing applies to the second pass's output. */
  two_pass: boolean;
}

export const DEFAULT_CELLPOSE_CONFIG: CellposeConfig = {
  backend: 'microsam',
  flow_threshold: 0.4,
  cellprob_threshold: -1.0,
  niter: null,
  min_mask_area: 30,
  diameter: null,
  useEnhancedImage: false,
  two_pass: false,
};

const STORAGE_KEY = 'cellpose-config';

function loadConfig(): CellposeConfig {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored) {
      const parsed = JSON.parse(stored);
      // backend and useEnhancedImage are never persisted going forward (see
      // saveConfig) — strip them here too, in case a save from before this
      // change left one behind, so the default always wins.
      delete parsed.backend;
      delete parsed.useEnhancedImage;
      return { ...DEFAULT_CELLPOSE_CONFIG, ...parsed };
    }
  } catch {
    // ignore parse errors
  }
  return { ...DEFAULT_CELLPOSE_CONFIG };
}

function saveConfig(config: CellposeConfig): void {
  try {
    // useEnhancedImage and backend are intentionally excluded so they always
    // start at their defaults (unchecked / μSAM) next session, even if left
    // changed here.
    const { useEnhancedImage, backend, ...persisted } = config;
    localStorage.setItem(STORAGE_KEY, JSON.stringify(persisted));
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
    config.diameter !== DEFAULT_CELLPOSE_CONFIG.diameter ||
    config.two_pass !== DEFAULT_CELLPOSE_CONFIG.two_pass
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
  /** True once any Cellpose run has returned a result, whether via the
   *  instant local-preview path or a plain server round trip. Drives the
   *  Compute Flow Field -> Refine Results auto-collapse independently of
   *  ``livePreviewReady``, so the accordion still advances even when the
   *  run went through the server-only fallback (e.g. Pyodide still
   *  booting) and instant slider recompute isn't available. */
  resultReady?: boolean;
  /** Monotonically increasing id bumped by the caller every time a Cellpose
   *  run actually completes (the flow field arrived, mask count may be
   *  zero) — including re-runs where ``resultReady``/``livePreviewReady``
   *  were already true beforehand. Drives the Compute Flow Field -> Refine
   *  Results auto-collapse. Unlike watching ``resultReady`` for a
   *  false -> true edge, this fires on every completed run, not just the
   *  first one, so re-running after manually reopening the Run section
   *  still collapses it. */
  completedRunId?: number;
  /** Fires on every instant-group slider change while ``livePreviewReady``;
   *  callers are expected to debounce + run compute_masks_np locally. */
  onInstantConfigChange?: (config: CellposeConfig) => void;
  /** Whether the μSAM backend is reachable. Gates the μSAM option in the
   *  backend selector. */
  microSamAvailable?: boolean;
  /** Whether CLAHE is currently active on the image. Gates the "Use
   *  contrast enhanced image" checkbox, shown for both backends. */
  claheActive?: boolean;
  /** When provided, shows a "Measure in image" button next to the diameter
   *  field. Called with the current config; the caller closes/hides the
   *  dialog, lets the user click a representative object in the image, then
   *  invokes ``onMeasured`` with the measured diameter in display px. */
  onMeasureDiameter?: (currentConfig: CellposeConfig, onMeasured: (px: number) => void) => void;
  /** Fires when the user clicks the single bottom button while it reads
   *  "Cancel" and a run is in flight — the caller is expected to abort the
   *  in-flight infer call. A no-op call while nothing is running is
   *  harmless, so this is invoked unconditionally whenever the button
   *  reads "Cancel", not just while ``isRunning``. */
  onCancelRun?: () => void;
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
  resultReady,
  completedRunId,
  onInstantConfigChange,
  microSamAvailable,
  claheActive,
  onMeasureDiameter,
  onCancelRun,
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
  // Collapse timing is keyed on resultReady (any run, local or server
  // fallback) rather than livePreviewReady (instant-recompute capability
  // only) so the accordion still advances when the server fallback path
  // was used.
  const isResultReady = resultReady ?? livePreviewReady;
  const [runSectionOpen, setRunSectionOpen] = useState(!isResultReady);
  const [refineSectionOpen, setRefineSectionOpen] = useState(!!isResultReady);

  useEffect(() => {
    if (open) {
      setRunSectionOpen(!isResultReady);
      setRefineSectionOpen(!!isResultReady);
    }
    // Only re-derive on the open transition, not on every isResultReady
    // change while open (that case is handled by the effect below).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  // Force the collapse on every completed run, not just the first
  // false -> true transition of isResultReady. A re-run after the user has
  // manually reopened Compute Flow Field (e.g. Re-run on Server while
  // livePreviewReady was already true) never flips isResultReady, so
  // watching it alone misses that case. completedRunId is bumped by the
  // caller on every run completion (success, even with zero masks), so
  // keying off it here catches re-runs too. Fall back to the old
  // edge-detection behavior if a caller doesn't pass completedRunId.
  const prevCompletedRunId = useRef(completedRunId);
  const prevResultReady = useRef(isResultReady);
  useEffect(() => {
    const runJustCompleted =
      completedRunId !== undefined
        ? completedRunId !== prevCompletedRunId.current
        : isResultReady && !prevResultReady.current;
    if (runJustCompleted) {
      setRunSectionOpen(false);
      setRefineSectionOpen(true);
    }
    prevCompletedRunId.current = completedRunId;
    prevResultReady.current = isResultReady;
  }, [completedRunId, isResultReady]);

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
                μSAM segments every object automatically.
              </Typography>
            )}
          </Grid>

          {/* ── μSAM: single field, no sections (nothing here is tunable after a run) ── */}
          {isMicroSam && (
            <Grid item xs={12}>
              {claheActive && (
                <FormControlLabel
                  sx={{ alignItems: 'flex-start', ml: 0, mb: 1.5 }}
                  control={
                    <Checkbox
                      size="small"
                      checked={!!config.useEnhancedImage}
                      onChange={(e) => update('useEnhancedImage', e.target.checked)}
                    />
                  }
                  label={
                    <Box sx={{ mt: 0.25 }}>
                      <Typography variant="body2" fontWeight={500}>Use contrast enhanced image</Typography>
                      <Typography variant="caption" color="text.secondary" sx={{ display: 'block' }}>
                        Segments the enhanced pixels instead of the raw image. Off by default.
                      </Typography>
                    </Box>
                  }
                />
              )}
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

                    {claheActive && (
                      <FormControlLabel
                        sx={{ alignItems: 'flex-start', ml: 0, mb: 1.5 }}
                        control={
                          <Checkbox
                            size="small"
                            checked={!!config.useEnhancedImage}
                            onChange={(e) => update('useEnhancedImage', e.target.checked)}
                          />
                        }
                        label={
                          <Box sx={{ mt: 0.25 }}>
                            <Typography variant="body2" fontWeight={500}>Use contrast enhanced image</Typography>
                            <Typography variant="caption" color="text.secondary" sx={{ display: 'block' }}>
                              Segments the enhanced pixels instead of the raw image. Off by default.
                            </Typography>
                          </Box>
                        }
                      />
                    )}

                    <Box sx={{ display: 'flex', alignItems: 'center', mb: 0.5 }}>
                      <Typography variant="body2" fontWeight={500}>Cell Diameter (px)</Typography>
                      <Typography component="span" variant="caption" color="text.secondary" sx={{ ml: 1 }}>
                        trained range 7.5-120 px
                      </Typography>
                      <InfoTip text="Cellpose-SAM is deliberately scale-robust, so this is usually unnecessary. It was trained on object diameters from 7.5 to 120 px, with a mean of 30 px. When set, it rescales the image so objects match that trained scale before segmentation; diameters above 120 px are downsampled toward the trained scale. Leave empty to run at the original scale. Use Measure in image to pick a representative object's diameter directly from the image." />
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

                    <FormControlLabel
                      sx={{ alignItems: 'flex-start', ml: 0, mb: 1.5 }}
                      control={
                        <Checkbox
                          size="small"
                          checked={!!config.two_pass}
                          onChange={(e) => update('two_pass', e.target.checked)}
                        />
                      }
                      label={
                        <Box sx={{ mt: 0.25 }}>
                          <Typography variant="body2" fontWeight={500}>2nd pass</Typography>
                          <Typography variant="caption" color="text.secondary" sx={{ display: 'block' }}>
                            Runs the model a second time on its own predicted flow field. Can improve
                            results on low contrast images.
                          </Typography>
                        </Box>
                      }
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
        <Button
          onClick={() => {
            if (isResultReady) {
              handleApply();
            } else {
              onCancelRun?.();
              onClose();
            }
          }}
          color={isResultReady ? 'primary' : 'inherit'}
          variant={isResultReady ? 'outlined' : 'text'}
        >
          {isResultReady ? 'Done' : 'Cancel'}
        </Button>
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
  resultReady?: boolean;
  /** Monotonically increasing id bumped on every completed run — see the
   *  matching prop doc on ``CellposeConfigDialogProps``. */
  completedRunId?: number;
  onInstantConfigChange?: (config: CellposeConfig) => void;
  microSamAvailable?: boolean;
  /** Whether CLAHE is currently active. Gates the "Use contrast enhanced
   *  image" checkbox, shown for both backends. */
  claheActive?: boolean;
  /** When set, the dialog shows a "Measure in image" button. Called with the
   *  config to apply and a callback the page invokes once the user has
   *  clicked a representative object, with the measured diameter in px. */
  onMeasureDiameter?: (currentConfig: CellposeConfig, onMeasured: (px: number) => void) => void;
  /** Fires when the user cancels while a run may be in flight — see the
   *  matching prop doc on ``CellposeConfigDialogProps``. */
  onCancelRun?: () => void;
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
      resultReady={opts?.resultReady}
      completedRunId={opts?.completedRunId}
      onInstantConfigChange={opts?.onInstantConfigChange}
      microSamAvailable={opts?.microSamAvailable}
      claheActive={opts?.claheActive}
      onMeasureDiameter={opts?.onMeasureDiameter ? handleMeasureDiameter : undefined}
      onCancelRun={opts?.onCancelRun}
    />
  );

  return { config, openDialog, closeDialog, dialogOpen, dialogElement, setConfig };
}

export default CellposeConfigDialog;
