import React from 'react';
import {
  Dialog,
  DialogTitle,
  DialogContent,
  IconButton,
  Typography,
  Box,
  Accordion,
  AccordionSummary,
  AccordionDetails,
  Chip,
  Stack,
  Alert,
  Paper,
  Tooltip,
} from '@mui/material';
import CloseIcon from '@mui/icons-material/Close';
import ContentCopyIcon from '@mui/icons-material/ContentCopy';
import yaml from 'js-yaml';
import ExpandMoreIcon from '@mui/icons-material/ExpandMore';
import CheckCircleIcon from '@mui/icons-material/CheckCircle';
import CancelIcon from '@mui/icons-material/Cancel';
import WarningIcon from '@mui/icons-material/Warning';
import ErrorIcon from '@mui/icons-material/Error';
import RemoveCircleOutlineIcon from '@mui/icons-material/RemoveCircleOutline';
import StepTimeline, { TimelineStep } from './StepTimeline';
import { RunnerStages, RunnerState, resolveStage, isTerminalRunnerState } from '../types/runStatus';

/**
 * v1.15+ API — progress described by the dict returned by get_test_status /
 * get_infer_status. All timestamps are Unix seconds. The per-step `stages`
 * object (v1.15.23+) drives the timeline; the legacy flat fields are kept as an
 * optional fallback for a slightly older runner.
 */
export interface ProgressInfoV2 {
  version: 'v2';
  /** Unix seconds when the job was submitted/queued. */
  submittedAt?: number | null;
  /** Per-step queue positions + start/end timestamps (preferred source). */
  stages?: RunnerStages | null;
  /** Coarse lifecycle state (v1.15.36+); drives the cancel affordance and the
   *  terminal "cancelled" rendering. Undefined on older runners. */
  state?: RunnerState | null;
  /** Legacy flat fields (fallback when `stages` is absent). */
  queuePosition?: number;
  modelDownload?: number | null;
  envSetup?: number | null;
  running?: number | null;
  /** Unix seconds when the job finished; null until then. */
  completedAt?: number | null;
  /** Client-side Date.now()/1000 of the poll that first carried a non-null result. */
  resultTime?: number;
}

export type ProgressInfo = ProgressInfoV2;

interface TestDetailsDialogProps {
  open: boolean;
  onClose: () => void;
  data: any | null;
  isLoading: boolean;
  /** Shown inside the dialog while isLoading is true and progressInfo is absent. */
  loadingMessage?: string;
  /** Structured progress state for badge rendering while loading. */
  progressInfo?: ProgressInfo;
  rawErrorContent?: string | null;
  isInvalidJson?: boolean;
  type: 'test-report' | 'compatibility';
  partnerName?: string; // For compatibility reports
  partnerVersion?: string; // For compatibility reports
  /**
   * When false (default true), a finished test keeps showing the step timeline
   * with a "View Test Report" button instead of jumping straight to the report,
   * letting the user review the steps first. Clicking the button calls
   * onViewReport, which flips this to true.
   */
  showReport?: boolean;
  onViewReport?: () => void;
  /**
   * Cancel the in-flight run. When provided together with canCancel, a Cancel
   * button is shown in the progress view while the run is non-terminal.
   */
  onCancel?: () => void;
  /** True while a cancel request is being sent (button shows "Cancelling..."). */
  isCancelling?: boolean;
  /** Whether the connected runner supports cancellation (feature-detected). */
  canCancel?: boolean;
}

/**
 * Renders `ValidationDetail.recommended_env` as a conda environment.yaml.
 *
 * The payload is a `CondaEnv` (spec-bioimage-io `conda_env.py:32`): `name`,
 * `channels`, and `dependencies`, where a dependency is either a spec string
 * or a `{pip: [...]}` block. That is exactly the content of an
 * environment.yaml, so YAML is both the more readable rendering and one the
 * user can paste straight into `conda env create -f`. It used to be shown as
 * JSON, which conda cannot consume.
 *
 * lineWidth: -1 disables line folding. At the default width js-yaml wraps a
 * long dependency into a `>-` block, e.g. a git+https pip URL split across two
 * indented lines. That still parses back to the same string, so it is not a
 * correctness problem, but it is unreadable and it stops the block from
 * looking like an environment.yaml anyone would recognise.
 *
 * js-yaml throws on values it cannot represent (a cycle, a function). The
 * payload is server-sent and typed `any`, so we fall back to JSON rather than
 * let a malformed report take the whole dialog down.
 */
