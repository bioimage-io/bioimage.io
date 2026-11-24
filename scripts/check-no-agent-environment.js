#!/usr/bin/env node
/**
 * Fail if a tracked file names the agent environment.
 *
 * This repository is public. CLAUDE.md forbids publishing anything about the
 * environment an agent works in: session ids or names, workspace ids, the
 * agent's own backlog, the names and commands of the agent tooling, machine
 * names, and absolute paths on a developer's machine. This is the check that
 * makes that rule mechanical, because the rule was already written and was
 * still broken: a sweep script reached a public pull request carrying two
 * session ids, two workspace ids and five absolute paths.
 *
 *   node scripts/check-no-agent-environment.js              # exit 1 on a violation
 *   node scripts/check-no-agent-environment.js --self-test  # prove it goes RED
 *
 * WHY THERE IS NO REGEX FOR A SESSION ID
 * --------------------------------------
 * A session id looks like `<word>-<word>-<six letters>`. Matching that shape
 * over this tree returns 475 lines in 52 files, 373 of them in pnpm-lock.yaml,
 * and a tightened variant returned 620. Measured 2026-11-18. A gate that is red
 * on arrival gets switched off, which this repo already learned when the dash
 * rule became an AST check instead of a grep.
 *
 * So session ids are matched LITERALLY, against the live session list read from
 * the agent tooling at run time. The list is never written into this repository,
 * because a deny-list of session ids would itself be the leak it is meant to
 * prevent.
 *
 * WHEN A RULE CANNOT RUN, IT SAYS SO
 * ---------------------------------
 * In CI there is no agent tooling and no developer home, so the session-id,
 * session-name and by-name developer-path rules cannot run. They report NOT CHECKED and the exit code
 * stays 0 for them. That is deliberate and it is the honest failure: a check
 * that silently skips its own best test and prints a green tick is worse than
 * one that admits what it could not look at.
 */

'use strict';

const { execFileSync } = require('child_process');
const os = require('os');

const fs = require('fs');
const path = require('path');

/**
 * The words that name the agent tooling are NOT IN THIS FILE.
 *
 * CLAUDE.md forbids a tracked file in this public repository from naming the private
 * deployment, and that applies to the checker exactly as much as to what it checks. A gate
 * that publishes the vocabulary it is protecting is the shape this whole exercise exists to
 * stop, and an earlier version of this file broke the rule it enforces: it held the tool's
 * name split across a concatenation, the backlog directory the same way, and two environment
 * variables named after the deployment. Splitting a word over a `+` hides it from the regex,
 * not from a reader.
 *
 * Sources, first non-empty wins. All three are outside git:
 *
 *   AGENT_VOCAB         comma-separated words
 *   AGENT_VOCAB_FILE    a file of words, one per line, `#` comments allowed
 *   <repo>/.agent-vocab the default of the above, git-ignored
 *
 * WITH NO VOCABULARY the rules that need it are NOT CHECKED: they are dropped from the rule
 * set, named in the summary, and counted. That is the honest behaviour and it is what makes
 * this safe in CI, where there is no configuration and nothing to hide. It is NOT a silent
 * pass: a run with no vocabulary says so on its own output, in the same place the other
 * unrunnable rules report.
 */
function vocabulary() {
  const clean = (words) => words
    .map((w) => w.split('#')[0].trim().toLowerCase())
    .filter((w) => /^[a-z][a-z0-9_-]{2,}$/.test(w));

  const inline = clean((process.env.AGENT_VOCAB || '').split(','));
  if (inline.length) return inline;

  const candidates = [
    process.env.AGENT_VOCAB_FILE,
    path.join(__dirname, '..', '.agent-vocab'),
  ].filter(Boolean);
  for (const candidate of candidates) {
    let text;
    try {
      text = fs.readFileSync(candidate, 'utf8');
    } catch {
      // Absent is the CI case and is not an error: handled by returning [] below.
      continue;
    }
    const words = clean(text.split('\n'));
    if (words.length) return words;
    // PRESENT but yielding nothing is a different thing from absent, and the difference is
    // worth saying out loud. Absent means "this is CI, those rules do not apply"; present and
    // empty means somebody configured this and it is not working, which would otherwise read
    // as the same green. Not fatal, because refusing to run the other dozen rules over a
    // malformed side file would be the worse failure.
    console.error(
      `WARNING: ${candidate} exists but supplied no usable word, so the rules that need one `
      + 'will report NOT CHECKED. Expected one word per line, 3+ characters, '
      + 'lowercase letters, digits, hyphen or underscore.',
    );
  }
  return [];
}

