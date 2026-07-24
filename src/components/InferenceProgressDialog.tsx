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
import { RunnerStages, RunnerState, resolveStage, isTerminalRunnerState } from '../types/runStatus';

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
  /** Coarse lifecycle state (v1.15.36+); drives the cancel affordance and the
   *  terminal "cancelled" rendering. Undefined on older runners. */
  state?: RunnerState | null;
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
  /**
   * Cancel the in-flight run. When provided together with canCancel, a Cancel
   * button is shown while the run is non-terminal.
   */
  onCancel?: () => void;
  /** True while a cancel request is being sent (button shows "Cancelling..."). */
  isCancelling?: boolean;
  /** Whether the connected runner supports cancellation (feature-detected). */
  canCancel?: boolean;
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
  onCancel,
  isCancelling = false,
  canCancel = false,
}) => {
  const runCancelled = progress?.state === 'cancelled';
  // Offer Cancel only while the run is in flight, supported, and non-terminal.
  const canShowCancel =
    isRunning && !!onCancel && canCancel && !isTerminalRunnerState(progress?.state);
  return (
    <Dialog
      open={open}
      onClose={onClose}
      maxWidth={false}
      PaperProps={{
        sx: {
          backgroundColor: 'rgba(255, 255, 255, 0.95)',
          backdropFilter: 'blur(8px)',
          border: '1px solid rgba(255, 255, 255, 0.5)',
          borderRadius: '16px',
          maxHeight: '90vh',
          // Fixed width + min-height so the dialog doesn't resize as steps
          // appear or the queue text changes.
          width: 500,
          maxWidth: 500,
          minHeight: 360,
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
          {runCancelled
            ? 'Model Inference Cancelled'
            : isRunning
              ? 'Model Inference in Progress'
              : 'Model Inference Complete'}
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

          {/* Cancel the in-flight run (model-runner v1.15.36+). */}
          {canShowCancel && (
            <button
              type="button"
              onClick={onCancel}
              disabled={isCancelling}
              className="mt-1 inline-flex items-center gap-2 px-4 py-2 rounded-md text-sm font-medium text-red-600 bg-red-50 border border-red-200 hover:bg-red-100 transition-transform duration-150 ease-out active:scale-[0.97] disabled:opacity-60 disabled:cursor-not-allowed disabled:active:scale-100"
            >
              {isCancelling ? (
                <>
                  <svg className="animate-spin w-4 h-4" viewBox="0 0 24 24">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" />
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                  </svg>
                  Cancelling...
                </>
              ) : (
                <>
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M18.364 18.364A9 9 0 005.636 5.636m12.728 12.728A9 9 0 015.636 5.636m12.728 12.728L5.636 5.636" />
                  </svg>
                  Cancel Run
                </>
              )}
            </button>
          )}

          {/* Terminal cancelled state confirmation. */}
          {runCancelled && (
            <Typography variant="body2" sx={{ color: '#b45309', fontWeight: 500 }}>
              Inference run cancelled.
            </Typography>
          )}
        </Box>
      </DialogContent>
    </Dialog>
  );
};

export default InferenceProgressDialog;
