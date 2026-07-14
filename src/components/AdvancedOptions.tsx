import React, { useEffect, useRef, useState } from 'react';
import RunnerSiteToggle from './RunnerSiteToggle';
import { RunnerSite } from '../utils/bioengineService';
import { HYPHA_SERVER_URL } from '../config/hypha';

interface AdvancedOptionsProps {
  /** Server URL override. Empty = the default Hypha server. */
  serverUrl: string;
  onServerUrlChange: (value: string) => void;
  /** Free-form Service ID override (populated by the site toggle or typed). */
  serviceIdOverride: string;
  onServiceIdOverrideChange: (value: string) => void;
  serviceIdPlaceholder?: string;
  /** Runner-site toggle. Hidden when showToggle is false (e.g. logged out). */
  toggleSelected: RunnerSite | null;
  onSelectSite: (site: RunnerSite) => void;
  siteAvailable: Record<RunnerSite, boolean>;
  siteLoading?: boolean;
  showToggle?: boolean;
  /** Reset the shared Hypha connection. */
  onReset: () => void;
  isResetting?: boolean;
  className?: string;
  /**
   * Page-specific controls rendered at the top of the panel, above the
   * connection settings (e.g. ModelRunner's tiling options for inference).
   */
  children?: React.ReactNode;
}

/**
 * The single Advanced Options popover shared by every page that runs a
 * model-runner call (Edit, Upload, Review, ModelRunner). Renders a dropdown
 * button + panel with the runner-site toggle, a Service ID / Server URL
 * override, and a Reset Connection action so the control is identical
 * everywhere it appears. `children` slots in page-specific extras (tiling).
 */
const AdvancedOptions: React.FC<AdvancedOptionsProps> = ({
  serverUrl,
  onServerUrlChange,
  serviceIdOverride,
  onServiceIdOverrideChange,
  serviceIdPlaceholder = '',
  toggleSelected,
  onSelectSite,
  siteAvailable,
  siteLoading = false,
  showToggle = true,
  onReset,
  isResetting = false,
  className = '',
  children,
}) => {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  // Click-outside dismissal — only attached while the panel is open.
  useEffect(() => {
    if (!open) return;
    const onPointerDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onPointerDown);
    return () => document.removeEventListener('mousedown', onPointerDown);
  }, [open]);

  return (
    <div ref={ref} className={`relative w-full sm:w-auto ${className}`}>
      <button
        type="button"
        onClick={() => setOpen(v => !v)}
        aria-expanded={open}
        className="inline-flex items-center gap-2 px-3 py-2 rounded-md font-medium transition-colors bg-gray-50 text-gray-700 hover:bg-gray-100 border border-gray-300 w-full sm:w-auto justify-center sm:justify-start"
      >
        <svg
          className={`w-4 h-4 ${open ? 'rotate-180' : ''}`}
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
          style={{ transition: 'transform 180ms cubic-bezier(0.23, 1, 0.32, 1)' }}
        >
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
        </svg>
        Advanced Options
      </button>

      {open && (
        <div
          className="absolute left-0 top-full mt-2 z-40 w-80 sm:w-96 max-w-[calc(100vw-2rem)] bg-white rounded-lg border border-gray-200 shadow-lg p-4 space-y-4 text-left"
          style={{
            transformOrigin: 'top left',
            animation: 'advanced-options-open 180ms cubic-bezier(0.23, 1, 0.32, 1)',
          }}
          onClick={(e) => e.stopPropagation()}
        >
          <style>{`
            @keyframes advanced-options-open {
              from { opacity: 0; transform: scale(0.97); }
              to   { opacity: 1; transform: scale(1); }
            }
          `}</style>
          <h4 className="font-medium text-gray-900 text-sm">Advanced Options</h4>

          {children}

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Server URL
            </label>
            <input
              type="url"
              value={serverUrl}
              onChange={(e) => onServerUrlChange(e.target.value)}
              placeholder={HYPHA_SERVER_URL}
              className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm focus:ring-blue-500 focus:border-blue-500"
            />
            <span className="text-xs text-gray-500">
              Leave empty to use the default Hypha server.
            </span>
          </div>

          <div>
            <div className="flex flex-wrap items-center gap-3 mb-1">
              <label className="block text-sm font-medium text-gray-700">
                Service ID
              </label>
              {showToggle && (
                <RunnerSiteToggle
                  selected={toggleSelected}
                  onSelect={onSelectSite}
                  available={siteAvailable}
                  loading={siteLoading}
                />
              )}
            </div>
            <input
              type="text"
              value={serviceIdOverride}
              onChange={(e) => onServiceIdOverrideChange(e.target.value)}
              placeholder={serviceIdPlaceholder}
              className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm focus:ring-blue-500 focus:border-blue-500"
            />
            <span className="text-xs text-gray-500">
              Switch between clusters to populate this field, or type a custom service id (e.g. a model-runner application on a private BioEngine).
            </span>
          </div>

          <div className="border-t border-gray-100 pt-3">
            <button
              type="button"
              onClick={onReset}
              disabled={isResetting}
              className="inline-flex items-center gap-1.5 px-2.5 py-1 text-xs font-medium rounded-md border border-gray-300 bg-white text-gray-700 hover:bg-gray-50 disabled:opacity-60 disabled:cursor-not-allowed"
            >
              {isResetting && (
                <svg className="w-3 h-3 animate-spin" viewBox="0 0 24 24" fill="none">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                </svg>
              )}
              {isResetting ? 'Resetting...' : 'Reset Connection'}
            </button>
          </div>
        </div>
      )}
    </div>
  );
};

export default AdvancedOptions;
