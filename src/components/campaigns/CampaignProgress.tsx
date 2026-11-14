import React from 'react';
import { Link, useParams } from 'react-router-dom';
import { useCampaign } from '../../hooks/useCampaign';
import { CampaignRecord, CampaignProgressRecord, CampaignStatus } from '../../types/campaign';
import { CampaignEmptyState, CampaignErrorState, CampaignLoading } from './CampaignStates';
import ContributionStream from './ContributionStream';
import ContributorRoster from './ContributorRoster';
import PrototypeBanner from './PrototypeBanner';
import SoupLineage from './SoupLineage';
import TransportAudit from './TransportAudit';
import TransportHeadline from './TransportHeadline';
import { outcomesReleased } from './disclosure';
import { formatBytes, formatCount, formatDate } from './format';
import { describeMergeActor, resolveMergeActor } from './mergeProvenance';
import { Value } from './MissingValue';

/**
 * Live progress for one campaign.
 *
 * ONE SCREEN, and it used to be two. Through 0.13.0-draft this file also
 * carried a synchronous screen: a round bar, a round log, a per-round score
 * chart and a site roster. The synchronous arm left the contract at
 * 0.14.0-draft when the campaign programme narrowed to foundation models, and
 * the screen went with it rather than being kept as dead code behind a
 * discriminant that can only take one value.
 *
 * `AsyncProgress` is still extracted from the union rather than being written
 * out inline. The union has one member today and the extraction is a no-op, but
 * it is the seam a second mode would arrive through, and inlining the shape
 * here is what would make that arrival a rewrite instead of an addition.
 *
 * What is live here is PROCESS: the roster growing, bytes crossing the network,
 * merges landing, the digests each participant scored on. Accuracy is gated on
 * `disclosure.ts` and released per campaign.
 *
 * One deliberate asymmetry in that gate. A soup's score is attached to an
 * IMMUTABLE published checkpoint, so it is a model-card figure that the
 * campaign continuing cannot revise, which is why an open campaign can release
 * version scores while still running. Per-contributor curves stay withheld.
 */

type AsyncProgress = Extract<CampaignProgressRecord, { mode: 'asynchronous' }>;

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

/**
 * Says that a zero is a starting state rather than a result.
 *
 * `formatCount(0)` returns "0", which is a perfectly good string, so `Value`
 * renders it and `MissingValue` never fires. That is correct: nothing is
 * missing. The problem is what the reader does with it. A campaign that has not
 * started and a campaign that ran and took nothing both render "0
 * contributions, 0 community versions", and those are opposite claims. The
 * second is a real and fairly damning result about the selection gate. The
 * first is the gate never having been asked a question.
 *
 * `status` already tells them apart and until now the page spent it only on a
 * chip, a colour, and the join button. An 'open' campaign has not begun, so its
 * zeros are the starting state. A 'completed' one with no versions HAS run and
 * published none, which is a finding and deliberately gets no reassuring note
 * here: the asymmetry is the point.
 *
 * Gated on emptiness as well as status so it disappears the moment anything
 * arrives, rather than lingering on a campaign that is open and already moving.
 */
const NotStartedNote: React.FC<{ status: CampaignStatus; empty: boolean }> = ({
  status,
  empty,
}) => {
  if (status !== 'open' || !empty) return null;
  return (
    <p
      className="mb-4 rounded-xl border border-gray-200 bg-gray-50 px-4 py-2 text-sm text-gray-600"
      data-testid="not-started-note"
    >
      This campaign is open and has not started. The figures below are its starting state, not a
      result.
    </p>
  );
};

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
  // WHO runs the merges, resolved separately from WHAT RULE fires them, because
  // the record states them separately and either can be known without the other.
  // This campaign is the case that motivated the split: the actor is known and
  // the rule is not.
  const mergeActor = describeMergeActor(resolveMergeActor(progress.merge_trigger));

  return (
    <>
      <div className="mt-6 rounded-2xl border border-gray-200 bg-white/80 p-6 shadow-sm">
        <NotStartedNote
          status={record.status}
          empty={progress.contributions.length === 0 && progress.soups.length === 0}
        />
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
        {/* Rule only, no longer "by the campaign stewards". Who runs a merge is
            `decided_by` now, and saying it here as well would have produced two
            sentences making overlapping claims from one field each, with no way
            for a reader to tell they came from different facts. */}
        {progress.merge_trigger?.kind === 'manual' && (
          <p className="mt-4 text-sm text-gray-600">
            Merges run on demand rather than on a schedule, so there is no next date to show.
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
        {/* Narrowed from "what decides when a merge runs" to the RULE alone, on
            12 Sep 2026. The old wording was written when `kind` was the only
            trigger field, so an unstated kind really did mean the record said
            nothing. It says something now: this campaign states an actor and no
            rule, and the old sentence would have denied the half that is known. */}
        {!progress.merge_trigger?.kind && (
          <p className="mt-4 text-sm text-gray-600">
            This record does not state a rule for when a merge fires, so there is no next date to
            show and nothing here should be read as a schedule.
          </p>
        )}
        {/* Who, after what. The actor is the smaller claim and the rule is what a
            reader is looking for when they ask about the next merge, so the rule
            branches keep the position they had. */}
        {mergeActor && <p className="mt-3 text-sm text-gray-600">{mergeActor}</p>}
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

      <AsynchronousScreen record={data} progress={data.progress} />
    </div>
  );
};

export default CampaignProgress;
