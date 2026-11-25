import React from 'react';
import { EpochProgress as EpochProgressValue, epochProgressLabel } from '../../utils/trainingProgress';

export interface EpochProgressProps {
  progress: EpochProgressValue;
  /** True while the run is non-terminal. */
  isRunning: boolean;
  /**
   * How the run ENDED, for a run that has ended. `isRunning` alone cannot
   * colour the bar: it is false for a clean finish and equally false for FAILED
   * and STOPPED, so colouring on it painted a failed run the settled green of a
   * successful one. On a page whose whole purpose is telling a working run from
   * a stuck or failed one, that is the defect rather than a cosmetic detail.
   */
  outcome?: 'completed' | 'unsuccessful';
}

/**
 * The epoch line on a training session card.
 *
 * Split out of Finetune.tsx so the RENDER can be tested, not just the decision
 * behind it. Against the worker the page actually talks to today this renders
 * nothing, because a replica before 0.18.0 never writes the fields. "Renders
 * nothing" is also what a broken implementation looks like, so a test that
 * only ever sees the empty case cannot tell the two apart, and that is the
 * whole reason this is its own component.
 *
 * Renders null unless the backend reported a MEASURED count. See
 * utils/trainingProgress.ts for why a `floor_if_completed` count is not
 * progress and must not appear here.
 */
const EpochProgress: React.FC<EpochProgressProps> = ({ progress, isRunning, outcome }) => {
  if (progress.kind !== 'measured') return null;
  const label = epochProgressLabel(progress);
  if (!label) return null;

  // Running is blue, a clean finish green, and anything that ended without
  // success neutral grey. Grey rather than red because the status badge beside this
  // already carries the failure in words and colour; the bar's job here is to
  // stop CLAIMING success, not to raise a second alarm.
  // FAILS SAFE: green requires an explicit 'completed'. The first fix tested
  // for 'unsuccessful' instead, which meant a caller that forgot the prop fell
  // through to green and got the original defect back, and an outcome value
  // this build has never heard of would too. Only a positive statement of
  // success earns the success colour.
  const barColour = isRunning
    ? 'bg-blue-500'
    : outcome === 'completed'
      ? 'bg-emerald-500'
      : 'bg-gray-400';

  return (
    <div className="mt-1.5" data-testid="epoch-progress">
      <div className="text-xs font-medium text-gray-700">{label}</div>
      {progress.fraction !== null && (
        <div
          className="mt-1 h-1.5 w-40 max-w-full rounded-full bg-gray-200 overflow-hidden"
          role="progressbar"
          aria-valuemin={0}
          aria-valuemax={progress.total ?? undefined}
          // Clamped: a backend count above the requested total would otherwise
          // set valuenow past valuemax, which is invalid ARIA. The raw count
          // stays visible in the label, because a count over the request is a
          // backend fact worth seeing rather than something to round away.
          aria-valuenow={
            progress.total === null ? progress.completed : Math.min(progress.completed, progress.total)
          }
          aria-label={label}
        >
          <div
            className={`h-full rounded-full transition-all duration-500 ${barColour}`}
            style={{ width: `${Math.round(progress.fraction * 100)}%` }}
          />
        </div>
      )}
    </div>
  );
};

export default EpochProgress;
