import React, { useMemo } from 'react';
import { RoundRecord, SiteRecord } from '../../types/campaign';
import {
  DispositionTally,
  aggregateDisposition,
  emptyTally,
  tally as tallyInto,
} from './aggregateDisposition';
import { formatMetric } from './format';

/**
 * The metric curve over rounds.
 *
 * Plots against the reported round NUMBER rather than the array index, because
 * reporting into the campaign service is fire-and-forget and a service outage
 * costs round records without costing the run. A gap in the series is a gap in
 * what was reported, and drawing it as one is the honest rendering.
 *
 * Per-site curves are drawn only when the campaign publishes them. Most
 * campaigns publish the aggregate alone, and this component treats that as the
 * normal case rather than as missing data.
 *
 * The aggregate is withheld for any round where the per-site map is PARTIAL.
 * With few sites, an aggregate plus n-1 per-site values reconstructs the nth,
 * so publishing both halves of a partial round leaks exactly the value that
 * withholding per-site curves exists to protect. Publishing all of them or none
 * of them is safe; publishing most of them is not.
 *
 * Every round with no plotted point is accounted for under the chart, and the
 * three ways that happens are kept apart: the campaign withheld and said why,
 * the page refused to render one the campaign published, or the score is not in
 * the record at all. See `aggregateDisposition.ts` for why that third case
 * needed a branch of its own.
 */

const SERIES_COLOURS = ['#2563eb', '#7c3aed', '#0891b2', '#c2410c', '#059669', '#be185d'];
const AGGREGATE_COLOUR = '#111827';

const VIEW_W = 720;
const VIEW_H = 260;
const PAD_L = 48;
const PAD_R = 16;
const PAD_T = 16;
const PAD_B = 32;

interface Series {
  key: string;
  label: string;
  colour: string;
  points: Array<{ round: number; value: number }>;
  dashed: boolean;
}

const countPhrase = (n: number) => (n === 1 ? '1 round' : `${n} rounds`);
const has = (n: number) => (n === 1 ? 'has' : 'have');
const publishes = (n: number) => (n === 1 ? 'publishes' : 'publish');
const reports = (n: number) => (n === 1 ? 'reports' : 'report');

/**
 * One sentence per reason a round is not on the chart.
 *
 * Rendered even when the chart itself has no points, because a campaign whose
 * every round was withheld is not a campaign that never scored anything, and
 * the empty state says the second. Returning early on an empty series would
 * reinstate the silence this whole path exists to remove.
 *
 * Campaign decisions and page refusals are separated on screen and not only in
 * the data. A withhold is the system working. A refusal means the record
 * carries a figure its own stated format says it should not, which is a defect
 * a reader can act on, and merging the two would bury it.
 *
 * A third group sits between them: the record is correct, the format permits
 * exactly what it did, and this page still cannot verify the figure. Only the
 * refusals get the amber, because only they accuse anyone. Putting a permitted
 * record under that heading accuses a producer of a breach they did not commit,
 * and unlike a withhold or a refusal there is nothing they could do about it,
 * since the shape being objected to is the correct one.
 */
