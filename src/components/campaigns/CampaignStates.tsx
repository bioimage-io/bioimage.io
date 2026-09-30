import React from 'react';
import { CampaignSchemaMismatchError } from '../../services/campaignService';

/**
 * The three non-data states every campaign screen can be in.
 *
 * They are shared so that "the campaign service is unreachable" always looks
 * the same and always looks like an absence of data, never like data.
 */

export const CampaignLoading: React.FC<{ label?: string }> = ({ label = 'Loading campaigns' }) => (
  <div className="flex items-center gap-3 py-16 text-gray-500" role="status">
    <span className="h-4 w-4 animate-spin rounded-full border-2 border-gray-300 border-t-blue-600" />
    <span className="text-sm">{label}</span>
  </div>
);

export const CampaignEmptyState: React.FC<{ title: string; body: string }> = ({ title, body }) => (
  <div
    data-testid="campaign-empty-state"
    className="rounded-2xl border border-dashed border-gray-300 bg-white/60 px-6 py-14 text-center"
  >
    <h2 className="text-lg font-semibold text-gray-800">{title}</h2>
    <p className="mx-auto mt-2 max-w-xl text-sm text-gray-600">{body}</p>
  </div>
);

/**
 * A schema mismatch is not an unreachable service and must not claim to be one.
 * The service answered, the page simply cannot vouch for what it said, and
 * telling a reader the service was unreachable would send them to look at the
 * wrong thing. Both cases render the same empty screen; only the sentence
 * explaining it differs.
 */
export const CampaignErrorState: React.FC<{ error: Error; onRetry?: () => void }> = ({
  error,
  onRetry,
}) => (
  <div
    data-testid="campaign-error-state"
    className="rounded-2xl border border-gray-200 bg-white/70 px-6 py-14 text-center"
  >
    <h2 className="text-lg font-semibold text-gray-800">Campaign data is not available</h2>
    {error instanceof CampaignSchemaMismatchError ? (
      <p className="mx-auto mt-2 max-w-xl text-sm text-gray-600">
        The campaign service answered, but it reports records in a format this page does not
        recognise, so nothing here can be shown. Rendering them anyway could put a figure on screen
        in the wrong units, which is worse than showing nothing. This usually means the page and the
        service are on different versions.
      </p>
    ) : (
      <p className="mx-auto mt-2 max-w-xl text-sm text-gray-600">
        The campaign service could not be reached, so there is nothing to show. This page does not
        display placeholder figures, so it stays empty until real records load.
      </p>
    )}
    {/* Diagnostic detail, not campaign data. It renders only an HTTP status or
        a schema version, never anything read out of a record, which is what
        lets the honesty check exclude it by this testid. Keep it that way: if
        this line ever interpolates a value from a campaign, the check that
        forbids invented figures stops covering the thing it exists for. */}
    <p data-testid="campaign-error-detail" className="mt-2 text-xs text-gray-400">
      {error.message}
    </p>
    {onRetry && (
      <button
        type="button"
        onClick={onRetry}
        className="mt-5 inline-flex items-center rounded-xl border border-gray-300 bg-white px-4 py-2 text-sm font-medium text-gray-700 shadow-sm transition-all duration-200 ease-out hover:border-gray-400 hover:shadow active:scale-[0.97]"
      >
        Try again
      </button>
    )}
  </div>
);
