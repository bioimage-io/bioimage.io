#!/usr/bin/env node
/**
 * Fail when the prebuilt image tag hardcoded in the worker setup wizard is no
 * longer the newest tag published on GHCR.
 *
 * The wizard cannot look this up itself: ghcr.io answers the tag list fine but
 * sends no Access-Control-Allow-Origin, so a browser fetch from bioimage.io is
 * blocked. The constant therefore has to be carried in the source, and a carried
 * version rots with nothing attached to say so — the wizard would go on quietly
 * offering an old image to every new worker. This turns that into a failure
 * someone can actually see.
 *
 * The same tag is also written out longhand in the served skill docs, where it
 * rots the same way and is read by agents rather than by the wizard. So the
 * check has two arms: the constant must be the newest published tag, and every
 * other copy of that image reference in the tree must agree with the constant.
 * A guard that covers one of three copies leaves the other two to rot silently,
 * which is the failure this script exists to end.
 *
 *   node scripts/check-prebuilt-image-tags.js
 *
 * Exit 0 = the constant is the newest published tag and every copy agrees.
 * Exit 1 = it is behind, names a tag that does not exist, or a copy disagrees.
 * Exit 2 = the check itself could not run, which is deliberately NOT a pass.
 *          Reached by an unreachable registry, a tag list that may be truncated,
 *          and a copies arm that has lost the tree it was meant to read. All
 *          three are the check losing its coverage, and none of them is a pass.
 */
const fs = require('fs');
const path = require('path');
const https = require('https');

const ROOT = path.join(__dirname, '..');
const GUIDE = path.join(ROOT, 'src', 'components', 'bioengine', 'BioEngineGuide.tsx');

// image repo -> the constant in the guide that pins its tag
const PINS = [
  { repo: 'aicell-lab/model-runner', constant: 'PREBUILT_MODEL_RUNNER_VERSION' },
  { repo: 'aicell-lab/bioengine-worker', constant: 'DEFAULT_IMAGE_VERSION' },
];

// Where a longhand `ghcr.io/<repo>:<tag>` may appear. Deliberately a short
// explicit list rather than a whole-tree walk: build output and node_modules
// carry compiled copies of these same strings, and failing on those would make
// the check depend on whether someone had run a build.
const COPY_ROOTS = [
  path.join(ROOT, 'public', 'skills'),
  path.join(ROOT, 'src'),
];
const COPY_EXTENSIONS = ['.md', '.tsx', '.ts', '.js', '.json', '.yml', '.yaml'];

/**
 * Every file under `dir` whose extension is one we scan.
 *
 * Deliberately lets a `readdirSync` failure propagate. Swallowing it returned an
 * empty list, which the copies arm below could not tell from "every copy
 * agrees" -- so renaming `public/skills` made the arm green while examining
 * nothing. That is the same silent-coverage-loss this script exists to end.
 */
function walk(dir) {
  let out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out = out.concat(walk(full));
    else if (COPY_EXTENSIONS.includes(path.extname(entry.name))) out.push(full);
  }
  return out;
}

/**
 * The files the copies arm will read, or a throw naming why it cannot.
 *
 * Both failures are the arm losing its coverage rather than finding nothing
 * wrong: a `COPY_ROOT` that has moved, and a root tree that holds no file with
 * an extension we scan. Either one must reach exit 2, never exit 0.
 */
function filesToScan() {
  const files = [];
  for (const root of COPY_ROOTS) {
    let stat;
    try {
      stat = fs.statSync(root);
    } catch (err) {
      throw new Error(`COPY_ROOT ${path.relative(ROOT, root)} does not exist (${err.code || err.message})`);
    }
    if (!stat.isDirectory()) {
      throw new Error(`COPY_ROOT ${path.relative(ROOT, root)} is not a directory`);
    }
    files.push(...walk(root));
  }
  if (files.length === 0) {
    throw new Error(`no file under ${COPY_ROOTS.map(r => path.relative(ROOT, r)).join(', ')} has an extension this check scans`);
  }
  return files;
}

/**
 * Longhand `ghcr.io/<repo>:<tag>` references whose tag is a literal version.
 * `${...}` interpolations are skipped on purpose: those derive from the
 * constant, so they cannot disagree with it.
 */
function copiesOf(repo, files) {
  const pattern = new RegExp(`ghcr\\.io/${repo.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}:([\\w.\\-]+)`, 'g');
  const found = [];
  for (const file of files) {
    const text = fs.readFileSync(file, 'utf8');
    let match;
    while ((match = pattern.exec(text)) !== null) {
      found.push({ file: path.relative(ROOT, file), tag: match[1] });
    }
  }
  return found;
}

/** Resolves `{ body, headers }`; the headers carry the registry's pagination link. */
function get(url, headers = {}) {
  return new Promise((resolve, reject) => {
    https
      .get(url, { headers: { 'User-Agent': 'bioimage.io-tag-check', ...headers } }, res => {
        let body = '';
        res.on('data', chunk => (body += chunk));
        res.on('end', () =>
          res.statusCode === 200
            ? resolve({ body, headers: res.headers })
            : reject(new Error(`${url} -> HTTP ${res.statusCode}`)),
        );
      })
      .on('error', reject);
  });
}

