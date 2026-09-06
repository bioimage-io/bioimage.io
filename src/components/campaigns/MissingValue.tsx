import React from 'react';

/**
 * The single renderer for a value the campaign service did not report.
 *
 * Every campaign component routes unknown values through this, so there is
 * exactly one place in the codebase that decides what "unreported" looks like
 * and no component can quietly substitute a zero that reads as a measurement.
 */
const MissingValue: React.FC<{ label?: string }> = ({ label = 'Not reported' }) => (
  <span
    className="text-gray-400 font-normal italic"
    title="The campaign service did not report this value."
  >
    {label}
  </span>
);

/**
 * Renders `value` when it is present and the "not reported" marker when it is
 * not. Keeps call sites to one expression instead of a ternary per field.
 */
export const Value: React.FC<{ children: string | null | undefined; label?: string }> = ({
  children,
  label,
}) => (children ? <>{children}</> : <MissingValue label={label} />);

export default MissingValue;
