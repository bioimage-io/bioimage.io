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

  const {
    aggregateDisposition,
    emptyTally,
    tally,
    REFUSAL_OBLIGATION,
    PANEL_LIMIT_PERMISSION,
  } = require(emitted);

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
      // Required since 0.9.0-draft. Every case in this file that is meant to
      // reach a gate below the role check has to carry it, so it lives in the
      // shared fixture rather than being sprinkled per case.
      role: 'witness',
      name: 'validation Dice',
      higher_is_better: true,
      per_site: { a: 0.8, b: 0.81, c: 0.79 },
      per_site_basis: 'site',
      aggregate: 0.8,
      aggregate_basis: 'mean',
      n_sites_scored: 3,
      // Site-keyed base round, so no dataset count. Spelled out rather than
      // left off, because the two are not the same input: a record written
      // before 0.7.0 omits the key entirely and one written after it sets null,
      // and the gate has to treat them alike. The omission case gets its own
      // case below rather than being smuggled in as this fixture's default.
      n_datasets_scored: null,
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
    { plot: false, by: 'unrenderable', cause: 'per_site_basis_unstated' });
  eq('a dataset-keyed map refuses for want of a denominator, not as malformed',
    aggregateDisposition(ok({ metric: { per_site_basis: 'dataset' } }), 3),
    { plot: false, by: 'unrenderable', cause: 'per_site_not_site_keyed' });

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

  // And it is not reported as a page refusal either, which is the stronger
  // claim and the one that took a second pass to see. `by` decides which block
  // on screen the sentence lands in, and the page-refusal block ends by saying
  // the record does not match the format it declares. A dataset basis is a
  // value the format added a field for in 0.4.0, so publishing one is
  // conformance. The pooled arm is permanently this shape and is 15 of the 75
  // arms in the completed run, so the old grouping was not an edge case: it
  // told a reader a fifth of that run was malformed, every time, forever.
  //
  // The behaviour is unchanged and was never the mistake. Same withhold, same
  // cause, different actor at fault, and here no actor is.
  eq('the pooled arm is not accused of breaching the format',
    aggregateDisposition(ok(pooledArm), 1).by, 'unrenderable');
  eq('the pooled arm aggregate is still withheld',
    aggregateDisposition(ok(pooledArm), 1).plot, false);
  // Control on the split. A genuinely malformed record must STILL be a page
  // refusal, or the fix has merely stopped the page accusing anyone of
  // anything, which loses the finding rather than classifying it.
  // The membership test for `page`, applied to the two remaining key-space
  // causes rather than only to the one that was reported. `per_site_basis: null`
  // is documented as "the producer did not say", a permitted value, and no
  // service withhold cause covers it, so a record can reach it having broken
  // nothing. It moves too.
  eq('an unstated key space is a panel limit, not an accusation',
    aggregateDisposition(ok({ metric: { per_site_basis: null } }), 3).by, 'unrenderable');
  // Control on the split. A record that really did break a stated rule must
  // STILL be a page refusal, or the fix has stopped the page accusing anyone of
  // anything, which loses the finding rather than classifying it. The service
  // commits to withholding below the floor, so publishing anyway is a breach.
  eq('a floor breach is still a page refusal',
    aggregateDisposition(ok({ eval_on: ['a','b','c'], metric: { per_site: { a: 0.8 }, n_sites_scored: 1 } }), 3).by,
    'page');
  eq('a self-contradicting round is still a page refusal',
    aggregateDisposition(ok({ metric: { aggregate_withheld: 'partial_map' } }), 3).by, 'page');

  // 0.7.0. The panel limit above was never a property of dataset-keyed rounds,
  // it was a property of the schema having no denominator outside the site key
  // space. `n_datasets_scored` supplies one, so the same pooled arm that could
  // never be checked is now checked in its own units and plots.
  const pooledArmCounted = {
    eval_on: ['pooled'],
    metric: {
      per_site: { d1: 0.8, d2: 0.8, d3: 0.8, d4: 0.8, d5: 0.8, d6: 0.8 },
      per_site_basis: 'dataset',
      n_sites_scored: 1,
      n_datasets_scored: 6,
    },
  };
  eq('a dataset-keyed map with a dataset count plots',
    aggregateDisposition(ok(pooledArmCounted), 1), { plot: true, value: 0.8 });
  // The cardinality gate has to move key space with the map. Reading
  // `n_sites_scored` for these would compare six datasets against one site and
  // call a complete map partial, which is the original wrong-space subtraction
  // relocated further down the function rather than removed.
  eq('a short dataset-keyed map is counted against datasets, not sites',
    aggregateDisposition(ok({ ...pooledArmCounted, metric: { ...pooledArmCounted.metric, n_datasets_scored: 7 } }), 1),
    { plot: false, by: 'page', cause: 'partial_map' });
  eq('an over-long dataset-keyed map is counted against datasets, not sites',
    aggregateDisposition(ok({ ...pooledArmCounted, metric: { ...pooledArmCounted.metric, n_datasets_scored: 5 } }), 1),
    { plot: false, by: 'page', cause: 'map_exceeds_count' });

  // THE SIBLING RULE, and the one case this whole change turns on. The counts
  // are not alternatives. The scoring floor is a rule about SITES however the
  // map is keyed, because a pooled arm averaging six datasets at one site is
  // still one site's data under a pooled label, which is the disclosure the
  // floor exists to stop. So a dataset count must not exempt a round from the
  // floor, and the presence of both counts must not be read as the
  // contradiction. Either reading reopens 0.6.0's leak in the dataset key
  // space, where it would be harder to see because the map looks complete.
  eq('a complete dataset-keyed map is still subject to the site floor',
    aggregateDisposition(ok(pooledArmCounted), 3),
    { plot: false, by: 'page', cause: 'below_scoring_floor' });
  eq('carrying both counts is not itself a contradiction',
    aggregateDisposition(ok(pooledArmCounted), 1).plot, true);
  eq('a dataset-keyed round still needs the site count for the floor to stand',
    aggregateDisposition(ok({ ...pooledArmCounted, metric: { ...pooledArmCounted.metric, n_sites_scored: null } }), 1),
    { plot: false, by: 'page', cause: 'completeness_unknown' });

  // The direction that IS the contradiction: the count in a key space the
  // record does not claim.
  eq('a dataset count on a site-keyed round refuses',
    aggregateDisposition(ok({ metric: { n_datasets_scored: 3 } }), 3),
    { plot: false, by: 'page', cause: 'count_key_space_mismatch' });
  eq('a dataset count with no stated key space refuses too',
    aggregateDisposition(ok({ metric: { per_site_basis: null, n_datasets_scored: 3 } }), 3).cause,
    'count_key_space_mismatch');
  // Record-level, so it fires with no map at all. Nesting this inside the
  // `per_site` block would be the 0.6.0 shape exactly: a check on a field of
  // the record, skipped whenever a different field is absent.
  eq('a dataset count with no per-unit map at all still refuses',
    aggregateDisposition(ok({ metric: { per_site: null, per_site_basis: null, n_datasets_scored: 3 } }), 3).cause,
    'count_key_space_mismatch');

  // Pre-0.7.0 records omit the key entirely, so the field reads `undefined` and
  // not `null`. A strict `!== null` in the gate would read absent as present
  // and accuse every round of the completed consortium run of a key-space
  // contradiction, which is this file's own defect class: a check firing on a
  // record that broke nothing. These two cases are the only ones that build the
  // metric by hand, because the fixture supplies the key deliberately.
  const preV7 = (over) => ({
    round: 0,
    participants: ['a', 'b', 'c'],
    eval_on: ['a', 'b', 'c'],
    metric: {
      role: 'witness',
      name: 'validation Dice',
      higher_is_better: true,
      per_site: { a: 0.8, b: 0.81, c: 0.79 },
      per_site_basis: 'site',
      aggregate: 0.8,
      aggregate_basis: 'mean',
      n_sites_scored: 3,
      aggregate_withheld: null,
      ...over,
    },
  });
  eq('a record predating the field is not accused of a key-space mismatch',
    aggregateDisposition(preV7(), 3), { plot: true, value: 0.8 });
  eq('a pre-0.7.0 dataset-keyed round falls back to the panel limit',
    aggregateDisposition(preV7({
      per_site: { d1: 0.8, d2: 0.8 },
      per_site_basis: 'dataset',
      n_sites_scored: 1,
    }), 1),
    { plot: false, by: 'unrenderable', cause: 'per_site_not_site_keyed' });

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

  // 0.9.0-draft. The greedy fork made the campaign select contributions on a
  // held-out score, so a series of THAT score across versions rises because
  // rising is the admission criterion. The type of `ScoredEvent.metric` stops
  // every call site in the repo from passing one. These cases are about the
  // wire, which is JSON and obeys no type.
  //
  // This is the one refusal in the file whose absence would produce a chart that
  // looks right. Every other cause withholds a figure that would merely be
  // unsupported; this one withholds a curve that would be wrong in a flattering
  // direction and indistinguishable from a real improvement by inspection.
  eq('a gate score in the plotted slot refuses',
    aggregateDisposition(ok({ metric: { role: 'selection' } }), 3),
    { plot: false, by: 'page', cause: 'gate_metric_as_witness' });
  // Ordering, first half. A gated record can be immaculate in every other
  // respect, so a role check placed after the completeness and floor gates would
  // pass a well-formed circular curve straight through. The fixture here is the
  // one that plots, with nothing changed but the role.
  eq('a well-formed record is still refused on its role alone',
    aggregateDisposition(ok({ metric: { role: 'selection' } }), 3).plot, false);
  // Ordering, second half. A page refusal is rendered as a figure the campaign
  // published and this page declined to draw. With no aggregate present there is
  // no such figure, so firing here would put a sentence under the chart about a
  // value that was never in the record. Absence wins, and the role check sits
  // below both absence arms for exactly this case.
  eq('a gate-roled metric with no aggregate is an absence, not an accusation',
    aggregateDisposition(ok({ metric: { role: 'selection', aggregate: null, aggregate_withheld: null } }), 3),
    { plot: false, by: 'absent' });
  eq('a gate-roled metric the service withheld is still the service\'s withhold',
    aggregateDisposition(ok({ metric: { role: 'selection', aggregate: null, aggregate_withheld: 'below_scoring_floor' } }), 3),
    { plot: false, by: 'service', cause: 'below_scoring_floor' });
  // The control. Without it the four cases above would also pass if the gate
  // refused every metric regardless of role, which would empty every curve on
  // the site.
  eq('a witness-roled metric is unaffected',
    aggregateDisposition(ok({ metric: { role: 'witness' } }), 3), { plot: true, value: 0.8 });
  // The failure direction that matters, spelled out as its own case. An unknown
  // or missing role must NOT fall through to plotting: a producer that has not
  // said whether its score gates anything has not earned the benefit of the
  // doubt, and the benefit of the doubt here is the circular curve.
  eq('an unstated role does not fall through to witness',
    aggregateDisposition(ok({ metric: { role: undefined } }), 3).plot, false);
  eq('an unrecognised role does not fall through to witness',
    aggregateDisposition(ok({ metric: { role: 'something_new' } }), 3).cause,
    'gate_metric_as_witness');

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

  // THE MEMBERSHIP TEST, as something the suite runs rather than something
  // somebody did once.
  //
  // It was applied by hand while splitting `unrenderable` out, and it found two
  // members that failed it, one of which nobody had reported. Both had been
  // wrong since 0.4.0 and went three versions unnoticed, which is the argument
  // for this block: a test applied once catches the instances present that day
  // and nothing after. What generalises is the question, not its two answers.
  //
  // Three assertions, and they only bite together. Registration alone lets a
  // cause be classified and never emitted, so the registry drifts into fiction.
  // Reachability alone lets a cause be emitted and never classified, which is
  // the original defect. Disjointness is what stops a cause satisfying both by
  // sitting in both.
  const refusalKeys = Object.keys(REFUSAL_OBLIGATION).sort();
  const limitKeys = Object.keys(PANEL_LIMIT_PERMISSION).sort();
  eq('every page refusal names the obligation it says was broken',
    refusalKeys, Object.keys(emptyTally().page).sort());
  eq('every panel limit names what permits it',
    limitKeys, Object.keys(emptyTally().unrenderable).sort());
  eq('no cause is both a breach and a permitted shape',
    refusalKeys.filter((k) => limitKeys.includes(k)), []);

  // Reachability. One case per registered cause, so a cause that cannot be
  // produced by any record fails here instead of sitting in the registry as an
  // explanation of something that never happens. The list is written out rather
  // than harvested from the cases above, because harvesting would pass by
  // whatever those cases happened to cover.
  const reached = [
    aggregateDisposition(ok({ metric: { aggregate_withheld: 'partial_map' } }), 3),
    aggregateDisposition(ok({ metric: { per_site: { a: 0.8 }, n_sites_scored: 3, eval_on: null } }), 1),
    aggregateDisposition(ok({ metric: { per_site: { a: 0.8, b: 0.8, c: 0.8, d: 0.8 } } }), 3),
    aggregateDisposition(ok({ metric: { n_sites_scored: null } }), 3),
    aggregateDisposition(ok({ metric: { n_datasets_scored: 3 } }), 3),
    aggregateDisposition(ok({ eval_on: ['a'], metric: { per_site: { a: 0.8, b: 0.8 }, n_sites_scored: 2 } }), 5),
    aggregateDisposition(ok({ eval_on: ['a', 'b', 'c'], metric: { per_site: { a: 0.8 }, n_sites_scored: 1 } }), 3),
    aggregateDisposition(ok(), null),
    aggregateDisposition(ok(pooledArm), 1),
    aggregateDisposition(ok({ metric: { per_site_basis: null } }), 3),
    aggregateDisposition(ok({ metric: { role: 'selection' } }), 3),
  ];
  eq('every registered cause is reachable from some record',
    Array.from(new Set(reached.filter((d) => d.by === 'page' || d.by === 'unrenderable').map((d) => d.cause))).sort(),
    refusalKeys.concat(limitKeys).sort());

  // A refusal must not be silently rewritten into a plot by the tally.
  const t = emptyTally();
  [
    aggregateDisposition(ok(), 3),
    aggregateDisposition(ok({ eval_on: ['a'], metric: { per_site: { a: 0.8 }, n_sites_scored: 1 } }), 3),
    aggregateDisposition(ok({ metric: { aggregate: null, aggregate_withheld: 'floor_unknown' } }), 3),
    aggregateDisposition(ok({ metric: { aggregate: null, aggregate_withheld: null } }), 3),
    aggregateDisposition(ok(pooledArm), 1),
  ].forEach((d) => tally(t, d));
  eq('tally counts plotted', t.plotted, 1);
  eq('tally counts the page refusal', t.page.below_scoring_floor, 1);
  eq('tally counts the service withhold', t.service.floor_unknown, 1);
  eq('tally counts the absence', t.absent, 1);
  eq('tally counts the panel limit', t.unrenderable.per_site_not_site_keyed, 1);
  // Every round lands in exactly one bucket. A round counted twice overstates
  // how much is missing, and a round counted nowhere is the original bug.
  //
  // This sum has to enumerate EVERY bucket or it stops being a conservation
  // check and becomes a check that four particular buckets add up. Adding
  // `unrenderable` without adding it here would have left the pooled arm
  // counted nowhere, which is the exact bug this assertion exists to catch,
  // reintroduced inside it. A conservation law with a term missing is not a
  // weaker law, it is a different one that happens to pass.
  const total = t.plotted + t.absent
    + Object.values(t.service).reduce((a, b) => a + b, 0)
    + Object.values(t.page).reduce((a, b) => a + b, 0)
    + Object.values(t.unrenderable).reduce((a, b) => a + b, 0);
  eq('every round lands in exactly one bucket', total, 5);

  console.log(fail ? `\n${fail} FAILED` : `\nall ${passed} passed`);
  process.exit(fail ? 1 : 0);
} finally {
  fs.rmSync(OUT, { recursive: true, force: true });
}
