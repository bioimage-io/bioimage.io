import React from 'react';
import { Box, Typography, Chip, Stack, Tooltip } from '@mui/material';
import HourglassTopIcon from '@mui/icons-material/HourglassTop';

export interface TimelineStep {
  key: string;
  /** Bold few-word header, e.g. "Preparing model". */
  header: string;
  /** Short explanation shown under the header. */
  description: string;
  /** Unix seconds when the step began executing (i.e. reached queue position 0);
   *  null while still queued, not yet reached, or skipped. */
  startTs: number | null;
  /** Unix seconds when the step finished; null while running or not reached. */
  endTs?: number | null;
  /** Per-step queue position from the runner: N = N jobs ahead in this step's
   *  queue, 0 = this step is running now, null = not currently in this step
   *  (not reached, already past, or N/A). */
  queuePosition?: number | null;
}

interface StepTimelineProps {
  /** Unix seconds when the whole job was submitted/queued. Shown on top when
   *  provided (omitted for some panels). */
  submittedAt?: number | null;
  /** Label for the submitted-at row. Defaults to "Test started"; the inference
   *  panel passes "Run started". */
  startedLabel?: string;
  /** Flat top-level queue position from the runner (legacy field). Used as a
   *  fallback for the first not-yet-started step when that step carries no
   *  per-step queue_position, so a queue is still shown during the wait. */
  fallbackQueuePosition?: number | null;
  /** Ordered steps. Each renders one table row. */
  steps: TimelineStep[];
  /** Unix seconds when the whole job finished. Freezes any running step's
   *  duration; null/undefined while still in flight. */
  completedAt?: number | null;
}

/** Format a unix-seconds timestamp as a clock time in the viewer's own timezone. */
const formatClock = (ts: number): string =>
  new Date(ts * 1000).toLocaleTimeString(undefined, {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });

/**
 * Live elapsed time for the currently-running step: whole seconds, ticking
 * "1s, 2s, 3s, ...".
 */
const formatElapsed = (sec: number): string => `${Math.max(0, Math.floor(sec))}s`;

/**
 * Frozen duration for a finished step: one decimal, e.g. "2.4s". The decimal
 * separator follows the viewer's locale, so a German viewer sees "2,4s".
 */
const formatDurationSec = (sec: number): string =>
  `${Math.max(0, sec).toLocaleString(undefined, { minimumFractionDigits: 1, maximumFractionDigits: 1 })}s`;

/**
 * Two-column step table used by the model test dialog and the inference panel.
 * The overall submit time sits on top. Left column: bold step header + short
 * description. Right column reflects the step's own state, driven by the
 * runner's per-step `stages` data:
 *   - queued  → an amber "#N" pill with an hourglass icon and a stage-aware
 *               tooltip (queue_position > 0), where N counts down N, N-1, ... 1;
 *   - running → live elapsed ticking in whole seconds ("17s"), computed straight
 *               from the backend `startTs` (queue_position === 0). We trust the
 *               runner's timestamp as-is — no browser-clock correction — so the
 *               timer reflects the real execution start even if the two clocks
 *               disagree;
 *   - done    → the frozen duration to one decimal ("2.4s");
 *   - skipped → an em dash (a later step started while this one never did);
 *   - not yet reached → blank.
 */