const DispositionNotes: React.FC<{ tally: DispositionTally }> = ({ tally }) => {
  const withheld: string[] = [];
  if (tally.service.partial_map > 0) {
    const n = tally.service.partial_map;
    withheld.push(
      `${countPhrase(n)} ${has(n)} no combined score. Only some sites published a curve, so the combined figure is held back with them, because publishing both would let the rest be worked back out.`
    );
  }
  if (tally.service.completeness_unknown > 0) {
    const n = tally.service.completeness_unknown;
    withheld.push(
      `${countPhrase(n)} ${has(n)} no combined score. The campaign could not confirm that every scoring site had reported, so it could not rule out that a combined figure would fill in a missing one.`
    );
  }
  if (tally.service.below_scoring_floor > 0) {
    const n = tally.service.below_scoring_floor;
    withheld.push(
      `${countPhrase(n)} ${has(n)} no combined score. Fewer sites returned a score than the campaign publishes a combined figure over. Across very few sites a combined figure is close to one site's own result under a shared label.`
    );
  }
  if (tally.service.floor_unknown > 0) {
    const n = tally.service.floor_unknown;
    withheld.push(
      `${countPhrase(n)} ${has(n)} no combined score. The campaign did not record how many scoring sites it requires before publishing one, so that condition could not be shown to have been met.`
    );
  }

  const refused: string[] = [];
  if (tally.page.contradictory_withhold > 0) {
    const n = tally.page.contradictory_withhold;
    refused.push(
      `${countPhrase(n)} ${reports(n)} both a combined score and a reason for there being none.`
    );
  }
  // "per-unit" rather than "per-site" in both of these. Since 0.7.0 either can
  // fire on a dataset-keyed map, counted against the datasets that scored, and
  // saying "site" would name a key space the record did not declare. That is
  // the same mistake this block was split apart to stop making.
  if (tally.page.partial_map > 0) {
    const n = tally.page.partial_map;
    refused.push(
      `${countPhrase(n)} ${publishes(n)} a combined score next to a partial set of per-unit curves, which would let the missing values be worked back out.`
    );
  }
  if (tally.page.map_exceeds_count > 0) {
    const n = tally.page.map_exceeds_count;
    refused.push(
      `${countPhrase(n)} ${publishes(n)} more per-unit scores than the number of units it records as having scored, so the two cannot both be counting the same thing.`
    );
  }
  if (tally.page.count_key_space_mismatch > 0) {
    const n = tally.page.count_key_space_mismatch;
    refused.push(
      `${countPhrase(n)} ${reports(n)} a count of datasets scored on a round whose per-unit scores are not keyed by dataset, so the record has not settled what it is counting.`
    );
  }
  if (tally.page.completeness_unknown > 0) {
    const n = tally.page.completeness_unknown;
    refused.push(
      `${countPhrase(n)} ${publishes(n)} a combined score without saying how many sites were scored, which is both the number the score is an average of and the number the campaign's own threshold is checked against.`
    );
  }
  if (tally.page.scoring_exceeds_eval_set > 0) {
    const n = tally.page.scoring_exceeds_eval_set;
    refused.push(
      `${countPhrase(n)} ${publishes(n)} more scoring sites than the record says were asked to evaluate, so the round disagrees with itself about how many results the combined score is drawn from.`
    );
  }
  if (tally.page.below_scoring_floor > 0) {
    const n = tally.page.below_scoring_floor;
    refused.push(
      `${countPhrase(n)} ${publishes(n)} a combined score over fewer scoring sites than the campaign's own threshold allows.`
    );
  }
  if (tally.page.floor_unstated > 0) {
    const n = tally.page.floor_unstated;
    refused.push(
      `${countPhrase(n)} ${publishes(n)} a combined score, but the campaign records no threshold for how many scoring sites one requires.`
    );
  }
  // Worth a sentence of its own rather than folding into a generic "malformed",
  // because the reader's question here is why a score the campaign published is
  // missing, and the answer is specific: the record gave two incompatible
  // accounts of where its own number came from. The copy names both accounts
  // and takes neither side, which is the only honest thing to say about a
  // record that has not settled the question itself.
  if (tally.page.holdout_scope_with_per_site_map > 0) {
    const n = tally.page.holdout_scope_with_per_site_map;
    refused.push(
      `${countPhrase(n)} ${reports(n)} a combined score as one central measurement on the campaign's own data, and also publishes per-unit scores from the participants, so the record does not say which of the two the figure is.`
    );
  }

  // Separate from `refused` and rendered without the amber, because the amber
  // block ends by telling the reader the record does not match its own declared
  // format. That is true of everything in `refused` and false of this: a
  // non-site key space is a value the format added a field for, so publishing
  // one is conformance, not breach. A pooled arm is one site scoring several
  // datasets and its map is dataset-keyed permanently, so under the old
  // grouping the page called a correct and unchangeable record broken every
  // time it drew that campaign.
  //
  // Since 0.7.0 a dataset-keyed round can carry its own count and is checked
  // like any other, so the first sentence below now describes records written
  // before that field existed. The block stays: the count cannot be
  // backfilled into the completed run, and this group is where a record that
  // conformed to the format of its day belongs.
  const unrenderable: string[] = [];
  if (tally.unrenderable.per_site_not_site_keyed > 0) {
    const n = tally.unrenderable.per_site_not_site_keyed;
    unrenderable.push(
      `${countPhrase(n)} ${publishes(n)} a combined score beside per-unit scores that are not keyed by site, and records no count in the units those scores use. The campaign format allows that and the record is not at fault: it predates the field that carries the count. This page holds the combined figure back anyway, because the set cannot be shown to be complete without a count in its own units, and a combined figure beside an incomplete set would let the missing entries be worked back out.`
    );
  }
  if (tally.unrenderable.per_site_basis_unstated > 0) {
    const n = tally.unrenderable.per_site_basis_unstated;
    unrenderable.push(
      `${countPhrase(n)} ${publishes(n)} a combined score beside per-unit scores without recording what the units are. Saying nothing is a permitted answer and the record is not at fault. This page holds the combined figure back anyway, because it cannot tell what the combined figure would fill in without knowing what the set is a set of.`
    );
  }

  if (
    withheld.length === 0 &&
    refused.length === 0 &&
    unrenderable.length === 0 &&
    tally.absent === 0
  )
    return null;

  return (
    <>
      {withheld.map((sentence) => (
        <p key={sentence} className="mt-3 text-xs text-gray-500">
          {sentence}
        </p>
      ))}
      {refused.length > 0 && (
        <div className="mt-3 rounded border border-amber-200 bg-amber-50 px-3 py-2">
          <p className="text-xs font-medium text-amber-900">
            This page is holding back figures the campaign did publish.
          </p>
          {refused.map((sentence) => (
            <p key={sentence} className="mt-1 text-xs text-amber-900">
              {sentence}
            </p>
          ))}
          <p className="mt-1 text-xs text-amber-800">
            Each of those is a rule the campaign itself declared and its own record then broke,
            either by contradicting itself or by publishing a figure it said it would hold back.
            The figures are held back rather than shown with a note, because a caveat does not undo
            a value a reader has already seen.
          </p>
        </div>
      )}
      {unrenderable.map((sentence) => (
        <p key={sentence} className="mt-3 text-xs text-gray-500">
          {sentence}
        </p>
      ))}
      {tally.absent > 0 && (
        <p className="mt-3 text-xs text-gray-500">
          {countPhrase(tally.absent)} {has(tally.absent)} no combined score and no reason recorded
          for its absence. There is no way to tell from the record whether it was held back or never
          worked out, so this page does not describe it as either.
        </p>
      )}
    </>
  );
};

