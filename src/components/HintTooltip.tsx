import React from 'react';

interface HintTooltipProps {
  /**
   * The helper text to show on hover. When falsy, no tooltip is rendered
   * (e.g. the wrapped control is enabled and needs no explanation).
   */
  hint?: string | false | null;
  /** The control to wrap, typically a disabled button. */
  children: React.ReactNode;
  /** Extra classes for the wrapper (e.g. width utilities like `w-full sm:w-auto`). */
  className?: string;
  /** Where the tooltip sits relative to the control. Defaults to below. */
  position?: 'top' | 'bottom';
}

/**
 * Wraps a control and reveals `hint` in a small hover tooltip, matching the
 * hover helper used in the BioEngine nodes overview. Native `title` tooltips
 * are unstyled and unreliable on disabled buttons; the wrapper span still
 * receives hover even when the inner button is disabled, so the tooltip shows.
 */
const HintTooltip: React.FC<HintTooltipProps> = ({ hint, children, className, position = 'bottom' }) => {
  const placement =
    position === 'bottom'
      ? 'top-full mt-2 origin-top'
      : 'bottom-full mb-2 origin-bottom';

  return (
    <span className={`relative inline-flex group ${className ?? ''}`}>
      {children}
      {hint && (
        <span
          role="tooltip"
          className={`pointer-events-none absolute left-1/2 z-30 w-max max-w-[15rem] -translate-x-1/2 scale-95 rounded-md bg-gray-900 px-2.5 py-1.5 text-center text-xs leading-snug text-white opacity-0 shadow-lg transition duration-150 ease-[cubic-bezier(0.23,1,0.32,1)] group-hover:scale-100 group-hover:opacity-100 ${placement}`}
        >
          {hint}
        </span>
      )}
    </span>
  );
};

export default HintTooltip;
