#!/usr/bin/env node
/**
 * Enforce CLAUDE.md's user-visible punctuation rules by parsing, not grepping.
 *
 * A plain `grep` for em dashes over src/ reports 255 hits, nearly all of them in comments
 * and console logs, where the rule explicitly exempts them. So this walks the TypeScript AST
 * and only looks at the surfaces that actually reach a user:
 *
 *   1. JSX text                          <p>copy — here</p>
 *   2. user-visible JSX attributes       title / placeholder / aria-label / alt / label / ...
 *   3. string literals as JSX children   <div>{'copy — here'}</div>
 *   4. arguments to user-facing calls    alert(), confirm(), toast.*(), showToast(),
 *                                        and setters whose name ends Status/Message/Error/Warning
 *
 * Banned: em dash (U+2014) anywhere on those surfaces; en dash (U+2013) except between two
 * digits, which keeps compact numeric ranges such as 5–95% legal.
 *
 * Not covered, and deliberately left to review: "no unnecessary semicolons". Whether a
 * semicolon is unnecessary is a judgement about the sentence, and no parse can decide it.
 *
 * Escape hatch: put `ui-text-check: allow` in a comment on the same line as the string.
 *
 * Usage:
 *   node scripts/check-ui-text.mjs              # gate: scan src/, exit 1 on any violation
 *   node scripts/check-ui-text.mjs --self-test  # prove the gate can go RED, on a fixture
 *   node scripts/check-ui-text.mjs <path ...>   # scan specific files or directories
 */

import ts from 'typescript';
import { readFileSync, readdirSync, statSync } from 'fs';
import { join, relative, resolve, basename, sep } from 'path';
import { fileURLToPath } from 'url';

const REPO_ROOT = resolve(fileURLToPath(import.meta.url), '..', '..');
const CONTROL_DIR = join(REPO_ROOT, 'scripts', 'ui-text-control');

/** JSX attributes whose value is rendered to, or read aloud to, a user. */
const VISIBLE_ATTRS = new Set([
  'title', 'placeholder', 'alt', 'label', 'helperText', 'tooltip', 'caption',
  'aria-label', 'aria-description', 'aria-placeholder', 'aria-valuetext', 'aria-roledescription',
]);

/** Calls whose string arguments are shown to a user. */
const VISIBLE_CALLS = new Set(['alert', 'confirm', 'prompt', 'showToast', 'enqueueSnackbar']);
const VISIBLE_CALL_RE = /^(toast|snackbar)\./;
/** setUploadStatus / setErrorMessage / setWarning are user copy; setErr, setOpen, setData are not. */
const VISIBLE_SETTER_RE = /^set[A-Z]\w*(Status|Message|Error|Warning|Text|Label)$/;

const EM_DASH = '—';
const EN_DASH = '–';

const isTestPath = (p) => /\.(test|spec)\.tsx?$/.test(p) || /(^|[\\/])(__tests__|__mocks__)[\\/]/.test(p)
  || /(^|[\\/])setupTests\./.test(p);

/** @returns {{char: string, reason: string}[]} the banned dashes in `text`, if any. */
function bannedDashes(text) {
  const hits = [];
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (c === EM_DASH) {
      hits.push({ char: 'em dash', reason: 'em dashes are banned in user-visible text' });
    } else if (c === EN_DASH) {
      const numericRange = /\d/.test(text[i - 1] || '') && /\d/.test(text[i + 1] || '');
      if (!numericRange) {
        hits.push({ char: 'en dash', reason: 'en dashes are banned in prose (allowed only between digits, e.g. 5–95%)' });
      }
    }
  }
  return hits;
}

function collectFiles(target, out) {
  const st = statSync(target);
  if (st.isDirectory()) {
    if (basename(target) === 'node_modules') return out;
    for (const entry of readdirSync(target).sort()) collectFiles(join(target, entry), out);
    return out;
  }
  if (/\.tsx?$/.test(target) && !target.endsWith('.d.ts') && !isTestPath(target)) out.push(target);
  return out;
}

/** The JSX attribute a string literal belongs to, or null. */
function owningJsxAttribute(node) {
  let n = node.parent;
  if (n && n.kind === ts.SyntaxKind.JsxExpression) n = n.parent;
  return n && ts.isJsxAttribute(n) ? n.name.getText() : null;
}

/** True when a string literal is a direct JSX child, as in <div>{'copy'}</div>. */
function isJsxChild(node) {
  const n = node.parent;
  return !!n && n.kind === ts.SyntaxKind.JsxExpression
    && !!n.parent && (ts.isJsxElement(n.parent) || ts.isJsxFragment(n.parent));
}

/** The user-facing call a string literal is an argument of, or null. */
function owningVisibleCall(node) {
  const n = node.parent;
  if (!n || !ts.isCallExpression(n) || !n.arguments.includes(node)) return null;
  const callee = n.expression.getText();
  const bare = callee.replace(/^window\./, '');
  if (VISIBLE_CALLS.has(bare) || VISIBLE_CALL_RE.test(bare) || VISIBLE_SETTER_RE.test(bare)) return callee;
  return null;
}

