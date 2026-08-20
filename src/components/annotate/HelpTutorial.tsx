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
  { text: 'Welcome to the BioImage.IO Annotation Tool. The Tools and Actions sidebars already label what each button does, so this guide only covers gestures, shortcuts, and gotchas that aren\'t shown there. Click Next to go through it, or Skip Guide to jump straight in.' },
  { text: 'Move (M): scroll to zoom in and out, click and drag to pan.', highlightSelector: '[data-tool="move"]' },
  { text: 'Select (S): dragging from an already-selected mask edits its shape instead of starting a new selection box.', highlightSelector: '[data-tool="select"]' },
  { text: 'Draw Mask (D): the lasso/brush toggle (double-click the button) also applies to Eraser and Expand Mask. In brush mode, ArrowUp and ArrowDown resize the brush, holding either key speeds up the change after about a second.', highlightSelector: '[data-tool="polygon"]' },
  { text: 'Expand Mask (A): the painted area is clipped to the image edges automatically.', highlightSelector: '[data-tool="expander"]' },
  { text: 'Full Image Segmentation: any AI mask that overlaps a mask you already have is trimmed automatically, so accepted results never overlap your existing work.', highlightSelector: '[data-tool="cellpose"]' },
  { text: "Interactive Segmentation (B): pick a model and click Start annotating to prepare it (downloads the decoder, computes this image's embedding), then draw a box around a cell for a single AI mask. Once ready, B activates the tool directly instead of reopening this dialog.", highlightSelector: '[data-tool="sambox"]' },
  { text: 'Fit to Image: press 0 to reset the view without reaching for the button.', highlightSelector: '[data-tool="fit"]' },
  { text: 'Zoom In (+ or =) and Zoom Out (-): these keys work no matter which tool is active.', highlightSelector: '[data-tool="zoom-in"]' },
  { text: 'Enhance Contrast: only changes what you see. Segmentation still runs on the raw image unless you also check "Use contrast enhanced image" in Full Image Segmentation.', highlightSelector: '[data-tool="clahe"]' },
  { text: 'Undo (Ctrl+Z): the history holds the last 10 steps.', highlightSelector: '[data-tool="undo"]' },
  { text: 'Save Annotation: if the current image has no annotations yet, nothing is uploaded. It just advances to the next image.', highlightSelector: '[data-tool="save"]' },
  { text: "You're all set. Reopen this Guide anytime from the button in the top right of the page, next to your account icon." },
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
              title="Skip Guide"
              aria-label="Skip Guide"
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
                  Skip Guide
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
