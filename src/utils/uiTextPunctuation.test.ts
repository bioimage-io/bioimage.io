import { execFileSync } from 'child_process';
import path from 'path';

/**
 * Wires scripts/check-ui-text.js into `pnpm test`, so CLAUDE.md's ban on em dashes in
 * user-visible copy is enforced by a command rather than by an agent having read a rule.
 *
 * The checker walks the TypeScript AST. A grep cannot do this job: measured 2026-11-04,
 * 257 of the em dashes under src/ are in comments, console logs and regexes, where the
 * rule exempts them, so a grep gate would be red on arrival and switched off.
 */

const SCRIPT = path.resolve(__dirname, '..', '..', 'scripts', 'check-ui-text.js');

/** @returns the checker's combined output, or throws with that output on a non-zero exit. */
function runChecker(args: string[] = []): string {
  try {
    return execFileSync(process.execPath, [SCRIPT, ...args], { encoding: 'utf8', stdio: 'pipe' });
  } catch (err: any) {
    const out = `${err.stdout || ''}${err.stderr || ''}`;
    throw new Error(`check-ui-text.js exited ${err.status}:\n${out}`);
  }
}

describe('user-visible text punctuation', () => {
  it('finds no banned dash in any user-visible string under src', () => {
    expect(runChecker()).toContain('no banned dashes');
  });

  it('actually read the tree it is reporting on', () => {
    // A scan that matched nothing reports clean. Assert it saw a plausible amount of the
    // repo, so this cannot pass by the file walk or the AST walk having quietly stopped
    // working. The checker carries the same floors and exits 2 below them.
    const out = runChecker();
    const strings = Number(/ok\s+(\d+) user-visible string/.exec(out)?.[1]);
    const files = Number(/across (\d+) file/.exec(out)?.[1]);
    expect(files).toBeGreaterThanOrEqual(150);
    expect(strings).toBeGreaterThanOrEqual(10000);
  });

  it('still discriminates: a fixture of planted violations is caught, exempt lines are not', () => {
    // --self-test builds a fixture of 18 dash-bearing lines, 8 on a user-visible surface
    // and 10 exempt, and asserts each one individually. Without this, the green above
    // would be indistinguishable from a check that stopped looking.
    const out = runChecker(['--self-test']);
    expect(out).not.toContain('FAIL');
    expect(out).toMatch(/\b(\d+) passed, 0 failed, \1 checks ran/);
    const ran = Number(/(\d+) checks ran/.exec(out)?.[1]);
    expect(ran).toBeGreaterThanOrEqual(22);
  });
});
