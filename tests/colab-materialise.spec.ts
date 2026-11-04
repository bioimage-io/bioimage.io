import { test, expect } from '@playwright/test';
import fs from 'fs';

// Step 5 of colab-c-ometiff-design.md: first-open materialisation.
//
// The claim under test is narrow and end-to-end: opening a `state: "remote"`
// image in the annotator writes the dataset's own OME-TIFF copy, and the
// manifest afterwards says `local` with a real file behind it. Everything up
// to the manifest flip is verified by the broker itself; what a unit test
// cannot cover is whether the browser's native read, the base64 hand-off, the
// Pyodide encode and the presigned PUT actually compose. That is this spec.
//
// LIVE: creates a throwaway dataset under bioimage-io/colab-annotations,
// deletes it in afterAll, boots a real Pyodide kernel, and uploads a real
// file. Requires HYPHA_TOKEN, a dev server at E2E_BASE_URL, and
// annotation-broker >= 0.11.1 on the KTH worker.

const BASE_URL = process.env.E2E_BASE_URL || 'http://localhost:3077';
test.use({ baseURL: BASE_URL });

// idr0062A/6001240.zarr — uint16, 2 channels, 271x275 at level 0. Small on
// purpose: the point is to prove the pipeline composes, and a gigapixel store
// would only prove that Pyodide is slow.
const STORE_ROOT = 'https://uk1s3.embassy.ebi.ac.uk/idr/zarr/v0.4/idr0062A/6001240.zarr';
const IMAGE_NAME = 'idr-sample';
const LABEL = 'cells';
const ALIAS = `annotation-mat-e2e-${Date.now().toString(36)}`;
const ARTIFACT_ID = `bioimage-io/${ALIAS}`;
const HYPHA_SERVER_URL = process.env.REACT_APP_HYPHA_SERVER_URL || 'https://hypha.aicell.io';

function readEnvToken(name: string): string | undefined {
  if (process.env[name]) return process.env[name];
  try {
    const envText = fs.readFileSync('/data/nmechtel/bioengine/.env', 'utf8');
    return envText.match(new RegExp(`${name}=(\\S+)`))?.[1];
  } catch {
    return undefined;
  }
}

function decodeTokenSubject(token: string): string {
  const payload = token.split('.')[1];
  return JSON.parse(Buffer.from(payload, 'base64').toString('utf8')).sub;
}

