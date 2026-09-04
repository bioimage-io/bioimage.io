import React, { useEffect, useState } from 'react';
import {
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  Button,
  Typography,
  IconButton,
  Tooltip,
  Box,
  ButtonBase,
  ListSubheader,
  Divider,
  CircularProgress,
} from '@mui/material';
import CheckCircleIcon from '@mui/icons-material/CheckCircle';
import CloudDownloadOutlinedIcon from '@mui/icons-material/CloudDownloadOutlined';
import ReplayIcon from '@mui/icons-material/Replay';
import {
  MICRO_SAM_MODEL_OPTIONS,
  MICRO_SAM_GROUP_LABELS,
  MICRO_SAM_MODEL_TYPE,
  MicroSamModelOption,
} from '../../utils/microSamService';

interface SamBoxModelDialogProps {
  open: boolean;
  onClose: () => void;
  /** The model the Interactive Segmentation tool currently uses (persisted). */
  modelType: string;
  onSelectModelType: (modelType: string) => void;
  /** Which decoder is currently held in memory, from ``useMicroSamDecoder``.
   *  Null until the first decoder has finished loading. */
  loadedModelType: string | null;
  microSamAvailable: boolean;
  /** Model types with a stored embedding for the current image. Empty when
   *  unknown (no dataset index loaded yet, or no current image). */
  embeddedModelTypes: string[];
  /** True while the dataset index (source of `embeddedModelTypes`) hasn't
   *  loaded yet, so the Recompute affordance shows a spinner instead of
   *  guessing there's nothing to recompute. */
  embeddedModelTypesLoading?: boolean;
  onRecomputeEmbedding: (modelType: string) => Promise<void>;
  /** Downloads the decoder and computes this image's embedding for the
   *  selected model, then closes the dialog and activates the tool. Rejects
   *  on failure, the message is shown inline instead of closing. */
  onStartAnnotating: () => Promise<void>;
}

/** Model-selection dialog for the Interactive Segmentation (sambox) tool.
 *  Nothing downloads or computes on its own (round 34b): picking a model
 *  just changes the selection, and "Start annotating" is what triggers the
 *  ONNX decoder download and the current image's embedding compute. */
