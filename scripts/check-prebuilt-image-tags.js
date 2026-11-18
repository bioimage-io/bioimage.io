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
];

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
    await get(`https://ghcr.io/v2/${repo}/tags/list`, { Authorization: `Bearer ${token}` }),
  );
  return tags || [];
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
