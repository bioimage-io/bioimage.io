#!/usr/bin/env node
/**
 * Fail when a string that renders to a user in the website UI contains an em
 * dash, or an en dash outside a compact numeric range.
 *
 * This replaces three paragraphs of prose in CLAUDE.md. The rule only ever
 * applied to user-visible strings -- code comments, JSDoc and console.* logs
 * are exempt -- and that exemption is exactly what makes grep useless as a
 * gate: measured 2026-11-04, `grep -rn` finds 255 em dashes under src/ and all
 * but a handful are in comments, so the grep is 250-odd false positives and
 * gets ignored. Parsing instead of grepping collapses it to the real surface,
 * because comments are not nodes in the AST.
 *
 *   node scripts/check-ui-text.js              # or: npm run check-ui-text
 *   node scripts/check-ui-text.js --self-test  # prove it can still go RED
 *
 * Exit 0 = every user-visible string is clean, and it says how many it read.
 * Exit 1 = at least one violation, listed with file:line.
 * Exit 2 = the check could not run (no TypeScript, or it matched no files),
 * which is deliberately NOT a pass.
 *
 * Run --self-test after touching the surface lists below. A scan that reports
 * clean proves nothing on its own: the self-test writes a fixture carrying 18
 * dash-bearing lines, 8 on a user-visible surface and 10 exempt, and fails
 * unless exactly the 8 are caught. That is the only thing standing between
 * this check and the silent-green failure it exists to prevent.
 *
 * Escape hatches, for the cases where the character is the point: put
 * `// ui-text-check: allow` on the offending line, or `ui-text-check: disable`
 * anywhere in the file.
 */
const fs = require('fs');
const os = require('os');
const path = require('path');

const ROOT = path.join(__dirname, '..');

const EM_DASH = '—';
const EN_DASH = '–';

// Measured in this repo on 2026-11-04 -- these are the JSX attributes that
// actually carry user-visible copy here, by occurrence count:
// title 162, aria-label 87, placeholder 69, label 63, alt 34.
const VISIBLE_ATTRS = new Set([
  'title',
  'placeholder',
  'aria-label',
  'alt',
  'label',
  'aria-description',
  'aria-placeholder',
  'aria-valuetext',
  'aria-roledescription',
]);

// Calls whose string arguments are shown to the user. `alert` and `confirm`
// render directly; the setter shapes are the state variables this codebase
// renders as status and error copy (setUploadStatus 81, setKernelStatus 25,
// setTokenError 7, setStatusMessage 4, ... all measured 2026-11-04).
const VISIBLE_CALL_NAMES = new Set(['alert', 'confirm']);
const VISIBLE_SETTER = /^set[A-Z]\w*(Error|Errors|Message|Status|Warning|Notice|Info)$/;

// A walk that half-breaks -- a changed glob, an AST shape this TypeScript stopped
// recognising -- reads SOME files and almost no strings, and then reports clean. These
// floors turn that into exit 2 rather than a silent green. Measured 2026-11-04: 174
// files, 15,298 user-visible strings. Set well below that so ordinary churn does not
// trip them; if src/ genuinely shrinks this far, lower them deliberately.
const MIN_FILES = 100;
const MIN_STRINGS = 2000;

let ts;
try {
  ts = require('typescript');
} catch (err) {
  console.error(`SKIP  cannot load typescript (${err.message}) -- the check did not run`);
  process.exit(2);
}

function sourceFiles(dir, acc = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === '__tests__' || entry.name === '__mocks__') continue;
      sourceFiles(full, acc);
    } else if (/\.tsx?$/.test(entry.name) && !/\.(test|spec)\.tsx?$/.test(entry.name)) {
      // A test may hold the banned character on purpose, to assert its absence.
      acc.push(full);
    }
  }
  return acc;
}

/** The violations in one string of user-visible copy, or [] if it is clean. */
function offences(text) {
  const found = [];
  if (text.includes(EM_DASH)) found.push('em dash');
  if (text.includes(EN_DASH)) {
    // A bare en dash between numeric bounds in a compact label is allowed
    // (e.g. `5-95%`); in prose it is not. Strip the allowed shape, then look.
    const prose = text.replace(new RegExp(`(?<=\\d)${EN_DASH}(?=\\d)`, 'g'), '');
    if (prose.includes(EN_DASH)) found.push('en dash in prose');
  }
  return found;
}

/** The literal text of a string or template node, ignoring interpolations. */
function literalText(node) {
  if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) return node.text;
  if (ts.isTemplateExpression(node)) {
    return node.head.text + node.templateSpans.map(s => s.literal.text).join(' ');
  }
  return null;
}

function attrName(attr) {
  return attr.name ? attr.name.getText() : '';
}

