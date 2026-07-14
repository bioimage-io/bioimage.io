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

/** Format an elapsed duration in seconds as mm:ss. */
const formatDuration = (sec: number): string => {
  const s = Math.max(0, Math.floor(sec));
  return `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
};

/**
 * Queue-position header plus a two-column step table used by the model test
 * dialog and the inference panel. The overall test start time sits on top,
 * above the queue position. Left column: bold step header + short description.
 * Right column: how long each step took (mm:ss) — computed from the step
 * timestamps — with the currently-running step ticking live and freezing at
 * `completedAt` when the test finishes. A skipped step (a later step started
 * while this one never did) shows an em dash; a step that hasn't started yet is
 * blank.
 */
const StepTimeline: React.FC<StepTimelineProps> = ({ submittedAt, queuePosition, steps, completedAt }) => {
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

  const running = queuePosition <= 0;

  // End timestamp for a step = the next started step's start, else the overall
  // completion (or now, while still running) for the active/last step.
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
          <Typography variant="body2" color="text.secondary">Test started</Typography>
          <Typography variant="body2" sx={{ fontFamily: 'monospace', fontWeight: 500 }}>
            {formatClock(submittedAt)}
          </Typography>
        </Box>
      )}

      {/* Queue position — holds at 0 once running. */}
      <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 1.5 }}>
        <Typography variant="body2" color="text.secondary">
          Queue position
        </Typography>
        <Chip
          label={running ? '0' : `#${queuePosition}`}
          size="small"
          sx={{
            borderRadius: '8px',
            fontWeight: 600,
            backgroundColor: running ? 'rgba(34, 197, 94, 0.1)' : 'rgba(245, 158, 11, 0.1)',
            color: running ? '#15803d' : '#b45309',
            border: `1px solid ${running ? 'rgba(34, 197, 94, 0.3)' : 'rgba(245, 158, 11, 0.3)'}`,
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
            right = formatDuration(stepEnd(i) - (step.startTs as number));
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