const VOCAB = vocabulary();
// Longest first, so an alternation prefers the longer word where one contains the other.
const VOCAB_ALT = VOCAB.length
  ? [...VOCAB].sort((a, b) => b.length - a.length).map((w) => w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|')
  : '';

/**
 * Environment variable names derived from the vocabulary, so the literal never appears here.
 *
 * `AGENT_SESSION_ID` and `AGENT_MACHINE` are the generic spellings and are tried first, so a
 * caller can supply them with no vocabulary at all. The derived spellings keep the live
 * environment working without anyone having to re-export anything.
 */
function envValue(suffix, generic) {
  const direct = (process.env[generic] || '').trim();
  if (direct) return direct;
  for (const word of VOCAB) {
    const value = (process.env[`${word.toUpperCase().replace(/-/g, '_')}${suffix}`] || '').trim();
    if (value) return value;
  }
  return '';
}

const SKIP_EXT = new Set([
  '.png', '.jpg', '.jpeg', '.gif', '.ico', '.woff', '.woff2', '.ttf', '.eot',
  '.pdf', '.zip', '.gz', '.mp4', '.webm', '.wasm',
]);

// Files that are generated or vendored, so a match in them is not authored here
// and cannot be fixed by editing. Keep this list short and justified.
const SKIP_FILES = new Set([
  'pnpm-lock.yaml',               // dependency graph; hyphenated package names
  'public/kernel.worker.js',      // built Pyodide bundle
  'public/web-python-kernel.mjs', // built Pyodide bundle
]);

// An inline marker exempts one line, spelled like this repo's existing
// `ui-text-check: allow`. For a path that is genuinely a container or runtime
// location rather than a developer machine.
const ALLOW = 'agent-env' + '-check: allow';

// Always-on patterns. Each is precise enough to have ZERO matches on a clean
// tree, which is what makes the check worth leaving switched on.
const ROOTS = String.raw`(?:data|home|Users)`;
// Container and runtime accounts that are legitimate in this repository.
const NOT_RUNTIME = String.raw`(?!(?:pyodide|bioengine|hypha|runner|root|me|user|node|app|vscode|ubuntu)\b)`;
const ID_SHAPE = String.raw`[a-z]{3,}-[a-z]{3,}-[a-z]{6}`;
const WS_SHAPE = String.raw`ws-[a-z0-9]+(?:-[a-z0-9]+)*-[0-9a-f]{8}`;

const PATTERNS = [
  {
    // THE LEAK VECTOR ITSELF: an id-shaped literal assigned to, or passed as, something that
    // names a session or a workspace. A bare shape rule for a session id is unusable here,
    // 667 hits across the tree on ordinary hyphenated words, so the POSITION is what makes
    // this precise enough to be a hard gate.
    //
    // The name part is `[a-z_-]*(?:session|workspace)[a-z_-]*`, not `\b(?:session|...)`: the
    // identifier only has to CONTAIN the word. `WEBSITE_SESSION = "..."` is the exact shape
    // that leaked, and `\bSESSION` does not match it, because `_S` is not a word boundary.
    //
    // The hyphen in that class, and the `["']?` after it, are each worth one sentence because
    // each was a hole a reviewer found by trying the shape rather than reading it. `[a-z_]*`
    // excludes `-`, so a kebab-case key walked straight past: `session-id: <id>` scored 0.
    // And a key is quoted in half the formats that matter, so the closing quote sits between
    // the name and the colon: `{"sessionId": "<id>"}` scored 0 as well. Both are now cases in
    // group [16] and both go red without this line.
    //
    // Quotes around the VALUE stay optional for the same reason: an unquoted YAML mapping, or
    // a bare shell assignment, leaks exactly as well as a quoted one.  // agent-env-check: allow
    //
    // `--as` is in the flag alternative because it names a session positionally, with no word
    // in the flag itself to match on.
    name: 'agent session or workspace id in a session/workspace position',
    re: new RegExp(
      String.raw`(?:` +
        String.raw`[a-z_-]*(?:session|workspace)[a-z_-]*["']?\s*[=:]\s*["']?(?:${ID_SHAPE}|${WS_SHAPE})["']?` +
        String.raw`|environ(?:\.get)?\([^)]*(?:session|workspace)[^)]*["'](?:${ID_SHAPE}|${WS_SHAPE})["']` +
        String.raw`|--(?:session|workspace|as)[=\s]+(?:${ID_SHAPE}|${WS_SHAPE})\b` +
      String.raw`)`,
      'gi',
    ),
    why: 'an id in a position that names a session or a workspace',
  },
  {
    name: 'workspace id',
    re: /\bws-[a-z0-9-]+-[0-9a-f]{8}\b/g,
    why: 'an agent workspace id',
  },
  // THE THREE VOCABULARY RULES. Each needs the words that name the tooling, which are not in
  // this file, so each is present only when a vocabulary was configured. With none, they are
  // absent from the rule set and the summary says which rules did not run. See vocabulary().
  ...(VOCAB_ALT ? [
    {
      name: 'agent backlog directory',
      re: new RegExp(`\\.(?:${VOCAB_ALT})\\b`, 'g'),
      why: 'the state directory of that tooling',
      needsVocab: true,
    },
    {
      name: 'agent tooling command',
      re: new RegExp(
        `\\b(?:${VOCAB_ALT})\\s+(?:issue|session|workflow|workspace|collection|token|process)\\b`,
        'g',
      ),
      why: 'an agent tooling command, which only makes sense inside the agent environment',
      needsVocab: true,
    },
    {
      // A reference to the automated contributor's own tracker. The tooling-command rule above
      // does not catch a tool name followed by a row number, and the other tracker's name was
      // not matched at all; 27 tracked lines in 16 files name a backlog row this way, which is
      // why this rule exists separately.
      name: 'agent backlog reference',
      re: new RegExp(`\\b(?:${VOCAB_ALT})\\s*#\\s*\\d{2,}`, 'gi'),
      why: "a row number in the automated contributor's own backlog",
      needsVocab: true,
    },
  ] : []),
  {
    // The BARE form, with no tool name in front of it. The rule above only
    // catches a row number that announces which tracker it belongs to, and most
    // of them do not: 13 tracked lines across src, tests and notes cited a row by
    // its number alone, sometimes in parentheses. That means nothing to a public
    // reader and gets copied into every later diff.
    //
    // The leading zero is what makes this safe to switch on. Backlog rows are
    // written zero-padded to four digits; this repository's own GitHub issues
    // are two or three digits and never padded, so `#167` does not fire. The
    // one real collision would be a four-digit CSS colour that happens to start
    // with a zero, and there are none in this tree: every colour here is a
    // six-digit hex, a Tailwind class or an MUI token. If one ever appears, the
    // allow marker covers it.
    //
    // Measured 2026-11-20: 13 matches before the rewrite, 0 after.
    name: 'bare backlog row number',
    re: /#0\d{3}\b/g,
    why: 'a backlog row number, which is meaningless outside the agent environment',
  },
  {
    // A person's home or data directory, by SHAPE rather than by name, so this
    // runs in CI where there is no developer home and so that naming the
    // developer is not itself required to forbid naming the developer.
    //
    // The excluded names are container and runtime accounts, which are
    // legitimate in this repo: a Pyodide sandbox, a BioEngine worker image, a
    // Hypha container, a CI runner, and `me` as a documentation placeholder.
    // Measured 2026-11-18: with them excluded this pattern has zero matches on
    // a clean tree, and it had 41 before the developer paths were removed.
    name: 'developer home or data path',
    // The lookbehind used to reject any preceding alphanumeric, which meant a root nested
    // under another, `/mnt/data/<owner>/...` or `/srv/home/<owner>`, was NOT caught: the `t`
    // of `/mnt` sits right before the slash. Only a dot or a word character that would make
    // this part of a LONGER path segment should disqualify it, so a preceding slash is fine.
    re: new RegExp(
      String.raw`(?<![A-Za-z0-9.])\/${ROOTS}\/${NOT_RUNTIME}[A-Za-z][A-Za-z0-9_.-]*` +
      // A root NESTED under another one, `/mnt/data/<owner>` or `/srv/home/<owner>`. The
      // first alternative cannot see these: the `t` of `/mnt` sits immediately before the
      // slash and its lookbehind rejects any alphanumeric.
      //
      // The prefix slash must not itself follow `:` or `/`, which is what keeps a URL out:
      // in `https://example.com/home/dashboard` the slash before the host is the second of
      // `//`, so this cannot start there, and starting after `.com` finds no second root.
      // The first version of this fix dropped that condition and fired on exactly that URL,
      // which the self-test caught.
      String.raw`|(?<![:\/])\/[A-Za-z0-9_.-]+\/${ROOTS}\/${NOT_RUNTIME}[A-Za-z][A-Za-z0-9_.-]*`,
      'gi',
    ),
    why: "an absolute path under somebody's home or data directory",
  },
];

function trackedFiles() {
  return execFileSync('git', ['ls-files'], { encoding: 'utf8' })
    .split('\n')
    .filter(Boolean);
}

/** Developer machine roots to forbid, or null when they cannot be determined. */
function developerRoots() {
  // Configured explicitly wins, so CI can assert the rule without a home dir.
  const configured = (process.env.AGENT_ENV_FORBIDDEN_ROOTS || '').trim();
  if (configured) return configured.split(':').filter(Boolean);

  const home = process.env.HOME || '';
  // A CI runner's home (/home/runner, /github/home) is not a developer machine
  // and must not be forbidden, or the check fires on nothing useful.
  if (!home || /^\/(?:github|root)$/.test(home) || /\/runner$/.test(home)) return null;
  const user = path.basename(home);
  if (!user || user.length < 2) return null;
  // Both the home directory and the sibling data root this machine uses.
  return [`/home/${user}`, `/data/${user}`, `/Users/${user}`];
}

/**
 * Live session ids, from the agent tooling AND from this process's own environment.
 *
 * The env var matters on its own: the registry is unreachable in CI and whenever the tooling
 * is absent, but a session running the check still knows its OWN id, and that id is the one
 * most likely to be pasted into a file by the session doing the pasting.
 */
function sessionIds() {
  const ids = new Set();
  const own = envValue('_SESSION_ID', 'AGENT_SESSION_ID');
  if (own) ids.add(own);
  try {
    // The command's name comes from the configured vocabulary, never from this file. With no
    // vocabulary there is nothing to invoke, and the throw below takes the same path as a
    // missing binary: the live list is skipped and whatever the environment supplied stands.
    if (!VOCAB.length) throw new Error('no vocabulary configured');
    const out = execFileSync(VOCAB[0], ['session', 'list', '--json', '--all'], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
      timeout: 20000,
    });
    const rows = JSON.parse(out);
    const list = Array.isArray(rows) ? rows : rows.sessions || [];
    for (const r of list) {
      const id = r && (r.id || r.sessionId);
      if (typeof id === 'string' && id) ids.add(id);
    }
  } catch {
    // Tooling absent, e.g. in CI. Any id from the environment still stands.
  }
  // Under eight characters would match ordinary words.
  const kept = [...ids].filter((v) => v.length >= 8);
  return kept.length ? kept : null;
}

