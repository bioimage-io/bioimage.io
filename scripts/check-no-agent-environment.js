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
// Set by sessionIds(): whether the live session registry was actually READ, as opposed to the
// one id the environment supplied. The summary distinguishes them, because "CHECKED (1 live id)"
// over an env var alone reads exactly like a list that was consulted and had one entry.
let REGISTRY_REACHED = false;
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

// Addresses that BELONG in this repository: the project's own published contact points. These
// are deliberate and documented, so they are named here rather than left to a reviewer to
// recognise each time.
const CONTACT_ADDRESSES = new Set([
  'ai4life@eurobioimaging.eu',
  'bioimageio-coc@googlegroups.com',
]);

// Address shapes that cannot identify a person. Each clause earned its place by firing on
// something real in this tree, which is why they are listed rather than guessed:
//
//   the reserved documentation and testing domains, which by RFC cannot be registered;
//   a no-reply sender, which no human reads;
//   the service account that every git-over-SSH instruction has to name.
const IMPERSONAL_ADDRESS = new RegExp(
  String.raw`@(?:[A-Za-z0-9-]+\.)*(?:example\.(?:com|org|net)|invalid|localhost|test)$`
  // `users.noreply.` is ANCHORED to the forges that mint those addresses. Unanchored it
  // exempted any domain merely CONTAINING that phrase, so an address at a lookalike host
  // ending in evil.com passed the gate: measured RC=0 with it staged, before this anchor.
  // The lookalike is spelled out as a self-test fixture rather than here, because a full
  // address written in this comment makes the file fail its own rule.
  + String.raw`|^(?:no-?reply|noreply)@|@users\.noreply\.(?:github|gitlab)\.com$`
  + String.raw`|^git@(?:github|gitlab|bitbucket)\.(?:com|org)$`,
  'i',
);

/**
 * Is this match a version-pinned package spec rather than an address?
 *
 * `docsify-tabs@1.js` in a CDN script tag fired on the first run of the address rule, so it has
 * to be exempt. The FIRST attempt exempted it with a lookahead rejecting any domain whose first
 * label is all digits, on the stated belief that no domain's first label is all digits. That was
 * wrong and it opened the hole this function closes: `163.com` and `126.com` are two of the
 * largest consumer mail providers in China, so the rule silently passed a real person's address
 * at either of them. Found in review round 2.
 *
 * The exemption is now the PIN SHAPE itself and nothing wider: a first label of only digits AND
 * a last label that is a FILE EXTENSION rather than a top-level domain. `1.js` is a pin,
 * `163.com` is a domain, and the two are told apart by `js` against `com`.
 */
const ASSET_EXTENSION = /^(?:js|mjs|cjs|jsx|ts|tsx|css|scss|map|min|json|svg|png|jpe?g|gif|woff2?|wasm)$/i;
function isVersionPinnedSpec(hit) {
  const labels = hit.slice(hit.lastIndexOf('@') + 1).split('.');
  if (labels.length < 2) return false;
  return /^[0-9]+$/.test(labels[0]) && ASSET_EXTENSION.test(labels[labels.length - 1]);
}

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
  {
    // A REAL PERSON'S ADDRESS IN A PUBLIC FILE. This repository is public and its skills are
    // served, so an address in a tracked file is published to anyone who reads it, and a
    // contributor's address arrived here twice: once as sample data in a test fixture and once
    // as the illustrative value of an `owners` list in a served skill.
    //
    // The rule is an address MINUS the ones that cannot identify a person, rather than a list
    // of forbidden providers. A provider list is the tempting version and it is wrong: it
    // passes every self-hosted and university address, which is most of this community.
    // A version-pinned package spec is exempted by `isVersionPinnedSpec` in `accept`, NOT by a
    // lookahead in this expression. The lookahead that used to do it rejected every domain whose
    // first label is all digits, which let a real address at 163.com or 126.com through; see that
    // function for the measurement.
    name: 'personal email address',
    re: /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9](?:[A-Za-z0-9.-]*[A-Za-z0-9])?\.[A-Za-z]{2,}\b/g,
    why: "a real person's address in a file this repository publishes",
    accept: (hit) => CONTACT_ADDRESSES.has(hit.toLowerCase())
      || IMPERSONAL_ADDRESS.test(hit)
      || isVersionPinnedSpec(hit),
  },
];

