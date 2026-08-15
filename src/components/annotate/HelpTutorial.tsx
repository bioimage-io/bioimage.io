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
  { text: 'Welcome to the BioImage Annotation Tool! This tutorial walks through the interface. Click Next to continue, or Skip to jump straight in.' },
  { text: 'Move Tool (M): pan and zoom the image. Scroll to zoom in and out, click and drag to pan.', highlightSelector: '[data-tool="move"]' },
  { text: 'Select Tool (S): click a mask to select it. Hold Shift to select multiple, press Delete to remove the selected masks.', highlightSelector: '[data-tool="select"]' },
  { text: 'Draw Mask (D): click to place polygon vertices, double-click to close and finish the mask.', highlightSelector: '[data-tool="polygon"]' },
  { text: 'Cut Mask (C): draw a line across a mask to split it into two separate masks.', highlightSelector: '[data-tool="cutter"]' },
  { text: 'Eraser (E): paint a freehand area to remove it from an existing mask.', highlightSelector: '[data-tool="eraser"]' },
  { text: 'Expand Mask (A): paint a freehand area to add it to the nearest intersecting mask. The added area is clipped to the image edges.', highlightSelector: '[data-tool="expander"]' },
  { text: 'Full Image Segmentation: run AI segmentation across the whole image. It sits with Interactive Segmentation at the bottom of the tools list, separated from the manual tools. Settings open first so you can tune parameters before running, and a spinner shows while the model warms up. Any AI mask that overlaps an existing annotation is trimmed so masks never overlap.', highlightSelector: '[data-tool="cellpose"]' },
  { text: 'Interactive Segmentation (B): draw a box around one cell for a one-click AI mask. It warms up the first time you open an image, so watch for the spinner, and it never overlaps an existing annotation.', highlightSelector: '[data-tool="sambox"]' },
  { text: 'Fit to Image: reset the view to fit the entire image in the viewport.', highlightSelector: '[data-tool="fit"]' },
  { text: 'Zoom In / Zoom Out: step the magnification up or down around the current view.', highlightSelector: '[data-tool="zoom-in"]' },
  { text: 'Enhance Contrast: apply CLAHE contrast enhancement to help visualize dim features. Click again to restore the original image.', highlightSelector: '[data-tool="clahe"]' },
  { text: 'Undo (Ctrl+Z): undo the last annotation action. Supports up to 10 undo steps.', highlightSelector: '[data-tool="undo"]' },
  { text: 'Clear All: remove every annotation from the current image. This can be undone with Ctrl+Z.', highlightSelector: '[data-tool="clear"]' },
  { text: 'Filter Masks: remove masks below a minimum area, useful for eliminating small spurious detections.', highlightSelector: '[data-tool="filter"]' },
  { text: 'Save Annotation: upload your masks to cloud storage and load the next image. If there are no annotations yet, the image is skipped.', highlightSelector: '[data-tool="save"]' },
  { text: 'Import Annotation: upload a GeoJSON file to load annotations for the current image.', highlightSelector: '[data-tool="upload"]' },
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
            <IconButton
              size="small"
              onClick={handleClose}
              title="Skip tutorial"
              aria-label="Skip tutorial"
              sx={{ mr: -1, mt: -1 }}
            >
              <CloseIcon fontSize="small" />
            </IconButton>
          </Stack>

          <Typography variant="body1" sx={{ mb: 3, lineHeight: 1.6 }}>
            {STEPS[step].text}
          </Typography>

          <Stack direction="row" justifyContent="space-between" alignItems="center">
            <Button
              onClick={handleBack}
              disabled={step === 0}
              size="small"
              color="inherit"
            >
              Back
            </Button>
            <Stack direction="row" spacing={1} alignItems="center">
              {!isLast && (
                <Button
                  onClick={handleClose}
                  size="small"
                  color="inherit"
                  sx={{ textTransform: 'none' }}
                >
                  Skip tutorial
                </Button>
              )}
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
