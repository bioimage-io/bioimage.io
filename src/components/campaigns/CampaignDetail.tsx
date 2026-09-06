import React from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { useCampaign } from '../../hooks/useCampaign';
import { CampaignStatus } from '../../types/campaign';
import { CampaignEmptyState, CampaignErrorState, CampaignLoading } from './CampaignStates';
import JoinCampaignDialog from './JoinCampaignDialog';
import PrototypeBanner from './PrototypeBanner';
import SiteRoster from './SiteRoster';
import TransportAudit from './TransportAudit';
import TransportHeadline from './TransportHeadline';
import { formatBytes, formatDate } from './format';
import { Value } from './MissingValue';

const STATUS_LABELS: Record<CampaignStatus, string> = {
  open: 'Open to join',
  running: 'Training',
  completed: 'Completed',
  closed: 'Closed',
};

const Section: React.FC<{ title: string; children: React.ReactNode; subtitle?: string }> = ({
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

const CampaignDetail: React.FC = () => {
  const { campaignId } = useParams<{ campaignId: string }>();
  const [searchParams, setSearchParams] = useSearchParams();
  const navigate = useNavigate();
  const { data, loading, error, reload } = useCampaign(campaignId);

  const joinOpen = searchParams.get('join') === '1';
  const closeJoin = () => {
    searchParams.delete('join');
    setSearchParams(searchParams, { replace: true });
  };

  if (loading) {
    return (
      <div className="mx-auto max-w-5xl px-4 py-10">
        <PrototypeBanner />
        <CampaignLoading label="Loading campaign" />
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

  const perRound = formatBytes(data.payload?.bytes_per_site_per_round);
  const weightsOnly = data.transport?.only_weights_left_site === true;
  const canJoin = data.status === 'open' || data.status === 'running';

  return (
    <div className="mx-auto max-w-5xl px-4 py-10">
      <PrototypeBanner />

      <Link
        to="/campaigns"
        className="inline-flex items-center gap-1.5 text-sm text-gray-500 transition-colors duration-200 hover:text-gray-800"
      >
        <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
        </svg>
        All campaigns
      </Link>

      <header className="mt-4">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <h1 className="text-3xl font-bold tracking-tight text-gray-900">{data.title}</h1>
            <p className="mt-1 text-sm text-gray-500">
              {STATUS_LABELS[data.status]}
              {data.round.started_at && `, started ${formatDate(data.round.started_at)}`}
            </p>
          </div>
          <div className="flex flex-shrink-0 gap-3">
            <button
              type="button"
              onClick={() => navigate(`/campaigns/${data.campaign_id}/progress`)}
              className="rounded-xl border border-gray-300 bg-white px-4 py-2 text-sm font-medium text-gray-700 shadow-sm transition-all duration-200 ease-out hover:border-gray-400 hover:shadow active:scale-[0.97]"
            >
              View progress
            </button>
            {canJoin && (
              <button
                type="button"
                onClick={() => setSearchParams({ join: '1' })}
                className="rounded-xl bg-gradient-to-r from-blue-600 to-purple-600 px-4 py-2 text-sm font-semibold text-white shadow-md transition-all duration-200 ease-out hover:shadow-lg active:scale-[0.97]"
              >
                Request to join
              </button>
            )}
          </div>
        </div>

        {data.description && (
          <p className="mt-4 max-w-3xl text-[1.05rem] leading-relaxed text-gray-700">
            {data.description}
          </p>
        )}

        {weightsOnly && (
          <div className="mt-5 inline-flex items-center gap-2 rounded-full border border-emerald-200 bg-emerald-50 px-4 py-1.5 text-sm font-medium text-emerald-800">
            <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z"
              />
            </svg>
            {data.payload?.label
              ? `${data.payload.label} is all that leaves each site`
              : 'Only model weights leave each site'}
            {perRound && `, ${perRound} per round`}
          </div>
        )}
      </header>

      {/* Above everything else, including the roster. A round counter is table
          stakes; a measured byte total is the thing this page exists to show. */}
      <TransportHeadline transport={data.transport} payload={data.payload} />

      <Section
        title="The transport audit"
        subtitle="The same figures with their workings, for anyone who wants to check them."
      >
        <TransportAudit transport={data.transport} payload={data.payload} />
      </Section>

      <Section title="Participating sites">
        <SiteRoster sites={data.sites} rosterAttested={data.policy?.roster_attested} />
      </Section>

      <Section title="At a glance">
        <dl className="grid gap-x-8 gap-y-4 text-sm sm:grid-cols-2 lg:grid-cols-3">
          <div>
            <dt className="text-xs uppercase tracking-wide text-gray-500">Base model</dt>
            <dd className="mt-0.5 font-medium text-gray-800">
              {data.base_model ? (
                data.base_model.url ? (
                  <a
                    href={data.base_model.url}
                    className="text-blue-700 transition-colors duration-200 hover:text-blue-900"
                  >
                    {data.base_model.name}
                  </a>
                ) : (
                  data.base_model.name
                )
              ) : (
                <Value label="Trained from scratch">{null}</Value>
              )}
            </dd>
          </div>
          <div>
            <dt className="text-xs uppercase tracking-wide text-gray-500">Aggregation</dt>
            <dd className="mt-0.5 font-medium text-gray-800">
              {data.aggregation.method}, weighted by {data.aggregation.weighting}
            </dd>
          </div>
          <div>
            <dt className="text-xs uppercase tracking-wide text-gray-500">Rounds</dt>
            <dd className="mt-0.5 font-medium tabular-nums text-gray-800">
              {data.round.current === null ? (
                <Value>{null}</Value>
              ) : data.round.total ? (
                `${data.round.current} of ${data.round.total}`
              ) : (
                `${data.round.current}`
              )}
            </dd>
          </div>
          <div>
            <dt className="text-xs uppercase tracking-wide text-gray-500">Accepted data licences</dt>
            <dd className="mt-0.5 font-medium text-gray-800">
              <Value>{data.licence_policy.accepted_data_licences.join(', ') || null}</Value>
            </dd>
          </div>
          <div>
            <dt className="text-xs uppercase tracking-wide text-gray-500">Model licence</dt>
            <dd className="mt-0.5 font-medium text-gray-800">
              <Value>{data.licence_policy.model_licence}</Value>
            </dd>
          </div>
          <div>
            <dt className="text-xs uppercase tracking-wide text-gray-500">Stewards</dt>
            <dd className="mt-0.5 font-medium text-gray-800">
              <Value>{data.stewards.map((s) => s.name).join(', ') || null}</Value>
            </dd>
          </div>
        </dl>
      </Section>

      {joinOpen && <JoinCampaignDialog campaign={data} onClose={closeJoin} />}
    </div>
  );
};

export default CampaignDetail;
