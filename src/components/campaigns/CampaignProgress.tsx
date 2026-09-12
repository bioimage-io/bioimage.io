import React from 'react';
import { Link, useParams } from 'react-router-dom';
import { useCampaign } from '../../hooks/useCampaign';
import { CampaignRecord, CampaignProgressRecord } from '../../types/campaign';
import { CampaignEmptyState, CampaignErrorState, CampaignLoading } from './CampaignStates';
import { aggregateDisposition } from './aggregateDisposition';
import ContributionStream from './ContributionStream';
import ContributorRoster from './ContributorRoster';
import PrototypeBanner from './PrototypeBanner';
import RoundChart from './RoundChart';
import SiteRoster from './SiteRoster';
import SoupLineage from './SoupLineage';
import TransportAudit from './TransportAudit';
import TransportHeadline from './TransportHeadline';
import { outcomesReleased } from './disclosure';
import { formatBytes, formatCount, formatDate } from './format';
import { Value } from './MissingValue';

/**
 * Live progress for one campaign, in either mode.
 *
 * The two modes get different screens rather than one screen with nullable
 * fields, because they are different processes and the page should not be able
 * to render a state that cannot occur. A synchronous campaign has a current
 * round out of a total and a lockstep progress bar. An asynchronous one has
 * neither, and giving it an empty progress bar would say the campaign failed to
 * report a number that does not exist for it.
 *
 * What is live here is PROCESS in both modes: the roster growing, bytes
 * crossing the network, merges landing, the digests each participant scored on.
 * Accuracy is gated on `disclosure.ts` and released per campaign.
 *
 * One deliberate asymmetry in that gate. A soup's score is attached to an
 * IMMUTABLE published checkpoint, so it is a model-card figure that the
 * campaign continuing cannot revise, which is why an async campaign can release
 * version scores while still running. Per-contributor curves stay withheld in
 * both modes.
 */

type SyncProgress = Extract<CampaignProgressRecord, { mode: 'synchronous' }>;
type AsyncProgress = Extract<CampaignProgressRecord, { mode: 'asynchronous' }>;

