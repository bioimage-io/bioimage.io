import React from 'react';
import { Box, Typography, Chip, Stack } from '@mui/material';

export interface TimelineStep {
  key: string;
  /** Bold few-word header, e.g. "Preparing model". */
  header: string;
  /** Short explanation shown under the header. */
  description: string;
  /** Unix seconds when the step started; null when not started or skipped. */
  startTs: number | null;
}

interface StepTimelineProps {
  /** Unix seconds when the whole test was submitted/queued. Shown on top when
   *  provided (omitted for the inference panel). */
  submittedAt?: number | null;
  /** Label for the submitted-at row. Defaults to "Test started"; the inference
   *  panel passes "Run started". */
  startedLabel?: string;
  /**
   * FIFO queue rank reported by the runner. Counts down to 0 and stays at 0
   * once the request is dequeued and running.
   */
  queuePosition: number;
  /** Ordered steps. Each renders one table row. */
  steps: TimelineStep[];
  /** Unix seconds when the whole test finished. Freezes the running step's
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
 * "1s, 2s, 3s, ...". Steps are expected to finish in under a minute, so a
 * seconds count reads better than mm:ss.
 */
const formatElapsed = (sec: number): string => `${Math.max(0, Math.floor(sec))}s`;

/**
 * Frozen duration for a finished step: one decimal, e.g. "2.4s". The decimal
 * separator follows the viewer's locale (like the clock above), so a German
 * viewer sees "2,4s".
 */
const formatDurationSec = (sec: number): string =>
  `${Math.max(0, sec).toLocaleString(undefined, { minimumFractionDigits: 1, maximumFractionDigits: 1 })}s`;

/**
 * Queue-position header plus a two-column step table used by the model test
 * dialog and the inference panel. The overall test start time sits on top,
 * above the queue position. Left column: bold step header + short description.
 * Right column: how long each step took — computed from the step timestamps —
 * with the currently-running step ticking live in whole seconds ("17s") and a
 * finished step showing its frozen duration to one decimal ("2.4s"). A skipped
 * step (a later step started
 * while this one never did) shows an em dash; a step that hasn't started yet is
 * blank.
 */
const StepTimeline: React.FC<StepTimelineProps> = ({ submittedAt, startedLabel = 'Test started', queuePosition, steps, completedAt }) => {
  // Tick once a second so the active step's duration stays live.
  const [nowSec, setNowSec] = React.useState(() => Date.now() / 1000);
  React.useEffect(() => {
    if (completedAt != null) return; // frozen once finished
    const id = setInterval(() => setNowSec(Date.now() / 1000), 1000);
    return () => clearInterval(id);
  }, [completedAt]);

  // The currently-running step is the last one that carries a start time.
  let activeIdx = -1;
  steps.forEach((s, i) => {
    if (s.startTs != null) activeIdx = i;
  });

  // Queue-position chip. The runner reports queue_position = 1 while this
  // request is the active/running one, 0 once it is done, and N (>1) while
  // N-1 requests are still ahead of it. Show a green "1" while running, a grey
  // "0" once complete, and an amber "#N" while queued.
  const queueChip = queuePosition <= 0
    ? { label: '0', bg: 'rgba(107, 114, 128, 0.1)', fg: '#4b5563', bd: 'rgba(107, 114, 128, 0.3)' }
    : queuePosition === 1
      ? { label: '1', bg: 'rgba(34, 197, 94, 0.1)', fg: '#15803d', bd: 'rgba(34, 197, 94, 0.3)' }
      : { label: `#${queuePosition}`, bg: 'rgba(245, 158, 11, 0.1)', fg: '#b45309', bd: 'rgba(245, 158, 11, 0.3)' };

  // Live timer for the running step: anchor it to the browser clock the moment
  // the step becomes active so it starts at ~0:00. The step timestamps come
  // from the runner; computing "browser now − runner startTs" mixes two
  // machines' clocks, and any skew between them (both are unix epoch, but the
  // machines can still disagree on "now") shows up immediately — that is why
  // the timer jumped straight to e.g. 6:30. Completed steps keep using the
  // runner's timestamps on both ends, so they stay skew-free.
  const activeStepKey = activeIdx >= 0 && completedAt == null ? steps[activeIdx].key : null;
  const anchorRef = React.useRef<{ key: string; clientStart: number } | null>(null);
  if (activeStepKey) {
    if (anchorRef.current?.key !== activeStepKey) {
      anchorRef.current = { key: activeStepKey, clientStart: Date.now() / 1000 };
    }
  } else {
    anchorRef.current = null;
  }

  // End timestamp for a completed step = the next started step's start, else
  // the overall completion timestamp.
  const stepEnd = (i: number): number => {
    for (let j = i + 1; j < steps.length; j++) {
      if (steps[j].startTs != null) return steps[j].startTs as number;
    }
    return completedAt ?? nowSec;
  };

  return (
    <Box sx={{ width: '100%', maxWidth: 360 }}>
      {/* Overall test start time — on top, above the queue position. */}
      {submittedAt != null && (
        <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 1 }}>
          <Typography variant="body2" color="text.secondary">{startedLabel}</Typography>
          <Typography variant="body2" sx={{ fontFamily: 'monospace', fontWeight: 500 }}>
            {formatClock(submittedAt)}
          </Typography>
        </Box>
      )}

      {/* Queue position — green "1" while running, grey "0" once complete. */}
      <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 1.5 }}>
        <Typography variant="body2" color="text.secondary">
          Queue position
        </Typography>
        <Chip
          label={queueChip.label}
          size="small"
          sx={{
            borderRadius: '8px',
            fontWeight: 600,
            backgroundColor: queueChip.bg,
            color: queueChip.fg,
            border: `1px solid ${queueChip.bd}`,
          }}
        />
      </Box>

      <Stack spacing={1.25}>
        {steps.map((step, i) => {
          const started = step.startTs != null;
          const isActive = i === activeIdx && completedAt == null;
          // Skipped: never started, yet a later step already has a start time.
          const skipped = !started && steps.slice(i + 1).some(s => s.startTs != null);

          let right: React.ReactNode = '';
          if (started) {
            right = isActive && anchorRef.current
              ? formatElapsed(nowSec - anchorRef.current.clientStart)
              : formatDurationSec(stepEnd(i) - (step.startTs as number));
          } else if (skipped) {
            right = '—';
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
              <Typography
                variant="body2"
                sx={{
                  fontFamily: 'monospace',
                  fontWeight: 500,
                  whiteSpace: 'nowrap',
                  color: isActive ? '#111827' : 'text.secondary',
                }}
              >
                {right}
              </Typography>
            </Box>
          );
        })}
      </Stack>
    </Box>
  );
};

export default StepTimeline;