/**
 * This machine's hostname, to be matched LITERALLY.
 *
 * A hostname by shape is nearly clean but still matched a hyphenated name in a tracked script,
 * so shape is not usable. Matching literally without storing the value is the point: it comes
 * from the machine at run time, so no denylist is ever written down.
 */
function machineNames() {
  const names = new Set();
  const host = (os.hostname() || '').trim();
  // A CI runner's hostname is not this machine's and must not be forbidden, or the gate fires
  // on nothing useful and teaches people to ignore it.
  if (host && !/^(?:runner|fv-az|localhost|buildkitsandbox)/i.test(host)) {
    names.add(host);
    if (host.includes('.')) names.add(host.split('.')[0]);
  }
  const machine = envValue('_MACHINE', 'AGENT_MACHINE');
  if (machine) names.add(machine);
  const kept = [...names].filter((v) => v.length >= 4);
  return kept.length ? kept : null;
}

/**
 * The NAMES of sessions, derived by dropping the random suffix off each id.
 *
 * HONEST LIMIT, because this rule is weaker than it looks: it covers only names
 * whose session is still in the reachable list. A name from another workspace or
 * from a session that has since been forgotten is NOT caught, and two such names
 * were found in 14 tracked files by hand after this rule was written. So the
 * gate reduces the chance of a recurrence; it cannot be trusted to maintain this
 * class on its own, and a reviewer still has to look.
 */
