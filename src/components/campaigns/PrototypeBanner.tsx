import React from 'react';
import { CAMPAIGN_FIXTURE_MODE, CAMPAIGN_FIXTURE_NOTICE } from '../../services/campaignService';

/**
 * Shown on every campaign screen while the fixture data layer is on.
 *
 * Renders nothing at all in a normal build, because `CAMPAIGN_FIXTURE_MODE` is
 * false unless `REACT_APP_CAMPAIGN_FIXTURES=1` was set at build time. It is
 * mounted unconditionally by each screen so nobody has to remember to add it,
 * and so the deployed page has no code path that shows illustrative figures
 * without also saying they are illustrative.
 */
const PrototypeBanner: React.FC = () => {
  if (!CAMPAIGN_FIXTURE_MODE) return null;
  return (
    <div
      role="status"
      data-testid="campaign-prototype-banner"
      className="mb-6 flex items-start gap-3 rounded-xl border border-amber-300 bg-amber-50 px-4 py-3 text-amber-900"
    >
      <svg
        className="mt-0.5 h-5 w-5 flex-shrink-0"
        data-icon="alert-triangle"
        fill="none"
        stroke="currentColor"
        viewBox="0 0 24 24"
      >
        <path
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeWidth={2}
          d="M12 9v2m0 4h.01M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z"
        />
      </svg>
      <p className="text-sm font-medium">{CAMPAIGN_FIXTURE_NOTICE}</p>
    </div>
  );
};

export default PrototypeBanner;
