import { test, expect } from '@playwright/test';
import fs from 'fs';
import { BASE_URL } from './baseUrl';

// Steps 4 and 6 of colab-c-ometiff-design.md, end to end in a real browser:
// link a remote OME-Zarr source into a dataset, see it in the overview,
// open it in the annotate view (decoded client-side by ngffPyramid, no
// pixels ever copied into the artifact), and forget it again. Then take a
// patch out of the same source instead of the whole of it.
//
// Requires: HYPHA_TOKEN (the token the app stores in localStorage after
// login), dev server at E2E_BASE_URL, and annotation-broker >= 0.12.0 on
// the KTH worker (probe_ngff_source / import_ngff_image with a region /
// forget_remote_image).
//
// LIVE: this creates a throwaway dataset under bioimage-io/colab-annotations
// and deletes it in afterAll. It reads a public IDR store over the network;
// it writes nothing to IDR.

test.use({ baseURL: BASE_URL });

// idr0062A/6001240.zarr — OME-Zarr v0.4, 3 pyramid levels, uint16, 2
// channels, 271x275 at level 0. Public and CORS-open; verified against the
// broker's preflight before this spec was written.
const STORE_ROOT = 'https://uk1s3.embassy.ebi.ac.uk/idr/zarr/v0.4/idr0062A/6001240.zarr';
const IMAGE_NAME = 'idr-sample';
const PATCH_NAME = 'idr-patch';
const ALIAS = `annotation-ngff-e2e-${Date.now().toString(36)}`;
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

