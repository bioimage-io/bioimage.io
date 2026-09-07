#!/usr/bin/env node
/**
 * Checks the aggregate disclosure decision in
 * src/components/campaigns/aggregateDisposition.ts.
 *
 * Standalone for the same reason as transport-math-check.js: the repo's TS
 * version chain makes `react-scripts test` and `tsc --noEmit` unusable, and the
 * module under test is pure and imports nothing but types.
 *
 * A rendering assertion cannot cover this class on its own. Every wrong answer
 * here produces a chart that looks exactly like a right one, with one more
 * point on it or one fewer, and the failure that matters is the direction where
 * a figure appears that should not have. So the cases below are written mostly
 * as refusals, and the ones that plot are there to prove the refusals are not
 * vacuous: a function that refused everything would pass a suite of refusals.
 *
 *   node scripts/aggregate-disposition-check.js
 *
 * Exits non-zero on any failure. Emits into a temp dir and cleans up.
 */
const { execFileSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const REPO = path.resolve(__dirname, '..');
const OUT = fs.mkdtempSync(path.join(os.tmpdir(), 'agg-disp-'));

try {
  // tsc reports parse errors from modern .d.ts files under TS 3.9.10 and still
  // emits. Emission is what matters, so the exit code is ignored.
  try {
    execFileSync(
      path.join(REPO, 'node_modules/.bin/tsc'),
      [
        path.join(REPO, 'src/components/campaigns/aggregateDisposition.ts'),
        '--outDir', OUT,
        '--target', 'es2019',
        '--module', 'commonjs',
        '--skipLibCheck',
        '--moduleResolution', 'node',
      ],
      { stdio: 'ignore' }
    );
  } catch (e) {
    /* see above */
  }

  const emitted = path.join(OUT, 'components/campaigns/aggregateDisposition.js');
  if (!fs.existsSync(emitted)) {
    console.error('FAIL: aggregateDisposition.ts did not compile, nothing to check');
    process.exit(1);
  }

  const { aggregateDisposition, emptyTally, tally } = require(emitted);

  let fail = 0;
  let passed = 0;
  const eq = (name, got, want) => {
    const g = JSON.stringify(got), w = JSON.stringify(want);
    if (g !== w) { console.log(`FAIL ${name}\n  got  ${g}\n  want ${w}`); fail++; }
    else { console.log(`ok   ${name}`); passed++; }
  };

  // A round with everything in order. Three evaluating sites, complete per-site
  // map, no stated withhold.
  const ok = (over) => ({
    round: 0,
    participants: ['a', 'b', 'c'],
    eval_on: ['a', 'b', 'c'],
    metric: {
      name: 'validation Dice',
      higher_is_better: true,
      per_site: { a: 0.8, b: 0.81, c: 0.79 },
      per_site_basis: 'site',
      aggregate: 0.8,
      aggregate_basis: 'mean',
      n_sites_scored: 3,
      aggregate_withheld: null,
      ...(over && over.metric),
    },
    ...(over && over.round !== undefined ? { round: over.round } : {}),
    ...(over && over.eval_on !== undefined ? { eval_on: over.eval_on } : {}),
  });

  // Plots. Without these the refusal cases below prove nothing.
  eq('complete round plots', aggregateDisposition(ok(), 3), { plot: true, value: 0.8 });
  eq('scoring count exactly at the floor plots',
    aggregateDisposition(ok(), 3).plot, true);
  // Withholding the per-site map is a legitimate privacy choice and does not
  // withhold the aggregate. Withholding the COUNT is a different thing and now
  // does, because the count is what the floor is checked against. This case
  // used to pass `n_sites_scored: null` and plot, which is the wider half of
  // the operand leak: with no map the per-site block was skipped entirely, the
  // count was never read, and the floor passed on the eval set instead.
  eq('per_site withheld entirely still plots when the count is stated',
    aggregateDisposition(ok({ metric: { per_site: null } }), 3),
    { plot: true, value: 0.8 });
  eq('per_site withheld AND the count withheld does not plot',
    aggregateDisposition(ok({ metric: { per_site: null, n_sites_scored: null } }), 3),
    { plot: false, by: 'page', cause: 'completeness_unknown' });

  // The bug this module was written for: a null aggregate used to fall out of
  // both branches of the chart's loop and produce nothing at all.
  eq('service withhold is attributed to the service',
    aggregateDisposition(ok({ metric: { aggregate: null, aggregate_withheld: 'below_scoring_floor' } }), 3),
    { plot: false, by: 'service', cause: 'below_scoring_floor' });
  eq('every service cause is carried through, not flattened',
    ['partial_map', 'completeness_unknown', 'below_scoring_floor', 'floor_unknown'].map((c) =>
      aggregateDisposition(ok({ metric: { aggregate: null, aggregate_withheld: c } }), 3).cause),
    ['partial_map', 'completeness_unknown', 'below_scoring_floor', 'floor_unknown']);

  // A null with no stated cause is an absence, not a withhold. Reporting it as
  // a withhold would attribute a decision to a service that made none.
  eq('null aggregate with no cause is absent',
    aggregateDisposition(ok({ metric: { aggregate: null, aggregate_withheld: null } }), 3),
    { plot: false, by: 'absent' });
  eq('no metric at all is absent',
    aggregateDisposition({ round: 0, participants: [], eval_on: [], metric: null }, 3),
    { plot: false, by: 'absent' });

  // Page refusals. Each is a figure the service published that the page will
  // not render, which is a different statement from the service withholding it.
  eq('partial map refuses',
    aggregateDisposition(ok({ metric: { per_site: { a: 0.8, b: 0.81 } } }), 3),
    { plot: false, by: 'page', cause: 'partial_map' });
  eq('unknown completeness refuses',
    aggregateDisposition(ok({ metric: { n_sites_scored: null } }), 3),
    { plot: false, by: 'page', cause: 'completeness_unknown' });
  // The key space is checked BEFORE any comparison against n_sites_scored,
  // which counts sites. Comparing a map's length to a site count means nothing
  // unless the map is site-keyed, and this module used to assume it was.
  eq('a map that does not say what it is keyed by refuses',
    aggregateDisposition(ok({ metric: { per_site_basis: null } }), 3),
    { plot: false, by: 'page', cause: 'per_site_basis_unstated' });
  eq('a dataset-keyed map refuses for want of a denominator, not as malformed',
    aggregateDisposition(ok({ metric: { per_site_basis: 'dataset' } }), 3),
    { plot: false, by: 'page', cause: 'per_site_not_site_keyed' });

  // The pooled arm of the current federated layout: six datasets scored at one
  // site. This is a CORRECT round and the previous revision of this file
  // rejected it as a malformed site map, because the over-long gate inferred a
  // key space from a cardinality it had no business comparing.
  const pooledArm = {
    eval_on: ['pooled'],
    metric: {
      per_site: { d1: 0.8, d2: 0.8, d3: 0.8, d4: 0.8, d5: 0.8, d6: 0.8 },
      per_site_basis: 'dataset',
      n_sites_scored: 1,
    },
  };
  eq('the pooled arm is not reported as a count mismatch',
    aggregateDisposition(ok(pooledArm), 1).cause, 'per_site_not_site_keyed');

  // The cardinality comparisons survive, in the space where they mean
  // something. A site-keyed map really cannot have more entries than sites.
  eq('a site-keyed map with more entries than sites scored refuses',
    aggregateDisposition(ok({ metric: { per_site: { a: 0.8, b: 0.81, c: 0.79, d: 0.78 } } }), 3),
    { plot: false, by: 'page', cause: 'map_exceeds_count' });
  // Control. Without this the rule above would also pass if the gate refused
  // every map that is not short, which would withhold every correct round.
  eq('a map of exactly n_sites_scored entries still plots',
    aggregateDisposition(ok(), 3), { plot: true, value: 0.8 });
  // Short, over-long and wrong-space are three findings, not one. They send a
  // reader to three different places: entries are missing, the count disagrees,
  // or the question was never answerable from this record.
  eq('the three per-site findings stay separable',
    [
      aggregateDisposition(ok({ metric: { per_site: { a: 0.8 } } }), 3).cause,
      aggregateDisposition(ok({ metric: { per_site: { a: 0.8, b: 0.8, c: 0.8, d: 0.8 } } }), 3).cause,
      aggregateDisposition(ok(pooledArm), 1).cause,
    ],
    ['partial_map', 'map_exceeds_count', 'per_site_not_site_keyed']);

  // THE OPERAND. The floor exists to stop a pooled figure standing on too few
  // sites, and the figure is a mean over `n_sites_scored`. It used to be checked
  // against `eval_on.length`, which counts the sites ASKED to evaluate, and
  // nothing anywhere related the two numbers. The four cases below are that
  // distinction, and before the fix the first two plotted.
  eq('one site scoring out of a full eval set is below the floor',
    aggregateDisposition(ok({ eval_on: ['a', 'b', 'c'], metric: { per_site: { a: 0.8 }, n_sites_scored: 1 } }), 3),
    { plot: false, by: 'page', cause: 'below_scoring_floor' });
  eq('the same round with the map withheld is still below the floor',
    aggregateDisposition(ok({ eval_on: ['a', 'b', 'c'], metric: { per_site: null, n_sites_scored: 1 } }), 3),
    { plot: false, by: 'page', cause: 'below_scoring_floor' });
  // The mirror. A short eval set is not itself disqualifying: what matters is
  // how many sites the published mean is over. Without this the fix would look
  // correct while having merely moved the same wrong refusal to a new field.
  eq('a short eval set does not refuse when enough sites scored',
    aggregateDisposition(ok({ eval_on: ['a', 'b'], metric: { per_site: { a: 0.8, b: 0.8 }, n_sites_scored: 2 } }), 2),
    { plot: true, value: 0.8 });
  eq('an unreported eval set does not refuse when enough sites scored',
    aggregateDisposition(ok({ eval_on: null }), 3),
    { plot: true, value: 0.8 });
  // More scored than were asked. Impossible from the driver, so it is a
  // contradiction in the record and not a coverage shortfall, and it is
  // reported as its own cause rather than folded into the floor.
  eq('more scoring sites than evaluating sites is a contradiction',
    aggregateDisposition(ok({ eval_on: ['a', 'b'], metric: { per_site: { a: 0.8, b: 0.8, c: 0.8 }, n_sites_scored: 3 } }), 3),
    { plot: false, by: 'page', cause: 'scoring_exceeds_eval_set' });
  eq('the contradiction is not reported as a floor failure',
    aggregateDisposition(ok({ eval_on: ['a'], metric: { per_site: { a: 0.8, b: 0.8 }, n_sites_scored: 2 } }), 5).cause,
    'scoring_exceeds_eval_set');
  eq('unstated floor refuses',
    aggregateDisposition(ok(), null),
    { plot: false, by: 'page', cause: 'floor_unstated' });
  eq('aggregate plus a stated withhold refuses',
    aggregateDisposition(ok({ metric: { aggregate_withheld: 'partial_map' } }), 3),
    { plot: false, by: 'page', cause: 'contradictory_withhold' });

  // The failure direction that matters. A null floor must not be read as met,
  // and the page must not supply 3 of its own: the threshold is one
  // consortium's judgement and a page that invented one would present it as a
  // property of the platform.
  eq('null floor does not fall through to a default of 3',
    aggregateDisposition(ok(), null).plot, false);
  eq('null floor refuses however many sites scored',
    aggregateDisposition(ok({
      eval_on: ['a', 'b', 'c', 'd', 'e', 'f'],
      metric: { per_site: { a: 0.8, b: 0.8, c: 0.8, d: 0.8, e: 0.8, f: 0.8 }, n_sites_scored: 6 },
    }), null).plot, false);

  // Service and page causes with the same name are not the same finding.
  const sameName = [
    aggregateDisposition(ok({ metric: { aggregate: null, aggregate_withheld: 'partial_map' } }), 3),
    aggregateDisposition(ok({ metric: { per_site: { a: 0.8 } } }), 3),
  ];
  eq('same cause, different actor, stays distinguishable',
    sameName.map((d) => d.by), ['service', 'page']);

  // A refusal must not be silently rewritten into a plot by the tally.
  const t = emptyTally();
  [
    aggregateDisposition(ok(), 3),
    aggregateDisposition(ok({ eval_on: ['a'], metric: { per_site: { a: 0.8 }, n_sites_scored: 1 } }), 3),
    aggregateDisposition(ok({ metric: { aggregate: null, aggregate_withheld: 'floor_unknown' } }), 3),
    aggregateDisposition(ok({ metric: { aggregate: null, aggregate_withheld: null } }), 3),
  ].forEach((d) => tally(t, d));
  eq('tally counts plotted', t.plotted, 1);
  eq('tally counts the page refusal', t.page.below_scoring_floor, 1);
  eq('tally counts the service withhold', t.service.floor_unknown, 1);
  eq('tally counts the absence', t.absent, 1);
  // Every round lands in exactly one bucket. A round counted twice overstates
  // how much is missing, and a round counted nowhere is the original bug.
  const total = t.plotted + t.absent
    + Object.values(t.service).reduce((a, b) => a + b, 0)
    + Object.values(t.page).reduce((a, b) => a + b, 0);
  eq('every round lands in exactly one bucket', total, 4);

  console.log(fail ? `\n${fail} FAILED` : `\nall ${passed} passed`);
  process.exit(fail ? 1 : 0);
} finally {
  fs.rmSync(OUT, { recursive: true, force: true });
}
