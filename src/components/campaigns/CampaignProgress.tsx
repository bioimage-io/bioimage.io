import React from 'react';
import { Link, useParams } from 'react-router-dom';
import { useCampaign } from '../../hooks/useCampaign';
import { CampaignRecord } from '../../types/campaign';
import { CampaignEmptyState, CampaignErrorState, CampaignLoading } from './CampaignStates';
import PrototypeBanner from './PrototypeBanner';
import RoundChart from './RoundChart';
import SiteRoster from './SiteRoster';
import TransportAudit from './TransportAudit';
import { formatBytes, formatCount } from './format';
import { Value } from './MissingValue';

/**
 * Live progress for one campaign.
 *
 * The round log is derived from the campaign's own round records rather than
 * being a separate narration, so there is no way for the log to describe
 * something the records do not contain.
 */

const RoundBar: React.FC<{ record: CampaignRecord }> = ({ record }) => {
  const { current, total } = record.round;
  if (current === null || !total) {
    return (
      <p className="text-sm text-gray-500">
        This campaign has not reported a round counter.
      </p>
    );
  }
  const pct = Math.min(100, Math.round((current / total) * 100));
  return (
    <div>
      <div className="flex items-baseline justify-between">
        <span className="text-sm font-medium text-gray-700">
          Round {current} of {total}
        </span>
        <span className="text-sm tabular-nums text-gray-500">{pct}%</span>
      </div>
      <div className="mt-2 h-2 w-full overflow-hidden rounded-full bg-gray-100">
        <div
          className="h-full rounded-full bg-gradient-to-r from-blue-500 to-purple-500 transition-[width] duration-500 ease-out"
          style={{ width: `${pct}%` }}
        />
      </div>
    </div>
  );
};

const RoundLog: React.FC<{ record: CampaignRecord }> = ({ record }) => {
  const entries = [...record.rounds].sort((a, b) => b.round - a.round).slice(0, 12);
  if (entries.length === 0) {
    return <p className="text-sm text-gray-500">No rounds have been reported yet.</p>;
  }
  const siteNames = new Map(record.sites.map((s) => [s.site_id, s.site_name]));
  return (
    <div>
      <ol className="space-y-3">
        {entries.map((round) => {
          const out = formatBytes(round.transport?.bytes_out);
          const names = round.participants.map((id) => siteNames.get(id) ?? id);
          return (
            <li key={round.round} className="flex gap-3 text-sm">
              <span className="mt-0.5 w-16 flex-shrink-0 tabular-nums font-medium text-gray-500">
                Round {round.round}
              </span>
              <span className="text-gray-700">
                Merged weights from {names.length} {names.length === 1 ? 'site' : 'sites'}
                {names.length > 0 && `: ${names.join(', ')}`}
                {out && `. ${out} of weights moved.`}
                {round.metric?.aggregate !== undefined && round.metric?.aggregate !== null && (
                  <>
                    {' '}
                    {round.metric.name} {round.metric.aggregate.toFixed(3)}.
                  </>
                )}
              </span>
            </li>
          );
        })}
      </ol>
      {record.reporting?.dropped_reports ? (
        <p className="mt-4 text-xs text-gray-500">
          {formatCount(record.reporting.dropped_reports)} reports from the training run did not
          reach this service and are missing above. Reporting never blocks training, so a gap here
          means a lost record rather than a lost round.
        </p>
      ) : null}
    </div>
  );
};

const Section: React.FC<{ title: string; subtitle?: string; children: React.ReactNode }> = ({
  title,
  subtitle,
  children,
}) => (
  <section className="mt-8 rounded-2xl border border-gray-200 bg-white/80 p-6 shadow-sm">
    <h2 className="text-lg font-semibold text-gray-900">{title}</h2>
    {subtitle && <p className="mt-1 text-sm text-gray-600">{subtitle}</p>}
    <div className="mt-4">{children}</div>
  </section>
);

const CampaignProgress: React.FC = () => {
  const { campaignId } = useParams<{ campaignId: string }>();
  const { data, loading, error, reload } = useCampaign(campaignId);

  if (loading) {
    return (
      <div className="mx-auto max-w-5xl px-4 py-10">
        <PrototypeBanner />
        <CampaignLoading label="Loading campaign progress" />
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="mx-auto max-w-5xl px-4 py-10">
        <PrototypeBanner />
        {error ? (
          <CampaignErrorState error={error} onRetry={reload} />
        ) : (
          <CampaignEmptyState
            title="Campaign not found"
            body="No campaign with this identifier was reported by the campaign service."
          />
        )}
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-5xl px-4 py-10">
      <PrototypeBanner />

      <Link
        to={`/campaigns/${data.campaign_id}`}
        className="inline-flex items-center gap-1.5 text-sm text-gray-500 transition-colors duration-200 hover:text-gray-800"
      >
        <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
        </svg>
        Back to campaign
      </Link>

      <header className="mt-4">
        <h1 className="text-3xl font-bold tracking-tight text-gray-900">{data.title}</h1>
        <p className="mt-1 text-sm text-gray-500">Progress and transport audit</p>
      </header>

      <div className="mt-6 rounded-2xl border border-gray-200 bg-white/80 p-6 shadow-sm">
        <RoundBar record={data} />
        <dl className="mt-5 grid grid-cols-2 gap-4 text-sm sm:grid-cols-4">
          <div>
            <dt className="text-xs uppercase tracking-wide text-gray-500">Sites reporting</dt>
            <dd className="mt-0.5 font-medium tabular-nums text-gray-800">
              <Value>
                {formatCount(data.sites.filter((s) => s.activity !== 'pending_review').length)}
              </Value>
            </dd>
          </div>
          <div>
            <dt className="text-xs uppercase tracking-wide text-gray-500">Rounds recorded</dt>
            <dd className="mt-0.5 font-medium tabular-nums text-gray-800">
              <Value>{formatCount(data.rounds.length)}</Value>
            </dd>
          </div>
          <div>
            <dt className="text-xs uppercase tracking-wide text-gray-500">Weights out</dt>
            <dd className="mt-0.5 font-medium tabular-nums text-gray-800">
              <Value>{formatBytes(data.transport?.bytes_out)}</Value>
            </dd>
          </div>
          <div>
            <dt className="text-xs uppercase tracking-wide text-gray-500">Image data moved</dt>
            <dd className="mt-0.5 font-medium tabular-nums text-gray-800">
              <Value>{formatBytes(data.transport?.images_moved_bytes)}</Value>
            </dd>
          </div>
        </dl>
      </div>

      <Section title="Scores by round">
        <RoundChart rounds={data.rounds} sites={data.sites} />
      </Section>

      <Section
        title="Transport audit"
        subtitle="Computed over the campaign's own transport log."
      >
        <TransportAudit transport={data.transport} payload={data.payload} />
      </Section>

      <Section title="Round log">
        <RoundLog record={data} />
      </Section>

      <Section title="Sites">
        <SiteRoster sites={data.sites} />
      </Section>
    </div>
  );
};

export default CampaignProgress;
