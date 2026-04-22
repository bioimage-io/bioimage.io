import React, { useState, useEffect } from 'react';
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

interface TutorialStep {
  text: string;
  /** CSS selector of the toolbar button to highlight, or null for no highlight */
  highlightSelector?: string;
}

const STEPS: TutorialStep[] = [
  { text: 'Welcome to the BioImage Annotation Tool! This tutorial will guide you through the interface. Click Next to continue.' },
  { text: 'Move Tool (M) \u2014 Pan and zoom the image. Scroll to zoom in/out. Click and drag to pan.', highlightSelector: '[data-tool="move"]' },
  { text: 'Select Tool (S) \u2014 Click to select a mask. Hold Shift to select multiple. Press Delete to remove selected masks.', highlightSelector: '[data-tool="select"]' },
  { text: 'Draw Mask (D) \u2014 Click to place polygon vertices, double-click to close and finish the mask.', highlightSelector: '[data-tool="polygon"]' },
  { text: 'AI Pre-Segmentation \u2014 Run Cellpose AI segmentation on the current image. Opens settings first so you can adjust parameters before running.', highlightSelector: '[data-tool="cellpose"]' },
  { text: 'Cut Mask (C) \u2014 Draw a line across a mask to split it into two separate polygons.', highlightSelector: '[data-tool="cutter"]' },
  { text: 'Eraser (E) \u2014 Draw a freehand area to subtract from existing masks.', highlightSelector: '[data-tool="eraser"]' },
  { text: 'Expand Mask (A) \u2014 Draw a freehand area to add to an existing mask. The drawn area merges with the nearest intersecting mask.', highlightSelector: '[data-tool="expander"]' },
  { text: 'Save Annotation \u2014 Upload masks to cloud storage and load the next image. If no annotations exist the image is skipped.', highlightSelector: '[data-tool="save"]' },
  { text: 'Fit to Image \u2014 Reset the view to fit the entire image in the viewport.', highlightSelector: '[data-tool="fit"]' },
  { text: 'Contrast Enhancement \u2014 Apply CLAHE contrast enhancement to help visualize dim features. Click again to restore the original image.', highlightSelector: '[data-tool="clahe"]' },
  { text: 'Undo (Ctrl+Z) \u2014 Undo the last annotation action. Supports up to 10 undo steps.', highlightSelector: '[data-tool="undo"]' },
  { text: 'Clear All \u2014 Remove all annotations from the current image. This can be undone with Ctrl+Z.', highlightSelector: '[data-tool="clear"]' },
  { text: 'Filter Masks \u2014 Remove masks below a minimum area. Useful for eliminating small spurious detections.', highlightSelector: '[data-tool="filter"]' },
  { text: "You're all set! Use the Help button anytime to revisit this tutorial. Happy annotating!" },
];

const HIGHLIGHT_STYLE = '0 0 0 3px #1976d2, 0 0 12px rgba(25, 118, 210, 0.5)';

const HelpTutorial: React.FC<HelpTutorialProps> = ({ open, onClose }) => {
  const [step, setStep] = useState(0);

  // Highlight the relevant toolbar button for the current step
  useEffect(() => {
    if (!open) return;
    const selector = STEPS[step]?.highlightSelector;
    if (!selector) return;

    const el = document.querySelector(selector) as HTMLElement | null;
    if (!el) return;

    // Scroll element into view so it's visible in the (possibly scrollable) sidebar
    el.scrollIntoView({ behavior: 'smooth', block: 'nearest' });

    const prev = el.style.boxShadow;
    const prevZ = el.style.zIndex;
    const prevPos = el.style.position;
    el.style.boxShadow = HIGHLIGHT_STYLE;
    el.style.zIndex = '1500';
    el.style.position = 'relative';
    el.style.borderRadius = '8px';

    return () => {
      el.style.boxShadow = prev;
      el.style.zIndex = prevZ;
      el.style.position = prevPos;
      el.style.borderRadius = '';
    };
  }, [open, step]);

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
            {STEPS[step].text}
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
            <Button onClick={handleNext} variant="contained" size="small">
              {isLast ? 'Finish' : 'Next'}
            </Button>
          </Stack>
        </Paper>
      </Box>
    </Fade>
  );
};

export default HelpTutorial;
