#!/usr/bin/env node
/**
 * Guard: the SLURM worker setup wizard must attach pass-through argument values
 * with `=`, never separate them with a space.
 *
 * The worker parses its command line with argparse, which accepts a value
 * beginning with `-` only when that value ALSO contains a space. The shell
 * removes the quotes the wizard emits before argparse sees the token, so
 * `--further-slurm-args "--reservation=bioengine"` arrives as two flags and the
 * worker exits 2 with "expected one argument". `--reservation=<name>` is one
 * directive with no space in it, which is exactly the shape that fails.
 *
 * Two halves, both needed:
 *   1. A behavioural check of `attachedFlag`, lifted out of the component by
 *      regex and rebuilt with `new Function`, run over a table that includes
 *      the dash-free control (which parses either way, so it is what proves the
 *      leading dash is the discriminator rather than the quoting).
 *   2. A textual check that no call site has drifted back to the space form.
 *      The helper being correct is worthless if a fourth flag is added next to
 *      it the old way, and that is the regression this file exists to catch.
 *
 * Run: node scripts/check-slurm-arg-quoting.js
 * Exits non-zero on the first failure, with the expected and actual values.
 */
const fs = require('fs');
const path = require('path');

const GUIDE = path.join(__dirname, '..', 'src', 'components', 'bioengine', 'BioEngineGuide.tsx');
const source = fs.readFileSync(GUIDE, 'utf8');

let failures = 0;
let checks = 0;

function check(label, actual, expected) {
  checks += 1;
  const ok = actual === expected;
  if (!ok) failures += 1;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}`);
  if (!ok) {
    console.log(`        expected: ${JSON.stringify(expected)}`);
    console.log(`        actual:   ${JSON.stringify(actual)}`);
  }
}

// ---------------------------------------------------------------- part 1
// Lift `attachedFlag` out of the component. It is a module-scope arrow with a
// single expression body, which is the only shape this regex accepts; if it is
// refactored into something else the extraction fails loudly rather than
// silently testing nothing.
const match = source.match(
  /const attachedFlag = \(flag: string, value: string\): string =>\s*(`[^`]*`);/
);
if (!match) {
  console.error(
    'FATAL: could not extract `attachedFlag` from BioEngineGuide.tsx.\n' +
    '       Either it was renamed or its shape changed. This guard tested NOTHING.\n' +
    '       Update the regex above to match the new definition before trusting a pass.'
  );
  process.exit(2);
}

// eslint-disable-next-line no-new-func
const attachedFlag = new Function('flag', 'value', `return ${match[1]};`);

const CASES = [
  // [flag, value, expected token, what it stands for]
  ['--further-slurm-args', '--reservation=bioengine', '--further-slurm-args="--reservation=bioengine"',
    'one directive, leading dash, NO space (the Berzelius reservation remedy)'],
  ['--further-slurm-args', '--qos=high', '--further-slurm-args="--qos=high"',
    'one directive, leading dash, NO space'],
  ['--further-slurm-args', '-Cthin', '--further-slurm-args="-Cthin"',
    'short directive, no separator, NO space'],
  ['--further-slurm-args', '-A proj -C thin', '--further-slurm-args="-A proj -C thin"',
    'two directives, WITH space (worked before the fix too, must keep working)'],
  ['--further-apptainer-args', '--writable-tmpfs', '--further-apptainer-args="--writable-tmpfs"',
    'apptainer, one flag, NO space'],
  ['--further-apptainer-args', '--bind /host:/container', '--further-apptainer-args="--bind /host:/container"',
    'apptainer, WITH space'],
  ['--gpu-slurm-flag', '--gres=gpu:{n}', '--gpu-slurm-flag="--gres=gpu:{n}"',
    'the gres option, the only non-default non-empty choice in that select'],
  ['--gpu-slurm-flag', '', '--gpu-slurm-flag=""',
    'empty value, meaning omit the GPU directive entirely'],
  // Control. A value with no leading dash parses in the space form too, so this
  // row is what shows the table above is about the dash and not about quoting.
  ['--further-slurm-args', 'partition=gpu', '--further-slurm-args="partition=gpu"',
    'CONTROL: no leading dash, parses either way'],
];

for (const [flag, value, expected, what] of CASES) {
  check(`attachedFlag: ${what}`, attachedFlag(flag, value), expected);
}

// Every emitted token must be one argparse argument: the flag, '=', the value.
// Checking the shape rather than only the strings catches a helper that happens
// to produce the right output for this table but not in general.
checks += 1;
const shaped = CASES.every(([flag, value]) => attachedFlag(flag, value) === `${flag}="${value}"`);
if (!shaped) failures += 1;
console.log(`${shaped ? 'PASS' : 'FAIL'}  attachedFlag: every token is flag="value", with no space before the value`);

// ---------------------------------------------------------------- part 2
// No call site may use the space-separated form for a flag whose value can
// begin with a dash. --workspace and --worker-name are deliberately not in this
// list: they carry identifiers, not flag strings.
const DASH_VALUED_FLAGS = ['--further-slurm-args', '--further-apptainer-args', '--gpu-slurm-flag'];
for (const flag of DASH_VALUED_FLAGS) {
  // A backtick-template push with the flag followed by whitespace, i.e. the
  // broken form. Comments are stripped first so the explanatory comment above
  // `attachedFlag` (which quotes the broken form on purpose) is not a hit.
  const withoutComments = source
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:])\/\/.*$/gm, '$1');
  const broken = new RegExp(`${flag.replace(/-/g, '\\-')}\\s+["'\`]?\\$\\{`);
  const found = broken.test(withoutComments);
  checks += 1;
  if (found) failures += 1;
  console.log(`${found ? 'FAIL' : 'PASS'}  no call site emits \`${flag} <value>\` (space-separated)`);
  if (found) {
    console.log('        a value beginning with - and containing no space makes the worker exit 2;');
    console.log(`        use attachedFlag('${flag}', value) instead`);
  }
}

// And each of the three must actually go through the helper. Without this, the
// part-2 checks above pass for a flag that was simply deleted.
for (const flag of DASH_VALUED_FLAGS) {
  const viaHelper = source.includes(`attachedFlag('${flag}'`);
  checks += 1;
  if (!viaHelper) failures += 1;
  console.log(`${viaHelper ? 'PASS' : 'FAIL'}  ${flag} is emitted through attachedFlag`);
}

console.log(`\nchecks run: ${checks}; failures: ${failures}`);
process.exit(failures ? 1 : 0);