function sessionNames(ids) {
  if (!ids) return null;
  const names = ids
    .filter((id) => id.split('-').length >= 3)
    .map((id) => id.split('-').slice(0, -1).join('-'));
  return names.length ? Array.from(new Set(names)) : null;
}

function scan() {
  const files = trackedFiles();
  const roots = developerRoots();
  const ids = sessionIds();
  const machines = machineNames();
  const names = sessionNames(ids);
  const violations = [];
  let scanned = 0;
  let matchable = 0; // lines the always-on patterns could have matched
  // Every skip is COUNTED, because a skipped file reports no violation for
  // exactly the same reason a clean one does, and the two are indistinguishable
  // in the output unless the skips are declared. `unreadable` and `notAFile` are
  // the two that are a fault rather than a decision: git lists those paths, so
  // they are committed and published, and the check did not look at them.
  const skipped = { generated: 0, binaryExt: 0, notAFile: [], unreadable: [] };
  const read = [];

  for (const file of files) {
    if (SKIP_FILES.has(file)) { skipped.generated += 1; continue; }
    if (SKIP_EXT.has(path.extname(file).toLowerCase())) { skipped.binaryExt += 1; continue; }
    let text;
    try {
      if (!fs.statSync(file).isFile()) { skipped.notAFile.push(file); continue; }
      text = fs.readFileSync(file, 'utf8');
    } catch {
      skipped.unreadable.push(file);
      continue;
    }
    scanned += 1;
    read.push(file);
    const r = scanOneFile(file, text, roots, ids, names, machines);
    violations.push(...r.violations);
    matchable += r.matchable;
  }
  return { violations, scanned, matchable, roots, ids, names, skipped, read };
}

/**
 * The whole per-file rule body, split out so --self-test can drive it with
 * synthetic content. Without this the self-test could only probe the regexes in
 * isolation and assert that scan() was reachable, which would not notice if the
 * wiring between a match and a non-zero exit ever broke.
 */
