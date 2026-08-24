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
  Divider,
  CircularProgress,
} from '@mui/material';
import ListSubheader from '@mui/material/ListSubheader';
import InfoOutlinedIcon from '@mui/icons-material/InfoOutlined';
import ExpandMoreIcon from '@mui/icons-material/ExpandMore';
import ExpandLessIcon from '@mui/icons-material/ExpandLess';
import StraightenIcon from '@mui/icons-material/Straighten';
import VisibilityIcon from '@mui/icons-material/Visibility';
import ReplayIcon from '@mui/icons-material/Replay';
import WarningAmberIcon from '@mui/icons-material/WarningAmber';
import InputAdornment from '@mui/material/InputAdornment';
import { MICRO_SAM_MODEL_TYPE, MICRO_SAM_MODEL_OPTIONS, MICRO_SAM_GROUP_LABELS } from '../../utils/microSamService';

/** Which segmentation backend the Full Image Segmentation dialog runs.
 *  ``cellpose`` = Cellpose-SAM (the flows + Pyodide mask-gen path), always
 *  the published 'idealistic-eagle' model via model-runner.
 *  ``microsam`` = μSAM automatic instance segmentation (server-side, no knobs). */
export type SegBackend = 'cellpose' | 'microsam';

export interface CellposeConfig {
  backend: SegBackend;
  /** μSAM only. Which generalist model_type to run (e.g. 'vit_l_lm'). Ignored
   *  when ``backend`` is 'cellpose'. Defaults to MICRO_SAM_MODEL_TYPE, the
   *  only value for which the embedding fast-path (stored per-image
   *  embeddings, no fresh encode) is valid. */
  microSamModelType: string;
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
  microSamModelType: MICRO_SAM_MODEL_TYPE,
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
      // backend, microSamModelType, and useEnhancedImage are never persisted
      // going forward (see saveConfig) — strip them here too, in case a save
      // from before this change left one behind, so the default always wins.
      delete parsed.backend;
      delete parsed.microSamModelType;
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
    // useEnhancedImage, backend, and microSamModelType are intentionally
    // excluded so they always start at their defaults (unchecked / μSAM /
    // MICRO_SAM_MODEL_TYPE) next session, even if left changed here.
    const { useEnhancedImage, backend, microSamModelType, ...persisted } = config;
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
   *  image, so the "Show preview" hold button and "Done" can re-run mask
   *  gen locally in Pyodide via ``onShowPreview``. The dialog stays open
   *  after Run in this mode. */
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
  /** Runs local Pyodide postprocessing (compute_masks_np) against the cached
   *  flow field and the given config, repainting the preview. Awaited by the
   *  dialog's "Show preview" hold button and "Done" button — those are the
   *  only two triggers for a recompute; slider drags no longer fire this. */
  onShowPreview?: (config: CellposeConfig) => Promise<void>;
  /** Whether the μSAM backend is reachable. Gates the μSAM option in the
   *  backend selector. */
  microSamAvailable?: boolean;
  /** Whether the Cellpose-SAM backend (model-runner) is reachable. Gates
   *  the Cellpose-SAM option in the backend selector. */
  cellposeAvailable?: boolean;
  /** Fires once whenever the dialog transitions to open, so the caller can
   *  re-check service availability without polling while the dialog is
   *  closed. */
  onDialogOpen?: () => void;
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
  /** μSAM only. When provided, shows a "Recompute embedding" action for the
   *  currently selected model. Clears the cached image encoding and computes
   *  it again on the next run. */
  onRecomputeEmbedding?: (modelType: string) => Promise<void>;
  /** Model types with a stored embedding for the current image. Gates the
   *  Recompute-embedding button: only shown when the currently selected μSAM
   *  model is in this list. Empty when unknown (no dataset index loaded yet,
   *  or no current image). */
  embeddedModelTypes?: string[];
  /** True while the dataset index (source of `embeddedModelTypes`) hasn't
   *  loaded yet, so the Recompute affordance shows a spinner instead of
   *  guessing there's nothing to recompute. */
  embeddedModelTypesLoading?: boolean;
  /** Called at click time (not cached) to check whether the current image
   *  already has at least one mask. When it returns a count above zero,
   *  clicking Run Segmentation / Compute Flow Field / Re-run on Server shows
   *  a blocking inline warning instead of running immediately, since full
   *  image segmentation covers the whole image and trims new masks against
   *  whatever is already there. */
  getExistingMaskCount?: () => number;
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
  onShowPreview,
  microSamAvailable,
  cellposeAvailable,
  onDialogOpen,
  claheActive,
  onMeasureDiameter,
  onCancelRun,
  onRecomputeEmbedding,
  embeddedModelTypes,
  embeddedModelTypesLoading,
  getExistingMaskCount,
}) => {
  const [config, setConfig] = useState<CellposeConfig>(initialConfig);
  const [recomputingEmbedding, setRecomputingEmbedding] = useState(false);
  const [showOverwriteWarning, setShowOverwriteWarning] = useState(false);

  const handleRecomputeEmbedding = async () => {
    if (!onRecomputeEmbedding || recomputingEmbedding) return;
    setRecomputingEmbedding(true);
    try {
      await onRecomputeEmbedding(config.microSamModelType);
    } finally {
      setRecomputingEmbedding(false);
    }
  };

  useEffect(() => {
    if (open) {
      setConfig(initialConfig);
    } else {
      setShowOverwriteWarning(false);
    }
  }, [open, initialConfig]);

  // Re-check availability every time the dialog opens, so a stale probe from
  // before the dialog was last shown doesn't linger.
  const onDialogOpenRef = useRef(onDialogOpen);
  onDialogOpenRef.current = onDialogOpen;
  useEffect(() => {
    if (open) {
      onDialogOpenRef.current?.();
    }
  }, [open]);

  // If the currently selected backend's service is unavailable but the other
  // one is up, switch to the available one. Runs on open and again whenever
  // availability changes while the dialog stays open, so a probe refresh (or
  // a service coming back) re-derives the selection without user action.
  // Default stays μSAM when both are up: this only ever moves away from an
  // unavailable backend, never toward a preference between two available ones.
  useEffect(() => {
    if (!open) return;
    setConfig((prev) => {
      if (prev.backend === 'microsam' && microSamAvailable === false && cellposeAvailable !== false) {
        return { ...prev, backend: 'cellpose' };
      }
      if (prev.backend === 'cellpose' && cellposeAvailable === false && microSamAvailable !== false) {
        return { ...prev, backend: 'microsam' };
      }
      return prev;
    });
  }, [open, microSamAvailable, cellposeAvailable]);

  const bothUnavailable = microSamAvailable === false && cellposeAvailable === false;

  const update = <K extends keyof CellposeConfig>(key: K, value: CellposeConfig[K]) => {
    setConfig((prev) => ({ ...prev, [key]: value }));
  };

  const handleReset = () => {
    setConfig((prev) => ({ ...DEFAULT_CELLPOSE_CONFIG, backend: prev.backend, microSamModelType: prev.microSamModelType }));
  };

  const handleApply = () => {
    onApply(config);
  };

  // Full image segmentation covers the whole image and trims new masks
  // against whatever is already there, which can leave unwanted artifacts
  // where they overlap. Gate the click behind a blocking inline warning
  // whenever the image already has at least one mask, rather than running
  // straight away.
  const handleRunClick = useCallback(() => {
    const existingMaskCount = getExistingMaskCount ? getExistingMaskCount() : 0;
    if (existingMaskCount > 0) {
      setShowOverwriteWarning(true);
      return;
    }
    handleApply();
    onRun?.(config);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [getExistingMaskCount, config, onRun]);

  const handleRunAnyway = useCallback(() => {
    setShowOverwriteWarning(false);
    handleApply();
    onRun?.(config);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [config, onRun]);

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

  // "Show preview" is a hold button: while held, the entire dialog (paper +
  // backdrop) hides so the user can see the image and current mask preview
  // underneath, and reappears on release. Postprocessing (the local Pyodide
  // recompute against the cached flow field) runs once on press, and the
  // dialog only hides once that recompute has actually finished — see
  // handleShowPreviewPointerDown. previewHeldRef tracks whether the pointer
  // is still down when the async recompute resolves, since a fast tap can
  // release before postprocessing completes.
  const [previewHeld, setPreviewHeld] = useState(false);
  const [postprocessing, setPostprocessing] = useState(false);
  const previewHeldRef = useRef(false);

  // Reset hold/spinner state whenever the dialog closes, in case a pointer
  // capture release was missed (e.g. the dialog closed via Escape mid-hold).
  useEffect(() => {
    if (!open) {
      previewHeldRef.current = false;
      setPreviewHeld(false);
      setPostprocessing(false);
    }
  }, [open]);

  const handleShowPreviewPointerDown = useCallback(async (e: React.PointerEvent<HTMLButtonElement>) => {
    if (postprocessing || !onShowPreview) return;
    try {
      e.currentTarget.setPointerCapture(e.pointerId);
    } catch {
      // ignore — capture is best-effort
    }
    previewHeldRef.current = true;
    setPostprocessing(true);
    try {
      await onShowPreview(config);
    } catch (err) {
      console.warn('[CellposeConfigDialog] Show preview failed:', err);
    } finally {
      setPostprocessing(false);
      if (previewHeldRef.current) setPreviewHeld(true);
    }
  }, [postprocessing, onShowPreview, config]);

  const handleShowPreviewRelease = useCallback((e: React.PointerEvent<HTMLButtonElement>) => {
    previewHeldRef.current = false;
    setPreviewHeld(false);
    try {
      e.currentTarget.releasePointerCapture(e.pointerId);
    } catch {
      // ignore — capture may already have been released
    }
  }, []);

  const handleDone = useCallback(async () => {
    if (isResultReady) {
      if (!isMicroSam && livePreviewReady && onShowPreview && !postprocessing) {
        setPostprocessing(true);
        try {
          await onShowPreview(config);
        } catch (err) {
          console.warn('[CellposeConfigDialog] Done postprocessing failed:', err);
        } finally {
          setPostprocessing(false);
        }
      }
      handleApply();
      onClose();
    } else {
      onCancelRun?.();
      onClose();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isResultReady, isMicroSam, livePreviewReady, onShowPreview, postprocessing, config]);

  return (
    <Dialog
      open={open}
      onClose={onClose}
      maxWidth="sm"
      fullWidth
      hideBackdrop={previewHeld}
      PaperProps={{
        sx: {
          borderRadius: 3,
          transition: 'opacity 120ms ease-out',
          ...(previewHeld && { opacity: 0, pointerEvents: 'none' }),
        },
      }}
    >
      <DialogTitle sx={{ fontWeight: 600, pb: 1 }}>Full Image Segmentation</DialogTitle>
      <DialogContent dividers>
        {showOverwriteWarning ? (
          <Box data-testid="overwrite-warning" sx={{ px: 1, py: 1.5 }}>
            <Box sx={{ display: 'flex', alignItems: 'flex-start', gap: 1.25, mb: 2.5 }}>
              <WarningAmberIcon color="warning" sx={{ mt: 0.25, flexShrink: 0 }} />
              <Box>
                <Typography variant="body2" fontWeight={600} sx={{ mb: 0.5 }}>
                  This image already has masks
                </Typography>
                <Typography variant="body2" color="text.secondary">
                  Full image segmentation covers the whole image. New masks are trimmed against
                  existing ones, which can produce unwanted mask artifacts where they overlap.
                </Typography>
              </Box>
            </Box>
            <Box sx={{ display: 'flex', gap: 1, justifyContent: 'flex-end' }}>
              <Button
                data-testid="warning-cancel-button"
                onClick={() => setShowOverwriteWarning(false)}
                color="inherit"
              >
                Cancel
              </Button>
              <Button
                data-testid="run-anyway-button"
                onClick={handleRunAnyway}
                variant="contained"
                color="warning"
                disabled={isRunning}
              >
                Run Anyway
              </Button>
            </Box>
          </Box>
        ) : (
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
                value={config.backend === 'microsam' ? config.microSamModelType : 'cellpose'}
                onChange={(e) => {
                  const value = e.target.value;
                  if (value === 'cellpose') {
                    update('backend', 'cellpose');
                  } else {
                    setConfig((prev) => ({ ...prev, backend: 'microsam', microSamModelType: value }));
                  }
                }}
                renderValue={(value) => {
                  if (value === 'cellpose') {
                    return cellposeAvailable ? 'Cellpose-SAM' : 'Cellpose-SAM (unavailable)';
                  }
                  const option = MICRO_SAM_MODEL_OPTIONS.find((o) => o.modelType === value);
                  const label = option ? option.label.replace(' (default)', '') : value;
                  const marker = option?.group === 'em_organelles' ? 'EM' : 'LM';
                  return microSamAvailable
                    ? `μSAM ${label} (${marker})`
                    : `μSAM ${label} (${marker}, unavailable)`;
                }}
                sx={{ fontSize: '0.8rem', fontWeight: 700, ml: 'auto', minWidth: 150 }}
              >
                {(['lm', 'em_organelles'] as const).flatMap((group, groupIndex) => {
                  const optionsInGroup = MICRO_SAM_MODEL_OPTIONS.filter((o) => o.group === group);
                  if (optionsInGroup.length === 0) return [];
                  return [
                    ...(groupIndex > 0 ? [<Divider key={`divider-${group}`} sx={{ my: 0.5 }} />] : []),
                    <ListSubheader key={`header-${group}`} sx={{ fontSize: '0.75rem', lineHeight: '2rem' }}>
                      {MICRO_SAM_GROUP_LABELS[group]}
                    </ListSubheader>,
                    ...optionsInGroup.map((option) => {
                      const shortLabel = option.label.replace(' (default)', '');
                      const marker = option.group === 'em_organelles' ? 'EM' : 'LM';
                      return (
                        <MenuItem
                          key={option.modelType}
                          value={option.modelType}
                          disabled={!microSamAvailable}
                          sx={{ fontSize: '0.8rem' }}
                        >
                          {`${shortLabel} (${marker})`}
                        </MenuItem>
                      );
                    }),
                  ];
                })}
                <Divider sx={{ my: 0.5 }} />
                <MenuItem value="cellpose" disabled={!cellposeAvailable} sx={{ fontSize: '0.8rem' }}>
                  {cellposeAvailable ? 'Cellpose-SAM' : 'Cellpose-SAM (unavailable)'}
                </MenuItem>
              </Select>
            </Box>
            {bothUnavailable ? (
              <Typography variant="caption" color="error" sx={{ display: 'block', mt: 0.75, px: 0.5 }}>
                Segmentation services are currently unavailable. Please try again shortly.
              </Typography>
            ) : isMicroSam && (
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
              {onRecomputeEmbedding && embeddedModelTypesLoading && (
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75, mt: 1 }}>
                  <CircularProgress size={14} />
                </Box>
              )}
              {onRecomputeEmbedding
                && !embeddedModelTypesLoading
                && embeddedModelTypes?.includes(config.microSamModelType) && (
                <Tooltip title="Clears the cached image encoding and computes it again on the next run.">
                  <span>
                    <Button
                      size="small"
                      variant="text"
                      color="inherit"
                      onClick={handleRecomputeEmbedding}
                      disabled={recomputingEmbedding || !microSamAvailable}
                      startIcon={recomputingEmbedding ? <CircularProgress size={14} /> : <ReplayIcon fontSize="small" />}
                      sx={{ mt: 1, textTransform: 'none', color: 'text.secondary' }}
                    >
                      Recompute embedding
                    </Button>
                  </span>
                </Tooltip>
              )}
              {onRun && (
                <Button
                  onClick={handleRunClick}
                  variant="contained"
                  color="secondary"
                  disabled={isRunning || bothUnavailable}
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
                      <InfoTip text="Cellpose-SAM is scale-robust and was trained on diameters of 7.5 to 120 px (mean 30 px). Setting a diameter inside that range is not recommended. When set, the image is rescaled so objects match the trained scale. Leave empty to run at the original scale, or use Measure in image to read the diameter off a representative object." />
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
                      sx={{ mb: config.diameter !== null && config.diameter >= 7.5 && config.diameter <= 120 ? 0.5 : 1.5 }}
                    />
                    {config.diameter !== null && config.diameter >= 7.5 && config.diameter <= 120 && (
                      <Typography variant="caption" sx={{ display: 'block', mb: 1.5, color: 'warning.main' }}>
                        {config.diameter} px is within the trained range (7.5 to 120 px). Rescaling is not
                        recommended, leave the field empty to run at the original scale.
                      </Typography>
                    )}

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
                        onClick={handleRunClick}
                        variant="contained"
                        color="secondary"
                        disabled={isRunning || bothUnavailable}
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

                    {onShowPreview && (
                      <Grid item xs={12}>
                        <Button
                          variant="outlined"
                          color="secondary"
                          fullWidth
                          disabled={!livePreviewReady || postprocessing}
                          startIcon={postprocessing ? <CircularProgress size={16} /> : <VisibilityIcon fontSize="small" />}
                          onPointerDown={handleShowPreviewPointerDown}
                          onPointerUp={handleShowPreviewRelease}
                          onPointerCancel={handleShowPreviewRelease}
                          sx={{ touchAction: 'none', userSelect: 'none' }}
                        >
                          Show Preview
                        </Button>
                        <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 0.5, textAlign: 'center' }}>
                          Hold to preview, let go to return to dialog.
                        </Typography>
                      </Grid>
                    )}

                  </Grid>
                </Collapse>
              </Grid>
            </>
          )}

        </Grid>
        )}
      </DialogContent>
      {!showOverwriteWarning && (
        <DialogActions>
          {showReset && (
            <Button onClick={handleReset} color="inherit" sx={{ mr: 'auto' }}>
              Reset to Default
            </Button>
          )}
          <Button
            onClick={handleDone}
            color={isResultReady ? 'primary' : 'inherit'}
            variant={isResultReady ? 'outlined' : 'text'}
            disabled={postprocessing}
            startIcon={postprocessing && isResultReady ? <CircularProgress size={16} /> : undefined}
          >
            {isResultReady ? 'Done' : 'Cancel'}
          </Button>
        </DialogActions>
      )}
    </Dialog>
  );
};

export function useCellposeConfig(opts?: {
  onRun?: (config: CellposeConfig) => void;
  isRunning?: boolean;
  /** When true, the dialog keeps the (dP, cellprob) flows path active: the
   *  Apply / Run path does NOT close the dialog so "Show preview" and
   *  "Done" can trigger local recompute against the cached flows. ``Done``
   *  saves + closes; Cancel closes without saving. Pass this when the
   *  parent has wired the Pyodide compute_masks call back through
   *  onShowPreview. */
  keepOpenAfterApply?: boolean;
  livePreviewReady?: boolean;
  resultReady?: boolean;
  /** Monotonically increasing id bumped on every completed run — see the
   *  matching prop doc on ``CellposeConfigDialogProps``. */
  completedRunId?: number;
  onShowPreview?: (config: CellposeConfig) => Promise<void>;
  microSamAvailable?: boolean;
  /** Whether the Cellpose-SAM backend (model-runner) is reachable. */
  cellposeAvailable?: boolean;
  /** Fires whenever the dialog opens, for a cheap availability re-check. */
  onDialogOpen?: () => void;
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
  /** μSAM only. Passed straight through to ``CellposeConfigDialogProps`` —
   *  see that prop's doc. */
  onRecomputeEmbedding?: (modelType: string) => Promise<void>;
  /** Passed straight through to ``CellposeConfigDialogProps`` — see that
   *  prop's doc. */
  embeddedModelTypes?: string[];
  /** Passed straight through to ``CellposeConfigDialogProps`` — see that
   *  prop's doc. */
  embeddedModelTypesLoading?: boolean;
  /** Passed straight through to ``CellposeConfigDialogProps`` — see that
   *  prop's doc. */
  getExistingMaskCount?: () => number;
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
      onShowPreview={opts?.onShowPreview}
      microSamAvailable={opts?.microSamAvailable}
      cellposeAvailable={opts?.cellposeAvailable}
      onDialogOpen={opts?.onDialogOpen}
      claheActive={opts?.claheActive}
      onMeasureDiameter={opts?.onMeasureDiameter ? handleMeasureDiameter : undefined}
      onCancelRun={opts?.onCancelRun}
      onRecomputeEmbedding={opts?.onRecomputeEmbedding}
      embeddedModelTypes={opts?.embeddedModelTypes}
      embeddedModelTypesLoading={opts?.embeddedModelTypesLoading}
      getExistingMaskCount={opts?.getExistingMaskCount}
    />
  );

  return { config, openDialog, closeDialog, dialogOpen, dialogElement, setConfig };
}

export default CellposeConfigDialog;
