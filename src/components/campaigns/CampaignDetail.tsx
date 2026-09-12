import React from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { useCampaign } from '../../hooks/useCampaign';
import { CampaignStatus } from '../../types/campaign';
import { CampaignEmptyState, CampaignErrorState, CampaignLoading } from './CampaignStates';
import JoinCampaignDialog from './JoinCampaignDialog';
import ContributorRoster from './ContributorRoster';
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

  const progress = data.progress;
  // The two modes quote the payload figure against different denominators, and
  // exactly one of the two fields is populated per mode. Reading the wrong one
  // yields null, which renders as nothing, so a mode mix-up here would be
  // invisible rather than loud. Hence the switch instead of a `??` chain.
  const perPayload =
    progress.mode === 'synchronous'
      ? formatBytes(data.payload?.bytes_per_site_per_round)
      : formatBytes(data.payload?.bytes_per_contribution);
  const perPayloadUnit = progress.mode === 'synchronous' ? 'per round' : 'per contribution';
  // A closed consortium has sites and an open community has contributors. The
  // words are not interchangeable: "site" names an institutional deployment on
  // a fixed roster, which is what the synchronous test was, and the async
  // campaign is open to anyone with data and a GPU.
  const participantNoun = progress.mode === 'synchronous' ? 'site' : 'contributor';
  const startedAt = progress.mode === 'synchronous' ? progress.round.started_at : progress.started_at;
  const weightsOnly = data.transport?.only_weights_left_site === true;
  const canJoin = data.status === 'open' || data.status === 'running';

  return (
    <div className="mx-auto max-w-5xl px-4 py-10">
      <PrototypeBanner />

      <Link
        to="/campaigns"
        className="inline-flex items-center gap-1.5 text-sm text-gray-500 transition-colors duration-200 hover:text-gray-800"
      >
        <svg
          className="h-4 w-4"
          data-icon="chevron-left"
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
        >
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
              {startedAt && `, started ${formatDate(startedAt)}`}
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

        {/* This pill states WHAT MOVES. It is not a safety badge, and it used to
            be drawn as one: a shield-check glyph in emerald, which is the
            padlock argument in a different costume. The page bans privacy
            framing in words (see the pitch note in CampaignList) and weight
            averaging is not a confidentiality mechanism, so a shield asserting
            protection was making in iconography exactly the claim the copy is
            written to avoid. A text guard could never have caught it, because
            the render keeps the path and forgets the name.

            Hence an outbound arrow, which depicts leaving, and the neutral
            palette. Emerald on this page means STATUS ('Open to join',
            'Reported'), and reusing the status colour for a claim about the
            protocol confuses two different kinds of statement. */}
        {weightsOnly && (
          <div className="mt-5 inline-flex items-center gap-2 rounded-full border border-gray-200 bg-gray-50 px-4 py-1.5 text-sm font-medium text-gray-700">
            <svg
              className="h-4 w-4"
              data-icon="arrow-right"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M13 7l5 5m0 0l-5 5m5-5H6"
              />
            </svg>
            {data.payload?.label
              ? `${data.payload.label} is all that leaves each ${participantNoun}`
              : `Only model weights leave each ${participantNoun}`}
            {perPayload && `, ${perPayload} ${perPayloadUnit}`}
          </div>
        )}
      </header>

      {/* Above everything else, including the roster. A round counter is table
          stakes; a measured byte total is the thing this page exists to show. */}
      <TransportHeadline
        transport={data.transport}
        payload={data.payload}
        mode={data.progress.mode}
      />

      <Section
        title="The transport audit"
        subtitle="The same figures with their workings, for anyone who wants to check them."
      >
        <TransportAudit
          transport={data.transport}
          payload={data.payload}
          mode={data.progress.mode}
        />
      </Section>

      {progress.mode === 'synchronous' ? (
        <Section title="Participating sites">
          <SiteRoster sites={progress.sites} rosterAttested={data.policy?.roster_attested} />
        </Section>
      ) : (
        <Section
          title="Contributors"
          subtitle="Anyone with data and a GPU can join. Nobody waits for anybody else."
        >
          <ContributorRoster
            contributors={progress.contributors}
            rosterAttested={data.policy?.roster_attested}
          />
        </Section>
      )}

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
                /* This used to read "Trained from scratch", which the record
                   does not say. `base_model` is nullable and nothing in the
                   schema gives null that meaning, so the page was picking the
                   more informative of two readings without warrant. That is
                   exactly the default-substitution the schema forbids, and it
                   is the unsafe direction: a campaign that fine-tuned from a
                   published model but did not report which one would have been
                   described to a reader as having trained from nothing.

                   If a campaign needs to state that it started from scratch,
                   that is a value the service must send, not an inference the
                   page is entitled to make from an absence. */
                <Value>{null}</Value>
              )}
              {/* The name is the zoo ENTRY and the campaign started from one
                  committed version of it. Those differ: the Cellpose-SAM entry
                  holds two versions with different weights. Printing the
                  version when it is stated, and saying so when it is not,
                  keeps the cell from reading as a checkpoint it may not be. */}
              {data.base_model?.version && (
                <span className="ml-1 font-normal tabular-nums text-gray-600">
                  {data.base_model.version}
                </span>
              )}
              {data.base_model && data.base_model.version === null && (
                <span className="ml-1 text-xs font-normal text-gray-500">
                  (version not stated)
                </span>
              )}
            </dd>
          </div>
          <div>
            <dt className="text-xs uppercase tracking-wide text-gray-500">Aggregation</dt>
            <dd className="mt-0.5 font-medium text-gray-800">
              {data.aggregation.method}, {data.aggregation.weighting} weighting
            </dd>
          </div>
          {/* Two different facts, not one fact with two spellings. A round
              counter measures how far through a fixed plan a run is. An async
              campaign has no plan to be partway through, so the comparable
              figure is how much has accumulated, which has no denominator. */}
          {progress.mode === 'synchronous' ? (
            <div>
              <dt className="text-xs uppercase tracking-wide text-gray-500">Rounds</dt>
              <dd className="mt-0.5 font-medium tabular-nums text-gray-800">
                {progress.round.current === null ? (
                  <Value>{null}</Value>
                ) : progress.round.total ? (
                  `${progress.round.current} of ${progress.round.total}`
                ) : (
                  `${progress.round.current}`
                )}
              </dd>
            </div>
          ) : (
            <div>
              <dt className="text-xs uppercase tracking-wide text-gray-500">Contributed so far</dt>
              <dd className="mt-0.5 font-medium tabular-nums text-gray-800">
                {progress.contributions.length}
                {progress.contributions.length === 1 ? ' contribution' : ' contributions'}
                {', '}
                {progress.soups.length}
                {progress.soups.length === 1 ? ' version' : ' versions'}
              </dd>
            </div>
          )}
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