function gitList(args) {
  try {
    return execFileSync('git', args, { encoding: 'utf8' }).split('\n').filter(Boolean);
  } catch {
    // Not a git checkout, or git is absent. The caller's own floor ("nothing was scanned, so
    // this result means nothing") turns that into a failure rather than a silent pass.
    return [];
  }
}

function trackedFiles() {
  return gitList(['ls-files']);
}

/**
 * New files that are NOT yet staged, which is exactly when this check is usually run.
 *
 * WHY THIS EXISTS. The scan took its list from `git ls-files`, so a file you had just written was
 * invisible to it, and the moment everybody runs this check is before `git add`. Measured
 * 2026-11-24: a new test spec carried an absolute path on a contributor's machine, the check
 * passed while the file was untracked, and the same check named the line the moment it was
 * staged. The leak would have landed on a green gate.
 *
 * `--exclude-standard` honours .gitignore and the repository-local exclude file, so build output,
 * dependencies and agent scratch directories stay out. Entries ending in `/` are dropped: git
 * reports a nested repository (a worktree under this tree has its own .git) as ONE such entry and
 * does not recurse into it, which is what keeps this from walking every other branch's checkout.
 * Measured in the shared checkout: 6 entries, 4 of them nested worktrees, 2 of them images.
 */
function untrackedFiles() {
  return gitList(['ls-files', '--others', '--exclude-standard'])
    .filter((f) => !f.endsWith('/'));
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
  // AGENT_TOOL names the binary outright. Otherwise EVERY configured word is tried, because the
  // vocabulary is a list of words to hide, not an ordered list with the executable first, and
  // taking element 0 made the result depend on the order someone typed them in: with the
  // directory name ahead of the command name, the registry was never consulted and the summary
  // still said CHECKED, over the one id the environment had supplied. Found in review.
  const tool = (process.env.AGENT_TOOL || '').trim();
  const candidates = tool ? [tool] : VOCAB;
  let registry = false;
  for (const candidate of candidates) {
    try {
      const out = execFileSync(candidate, ['session', 'list', '--json', '--all'], {
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
      registry = true;
      break;
    } catch {
      // Not the binary, or the tooling is absent as in CI. Try the next word; if none works,
      // whatever the environment supplied still stands and the summary says the registry was
      // not reached, rather than reporting one env id as though the list had been read.
    }
  }
  REGISTRY_REACHED = registry;
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
  // Tracked AND not-yet-staged, because the second group is the one a run before `git add`
  // would otherwise miss entirely. See untrackedFiles() for why that matters and what it
  // deliberately leaves out.
  const tracked = trackedFiles();
  const untracked = untrackedFiles();
  const untrackedSet = new Set(untracked);
  const files = [...tracked, ...untracked];
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
    // Mark the ones that are not committed yet. A reader needs that distinction: a tracked hit
    // is already in the history and needs a follow-up, while an untracked one is still on this
    // machine only and is fixed by editing the file before it is committed.
    for (const v of r.violations) v.untracked = untrackedSet.has(file);
    violations.push(...r.violations);
    matchable += r.matchable;
  }
  return { violations, scanned, matchable, roots, ids, names, skipped, read,
           trackedCount: tracked.length, untrackedCount: untracked.length };
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
      // `accept` lets a rule match broadly and then keep the ones that are legitimate, which is
      // the only workable shape for the address rule: "an address, except these" as a single
      // regex needs lookaheads that nobody can read or change safely. Rules without an `accept`
      // behave exactly as before.
      let m = p.re.exec(line);
      while (m && p.accept && p.accept(m[0])) m = p.re.exec(line);
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

function report({ violations, scanned, matchable, roots, ids, names, skipped,
                  trackedCount, untrackedCount }, quiet) {
  // `quiet` exists so --self-test can assert the match-to-exit-1 wiring without
  // printing an alarming FAIL block in the middle of a passing run.
  const console = quiet ? { log() {}, error() {} } : global.console;
  // Say the two groups separately. "checked N tracked file(s)" was true and misleading: the
  // group it did NOT name is the one a run before `git add` cares about most.
  console.log(
    `checked ${scanned} file(s), ${matchable} line(s)`
    + (untrackedCount === undefined
      ? ''
      : ` (${trackedCount} tracked, ${untrackedCount} new and not yet staged)`),
  );
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
      ids
        ? `CHECKED (${ids.length} id(s), not printed; registry ${
          REGISTRY_REACHED ? 'READ' : 'NOT reached, so these came from the environment only'})`
        : 'NOT CHECKED - the agent tooling is not reachable from here'
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
    console.error(`  ${file}${vs[0] && vs[0].untracked ? '   [NEW, not yet staged]' : ''}`);
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

  // Routed through the REAL scanner rather than re-running PATTERNS here. The previous version
  // duplicated the match loop, so it saw neither the per-rule `accept` filter nor the inline
  // allow marker: every "does not fire" control in group 20 failed against a rule that was
  // working perfectly in the tree. A self-test with its own private matcher cannot tell you
  // whether the thing that runs is right.
  const probe = (line) => scanOneFile('probe-fixture.txt', `${line}\n`, null, null, null, null)
    .violations.map((v) => v.kind);

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
    // DELETE when there was nothing there. Assigning `undefined` to a process.env key sets the
    // key to the nine-character STRING "undefined", which is long enough to pass the >= 8 filter
    // and so becomes a live session id for the rest of the run. Every later full scan then
    // reports the word `undefined` wherever it appears in the tree, which was 4 tracked files
    // here. Found by the first case added after this one that scans the whole tree, which is
    // also the only reason anybody would notice: on its own this group still passes.
    if (saved === undefined) delete process.env.AGENT_SESSION_ID;
    else process.env.AGENT_SESSION_ID = saved;
    say('the env id is in the list even when the tooling is unreachable',
      !!ids && ids.includes('zzzz-yyyy-wwwwww'), `${ids && ids.length} id(s)`);
  }

  console.log('\n[18] this machine, matched literally and reported redacted');
  {
    // Whether the machine running this HAS a name to protect is a fact about
    // where the self-test runs, not about the checker. A CI runner protects
    // none, and the old case asserted one anyway, so the self-test failed on
    // every runner: the step whose job is to prove the checker can still go red
    // never passed, and the check itself was skipped behind it. Treated like
    // the vocabulary groups now, SKIPPED and counted, with the cases that need
    // a real name moved inside the branch that has one. Where a name IS
    // readable and the rule does not catch it, this still fails.
    const names = machineNames();
    if (names) {
      const real = scanOneFile('x.sh', `ssh ${names[0]}\n`, null, null, null, names);
      say('a readable machine name is caught',
        real.violations.some((v) => v.kind === 'machine name'),
        `${names.length} name(s) readable`);
      // Counts only. Printing the violation back here would write this
      // machine's name into the self-test output, which is the thing the rule
      // exists to prevent.
      say('and the readable name is NOT printed back',
        real.violations.every((v) => !JSON.stringify(v).includes(names[0])),
        `${real.violations.length} violation(s)`);
    } else {
      skip('no machine name is readable here, which is what a CI runner looks like: it has '
           + 'nothing of its own to protect, so the two cases needing a real name did not run');
    }
    // Driven with a FABRICATED machine name through the parameter, so the cases below neither
    // depend on which machine runs them nor write a real hostname into this file.
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

  console.log('\n[20] a real person\'s address in a published file');
  const EMAIL = 'personal email address';
  // Every fixture here is fabricated. The local parts are invented names and the domains are
  // either reserved or invented, so this block names nobody.
  say('a consumer-provider address is caught',
    probe('const owner = "jane.doe@gmail.com";').includes(EMAIL));  // agent-env-check: allow
  // THE POINT OF THE RULE, and why it is not a list of providers: most of this community
  // publishes from a university or an institute, and a provider list passes every one of them.
  say('a university address is caught',
    probe('maintainer: a.person@some-university.ac.uk').includes(EMAIL));  // agent-env-check: allow
  say('a self-hosted address is caught',
    probe('contact a.person@their-own-domain.org for access').includes(EMAIL));  // agent-env-check: allow
  say('CONTROL the project contact addresses do not fire',
    probe('report to ai4life@eurobioimaging.eu or bioimageio-coc@googlegroups.com').length === 0);
  say('CONTROL a reserved documentation domain does not fire',
    probe('email: "colleague@example.com"').length === 0);
  say('CONTROL a reserved subdomain does not fire',
    probe("user = { email: 'owner@example.invalid' }").length === 0);
  say('CONTROL a no-reply sender does not fire',
    probe('Co-Authored-By: Someone <noreply@anthropic.com>').length === 0);
  say('CONTROL the git service account does not fire',
    probe('url."git@github.com:".insteadOf').length === 0);
  // Fired on the first run of this rule, on a CDN script tag in docs/index.html.
  say('CONTROL a version-pinned package spec does not fire',
    probe('<script src="https://cdn.example.com/docsify-tabs@1.js"></script>').length === 0);
  // THE HOLE REVIEW ROUND 2 FOUND, and the reason the exemption above is a shape test rather
  // than a lookahead. The first version rejected any domain whose first label was all digits,
  // so an address at either of these two providers passed a green gate. Both must FIRE.
  say('a digit-only domain label is still an address (163)',
    probe('const owner = "invented.name@163.com";').includes(EMAIL));  // agent-env-check: allow
  say('a digit-only domain label is still an address (126)',
    probe('maintainer: another.invented@126.com').includes(EMAIL));  // agent-env-check: allow
  // The two must be told apart by the LAST label, so assert the discriminator directly as well:
  // same digit-only first label, one ending in a TLD and one in a file extension.
  say('the pin exemption turns on the file extension, not the digits',
    isVersionPinnedSpec('pkg@1.js') && !isVersionPinnedSpec('person@163.com'));  // agent-env-check: allow
  // The inline marker has to cover this rule too, or a deliberate example has no way out.
  // A forge no-reply is exempt, but only at the forge. Unanchored, the phrase exempted any
  // domain containing it, which is a hole a hostile or careless value walks straight through.
  say('CONTROL a forge no-reply address does not fire',
    probe('Co-Authored-By: Someone <12345+someone@users.noreply.github.com>').length === 0);
  say('a lookalike noreply domain IS caught',
    probe('const c = "jane@users.noreply.evil.com";').includes(EMAIL));  // agent-env-check: allow
  say('CONTROL the allow marker exempts an address line',
    probe(`example: admin@invented-lab.edu  // ${ALLOW}`).length === 0);  // agent-env-check: allow

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
  //
  // Both groups, since the scan covers new unstaged files too. Counting only the tracked ones
  // here would have made this assertion fail the moment that landed, which is the right kind of
  // failure: an accounting check that silently stops accounting for part of its input is worse
  // than no check.
  const accounted = r.scanned + r.skipped.binaryExt + r.skipped.generated
    + r.skipped.notAFile.length + r.skipped.unreadable.length;
  // FROM THE SCAN'S OWN COUNTS, not a fresh `git ls-files`. Re-listing here compares a tally
  // taken at one moment against a tree read at another, and anything that writes to the tree in
  // between makes them disagree: four concurrent runs of this self-test reported "414 of 416",
  // which is a false failure about nothing. The scan reports what IT saw.
  const everything = r.trackedCount + r.untrackedCount;
  say('read plus skipped accounts for every tracked AND untracked file',
    accounted === everything, `${accounted} of ${everything}`);
  say('no tracked file is unreadable',
    r.skipped.unreadable.length === 0 && r.skipped.notAFile.length === 0,
    `${r.skipped.unreadable.length} unreadable, ${r.skipped.notAFile.length} not a regular file`);

  // [20] A NEW FILE THAT IS NOT STAGED YET IS STILL SCANNED.
  //
  // This is the case the whole group exists for, and the only one that writes a real file: the
  // list comes from git, so nothing in-process can stand in for it. The check used to read
  // `git ls-files` alone, which is blind to a file you just wrote, and the moment everyone runs
  // this check is before `git add`. A new test spec carried an absolute path on a contributor's
  // machine past a green run that way.
  //
  // The ignored half matters as much as the caught half: without it, this rule would fire on
  // build output and scratch files and get switched off.
  console.log('\n[21] a NEW file that is not staged yet');
  {
    // ONE DIRECTORY, OURS, REMOVED AGAIN. It used to write to the repository's shared
    // info/exclude file to prove the ignored half, which is wrong twice over: concurrent runs of
    // this self-test left that file modified for good, and in one tree 3 of 4 concurrent runs
    // failed outright. Nothing outside this directory is touched now, the name carries the pid
    // so parallel runs cannot collide, and a `.gitignore` of `*` inside it is what makes git
    // stop reporting the contents -- measured: a plain untracked directory is listed as its
    // individual FILES, and that one line makes all of them disappear.
    const dir = `.agent-env-selftest-${process.pid}`;
    const probe = path.join(dir, 'probe.ts');
    // Sweep up after a run that died before its own finally could. Only directories whose pid is
    // gone, so a concurrent run's directory is never touched.
    for (const name of fs.readdirSync('.')) {
      const m = /^\.agent-env-selftest-(\d+)$/.exec(name);
      if (!m || name === dir) continue;
      try { process.kill(Number(m[1]), 0); continue; } catch { /* no such process */ }
      for (const f of ['probe.ts', '.gitignore']) {
        try { fs.unlinkSync(path.join(name, f)); } catch { /* absent */ }
      }
      try { fs.rmdirSync(name); } catch { /* not empty, leave it */ }
    }
    try {
      fs.mkdirSync(dir, { recursive: true });
      // A SYNTHETIC path, and this line carries the allow marker because the path rule correctly
      // fires on it otherwise. Without the marker the checker reports itself, which is right of
      // the rule and wrong of the fixture.
      fs.writeFileSync(probe, 'const p = "/home/someone/secret/thing";\n');  // agent-env-check: allow
      say('git reports the new file, and not ignored', untrackedFiles().includes(probe));
      const dirty = scan();
      const hits = dirty.violations.filter((v) => v.file === probe);
      say('the scan reads it and reports the path', hits.length > 0, `${hits.length} violation(s)`);
      say('and marks the violation as not yet staged', hits.every((v) => v.untracked === true));
      say('so the run fails', report(dirty, true) === 1);

      // The ignored half. Same bytes, one .gitignore, and git must stop seeing any of it.
      fs.writeFileSync(path.join(dir, '.gitignore'), '*\n');
      const clean = scan();
      // Accounted from the scan already taken rather than by asking git again: the result
      // carries what it read, and a second listing could pick up another run's probe.
      say('once ignored, nothing from it is read', !clean.read.includes(probe));
      say('and it reports no violation', clean.violations.filter((v) => v.file === probe).length === 0);
      // NOT asserted: that the whole run now exits 0. Another copy of this self-test running in
      // the same tree has its own probe file in it, un-ignored, for a few hundred milliseconds,
      // so the run-level code is not a property of THIS case. Measured: four concurrent runs all
      // failed that assertion while every per-probe claim above held. What this case is about is
      // its own probe, and that is what it checks.
      say('the ignored file is still on disk, so this was about git and not deletion',
        fs.existsSync(probe));
    } finally {
      // Removed by unlinking the two files this case created and then the directory, rather
      // than with fs.rmSync: that arrived in Node 14.14, and the stripped-environment run of
      // this self-test resolves `node` to /usr/bin/node, which is 10.19.0 here. It threw
      // `fs.rmSync is not a function` and took the whole run down with it. A checker whose own
      // self-test needs a modern runtime cannot be trusted to report on an old one.
      for (const name of ['probe.ts', '.gitignore']) {
        try { fs.unlinkSync(path.join(dir, name)); } catch { /* never created */ }
      }
      try { fs.rmdirSync(dir); } catch { /* never created, or not empty */ }
      say('the probe directory is gone and nothing shared was touched', !fs.existsSync(dir));
    }
  }

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
