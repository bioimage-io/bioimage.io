import { execFileSync } from 'child_process';
import path from 'path';

/**
 * Puts scripts/check-skill-frontmatter.js inside `pnpm test`, so a SKILL.md published at
 * https://bioimage.io/skills/ cannot ship with frontmatter that does not parse.
 *
 * This exists because that happened. On 2026-11-18, fixing a reported problem with the
 * bioengine skill (its anti-WebFetch warning was unreadable before the first fetch) put a
 * banner into the frontmatter `description:` as a double-quoted scalar whose closing quote
 * landed mid-sentence. The frontmatter stopped parsing, which would have made the file
 * unloadable as a skill rather than merely summarised badly. Nothing caught it: the
 * production build does not read `public/`, and the dash check only walks `src/`.
 */

const SCRIPT = path.resolve(__dirname, '..', '..', 'scripts', 'check-skill-frontmatter.js');

/** @returns the checker's stdout, or throws with its combined output on a non-zero exit. */
function runChecker(args: string[] = []): string {
  try {
    return execFileSync(process.execPath, [SCRIPT, ...args], { encoding: 'utf8', stdio: 'pipe' });
  } catch (err: any) {
    const out = `${err.stdout || ''}${err.stderr || ''}`;
    throw new Error(`check-skill-frontmatter.js exited ${err.status}:\n${out}`);
  }
}

describe('served skill frontmatter', () => {
  it('parses, and carries the keys the skill loader needs', () => {
    expect(runChecker()).toContain('frontmatter parses');
  });

  it('actually read the skills it reports on', () => {
    // A scan that matched nothing reports clean. The checker exits 2 below its own floor;
    // this asserts the count independently so the suite cannot go green on an empty scan.
    const out = runChecker();
    const files = Number(/ok\s+(\d+) served SKILL\.md/.exec(out)?.[1]);
    expect(files).toBeGreaterThanOrEqual(2);
  });

  it('still discriminates: the real 2026-11-18 defect is caught, valid shapes are not', () => {
    // --self-test writes six fixtures, four of which must be flagged, including the exact
    // quoted-scalar-closed-mid-sentence shape that caused the regression.
    const out = runChecker(['--self-test']);
    expect(out).not.toContain('FAIL');
    expect(out).toMatch(/\b(\d+) passed, 0 failed, \1 checks ran/);
  });
});