/**
 * Every published tag, following the registry's pagination to the end.
 *
 * The v2 tags/list endpoint caps a page at 100 and hands back the rest behind a
 * `Link: <...>; rel="next"` header. Reading one page and stopping does NOT fail
 * loudly: it returns a short list in lexical order, so for a repo with hundreds
 * of tags the "newest" comes out as whatever sorts late within the first 100.
 * Measured on ghcr.io/aicell-lab/bioengine-worker: one page gives 100 tags and a
 * newest of 0.6.14, while following the link gives 260 tags and 0.16.92. A pin
 * checked against the first answer is checked against nothing.
 *
 * Every way this can end up with a short list throws instead of returning one,
 * because a short list is exactly what blesses a stale pin as current:
 *   - the chain is still unterminated after MAX_PAGES;
 *   - a page comes back at the full requested size with no next link, which
 *     cannot be told apart from a silent truncation.
 * The second needs saying: the link-following above assumes the registry
 * advertises `rel="next"` whenever it truncates. That was measured true at the
 * default page size, but NOT at `n=PAGE_SIZE` -- no repo in scope has that many
 * tags, so the assumption is untested where this code relies on it. This guard
 * is what makes the untested case loud rather than wrong.
 */
const PAGE_SIZE = 1000;
const MAX_PAGES = 100;

async function publishedTags(repo) {
  const scope = encodeURIComponent(`repository:${repo}:pull`);
  const { body: tokenBody } = await get(`https://ghcr.io/token?scope=${scope}&service=ghcr.io`);
  const { token } = JSON.parse(tokenBody);

  const tags = [];
  let url = `https://ghcr.io/v2/${repo}/tags/list?n=${PAGE_SIZE}`;
  // Bounded so a registry that keeps handing back a next link cannot spin here.
  let page = 0;
  for (; url && page < MAX_PAGES; page += 1) {
    const { body, headers } = await get(url, { Authorization: `Bearer ${token}` });
    const pageTags = JSON.parse(body).tags || [];
    tags.push(...pageTags);
    const link = headers.link;
    const next = link && /rel="next"/.test(link) ? /<([^>]+)>/.exec(link) : null;
    url = next ? new URL(next[1], 'https://ghcr.io').toString() : null;
    if (!url && pageTags.length >= PAGE_SIZE) {
      throw new Error(
        `ghcr.io/${repo} returned a full page of ${pageTags.length} tags with no rel="next" link, so the list may be truncated and cannot be judged`,
      );
    }
  }
  if (url) {
    throw new Error(`ghcr.io/${repo} still had a rel="next" link after ${MAX_PAGES} pages, so the tag list is incomplete`);
  }
  return tags;
}

// Numeric-segment compare, so 2.10.6 sorts above 2.8.0 rather than below it as
// a string compare would. Pre-release tags (2.11.0-dev1) are ignored: they are
// not what the wizard should offer.
const parts = v => v.split('.').map(Number);
function newer(a, b) {
  const [x, y] = [parts(a), parts(b)];
  for (let i = 0; i < Math.max(x.length, y.length); i += 1) {
    if ((x[i] || 0) !== (y[i] || 0)) return (x[i] || 0) > (y[i] || 0);
  }
  return false;
}

(async () => {
  let source;
  try {
    source = fs.readFileSync(GUIDE, 'utf8');
  } catch (err) {
    console.error(`cannot read ${GUIDE}: ${err.message}`);
    process.exit(2);
  }

  // Resolved once, before any verdict, so a lost COPY_ROOT stops the run rather
  // than quietly shrinking the second arm's coverage to nothing.
  let copyFiles;
  try {
    copyFiles = filesToScan();
  } catch (err) {
    console.error(`SKIP  copies arm: no verdict (${err.message})`);
    process.exit(2);
  }

  let failed = false;
  for (const { repo, constant } of PINS) {
    const match = source.match(new RegExp(`${constant}\\s*=\\s*['"]([^'"]+)['"]`));
    if (!match) {
      console.error(`FAIL  ${constant} not found in BioEngineGuide.tsx`);
      failed = true;
      continue;
    }
    const pinned = match[1];

    let tags;
    try {
      tags = await publishedTags(repo);
    } catch (err) {
      // Deliberately does not name a cause. The truncation guard throws here
      // too, and GHCR had answered perfectly well in that case -- saying "could
      // not reach GHCR" would send the reader to look at the network.
      console.error(`SKIP  ${repo}: no verdict (${err.message})`);
      process.exit(2);
    }

    const releases = tags.filter(t => /^\d+(\.\d+)*$/.test(t));
    const latest = releases.sort((a, b) => (newer(a, b) ? -1 : 1))[0];

    if (!tags.includes(pinned)) {
      console.error(`FAIL  ${constant}='${pinned}' is not published. Tags: ${tags.join(', ')}`);
      failed = true;
    } else if (latest && newer(latest, pinned)) {
      console.error(`FAIL  ${constant}='${pinned}' is behind '${latest}' on ghcr.io/${repo}`);
      failed = true;
    } else {
      console.log(`ok    ${constant}='${pinned}' is the newest tag on ghcr.io/${repo}`);
    }

    // Second arm: every longhand copy of the image must name the same tag the
    // constant does. This is checked even when the constant itself is behind,
    // so one run reports every place that needs editing rather than one.
    const copies = copiesOf(repo, copyFiles);
    const stale = copies.filter(copy => copy.tag !== pinned);
    if (stale.length > 0) {
      for (const copy of stale) {
        console.error(`FAIL  ${copy.file} names ghcr.io/${repo}:${copy.tag}, but ${constant}='${pinned}'`);
      }
      failed = true;
    } else {
      // The count is printed because "agrees" over zero copies and "agrees" over
      // five read identically otherwise, and this repo has had both.
      console.log(`ok    ${copies.length} longhand ghcr.io/${repo} reference(s) agree with ${constant} (${copyFiles.length} files scanned)`);
    }
  }

  process.exit(failed ? 1 : 0);
})();
