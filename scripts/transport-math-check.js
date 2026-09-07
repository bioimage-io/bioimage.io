#!/usr/bin/env node
/**
 * Checks the transport multiplier arithmetic in
 * src/components/campaigns/transportMath.ts.
 *
 * It exists as a standalone script because this repo has no working unit-test
 * runner: the declared TypeScript is 3.9.10 against a tsconfig needing 4.1+, so
 * `react-scripts test` and `tsc --noEmit` are broken repo-wide and gating on
 * either would mean gating on ~2178 pre-existing errors. The module under test
 * is pure and imports nothing but a type, so it compiles and runs alone.
 *
 * The Playwright spec covers what the PAGE renders. This covers the arithmetic
 * underneath it, where an off-by-one in a coefficient is invisible on screen:
 * a wrong multiplier still draws a smooth plausible curve, just in the wrong
 * place, and no rendering assertion would catch it.
 *
 *   node scripts/transport-math-check.js
 *
 * Exits non-zero on any failure. Emits into a temp dir and cleans up.
 */
const { execFileSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const REPO = path.resolve(__dirname, '..');
const OUT = fs.mkdtempSync(path.join(os.tmpdir(), 'transport-math-'));

try {
  // tsc reports parse errors from modern .d.ts files under TS 3.9.10 and still
  // emits. Emission is what matters here, so the exit code is ignored and the
  // check is whether the artefact exists.
  try {
    execFileSync(
      path.join(REPO, 'node_modules/.bin/tsc'),
      [
        path.join(REPO, 'src/components/campaigns/transportMath.ts'),
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

  const emitted = path.join(OUT, 'components/campaigns/transportMath.js');
  if (!fs.existsSync(emitted)) {
    console.error('FAIL: transportMath.ts did not compile, nothing to check');
    process.exit(1);
  }

  const { roundMultiplier, cumulativeTransport } = require(emitted);

  let fail = 0;
    let passed = 0;
  const eq = (name, got, want) => {
    const g = JSON.stringify(got), w = JSON.stringify(want);
    if (g !== w) { console.log(`FAIL ${name}\n  got  ${g}\n  want ${w}`); fail++; }
    else { console.log(`ok   ${name}`); passed++; }
  };
  const R = (round, participants, eval_on) => ({ round, participants, eval_on });
  const S = ['a','b','c','d','e','f'];

  // able-clam's two reference values.
  eq('full participation N=6 -> 19', roundMultiplier(R(0, S, S)).value, 19);
  eq('LOSO 5 train / 6 eval -> 17', roundMultiplier(R(0, S.slice(0,5), S)).value, 17);

  // The union is a union, not a concatenation: overlap must not double count.
  eq('overlap not double counted', roundMultiplier(R(0, S, S.slice(0,3))).value, 19);
  // An evaluator who never trained still reads the aggregate.
  eq('eval-only site adds a read', roundMultiplier(R(0, S.slice(0,5), ['z'])).value, 2*5+1+6);

  // Gaps discriminate.
  eq('null eval_on withholds', roundMultiplier(R(0, S, null)), { known:false, gap:'eval_set_unreported' });
  eq('empty participants withholds', roundMultiplier(R(0, [], S)), { known:false, gap:'no_participants' });

  // The fallback we deliberately refuse: assuming eval == participants would
  // have returned 19 here instead of withholding.
  eq('no silent fallback to 3N+1', roundMultiplier(R(0, S, null)).value, undefined);

  // Cumulative: 3 full rounds at 1000 bytes, multiplier 19 each.
  const three = [R(0,S,S), R(1,S,S), R(2,S,S)];
  const c1 = cumulativeTransport(three, 1000, null);
  eq('cumulative accumulates', c1.points.map(p=>p.bytesMoved), [19000, 38000, 57000]);
  eq('no crossover without corpus', c1.crossoverRound, null);

  // Crossover is the FIRST round strictly exceeding the corpus.
  eq('crossover at first exceedance', cumulativeTransport(three, 1000, 20000).crossoverRound, 1);
  eq('crossover null if never reached', cumulativeTransport(three, 1000, 10_000_000).crossoverRound, null);

  // A mixed series must not use a flat coefficient.
  const mixed = [R(0,S,S), R(1,S.slice(0,5),S), R(2,S,S)];
  eq('mixed series uses per-round sets', cumulativeTransport(mixed, 1000, null).points.map(p=>p.multiplier), [19,17,19]);
  eq('flat 3N+1 would have overstated', cumulativeTransport(mixed,1000,null).points[2].bytesMoved, 55000);

  // A hole in the middle is flagged; a gap at the end is not.
  const holed = [R(0,S,S), R(1,S,null), R(2,S,S)];
  eq('mid-series gap sets holed', cumulativeTransport(holed, 1000, null).holed, true);
  eq('mid-series gap counted', cumulativeTransport(holed, 1000, null).gaps.eval_set_unreported, 1);
  const tail = [R(0,S,S), R(1,S,S), R(2,S,null)];
  eq('trailing gap does not set holed', cumulativeTransport(tail, 1000, null).holed, false);
  // A gap BEFORE any point is not a hole either: nothing after it is understated
  // relative to a total that never started.
  const lead = [R(0,S,null), R(1,S,S)];
  eq('leading gap does not set holed', cumulativeTransport(lead, 1000, null).holed, false);

  // Out-of-order records accumulate in round order, not array order.
  eq('sorted by round', cumulativeTransport([R(2,S,S), R(0,S,S), R(1,S,S)], 1000, null).points.map(p=>p.round), [0,1,2]);

  // No payload size: no points, and every round attributed to the right reason.
  const noPay = cumulativeTransport([R(0,S,S), R(1,S,null)], null, 999);
  eq('no payload -> no points', noPay.points.length, 0);
  eq('no payload attributed separately', noPay.gaps.payload_size_unreported, 1);
  eq('shape gap still attributed to shape', noPay.gaps.eval_set_unreported, 1);


  console.log(fail ? `\n${fail} FAILED` : `\nall ${passed} passed`);
  process.exit(fail ? 1 : 0);
} finally {
  fs.rmSync(OUT, { recursive: true, force: true });
}
