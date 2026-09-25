import React, { useState } from 'react';

/**
 * A labelled value that copies itself when clicked.
 *
 * Used for the identifiers in the worker dashboard's Service Information box
 * (service id, workspace, client id). These are long, awkward to select by hand
 * because they wrap, and are exactly what someone needs to paste into a CLI or
 * an agent prompt.
 *
 * The copy icon only appears on hover or keyboard focus, so the box reads as
 * information rather than as a row of buttons.
 */
const CopyableValue: React.FC<{ label: string; value: string }> = ({ label, value }) => {
  const [copied, setCopied] = useState(false);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch (_) {
      /* clipboard denied; the value is still selectable on screen */
    }
  };

  return (
    <div>
      <span className="text-xs font-medium text-gray-500 block">{label}</span>
      <button
        type="button"
        onClick={copy}
        title={`Copy ${label.toLowerCase()}`}
        aria-label={`Copy ${label.toLowerCase()}: ${value}`}
        className="group inline-flex items-start gap-1.5 text-left rounded focus:outline-none focus:ring-2 focus:ring-blue-400"
      >
        <span className="text-sm font-semibold text-gray-900 font-mono break-all group-hover:text-blue-700 transition-colors">
          {value}
        </span>
        {copied ? (
          <svg className="w-3.5 h-3.5 mt-0.5 flex-shrink-0 text-green-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
          </svg>
        ) : (
          <svg
            className="w-3.5 h-3.5 mt-0.5 flex-shrink-0 text-gray-400 opacity-0 group-hover:opacity-100 group-focus:opacity-100 transition-opacity"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
          </svg>
        )}
      </button>
    </div>
  );
};

export default CopyableValue;
