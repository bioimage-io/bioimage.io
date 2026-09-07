import React, { useMemo } from 'react';
import { RoundRecord, SiteRecord } from '../../types/campaign';
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

interface RoundChartProps {
  rounds: RoundRecord[];
  sites: SiteRecord[];
}

const RoundChart: React.FC<RoundChartProps> = ({ rounds, sites }) => {
  const scored = useMemo(() => rounds.filter((r) => r.metric !== null), [rounds]);

  const {
    series,
    metricName,
    metricBasis,
    withheldAggregates,
    unverifiableAggregates,
    xMin,
    xMax,
    yMin,
    yMax,
  } = useMemo(() => {
    const siteNames = new Map(sites.map((s) => [s.site_id, s.site_name]));
    let withheld = 0;
    let unverifiable = 0;
    const aggregate: Series = {
      key: '__aggregate__',
      label: 'All sites',
      colour: AGGREGATE_COLOUR,
      points: [],
      dashed: false,
    };
    const perSite = new Map<string, Series>();

    scored.forEach((round) => {
      const metric = round.metric!;
      // A partial per-site map plus an aggregate reconstructs the missing site,
      // so the two are only publishable together when the map is complete.
      //
      // `n_sites_scored` is the ONLY thing that can establish completeness, so
      // when it is null the page cannot tell a complete map from a partial one.
      // This used to require `n_sites_scored !== null` before calling a round
      // partial, which meant a silent count made `partialPerSite` false and the
      // aggregate was published: precisely the combination this gate exists to
      // prevent, produced by the service saying nothing. A gate that only fires
      // when the record volunteers the number it needs is not a gate.
      //
      // Unknown completeness is therefore counted separately from known
      // partial. Both withhold, but they are different situations and the note
      // under the chart must not tell a reader the wrong one.
      const perSiteReported = metric.per_site !== null;
      const completenessUnknown = perSiteReported && metric.n_sites_scored === null;
      const knownPartial =
        perSiteReported &&
        metric.n_sites_scored !== null &&
        Object.keys(metric.per_site!).length < metric.n_sites_scored;

      if (metric.aggregate !== null && !knownPartial && !completenessUnknown) {
        aggregate.points.push({ round: round.round, value: metric.aggregate });
      } else if (metric.aggregate !== null) {
        if (completenessUnknown) unverifiable += 1;
        else withheld += 1;
      }
      if (metric.per_site) {
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
      metricBasis: scored.find((r) => r.metric?.aggregate_basis)?.metric?.aggregate_basis ?? null,
      withheldAggregates: withheld,
      unverifiableAggregates: unverifiable,
      xMin: roundNumbers.length > 0 ? Math.min(...roundNumbers) : 0,
      xMax: roundNumbers.length > 0 ? Math.max(...roundNumbers) : 1,
      yMin: Math.max(0, lo - span * 0.15),
      yMax: hi + span * 0.15,
    };
  }, [scored, sites]);

  if (series.length === 0) {
    return (
      <p className="text-sm text-gray-500">
        No scores have been reported for this campaign yet. Accuracy is published after a campaign
        completes, so a run in progress may show none.
      </p>
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
      {metricBasis && (
        <p className="mt-3 text-xs text-gray-500">
          The combined curve is a {metricBasis}. There is no single pooled figure in the training
          record, so this one is worked out from the per-dataset scores and is named here rather
          than presented as a measurement.
        </p>
      )}
      {series.length === 1 && series[0].key === '__aggregate__' && (
        <p className="mt-3 text-xs text-gray-500">
          Per-site curves are kept within the campaign. Publishing them live would amount to a
          public ranking of whose data is hardest, which discourages the sites this depends on.
        </p>
      )}
      {withheldAggregates > 0 && (
        <p className="mt-3 text-xs text-gray-500">
          {withheldAggregates} {withheldAggregates === 1 ? 'round is' : 'rounds are'} missing a
          combined score. Where only some sites published a curve, showing the combined figure too
          would let the remaining one be worked back out, so both are held back together.
        </p>
      )}
      {/* A separate sentence from the one above, not a wider version of it. A
          round held back because the map is known to be short is a different
          situation from one held back because nobody said how long the map
          should be, and the second is a gap in the record rather than a
          disclosure decision. Merging them would tell a reader the campaign
          chose to withhold something it never reported the shape of. */}
      {unverifiableAggregates > 0 && (
        <p className="mt-3 text-xs text-gray-500">
          {unverifiableAggregates} {unverifiableAggregates === 1 ? 'round does' : 'rounds do'} not
          report how many sites were scored, so there is no way to tell a complete set of per-site
          curves from a partial one. The combined score is held back for those rounds rather than
          published on the assumption that the set is complete.
        </p>
      )}
    </div>
  );
};

export default RoundChart;
