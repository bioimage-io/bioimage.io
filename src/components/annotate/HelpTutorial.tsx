import React, { useState } from 'react';
import {
  Paper,
  Typography,
  Button,
  IconButton,
  LinearProgress,
  Stack,
  Box,
  Fade,
} from '@mui/material';
import CloseIcon from '@mui/icons-material/Close';

interface HelpTutorialProps {
  open: boolean;
  onClose: () => void;
}

const STEPS = [
  'Welcome to the BioImage Annotation Tool! This tutorial will guide you through the interface. Click Next to continue.',
  'Move Tool (shortcut: press 1) \u2014 Pan and zoom the image. Scroll to zoom in/out. Click and drag to pan.',
  'Select Tool (shortcut: press 2) \u2014 Draw a rectangle to select all masks within the area. Press Delete to remove selected masks. You can also modify mask vertices.',
  'Draw Mask Tool (shortcut: press 3) \u2014 Draw freehand to create a segmentation mask. Release the mouse to complete the polygon.',
  'Cut Mask Tool (shortcut: press 4) \u2014 Draw a line across a mask to split it into two separate polygons.',
  'Eraser Tool (shortcut: press 5) \u2014 Draw a freehand area to subtract from existing masks.',
  'Undo (Ctrl+Z) \u2014 Undo the last annotation action. Supports up to 10 undo steps.',
  'Clear All \u2014 Remove all annotations. This can be undone with Ctrl+Z.',
  'Fit to Image \u2014 Reset the view to fit the entire image in the viewport.',
  'AI Segmentation \u2014 Run Cellpose AI segmentation on the current image. Click the settings icon next to it to configure parameters.',
  'Contrast Enhancement \u2014 Apply CLAHE contrast enhancement to help visualize dim features. Click again to restore the original image.',
  'Save \u2014 Save annotations and load the next image. If no annotations exist, the image is skipped.',
  "You're all set! Use the Help button anytime to revisit this tutorial. Happy annotating!",
];

const HelpTutorial: React.FC<HelpTutorialProps> = ({ open, onClose }) => {
  const [step, setStep] = useState(0);

  const handleNext = () => {
    if (step < STEPS.length - 1) {
      setStep(step + 1);
    } else {
      handleClose();
    }
  };

  const handleBack = () => {
    if (step > 0) {
      setStep(step - 1);
    }
  };

  const handleClose = () => {
    setStep(0);
    onClose();
  };

  if (!open) return null;

  const progress = ((step + 1) / STEPS.length) * 100;
  const isLast = step === STEPS.length - 1;

  return (
    <Fade in={open}>
      <Box
        sx={{
          position: 'fixed',
          inset: 0,
          zIndex: 1400,
          display: 'flex',
          alignItems: 'flex-end',
          justifyContent: 'center',
          pointerEvents: 'none',
          pb: 4,
        }}
      >
        {/* Semi-transparent backdrop */}
        <Box
          onClick={handleClose}
          sx={{
            position: 'fixed',
            inset: 0,
            bgcolor: 'rgba(0, 0, 0, 0.3)',
            pointerEvents: 'auto',
          }}
        />

        {/* Floating card */}
        <Paper
          elevation={8}
          sx={{
            position: 'relative',
            zIndex: 1,
            pointerEvents: 'auto',
            maxWidth: 520,
            width: '90%',
            p: 3,
            borderRadius: 2,
          }}
        >
          <LinearProgress
            variant="determinate"
            value={progress}
            sx={{ mb: 2, borderRadius: 1 }}
          />

          <Stack direction="row" justifyContent="space-between" alignItems="center" sx={{ mb: 1 }}>
            <Typography variant="caption" color="text.secondary">
              {step + 1} / {STEPS.length}
            </Typography>
            <IconButton size="small" onClick={handleClose} sx={{ mr: -1, mt: -1 }}>
              <CloseIcon fontSize="small" />
            </IconButton>
          </Stack>

          <Typography variant="body1" sx={{ mb: 3, lineHeight: 1.6 }}>
            {STEPS[step]}
          </Typography>

          <Stack direction="row" justifyContent="space-between">
            <Button
              onClick={handleBack}
              disabled={step === 0}
              size="small"
              color="inherit"
            >
              Back
            </Button>
            <Stack direction="row" spacing={1}>
              <Button onClick={handleClose} size="small" color="inherit">
                Exit
              </Button>
              <Button onClick={handleNext} variant="contained" size="small">
                {isLast ? 'Finish' : 'Next'}
              </Button>
            </Stack>
          </Stack>
        </Paper>
      </Box>
    </Fade>
  );
};

export default HelpTutorial;