async function callHttp(
  token: string,
  service: string,
  method: string,
  body: Record<string, unknown>,
): Promise<any> {
  const res = await fetch(`${HYPHA_SERVER_URL}/${service}/${method}`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const data = await res.json().catch(() => undefined);
  if (!res.ok || (data && data.success === false)) {
    throw new Error(`${method} failed: ${res.status} ${JSON.stringify(data)}`);
  }
  return data;
}

const AM = 'public/services/artifact-manager';
const BROKER = 'bioimage-io/services/annotation-broker';

const token = readEnvToken('HYPHA_TOKEN');

async function injectToken(page: import('@playwright/test').Page, tok: string) {
  await page.addInitScript(({ t, expiry }) => {
    localStorage.setItem('token', t);
    localStorage.setItem('tokenExpiry', expiry);
    localStorage.setItem('bioimage-annotation-tutorial-seen', '1');
  }, { t: tok, expiry: new Date(Date.now() + 3 * 60 * 60 * 1000).toISOString() });
}

/**
 * The index entry for IMAGE_NAME: what the annotate page itself sees.
 *
 * Deliberately narrow (`get_dataset_index` projects each image down to stem,
 * state, path and dimensions), so anything about provenance has to be read
 * from the manifest instead.
 */
async function imageEntry(): Promise<any> {
  const index = await callHttp(token!, BROKER, 'get_dataset_index', {
    artifact_id: ARTIFACT_ID,
  });
  return (index.images || []).find((img: any) => img.stem === IMAGE_NAME);
}

/**
 * The raw manifest entry for IMAGE_NAME, read straight out of the artifact.
 *
 * Fields the index does not carry -- `source` and `levels` -- live only here,
 * and the broker's own guarantee is about the manifest, not about a
 * projection of it. Reading the file directly is also the stronger check:
 * it is the document a later session's broker will parse.
 */
async function manifestEntry(): Promise<any> {
  const url = await callHttp(token!, AM, 'get_file', {
    artifact_id: ARTIFACT_ID,
    file_path: 'images/manifest.json',
    stage: true,
  });
  const doc = await (await fetch(typeof url === 'string' ? url : url.url)).json();
  return doc.images?.[IMAGE_NAME];
}

test.describe('first-open materialisation (design step 5)', () => {
  test.skip(!token, 'HYPHA_TOKEN not available');

  test.beforeAll(async () => {
    const uid = decodeTokenSubject(token!);
    await callHttp(token!, AM, 'create', {
      parent_id: 'bioimage-io/colab-annotations',
      alias: ALIAS,
      manifest: {
        name: 'Materialise e2e fixture',
        description: 'Playwright fixture, deleted after the run',
        created_by: uid,
        owner: { id: uid },
      },
      type: 'dataset',
      stage: true,
      config: { permissions: { [uid]: '*' } },
    });
    await callHttp(token!, BROKER, 'register_dataset', { artifact_id: ARTIFACT_ID });
    await callHttp(token!, BROKER, 'import_ngff_image', {
      artifact_id: ARTIFACT_ID,
      store_root: STORE_ROOT,
      stem: IMAGE_NAME,
    });
    // The annotate page needs a label in the URL to build a service config at
    // all, so the fixture has to carry one even though nothing is annotated.
    await callHttp(token!, BROKER, 'create_label', {
      artifact_id: ARTIFACT_ID,
      name: LABEL,
      description: 'materialise fixture',
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

  test('opening a remote image writes the dataset its own OME-TIFF copy', async ({ page }) => {
    // Pyodide boots, micropip installs tifffile, and a real file is encoded
    // and uploaded. None of that is fast, and none of it is on the render
    // path, which is the design's whole point.
    test.setTimeout(600_000);

    const consoleErrors: string[] = [];
    page.on('console', (msg) => {
      if (msg.type() === 'error') consoleErrors.push(msg.text());
    });

    // Precondition, asserted rather than assumed: if the fixture were already
    // local the rest of this spec would pass without materialising anything.
    const before = await imageEntry();
    expect(before?.state).toBe('remote');

    await injectToken(page, token!);
    await page.goto(`/#/colab/annotate?session_id=${ALIAS}&label=${LABEL}&image=${IMAGE_NAME}`);

    // The image has to be *on screen* before materialisation starts. Asserting
    // this first is what distinguishes "the copy happened in the background"
    // from "the copy blocked the first paint".
    const canvas = page.locator('canvas').first();
    await expect(canvas).toBeVisible({ timeout: 120_000 });

    // The manifest is the only claim that matters: the broker re-reads the
    // uploaded object's first bytes before it writes this, so `local` here
    // means a readable TIFF really is in the artifact.
    await expect
      .poll(async () => (await imageEntry())?.state, { timeout: 480_000, intervals: [5_000] })
      .toBe('local');

    const after = await imageEntry();
    expect(after.path).toBe(`images/${IMAGE_NAME}.tif`);

    const entry = await manifestEntry();
    expect(entry.state).toBe('local');
    // Provenance survives the flip: the entry still records where the pixels
    // came from, so a materialised image is not indistinguishable from one
    // that was uploaded directly.
    expect(entry.source?.store_root).toContain('6001240.zarr');
    // 275 is already under the encoder's 512-pixel floor, so the pyramid loop
    // never runs and one level is the correct answer, not a missing one.
    expect(entry.levels).toBe(1);

    await page.screenshot({ path: 'outputs/e2e-materialise.png', fullPage: true });

    // A second visit must be a no-op, not a second upload. `already` is what
    // the broker returns and the page shows nothing for it.
    await page.goto(`/#/colab/annotate?session_id=${ALIAS}&label=${LABEL}&image=${IMAGE_NAME}`);
    await expect(canvas).toBeVisible({ timeout: 120_000 });
    expect((await imageEntry()).state).toBe('local');

    const fatal = consoleErrors.filter(
      (e) =>
        !/favicon|manifest\.json|ResizeObserver|Download the React DevTools/i.test(e) &&
        !/Failed to load resource/i.test(e),
    );
    expect(fatal, `console errors:\n${fatal.join('\n')}`).toHaveLength(0);
  });
});
