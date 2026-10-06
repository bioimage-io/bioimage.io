import React from 'react';

/**
 * The one refresh control for the BioEngine admin surfaces.
 *
 * Three places re-check live state (the apps page, worker admin, and the
 * dashboard's Available BioEngine Apps) and each had grown its own button with
 * its own icon and weight. Same action, same look.
 *
 * Grey rather than accented: refreshing is a maintenance action sitting beside
 * a primary one (Add, Create App), and two accented buttons next to each other
 * give neither any meaning. `fullWidth` matches the Add button it pairs with so
 * the two read as a set rather than as two unrelated controls.
 */
interface RefreshButtonProps {
  onClick: () => void;
  /** Spins the icon and blocks re-entry, so a second click cannot stack another fan-out. */
  busy?: boolean;
  disabled?: boolean;
  /** Label when idle. Becomes "Refreshing" while busy. */
  label?: string;
  title?: string;
  /** Match the width of the adjacent Add button instead of hugging the label. */
  fullWidth?: boolean;
  className?: string;
}

const RefreshButton: React.FC<RefreshButtonProps> = ({
  onClick,
  busy = false,
  disabled = false,
  label = 'Refresh',
  title,
  fullWidth = false,
  className = '',
}) => (
  <button
    type="button"
    onClick={onClick}
    disabled={disabled || busy}
    title={title || 'Re-check every observed workspace'}
    className={[
      'inline-flex items-center justify-center gap-1.5 px-3 py-1.5 text-xs font-medium',
      'text-gray-700 bg-white border border-gray-300 rounded-lg',
      'hover:bg-gray-50 hover:border-gray-400 hover:text-gray-900',
      'disabled:opacity-50 disabled:cursor-not-allowed transition-colors',
      fullWidth ? 'w-full' : '',
      className,
    ].filter(Boolean).join(' ')}
  >
    <svg
      className={`w-3.5 h-3.5 flex-shrink-0 ${busy ? 'animate-spin' : ''}`}
      fill="none"
      stroke="currentColor"
      viewBox="0 0 24 24"
      aria-hidden="true"
    >
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth={2}
        d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"
      />
    </svg>
    {busy ? 'Refreshing' : label}
  </button>
);

export default RefreshButton;