const StepTimeline: React.FC<StepTimelineProps> = ({ submittedAt, startedLabel = 'Test started', fallbackQueuePosition, steps, completedAt }) => {
  // First step that hasn't started executing yet — the flat top-level queue
  // position (if any) applies to it when it has no per-step queue of its own.
  const firstPendingIdx = steps.findIndex(s => s.startTs == null);
  // The flat fallback only stands in for OLD runners that report no per-step
  // queue at all. Once any step carries its own queue_position (new runners),
  // that step owns the wait, so we must NOT also paint the flat backlog onto the
  // first pending step — that mislabels an about-to-be-skipped step (e.g.
  // env_setup showing the run/GPU backlog under a "building the environment"
  // tooltip while its own queue_position is null).
  const anyPerStepQueue = steps.some(s => s.queuePosition != null);
  const effectiveQueue = (step: TimelineStep, i: number): number | null => {
    if (step.queuePosition != null) return step.queuePosition;
    if (!anyPerStepQueue && i === firstPendingIdx && completedAt == null) return fallbackQueuePosition ?? null;
    return null;
  };
  // Tick once a second so a running step's elapsed stays live.
  const [nowSec, setNowSec] = React.useState(() => Date.now() / 1000);
  React.useEffect(() => {
    if (completedAt != null) return; // frozen once finished
    const id = setInterval(() => setNowSec(Date.now() / 1000), 1000);
    return () => clearInterval(id);
  }, [completedAt]);

  // A step is running when it reports queue position 0 and has an execution
  // start but no end yet (and the whole job hasn't completed).
  const isRunning = (s: TimelineStep): boolean =>
    completedAt == null && s.startTs != null && s.endTs == null && (s.queuePosition ?? 0) === 0;

  // End timestamp for a finished step: prefer its own endTs, else fall back to
  // the next started step's start, else the overall completion timestamp.
  const stepEnd = (i: number): number => {
    const own = steps[i].endTs;
    if (own != null) return own;
    for (let j = i + 1; j < steps.length; j++) {
      if (steps[j].startTs != null) return steps[j].startTs as number;
    }
    return completedAt ?? nowSec;
  };

  return (
    <Box sx={{ width: '100%', maxWidth: 420 }}>
      {/* Overall submit time on top. */}
      {submittedAt != null && (
        <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 1.5 }}>
          <Typography variant="body2" color="text.secondary">{startedLabel}</Typography>
          <Typography variant="body2" sx={{ fontFamily: 'monospace', fontWeight: 500 }}>
            {formatClock(submittedAt)}
          </Typography>
        </Box>
      )}

      <Stack spacing={1.25}>
        {steps.map((step, i) => {
          const q = effectiveQueue(step, i);
          const queued = (q ?? 0) > 0;
          const running = isRunning(step);
          const started = step.startTs != null;
          const done = started && !running;
          // Skipped: never started, not queued/reached, yet a later step has a start.
          const skipped =
            !started && q == null && steps.slice(i + 1).some(s => s.startTs != null);
          const isActive = running;

          let right: React.ReactNode = '';
          if (queued) {
            // Stage-aware wait reason: the run queue waits for a GPU, the
            // env_setup queue waits for the single conda env-build lock.
            const waitReason =
              step.key === 'env_setup'
                ? 'waiting to build the environment'
                : 'waiting for a GPU slot';
            right = (
              <Tooltip title={`Queue position ${q}: ${q} ahead, ${waitReason}`} arrow>
                <Chip
                  icon={<HourglassTopIcon sx={{ fontSize: 14 }} />}
                  label={`#${q}`}
                  size="small"
                  sx={{
                    borderRadius: '8px',
                    fontFamily: 'monospace',
                    fontWeight: 700,
                    backgroundColor: 'rgba(245, 158, 11, 0.1)',
                    color: '#b45309',
                    border: '1px solid rgba(245, 158, 11, 0.3)',
                    '& .MuiChip-icon': { color: '#b45309', marginLeft: '6px' },
                  }}
                />
              </Tooltip>
            );
          } else if (running) {
            right = (
              <Typography variant="body2" sx={{ fontFamily: 'monospace', fontWeight: 600, color: '#111827', whiteSpace: 'nowrap' }}>
                {formatElapsed(nowSec - (step.startTs as number))}
              </Typography>
            );
          } else if (done) {
            right = (
              <Typography variant="body2" sx={{ fontFamily: 'monospace', fontWeight: 500, color: 'text.secondary', whiteSpace: 'nowrap' }}>
                {formatDurationSec(stepEnd(i) - (step.startTs as number))}
              </Typography>
            );
          } else if (skipped) {
            right = (
              <Typography variant="body2" sx={{ fontFamily: 'monospace', fontWeight: 500, color: 'text.secondary' }}>
                Skipped
              </Typography>
            );
          }

          return (
            <Box
              key={step.key}
              sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 2 }}
            >
              <Box sx={{ minWidth: 0 }}>
                <Typography
                  variant="body2"
                  sx={{ fontWeight: 600, color: isActive ? '#111827' : '#374151' }}
                >
                  {step.header}
                </Typography>
                <Typography variant="caption" color="text.secondary" sx={{ display: 'block', lineHeight: 1.4 }}>
                  {step.description}
                </Typography>
              </Box>
              {right}
            </Box>
          );
        })}
      </Stack>
    </Box>
  );
};

export default StepTimeline;
