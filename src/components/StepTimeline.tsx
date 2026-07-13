import React from 'react';
import { Box, Typography, Chip, Stack } from '@mui/material';

export interface TimelineStep {
  key: string;
  /** Bold few-word header, e.g. "Model download". */
  header: string;
  /** Short explanation shown under the header. */
  description: string;
  /** Unix seconds when the step started; null when not started or skipped. */
  startTs: number | null;
}

interface StepTimelineProps {
  /**
   * FIFO queue rank reported by the runner. Counts down to 0 and stays at 0
   * once the request is dequeued and running. Rendered on top of the table.
   */
  queuePosition: number;
  /** Ordered steps. Each renders one table row. */
  steps: TimelineStep[];
}

/**
 * Format a unix-seconds timestamp as a clock time in the viewer's own
 * timezone (toLocaleTimeString defaults to the browser locale + zone).
 */
const formatStartTime = (ts: number): string =>
  new Date(ts * 1000).toLocaleTimeString(undefined, {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });

/**
 * Queue-position header plus a two-column step table used by both the model
 * test dialog and the inference panel. Left column: bold step header with a
 * short description. Right column: the wall-clock time the step started, in
 * the user's timezone — blank until it starts, an em dash if it was skipped
 * (a later step started while this one never did), and the live elapsed
 * seconds in brackets while the step is the one currently running.
 */
const StepTimeline: React.FC<StepTimelineProps> = ({ queuePosition, steps }) => {
  // Tick once a second so the active step's elapsed counter stays live.
  const [nowSec, setNowSec] = React.useState(() => Date.now() / 1000);
  React.useEffect(() => {
    const id = setInterval(() => setNowSec(Date.now() / 1000), 1000);
    return () => clearInterval(id);
  }, []);

  // The currently-running step is the last one that carries a start time.
  let activeIdx = -1;
  steps.forEach((s, i) => {
    if (s.startTs != null) activeIdx = i;
  });

  const running = queuePosition <= 0;

  return (
    <Box sx={{ width: '100%', maxWidth: 360 }}>
      {/* Queue position — on top, always visible; holds at 0 once running. */}
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
          const isActive = i === activeIdx;
          // Skipped: never started, yet a later step already has a start time.
          const skipped = !started && steps.slice(i + 1).some(s => s.startTs != null);

          let right: React.ReactNode = '';
          if (started) {
            right = (
              <>
                {formatStartTime(step.startTs as number)}
                {isActive && (
                  <Typography component="span" variant="body2" color="text.secondary" sx={{ ml: 0.75 }}>
                    ({Math.max(0, Math.floor(nowSec - (step.startTs as number)))}s)
                  </Typography>
                )}
              </>
            );
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
