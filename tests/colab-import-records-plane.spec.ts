import { test, expect } from '@playwright/test';
import fs from 'fs';
import { BASE_URL } from './baseUrl';

/**
 * An import made through the DIALOG records the slice the dialog showed.
 *
 * Why this is a separate measurement from the unit tests of the same code. The
 * plane a multi-plane source is annotated on is decided by
 * `displayedPlanesForProbe`, and every earlier end-to-end check of the plane
 * imported by RPC with an explicit `planes` argument, which skips that
 * function entirely. So the thing never measured was the one decision a user
 * actually makes: open the dialog, press the button, and have the record match
 * what the preview drew.
 *
 * Three claims, and they have to agree with each other or the feature is
 * pointless:
 *
 *   1. the dialog SAYS which slice it will annotate on, in the store's own
 *      numbers;
 *   2. the browser READS that slice while previewing (the fixture stores one z
 *      slice per chunk, so the chunk key carries the plane and this is the
 *      browser's own traffic, not something the page reports about itself);
 *   3. the manifest the broker kept RECORDS that slice, read back through
 *      `get_image_url`, which is the only call the annotation page makes.
 *
 * A fourth claim is deliberately NOT here, because it cannot be made from a
 * browser: that a training run reads the recorded slice. That is measured
 * against the live worker with the same fixture and recorded on the issue.
 *
 * REQUIRES a multi-plane store the BROWSER can read: public over https with
 * `Access-Control-Allow-Origin`, more than one z slice, and one chunk per z
 * slice. Machine-specific, so it is named by the environment and this file
 * skips without it:
 *
 *   PLANE_STORE_URL=https://<host>/<name>.zarr \
 *   PLANE_STORE_Z=9 \
 *   BIOENGINE_ENV_FILE=<env file with HYPHA_TOKEN> \
 *   E2E_BASE_URL=http://localhost:<dev server port> \
 *   npx playwright test tests/colab-import-records-plane.spec.ts
 *
 * LIVE: creates a throwaway dataset under bioimage-io/colab-annotations and
 * deletes it afterwards. It only READS the store.
 */

const STORE = process.env.PLANE_STORE_URL;
/** z extent of level 0. The expected slice is derived from it, not hardcoded. */
const STORE_Z = Number(process.env.PLANE_STORE_Z || '9');
const HYPHA_SERVER_URL = process.env.REACT_APP_HYPHA_SERVER_URL || 'https://hypha.aicell.io';
const AM = 'public/services/artifact-manager';
const BROKER = 'bioimage-io/services/annotation-broker';

const ALIAS = `annotation-plane-import-${Date.now().toString(36)}`;
const ARTIFACT_ID = `bioimage-io/${ALIAS}`;
const STEM = 'drawn-on';

/**
 * The slice the viewer shows, which is the slice the import must record.
 *
 * Derived from the store's own extent rather than written as a number, so this
 * spec cannot pass against a fixture it was not built for: point
 * PLANE_STORE_Z at the wrong value and the assertions below fail.
 */
const EXPECTED_Z = Math.floor(STORE_Z / 2);

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

/** Every z index the browser fetched a chunk for, from the chunk keys. */
function zIndicesRead(urls: string[]): number[] {
  const seen = new Set<number>();
  for (const url of urls) {
    // tczyx, one chunk per z slice: ".../<level>/<t>.<c>.<z>.<y>.<x>"
    const m = url.match(/\/[^/]+\/(\d+)\.(\d+)\.(\d+)\.(\d+)\.(\d+)(?:\?|$)/);
    if (m) seen.add(Number(m[3]));
  }
  return Array.from(seen).sort((a, b) => a - b);
}

test.use({ baseURL: BASE_URL, viewport: { width: 1280, height: 900 } });

test.describe('importing a multi-plane source through the dialog', () => {
  test.skip(!token, 'HYPHA_TOKEN not available');
  test.skip(!STORE, 'PLANE_STORE_URL not set: needs a CORS-open multi-plane store');
  test.describe.configure({ mode: 'serial' });

  test.beforeAll(async () => {
    const uid = decodeTokenSubject(token!);
    await callHttp(token!, AM, 'create', {
      parent_id: 'bioimage-io/colab-annotations',
      alias: ALIAS,
      manifest: {
        name: 'Plane-recording fixture',
        description: 'Playwright fixture, deleted after the run',
        created_by: uid,
        owner: { id: uid },
      },
      type: 'dataset',
      stage: true,
      config: { permissions: { [uid]: '*' } },
    });
    await callHttp(token!, BROKER, 'register_dataset', { artifact_id: ARTIFACT_ID });
  });

  test.afterAll(async () => {
    try {
      await callHttp(token!, BROKER, 'delete_dataset_record', { artifact_id: ARTIFACT_ID });
    } catch { /* best effort */ }
    try {
      await callHttp(token!, AM, 'delete', { artifact_id: ARTIFACT_ID });
    } catch { /* best effort */ }
  });

  test('says which slice, draws that slice, and records that slice', async ({ page }) => {
    test.setTimeout(300_000);
    const chunks: string[] = [];
    page.on('request', (req) => {
      if (STORE && req.url().startsWith(STORE.replace(/\/$/, ''))) chunks.push(req.url());
    });

    await page.addInitScript(({ t, expiry }) => {
      localStorage.setItem('token', t);
      localStorage.setItem('tokenExpiry', expiry);
      localStorage.setItem('bioimage-annotation-tutorial-seen', '1');
    }, { t: token!, expiry: new Date(Date.now() + 3 * 60 * 60 * 1000).toISOString() });

    await page.goto(`/#/colab/${ALIAS}`);

    const linkButton = page.getByRole('button', { name: /link ome-zarr/i });
    await expect(linkButton).toBeVisible({ timeout: 90_000 });
    await linkButton.click();

    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible();
    await dialog.getByLabel(/store url/i).fill(STORE!);
    await dialog.getByRole('button', { name: /check (this )?(url|source)/i }).click();

    // CLAIM 1: the dialog says which slice, in the store's own numbers. A
    // sentence the user can act on, rather than a convention they would learn
    // only from a model that trained on the wrong pixels.
    await expect(
      dialog.getByText(new RegExp(`z slice ${EXPECTED_Z} of ${STORE_Z}`)),
    ).toBeVisible({ timeout: 120_000 });

    // CLAIM 2: the preview reads that slice and no other. Asserted as
    // equality, not containment: a preview that read the right slice AND
    // another would satisfy a containment check while showing a blend.
    await expect.poll(() => zIndicesRead(chunks), { timeout: 120_000 }).toEqual([EXPECTED_Z]);

    await dialog.getByLabel(/name in this dataset/i).fill(STEM);
    await dialog.getByRole('button', { name: /^link image$/i }).click();
    await expect(dialog).toBeHidden({ timeout: 120_000 });

    // CLAIM 3: the record the broker kept, read back through the only call the
    // annotation page makes. `image_stem`, not `stem`: the two methods do not
    // use the same parameter name.
    const url = await callHttp(token!, BROKER, 'get_image_url', {
      artifact_id: ARTIFACT_ID,
      image_stem: STEM,
    });
    expect(url.planes, 'the import must record the plane the dialog showed').toEqual({
      z: EXPECTED_Z,
    });
    // And the shape it was measured against, without which an index cannot be
    // placed on another pyramid level.
    expect(Array.isArray(url.level0_shape)).toBe(true);
    expect(url.level0_shape).toContain(STORE_Z);
  });
});
