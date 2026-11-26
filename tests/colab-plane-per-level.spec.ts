import { test, expect } from '@playwright/test';
import fs from 'fs';
import { BASE_URL } from './baseUrl';

/**
 * A z-resampled OME-Zarr pyramid is drawn on the slice that was RECORDED, at
 * every level, not on each level's own middle one.
 *
 * Why this cannot be a unit test. The derivation is pure and unit tested, but
 * what it is worth depends on the store's real level shapes arriving in the
 * browser and on the viewer asking for the chunk that derivation names. The
 * oracle here is therefore the browser's own network traffic: this fixture
 * stores ONE Z SLICE PER CHUNK, so the chunk key carries the plane and a
 * request for `s0/0.0.7.0.0` is a read of z=7 and of nothing else.
 *
 * WHY z=7 AND NOT THE MIDDLE SLICE, which is the point of the whole fixture.
 * The store has 9 slices at level 0 and 5 at level 1. A record of z=4 maps to
 * level 1 index 2; but 4 is also level 0's own middle slice and 2 is level 1's,
 * so the bug this guards against ("pin each level's middle slice") would draw
 * exactly the same pixels as the fix, at both levels, and the measurement
 * could not fail. z=7 maps to level 1 index 3, while the middle slices stay 4
 * and 2, so the correct and incorrect behaviours differ at every level.
 *
 *   level 0: 9 slices, recorded index 7           -> 7   (middle would be 4)
 *   level 1: 5 slices, 7 * 5 / 9 = 3.89, floored  -> 3   (middle would be 2)
 *
 * Level 1 slice 3 covers level-0 z in [5.4, 7.2), which contains 7. So the
 * derived index is not merely different from the middle, it is the slice that
 * actually contains the recorded one.
 *
 * REQUIRES a z-resampled store that the BROWSER can read: public over https
 * with `Access-Control-Allow-Origin`, two levels, level 1 with a smaller z
 * extent than level 0, and one chunk per z slice. That is machine-specific, so
 * it is named by the environment and this file skips without it rather than
 * hardcoding somebody's host:
 *
 *   PLANE_STORE_URL=https://<host>/<name>.zarr \
 *   BIOENGINE_ENV_FILE=<env file with HYPHA_TOKEN> \
 *   E2E_BASE_URL=http://localhost:<dev server port> \
 *   npx playwright test tests/colab-plane-per-level.spec.ts
 *
 * LIVE: creates a throwaway dataset under bioimage-io/colab-annotations and
 * deletes it afterwards. It only READS the store.
 */

const STORE = process.env.PLANE_STORE_URL;
const HYPHA_SERVER_URL = process.env.REACT_APP_HYPHA_SERVER_URL || 'https://hypha.aicell.io';
const AM = 'public/services/artifact-manager';
const BROKER = 'bioimage-io/services/annotation-broker';

const ALIAS = `annotation-plane-e2e-${Date.now().toString(36)}`;
const ARTIFACT_ID = `bioimage-io/${ALIAS}`;
const RECORDED_Z = 7;
const WITH_PLANE = 'zstack-recorded';  // imported with planes { z: RECORDED_Z }
const NO_PLANE = 'zstack-unrecorded';
const LABEL = 'cells';

/** What the derivation must produce, and what the middle-slice bug would. */
const EXPECTED = { s0: 7, s1: 3 };
const MIDDLE_SLICE_BUG = { s0: 4, s1: 2 };

function readEnvToken(name: string): string | undefined {
  if (process.env[name]) return process.env[name];
  const envFile = process.env.BIOENGINE_ENV_FILE;
  if (!envFile) return undefined;
  try {
    return fs.readFileSync(envFile, 'utf8').match(new RegExp(`${name}=(\\S+)`))?.[1];
  } catch {
    return undefined;
  }
}

const token = readEnvToken('HYPHA_TOKEN');

function decodeTokenSubject(tok: string): string {
  return JSON.parse(Buffer.from(tok.split('.')[1], 'base64').toString('utf8')).sub;
}