test.describe('remote OME-Zarr source (design steps 4 and 6)', () => {
  test.skip(!token, 'HYPHA_TOKEN not available');
  test.describe.configure({ mode: 'serial' });

  test.beforeAll(async () => {
    const uid = decodeTokenSubject(token!);
    await callHttp(token!, AM, 'create', {
      parent_id: 'bioimage-io/colab-annotations',
      alias: ALIAS,
      manifest: {
        name: 'NGFF e2e fixture',
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

  test('links a store, browses it, annotates it, and forgets it', async ({ page }) => {
    test.setTimeout(180_000);

    const consoleErrors: string[] = [];
    page.on('console', (msg) => {
      if (msg.type() === 'error') consoleErrors.push(msg.text());
    });
    const notFound: string[] = [];
    page.on('response', (res) => {
      if (res.status() === 404) notFound.push(res.url());
    });

    await injectToken(page, token!);
    await page.goto(`/#/colab/${ALIAS}`);

    // --- the dataset opens and is empty -----------------------------------
    const linkButton = page.getByRole('button', { name: /link ome-zarr/i });
    await expect(linkButton).toBeVisible({ timeout: 60_000 });

    // --- link the remote store --------------------------------------------
    await linkButton.click();
    const dialog = page.getByRole('dialog', { name: /import a remote ome-zarr source/i });
    await expect(dialog).toBeVisible();

    await dialog.getByLabel(/store url/i).fill(STORE_ROOT);

    // Step one. The broker preflights the store (metadata + one chunk + CORS)
    // and reports its extent, so this is a real network round trip.
    await dialog.getByRole('button', { name: /check source/i }).click();
    await expect(dialog.getByText(/271 x 275 pixels/)).toBeVisible({ timeout: 90_000 });

    // Step two. No region drawn, so the whole store is linked.
    await dialog.getByLabel(/name in this dataset/i).fill(IMAGE_NAME);
    await dialog.getByRole('button', { name: /^link image$/i }).click();
    await expect(dialog).toBeHidden({ timeout: 90_000 });

    // --- the row shows up, marked remote ----------------------------------
    const row = page.getByRole('button', { name: IMAGE_NAME, exact: true });
    await expect(row).toBeVisible({ timeout: 30_000 });

    // The remote badge is an SVG whose hint lives in a <title> child, which
    // getByTitle does not see (it matches the title *attribute*), so read the
    // element text directly.
    await expect
      .poll(async () =>
        (await page.locator('svg > title').allTextContents()).some((t) =>
          t.startsWith('Remote source.'),
        ),
      )
      .toBe(true);

    // The delete affordance switches wording for a remote entry, which is the
    // visible proof the row knows it has no file behind it.
    await expect(
      page.getByRole('button', { name: /remove this source from the dataset/i }),
    ).toBeVisible();

    // --- the preview decodes through the Zarr reader ----------------------
    await row.click();
    const preview = page.getByRole('img', { name: IMAGE_NAME, exact: true }).first();
    await expect(preview).toBeVisible({ timeout: 90_000 });
    await expect
      .poll(async () => preview.evaluate((el: HTMLImageElement) => el.naturalWidth), {
        timeout: 90_000,
      })
      .toBeGreaterThan(0);

    await page.screenshot({ path: 'outputs/e2e-ngff-overview.png', fullPage: true });

    // A pyramidal source renders to a blob: URL; a browser-native one would
    // still be an https: presigned URL. This is what proves the decode
    // actually went through ngffPyramid rather than the <img> fallback.
    const src = await preview.evaluate((el: HTMLImageElement) => el.currentSrc || el.src);
    expect(src.startsWith('blob:')).toBeTruthy();

    // --- forget it again --------------------------------------------------
    page.once('dialog', (d) => d.accept());
    await page.getByRole('button', { name: /remove this source from the dataset/i }).first().click();
    await expect(row).toBeHidden({ timeout: 60_000 });

    // Two separate gates. Console "Failed to load resource" lines carry no URL,
    // so judging them by text alone is impossible; the 404 gate below judges
    // the same events by URL instead, and this one covers everything else.
    const fatal = consoleErrors.filter(
      (e) =>
        !/favicon|manifest\.json|ResizeObserver|Download the React DevTools/i.test(e) &&
        !/Failed to load resource/i.test(e),
    );
    expect(fatal, `console errors:\n${fatal.join('\n')}`).toHaveLength(0);

    // Benign 404s:
    //   - matomo.js, the analytics CDN, absent in dev.
    //   - <level>/.zattrs. In Zarr v2 an array's .zattrs is optional (only
    //     .zarray is required) and this store does not carry per-level
    //     attributes, so zarrita probes and moves on. One probe per pyramid
    //     level, at open time only.
    const unexpected = notFound.filter((u) => !/matomo|\/\.zattrs$/.test(u));
    expect(unexpected, `unexpected 404s:\n${unexpected.join('\n')}`).toHaveLength(0);
  });

  // --- design step 6: take a patch out of the slide instead ----------------
  //
  // The point of the whole feature is the last assertion: the manifest entry
  // is sized to the patch, not to the source. Everything downstream reads
  // width/height (the 64 MiB materialisation gate, the OME-TIFF that gets
  // written, the viewer extent) and is correct for a crop without knowing a
  // crop happened.
  test('imports a region of the source, sized to the patch', async ({ page }) => {
    test.setTimeout(180_000);

    await injectToken(page, token!);
    await page.goto(`/#/colab/${ALIAS}`);

    await page.getByRole('button', { name: /link ome-zarr/i }).click();
    const dialog = page.getByRole('dialog', { name: /import a remote ome-zarr source/i });
    await dialog.getByLabel(/store url/i).fill(STORE_ROOT);
    await dialog.getByRole('button', { name: /check source/i }).click();
    await expect(dialog.getByText(/271 x 275 pixels/)).toBeVisible({ timeout: 90_000 });

    // With nothing drawn, the whole store is the region and the button says so.
    await expect(dialog.getByRole('button', { name: /^link image$/i })).toBeVisible();
    await expect(dialog.getByLabel('Width', { exact: true })).toHaveValue('271');

    // --- drag a rectangle on the preview -----------------------------------
    // The preview is decoded in the browser from the store itself, which is
    // the same read path the annotate view uses, so its arrival is real proof
    // the source is readable client-side and not only by the broker.
    const preview = dialog.getByRole('img', { name: /preview of the remote source/i });
    await expect(preview).toBeVisible({ timeout: 90_000 });
    await expect
      .poll(async () => preview.evaluate((el: HTMLImageElement) => el.naturalWidth), {
        timeout: 90_000,
      })
      .toBeGreaterThan(0);

    const box = (await preview.boundingBox())!;
    await page.mouse.move(box.x + box.width * 0.25, box.y + box.height * 0.25);
    await page.mouse.down();
    await page.mouse.move(box.x + box.width * 0.6, box.y + box.height * 0.6, { steps: 8 });
    await page.mouse.up();

    // A drag commits a region, which is visible in the wording of the submit
    // button and in the fields no longer spanning the whole source.
    const submit = dialog.getByRole('button', { name: /link this region/i });
    await expect(submit).toBeVisible();
    await expect
      .poll(async () => Number(await dialog.getByLabel('Width', { exact: true }).inputValue()))
      .toBeLessThan(271);

    // --- then type exact bounds, which is also the no-preview fallback ------
    await dialog.getByLabel('X', { exact: true }).fill('40');
    await dialog.getByLabel('Y', { exact: true }).fill('30');
    await dialog.getByLabel('Width', { exact: true }).fill('128');
    await dialog.getByLabel('Height', { exact: true }).fill('96');

    // 128 x 96 x uint16 x 2 channels = 48 KB, well under the broker's gate,
    // so the estimate is the plain one rather than the over-budget warning.
    await expect(dialog.getByText(/About 48 KB at full resolution/)).toBeVisible();

    await dialog.getByLabel(/name in this dataset/i).fill(PATCH_NAME);
    await submit.click();
    await expect(dialog).toBeHidden({ timeout: 90_000 });

    const row = page.getByRole('button', { name: PATCH_NAME, exact: true });
    await expect(row).toBeVisible({ timeout: 30_000 });

    // --- the manifest entry is the patch ------------------------------------
    const index = await callHttp(token!, BROKER, 'get_dataset_index', {
      artifact_id: ARTIFACT_ID,
    });
    const entry = index.images.find((img: any) => img.stem === PATCH_NAME);
    expect(entry, `no ${PATCH_NAME} in ${JSON.stringify(index.images)}`).toBeTruthy();
    expect([entry.width, entry.height]).toEqual([128, 96]);
    expect(entry.state).toBe('remote');

    // And the reader is told where in the slide to read from.
    const url = await callHttp(token!, BROKER, 'get_image_url', {
      artifact_id: ARTIFACT_ID,
      image_stem: PATCH_NAME,
    });
    expect(url.region).toEqual({ x: 40, y: 30, width: 128, height: 96 });

    page.once('dialog', (d) => d.accept());
    await page.getByRole('button', { name: /remove this source from the dataset/i }).first().click();
    await expect(row).toBeHidden({ timeout: 60_000 });
  });
});
