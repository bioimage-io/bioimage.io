import React from 'react';

/**
 * Why a value is absent. A closed set, not free text.
 *
 * The page had one absent-value renderer with one hardcoded tooltip, "the
 * campaign service did not report this value", while call sites overrode the
 * visible LABEL to say things like "Not published" or "Location not declared".
 * So the label named one cause and the tooltip asserted a different one, and a
 * reader who hovered was told the opposite of what they had just read.
 *
 * That is the same defect as an error screen saying "could not be reached" for
 * a service that answered and disagreed: one explanatory string attached to a
 * component whose call sites have several distinct causes. Absence has more
 * than one cause here and the causes point at different actors. Nobody can fix
 * a withheld figure by checking whether the service is up.
 *
 * The reason drives BOTH strings, so a call site cannot set a label the tooltip
 * contradicts. It is a union rather than a caption prop because free text lets
 * every call site invent its own wording for the same state, which is how the
 * distinction erodes back to one meaning spelled six ways.
 */
export type MissingReason =
  /** The service said nothing about this field. */
  | 'unreported'
  /** The service holds it and its disclosure policy declines to publish it. */
  | 'withheld'
  /** The site never declared it, and the platform does not measure it. */
  | 'undeclared';

const REASONS: Record<MissingReason, { label: string; title: string }> = {
  unreported: {
    label: 'Not reported',
    title: 'The campaign service did not report this value.',
  },
  withheld: {
    label: 'Not published',
    title:
      'The campaign service holds this value, and its disclosure policy does not publish it. This is a deliberate decision, not missing data.',
  },
  undeclared: {
    label: 'Not declared',
    title:
      'The site did not declare this when it joined. The platform does not measure it, so there is nothing to fall back on.',
  },
};

/**
 * The single renderer for a value the campaign page cannot show.
 *
 * Every campaign component routes absent values through this, so there is
 * exactly one place that decides what absence looks like and no component can
 * quietly substitute a zero that reads as a measurement.
 */
const MissingValue: React.FC<{ reason?: MissingReason; label?: string }> = ({
  reason = 'unreported',
  label,
}) => {
  const preset = REASONS[reason];
  return (
    <span
      className="font-normal italic text-gray-400"
      data-missing-reason={reason}
      title={preset.title}
    >
      {label ?? preset.label}
    </span>
  );
};

/**
 * Renders `children` when present and the absence marker when not. Keeps call
 * sites to one expression instead of a ternary per field.
 */
export const Value: React.FC<{
  children: string | null | undefined;
  reason?: MissingReason;
  label?: string;
}> = ({ children, reason, label }) =>
  children ? <>{children}</> : <MissingValue reason={reason} label={label} />;

export default MissingValue;
