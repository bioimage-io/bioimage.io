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
  { text: 'Welcome to the BioImage.IO Annotation Tool. This guide covers what each tool does, when to reach for it, and a few gotchas that are easy to miss. Click Next to go through it, or Skip Guide to jump straight in.' },
  { text: 'Move Tool (M): pan and zoom around the image. Scroll to zoom in and out, click and drag to pan. Reach for this whenever you need to reposition the view without risking an accidental edit.', highlightSelector: '[data-tool="move"]' },
  { text: "Select Tool (S): click a mask to select it, or drag on empty space to draw a box and select every mask it touches. Hold Shift to add to the selection, then press Delete to remove the selected masks. Dragging from an already-selected mask still edits its shape instead of starting a new box. Use this to clean up mistakes or AI masks you don't want to keep. Select two or more masks and press Expand Mask (A) to merge them into one.", highlightSelector: '[data-tool="select"]' },
  { text: 'Draw Mask (D): click to place polygon vertices, double-click on the canvas to close the shape. Use this for cells the AI tools miss or get wrong, since you have full control over the exact boundary. Double-click the Draw Mask button itself to switch to a circular brush instead of the polygon lasso. In brush mode, use ArrowUp and ArrowDown to shrink or grow the brush radius, holding either key speeds up the change after about a second.', highlightSelector: '[data-tool="polygon"]' },
  { text: 'Cut Mask (C): draw a line across a mask to split it into two. Useful when the AI segmentation merges two touching cells into a single mask.', highlightSelector: '[data-tool="cutter"]' },
  { text: "Eraser (E): paint a freehand area to remove it from an existing mask. Good for trimming a mask's edge without redrawing the whole boundary. It shares the same lasso/brush mode as Draw Mask, double-click Draw Mask to switch.", highlightSelector: '[data-tool="eraser"]' },
  { text: 'Expand Mask (A): paint a freehand area to add it to the nearest mask it touches. The added area is clipped at the image edges automatically, so you can paint loosely without checking the border yourself. It also shares the lasso/brush mode toggled from Draw Mask. If you have two or more masks selected with the Select tool, pressing this button or A instead merges the selected masks into one. If the selected masks do not touch, nothing is merged and a message tells you why.', highlightSelector: '[data-tool="expander"]' },
  { text: 'Full Image Segmentation: runs μSAM or Cellpose-SAM across the entire image in one pass. Any AI mask that overlaps a mask you already have is trimmed automatically, so accepted results never overlap your existing work.', highlightSelector: '[data-tool="cellpose"]' },
  { text: 'Interactive Segmentation (B): draw a box around one cell for a single μSAM-generated mask. Before it can respond it computes an embedding for the current image plus a decoder pass, so expect a short warm-up (watch for the spinner) the first time you use it on each new image. Like Full Image Segmentation, it never overlaps a mask you already placed. Reach for this to pick off cells one at a time or clean up after a full-image run.', highlightSelector: '[data-tool="sambox"]' },
  { text: 'Fit to Image (0): reset the view to fit the whole image in the viewport. Use this to reorient after zooming in on a detail.', highlightSelector: '[data-tool="fit"]' },
  { text: 'Zoom In (+ or =) / Zoom Out (-): step the magnification up or down around the current view. These keys work no matter which tool is active.', highlightSelector: '[data-tool="zoom-in"]' },
  { text: 'Enhance Contrast: applies CLAHE contrast enhancement so dim or low-contrast features become easier to see. Click the same button (now labeled Restore Original) to switch back. This only changes what you see: segmentation still runs on the raw image unless you separately check "Use contrast enhanced image" in the Full Image Segmentation, so turning contrast on here does not by itself change what the AI tools analyze.', highlightSelector: '[data-tool="clahe"]' },
  { text: 'Undo (Ctrl+Z): undo the last annotation action. The undo history holds the last 10 steps.', highlightSelector: '[data-tool="undo"]' },
  { text: 'Clear All: remove every annotation from the current image at once.', highlightSelector: '[data-tool="clear"]' },
  { text: 'Filter Masks: remove every mask below a minimum area in one step. Use this after a full-image AI run to clear out small spurious detections without deleting them one by one.', highlightSelector: '[data-tool="filter"]' },
  { text: 'Mask Color: choose the hue used for all current and future masks. Reset restores the default color.', highlightSelector: '[data-tool="mask-color"]' },
  { text: "Save Annotation: uploads your masks to cloud storage and advances to the next image. If the current image has no annotations yet, saving is skipped: nothing is uploaded and the tool just moves on.", highlightSelector: '[data-tool="save"]' },
  { text: 'Import Annotation: upload a GeoJSON file to load annotations for the current image, for example to restore a backup or bring in masks produced outside this tool.', highlightSelector: '[data-tool="upload"]' },
  { text: "You're all set. Reopen this Guide anytime from the button in the top right of the page, right next to your account icon." },
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