const RecommendedEnv: React.FC<{ env: any }> = ({ env }) => {
  const [copied, setCopied] = React.useState(false);

  const { text, isYaml } = React.useMemo(() => {
    try {
      return { text: yaml.dump(env, { lineWidth: -1, noRefs: true }), isYaml: true };
    } catch {
      return { text: JSON.stringify(env, null, 2), isYaml: false };
    }
  }, [env]);

  const handleCopy = () => {
    navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <Box sx={{ mb: 2 }}>
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 1 }}>
        <Typography variant="subtitle2" sx={{ fontWeight: 500 }}>
          Recommended Environment:
        </Typography>
        <Tooltip title={copied ? 'Copied' : 'Copy as environment.yaml'} placement="top">
          <IconButton onClick={handleCopy} size="small" sx={{ padding: '2px' }}>
            <ContentCopyIcon sx={{ fontSize: 16 }} />
          </IconButton>
        </Tooltip>
        {copied && (
          <Typography variant="caption" sx={{ color: 'success.main' }}>
            Copied
          </Typography>
        )}
      </Box>
      <Paper
        sx={{
          p: 2,
          backgroundColor: 'rgba(249, 250, 251, 0.8)',
          border: '1px solid rgba(255, 255, 255, 0.5)',
          borderRadius: '8px',
        }}
      >
        <pre style={{ margin: 0, fontSize: '0.875rem', overflow: 'auto' }}>{text}</pre>
      </Paper>
      {!isYaml && (
        <Typography variant="caption" sx={{ color: 'text.secondary' }}>
          This environment could not be shown as YAML, so it is shown as JSON.
        </Typography>
      )}
    </Box>
  );
};

