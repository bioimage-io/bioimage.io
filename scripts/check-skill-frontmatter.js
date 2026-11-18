#!/usr/bin/env node
/**
 * Fail when a SKILL.md served from public/skills/ has frontmatter that does not parse,
 * or that is missing a key the skill loader needs.
 *
 * Why this exists. On 2026-11-13 an agent reported that fetching
 * https://bioimage.io/skills/bioengine/SKILL.md with a summarising tool returned a prose
 * digest with every code block stripped. The fix was a banner in the frontmatter
 * `description:`, and the edit closed the double-quoted scalar mid-sentence:
 *
 *     description: "AGENTS: FETCH THIS FILE WITH ... methods." Load app subskills in apps/ ...
 *
 * which YAML reads as a scalar followed by a second scalar where the mapping should end. The
 * frontmatter stopped parsing, so `name`, `description`, `license` and `metadata` all became
 * unavailable and the file was no longer loadable as a skill AT ALL -- a worse version of the
 * problem being fixed. Nothing caught it: `react-scripts build` does not read `public/`, and
 * `scripts/check-ui-text.js` only walks `src/`.
 *
 * These files are PUBLISHED at https://bioimage.io/skills/, so a break here reaches every
 * agent that loads the skill, not just this repo.
 *
 * Usage:
 *   node scripts/check-skill-frontmatter.js              # gate: exit 1 on any bad file
 *   node scripts/check-skill-frontmatter.js --self-test  # prove it can still go RED
 */
const fs = require('fs');
const os = require('os');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const SKILL_ROOT = path.join(ROOT, 'public', 'skills');

// The keys the skill loader reads. `name` and `description` are what make a file loadable and
// discoverable; the rest are optional and deliberately not required here.
const REQUIRED_KEYS = ['name', 'description'];

// A scan that found nothing reports clean, so a clean result is only believable if it also read
// the files. Measured 2026-11-18: 2 served SKILL.md files. Falling below this exits 2, not 0.
const MIN_FILES = 2;

let yaml;
try {
  yaml = require('js-yaml');
} catch (err) {
  console.error(`SKIP  cannot load js-yaml (${err.message}) -- the check did not run`);
  process.exit(2);
}

function skillFiles(dir, acc = []) {
  if (!fs.existsSync(dir)) return acc;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) skillFiles(full, acc);
    else if (entry.name === 'SKILL.md') acc.push(full);
  }
  return acc;
}

/**
 * @returns {{file: string, problem: string, detail: string}[]} what is wrong with this file.
 */
function inspect(file, relativeTo) {
  const rel = path.relative(relativeTo, file);
  const text = fs.readFileSync(file, 'utf8');
  const problems = [];

  if (!text.startsWith('---\n')) {
    problems.push({ file: rel, problem: 'no frontmatter block', detail: 'the file does not begin with ---' });
    return problems;
  }
  // Split on the closing fence, not on every '---': a horizontal rule later in the body is
  // also '---' on its own line, and splitting naively would truncate the document.
  const end = text.indexOf('\n---', 3);
  if (end === -1) {
    problems.push({ file: rel, problem: 'unterminated frontmatter', detail: 'no closing --- found' });
    return problems;
  }
  const front = text.slice(4, end + 1);

  let doc;
  try {
    doc = yaml.load(front);
  } catch (err) {
    // Point at the line IN THE FILE, which is what a reader opens. js-yaml's mark is 0-based and
    // relative to the frontmatter body, so add 1 to make it 1-based and 1 more for the opening
    // `---` fence that is not part of what was parsed.
    const reason = err.reason || String(err.message || err).split('\n')[0];
    const detail = err.mark
      ? `${reason} (line ${err.mark.line + 2}, column ${err.mark.column + 1})`
      : String(reason).replace(/\s+/g, ' ').trim().slice(0, 240);
    problems.push({ file: rel, problem: 'frontmatter does not parse', detail });
    return problems;
  }

  if (doc === null || typeof doc !== 'object' || Array.isArray(doc)) {
    problems.push({ file: rel, problem: 'frontmatter is not a mapping', detail: `parsed as ${Array.isArray(doc) ? 'array' : typeof doc}` });
    return problems;
  }
  for (const key of REQUIRED_KEYS) {
    const v = doc[key];
    if (v === undefined || v === null || String(v).trim() === '') {
      problems.push({ file: rel, problem: `missing or empty '${key}'`, detail: `keys present: ${Object.keys(doc).join(', ') || '(none)'}` });
    }
  }
  return problems;
}

function scan(root, relativeTo) {
  const files = skillFiles(root);
  const problems = files.flatMap((f) => inspect(f, relativeTo));
  return { files, problems };
}

