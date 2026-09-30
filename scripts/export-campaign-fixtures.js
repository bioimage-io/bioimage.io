#!/usr/bin/env node
/**
 * Emit the campaign fixture corpus as JSON, for consumers outside this repo.
 *
 * The website owns the campaign wire format: `src/types/campaign.ts` is the
 * canonical definition and `src/services/__fixtures__/campaigns.ts` is the
 * canonical example of a service that speaks it. The backend owns the
 * semantics. That split only works if the backend can hold a copy of the
 * examples and notice when they drift, which is what this script produces.
 *
 * Output lands in `src/services/__fixtures__/corpus/`:
 *
 *   index.json              a CampaignListResponse, i.e. `list_campaigns`
 *   <campaign_id>.json      a CampaignRecord, i.e. `get_campaign`
 *   MANIFEST.json           schema version + sha256 of every file above
 *
 * Every file also carries a top-level `_synthetic` block. The figures in this
 * corpus are invented, and until 0.14.0-draft that warning lived only in the
 * README and in a banner the page draws. Neither reaches someone who fetches
 * the JSON, which is exactly what a vendoring consumer does, so the one route
 * that carries the numbers did not carry the warning. It is in the payload now.
 *
 * The key is underscore-prefixed to say it is not a wire field. It is a
 * property of THIS CORPUS, not of `CampaignRecord`, and a backend that starts
 * emitting it would be asserting its own live data is invented.
 *
 * A consumer vendors the JSON files and compares their sha256 against the
 * manifest. A mismatch means the corpus moved, which is the signal to re-read
 * the diff. The digests are taken over the SORTED-KEY serialisation, so
 * reordering a field in the TypeScript source does not fire the alarm, while
 * adding, removing, or changing a value does.
 *
 * Regenerate with:
 *
 *   node scripts/export-campaign-fixtures.js
 *
 * Verify the committed copy still matches the TypeScript with:
 *
 *   node scripts/export-campaign-fixtures.js --check
 *
 * which writes nothing and exits non-zero on drift. Without that check the
 * corpus is a snapshot that goes quietly stale the first time someone edits a
 * fixture, and a stale corpus is worse than none: a consumer's checksum would
 * keep passing against data the page no longer serves.
 *
 * The fixtures are TypeScript, so this transpiles them to a temp directory
 * first rather than duplicating the data in JavaScript. The repo-wide
 * `tsc --noEmit` is broken by an old declared compiler version, which is why
 * this pins a narrow file list and its own flags instead of using tsconfig.
 */
const { execFileSync } = require('child_process');
const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');

const REPO = path.resolve(__dirname, '..');
const OUT_DIR = path.join(REPO, 'src', 'services', '__fixtures__', 'corpus');

/**
 * Hand-written files that live alongside the generated ones. Neither wiped on
 * regenerate nor reported as drift by --check.
 */
const PRESERVE = new Set(['README.md']);

/**
 * The in-payload synthetic marker. Stamped on every emitted file.
 *
 * Deliberately verbose. A short flag like `"synthetic": true` is readable only
 * by someone who already suspects the answer, and the failure this guards
 * against is a reader who does not: someone who fetches one of these files,
 * sees plausible counts with plausible timestamps, and quotes them. The
 * sentence has to do the work on its own, at the point of contact, with no
 * README in hand.
 */
const SYNTHETIC_MARKER = {
  warning:
    'The figures in this file are invented. No campaign described here has run. Every count, byte total, timestamp and metric value is a shape chosen to exercise the wire format, not a measurement. Vendoring this file pins the FORMAT. Quoting its values as evidence is a misread.',
  pins: 'format',
  source: 'src/services/__fixtures__/campaigns.ts in bioimage-io/bioimage.io',
  since: '0.14.0-draft',
};

/**
 * Deep key sort, so the digest tracks content rather than declaration order.
 * Arrays keep their order: the corpus uses arrays for things like the
 * contribution stream where order is part of the meaning.
 */
function sortKeys(value) {
  if (Array.isArray(value)) return value.map(sortKeys);
  if (value === null || typeof value !== 'object') return value;
  const out = {};
  for (const key of Object.keys(value).sort()) out[key] = sortKeys(value[key]);
  return out;
}

function stableJson(value) {
  return JSON.stringify(sortKeys(value), null, 2) + '\n';
}

function sha256(text) {
  return crypto.createHash('sha256').update(text, 'utf8').digest('hex');
}