function scanFile(file) {
  const source = readFileSync(file, 'utf8');
  const lines = source.split('\n');
  const sf = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true,
    file.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
  const violations = [];

  const report = (node, surface, text) => {
    const line = sf.getLineAndCharacterOfPosition(node.getStart(sf)).line;
    if ((lines[line] || '').includes('ui-text-check: allow')) return;
    for (const hit of bannedDashes(text)) {
      violations.push({
        file: relative(REPO_ROOT, file), line: line + 1, surface, char: hit.char, reason: hit.reason,
        snippet: text.replace(/\s+/g, ' ').trim().slice(0, 100),
      });
    }
  };

  const walk = (node) => {
    if (node.kind === ts.SyntaxKind.JsxText) {
      report(node, 'JSX text', node.text);
    } else if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) {
      const attr = owningJsxAttribute(node);
      if (attr !== null) {
        if (VISIBLE_ATTRS.has(attr)) report(node, `attribute ${attr}`, node.text);
      } else if (isJsxChild(node)) {
        report(node, 'JSX child string', node.text);
      } else {
        const call = owningVisibleCall(node);
        if (call) report(node, `argument to ${call}()`, node.text);
      }
    } else if (ts.isTemplateExpression(node)) {
      // A template's literal chunks are user copy; its ${} substitutions are code.
      const literal = [node.head, ...node.templateSpans.map((s) => s.literal)].map((p) => p.text).join(' ');
      const attr = owningJsxAttribute(node);
      if (attr !== null) {
        if (VISIBLE_ATTRS.has(attr)) report(node, `attribute ${attr}`, literal);
      } else if (isJsxChild(node)) {
        report(node, 'JSX child template', literal);
      } else {
        const call = owningVisibleCall(node);
        if (call) report(node, `argument to ${call}()`, literal);
      }
    }
    ts.forEachChild(node, walk);
  };
  walk(sf);
  return violations;
}

function scan(targets) {
  const files = [];
  for (const t of targets) collectFiles(t, files);
  const violations = files.flatMap(scanFile);
  return { files, violations };
}

function printViolations(violations) {
  for (const v of violations) {
    console.log(`  ${v.file}:${v.line}  [${v.surface}] ${v.char}`);
    console.log(`      ${v.snippet}`);
  }
}

/**
 * Prove the gate discriminates. Every expectation below is a line of
 * scripts/ui-text-control/Control.tsx, which exists only to be scanned here.
 */
function selfTest() {
  const EXPECT_FLAGGED = [
    [10, 'setUploadStatus'], [12, 'alert'], [15, 'JSX text em dash'], [16, 'JSX text en dash'],
    [18, 'title attribute'], [19, 'aria-label attribute'], [20, 'placeholder template'],
    [21, 'JSX child string literal'],
  ];
  const EXPECT_CLEAN_LINES = [
    [1, 'line comment'], [2, 'JSDoc'], [8, 'console.log'], [9, 'plain variable'],
    [11, 'setErr, not a visible-setter name'], [14, 'attribute off the allowlist'],
    [17, 'compact numeric range 5–95%'], [22, 'escape-hatch comment on a JSX child'],
    [23, 'key attribute'], [24, 'escape-hatch comment on a title attribute'],
  ];

  const { files, violations } = scan([CONTROL_DIR]);
  const flagged = new Set(violations.map((v) => v.line));
  const checks = [];

  checks.push(['the fixture parsed as 1 non-test file (the .test.tsx is excluded)', files.length === 1,
    `scanned ${files.length}`]);
  for (const [line, what] of EXPECT_FLAGGED) {
    checks.push([`line ${line} is FLAGGED (${what})`, flagged.has(line), flagged.has(line) ? 'flagged' : 'MISSED']);
  }
  for (const [line, what] of EXPECT_CLEAN_LINES) {
    checks.push([`line ${line} is clean (${what})`, !flagged.has(line), flagged.has(line) ? 'FALSE POSITIVE' : 'clean']);
  }
  checks.push([`no violation outside the expected lines`,
    violations.every((v) => EXPECT_FLAGGED.some(([l]) => l === v.line)),
    `${violations.length} violations on lines ${[...flagged].sort((a, b) => a - b).join(',')}`]);
  // The fixture's own test file holds an em dash on purpose and must never be scanned.
  checks.push(['the fixture test file is excluded by path',
    !files.some((f) => /\.test\.tsx$/.test(f)), files.map((f) => basename(f)).join(' ')]);

  const failed = checks.filter(([, ok]) => !ok);
  for (const [what, ok, detail] of checks) console.log(`  ${ok ? 'pass' : 'FAIL'}  ${what}  (${detail})`);
  console.log(`\n${checks.length - failed.length}/${checks.length} checks passed`);
  if (failed.length) {
    console.log('\nviolations the fixture actually produced:');
    printViolations(violations);
    return 1;
  }
  return 0;
}

const argv = process.argv.slice(2);

if (argv.includes('--self-test')) {
  console.log(`self-test: ${relative(REPO_ROOT, CONTROL_DIR)}${sep}Control.tsx\n`);
  process.exit(selfTest());
}

const targets = (argv.length ? argv : ['src']).map((t) => resolve(REPO_ROOT, t));
const { files, violations } = scan(targets);
const FLOOR = argv.length ? 1 : 100;

console.log(`scanned ${files.length} file(s) under ${targets.map((t) => relative(REPO_ROOT, t) || '.').join(', ')}`);
if (files.length < FLOOR) {
  console.error(`\nFAIL: only ${files.length} file(s) matched, expected at least ${FLOOR}.`);
  console.error('A scan that found nothing to read is not a pass. Check the path.');
  process.exit(2);
}
if (violations.length) {
  console.error(`\nFAIL: ${violations.length} banned dash(es) in user-visible text:\n`);
  printViolations(violations);
  console.error('\nRewrite with a period, comma, colon or parentheses. Comments, console logs and');
  console.error('test files are exempt. To keep one deliberately, add a same-line comment:');
  console.error('  {/* ui-text-check: allow */}');
  process.exit(1);
}
console.log('OK: no banned dashes in user-visible text.');