const SamBoxModelDialog: React.FC<SamBoxModelDialogProps> = ({
  open,
  onClose,
  modelType,
  onSelectModelType,
  loadedModelType,
  microSamAvailable,
  embeddedModelTypes,
  embeddedModelTypesLoading,
  onRecomputeEmbedding,
  onStartAnnotating,
}) => {
  const [recomputingType, setRecomputingType] = useState<string | null>(null);
  const [preparing, setPreparing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) {
      setPreparing(false);
      setError(null);
    }
  }, [open]);

  const handleRecompute = async (e: React.MouseEvent, mt: string) => {
    e.stopPropagation();
    if (recomputingType) return;
    setRecomputingType(mt);
    try {
      await onRecomputeEmbedding(mt);
    } finally {
      setRecomputingType(null);
    }
  };

  const handleStart = async () => {
    if (preparing) return;
    setError(null);
    setPreparing(true);
    try {
      await onStartAnnotating();
    } catch (e: any) {
      setPreparing(false);
      setError(e?.message || 'Failed to prepare the interactive segmentation model.');
    }
  };

  const renderRow = (option: MicroSamModelOption) => {
    const selected = option.modelType === modelType;
    const isLoaded = option.modelType === loadedModelType;
    const hasEmbedding = embeddedModelTypes.includes(option.modelType);
    const isRecomputing = recomputingType === option.modelType;
    return (
      <Box
        key={option.modelType}
        sx={{
          display: 'flex', alignItems: 'center', gap: 1, width: '100%',
          borderRadius: 1.5,
          bgcolor: selected ? 'rgba(156,39,176,0.12)' : 'transparent',
          border: '1px solid', borderColor: selected ? 'rgba(156,39,176,0.35)' : 'transparent',
          opacity: microSamAvailable ? 1 : 0.5,
        }}
      >
        <ButtonBase
          onClick={() => {
            setError(null);
            onSelectModelType(option.modelType);
          }}
          disabled={!microSamAvailable}
          sx={{
            display: 'flex', alignItems: 'center', gap: 1, flex: 1, minWidth: 0,
            px: 1.25, py: 0.85, borderRadius: 1.5, textAlign: 'left',
            '&:hover': { bgcolor: selected ? 'rgba(156,39,176,0.16)' : 'action.hover' },
            transition: 'background-color 140ms ease, transform 140ms cubic-bezier(0.23, 1, 0.32, 1)',
            '&:active': { transform: 'scale(0.98)' },
          }}
        >
          <Box sx={{
            width: 8, height: 8, borderRadius: '50%', flexShrink: 0,
            bgcolor: selected ? 'secondary.main' : 'action.disabledBackground',
          }} />
          <Box sx={{ flex: 1, minWidth: 0 }}>
            {/* "(default)" is a property of THIS dialog, not of the model:
                MICRO_SAM_MODEL_TYPE is the box-prompt default only. Marking it
                on the shared option label instead would leak it into the
                fine-tuning picker, whose default is a different model. */}
            <Typography variant="body2" fontWeight={selected ? 700 : 500} color={selected ? 'secondary.main' : 'text.primary'}>
              {option.modelType === MICRO_SAM_MODEL_TYPE ? `${option.label} (default)` : option.label}
            </Typography>
          </Box>
          {isLoaded ? (
            <Tooltip title="Decoder currently loaded">
              <CheckCircleIcon sx={{ fontSize: 16, color: 'success.main', flexShrink: 0 }} />
            </Tooltip>
          ) : (
            <Tooltip title="Start annotating downloads this model's decoder if needed">
              <CloudDownloadOutlinedIcon sx={{ fontSize: 16, color: 'text.disabled', flexShrink: 0 }} />
            </Tooltip>
          )}
          {selected && embeddedModelTypesLoading && (
            <CircularProgress size={14} sx={{ flexShrink: 0 }} />
          )}
        </ButtonBase>
        {selected && !embeddedModelTypesLoading && hasEmbedding && (
          <Tooltip title="Recompute embedding. Clears the cached image encoding and computes it again on the next run.">
            <span style={{ flexShrink: 0, marginRight: 6 }}>
              <IconButton
                size="small"
                onClick={(e) => handleRecompute(e, option.modelType)}
                disabled={isRecomputing || !microSamAvailable}
                aria-label={`Recompute embedding for ${option.label}`}
                sx={{ p: 0.4 }}
              >
                {isRecomputing ? <CircularProgress size={14} /> : <ReplayIcon sx={{ fontSize: 15 }} />}
              </IconButton>
            </span>
          </Tooltip>
        )}
      </Box>
    );
  };

  return (
    <Dialog
      open={open}
      onClose={onClose}
      maxWidth="xs"
      fullWidth
      PaperProps={{ sx: { borderRadius: 3 } }}
    >
      <DialogTitle sx={{ fontWeight: 600, pb: 1 }}>Interactive Segmentation Model</DialogTitle>
      <DialogContent dividers sx={{ pt: 1 }}>
        <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mb: 1.5 }}>
          Choose which μSAM generalist decodes the boxes you draw, then click "Start
          annotating" to prepare it.
        </Typography>
        {!microSamAvailable && (
          <Typography variant="caption" color="error" sx={{ display: 'block', mb: 1.5 }}>
            The micro-sam segmentation service is currently offline.
          </Typography>
        )}
        {error && (
          <Typography variant="caption" color="error" sx={{ display: 'block', mb: 1.5 }}>
            {error}
          </Typography>
        )}
        <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0.5 }}>
          {(['lm', 'em_organelles'] as const).flatMap((group, groupIndex) => {
            const optionsInGroup = MICRO_SAM_MODEL_OPTIONS.filter((o) => o.group === group);
            if (optionsInGroup.length === 0) return [];
            return [
              ...(groupIndex > 0 ? [<Divider key={`divider-${group}`} sx={{ my: 0.5 }} />] : []),
              <ListSubheader key={`header-${group}`} sx={{ fontSize: '0.7rem', lineHeight: '2rem', bgcolor: 'transparent' }}>
                {MICRO_SAM_GROUP_LABELS[group]}
              </ListSubheader>,
              ...optionsInGroup.map((option) => renderRow(option)),
            ];
          })}
        </Box>
      </DialogContent>
      <DialogActions sx={{ px: 2, py: 1.25 }}>
        <Button
          onClick={handleStart}
          disabled={!microSamAvailable || preparing}
          variant="contained"
          size="small"
          startIcon={preparing ? <CircularProgress size={14} color="inherit" /> : undefined}
          sx={{
            textTransform: 'none', borderRadius: 2,
            transition: 'transform 160ms ease-out',
            '&:active': { transform: 'scale(0.97)' },
          }}
        >
          {preparing ? 'Preparing...' : 'Start annotating'}
        </Button>
      </DialogActions>
    </Dialog>
  );
};

export default SamBoxModelDialog;
