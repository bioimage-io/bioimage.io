import React from 'react';
import {
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  Button,
  Slider,
  Typography,
  Box,
  IconButton,
} from '@mui/material';
import CloseIcon from '@mui/icons-material/Close';
import {
  useAnnotationStore,
  hslToHex,
  MASK_COLOR_SATURATION,
  MASK_COLOR_LIGHTNESS,
  DEFAULT_MASK_HUE,
} from '../../store/annotationStore';

// A fixed-saturation/lightness hue ramp for the slider track, so the thumb's
// position always previews the color it's about to pick.
const HUE_TRACK_BACKGROUND = `linear-gradient(to right, ${Array.from(
  { length: 13 },
  (_, i) => hslToHex(i * 30, MASK_COLOR_SATURATION, MASK_COLOR_LIGHTNESS)
).join(', ')})`;

interface MaskColorDialogProps {
  open: boolean;
  onClose: () => void;
}

const MaskColorDialog: React.FC<MaskColorDialogProps> = ({ open, onClose }) => {
  const maskHue = useAnnotationStore((s) => s.maskHue);
  const setMaskHue = useAnnotationStore((s) => s.setMaskHue);
  const resetMaskHue = useAnnotationStore((s) => s.resetMaskHue);

  const hex = hslToHex(maskHue, MASK_COLOR_SATURATION, MASK_COLOR_LIGHTNESS);

  return (
    <Dialog open={open} onClose={onClose} maxWidth="xs" fullWidth PaperProps={{ sx: { borderRadius: 3 } }}>
      <DialogTitle sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', fontWeight: 600 }}>
        Mask Color
        <IconButton size="small" onClick={onClose} sx={{ mr: -1 }}>
          <CloseIcon fontSize="small" />
        </IconButton>
      </DialogTitle>
      <DialogContent>
        <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
          Applies to every mask in this image.
        </Typography>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5, mb: 1 }}>
          <Box
            sx={{
              width: 32,
              height: 32,
              borderRadius: '50%',
              flexShrink: 0,
              bgcolor: hex,
              border: '1px solid rgba(0,0,0,0.15)',
            }}
          />
          <Slider
            value={maskHue}
            onChange={(_, v) => setMaskHue(v as number)}
            min={0}
            max={360}
            aria-label="Mask hue"
            sx={{
              color: hex,
              '& .MuiSlider-rail': { background: HUE_TRACK_BACKGROUND, opacity: 1 },
              '& .MuiSlider-track': { border: 'none', background: 'transparent' },
            }}
          />
        </Box>
        <Typography variant="caption" color="text.secondary" sx={{ fontFamily: 'monospace' }}>
          {hex}
        </Typography>
      </DialogContent>
      <DialogActions>
        <Button onClick={resetMaskHue} color="inherit" size="small" disabled={maskHue === DEFAULT_MASK_HUE}>
          Reset
        </Button>
        <Button onClick={onClose} size="small">
          Done
        </Button>
      </DialogActions>
    </Dialog>
  );
};

export default MaskColorDialog;
