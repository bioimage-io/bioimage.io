import React from 'react';

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

export const CampaignErrorState: React.FC<{ error: Error; onRetry?: () => void }> = ({
  error,
  onRetry,
}) => (
  <div
    data-testid="campaign-error-state"
    className="rounded-2xl border border-gray-200 bg-white/70 px-6 py-14 text-center"
  >
    <h2 className="text-lg font-semibold text-gray-800">Campaign data is not available</h2>
    <p className="mx-auto mt-2 max-w-xl text-sm text-gray-600">
      The campaign service could not be reached, so there is nothing to show. This page does not
      display placeholder figures, so it stays empty until real records load.
    </p>
    <p className="mt-2 text-xs text-gray-400">{error.message}</p>
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