/**
 * What is wrong with the per-site maps, independent of the aggregate.
 *
 * A component rather than three inline blocks because these have to render in
 * both the plotted and the empty branch. The over-long case draws no curves at
 * all, so a campaign where every round is over-long reaches the empty state,
 * and an empty state is exactly where a dropped map is easiest to read as
 * nothing having been collected.
 */
const PerSiteNotes: React.FC<{
  short: number;
  unknown: number;
  unattributable: number;
  basisUnstated: number;
  notSiteKeyed: number;
}> = ({ short, unknown, unattributable, basisUnstated, notSiteKeyed }) => (
  <>
    {basisUnstated > 0 && (
      <p className="mt-3 text-xs text-gray-500">
        {countPhrase(basisUnstated)} {publishes(basisUnstated)} a score per unit without recording
        what those units are, so this page cannot say whether each one is a site and does not label
        them as though it could.
      </p>
    )}
    {notSiteKeyed > 0 && (
      <p className="mt-3 text-xs text-gray-500">
        {countPhrase(notSiteKeyed)} {publishes(notSiteKeyed)} scores keyed by something other than
        site, so they are not drawn on a chart whose lines stand for sites.
      </p>
    )}
    {short > 0 && (
      <p className="mt-3 text-xs text-gray-500">
        {countPhrase(short)} {has(short)} curves from fewer sites than scored that round, so the
        lines above are not every site that took part.
      </p>
    )}
    {unknown > 0 && (
      <p className="mt-3 text-xs text-gray-500">
        {countPhrase(unknown)} {publishes(unknown)} per-site curves without saying how many sites
        scored, so a complete set cannot be told from a partial one.
      </p>
    )}
    {unattributable > 0 && (
      <p className="mt-3 text-xs text-gray-500">
        {countPhrase(unattributable)} {reports(unattributable)} more per-site scores than sites
        recorded as scoring, so those scores are not one per site and cannot be attributed to one.
        Their curves are left off the chart rather than drawn under a guessed label.
      </p>
    )}
  </>
);