/** Scan a directory tree. Returns every violation plus how much was READ. */
function scan(root, relativeTo) {
  const violations = [];
  let filesRead = 0;
  let stringsRead = 0;

  for (const file of sourceFiles(root)) {
    const text = fs.readFileSync(file, 'utf8');
    if (text.includes('ui-text-check: disable')) continue;
    filesRead += 1;

    const sf = ts.createSourceFile(
      file,
      text,
      ts.ScriptTarget.Latest,
      /* setParentNodes */ true,
      file.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
    );
    const lines = text.split('\n');
    const rel = path.relative(relativeTo, file);

    const report = (node, where, value) => {
      const { line } = sf.getLineAndCharacterOfPosition(node.getStart(sf));
      // The hatch is documented as going "on the line", but a JSX text node or a
      // template literal can SPAN lines, and the dash is then one or two lines
      // below where the node starts. Checking only the start line silently
      // ignored a correctly-placed hatch, leaving the file-wide `disable` as the
      // only escape that worked. Honour it anywhere in the node's own span.
      const { line: endLine } = sf.getLineAndCharacterOfPosition(node.getEnd());
      for (let i = line; i <= endLine; i += 1) {
        if ((lines[i] || '').includes('ui-text-check: allow')) return;
      }
      const kinds = offences(value);
      if (!kinds.length) return;
      violations.push({
        at: `${rel}:${line + 1}`,
        line: line + 1,
        where,
        kinds,
        sample: value.replace(/\s+/g, ' ').trim().slice(0, 90),
      });
    };

    /** Read every literal inside a subtree already known to be user-visible. */
    const readVisibleSubtree = (node, where) => {
      // Do not descend into a nested component's non-visible props: a `key` or
      // a `data-*` on an element inside rendered copy is not user-visible.
      if (ts.isJsxAttribute(node) && !VISIBLE_ATTRS.has(attrName(node))) return;
      const value = literalText(node);
      if (value !== null) {
        stringsRead += 1;
        report(node, where, value);
      }
      ts.forEachChild(node, child => readVisibleSubtree(child, where));
    };

    const walk = node => {
      if (node.kind === ts.SyntaxKind.JsxText) {
        stringsRead += 1;
        report(node, 'JSX text', node.text);
      } else if (ts.isJsxAttribute(node) && VISIBLE_ATTRS.has(attrName(node)) && node.initializer) {
        readVisibleSubtree(node.initializer, `${attrName(node)}=`);
      } else if (
        ts.isJsxExpression(node) &&
        node.expression &&
        node.parent &&
        !ts.isJsxAttribute(node.parent)
      ) {
        // `{...}` as an element child: rendered copy.
        readVisibleSubtree(node.expression, 'JSX child expression');
      } else if (ts.isCallExpression(node)) {
        const callee = node.expression;
        const name = ts.isPropertyAccessExpression(callee)
          ? callee.name.getText(sf)
          : ts.isIdentifier(callee)
            ? callee.getText(sf)
            : '';
        if (VISIBLE_CALL_NAMES.has(name) || VISIBLE_SETTER.test(name)) {
          node.arguments.forEach(arg => readVisibleSubtree(arg, `${name}()`));
        }
      }
      ts.forEachChild(node, walk);
    };
    walk(sf);
  }

  return { violations, filesRead, stringsRead };
}

// ---------------------------------------------------------------------------
// --self-test: the fixture, and the discrimination it asserts.
//
// Every line below carries a banned dash. The ones ending `FLAGGED` sit on a
// user-visible surface and MUST be caught; the ones ending `exempt` do not and
// MUST NOT be. Keep the markers in the text: the assertion reads them.
// ---------------------------------------------------------------------------
const FIXTURE = `// A comment with an em dash ${EM_DASH} exempt
/** JSDoc with an em dash ${EM_DASH} exempt */
import React from 'react';

export function Control() {
  const [err, setErr] = React.useState('');
  const [uploadStatus, setUploadStatus] = React.useState('');
  console.log('console log with an em dash ${EM_DASH} exempt');
  const internal = 'plain variable with an em dash ${EM_DASH} exempt';
  setUploadStatus('status copy with an em dash ${EM_DASH} FLAGGED');
  setErr('setter name off the allowlist, em dash ${EM_DASH} exempt');
  alert('alert copy with an em dash ${EM_DASH} FLAGGED');
  return (
    <div data-x="attr off the allowlist, em dash ${EM_DASH} exempt">
      <p>JSX text with an em dash ${EM_DASH} FLAGGED</p>
      <p>JSX text with an en dash ${EN_DASH} in prose, FLAGGED</p>
      <p>Compact numeric range 5${EN_DASH}95% is allowed, exempt</p>
      <span title="title attr with an em dash ${EM_DASH} FLAGGED" />
      <span aria-label="aria-label en dash ${EN_DASH} in prose, FLAGGED" />
      <span placeholder={\`template placeholder em dash ${EM_DASH} FLAGGED \${internal}\`} />
      <div>{'JSX child literal with an em dash ${EM_DASH} FLAGGED'}</div>
      <div>{'escape hatch, em dash ${EM_DASH} exempt'}</div> {/* ui-text-check: allow */}
      <ul>{[1].map(i => <li key="nested-prop-em-dash${EM_DASH}exempt">{i}</li>)}</ul>
      <span title="allow-listed line, em dash ${EM_DASH} exempt" /> {/* ui-text-check: allow */}
      <p>{err}</p><p>{uploadStatus}</p>
    </div>
  );
}
`;