const TestDetailsDialog: React.FC<TestDetailsDialogProps> = ({
  open,
  onClose,
  data,
  isLoading,
  loadingMessage,
  progressInfo,
  rawErrorContent,
  isInvalidJson = false,
  type,
  partnerName,
  partnerVersion,
  showReport = true,
  onViewReport,
  onCancel,
  isCancelling = false,
  canCancel = false,
}) => {
  // Show the progress/timeline view while loading, and after completion until
  // the user opens the report (showReport). Compatibility reports always go
  // straight to the report.
  const showProgressView = isLoading || (type === 'test-report' && !showReport && progressInfo != null);
  // Terminal cancelled run: keep the timeline visible but render a "Cancelled"
  // message instead of the "View Test Report" button (there is no report).
  const runCancelled = progressInfo?.state === 'cancelled';
  // Offer Cancel only while the run is genuinely in flight, the runner supports
  // it, and it hasn't already reached a terminal state.
  const canShowCancel =
    isLoading && !!onCancel && canCancel && !isTerminalRunnerState(progressInfo?.state);
  // The test is genuinely running (started → completed). We key the BioEngine
  // logo animation on this rather than isLoading, because isLoading stays true
  // through the post-test onTestComplete work (e.g. reloading artifact files),
  // during which the test is already done and the timeline is frozen.
  const testInProgress = isLoading
    && progressInfo?.completedAt == null
    && progressInfo?.resultTime == null;
  // The run has finished (result available) but we're still on the timeline. A
  // cancelled run has no report, so it never shows the "View Test Report" step.
  const runFinished = showProgressView && !testInProgress && !!data && !runCancelled;
  // Debug logging
  React.useEffect(() => {
    if (open) {
      console.log('TestDetailsDialog opened with props:', {
        isLoading,
        isInvalidJson,
        hasData: !!data,
        hasRawErrorContent: !!rawErrorContent,
        type,
        data: data ? 'Valid object' : 'null/undefined'
      });
    }
  }, [open, isLoading, isInvalidJson, data, rawErrorContent, type]);
  
  // Helper function to parse saved_conda_list
  /**
   * Render the recorded package list, whatever tool produced it.
   *
   * `conda list` writes its stderr into the same stream, so a real list can be
   * preceded by WARNING noise. Seeking the conda header skips that, which is
   * why this used to REQUIRE the header and return empty without it.
   *
   * That was too strict. The field is not necessarily conda: a standard-env run
   * records the serving venv as a pip freeze list, which has no such header, and
   * the old rule rendered nothing at all for it. Worse, it pushed the producer
   * toward synthesising a fake conda header purely to satisfy this function.
   * The header is now a hint used when present, not a precondition.
   *
   * IF THIS EVER RENDERS SECTIONS: a model can have one environment per weight
   * format, and model-runner joins them with a blank line.
   *
   * The section marker is NOT conda's "# packages in environment at". The runner
   * swaps conda for mamba to get the libmamba solver, and mamba prints its own
   * header. Measured on the live 2.10.5 report for stupendous-sheep: zero
   * occurrences of the conda form, one of the mamba form.
   *
   *     List of packages in environment: "/home/.../envs/<hash>"
   *     <blank>
   *       Name            Version   Build     Channel
   *       ...
   *
   * So split on `List of packages in environment:`, and note the path is quoted
   * rather than colon-terminated. Never split on the blank line: mamba output
   * contains blank lines of its own, the marker does not. Treating whatever
   * precedes the first marker as its own unlabelled section also covers the pip
   * case (standard-env runs record a pip freeze list with no header at all).
   *
   * DELIBERATELY NOT IMPLEMENTED, and do not implement it on spec. The shape
   * does not occur. Measured across the collection (2026-09-26, 155 models whose
   * rdf.yaml could be read): 34 models declare two or more weight formats, and
   * of those, ZERO declare dependencies on more than one. Six declare them on
   * exactly one format and 28 on none. The control matters: the zero is not
   * because nothing has two formats, it is because nothing that has two formats
   * uses them this way. Treat 34 and the zero as lower bounds, since a handful
   * of rdf fetches failed and were excluded.
   *
   * The producer side is correspondingly defensive and unexercised: model-runner
   * 2.10.5 does build one env per weight format and record all of them, but no
   * published model reaches that branch, so it has never run in production.
   *
   * Consequence: a renderer written today could only be verified against a
   * description of a shape nothing emits. If a genuine two-environment model
   * ever appears, build it then, against that report.
   */
  const parseSavedCondaList = (packageListString?: string): string => {
    if (!packageListString) return '';

    const lines = packageListString.split('\n');
    const headerIdx = lines.findIndex(line => line.includes('# packages in environment at'));
    const body = headerIdx >= 0
      ? lines.slice(headerIdx)
      : lines.filter(line => !/^\s*(WARNING|ERROR)\b/.test(line));

    return body
      .map(line => line.replace(/^[#\s]+/, ''))
      .filter(line => line.length > 0)
      .join('\n');
  };
  
  const getStatusIcon = (status: string) => {
    return status === 'passed' ? (
      <CheckCircleIcon sx={{ color: '#22c55e', fontSize: 20 }} />
    ) : status === 'skipped' ? (
      <RemoveCircleOutlineIcon sx={{ color: '#6b7280', fontSize: 20 }} />
    ) : status === 'valid-format' ? (
      <CancelIcon sx={{ color: '#f97316', fontSize: 20 }} />
    ) : (
      <CancelIcon sx={{ color: '#ef4444', fontSize: 20 }} />
    );
  };

  // A skipped check is NOT a failure and must not be painted as one. The runner
  // skips the default-environment inference check for models that declare their
  // own conda environment: run in the runner's venv it could only ever fail on a
  // missing import, which says nothing about the model.
  const getStatusColor = (status: string) => {
    if (status === 'passed') return '#22c55e';
    if (status === 'skipped') return '#6b7280';
    if (status === 'valid-format') return '#f97316';
    return '#ef4444';
  };

  // Get bioimageio.core version from env array
  const getBioImageCoreVersion = () => {
    if (!data?.env || !Array.isArray(data.env)) return null;
    const coreEnv = data.env.find((item: any[]) => item[0] === 'bioimageio.core');
    return coreEnv ? coreEnv[1] : null;
  };

  const getDialogTitle = () => {
    if (type === 'compatibility') return 'Compatibility Test Details';
    if (runCancelled) return 'Model Test Cancelled';
    if (isLoading) return 'Model Testing in Progress';
    if (showProgressView) return 'Model Test Complete';
    return 'Test Report Details';
  };

  const getHeaderInfo = () => {
    if (type === 'compatibility' && partnerName) {
      return (
        <>
          {getStatusIcon(data?.status || 'unknown')}
          <Typography variant="h6" sx={{ fontWeight: 500 }}>
            {partnerName}
          </Typography>
          {partnerVersion && (
            <Typography variant="body2" color="text.secondary">
              v{partnerVersion}
            </Typography>
          )}
        </>
      );
    }
    
    // Test report - show bioimageio.core version with icon
    const version = getBioImageCoreVersion();
    return (
      <>
        {getStatusIcon(data?.status || 'unknown')}
        <Typography variant="h6" sx={{ fontWeight: 500 }}>
          bioimageio.core
        </Typography>
        {version && (
          <Typography variant="body2" color="text.secondary">
            v{version}
          </Typography>
        )}
      </>
    );
  };

  return (
    <Dialog
      open={open}
      onClose={onClose}
      maxWidth={showProgressView ? false : 'lg'}
      fullWidth={!showProgressView}
      PaperProps={{
        sx: {
          backgroundColor: 'rgba(255, 255, 255, 0.95)',
          backdropFilter: 'blur(8px)',
          border: '1px solid rgba(255, 255, 255, 0.5)',
          borderRadius: '16px',
          maxHeight: '90vh',
          // Progress / complete view: fixed width + min-height so the dialog
          // doesn't resize as steps appear or the queue text changes.
          ...(showProgressView ? { width: 500, maxWidth: 500, minHeight: 380 } : {}),
        }
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
          {getDialogTitle()}
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
        {showProgressView ? (
          <Box sx={{ p: 4, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 2.5 }}>
            <img
              src={testInProgress
                ? '/static/img/bioengine-logo-black.svg'
                : '/static/img/bioengine-logo-black-static.svg'}
              alt="BioEngine"
              className={testInProgress ? 'animate-pulse' : ''}
              style={{ height: '64px' }}
            />

            {progressInfo ? (
              /* v1.15+ step timeline: overall start on top, per-step durations. */
              <StepTimeline
                submittedAt={progressInfo.submittedAt ?? null}
                fallbackQueuePosition={progressInfo.queuePosition ?? null}
                completedAt={progressInfo.completedAt ?? progressInfo.resultTime ?? null}
                steps={[
                  {
                    key: 'model_download',
                    header: 'Preparing model',
                    description: 'Check the cache and download any outdated model files',
                    ...resolveStage(progressInfo.stages?.model_download, progressInfo.modelDownload),
                  },
                  {
                    key: 'env_setup',
                    header: 'Environment setup',
                    description: 'Prepare the isolated Python environment',
                    ...resolveStage(progressInfo.stages?.env_setup, progressInfo.envSetup),
                  },
                  {
                    key: 'run',
                    header: 'Running',
                    description: 'Load the weights and run the bundled test inputs',
                    ...resolveStage(progressInfo.stages?.run, progressInfo.running),
                  },
                ] as TimelineStep[]}
              />
            ) : (
              /* Pre-poll (connecting / starting): no structured progress yet. */
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, justifyContent: 'center' }}>
                <Typography variant="body2" color="text.secondary">
                  {loadingMessage || 'Running model tests...'}
                </Typography>
              </Box>
            )}

            {/* Once finished, let the user review the steps, then open the report. */}
            {runFinished && (
              <button
                type="button"
                onClick={onViewReport}
                className="mt-2 inline-flex items-center gap-2 px-4 py-2 rounded-md text-sm font-medium text-white bg-blue-600 hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500 transition-transform active:scale-[0.97]"
              >
                View Test Report
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                </svg>
              </button>
            )}

            {/* Cancel the in-flight run (model-runner v1.15.36+). */}
            {canShowCancel && (
              <button
                type="button"
                onClick={onCancel}
                disabled={isCancelling}
                className="mt-2 inline-flex items-center gap-2 px-4 py-2 rounded-md text-sm font-medium text-red-600 bg-red-50 border border-red-200 hover:bg-red-100 transition-transform duration-150 ease-out active:scale-[0.97] disabled:opacity-60 disabled:cursor-not-allowed disabled:active:scale-100"
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
                    Cancel Test
                  </>
                )}
              </button>
            )}

            {/* Terminal cancelled state: no report to show, just confirm the stop. */}
            {runCancelled && (
              <Typography variant="body2" sx={{ mt: 1, color: '#b45309', fontWeight: 500 }}>
                Test run cancelled.
              </Typography>
            )}
          </Box>
        ) : isInvalidJson ? (
          <Box sx={{ p: 3 }}>
            <Stack spacing={3} alignItems="center" sx={{ py: 4 }}>
              <ErrorIcon color="error" sx={{ fontSize: 48 }} />
              <Typography variant="h6" sx={{ fontWeight: 500, color: '#ef4444' }}>
                Invalid Test Data
              </Typography>
              <Typography color="text.secondary" align="center">
                The test data is invalid or corrupted. The raw response is shown below.
              </Typography>
            </Stack>
            
            <Paper
              sx={{
                p: 3,
                backgroundColor: 'rgba(249, 250, 251, 0.8)',
                border: '1px solid rgba(255, 255, 255, 0.5)',
                borderRadius: '12px',
              }}
            >
              <Typography variant="subtitle2" sx={{ fontWeight: 500, mb: 2, color: '#1f2937' }}>
                Raw Response:
              </Typography>
              <Box
                sx={{
                  p: 2,
                  backgroundColor: 'rgba(0, 0, 0, 0.05)',
                  borderRadius: '8px',
                  border: '1px solid rgba(0, 0, 0, 0.1)',
                  maxHeight: 400,
                  overflow: 'auto',
                }}
              >
                <pre style={{ 
                  margin: 0, 
                  fontSize: '0.875rem', 
                  lineHeight: 1.4,
                  whiteSpace: 'pre-wrap',
                  wordBreak: 'break-word',
                  fontFamily: 'ui-monospace, SFMono-Regular, "SF Mono", Consolas, "Liberation Mono", Menlo, monospace',
                }}>
                  {rawErrorContent || 'No raw content available'}
                </pre>
              </Box>
            </Paper>
          </Box>
        ) : data ? (
          <Box sx={{ p: 3 }}>
            {/* Report Header */}
            <Paper
              sx={{
                p: 3,
                mb: 3,
                backgroundColor: 'rgba(249, 250, 251, 0.8)',
                border: '1px solid rgba(255, 255, 255, 0.5)',
                borderRadius: '12px',
              }}
            >
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 2, mb: 2 }}>
                {getHeaderInfo()}
                <Chip
                  label={data.status}
                  sx={{
                    backgroundColor: data.status === 'passed' 
                      ? 'rgba(34, 197, 94, 0.1)' 
                      : data.status === 'valid-format'
                      ? 'rgba(249, 115, 22, 0.1)'
                      : 'rgba(239, 68, 68, 0.1)',
                    color: getStatusColor(data.status),
                    borderRadius: '8px',
                    fontWeight: 500,
                    border: `1px solid ${data.status === 'passed'
                      ? 'rgba(34, 197, 94, 0.2)'
                      : data.status === 'valid-format'
                      ? 'rgba(249, 115, 22, 0.2)'
                      : 'rgba(239, 68, 68, 0.2)'}`,
                  }}
                />
                {/* Surface when the model was tested in its own declared conda
                    environment (bioimageio.core runtime_env="as-described"), i.e.
                    it is NOT compatible with the standard model-runner environment. */}
                {data?.test_environment === 'custom' && (
                  <Tooltip title="This model was tested inside its own declared environment, so it is not compatible with the standard model-runner environment.">
                    <Chip
                      label="custom-environment"
                      sx={{
                        backgroundColor: 'rgba(249, 115, 22, 0.1)',
                        color: '#c2410c',
                        borderRadius: '8px',
                        fontWeight: 500,
                        border: '1px solid rgba(249, 115, 22, 0.2)',
                      }}
                    />
                  </Tooltip>
                )}
              </Box>
              
              <Stack spacing={1}>
                {/* Show model ID and format version only for bioimageio.core compatibility reports or test reports */}
                {(type === 'test-report' || (type === 'compatibility' && partnerName === 'bioimageio.core')) && (() => {
                  // For bioimageio.core compatibility reports, data is nested in details object
                  const reportData = (type === 'compatibility' && data.details && typeof data.details === 'object' && !Array.isArray(data.details))
                    ? data.details
                    : data;
                  
                  return (
                    <>
                      {reportData.id && (
                        <Typography variant="body2" color="text.secondary">
                          <strong>Model ID:</strong> {reportData.id}
                        </Typography>
                      )}
                      {reportData.format_version && (
                        <Typography variant="body2" color="text.secondary">
                          <strong>Format Version:</strong> {reportData.format_version}
                        </Typography>
                      )}
                      {reportData.metadata_completeness !== undefined && (
                        <Typography variant="body2" color="text.secondary">
                          <strong>Metadata Completeness:</strong> {(reportData.metadata_completeness * 100).toFixed(1)}%
                        </Typography>
                      )}
                      {reportData.tested_at !== undefined && reportData.tested_at !== null && (
                        <Typography variant="body2" color="text.secondary">
                          <strong>Tested at:</strong> {new Date(Number(reportData.tested_at) * 1000).toLocaleString()}
                        </Typography>
                      )}
                    </>
                  );
                })()}

                {/* Score for compatibility reports — shown after the metadata
                    fields (below Metadata Completeness for bioimageio.core)
                    rather than first. */}
                {type === 'compatibility' && data.score !== undefined && (
                  <Typography variant="body2" color="text.secondary">
                    <strong>Score:</strong> {data.score.toFixed(2)}
                  </Typography>
                )}
              </Stack>
            </Paper>

            {/* Test Details */}
            {(() => {
              const detailsData = data.details;
              const detailsArray = Array.isArray(detailsData) 
                ? detailsData 
                : (detailsData && typeof detailsData === 'object' && Array.isArray(detailsData.details) 
                  ? detailsData.details 
                  : null);
              
              if (!detailsArray || detailsArray.length === 0) return null;
              
              return (
                <>
                  <Typography variant="h6" sx={{ mb: 2, fontWeight: 500 }}>
                    Test Details ({detailsArray.length} {detailsArray.length === 1 ? 'test' : 'tests'})
                  </Typography>
                  
                  <Stack spacing={2}>
                    {detailsArray.map((detail: any, index: number) => (
                      <Accordion
                        key={index}
                        sx={{
                          backgroundColor: 'rgba(255, 255, 255, 0.8)',
                          border: '1px solid rgba(255, 255, 255, 0.5)',
                          borderRadius: '12px !important',
                          '&:before': { display: 'none' },
                          '&.Mui-expanded': {
                            borderColor: detail.status === 'passed' 
                              ? 'rgba(34, 197, 94, 0.3)' 
                              : 'rgba(239, 68, 68, 0.3)',
                          }
                        }}
                      >
                        <AccordionSummary
                          expandIcon={<ExpandMoreIcon />}
                          sx={{
                            borderRadius: '12px',
                            '&.Mui-expanded': {
                              borderBottomLeftRadius: '0',
                              borderBottomRightRadius: '0',
                            }
                          }}
                        >
                          <Box sx={{ display: 'flex', alignItems: 'center', gap: 2, width: '100%' }}>
                            {getStatusIcon(detail.status)}
                            <Typography sx={{ fontWeight: 500, flex: 1 }}>
                              {detail.name}
                            </Typography>
                            <Chip
                              label={detail.status}
                              size="small"
                              sx={{
                                backgroundColor: detail.status === 'passed' 
                                  ? 'rgba(34, 197, 94, 0.1)' 
                                  : 'rgba(239, 68, 68, 0.1)',
                                color: getStatusColor(detail.status),
                                borderRadius: '8px',
                                fontWeight: 500,
                                border: `1px solid ${detail.status === 'passed' 
                                  ? 'rgba(34, 197, 94, 0.2)' 
                                  : 'rgba(239, 68, 68, 0.2)'}`,
                              }}
                            />
                          </Box>
                        </AccordionSummary>
                        
                        <AccordionDetails sx={{ pt: 0 }}>
                          {/* Location */}
                          {detail.loc && detail.loc.length > 0 && (
                            <Box sx={{ mb: 2 }}>
                              <Typography variant="subtitle2" sx={{ fontWeight: 500, mb: 1 }}>
                                Location:
                              </Typography>
                              <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 1 }}>
                                {detail.loc.map((loc: string, locIndex: number) => (
                                  <Chip
                                    key={locIndex}
                                    label={loc}
                                    size="small"
                                    sx={{
                                      backgroundColor: 'rgba(249, 250, 251, 0.8)',
                                      border: '1px solid rgba(255, 255, 255, 0.5)',
                                      borderRadius: '8px',
                                    }}
                                  />
                                ))}
                              </Box>
                            </Box>
                          )}

                          {/* Errors */}
                          {detail.errors && detail.errors.length > 0 && (
                            <Box sx={{ mb: 2 }}>
                              <Typography variant="subtitle2" sx={{ fontWeight: 500, mb: 1 }}>
                                Errors ({detail.errors.length}):
                              </Typography>
                              <Stack spacing={2}>
                                {detail.errors.map((error: any, errorIndex: number) => (
                                  <Alert
                                    key={errorIndex}
                                    severity="error"
                                    sx={{
                                      backgroundColor: 'rgba(239, 68, 68, 0.05)',
                                      border: '1px solid rgba(239, 68, 68, 0.2)',
                                      borderRadius: '12px',
                                    }}
                                  >
                                    <Box>
                                      <Typography variant="body2" sx={{ fontWeight: 500, mb: 1 }}>
                                        {error.type}
                                      </Typography>
                                      <Typography variant="body2" sx={{ mb: 1 }}>
                                        {error.msg}
                                      </Typography>
                                      
                                      {error.loc && error.loc.length > 0 && (
                                        <Box sx={{ mb: 1 }}>
                                          <Typography variant="caption" sx={{ fontWeight: 500 }}>
                                            Location: 
                                          </Typography>
                                          <Typography variant="caption">
                                            {error.loc.join(' → ')}
                                          </Typography>
                                        </Box>
                                      )}
                                      
                                      {error.traceback_md && (
                                        <Box
                                          sx={{
                                            mt: 2,
                                            p: 2,
                                            backgroundColor: 'rgba(0, 0, 0, 0.05)',
                                            borderRadius: '8px',
                                            border: '1px solid rgba(0, 0, 0, 0.1)',
                                            '& pre': {
                                              backgroundColor: 'rgba(0, 0, 0, 0.8)',
                                              color: 'white',
                                              padding: '12px',
                                              borderRadius: '8px',
                                              overflow: 'auto',
                                              fontSize: '0.875rem',
                                              lineHeight: 1.4,
                                            },
                                            '& code': {
                                              backgroundColor: 'rgba(0, 0, 0, 0.1)',
                                              padding: '2px 4px',
                                              borderRadius: '4px',
                                              fontSize: '0.875rem',
                                            }
                                          }}
                                        >
                                          <Typography variant="caption" sx={{ fontWeight: 500, display: 'block', mb: 1 }}>
                                            Traceback:
                                          </Typography>
                                          <pre>
                                            {error.traceback_md}
                                          </pre>
                                        </Box>
                                      )}
                                    </Box>
                                  </Alert>
                                ))}
                              </Stack>
                            </Box>
                          )}

                          {/* Warnings */}
                          {detail.warnings && detail.warnings.length > 0 && (
                            <Box sx={{ mb: 2 }}>
                              <Typography variant="subtitle2" sx={{ fontWeight: 500, mb: 1 }}>
                                <WarningIcon sx={{ fontSize: 'small', mr: 0.5, verticalAlign: 'middle' }} />
                                Warnings ({detail.warnings.length}):
                              </Typography>
                              <Stack spacing={1}>
                                {detail.warnings.map((warning: any, warningIndex: number) => (
                                  <Alert
                                    key={warningIndex}
                                    severity="warning"
                                    sx={{
                                      backgroundColor: 'rgba(245, 158, 11, 0.05)',
                                      border: '1px solid rgba(245, 158, 11, 0.2)',
                                      borderRadius: '8px',
                                    }}
                                  >
                                    <Typography variant="body2">
                                      {typeof warning === 'string' ? warning : JSON.stringify(warning)}
                                    </Typography>
                                  </Alert>
                                ))}
                              </Stack>
                            </Box>
                          )}

                          {/* Recommended Environment */}
                          {detail.recommended_env && (
                            <RecommendedEnv env={detail.recommended_env} />
                          )}

                          {/* Installed packages (conda list, or a pip freeze list for standard-env runs) */}
                          {data.saved_conda_list && (
                            <Accordion
                              sx={{
                                backgroundColor: 'rgba(249, 250, 251, 0.8)',
                                border: '1px solid rgba(255, 255, 255, 0.5)',
                                borderRadius: '8px !important',
                                '&:before': { display: 'none' },
                              }}
                            >
                              <AccordionSummary expandIcon={<ExpandMoreIcon />}>
                                <Typography variant="subtitle2" sx={{ fontWeight: 500 }}>
                                  Installed packages
                                </Typography>
                              </AccordionSummary>
                              <AccordionDetails>
                                <Box
                                  sx={{
                                    p: 2,
                                    backgroundColor: 'rgba(0, 0, 0, 0.05)',
                                    borderRadius: '8px',
                                    border: '1px solid rgba(0, 0, 0, 0.1)',
                                    maxHeight: 400,
                                    overflow: 'auto',
                                  }}
                                >
                                  <pre style={{ 
                                    margin: 0, 
                                    fontSize: '0.75rem', 
                                    lineHeight: 1.4,
                                    whiteSpace: 'pre-wrap',
                                    wordBreak: 'break-word',
                                    fontFamily: 'ui-monospace, SFMono-Regular, "SF Mono", Consolas, "Liberation Mono", Menlo, monospace',
                                  }}>
                                    {parseSavedCondaList(data.saved_conda_list)}
                                  </pre>
                                </Box>
                              </AccordionDetails>
                            </Accordion>
                          )}
                        </AccordionDetails>
                      </Accordion>
                    ))}
                  </Stack>
                </>
              );
            })()}

            {/* Inference check — can the model run in the standard (default) env?
                A single expandable box like the per-test rows above. mt matches the
                other section headers (e.g. Environment). */}
            {data.inference_check && (() => {
              // Three states, not two. `skipped` means the runner deliberately
              // did not run the default-environment check because the model
              // declares its own conda environment (model-runner 2.10.4+), so
              // it must read neutral rather than red: painting it as a failure
              // tells the user a perfectly good model is broken.
              const inferenceSkipped = data.inference_check.status === 'skipped';
              const inferenceTint = (alpha: number) =>
                data.inference_check.status === 'passed' ? `rgba(34, 197, 94, ${alpha})`
                  : inferenceSkipped ? `rgba(107, 114, 128, ${alpha})`
                    : `rgba(239, 68, 68, ${alpha})`;
              return (
              <Box sx={{ mt: 4, mb: 3 }}>
                <Typography variant="h6" sx={{ mb: 2, fontWeight: 500 }}>
                  Inference check
                </Typography>
                <Accordion
                  sx={{
                    backgroundColor: 'rgba(255, 255, 255, 0.8)',
                    border: '1px solid rgba(255, 255, 255, 0.5)',
                    borderRadius: '12px !important',
                    '&:before': { display: 'none' },
                    '&.Mui-expanded': {
                      borderColor: inferenceTint(0.3),
                    },
                  }}
                >
                  <AccordionSummary
                    expandIcon={<ExpandMoreIcon />}
                    sx={{
                      borderRadius: '12px',
                      '&.Mui-expanded': { borderBottomLeftRadius: 0, borderBottomRightRadius: 0 },
                    }}
                  >
                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 2, width: '100%' }}>
                      {getStatusIcon(data.inference_check.status)}
                      <Typography sx={{ fontWeight: 500, flex: 1 }}>
                        Runs in the default environment
                      </Typography>
                      <Chip
                        label={data.inference_check.status}
                        size="small"
                        sx={{
                          backgroundColor: inferenceTint(0.1),
                          color: getStatusColor(data.inference_check.status),
                          borderRadius: '8px',
                          fontWeight: 500,
                          border: `1px solid ${inferenceTint(0.2)}`,
                        }}
                      />
                    </Box>
                  </AccordionSummary>
                  <AccordionDetails sx={{ pt: 0 }}>
                    <Typography variant="body2" color="text.secondary" sx={{ mb: data.inference_check.error ? 2 : 0 }}>
                      {inferenceSkipped
                        ? 'This check was not run. It only applies to models that use the standard '
                          + 'bioimageio.core environment, and this model declares its own conda '
                          + 'environment. It is not a failure, and it says nothing about whether the '
                          + 'model works.'
                        : 'Verifies the model runs in the standard bioimageio.core environment '
                          + '(no custom conda environment).'}
                    </Typography>
                    {data.inference_check.error && (
                      <Alert
                        severity={inferenceSkipped ? 'info' : 'error'}
                        sx={{
                          backgroundColor: inferenceTint(0.05),
                          border: `1px solid ${inferenceTint(0.2)}`,
                          borderRadius: '12px',
                        }}
                      >
                        <Typography variant="body2" sx={{ whiteSpace: 'pre-wrap' }}>
                          {data.inference_check.error}
                        </Typography>
                      </Alert>
                    )}
                  </AccordionDetails>
                </Accordion>
              </Box>
              );
            })()}

            {/* Environment Information */}
            {(() => {
              // For bioimageio.core compatibility reports, data is nested in details object
              const reportData = (type === 'compatibility' && data.details && typeof data.details === 'object' && !Array.isArray(data.details))
                ? data.details
                : data;
              
              const hasEnv = reportData.env && reportData.env.length > 0;
              const hasCondaList = reportData.saved_conda_list;
              
              if (!hasEnv && !hasCondaList) return null;
              
              return (
                <Box sx={{ mt: 4 }}>
                  <Box sx={{ display: 'flex', alignItems: 'center', gap: 2, mb: 2 }}>
                    <Typography variant="h6" sx={{ fontWeight: 500 }}>
                      Environment
                    </Typography>
                    <Chip 
                      label={type === 'compatibility' ? 'CPU' : 'GPU'} 
                      size="small"
                      sx={{
                        backgroundColor: type === 'compatibility' ? 'rgba(59, 130, 246, 0.1)' : 'rgba(168, 85, 247, 0.1)',
                        color: type === 'compatibility' ? '#3b82f6' : '#a855f7',
                        fontWeight: 500,
                        fontSize: '0.75rem',
                      }}
                    />
                    {type === 'test-report' && (
                      <Box sx={{ display: 'flex', alignItems: 'center' }}>
                        <img 
                          src="/static/img/bioengine-icon.svg" 
                          alt="BioEngine" 
                          style={{ width: '24px', height: '24px' }}
                        />
                      </Box>
                    )}
                  </Box>
                  
                  {hasEnv && (
                    <Paper
                      sx={{
                        p: 2,
                        mb: hasCondaList ? 2 : 0,
                        backgroundColor: 'rgba(249, 250, 251, 0.8)',
                        border: '1px solid rgba(255, 255, 255, 0.5)',
                        borderRadius: '12px',
                      }}
                    >
                      <Stack spacing={1}>
                        {reportData.env.map((envItem: any[], index: number) => (
                          <Typography key={index} variant="body2" sx={{ fontFamily: 'monospace' }}>
                            {envItem[0]} = {envItem[1]}
                          </Typography>
                        ))}
                      </Stack>
                    </Paper>
                  )}
                  
                  {/* Installed-packages accordion */}
                  {hasCondaList && (
                    <Accordion
                      sx={{
                        backgroundColor: 'rgba(249, 250, 251, 0.8)',
                        border: '1px solid rgba(255, 255, 255, 0.5)',
                        borderRadius: '12px !important',
                        '&:before': { display: 'none' },
                      }}
                    >
                      <AccordionSummary expandIcon={<ExpandMoreIcon />}>
                        <Typography variant="subtitle2" sx={{ fontWeight: 500 }}>
                          Installed packages
                        </Typography>
                      </AccordionSummary>
                      <AccordionDetails>
                        <Box
                          sx={{
                            p: 2,
                            backgroundColor: 'rgba(0, 0, 0, 0.05)',
                            borderRadius: '8px',
                            border: '1px solid rgba(0, 0, 0, 0.1)',
                            maxHeight: 400,
                            overflow: 'auto',
                          }}
                        >
                          <pre style={{ 
                            margin: 0, 
                            fontSize: '0.75rem', 
                            lineHeight: 1.4,
                            whiteSpace: 'pre-wrap',
                            wordBreak: 'break-word',
                            fontFamily: 'ui-monospace, SFMono-Regular, "SF Mono", Consolas, "Liberation Mono", Menlo, monospace',
                          }}>
                            {parseSavedCondaList(reportData.saved_conda_list)}
                          </pre>
                        </Box>
                      </AccordionDetails>
                    </Accordion>
                  )}
                </Box>
              );
            })()}

            {/* Additional Information Section */}
            <Box sx={{ mt: 4 }}>
              <Typography variant="h6" sx={{ mb: 2, fontWeight: 500, color: 'text.secondary' }}>
                Additional Information
              </Typography>
              
              {/* Raw JSON for debugging - collapsible */}
              <Accordion
                sx={{
                  backgroundColor: 'rgba(249, 250, 251, 0.8)',
                  border: '1px solid rgba(255, 255, 255, 0.5)',
                  borderRadius: '12px !important',
                  '&:before': { display: 'none' },
                }}
              >
                <AccordionSummary expandIcon={<ExpandMoreIcon />}>
                  <Typography variant="subtitle2" sx={{ fontWeight: 500 }}>
                    Raw Data
                  </Typography>
                </AccordionSummary>
                <AccordionDetails>
                  <Box
                    sx={{
                      p: 2,
                      backgroundColor: 'rgba(0, 0, 0, 0.05)',
                      borderRadius: '8px',
                      border: '1px solid rgba(0, 0, 0, 0.1)',
                      maxHeight: '300px',
                      overflow: 'auto',
                    }}
                  >
                    <pre style={{ margin: 0, fontFamily: 'monospace', fontSize: '0.75rem' }}>
                      {JSON.stringify(data, null, 2)}
                    </pre>
                  </Box>
                </AccordionDetails>
              </Accordion>
            </Box>
          </Box>
        ) : (
          <Box sx={{ p: 4, textAlign: 'center' }}>
            <Typography>No test data available</Typography>
          </Box>
        )}
      </DialogContent>
    </Dialog>
  );
};

export default TestDetailsDialog;
