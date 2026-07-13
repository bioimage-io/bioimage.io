import React from 'react';
import { Dialog as MuiDialog } from '@mui/material';
import RunnerSiteToggle from './RunnerSiteToggle';
import { RunnerSite } from '../utils/bioengineService';

interface TestOptionsDialogProps {
  open: boolean;
  onClose: () => void;
  /** Fired when the user confirms — the caller kicks off the actual test run. */
  onRun: () => void;
  customEnvironment: boolean;
  onCustomEnvironmentChange: (value: boolean) => void;
  skipCache: boolean;
  onSkipCacheChange: (value: boolean) => void;
  /** Runner-site selection, shown at the top so it is picked before the run. */
  selectedSite: RunnerSite | null;
  onSelectSite: (site: RunnerSite) => void;
  siteAvailable: Record<RunnerSite, boolean>;
  siteLoading?: boolean;
}

/**
 * The single "Run Model Test" options dialog shared by every page that can
 * start a test (Edit, Review). It bundles the runner-site selector with the
 * custom-environment and skip-cache toggles so the Test Model button behaves
 * identically everywhere it appears.
 */
const TestOptionsDialog: React.FC<TestOptionsDialogProps> = ({
  open,
  onClose,
  onRun,
  customEnvironment,
  onCustomEnvironmentChange,
  skipCache,
  onSkipCacheChange,
  selectedSite,
  onSelectSite,
  siteAvailable,
  siteLoading = false,
}) => {
  return (
    <MuiDialog open={open} onClose={onClose} maxWidth="sm" fullWidth>
      <div className="p-6">
        <h3 className="text-lg font-medium text-gray-900 mb-1">Run Model Test</h3>
        <p className="text-sm text-gray-500 mb-5">
          The model will be tested via BioEngine. Configure the options below before starting.
        </p>

        {/* Runner site — pick which cluster handles this test. */}
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
          <div>
            <div className="text-sm font-medium text-gray-800">Runner site</div>
            <div className="text-xs text-gray-500 mt-0.5">Which BioEngine cluster runs the test.</div>
          </div>
          <RunnerSiteToggle
            selected={selectedSite}
            onSelect={onSelectSite}
            available={siteAvailable}
            loading={siteLoading}
          />
        </div>

        {!customEnvironment && (
          <div className="mb-4 flex items-start gap-2 rounded-md bg-yellow-50 border border-yellow-200 px-3 py-2.5 text-xs text-yellow-800">
            <svg className="w-3.5 h-3.5 mt-0.5 flex-shrink-0 text-yellow-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z" />
            </svg>
            <span>
              The BioEngine runner uses a fixed environment. Tests may fail if the model requires packages not available in the default runner environment. Enable custom environment below to test in the model-declared conda environment instead.
            </span>
          </div>
        )}

        <div className="space-y-4">
          <label className="flex items-start gap-3 cursor-pointer select-none group">
            <input
              type="checkbox"
              checked={customEnvironment}
              onChange={(e) => onCustomEnvironmentChange(e.target.checked)}
              className="mt-0.5 w-4 h-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500 flex-shrink-0"
            />
            <div>
              <div className="text-sm font-medium text-gray-800 group-hover:text-gray-900">Custom environment</div>
              <div className="text-xs text-gray-500 mt-0.5">
                Runs the test inside the conda environment declared by the model's own weights description. Slower than the default runner environment but matches exactly what the model author specified.
              </div>
            </div>
          </label>
          <label className="flex items-start gap-3 cursor-pointer select-none group">
            <input
              type="checkbox"
              checked={skipCache}
              onChange={(e) => onSkipCacheChange(e.target.checked)}
              className="mt-0.5 w-4 h-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500 flex-shrink-0"
            />
            <div>
              <div className="text-sm font-medium text-gray-800 group-hover:text-gray-900">Skip cache</div>
              <div className="text-xs text-gray-500 mt-0.5">
                Forces a full re-download of the model package, bypassing any cached files on the runner. Use this if you recently updated the model files and want to make sure the test runs against the latest version.
              </div>
            </div>
          </label>
        </div>

        <div className="mt-4 flex gap-3 justify-end">
          <button
            onClick={onClose}
            className="px-4 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-md hover:bg-gray-50 transition-transform active:scale-[0.97]"
          >
            Cancel
          </button>
          <button
            onClick={() => {
              onClose();
              onRun();
            }}
            className="px-4 py-2 text-sm font-medium text-white bg-blue-600 border border-transparent rounded-md hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500 transition-transform active:scale-[0.97]"
          >
            Run Test
          </button>
        </div>
      </div>
    </MuiDialog>
  );
};

export default TestOptionsDialog;
