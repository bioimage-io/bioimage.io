import React from 'react';
import { RUNNER_SITES, RunnerSite } from '../utils/bioengineService';

interface RunnerSiteToggleProps {
  selected: RunnerSite;
  onSelect: (site: RunnerSite) => void;
  /** Per-site availability flags. Unavailable sites render as disabled options. */
  available: Record<RunnerSite, boolean>;
  /** While loading, every option shows a pulsing indicator dot. */
  loading?: boolean;
  className?: string;
}

/**
 * Two-option segmented control for picking which BioEngine model-runner
 * site handles the next test / validate request. Animation principles:
 *   - transform-only transitions on the option scale-press feedback
 *   - 150ms ease-out (under the 300ms ceiling for UI interactions)
 *   - dot indicators carry state in shape + color so the segmented control
 *     stays legible without animation
 *   - disabled options stay visible (so the user knows the choice exists)
 *     but do not animate or respond to clicks
 */
const RunnerSiteToggle: React.FC<RunnerSiteToggleProps> = ({
  selected,
  onSelect,
  available,
  loading = false,
  className = '',
}) => {
  return (
    <div
      role="radiogroup"
      aria-label="Model runner site"
      title="Pick which cluster runs the model-runner service for the next test, validate or inference call."
      className={`inline-flex items-center rounded-full bg-gray-100 p-0.5 border border-gray-200 text-xs ${className}`}
    >
      {RUNNER_SITES.map(opt => {
        const isSelected = selected === opt.id;
        const isAvailable = available[opt.id];
        const isDisabled = loading || !isAvailable;
        const title = loading
          ? `Looking for the ${opt.label} model-runner service...`
          : isAvailable
            ? `Run the model-runner on the ${opt.label} cluster`
            : `${opt.label} cluster's model-runner is unavailable right now`;

        return (
          <button
            key={opt.id}
            type="button"
            role="radio"
            aria-checked={isSelected}
            aria-disabled={isDisabled}
            disabled={isDisabled}
            onClick={() => !isDisabled && onSelect(opt.id)}
            title={title}
            className={[
              'relative inline-flex items-center gap-1.5 px-3 py-1 rounded-full',
              'transition-transform duration-150 ease-out',
              'focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500/40',
              isDisabled ? 'cursor-not-allowed text-gray-400' : 'cursor-pointer active:scale-[0.97]',
              isSelected && isAvailable ? 'bg-white shadow-sm text-gray-900 font-medium' : '',
              !isSelected && !isDisabled ? 'text-gray-600 hover:text-gray-900' : '',
            ].filter(Boolean).join(' ')}
          >
            <span
              aria-hidden="true"
              className={[
                'w-1.5 h-1.5 rounded-full',
                loading ? 'bg-gray-300 animate-pulse'
                  : isAvailable ? 'bg-emerald-500'
                  : 'bg-gray-300',
              ].join(' ')}
            />
            {opt.label}
          </button>
        );
      })}
    </div>
  );
};

export default RunnerSiteToggle;