async function callHttp(
  tok: string,
  service: string,
  method: string,
  body: Record<string, unknown>,
): Promise<any> {
  const res = await fetch(`${HYPHA_SERVER_URL}/${service}/${method}`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${tok}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const data = await res.json().catch(() => undefined);
  if (!res.ok || (data && data.success === false)) {
    throw new Error(`${method} failed: ${res.status} ${JSON.stringify(data)}`);
  }
  return data;
}

/**
 * `callHttp`, retried on a gateway timeout only.
 *
 * `import_ngff_image` preflights the store server-side, which means reading a
 * chunk. On this fixture a chunk is a megabyte of raw bytes and the call came
 * back 504 "Method call timed out" while the import itself completed, so a
 * single attempt fails the suite for a reason that has nothing to do with what
 * it measures. Retried rather than given a longer timeout because the HTTP
 * gateway's limit is not ours to set. Only 5xx and timeouts are retried: a 4xx
 * is a real refusal and retrying it would hide it.
 */
async function callHttpRetrying(
  tok: string,
  service: string,
  method: string,
  body: Record<string, unknown>,
  attempts = 3,
): Promise<any> {
  let last: unknown;
  for (let i = 0; i < attempts; i++) {
    try {
      return await callHttp(tok, service, method, body);
    } catch (err: any) {
      last = err;
      if (!/ failed: 5\d\d |timed out/i.test(String(err?.message))) throw err;
      await new Promise((r) => setTimeout(r, 5_000 * (i + 1)));
    }
  }
  throw last;
}

/** `{ s0: [7, 7], s1: [3] }` from the chunk keys the browser actually fetched. */
function chunkPlanesByLevel(urls: string[]): Record<string, number[]> {
  const out: Record<string, number[]> = {};
  for (const url of urls) {
    // tczyx, one chunk per z slice: ".../<level>/<t>.<c>.<z>.<y>.<x>"
    const m = url.match(/\/([^/]+)\/(\d+)\.(\d+)\.(\d+)\.(\d+)\.(\d+)(?:\?|$)/);
    if (!m) continue;
    (out[m[1]] ||= []).push(Number(m[4]));
  }
  return out;
}

test.use({ baseURL: BASE_URL });

test.describe('a recorded plane is drawn at every pyramid level', () => {
  test.skip(!token, 'HYPHA_TOKEN not available');
  test.skip(!STORE, 'PLANE_STORE_URL not set: needs a CORS-open, z-resampled store');
  test.describe.configure({ mode: 'serial' });

  test.beforeAll(async () => {
    const uid = decodeTokenSubject(token!);
    await callHttp(token!, AM, 'create', {
      parent_id: 'bioimage-io/colab-annotations',
      alias: ALIAS,
      manifest: {
        name: 'Per-level plane fixture',
        description: 'Playwright fixture, deleted after the run',
        created_by: uid,
        owner: { id: uid },
      },
      type: 'dataset',
      stage: true,
      config: { permissions: { [uid]: '*' } },
    });
    await callHttp(token!, BROKER, 'register_dataset', { artifact_id: ARTIFACT_ID });
    // `name`, not `label`: get_image_url's stem parameter is `image_stem`
    // while import_ngff_image's is `stem`, and this one is `name`. The three
    // are not uniform, and a wrong one fails as an argument-binding TypeError
    // that reads like an out-of-date service.
    await callHttp(token!, BROKER, 'create_label', { artifact_id: ARTIFACT_ID, name: LABEL });
    await callHttpRetrying(token!, BROKER, 'import_ngff_image', {
      artifact_id: ARTIFACT_ID,
      store_root: STORE,
      stem: WITH_PLANE,
      planes: { z: RECORDED_Z },
      origin: 'https://bioimage.io',
    });
    await callHttpRetrying(token!, BROKER, 'import_ngff_image', {
      artifact_id: ARTIFACT_ID,
      store_root: STORE,
      stem: NO_PLANE,
      origin: 'https://bioimage.io',
    });
  });

  test.afterAll(async () => {
    try {
      await callHttp(token!, BROKER, 'delete_dataset_record', { artifact_id: ARTIFACT_ID });
    } catch { /* best effort */ }
    try {
      await callHttp(token!, AM, 'delete', { artifact_id: ARTIFACT_ID });
    } catch { /* best effort */ }
  });

  async function openAnnotate(page: import('@playwright/test').Page, stem: string) {
    await page.addInitScript(({ t, expiry }) => {
      localStorage.setItem('token', t);
      localStorage.setItem('tokenExpiry', expiry);
      localStorage.setItem('bioimage-annotation-tutorial-seen', '1');
    }, { t: token!, expiry: new Date(Date.now() + 3 * 60 * 60 * 1000).toISOString() });
    await page.goto(
      `/#/colab/annotate?session_id=${encodeURIComponent(ALIAS)}` +
        `&label=${encodeURIComponent(LABEL)}&image=${encodeURIComponent(stem)}`,
    );
  }

  test('reads the RECORDED slice at every level it touches', async ({ page }) => {
    test.setTimeout(240_000);
    const chunks: string[] = [];
    page.on('request', (req) => {
      if (STORE && req.url().startsWith(STORE.replace(/\/$/, ''))) chunks.push(req.url());
    });

    await openAnnotate(page, WITH_PLANE);

    // The viewer is up once a chunk has been fetched. Waiting on the traffic
    // rather than on a fixed delay is what keeps this from passing on a page
    // that never loaded: zero chunks fails the assertions below.
    // BOTH levels, not "at least one". This page is not a tiled pyramid
    // viewer: it picks a level per purpose through `levelForLongAxis`, so the
    // display takes level 0 (asking for 4096 px) and the low-contrast sample
    // takes level 1 (asking for 256). Waiting for one level would let a
    // per-LEVEL claim be measured at a single level, which on the first
    // fixture tried here is exactly what happened.
    await expect
      .poll(() => Object.keys(chunkPlanesByLevel(chunks)).sort().join(','), { timeout: 180_000 })
      .toBe('s0,s1');
    // Let any further reads settle, then judge everything that was asked for.
    await page.waitForTimeout(8_000);

    const byLevel = chunkPlanesByLevel(chunks);
    console.log('[plane] chunk reads by level:', JSON.stringify(byLevel));

    for (const [level, planes] of Object.entries(byLevel)) {
      const expected = (EXPECTED as Record<string, number>)[level];
      const wrong = (MIDDLE_SLICE_BUG as Record<string, number>)[level];
      expect(expected, `unexpected level ${level} in the fixture`).toBeDefined();
      const unique = Array.from(new Set(planes)).sort();
      console.log(`[plane] ${level}: read z ${unique.join(',')}, expected ${expected}`);
      // Asserted as ABSENCE as well as presence: a page that read the right
      // slice AND the middle one would satisfy a presence-only check while
      // still drawing the wrong pixels on top.
      expect(unique, `${level} must read only the derived slice`).toEqual([expected]);
      expect(unique, `${level} must not read its own middle slice`).not.toContain(wrong);
    }
    // Both levels named explicitly, so the loop above cannot be vacuous and
    // cannot have judged only one of them.
    expect(Object.keys(byLevel).sort()).toEqual(['s0', 's1']);
  });

  test('REFUSES the same store when no plane was recorded', async ({ page }) => {
    test.setTimeout(180_000);
    const chunks: string[] = [];
    page.on('request', (req) => {
      if (STORE && req.url().startsWith(STORE.replace(/\/$/, ''))) chunks.push(req.url());
    });

    await openAnnotate(page, NO_PLANE);

    // The refusal is SHOWN, and names the axis and says why, rather than
    // drawing a guess. Measured before this was fixed: the store was refused
    // correctly and silently. The viewer fetched no pixels, and the page left
    // the annotation toolbar over an empty canvas with no message, for as long
    // as it was open. I sampled the rendered text once a second for 70 seconds
    // and it never changed, so this was "never shown" rather than "shown and
    // expired".
    await expect(page.getByText(/sampled differently at each resolution/i)).toBeVisible({
      timeout: 120_000,
    });
    // And it refuses BEFORE fetching pixels: a refusal that still read chunks
    // would mean the guard runs too late to prevent the wrong draw.
    expect(chunkPlanesByLevel(chunks)).toEqual({});

    // The message STAYS. An explanation that disappears after a few seconds is
    // not much better than none, because the empty viewer it explains does not
    // disappear with it.
    await page.waitForTimeout(12_000);
    await expect(page.getByText(/sampled differently at each resolution/i)).toBeVisible();
  });
});
