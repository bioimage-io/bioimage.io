import React, { useState } from 'react';
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
  onRecomputeEmbedding: (modelType: string) => Promise<void>;
}

/** Model-selection dialog for the Interactive Segmentation (sambox) tool.
 *  Selecting a model here only updates the persisted preference: the ONNX
 *  decoder download and the image embedding compute both stay lazy and only
 *  happen on the first box drawn with that model (see useMicroSamDecoder). */
const SamBoxModelDialog: React.FC<SamBoxModelDialogProps> = ({
  open,
  onClose,
  modelType,
  onSelectModelType,
  loadedModelType,
  microSamAvailable,
  embeddedModelTypes,
  onRecomputeEmbedding,
}) => {
  const [recomputingType, setRecomputingType] = useState<string | null>(null);

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

  const renderRow = (option: MicroSamModelOption) => {
    const selected = option.modelType === modelType;
    const isLoaded = option.modelType === loadedModelType;
    const hasEmbedding = embeddedModelTypes.includes(option.modelType);
    const isRecomputing = recomputingType === option.modelType;
    return (
      <ButtonBase
        key={option.modelType}
        onClick={() => onSelectModelType(option.modelType)}
        disabled={!microSamAvailable}
        sx={{
          display: 'flex', alignItems: 'center', gap: 1, width: '100%',
          px: 1.25, py: 0.85, borderRadius: 1.5, textAlign: 'left',
          bgcolor: selected ? 'rgba(156,39,176,0.12)' : 'transparent',
          border: '1px solid', borderColor: selected ? 'rgba(156,39,176,0.35)' : 'transparent',
          '&:hover': { bgcolor: selected ? 'rgba(156,39,176,0.16)' : 'action.hover' },
          transition: 'background-color 140ms ease, transform 140ms cubic-bezier(0.23, 1, 0.32, 1)',
          '&:active': { transform: 'scale(0.98)' },
          opacity: microSamAvailable ? 1 : 0.5,
        }}
      >
        <Box sx={{
          width: 8, height: 8, borderRadius: '50%', flexShrink: 0,
          bgcolor: selected ? 'secondary.main' : 'action.disabledBackground',
        }} />
        <Box sx={{ flex: 1, minWidth: 0 }}>
          <Typography variant="body2" fontWeight={selected ? 700 : 500} color={selected ? 'secondary.main' : 'text.primary'}>
            {option.label}
          </Typography>
        </Box>
        {isLoaded ? (
          <Tooltip title="Decoder currently loaded">
            <CheckCircleIcon sx={{ fontSize: 16, color: 'success.main', flexShrink: 0 }} />
          </Tooltip>
        ) : (
          <Tooltip title="Decoder downloads on first use with this model">
            <CloudDownloadOutlinedIcon sx={{ fontSize: 16, color: 'text.disabled', flexShrink: 0 }} />
          </Tooltip>
        )}
        {hasEmbedding && (
          <Tooltip title="Recompute embedding. Clears the cached image encoding and computes it again on the next run.">
            <span>
              <IconButton
                size="small"
                onClick={(e) => handleRecompute(e, option.modelType)}
                disabled={isRecomputing || !microSamAvailable}
                aria-label={`Recompute embedding for ${option.label}`}
                sx={{ p: 0.4, flexShrink: 0 }}
              >
                {isRecomputing ? <CircularProgress size={14} /> : <ReplayIcon sx={{ fontSize: 15 }} />}
              </IconButton>
            </span>
          </Tooltip>
        )}
      </ButtonBase>
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
          Choose which μSAM generalist decodes the boxes you draw. Switching models downloads
          nothing here. The decoder and the image embedding load the first time you draw a box
          with that model.
        </Typography>
        {!microSamAvailable && (
          <Typography variant="caption" color="error" sx={{ display: 'block', mb: 1.5 }}>
            The micro-sam segmentation service is currently offline.
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
          onClick={onClose}
          variant="contained"
          size="small"
          sx={{
            textTransform: 'none', borderRadius: 2,
            transition: 'transform 160ms ease-out',
            '&:active': { transform: 'scale(0.97)' },
          }}
        >
          Done
        </Button>
      </DialogActions>
    </Dialog>
  );
};

export default SamBoxModelDialog;