function loadFixtures() {
  const outDir = fs.mkdtempSync(path.join(os.tmpdir(), 'campaign-fixtures-'));
  const tsc = path.join(REPO, 'node_modules', '.bin', 'tsc');
  try {
    execFileSync(
      tsc,
      [
        'src/types/campaign.ts',
        'src/services/__fixtures__/campaigns.ts',
        '--outDir',
        outDir,
        '--rootDir',
        'src',
        '--module',
        'commonjs',
        '--target',
        'es2017',
        '--skipLibCheck',
        '--downlevelIteration',
      ],
      { cwd: REPO, stdio: 'pipe' }
    );
  } catch (err) {
    // tsc exits non-zero on ambient type errors from unrelated packages while
    // still emitting the two files asked for. Only a missing emit is fatal.
    const emitted = path.join(outDir, 'services', '__fixtures__', 'campaigns.js');
    if (!fs.existsSync(emitted)) {
      process.stderr.write(String(err.stdout || '') + String(err.stderr || ''));
      throw new Error('tsc produced no fixture output');
    }
  }
  // eslint-disable-next-line import/no-dynamic-require, global-require
  return require(path.join(outDir, 'services', '__fixtures__', 'campaigns.js'));
}

function main() {
  const check = process.argv.includes('--check');
  const { FIXTURE_CAMPAIGNS, FIXTURE_CAMPAIGN_SUMMARIES } = loadFixtures();
  const ids = Object.keys(FIXTURE_CAMPAIGNS).sort();

  const versions = new Set(ids.map((id) => FIXTURE_CAMPAIGNS[id].schema_version));
  if (versions.size !== 1) {
    throw new Error(`fixtures disagree on schema_version: ${[...versions].join(', ')}`);
  }
  const schemaVersion = [...versions][0];

  const files = {};
  // The index response the page sees first. Its schema_version sits on the
  // envelope, not per item, exactly as CampaignListResponse declares.
  files['index.json'] = stableJson({
    _synthetic: SYNTHETIC_MARKER,
    schema_version: schemaVersion,
    campaigns: FIXTURE_CAMPAIGN_SUMMARIES,
  });
  for (const id of ids) {
    files[`${id}.json`] = stableJson({ _synthetic: SYNTHETIC_MARKER, ...FIXTURE_CAMPAIGNS[id] });
  }

  const digests = {};
  for (const [name, text] of Object.entries(files)) digests[name] = sha256(text);

  files['MANIFEST.json'] = stableJson({
    _synthetic: SYNTHETIC_MARKER,
    schema_version: schemaVersion,
    source: 'src/services/__fixtures__/campaigns.ts',
    regenerate: 'node scripts/export-campaign-fixtures.js',
    digest: 'sha256 over the sorted-key JSON in this directory',
    files: digests,
  });

  const rel = path.relative(REPO, OUT_DIR);

  if (check) {
    const stale = [];
    // A file the generator no longer produces is drift too, not just a
    // changed one, so compare the directory listing in both directions.
    const onDisk = fs.existsSync(OUT_DIR) ? fs.readdirSync(OUT_DIR).sort() : [];
    for (const name of onDisk) {
      if (!(name in files) && !PRESERVE.has(name)) {
        stale.push(`${name}: committed but no longer generated`);
      }
    }
    for (const [name, text] of Object.entries(files)) {
      const target = path.join(OUT_DIR, name);
      if (!fs.existsSync(target)) stale.push(`${name}: generated but not committed`);
      else if (fs.readFileSync(target, 'utf8') !== text) stale.push(`${name}: differs`);
    }
    if (stale.length > 0) {
      process.stderr.write(`${rel} is stale:\n`);
      for (const line of stale.sort()) process.stderr.write(`  ${line}\n`);
      process.stderr.write('Run: node scripts/export-campaign-fixtures.js\n');
      process.exit(1);
    }
    process.stdout.write(`${rel} is in sync, schema ${schemaVersion}\n`);
    return;
  }

  fs.mkdirSync(OUT_DIR, { recursive: true });
  for (const name of fs.readdirSync(OUT_DIR)) {
    if (!PRESERVE.has(name)) fs.rmSync(path.join(OUT_DIR, name), { recursive: true, force: true });
  }
  for (const [name, text] of Object.entries(files)) {
    fs.writeFileSync(path.join(OUT_DIR, name), text);
  }

  process.stdout.write(`schema ${schemaVersion}\n`);
  for (const name of Object.keys(digests).sort()) {
    process.stdout.write(`  ${rel}/${name}  ${digests[name].slice(0, 16)}\n`);
  }
  process.stdout.write(`  ${rel}/MANIFEST.json\n`);
}

main();
