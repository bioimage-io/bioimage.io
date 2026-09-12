import React, { useMemo } from 'react';
import { SoupRecord, WitnessMetric } from '../../types/campaign';
import {
  AggregateDisposition,
  DispositionTally,
  aggregateDisposition,
  emptyTally,
  tally as tallyInto,
} from './aggregateDisposition';
import { formatBytes, formatCount, formatDate, formatMetric } from './format';
import { MissingReason, Value } from './MissingValue';

/**
 * The lineage of the community model, version by version.
 *
 * This is the payoff of an async campaign and the thing a synchronous run has
 * no equivalent of. Each merge writes a NEW IMMUTABLE version rather than
 * updating one entry in place, so there is a chain a reader can walk: v4 folded
 * these three contributions into v3, scored this, and is still downloadable.
 *
 * Two consequences of immutability that shape what is rendered.
 *
 * A published version's score is a MODEL-CARD number, not a peek at a running
 * experiment. The checkpoint cannot change, so the figure cannot be revised by
 * the campaign continuing, which is why the outcome gate can release these
 * while still withholding per-contributor curves. A per-contributor curve is a
 * public ranking of whose data is hardest, and an open community is a worse
 * place for that than a closed consortium, not a better one.
 *
 * The x axis is TIME. Plotting against version index would draw the versions
 * evenly spaced, and they are not: a scheduled merge with nothing to fold
 * publishes no version at all, so consecutive version numbers can be one week
 * or three apart. Nothing here divides elapsed time by version count.
 */

const VIEW_W = 720;
const VIEW_H = 200;
const PAD_L = 48;
const PAD_R = 20;
const PAD_T = 16;
const PAD_B = 34;

const LINE_COLOUR = '#7c3aed';

function msOf(iso: string | null | undefined): number | null {
  if (!iso) return null;
  const t = new Date(iso).getTime();
  return Number.isNaN(t) ? null : t;
}

const countPhrase = (n: number) => (n === 1 ? '1 version' : `${n} versions`);

/**
 * Which kind of absence a refused score is, so the cell's tooltip names the
 * right actor. The disposition already knows; without this the table would have
 * to pick one label for four different decisions and would be wrong for three.
 */
function missingReasonFor(disposition: AggregateDisposition): MissingReason {
  if (disposition.plot) return 'unreported';
  switch (disposition.by) {
    case 'service':
      return 'withheld';
    case 'page':
    case 'unrenderable':
      return 'unshown';
    default:
      return 'unreported';
  }
}

/**
 * Why a version is not on the curve. Same three-actor split as the round chart,
 * for the same reason: a gap that the campaign chose, a gap this page chose,
 * and a gap nobody chose are different facts about the record.
 */
const LineageNotes: React.FC<{ tally: DispositionTally }> = ({ tally }) => {
  const service = Object.entries(tally.service).filter(([, n]) => n > 0);
  const page = Object.entries(tally.page).filter(([, n]) => n > 0);
  const unrenderable = Object.entries(tally.unrenderable).filter(([, n]) => n > 0);
  if (service.length === 0 && page.length === 0 && unrenderable.length === 0 && !tally.absent) {
    return null;
  }
  return (
    <>
      {tally.absent > 0 && (
        <p className="mt-3 text-xs text-gray-500">
          {countPhrase(tally.absent)} carry no score in this record, so they are not on the curve.
        </p>
      )}
      {service.length > 0 && (
        <p className="mt-2 text-xs text-gray-500">
          The campaign withheld the pooled score for{' '}
          {countPhrase(service.reduce((n, [, count]) => n + count, 0))} and stated the rule that
          fired.
        </p>
      )}
      {page.length > 0 && (
        <p className="mt-2 text-xs text-gray-500">
          {countPhrase(page.reduce((n, [, count]) => n + count, 0))} published a pooled score this
          page will not render, because the record breaks a rule it declares it follows.
        </p>
      )}
      {unrenderable.length > 0 && (
        <p className="mt-2 text-xs text-gray-500">
          {countPhrase(unrenderable.reduce((n, [, count]) => n + count, 0))} carry a score this page
          has no way to check, so it is not shown. Nothing about those records is wrong.
        </p>
      )}
    </>
  );
};

