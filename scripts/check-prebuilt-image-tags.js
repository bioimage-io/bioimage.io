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
 *   node scripts/check-prebuilt-image-tags.js
 *
 * Exit 0 = the constant is the newest published tag. Exit 1 = it is behind (or
 * names a tag that does not exist). Exit 2 = the check itself could not run,
 * which is deliberately NOT a pass.
 */
const fs = require('fs');
const path = require('path');
const https = require('https');

const GUIDE = path.join(__dirname, '..', 'src', 'components', 'bioengine', 'BioEngineGuide.tsx');

// image repo -> the constant in the guide that pins its tag
const PINS = [
  { repo: 'aicell-lab/model-runner', constant: 'PREBUILT_MODEL_RUNNER_VERSION' },
  { repo: 'aicell-lab/bioengine-worker', constant: 'DEFAULT_IMAGE_VERSION' },
];

// ghcr.io paginates `tags/list` over DIGESTS, most of which carry no tag, so a
// short page drops tagged versions out of the middle rather than off the end.
// Measured 2026-11-06 on aicell-lab/bioengine-worker: no `n` and `n=100` both
// returned 100 tags whose newest release was 0.6.14, while n=1000 returned 260
// and found 0.16.92. Asking for one page this large is why the check can speak
// about a repo with 260 tags at all.
//
// This went unnoticed because the only pin here was aicell-lab/model-runner,
// which has 3 tags in total. The one repo the check covered is the one repo
// where truncation cannot show up.
const PAGE_SIZE = 1000;

function get(url, headers = {}) {
  return new Promise((resolve, reject) => {
    https
      .get(url, { headers: { 'User-Agent': 'bioimage.io-tag-check', ...headers } }, res => {
        let body = '';
        res.on('data', chunk => (body += chunk));
        res.on('end', () =>
          res.statusCode === 200
            ? resolve(body)
            : reject(new Error(`${url} -> HTTP ${res.statusCode}`)),
        );
      })
      .on('error', reject);
  });
}

async function publishedTags(repo) {
  const scope = encodeURIComponent(`repository:${repo}:pull`);
  const { token } = JSON.parse(await get(`https://ghcr.io/token?scope=${scope}&service=ghcr.io`));
  const { tags } = JSON.parse(
    await get(`https://ghcr.io/v2/${repo}/tags/list?n=${PAGE_SIZE}`, {
      Authorization: `Bearer ${token}`,
    }),
  );
  const list = tags || [];
  // A page that comes back exactly full is indistinguishable from a page that
  // was cut off, and a truncated list is not a smaller true answer: it can hide
  // the newest tag entirely and bless an old pin as current. Refuse to judge.
  if (list.length >= PAGE_SIZE) {
    throw new Error(
      `tag list came back full at ${list.length} (n=${PAGE_SIZE}), so it may be truncated ` +
        `and cannot be compared against -- raise PAGE_SIZE or paginate with Link headers`,
    );
  }
  return list;
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
      console.error(`SKIP  ${repo}: could not reach GHCR (${err.message})`);
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
  }

  process.exit(failed ? 1 : 0);
})();
