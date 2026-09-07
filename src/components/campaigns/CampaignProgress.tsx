import React from 'react';
import { Link, useParams } from 'react-router-dom';
import { useCampaign } from '../../hooks/useCampaign';
import { CampaignRecord } from '../../types/campaign';
import { CampaignEmptyState, CampaignErrorState, CampaignLoading } from './CampaignStates';
import { aggregateDisposition } from './aggregateDisposition';
import PrototypeBanner from './PrototypeBanner';
import RoundChart from './RoundChart';
import SiteRoster from './SiteRoster';
import TransportAudit from './TransportAudit';
import TransportHeadline from './TransportHeadline';
import { outcomesReleased } from './disclosure';
import { formatBytes, formatCount } from './format';
import { Value } from './MissingValue';

/**
 * Live progress for one campaign.
 *
 * The round log is derived from the campaign's own round records rather than
 * being a separate narration, so there is no way for the log to describe
 * something the records do not contain.
 *
 * What is live here is PROCESS: the roster growing, bytes crossing the network,
 * rounds landing, the digests each site scored on. Accuracy is not, and is
 * withheld entirely until the campaign's primary-metric rules resolve. See
 * `disclosure.ts` for why that is a rule rather than a preference.
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

const RoundLog: React.FC<{ record: CampaignRecord; showMetric: boolean }> = ({
  record,
  showMetric,
}) => {
  const entries = [...record.rounds].sort((a, b) => b.round - a.round).slice(0, 12);
  if (entries.length === 0) {
    return <p className="text-sm text-gray-500">No rounds have been reported yet.</p>;
  }
  const siteNames = new Map(record.sites.map((s) => [s.site_id, s.site_name]));
  return (
    <div>
      <ol className="space-y-3">
        {entries.map((round) => {
          // Gated on coverage, not on the value being populated. A round that
          // four of six sources logged yields a real sum of real entries that
          // is still not that round's transport, and the number cannot say
          // which of the two it is. Null fails closed, as everywhere else here.
          const out =
            round.transport?.sources_complete === true
              ? formatBytes(round.transport?.bytes_out)
              : null;
          const names = round.participants.map((id) => siteNames.get(id) ?? id);
          // The strongest provenance the record carries. "6 sites trained" is a
          // claim about intent; "6 sites scored on a22dba37" is a claim the
          // driver checked, because it compares the digests and raises when
          // they disagree. Prefer it wherever it exists.
          const digests = round.scored_with ? Object.values(round.scored_with) : [];
          const agreedDigest =
            digests.length > 0 && digests.every((d) => d === digests[0]) ? digests[0] : null;
          // Same decision the chart makes, from the same function, so the two
          // surfaces cannot disagree about whether a round's pooled figure is
          // publishable.
          const disposition = aggregateDisposition(
            round,
            record.policy?.aggregate_min_eval_sites ?? null
          );
          const aggregateShown = disposition.plot ? disposition.value : null;
          return (
            <li key={round.round} className="flex gap-3 text-sm">
              <span className="mt-0.5 w-16 flex-shrink-0 tabular-nums font-medium text-gray-500">
                Round {round.round}
              </span>
              <span className="text-gray-700">
                Merged weights from {names.length} {names.length === 1 ? 'site' : 'sites'}
                {names.length > 0 && `: ${names.join(', ')}`}
                {out && `. ${out} of weights moved.`}
                {agreedDigest && (
                  <>
                    {' '}
                    All {digests.length} scored on{' '}
                    <code className="rounded bg-gray-100 px-1 text-xs text-gray-600">
                      {agreedDigest.slice(0, 8)}
                    </code>
                    .
                  </>
                )}
                {/* The metric is withheld with the rest of the outcome axis.
                    A service that sends one anyway must still not have it
                    rendered, so this checks permission and not presence.

                    Permission is necessary and not sufficient. This used to
                    render any aggregate that was present, which made the log
                    the permissive twin of the chart: the chart would refuse a
                    figure on a disclosure ground and the log would print it
                    three lines further down. Between a surface that shows a
                    number and one that does not, the number is what a reader
                    takes away, so the same decision has to govern both. */}
                {showMetric && aggregateShown !== null && (
                  <>
                    {' '}
                    {round.metric!.name} {aggregateShown.toFixed(3)}.
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
          {record.reporting.reconciled === true
            ? ' The series has since been checked against the run’s own committed record, so what is shown is complete.'
            : ' The run keeps its own record and the two are reconciled once it finishes, so gaps that remain here may still fill in.'}
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

      <TransportHeadline transport={data.transport} payload={data.payload} />

      <div className="mt-6 rounded-2xl border border-gray-200 bg-white/80 p-6 shadow-sm">
        <RoundBar record={data} />
        {/* Three tiles, not four. "Weights out" moved into the headline above,
            and repeating it here would make one measurement look like two. */}
        <dl className="mt-5 grid grid-cols-2 gap-4 text-sm sm:grid-cols-3">
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
            <dt className="text-xs uppercase tracking-wide text-gray-500">Image data moved</dt>
            <dd className="mt-0.5 font-medium tabular-nums text-gray-800">
              <Value>{formatBytes(data.transport?.images_moved_bytes)}</Value>
            </dd>
          </div>
        </dl>
      </div>

      <Section
        title="The transport audit"
        subtitle="What the campaign's own transport log recorded, kept separate from what was worked out from it."
      >
        <TransportAudit transport={data.transport} payload={data.payload} />
      </Section>

      <Section title="Scores by round">
        {outcomesReleased(data) ? (
          <RoundChart
            rounds={data.rounds}
            sites={data.sites}
            minEvalSites={data.policy?.aggregate_min_eval_sites ?? null}
          />
        ) : (
          <p className="text-sm leading-relaxed text-gray-600">
            No scores are published for this campaign yet. A score taken from a round still in
            flight is a partial observation, and once it is next to another site&rsquo;s it reads as
            a comparison between datasets rather than between methods. Scores appear here after
            this campaign&rsquo;s primary-metric rules resolve. Everything above stays live in the
            meantime.
          </p>
        )}
      </Section>

      <Section title="Round log">
        <RoundLog record={data} showMetric={outcomesReleased(data)} />
      </Section>

      <Section title="Sites">
        <SiteRoster sites={data.sites} rosterAttested={data.policy?.roster_attested} />
      </Section>
    </div>
  );
};

export default CampaignProgress;
