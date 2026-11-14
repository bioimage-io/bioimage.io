import React from 'react';
import { EpochProgress as EpochProgressValue, epochProgressLabel } from '../../utils/trainingProgress';

export interface EpochProgressProps {
  progress: EpochProgressValue;
  /** Non-terminal runs show a live blue bar, finished ones a settled green. */
  isRunning: boolean;
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
const EpochProgress: React.FC<EpochProgressProps> = ({ progress, isRunning }) => {
  if (progress.kind !== 'measured') return null;
  const label = epochProgressLabel(progress);
  if (!label) return null;

  return (
    <div className="mt-1.5" data-testid="epoch-progress">
      <div className="text-xs font-medium text-gray-700">{label}</div>
      {progress.fraction !== null && (
        <div
          className="mt-1 h-1.5 w-40 max-w-full rounded-full bg-gray-200 overflow-hidden"
          role="progressbar"
          aria-valuemin={0}
          aria-valuemax={progress.total ?? undefined}
          aria-valuenow={progress.completed}
          aria-label={label}
        >
          <div
            className={`h-full rounded-full transition-all duration-500 ${
              isRunning ? 'bg-blue-500' : 'bg-emerald-500'
            }`}
            style={{ width: `${Math.round(progress.fraction * 100)}%` }}
          />
        </div>
      )}
    </div>
  );
};

export default EpochProgress;