function scanOneFile(file, text, roots, ids, names, machines) {
  const violations = [];
  let matchable = 0;
  const lines = text.split('\n');
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];
    if (line.includes(ALLOW)) continue;
    matchable += 1;
    for (const p of PATTERNS) {
      p.re.lastIndex = 0;
      const m = p.re.exec(line);
      if (m) violations.push({ file, line: i + 1, kind: p.name, hit: m[0], why: p.why });
    }
    if (roots) {
      for (const root of roots) {
        if (line.indexOf(root) !== -1) {
          violations.push({
            file, line: i + 1, kind: 'developer path', hit: root,
            why: "an absolute path on a developer's machine",
          });
          break;
        }
      }
    }
    if (ids) {
      for (const id of ids) {
        if (line.includes(id)) {
          violations.push({
            file, line: i + 1, kind: 'session id', hit: '<redacted session id>',
            why: 'an agent session id',
          });
          break;
        }
      }
    }
    // This machine's name, matched LITERALLY for the same reason the ids are: a hostname by
    // shape is nearly clean but still matched a hyphenated name in a tracked script. The value
    // never appears in the finding, because the report is read in CI logs and pull requests.
    if (machines) {
      for (const name of machines) {
        if (new RegExp(`\\b${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i').test(line)) {
          violations.push({
            file, line: i + 1, kind: 'machine name', hit: '<redacted machine name>',
            why: 'the name of the machine this repository is checked out on',
          });
        }
      }
    }
    if (names) {
      for (const name of names) {
        // Word-bounded, or a name like `brave-tapir` would fire both on its own
        // and again inside its own full id, and inside unrelated longer words.
        if (new RegExp(`\\b${name}\\b`).test(line)) {
          violations.push({
            file, line: i + 1, kind: 'session name', hit: '<redacted session name>',
            why: "the NAME of one of this tooling's sessions",
          });
          break;
        }
      }
    }
  }
  return { violations, matchable };
}

function report({ violations, scanned, matchable, roots, ids, names, skipped }, quiet) {
  // `quiet` exists so --self-test can assert the match-to-exit-1 wiring without
  // printing an alarming FAIL block in the middle of a passing run.
  const console = quiet ? { log() {}, error() {} } : global.console;
  console.log(`checked ${scanned} tracked file(s), ${matchable} line(s)`);
  // Say what was NOT read before saying anything about what was. Without this the
  // output cannot distinguish a tree that is clean from a tree the check barely
  // looked at, and a file it could not open would pass in silence.
  if (skipped) {
    console.log(
      `  not read: ${skipped.binaryExt} binary, ${skipped.generated} generated or vendored`
      + `${skipped.notAFile.length ? `, ${skipped.notAFile.length} not a regular file` : ''}`
      + `${skipped.unreadable.length ? `, ${skipped.unreadable.length} UNREADABLE` : ''}`,
    );
    for (const f of [...skipped.unreadable, ...skipped.notAFile]) {
      console.error(`  NOT CHECKED (tracked but could not be read): ${f}`);
    }
  }
  console.log(`  workspace ids                                : CHECKED`);
  // The vocabulary rules are the ones that need words this repository may not contain, so
  // their state is reported rather than assumed. Unconfigured is a legitimate state and is
  // the CI one, but it is never silent: three rules did not run and this is where it says so.
  console.log(
    `  agent backlog, commands, row references      : ${
      VOCAB_ALT
        ? `CHECKED (${VOCAB.length} configured word(s), not printed)`
        : 'NOT CHECKED - 3 rules dropped, no vocabulary configured (AGENT_VOCAB, '
          + 'AGENT_VOCAB_FILE, or the git-ignored default beside the repo root)'
    }`,
  );
  console.log(
    `  developer home/data paths (by shape)         : CHECKED`,
  );
  console.log(
    `  this machine's own paths (by name)           : ${
      roots ? `CHECKED (${roots.length} root(s), not printed)` : 'NOT CHECKED - no developer home here, which is expected in CI; the shape rule above still ran'
    }`,
  );
  console.log(
    `  session names, derived from the same list    : ${
      ids ? 'CHECKED (covers reachable sessions ONLY, see sessionNames)' : 'NOT CHECKED - the tooling is not reachable from here'
    }`,
  );
  console.log(
    `  session ids                                  : ${
      ids ? `CHECKED (${ids.length} live id(s), not printed)` : 'NOT CHECKED - the agent tooling is not reachable from here'
    }`,
  );

  // A scan that matched nothing because it read nothing is not a pass.
  if (scanned === 0 || matchable === 0) {
    console.error('FAIL: nothing was scanned, so this result means nothing.');
    return 1;
  }
  if (!violations.length) {
    console.log('PASS: no tracked file names the agent environment');
    return 0;
  }
  console.error(`\nFAIL: ${violations.length} violation(s)`);
  const byFile = new Map();
  for (const v of violations) {
    if (!byFile.has(v.file)) byFile.set(v.file, []);
    byFile.get(v.file).push(v);
  }
  for (const [file, vs] of byFile) {
    console.error(`  ${file}`);
    for (const v of vs.slice(0, 6)) {
      console.error(`    :${v.line}  ${v.kind} — ${v.hit}  (${v.why})`);
    }
    if (vs.length > 6) console.error(`    ... and ${vs.length - 6} more in this file`);
  }
  console.error(
    '\nNothing about the agent environment goes into this public repository (CLAUDE.md).',
  );
  console.error(
    `For a path that is genuinely a container or runtime location, add "${ALLOW}" on the line.`,
  );
  return 1;
}

const SHAPE_RULE = 'agent session or workspace id in a session/workspace position';

function selfTest() {
  let ok = true;
  const say = (name, pass, detail) => {
    console.log(`  ${pass ? 'ok  ' : 'FAIL'}  ${name}${detail ? `  [${detail}]` : ''}`);
    if (!pass) ok = false;
  };
  // A case that did not run is neither a pass nor a failure, and the one thing it must not be
  // is invisible. Every skip is printed where it happened and counted, and the final line
  // carries the total, so "all cases passed" can never mean "most cases never ran".
  const skips = [];
  const skip = (why) => {
    skips.push(why);
    console.log(`  SKIP  ${why}`);
  };

  const probe = (line) => {
    const hits = [];
    for (const p of PATTERNS) {
      p.re.lastIndex = 0;
      if (p.re.exec(line)) hits.push(p.name);
    }
    return hits;
  };

  // Every fixture below is a FABRICATED value, never a live one, and every
  // line carries the allow marker so the scanner skips this file's own
  // fixtures. The first draft of this file hardcoded a real workspace id here
  // and was committed, which made the check fail on the tree containing it --
  // and the failure was missed because the check had been run before `git add`,
  // when its own source was still untracked and so invisible to `git ls-files`.
  // Run it on the COMMITTED tree.
  say('a workspace id is caught',
    probe('const w = "ws-example-00000000";').includes('workspace id'));                 // agent-env-check: allow
  // Assert the rule set matches the configuration, in BOTH states. This is the case that would
  // catch the vocabulary rules going missing while the summary still claimed them, which is the
  // failure mode of moving a rule's input outside the file: it expects 3 when words are
  // configured and 0 when they are not, so neither answer is an invariant.
  {
    const vocabRules = PATTERNS.filter((p) => p.needsVocab).length;
    say('the vocabulary rules are present exactly when words are configured',
      vocabRules === (VOCAB.length ? 3 : 0),
      `${vocabRules} rule(s) for ${VOCAB.length} word(s)`);
  }

  // The three vocabulary rules are tested against fixtures BUILT from the configured words, so
  // no tooling name appears here either. Every word is exercised, not just the first, because a
  // vocabulary of three with only one covered is a gate with two untested rules in it.
  //
  // With no vocabulary these cases do not run. They are COUNTED as skipped and named, and the
  // summary refuses to call the run complete, so this cannot read as five silent passes.
  if (VOCAB.length) {
    for (const word of VOCAB) {
      say(`the agent backlog dir is caught (${word.length} chars)`,
        probe(`path = ".${word}/issues"`).includes('agent backlog directory'));
      say(`an agent command is caught (${word.length} chars)`,
        probe(`run: ${word} issue add "x"`).includes('agent tooling command'));
      say(`a backlog row reference is caught (${word.length} chars)`,
        probe(`// see ${word} #0999 for why`).includes('agent backlog reference'));  // agent-env-check: allow
    }
  } else {
    skip('the three vocabulary rules (backlog dir, command, row reference) have no words '
         + 'to test against, so their cases did not run');
  }

  // Negative controls: ordinary content must NOT fire, or the gate is red on
  // arrival and gets switched off.
  say('CONTROL ordinary hyphenated words do not fire',
    probe('import x from "community-partners-guide";').length === 0);
  say('CONTROL a websocket url does not fire', probe('wss://hypha.aicell.io/ws').length === 0);
  // The word on its own, with no leading dot, no subcommand and no row number after it, must
  // stay silent, or the rules fire on ordinary prose that happens to start the same way. Built
  // from the configured words so no tooling name sits in this file.
  if (VOCAB.length) {
    for (const word of VOCAB) {
      say(`CONTROL the configured word alone does not fire (${word.length} chars)`,
        probe(`${word}rrhiza and ${word}logy are not commands`).length === 0);
    }
  } else {
    skip('the word-alone controls for the vocabulary rules have no words to test against');
  }
  say('CONTROL a container path does not fire', probe('WORKDIR /home/bioengine/app').length === 0);
  // This control used to assert that a bare row number does NOT fire, and its
  // fixture was itself a zero-padded four-digit row number rather than the shape
  // a GitHub issue takes in this repository. So it protected the wrong property.
  // The property worth protecting is that a REAL GitHub reference stays silent,
  // so the fixture is now one, and the bare row number is asserted to fire.
  say('CONTROL a GitHub issue reference does not fire', probe('fixes #167 in the grid').length === 0);
  say('CONTROL a short issue reference does not fire', probe('see #42 for context').length === 0);
  say('CONTROL a six-digit hex colour does not fire', probe("color: '#1a2b3c'").length === 0);
  say('a bare backlog row number is caught',
    probe('// decided on #0000.').includes('bare backlog row number'));                  // agent-env-check: allow
  say('a parenthesised bare row number is caught',
    probe('a separate decision (#0000).').includes('bare backlog row number'));          // agent-env-check: allow
  say('CONTROL a url path does not fire',
    probe('https://example.com/home/dashboard').length === 0);
  say('a capitalised home is caught',
    probe('/Users/SomePerson/code').includes('developer home or data path'));          // agent-env-check: allow

  // The developer-path rule, which is the one that caught 41 real lines. It
  // must fire on a person's directory and stay silent on every runtime account
  // this repo legitimately mentions, or it is useless in one direction or the
  // other.
  const DEV = 'developer home or data path';
  say('a developer data path is caught', probe("open('/data/someperson/x/.env')").includes(DEV));   // agent-env-check: allow
  say('a developer home path is caught', probe('cd /home/someperson/repo').includes(DEV));           // agent-env-check: allow
  say('a macOS home path is caught', probe('/Users/someperson/code').includes(DEV));                 // agent-env-check: allow
  for (const safe of ['pyodide', 'bioengine', 'hypha', 'runner', 'root', 'me']) {
    say(`CONTROL /home/${safe} does not fire`, probe(`/home/${safe}/app`).length === 0);
  }

  // The allow marker, and the wiring from a match to a non-zero exit. Both are
  // driven through the REAL per-file body, not asserted about a string literal:
  // the previous version of this case built a string containing the marker and
  // then asserted it contained the marker, which cannot fail and never reached
  // the skip branch at all.
  // Built on the workspace-id rule rather than a vocabulary rule, so the allow marker is
  // tested in CI too, where there are no configured words and the vocabulary rules are absent.
  const marked = 'x = "ws-example-00000000"  ' + '// ' + ALLOW + '\nclean line\n';  // agent-env-check: allow
  const r1 = scanOneFile('fixture', marked, null, null, null);
  say('the allow marker really exempts its line, through the scanner',
    r1.violations.length === 0, `violations=${r1.violations.length}`);
  say('and the marker does NOT suppress the following line',
    scanOneFile('fixture', marked + 'y = "ws-example-11111111"\n', null, null, null)  // agent-env-check: allow
      .violations.length === 1);

  const dirty = 'const w = "ws-example-00000000";\n';  // agent-env-check: allow
  const r2 = scanOneFile('fixture', dirty, null, null, null);
  say('a violation is collected with its file and line',
    r2.violations.length === 1 && r2.violations[0].line === 1, JSON.stringify(r2.violations[0] || {}));
  // This is the case that was missing: a non-empty violation list must make the
  // process exit non-zero. Without it the CI step named "the check can still
  // fail" would not notice if report() stopped failing.
  say('a collected violation makes report() return 1',
    report({ violations: r2.violations, scanned: 1, matchable: 1, roots: null, ids: null, names: null }, true) === 1);
  say('CONTROL an empty violation list makes report() return 0',
    report({ violations: [], scanned: 200, matchable: 5000, roots: null, ids: null, names: null }, true) === 0);

  // The derived-name rule, and its stated limit.
  say('a derived session name is caught',
    scanOneFile('fixture', 'reported by brave-tapir\n', null, null, ['brave-tapir'])
      .violations.some((v) => v.kind === 'session name'));
  say('CONTROL a name is not caught inside a longer word',
    scanOneFile('fixture', 'brave-tapirs are plural\n', null, null, ['brave-tapir'])
      .violations.length === 0);
  say('CONTROL with no reachable list the name rule is inert, not green-by-accident',
    sessionNames(null) === null);

  // The four rules ported from the other checker, each with a case that must go RED, and each
  // runnable with no tooling and no developer home: `env -i PATH=/usr/bin:/bin node ... --self-test`.
  // That matters because CI is exactly where the live session list and $HOME are absent, and a
  // rule that silently does nothing there is the failure this whole file exists to prevent.
  console.log('\n[16] the leak shape: an id in a session or workspace position');
  say('an unquoted assignment is caught',
    probe('session: some-thing-abcdef').includes(SHAPE_RULE));   // agent-env-check: allow
  say('a quoted one is caught',
    probe('WEBSITE_SESSION = "some-thing-abcdef"').includes(SHAPE_RULE)); // agent-env-check: allow
  say('an environ default is caught',
    probe('os.environ.get("SWEEP_SESSION", "some-thing-abcdef")').includes(SHAPE_RULE));  // agent-env-check: allow
  say('a command flag is caught',
    probe('run --session some-thing-abcdef now').includes(SHAPE_RULE)); // agent-env-check: allow
  // The next three were all 0/0 until round 3 of the review, which found them by TRYING the
  // rule rather than reading it. A quoted key puts a `"` between the name and the colon; a
  // kebab-case key has a `-` the old class excluded; and `--as` names a session with no word
  // in the flag to match on. Each of the three goes red if its half of the pattern is removed.
  say('a QUOTED key is caught',
    probe('{"sessionId": "some-thing-abcdef"}').includes(SHAPE_RULE));  // agent-env-check: allow
  say('a HYPHENATED key is caught',
    probe('session-id: some-thing-abcdef').includes(SHAPE_RULE));       // agent-env-check: allow
  say('the positional --as flag is caught',
    probe('run --as some-thing-abcdef now').includes(SHAPE_RULE));      // agent-env-check: allow
  say('CONTROL an id-shaped word NOT in such a position does not fire',
    probe('const name = "some-thing-abcdef";').length === 0);                       // agent-env-check: allow
  // Re-run after widening the key class to allow a hyphen, because that is the change most
  // able to turn this rule into a tree-wide false positive: ordinary kebab-case identifiers
  // are everywhere, and a rule that fires on them is red on arrival and gets switched off.
  say('CONTROL ordinary hyphenated words do not fire',
    probe('build-and-deploy array-byte-length web-python-kernel').length === 0);
  say('CONTROL a hyphenated key with an ordinary value does not fire',
    probe('session-id: unset').length === 0);                           // agent-env-check: allow
  say('CONTROL a kebab-case key whose value is not id-shaped does not fire',
    probe('workspace-name: my-project').length === 0);                  // agent-env-check: allow

  console.log('\n[17] the calling session its own id, with no registry');
  {
    const saved = process.env.AGENT_SESSION_ID;
    process.env.AGENT_SESSION_ID = 'zzzz-yyyy-wwwwww';  // agent-env-check: allow
    const ids = sessionIds();
    process.env.AGENT_SESSION_ID = saved;
    say('the env id is in the list even when the tooling is unreachable',
      !!ids && ids.includes('zzzz-yyyy-wwwwww'), `${ids && ids.length} id(s)`);
  }

  console.log('\n[18] this machine, matched literally and reported redacted');
  {
    const names = machineNames();
    say('a machine name is readable here', !!names, `${names ? names.length : 0}`);
    // Driven with a FABRICATED machine name through the parameter, so the case neither
    // depends on which machine runs it nor writes a real hostname into this file.
    const hit = scanOneFile('x.sh', 'ssh notarealhost\n', null, null, null, ['notarealhost']);
    say('the hostname is caught when matched literally',
      hit.violations.some((v) => v.kind === 'machine name'),
      JSON.stringify(hit.violations.slice(0, 1)));
    say('and the value is NOT printed back',
      hit.violations.every((v) => !JSON.stringify(v).includes('notarealhost')));
    const near = scanOneFile('x.md', 'the notarealhostel booking page\n', null, null, null,
      ['notarealhost']);
    say('CONTROL a longer word merely starting with it does not fire',
      near.violations.length === 0);
  }

  console.log('\n[19] a developer root NESTED under another root');
  say('/mnt/data/<owner> is caught',
    probe('open("/mnt/data/someperson/x/.env")').includes('developer home or data path')); // agent-env-check: allow
  say('/srv/home/<owner> is caught',
    probe('cd /srv/home/someperson/repo').includes('developer home or data path'));        // agent-env-check: allow
  say('CONTROL a url with /home/ in its path still does not fire',
    probe('https://example.com/home/dashboard').length === 0);
  say('CONTROL a nested runtime account does not fire',
    probe('WORKDIR /mnt/home/bioengine/app').length === 0);

  // The real tree must be scannable at all.
  const r = scan();
  say('the scan reads the tracked tree', r.scanned > 100, `${r.scanned} files`);
  say('the scan reads lines', r.matchable > 1000, `${r.matchable} lines`);

  // WHICH FILES GET READ is itself a thing that can regress silently, and when it
  // does the run still reports clean. A count alone will not catch it: dropping
  // every `.txt` and `.svg` in this tree costs 16 files out of 365 and leaves the
  // count comfortably over any floor. So assert the KINDS, naming the ones an
  // extension allowlist would be likely to omit.
  const readSet = new Set(r.read);
  const kinds = [
    ['.txt', (f) => f.endsWith('.txt')],
    ['.svg', (f) => f.endsWith('.svg')],
    ['.xml', (f) => f.endsWith('.xml')],
    ['.htaccess or a dotfile', (f) => path.basename(f).startsWith('.')],
    ['no extension at all', (f) => !path.basename(f).includes('.')],
  ];
  for (const [label, pred] of kinds) {
    const tracked = trackedFiles().filter(pred);
    const got = tracked.filter((f) => readSet.has(f));
    // If the tree genuinely has none of a kind, say so rather than passing: an
    // assertion that cannot fail is not evidence of anything.
    if (!tracked.length) { say(`no tracked file of kind ${label}, nothing asserted`, true); continue; }
    say(`every tracked ${label} file is read`, got.length === tracked.length,
      `${got.length}/${tracked.length}`);
  }

  // The tally has to account for the whole tree, or a file could fall out of the
  // scan without appearing in any skip bucket and nothing would say so.
  const accounted = r.scanned + r.skipped.binaryExt + r.skipped.generated
    + r.skipped.notAFile.length + r.skipped.unreadable.length;
  say('read plus skipped accounts for every tracked file',
    accounted === trackedFiles().length, `${accounted} of ${trackedFiles().length}`);
  say('no tracked file is unreadable',
    r.skipped.unreadable.length === 0 && r.skipped.notAFile.length === 0,
    `${r.skipped.unreadable.length} unreadable, ${r.skipped.notAFile.length} not a regular file`);

  if (skips.length) {
    console.log(`\n${skips.length} case group(s) did NOT run:`);
    for (const why of skips) console.log(`  SKIPPED: ${why}`);
  }
  console.log(
    `${ok ? 'self-test: PASS' : 'self-test: FAIL'}`
    + `${skips.length ? ` (with ${skips.length} skipped group(s), listed above)` : ''}`,
  );
  return ok ? 0 : 1;
}

const arg = process.argv[2];
if (arg === '--self-test') process.exit(selfTest());
process.exit(report(scan()));
