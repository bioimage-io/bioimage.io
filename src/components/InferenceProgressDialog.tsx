import React from 'react';
import {
  Dialog,
  DialogTitle,
  DialogContent,
  IconButton,
  Typography,
  Box,
} from '@mui/material';
import CloseIcon from '@mui/icons-material/Close';
import StepTimeline, { TimelineStep } from './StepTimeline';
import { RunnerStages, resolveStage } from '../types/runStatus';

/**
 * Progress for the inference dialog. All timestamps are Unix seconds and come
 * from the runner (trusted as-is). The per-step `stages` object drives the
 * timeline; the infer path has no conda env build, so only model_download and
 * run appear. `completedAt` freezes the timeline once the result returns. Legacy
 * flat fields are kept as an optional fallback.
 */
export interface InferenceProgress {
  submittedAt: number | null;
  stages?: RunnerStages | null;
  queuePosition?: number;
  modelDownload?: number | null;
  running?: number | null;
  completedAt: number | null;
}

interface InferenceProgressDialogProps {
  open: boolean;
  onClose: () => void;
  /**
   * True while the run is still in flight — controls the dialog title
   * ("Model Inference in Progress" vs "Model Inference Complete") and the
   * BioEngine logo animation, mirroring the model-test dialog.
   */
  isRunning: boolean;
  /** Structured progress; null before the first poll returns. */
  progress: InferenceProgress | null;
  /** Fallback text shown before structured progress is available. */
  loadingMessage?: string;
}

/**
 * Progress popup for the "Run Model" inference flow. It is the inference twin
 * of the model-test progress view in {@link TestDetailsDialog}: same BioEngine
 * logo + {@link StepTimeline}, but with inference-specific titles and only the
 * "Preparing model" / "Running" steps (there is no per-model environment setup
 * on the infer path).
 */
const InferenceProgressDialog: React.FC<InferenceProgressDialogProps> = ({
  open,
  onClose,
  isRunning,
  progress,
  loadingMessage,
}) => {
  return (
    <Dialog
      open={open}
      onClose={onClose}
      maxWidth="xs"
      PaperProps={{
        sx: {
          backgroundColor: 'rgba(255, 255, 255, 0.95)',
          backdropFilter: 'blur(8px)',
          border: '1px solid rgba(255, 255, 255, 0.5)',
          borderRadius: '16px',
          maxHeight: '90vh',
        },
      }}
    >
      <DialogTitle
        sx={{
          m: 0,
          p: 3,
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          borderBottom: '1px solid rgba(255, 255, 255, 0.3)',
        }}
      >
        <Typography variant="h5" sx={{ fontWeight: 300, color: '#1f2937' }}>
          {isRunning ? 'Model Inference in Progress' : 'Model Inference Complete'}
        </Typography>
        <IconButton
          onClick={onClose}
          aria-label="close"
          sx={{
            backgroundColor: 'rgba(239, 68, 68, 0.1)',
            border: '1px solid rgba(239, 68, 68, 0.2)',
            borderRadius: '12px',
            color: '#dc2626',
            '&:hover': {
              backgroundColor: 'rgba(239, 68, 68, 0.2)',
            },
          }}
        >
          <CloseIcon />
        </IconButton>
      </DialogTitle>

      <DialogContent dividers sx={{ p: 0 }}>
        <Box sx={{ p: 4, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 2.5 }}>
          <img
            src={isRunning
              ? '/static/img/bioengine-logo-black.svg'
              : '/static/img/bioengine-logo-black-static.svg'}
            alt="BioEngine"
            className={isRunning ? 'animate-pulse' : ''}
            style={{ height: '64px' }}
          />

          {progress ? (
            <StepTimeline
              startedLabel="Run started"
              submittedAt={progress.submittedAt}
              fallbackQueuePosition={progress.queuePosition ?? null}
              completedAt={progress.completedAt}
              steps={[
                {
                  key: 'model_download',
                  header: 'Preparing model',
                  description: 'Check the cache and download any outdated model files',
                  ...resolveStage(progress.stages?.model_download, progress.modelDownload),
                },
                {
                  key: 'run',
                  header: 'Running',
                  description: 'Run the model on your input',
                  ...resolveStage(progress.stages?.run, progress.running),
                },
              ] as TimelineStep[]}
            />
          ) : (
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, justifyContent: 'center' }}>
              <Typography variant="body2" color="text.secondary">
                {loadingMessage || 'Running inference...'}
              </Typography>
            </Box>
          )}
        </Box>
      </DialogContent>
    </Dialog>
  );
};

export default InferenceProgressDialog;