export interface SoupLineageProps {
  soups: SoupRecord[];
  /**
   * From `policy.aggregate_min_scoring_sites`. Never defaulted here, for the
   * same reason the round chart does not default it.
   */
  minScoringSites?: number | null;
  /** Gate from `disclosure.outcomesReleased`. False hides the curve and the column. */
  showMetric: boolean;
  /**
   * From `progress.baseline_metric`. The base model's own score on the same
   * split, drawn as a reference level and never as a point on the curve. See
   * the field's doc for why that distinction is structural and not cosmetic.
   */
  baselineMetric?: WitnessMetric | null;
  /** `base_model.name`, used to label the reference level. */
  baselineLabel?: string | null;
}

const SoupLineage: React.FC<SoupLineageProps> = ({
  soups,
  minScoringSites = null,
  showMetric,
  baselineMetric = null,
  baselineLabel = null,
}) => {
  const { points, tally, metricName, gateName, baseline, baselineWithheld, lo, hi, yMin, yMax } = useMemo(() => {
    const tallied = emptyTally();
    const plotted: Array<{ key: string; ms: number; value: number; label: string }> = [];
    soups.forEach((soup) => {
      const disposition = aggregateDisposition(
        { metric: soup.witness_metric, eval_on: null },
        minScoringSites
      );
      tallyInto(tallied, disposition);
      const ms = msOf(soup.merged_at);
      if (disposition.plot && ms !== null) {
        plotted.push({
          key: soup.soup_id,
          ms,
          value: disposition.value,
          label: soup.community_model?.version ?? '',
        });
      }
    });
    plotted.sort((a, b) => a.ms - b.ms);

    // The baseline goes through the SAME disposition function as every version
    // on the curve. A reference level is a published figure like any other, and
    // exempting it would mean the one number on this chart that is not checked
    // is the one the campaign is measured against.
    const witnessRef = soups.find((s) => s.witness_metric)?.witness_metric ?? null;
    const baselineDisposition = baselineMetric
      ? aggregateDisposition({ metric: baselineMetric, eval_on: null }, minScoringSites)
      : null;
    // Comparability, which the disposition function cannot check because it
    // sees one metric at a time. A line drawn across a curve asserts that the
    // two are the same measurement, and if the names or the scopes differ they
    // are not: a central holdout figure and a participant-pooled figure can sit
    // at the same height and mean different things. Withholding the line is the
    // only honest response, because the alternative is a comparison the reader
    // has no way to know is invalid.
    const comparable =
      baselineMetric !== null &&
      witnessRef !== null &&
      baselineMetric.name === witnessRef.name &&
      (baselineMetric.aggregate_scope ?? null) === (witnessRef.aggregate_scope ?? null);
    const baselineValue =
      baselineDisposition !== null && baselineDisposition.plot && comparable
        ? baselineDisposition.value
        : null;

    // The baseline enters the y domain. Otherwise a base model the community
    // has comfortably passed sits below the axis and the chart silently crops
    // the whole point of drawing it.
    const values = plotted.map((p) => p.value);
    if (baselineValue !== null) values.push(baselineValue);
    const low = values.length > 0 ? Math.min(...values) : 0;
    const high = values.length > 0 ? Math.max(...values) : 1;
    const span = high - low || 1;
    return {
      points: plotted,
      tally: tallied,
      baseline:
        baselineValue !== null
          ? { value: baselineValue, label: baselineLabel ?? 'Base model' }
          : null,
      // A record carried a baseline and the chart is not drawing it. Said out
      // loud rather than left as an empty space, because an absent reference
      // level and a reference level this page declined to draw look identical.
      baselineWithheld:
        baselineMetric !== null && baselineValue === null
          ? comparable
            ? 'unshown'
            : 'incomparable'
          : null,
      metricName: soups.find((s) => s.witness_metric)?.witness_metric?.name ?? null,
      // Named, never drawn. Naming it is what lets a reader see that the curve
      // above is not it: a page that plotted "the score" and said nothing else
      // gives them no way to ask which score.
      gateName: soups.find((s) => s.selection_metric)?.selection_metric?.name ?? null,
      lo: plotted.length > 0 ? plotted[0].ms : 0,
      hi: plotted.length > 0 ? plotted[plotted.length - 1].ms : 1,
      yMin: Math.max(0, low - span * 0.15),
      yMax: high + span * 0.15,
    };
  }, [soups, minScoringSites, baselineMetric, baselineLabel]);

  if (soups.length === 0) {
    return (
      <p className="text-sm text-gray-500">
        No community version has been published yet. The first one appears after the first merge.
      </p>
    );
  }

  const ordered = [...soups].sort((a, b) => b.index - a.index);

  const xSpan = hi - lo || 1;
  const x = (ms: number) => PAD_L + ((ms - lo) / xSpan) * (VIEW_W - PAD_L - PAD_R);
  const y = (value: number) =>
    VIEW_H - PAD_B - ((value - yMin) / (yMax - yMin || 1)) * (VIEW_H - PAD_T - PAD_B);
  const yTicks = [yMin, (yMin + yMax) / 2, yMax];

  return (
    <div>
      {showMetric && points.length > 1 && (
        <div className="mb-6">
          {metricName && (
            <p className="mb-2 text-xs font-medium uppercase tracking-wide text-gray-500">
              {metricName} of each published version
            </p>
          )}
          <svg
            viewBox={`0 0 ${VIEW_W} ${VIEW_H}`}
            className="w-full"
            data-icon="chart-soup-lineage"
            role="img"
            aria-label={`${metricName ?? 'Metric'} of each community version, by merge date`}
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
            {/* Drawn BEFORE the curve so the curve sits on top of it, which is
                the visual form of the same rule the schema states: this is a
                level the versions are read against, not one of them. Dashed,
                grey, spanning the full width and carrying no marker, so there
                is nothing on it that could be mistaken for a version. */}
            {baseline && (
              <g data-baseline={baseline.label}>
                <line
                  x1={PAD_L}
                  x2={VIEW_W - PAD_R}
                  y1={y(baseline.value)}
                  y2={y(baseline.value)}
                  stroke="#9ca3af"
                  strokeWidth={1.5}
                  strokeDasharray="5 4"
                />
                <text
                  x={VIEW_W - PAD_R}
                  y={y(baseline.value) - 6}
                  textAnchor="end"
                  fontSize={11}
                  fill="#6b7280"
                >
                  {baseline.label}, {formatMetric(baseline.value)}
                </text>
              </g>
            )}
            <path
              d={points
                .map((p, i) => `${i === 0 ? 'M' : 'L'}${x(p.ms).toFixed(1)} ${y(p.value).toFixed(1)}`)
                .join(' ')}
              fill="none"
              stroke={LINE_COLOUR}
              strokeWidth={2.5}
              strokeLinecap="round"
              strokeLinejoin="round"
            />
            {points.map((p) => (
              // data-version so a test can count the points on this curve
              // specifically. Every point here is a PUBLISHED checkpoint, and a
              // merge that published nothing must not add one: a score on this
              // curve is a score attributed to a model somebody can download.
              <circle
                key={p.key}
                data-version={p.label}
                cx={x(p.ms)}
                cy={y(p.value)}
                r={3}
                fill={LINE_COLOUR}
              />
            ))}
            <text x={PAD_L} y={VIEW_H - 10} fontSize={11} fill="#6b7280">
              {formatDate(new Date(lo).toISOString())}
            </text>
            <text
              x={VIEW_W - PAD_R}
              y={VIEW_H - 10}
              fontSize={11}
              fill="#6b7280"
              textAnchor="end"
            >
              {formatDate(new Date(hi).toISOString())}
            </text>
          </svg>
          {/* The comparison the curve alone cannot make. A greedy gate admits
              only what improves, so the versions rising past each other is the
              selection rule working and says nothing about whether any of them
              beat the model everybody already had. */}
          {baseline && (
            <p className="mt-2 text-xs text-gray-500">
              The dashed line is {baseline.label} scored the same way before the first merge. It is
              the level the community versions are read against, not one of them.
            </p>
          )}
          {baselineWithheld === 'incomparable' && (
            <p className="mt-2 text-xs text-gray-500">
              The base model carries a score in this record, measured differently from the versions
              above. It is not drawn, because a line across this curve would state that the two are
              the same measurement.
            </p>
          )}
          {baselineWithheld === 'unshown' && (
            <p className="mt-2 text-xs text-gray-500">
              The base model carries a score in this record that this page will not render, for the
              same reason it holds back a version's score.
            </p>
          )}
          <p className="mt-2 text-xs text-gray-500">
            Each point is a published checkpoint, placed on the date it was merged rather than
            spaced by version number. Not every merge publishes a version, whether because nothing
            new had arrived or because none of what arrived improved the model, so the spacing
            varies.
          </p>
          {/* The reason this sentence exists: a merge keeps a checkpoint only
              when its own gate score goes up, so a plot of that gate score rises
              on every published version by construction, whether or not the
              model got better. The curve above is measured on a split that no
              merge ever consulted, which is the only version of this figure that
              can carry information. */}
          {gateName && (
            <p className="mt-1.5 text-xs text-gray-500">
              This is measured on a split held back from selection. It is not the{' '}
              {gateName} that decides which contributions a merge keeps, which rises on every
              published version by definition and so cannot show whether the model improved.
            </p>
          )}
        </div>
      )}

      {showMetric && <LineageNotes tally={tally} />}

      <div className="overflow-x-auto">
        <table className="w-full text-left text-sm">
          <thead>
            <tr className="border-b border-gray-200 text-xs uppercase tracking-wide text-gray-500">
              <th scope="col" className="py-2 pr-4 font-semibold">Version</th>
              <th scope="col" className="py-2 pr-4 font-semibold">Merged</th>
              <th scope="col" className="py-2 pr-4 font-semibold">Folded in</th>
              <th scope="col" className="py-2 pr-4 font-semibold">Contributions so far</th>
              {/* The metric's own name, never the word "Score". `RoundMetric.name`
                  says so and this column was the one place still breaking it.
                  It matters more here than anywhere: the record carries a
                  witness metric AND a gate metric, the chart caption above
                  names which one it drew, and a reader who scrolls past that
                  caption to the table saw a column of numbers beside version
                  numbers with nothing saying which split they came from. The
                  circular reading is the one that needs no extra assumption,
                  so an unlabelled column defaults to it. */}
              {showMetric && (
                <th scope="col" className="py-2 pr-4 font-semibold">
                  {metricName ?? 'Witness metric'}
                </th>
              )}
              <th scope="col" className="py-2 font-semibold">Weights moved</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {ordered.map((soup) => {
              const disposition = aggregateDisposition(
                { metric: soup.witness_metric, eval_on: null },
                minScoringSites
              );
              const version = soup.community_model?.version ?? null;
              const url = soup.community_model?.url ?? null;
              // Same coverage gate the round log uses. A sum over four of six
              // sources is a real sum that is not this merge's transport, and
              // the number cannot say which of the two it is.
              const moved =
                soup.transport?.sources_complete === true
                  ? formatBytes(soup.transport?.bytes_out)
                  : null;
              return (
                <tr
                  key={soup.soup_id}
                  className="align-top transition-colors duration-200 hover:bg-gray-50/80"
                >
                  <td className="py-3 pr-4 font-medium text-gray-900">
                    {version === null ? (
                      <Value>{null}</Value>
                    ) : url ? (
                      <a
                        href={url}
                        className="text-blue-700 transition-colors duration-200 hover:text-blue-900"
                      >
                        {version}
                      </a>
                    ) : (
                      version
                    )}
                    {soup.global_sha256 && (
                      <div className="mt-0.5">
                        <code className="rounded bg-gray-100 px-1 text-[11px] text-gray-600">
                          {soup.global_sha256.slice(0, 8)}
                        </code>
                      </div>
                    )}
                  </td>
                  <td className="py-3 pr-4 whitespace-nowrap text-gray-700">
                    <Value>{formatDate(soup.merged_at)}</Value>
                  </td>
                  <td className="py-3 pr-4 tabular-nums text-gray-700">
                    {formatCount(soup.contributions.length)}
                    {/* The denominator only appears when the campaign published
                        the pool. A merge that did not publish it gets the bare
                        count: writing "3 of 3" there would assert that nothing
                        else was considered, which is exactly the thing the
                        record declined to say. */}
                    {soup.assessed !== null && (
                      <span className="block text-xs font-normal tabular-nums text-gray-500">
                        of {formatCount(soup.assessed.length)} assessed
                      </span>
                    )}
                  </td>
                  <td className="py-3 pr-4 tabular-nums text-gray-700">
                    <Value>
                      {formatCount(soup.community_model?.n_contributions_cumulative ?? null)}
                    </Value>
                  </td>
                  {showMetric && (
                    <td className="py-3 pr-4 tabular-nums text-gray-700">
                      {/* The same decision as the curve, from the same
                          function, so a figure the chart refuses cannot appear
                          in the table three columns to the left. */}
                      <Value reason={missingReasonFor(disposition)}>
                        {disposition.plot ? formatMetric(disposition.value) : null}
                      </Value>
                    </td>
                  )}
                  <td className="py-3 tabular-nums text-gray-700">
                    <Value>{moved}</Value>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <p className="mt-3 text-xs text-gray-500">
        Every merge writes a new version rather than replacing the last one, so an earlier community
        model stays downloadable and the chain above is the whole history.
      </p>
    </div>
  );
};

export default SoupLineage;
