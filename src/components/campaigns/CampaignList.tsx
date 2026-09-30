import React from 'react';
import { Link } from 'react-router-dom';
import { useCampaigns } from '../../hooks/useCampaign';
import { CampaignStatus, CampaignSummary } from '../../types/campaign';
import { CampaignEmptyState, CampaignErrorState, CampaignLoading } from './CampaignStates';
import PrototypeBanner from './PrototypeBanner';
import { formatBytes, formatCount, formatDate } from './format';
import { Value } from './MissingValue';

const STATUS_STYLES: Record<CampaignStatus, { label: string; className: string }> = {
  open: { label: 'Open to join', className: 'bg-emerald-50 text-emerald-700 border-emerald-200' },
  running: { label: 'Training', className: 'bg-blue-50 text-blue-700 border-blue-200' },
  completed: { label: 'Completed', className: 'bg-gray-100 text-gray-700 border-gray-200' },
  closed: { label: 'Closed', className: 'bg-gray-100 text-gray-500 border-gray-200' },
};

const CampaignCard: React.FC<{ campaign: CampaignSummary }> = ({ campaign }) => {
  const status = STATUS_STYLES[campaign.status] ?? STATUS_STYLES.closed;
  const summary = campaign.progress;
  const perPayload = formatBytes(campaign.payload?.bytes_per_contribution);
  // NO PROGRESS BAR, and this card used to draw one. Only a fixed-length run has
  // a fraction to be partway through, and the synchronous arm that had one left
  // the contract at 0.14.0-draft. An open campaign runs for as long as people
  // keep contributing, so it has no denominator, and a bar drawn against an
  // invented one would be the page asserting a finish line the campaign never
  // set.

  return (
    <Link
      to={`/campaigns/${campaign.campaign_id}`}
      className="group block rounded-2xl border border-gray-200 bg-white/80 p-6 shadow-sm transition-all duration-200 ease-out hover:-translate-y-0.5 hover:border-blue-200 hover:shadow-md active:translate-y-0 active:scale-[0.995]"
    >
      <div className="flex items-start justify-between gap-4">
        <h3 className="text-lg font-semibold text-gray-900 transition-colors duration-200 group-hover:text-blue-700">
          {campaign.title}
        </h3>
        <span
          className={`inline-flex flex-shrink-0 items-center rounded-full border px-2.5 py-0.5 text-xs font-medium ${status.className}`}
        >
          {status.label}
        </span>
      </div>

      {campaign.description && (
        <p className="mt-2 line-clamp-3 text-sm text-gray-600">{campaign.description}</p>
      )}

      <dl className="mt-5 grid grid-cols-2 gap-4 text-sm sm:grid-cols-4">
        <div>
          <dt className="text-xs uppercase tracking-wide text-gray-500">Contributors</dt>
          <dd className="mt-0.5 font-medium tabular-nums text-gray-800">
            <Value>{formatCount(campaign.n_active_sites)}</Value>
          </dd>
        </div>
        <div>
          <dt className="text-xs uppercase tracking-wide text-gray-500">Community model</dt>
          <dd className="mt-0.5 font-medium tabular-nums text-gray-800">
            <Value>
              {summary.n_versions === null
                ? null
                : summary.n_versions === 1
                ? '1 version'
                : `${formatCount(summary.n_versions)} versions`}
            </Value>
            {summary.n_contributions !== null && (
              <span className="block text-xs font-normal text-gray-500">
                from {formatCount(summary.n_contributions)}{' '}
                {summary.n_contributions === 1 ? 'contribution' : 'contributions'}
              </span>
            )}
          </dd>
        </div>
        <div>
          <dt className="text-xs uppercase tracking-wide text-gray-500">What travels</dt>
          <dd className="mt-0.5 font-medium text-gray-800">
            <Value>{campaign.payload?.label ?? null}</Value>
            {perPayload && (
              <span className="block text-xs font-normal text-gray-500">
                {perPayload} per contribution
              </span>
            )}
          </dd>
        </div>
        <div>
          <dt className="text-xs uppercase tracking-wide text-gray-500">Started</dt>
          <dd className="mt-0.5 font-medium text-gray-800">
            <Value>{formatDate(campaign.started_at)}</Value>
          </dd>
        </div>
      </dl>
    </Link>
  );
};

const CampaignList: React.FC = () => {
  const { data, loading, error, reload } = useCampaigns();

  return (
    <div className="mx-auto max-w-6xl px-4 py-10">
      <PrototypeBanner />

      <header className="mb-8 text-center">
        <h1 className="bg-gradient-to-r from-blue-600 via-purple-600 to-cyan-600 bg-clip-text text-4xl font-bold tracking-tight text-transparent">
          Training campaigns
        </h1>
        {/* The pitch is TOO MUCH DATA TO MOVE, and it is deliberately not a
            privacy pitch. Privacy is a separate argument with separate
            requirements, and leading with it would promise a guarantee this
            platform does not make: weight averaging is not a confidentiality
            mechanism. The reason to train this way is that a microscopy archive
            is measured in terabytes and a model update is measured in
            megabytes, which is true whether or not the images are sensitive.

            This is also the claim the page can back with numbers, which is why
            TransportHeadline sits above everything on both screens. */}
        <p className="mx-auto mt-3 max-w-2xl text-[1.05rem] text-gray-600">
          Some imaging datasets are too large to move. So the model goes to the data instead:
          contributors fine-tune on their own images, and only the weights travel. Each campaign
          publishes who took part, what came back, and an audit of exactly how many bytes crossed
          the network.
        </p>
      </header>

      {loading && <CampaignLoading />}
      {!loading && error && <CampaignErrorState error={error} onRetry={reload} />}
      {!loading && !error && data && data.length === 0 && (
        <CampaignEmptyState
          title="No campaigns are running"
          body="The campaign service is reachable but has no campaigns to report. This page shows only campaigns that exist, so there is nothing to display right now."
        />
      )}
      {!loading && !error && data && data.length > 0 && (
        <div className="grid gap-5 md:grid-cols-2">
          {data.map((campaign) => (
            <CampaignCard key={campaign.campaign_id} campaign={campaign} />
          ))}
        </div>
      )}
    </div>
  );
};

export default CampaignList;