interface RoundChartProps {
  rounds: RoundRecord[];
  sites: SiteRecord[];
  /**
   * From `policy.aggregate_min_scoring_sites`. Undefined and null both mean the
   * floor was not stated, which withholds rather than passes: an unstated floor
   * is not a met one, and the page does not supply a value of its own.
   */
  minScoringSites?: number | null;
}

const RoundChart: React.FC<RoundChartProps> = ({ rounds, sites, minScoringSites = null }) => {
  const scored = useMemo(() => rounds.filter((r) => r.metric !== null), [rounds]);

  const {
    series,
    metricName,
    metricBasis,
    shortPerSite,
    unknownPerSite,
    unattributablePerSite,
    basisUnstatedPerSite,
    notSiteKeyedPerSite,
    tally,
    xMin,
    xMax,
    yMin,
    yMax,
  } = useMemo(() => {
    const siteNames = new Map(sites.map((s) => [s.site_id, s.site_name]));
    const tallied = emptyTally();
    const aggregate: Series = {
      key: '__aggregate__',
      label: 'All sites',
      colour: AGGREGATE_COLOUR,
      points: [],
      dashed: false,
    };
    const perSite = new Map<string, Series>();
    let shortPerSite = 0;
    let unknownPerSite = 0;
    let unattributablePerSite = 0;
    let basisUnstatedPerSite = 0;
    let notSiteKeyedPerSite = 0;

    scored.forEach((round) => {
      const metric = round.metric!;
      // Every outcome, including "no aggregate was reported", is named and
      // counted. The decision itself lives in aggregateDisposition so it can be
      // checked without rendering anything: a wrong gate here draws a curve
      // that looks exactly like a right one, just with more points on it.
      const disposition = aggregateDisposition(round, minScoringSites);
      tallyInto(tallied, disposition);
      if (disposition.plot) {
        aggregate.points.push({ round: round.round, value: disposition.value });
      }
      // The per-site map's completeness is a property of the per-site map, and
      // it was only ever being reported as a by-product of reasoning about the
      // aggregate. When a round carries a short map and no aggregate at all,
      // every aggregate note stays silent and the chart draws the sites that
      // did report as though they were the whole set. Same rule as the log
      // fix: the statement belongs on the value's own exit path, not on
      // whichever sibling happened to need it first.
      // Curves are drawn only when the record SAYS the map is site-keyed.
      //
      // `siteNames.get(key) ?? key` cannot be made safe by inspection. In the
      // launch consortium every dataset name is also a client name, so a
      // dataset-keyed map resolves cleanly against the roster and renders as
      // labelled site curves with nothing anywhere reporting a problem. A check
      // that passes by naming coincidence is worse than no check, because it
      // passes and nobody looks again.
      //
      // So the key space is taken from the record or the curves are not drawn.
      // This replaces an over-long gate that inferred the key space from a
      // cardinality comparison against a count of sites, which rejected the
      // pooled arm of the current layout: six datasets scored at one site is a
      // correct round, and reading it as a malformed site map was the same
      // wrong-space mistake in a different coat.
      if (metric.per_site !== null && metric.per_site_basis === null) {
        basisUnstatedPerSite += 1;
      } else if (metric.per_site !== null && metric.per_site_basis !== 'site') {
        notSiteKeyedPerSite += 1;
      }
      const overlong =
        metric.per_site !== null &&
        metric.per_site_basis === 'site' &&
        metric.n_sites_scored !== null &&
        Object.keys(metric.per_site).length > metric.n_sites_scored;
      if (overlong) unattributablePerSite += 1;
      if (metric.per_site && metric.per_site_basis === 'site' && !overlong) {
        if (metric.n_sites_scored === null) unknownPerSite += 1;
        else if (Object.keys(metric.per_site).length < metric.n_sites_scored) shortPerSite += 1;
        Object.entries(metric.per_site).forEach(([siteId, value]) => {
          let s = perSite.get(siteId);
          if (!s) {
            s = {
              key: siteId,
              label: siteNames.get(siteId) ?? siteId,
              colour: SERIES_COLOURS[perSite.size % SERIES_COLOURS.length],
              points: [],
              dashed: true,
            };
            perSite.set(siteId, s);
          }
          s.points.push({ round: round.round, value });
        });
      }
    });

    const all: Series[] = [
      ...(aggregate.points.length > 0 ? [aggregate] : []),
      ...Array.from(perSite.values()),
    ];
    const values = all.flatMap((s) => s.points.map((p) => p.value));
    const roundNumbers = all.flatMap((s) => s.points.map((p) => p.round));
    const lo = values.length > 0 ? Math.min(...values) : 0;
    const hi = values.length > 0 ? Math.max(...values) : 1;
    const span = hi - lo || 1;

    return {
      series: all,
      metricName: scored[0]?.metric?.name ?? null,
      // Null unless a combined curve actually rendered. The sentence this feeds
      // is present tense about a line on the chart, so when every aggregate is
      // withheld it describes a curve that is not there. That is the same
      // defect as the log one, shrunk to a caption: the disposition gated the
      // value and nothing gated the sentence about the value, and a caption
      // outliving its subject asserts the subject exists.
      metricBasis:
        aggregate.points.length > 0
          ? scored.find((r) => r.metric?.aggregate_basis)?.metric?.aggregate_basis ?? null
          : null,
      tally: tallied,
      shortPerSite,
      unknownPerSite,
      unattributablePerSite,
      basisUnstatedPerSite,
      notSiteKeyedPerSite,
      xMin: roundNumbers.length > 0 ? Math.min(...roundNumbers) : 0,
      xMax: roundNumbers.length > 0 ? Math.max(...roundNumbers) : 1,
      yMin: Math.max(0, lo - span * 0.15),
      yMax: hi + span * 0.15,
    };
  }, [scored, sites, minScoringSites]);

  if (series.length === 0) {
    // "Nothing reported" and "everything held back" are different claims, and
    // the first one is wrong whenever any round produced a reason. The notes
    // render here too, otherwise a fully withheld campaign reads as a campaign
    // that never scored anything.
    const anyAccounted =
      tally.absent > 0 ||
      Object.values(tally.service).some((n) => n > 0) ||
      Object.values(tally.page).some((n) => n > 0);
    return (
      <div>
        {!anyAccounted && (
          <p className="text-sm text-gray-500">
            No scores have been reported for this campaign yet. Accuracy is published after a
            campaign completes, so a run in progress may show none.
          </p>
        )}
        {anyAccounted && (
          <p className="text-sm text-gray-500">
            No round in this campaign has a combined score to plot.
          </p>
        )}
        <DispositionNotes tally={tally} />
        <PerSiteNotes
          short={shortPerSite}
          unknown={unknownPerSite}
          unattributable={unattributablePerSite}
          basisUnstated={basisUnstatedPerSite}
          notSiteKeyed={notSiteKeyedPerSite}
        />
      </div>
    );
  }

  const x = (round: number) =>
    PAD_L + ((round - xMin) / (xMax - xMin || 1)) * (VIEW_W - PAD_L - PAD_R);
  const y = (value: number) =>
    VIEW_H - PAD_B - ((value - yMin) / (yMax - yMin || 1)) * (VIEW_H - PAD_T - PAD_B);

  const path = (points: Series['points']) =>
    points.map((p, i) => `${i === 0 ? 'M' : 'L'}${x(p.round).toFixed(1)} ${y(p.value).toFixed(1)}`).join(' ');

  const yTicks = [yMin, (yMin + yMax) / 2, yMax];

  return (
    <div>
      {metricName && (
        <p className="mb-2 text-xs font-medium uppercase tracking-wide text-gray-500">
          {metricName}
        </p>
      )}
      <svg
        viewBox={`0 0 ${VIEW_W} ${VIEW_H}`}
        className="w-full"
        data-icon="chart-round-metric"
        role="img"
        aria-label={`${metricName ?? 'Metric'} by round`}
      >
        {yTicks.map((tick) => (
          <g key={tick}>
            <line
              x1={PAD_L}
              x2={VIEW_W - PAD_R}
              y1={y(tick)}
              y2={y(tick)}
              stroke="#e5e7eb"
              strokeWidth={1}
            />
            <text x={PAD_L - 8} y={y(tick) + 4} textAnchor="end" fontSize={11} fill="#6b7280">
              {formatMetric(tick)}
            </text>
          </g>
        ))}
        <text x={PAD_L} y={VIEW_H - 8} fontSize={11} fill="#6b7280">
          Round {xMin}
        </text>
        <text x={VIEW_W - PAD_R} y={VIEW_H - 8} fontSize={11} fill="#6b7280" textAnchor="end">
          Round {xMax}
        </text>
        {series.map((s) => (
          <path
            key={s.key}
            d={path(s.points)}
            fill="none"
            stroke={s.colour}
            strokeWidth={s.key === '__aggregate__' ? 2.5 : 1.5}
            strokeDasharray={s.dashed ? '4 3' : undefined}
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        ))}
      </svg>
      <div className="mt-3 flex flex-wrap gap-x-5 gap-y-2">
        {series.map((s) => (
          <span key={s.key} className="inline-flex items-center gap-2 text-xs text-gray-600">
            <span
              className="inline-block h-0.5 w-5 rounded"
              style={{ backgroundColor: s.colour }}
            />
            {s.label}
          </span>
        ))}
      </div>
      <PerSiteNotes
        short={shortPerSite}
        unknown={unknownPerSite}
        unattributable={unattributablePerSite}
        basisUnstated={basisUnstatedPerSite}
        notSiteKeyed={notSiteKeyedPerSite}
      />
      {metricBasis && (
        <p className="mt-3 text-xs text-gray-500">
          The combined curve is a {metricBasis}. There is no single pooled figure in the training
          record, so this one is worked out from the per-dataset scores and is named here rather
          than presented as a measurement.
        </p>
      )}
      {/* This used to say per-site curves are kept within the campaign, and to
          explain why that is a reasonable thing for a campaign to do. Both
          halves were the page's, not the record's. `per_site` is a bare
          nullable field with no cause attached, so a null one is an absence,
          and describing an absence as a decision invents an actor: it points a
          reader at a policy to go and read that may never have existed.

          The argument in the old sentence is probably right, which is what made
          it hard to see. A justification the record does not carry is still the
          page's own, and a good one reads as more authoritative, not less.

          This is the aggregate fix again on a neighbouring field. Carrying the
          rule across surfaces for `aggregate` and never across fields is the
          same boundary error one more time, and this instance sat three lines
          below the one I had just closed. */}
      {/* `unattributablePerSite` gates this too, because an over-long map is
          dropped before it reaches `perSite`, so the chart looks identical to
          one that never had per-site data. "No per-site curves are in this
          record" would then be false about the record and true only about the
          chart, which is the page reporting its own output as the source's
          content. The note above already says what happened to those rounds. */}
      {series.length === 1 && series[0].key === '__aggregate__' && unattributablePerSite === 0 && (
        <p className="mt-3 text-xs text-gray-500">
          No per-site curves are in this record. Whether they were held back or never collected is
          not recorded, so this page does not describe it as either.
        </p>
      )}
      {/* One sentence per reason, never a wider sentence covering several. A
          round held back because the per-site map is known to be short is a
          different situation from one held back because nobody said how long
          the map should be, and both differ again from one the campaign never
          scored. Merging any two tells a reader the wrong thing about at least
          one of them. */}
      <DispositionNotes tally={tally} />
    </div>
  );
};

export default RoundChart;