// A test file may hold the character on purpose, to assert its absence.
const FIXTURE_TEST = `it('a test file may hold an em dash ${EM_DASH} exempt', () => {
  expect('${EM_DASH}').toBe('${EM_DASH}');
});
`;

function selfTest() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ui-text-selftest-'));
  const src = path.join(dir, 'src');
  fs.mkdirSync(src);
  fs.writeFileSync(path.join(src, 'Control.tsx'), FIXTURE);
  fs.writeFileSync(path.join(src, 'Control.test.tsx'), FIXTURE_TEST);

  let pass = 0;
  let fail = 0;
  const say = (ok, what) => {
    if (ok) pass += 1;
    else fail += 1;
    console.log(`${ok ? 'ok  ' : 'FAIL'}  ${what}`);
  };

  const { violations, filesRead } = scan(src, src);
  const flaggedLines = new Set(violations.map(v => v.line));

  // Read the fixture's own markers rather than hardcoding line numbers, so
  // editing the fixture cannot silently drift the assertion away from it.
  const lines = FIXTURE.split('\n');
  let expectFlagged = 0;
  let expectExempt = 0;
  lines.forEach((text, i) => {
    const n = i + 1;
    if (!/[—–]/.test(text)) return;
    if (/FLAGGED/.test(text)) {
      expectFlagged += 1;
      say(flaggedLines.has(n), `line ${n} is caught: ${text.trim().slice(0, 62)}`);
    } else if (/exempt/.test(text)) {
      expectExempt += 1;
      say(!flaggedLines.has(n), `line ${n} is exempt: ${text.trim().slice(0, 62)}`);
    } else {
      say(false, `line ${n} carries a dash but no FLAGGED/exempt marker -- fixture is ambiguous`);
    }
  });

  say(expectFlagged === 8, `fixture still carries 8 must-be-flagged lines (saw ${expectFlagged})`);
  say(expectExempt === 10, `fixture still carries 10 exempt lines (saw ${expectExempt})`);
  say(
    violations.length === expectFlagged,
    `no extra violations beyond the expected ${expectFlagged} (saw ${violations.length})`,
  );
  say(filesRead === 1, `the .test.tsx file was excluded, so 1 file was read (saw ${filesRead})`);

  fs.rmSync(dir, { recursive: true, force: true });

  console.log(`\n${pass} passed, ${fail} failed, ${pass + fail} checks ran`);
  process.exit(fail ? 1 : 0);
}

if (process.argv.includes('--self-test')) selfTest();

const { violations, filesRead, stringsRead } = scan(path.join(ROOT, 'src'), ROOT);

// Floors, not just "greater than zero": a walk that half-breaks -- a changed glob, an AST
// shape this TypeScript stopped recognising -- reads SOME files and almost no strings, and
// then reports clean. MIN_FILES / MIN_STRINGS are declared at the top of this file.
if (filesRead < MIN_FILES || stringsRead < MIN_STRINGS) {
  console.error(
    `SKIP  read ${filesRead} file(s) and ${stringsRead} user-visible string(s) under src/, ` +
      `expected at least ${MIN_FILES} and ${MIN_STRINGS} -- the scan did not cover the ` +
      'tree it reports on, so it proves nothing. This is not a pass.',
  );
  process.exit(2);
}

if (violations.length) {
  for (const v of violations) {
    console.error(`FAIL  ${v.at}  [${v.where}] ${v.kinds.join(', ')}: ${v.sample}`);
  }
  console.error(
    `\n${violations.length} violation(s) in ${stringsRead} user-visible string(s) across ` +
      `${filesRead} file(s). Rewrite with a period, comma, colon or parentheses; use "to" for ` +
      'a range in a sentence. If the character is the point, add `// ui-text-check: allow`.',
  );
  process.exit(1);
}

console.log(
  `ok    ${stringsRead} user-visible string(s) across ${filesRead} file(s), no banned dashes`,
);
process.exit(0);
