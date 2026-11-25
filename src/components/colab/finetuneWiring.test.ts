import fs from 'fs';
import path from 'path';

/**
 * A wiring guard, and it exists because of a measured hole.
 *
 * Round 1 refused this branch for painting a FAILED run the colour of success.
 * The fix moved the status-to-outcome decision into `outcomeForStatus`, which
 * is unit-tested on its own. Round 2 then showed that was not enough: a
 * reviewer replaced the call site with a hardcoded `outcome={'completed'}` and
 * the ENTIRE suite stayed green, 155 of 155, because nothing mounts
 * Finetune.tsx and nothing checks that the component is wired to the function.
 *
 * So this asserts the WIRING, by reading the source. It is deliberately not a
 * behavioural test and does not pretend to be one: it cannot tell you the bar
 * renders correctly, only that the decision still goes through the tested
 * function rather than a literal. The behaviour is covered by
 * trainingProgress.test.ts (the mapping) and EpochProgress.test.tsx (the
 * colour, including that it fails safe when the prop is absent).
 *
 * The honest alternative is a test that mounts Finetune.tsx. That component is
 * over 1000 lines with a Hypha server, a router and a store behind it, so the
 * harness is a piece of work in its own right. Until it exists, this is what
 * makes the round-2 mutation go red.
 */
const SRC = fs.readFileSync(
  path.join(__dirname, 'Finetune.tsx'),
  'utf8',
);

describe('Finetune.tsx is wired to the tested outcome mapping', () => {
  it('imports outcomeForStatus', () => {
    expect(SRC).toMatch(/import \{[^}]*outcomeForStatus[^}]*\} from '\.\.\/\.\.\/utils\/trainingProgress'/);
  });

  it('passes the mapping of the session status, not a literal, to EpochProgress', () => {
    // The exact regression this guards: outcome={'completed'} or
    // outcome="completed" at the call site.
    expect(SRC).toContain('outcome={outcomeForStatus(s.status)}');
    expect(SRC).not.toMatch(/outcome=\{?['"]completed['"]\}?/);
    expect(SRC).not.toMatch(/outcome=\{?['"]unsuccessful['"]\}?/);
  });

  it('still renders EpochProgress at all', () => {
    // Deleting the component from the card was the other way every suite could
    // stay green while the feature disappeared.
    // A substring match is not enough: '<EpochProgress' is contained in
    // '<EpochProgressXXX', so renaming the element away passed this case until
    // a mutation caught it. Require the element form.
    expect(SRC).toMatch(/<EpochProgress[\s/>]/);
  });
});