function report(problems) {
  for (const p of problems) {
    console.error(`FAIL  ${p.file}: ${p.problem}`);
    console.error(`        ${p.detail}`);
  }
}

/**
 * Prove the gate discriminates, on fixtures written to a temp dir. Each case states whether it
 * MUST be flagged, and the assertion reads that rather than a hardcoded count.
 */
function selfTest() {
  const GOOD = `---\nname: good\ndescription: A valid one-line description.\n---\n\n# Body\n\n---\n\nA horizontal rule above must not confuse the parser.\n`;
  // The real defect: a double-quoted scalar closed mid-sentence, then prose.
  const BROKEN_QUOTE = `---\nname: bad\ndescription: "AGENTS: fetch with curl, not WebFetch." Load the subskills too.\nlicense: MIT\n---\n\n# Body\n`;
  const BLOCK_SCALAR = `---\nname: blockok\ndescription: >-\n  AGENTS: fetch this with curl -sSL, not WebFetch: a summarising tool strips\n  every code block. Single entry point for the task.\n---\n\n# Body\n`;
  const NO_FRONT = `# Just a heading\n\nNo frontmatter at all.\n`;
  const MISSING_DESC = `---\nname: nodesc\nlicense: MIT\n---\n\n# Body\n`;
  const NOT_MAPPING = `---\n- just\n- a list\n---\n\n# Body\n`;

  const cases = [
    ['good/SKILL.md', GOOD, false, 'valid frontmatter, with a --- rule in the body'],
    ['broken/SKILL.md', BROKEN_QUOTE, true, 'quoted scalar closed mid-sentence then prose (the real 2026-11-18 defect)'],
    ['block/SKILL.md', BLOCK_SCALAR, false, 'the recommended >- block scalar, with a colon inside'],
    ['nofront/SKILL.md', NO_FRONT, true, 'no frontmatter block'],
    ['nodesc/SKILL.md', MISSING_DESC, true, 'missing description'],
    ['notmap/SKILL.md', NOT_MAPPING, true, 'frontmatter is a list, not a mapping'],
  ];

  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'skill-frontmatter-selftest-'));
  for (const [rel, body] of cases) {
    const full = path.join(dir, rel);
    fs.mkdirSync(path.dirname(full), { recursive: true });
    fs.writeFileSync(full, body);
  }

  let pass = 0;
  let fail = 0;
  const say = (ok, what) => {
    if (ok) pass += 1; else fail += 1;
    console.log(`${ok ? 'ok  ' : 'FAIL'}  ${what}`);
  };

  const { files, problems } = scan(dir, dir);
  const flagged = new Set(problems.map((p) => p.file));

  say(files.length === cases.length, `all ${cases.length} fixtures were read (saw ${files.length})`);
  for (const [rel, , mustFlag, what] of cases) {
    const isFlagged = flagged.has(rel);
    say(isFlagged === mustFlag, `${mustFlag ? 'flagged' : 'clean  '}: ${what}`);
  }
  const expected = cases.filter(([, , m]) => m).length;
  say(flagged.size === expected, `exactly ${expected} fixture(s) flagged, no others (saw ${flagged.size})`);
  // The parse error must name a position, or it is not actionable.
  const parseErr = problems.find((p) => p.problem === 'frontmatter does not parse');
  say(!!parseErr && /line \d+/.test(parseErr.detail), 'the parse failure reports a line number');

  fs.rmSync(dir, { recursive: true, force: true });
  console.log(`\n${pass} passed, ${fail} failed, ${pass + fail} checks ran`);
  process.exit(fail ? 1 : 0);
}

if (process.argv.includes('--self-test')) selfTest();

const { files, problems } = scan(SKILL_ROOT, ROOT);

if (files.length < MIN_FILES) {
  console.error(
    `SKIP  found ${files.length} SKILL.md under public/skills, expected at least ${MIN_FILES} -- ` +
      'the scan did not cover what it reports on, so it proves nothing. This is not a pass.',
  );
  process.exit(2);
}

if (problems.length) {
  report(problems);
  console.error(
    `\n${problems.length} problem(s) across ${files.length} served skill file(s). These are ` +
      'published at https://bioimage.io/skills/, so a frontmatter that does not parse stops the ' +
      'skill loading for every agent. For a long description prefer a `>-` block scalar over a ' +
      'quoted one-liner.',
  );
  process.exit(1);
}

console.log(`ok    ${files.length} served SKILL.md file(s), frontmatter parses and carries ${REQUIRED_KEYS.join(' + ')}`);
process.exit(0);