const RoundBar: React.FC<{ progress: SyncProgress }> = ({ progress }) => {
  const { current, total } = progress.round;
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

const RoundLog: React.FC<{
  record: CampaignRecord;
  progress: SyncProgress;
  showMetric: boolean;
}> = ({ record, progress, showMetric }) => {
  const entries = [...progress.rounds].sort((a, b) => b.round - a.round).slice(0, 12);
  if (entries.length === 0) {
    return <p className="text-sm text-gray-500">No rounds have been reported yet.</p>;
  }
  const siteNames = new Map(progress.sites.map((s) => [s.site_id, s.site_name]));
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
          //
          // Two things had to be established before that sentence can be
          // printed, and the sentence used to establish neither.
          //
          // The key space, because the sentence counts this map's entries and
          // calls them sites. `scored_with` comes out of the same driver
          // function as the per-site metric map and the two are keyed
          // differently, so "it is next to site data" is not evidence.
          //
          // And the denominator. "All N scored on X" took N from inside the map
          // it was describing, and a map is always all of itself, so the word
          // "all" could not be wrong and could not be right. It read as a
          // coverage claim while asserting nothing. The denominator has to come
          // from `eval_on`, which is the set the driver actually scores over.
          const scoredWith = round.scored_with_basis === 'site' ? round.scored_with : null;
          const digests = scoredWith ? Object.values(scoredWith) : [];
          const agreedDigest =
            digests.length > 0 && digests.every((d) => d === digests[0]) ? digests[0] : null;
          const evalCount = round.eval_on !== null ? round.eval_on.length : null;
          // Both counts are site counts here, so this comparison is in one
          // space and both directions mean something. More digests than
          // evaluating sites is a contradiction rather than a coverage gap: it
          // cannot come from the driver, which builds the map over `eval_on`,
          // so it says the record was assembled wrong and nothing in it can be
          // read as coverage.
          const provenanceContradicts = evalCount !== null && digests.length > evalCount;
          const provenanceUnkeyed = round.scored_with !== null && scoredWith === null;
          // Same decision the chart makes, from the same function, so the two
          // surfaces cannot disagree about whether a round's pooled figure is
          // publishable.
          const disposition = aggregateDisposition(
            round,
            record.policy?.aggregate_min_scoring_sites ?? null
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
                {agreedDigest && !provenanceContradicts && (
                  <>
                    {' '}
                    {evalCount === null
                      ? `${digests.length} ${digests.length === 1 ? 'site' : 'sites'} scored on`
                      : digests.length === evalCount
                      ? `All ${digests.length} scored on`
                      : `${digests.length} of ${evalCount} scored on`}{' '}
                    <code className="rounded bg-gray-100 px-1 text-xs text-gray-600">
                      {agreedDigest.slice(0, 8)}
                    </code>
                    .
                  </>
                )}
                {/* The two ways the provenance sentence can be unsupported. Both
                    are marked rather than dropped, because the sentence is
                    optional per round already, so its silent absence carries no
                    information and a reader cannot tell a round that reported no
                    digest from a round whose digest this page would not stand
                    behind. */}
                {provenanceContradicts && (
                  <> The digest count does not match the evaluating set, so provenance is not
                    shown for this round.</>
                )}
                {provenanceUnkeyed && (
                  <> Digests were reported without recording that they belong to sites, so they
                    are not counted as sites here.</>
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

const SynchronousScreen: React.FC<{ record: CampaignRecord; progress: SyncProgress }> = ({
  record,
  progress,
}) => (
  <>
    <div className="mt-6 rounded-2xl border border-gray-200 bg-white/80 p-6 shadow-sm">
      <RoundBar progress={progress} />
      {/* Three tiles, not four. "Weights out" moved into the headline above,
          and repeating it here would make one measurement look like two. */}
      <dl className="mt-5 grid grid-cols-2 gap-4 text-sm sm:grid-cols-3">
        <div>
          <dt className="text-xs uppercase tracking-wide text-gray-500">Sites reporting</dt>
          <dd className="mt-0.5 font-medium tabular-nums text-gray-800">
            <Value>
              {formatCount(progress.sites.filter((s) => s.activity !== 'pending_review').length)}
            </Value>
          </dd>
        </div>
        <div>
          <dt className="text-xs uppercase tracking-wide text-gray-500">Rounds recorded</dt>
          <dd className="mt-0.5 font-medium tabular-nums text-gray-800">
            <Value>{formatCount(progress.rounds.length)}</Value>
          </dd>
        </div>
        <div>
          <dt className="text-xs uppercase tracking-wide text-gray-500">Image data moved</dt>
          <dd className="mt-0.5 font-medium tabular-nums text-gray-800">
            <Value>{formatBytes(record.transport?.images_moved_bytes)}</Value>
          </dd>
        </div>
      </dl>
    </div>

    <Section
      title="The transport audit"
      subtitle="What the campaign's own transport log recorded, kept separate from what was worked out from it."
    >
      <TransportAudit
        transport={record.transport}
        payload={record.payload}
        mode="synchronous"
      />
    </Section>

    <Section title="Scores by round">
      {outcomesReleased(record) ? (
        <RoundChart
          rounds={progress.rounds}
          sites={progress.sites}
          minScoringSites={record.policy?.aggregate_min_scoring_sites ?? null}
        />
      ) : (
        <p className="text-sm leading-relaxed text-gray-600">
          No scores are published for this campaign yet. A score taken from a round still in flight
          is a partial observation, and once it is next to another site&rsquo;s it reads as a
          comparison between datasets rather than between methods. Scores appear here after this
          campaign&rsquo;s primary-metric rules resolve. Everything above stays live in the
          meantime.
        </p>
      )}
    </Section>

    <Section title="Round log">
      <RoundLog record={record} progress={progress} showMetric={outcomesReleased(record)} />
    </Section>

    <Section title="Sites">
      <SiteRoster sites={progress.sites} rosterAttested={record.policy?.roster_attested} />
    </Section>
  </>
);

const AsynchronousScreen: React.FC<{ record: CampaignRecord; progress: AsyncProgress }> = ({
  record,
  progress,
}) => {
  const pending = progress.contributions.filter((c) => c.disposition === 'pending').length;
  // A campaign-wide count, deliberately not a per-contributor one. The total
  // tells a reader how selective the gate is, which is a property of the
  // campaign. The same number broken out by contributor would be a ranking of
  // whose work gets taken, which this page does not publish in any form.
  const notTaken = progress.contributions.filter((c) => c.disposition === 'excluded').length;
  const latest = progress.soups.reduce<typeof progress.soups[number] | null>(
    (best, s) => (best === null || s.index > best.index ? s : best),
    null
  );
  // Only a scheduled trigger can name a date. See ContributionStream for why a
  // countdown under the other two kinds would be the page's guess.
  const nextMerge =
    progress.merge_trigger?.kind === 'scheduled' ? progress.merge_trigger.next_merge_at : null;

  return (
    <>
      <div className="mt-6 rounded-2xl border border-gray-200 bg-white/80 p-6 shadow-sm">
        {/* No progress bar. There is no total to be a fraction of: an open
            campaign runs for as long as people keep contributing, so a bar
            would have to invent a finish line. */}
        <dl className="grid grid-cols-2 gap-4 text-sm sm:grid-cols-4">
          <div>
            <dt className="text-xs uppercase tracking-wide text-gray-500">Contributors</dt>
            <dd className="mt-0.5 font-medium tabular-nums text-gray-800">
              <Value>{formatCount(progress.contributors.length)}</Value>
            </dd>
          </div>
          <div>
            <dt className="text-xs uppercase tracking-wide text-gray-500">Contributions</dt>
            <dd className="mt-0.5 font-medium tabular-nums text-gray-800">
              <Value>{formatCount(progress.contributions.length)}</Value>
            </dd>
            {pending > 0 && (
              <dd className="mt-0.5 text-xs text-gray-500">
                {pending === 1
                  ? '1 waiting for the next merge'
                  : `${pending} waiting for the next merge`}
              </dd>
            )}
            {notTaken > 0 && (
              <dd className="mt-0.5 text-xs text-gray-500">
                {notTaken === 1
                  ? '1 assessed and not included'
                  : `${notTaken} assessed and not included`}
              </dd>
            )}
          </div>
          <div>
            <dt className="text-xs uppercase tracking-wide text-gray-500">Community versions</dt>
            <dd className="mt-0.5 font-medium tabular-nums text-gray-800">
              <Value>{formatCount(progress.soups.length)}</Value>
            </dd>
            {latest?.community_model?.version && (
              <dd className="mt-0.5 text-xs text-gray-500">
                Latest is {latest.community_model.version}
              </dd>
            )}
          </div>
          <div>
            <dt className="text-xs uppercase tracking-wide text-gray-500">Image data moved</dt>
            <dd className="mt-0.5 font-medium tabular-nums text-gray-800">
              <Value>{formatBytes(record.transport?.images_moved_bytes)}</Value>
            </dd>
          </div>
        </dl>
        {nextMerge && (
          <p className="mt-4 text-sm text-gray-600">
            The next merge is scheduled for {formatDate(nextMerge)}. Anything that arrives before
            then is assessed for it.
          </p>
        )}
        {progress.merge_trigger?.kind === 'on_contributions' &&
          progress.merge_trigger.contributions_per_merge !== null && (
            <p className="mt-4 text-sm text-gray-600">
              A merge runs every {formatCount(progress.merge_trigger.contributions_per_merge)}{' '}
              contributions. When that happens depends on when contributors finish their runs, so
              there is no date to give.
            </p>
          )}
        {progress.merge_trigger?.kind === 'manual' && (
          <p className="mt-4 text-sm text-gray-600">
            Merges are run by the campaign stewards rather than on a schedule, so there is no next
            date to show.
          </p>
        )}
        {/* The fourth case, which used to render nothing at all.

            Silence was defensible while an unstated trigger meant a campaign
            whose steward had not configured one. It stopped being defensible
            on 12 Sep 2026, when the flagship async campaign moved to this
            state deliberately: its merges are driven by something the wire
            cannot yet describe, so it reports no trigger rather than claim the
            nearest member of a union that does not contain the truth.

            A reader looking at evenly-ish spaced merge markers with no
            explanation will supply one, and the one they will supply is a
            schedule. That is the claim this field was just corrected to stop
            making, so leaving the gap unnamed would reinstate it by
            implication. Naming the gap costs a sentence.

            It says what the RECORD does not contain, and deliberately nothing
            about what is actually driving the merges. The page depicts that
            when the field carries it, not before. */}
        {!progress.merge_trigger?.kind && (
          <p className="mt-4 text-sm text-gray-600">
            This record does not say what decides when a merge runs, so there is no next date to
            show and nothing here should be read as a schedule.
          </p>
        )}
      </div>

      <Section
        title="Contributions and merges"
        subtitle="Every contribution on the date it arrived, and every merge that ran, whether or not it published a version."
      >
        <ContributionStream
          contributions={progress.contributions}
          soups={progress.soups}
          emptyMerges={progress.empty_merges}
          contributors={progress.contributors}
          mergeTrigger={progress.merge_trigger}
          startedAt={progress.started_at}
        />
      </Section>

      <Section
        title="The community model"
        subtitle="One immutable version per merge that published one, so an earlier community model stays available."
      >
        <SoupLineage
          soups={progress.soups}
          minScoringSites={record.policy?.aggregate_min_scoring_sites ?? null}
          showMetric={outcomesReleased(record)}
          baselineMetric={progress.baseline_metric}
          // The base model's name, so the reference level says what it is a
          // level of. Null when the campaign did not report a base model, and
          // the chart falls back to a generic label rather than inventing one:
          // this page has been wrong once already by reading a null
          // `base_model` as "trained from scratch".
          baselineModel={record.base_model}
        />
      </Section>

      <Section
        title="The transport audit"
        subtitle="What the campaign's own transport log recorded, kept separate from what was worked out from it."
      >
        <TransportAudit
          transport={record.transport}
          payload={record.payload}
          mode="asynchronous"
        />
      </Section>

      <Section title="Contributors">
        <ContributorRoster
          contributors={progress.contributors}
          rosterAttested={record.policy?.roster_attested}
        />
      </Section>
    </>
  );
};

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
        <svg
          className="h-4 w-4"
          data-icon="chevron-left"
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
        >
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
        </svg>
        Back to campaign
      </Link>

      <header className="mt-4">
        <h1 className="text-3xl font-bold tracking-tight text-gray-900">{data.title}</h1>
        <p className="mt-1 text-sm text-gray-500">Progress and transport audit</p>
      </header>

      <TransportHeadline
        transport={data.transport}
        payload={data.payload}
        mode={data.progress.mode}
      />

      {data.progress.mode === 'synchronous' ? (
        <SynchronousScreen record={data} progress={data.progress} />
      ) : (
        <AsynchronousScreen record={data} progress={data.progress} />
      )}
    </div>
  );
};

export default CampaignProgress;
