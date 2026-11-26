import { test, expect } from '@playwright/test';
import fs from 'fs';
import path from 'path';
import { BASE_URL } from './baseUrl';

/**
 * Adding a local image on a browser that cannot mount a folder.
 *
 * Mounting needs the File System Access API, which Chromium has and Firefox
 * and Safari do not, and the mount is what registers the data-provider service
 * every other upload goes through. So on those browsers a user could open
 * somebody else's dataset and annotate it but could never contribute an image
 * of their own, and the page could only tell them to change browser.
 *
 * THE BROWSER IS THE POINT. Running this on Chromium would exercise a path no
 * Chromium user takes and would pass whether or not the fallback works at all,
 * so it SKIPS there and says why. The config declares no projects, so name the
 * browser on the command line:
 *
 *   npx playwright test tests/colab-file-picker-upload.spec.ts --browser=firefox
 *
 * The skip is not a quiet one: a default suite run prints it, and the
 * assertion below still refuses to measure anything on Chromium.
 *
 * It uploads through the broker's presigned PUT: the page mints, sends the
 * bytes straight to storage, and finishes, and the dataset's ordinary listing
 * reconciliation turns the object into a `local` image. That last part is why
 * the assertion below is that the image appears in the dataset's own list,
 * rather than that some upload call returned.
 *
 * LIVE: creates a throwaway dataset under bioimage-io/colab-annotations and
 * deletes it afterwards.
 */

const HYPHA_SERVER_URL = process.env.REACT_APP_HYPHA_SERVER_URL || 'https://hypha.aicell.io';
const AM = 'public/services/artifact-manager';
const BROKER = 'bioimage-io/services/annotation-broker';

const ALIAS = `annotation-picker-e2e-${Date.now().toString(36)}`;
const ARTIFACT_ID = `bioimage-io/${ALIAS}`;
const IMAGE_NAME = 'picked-scan.png';

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

/** A tiny but REAL png, written to the test's own output directory. */
function writePng(dir: string): string {
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, IMAGE_NAME);
  // 1x1 png, the smallest thing the viewer will still treat as an image.
  fs.writeFileSync(
    file,
    Buffer.from(
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
      'base64',
    ),
  );
  return file;
}

test.describe('a browser with no File System Access API', () => {
  test.skip(!token, 'HYPHA_TOKEN not available');
  test.describe.configure({ mode: 'serial' });

  test.beforeAll(async () => {
    const uid = decodeTokenSubject(token!);
    await callHttp(token!, AM, 'create', {
      parent_id: 'bioimage-io/colab-annotations',
      alias: ALIAS,
      manifest: {
        name: 'File-picker fixture',
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

  test('picks an image, uploads it, and sees it in the dataset', async ({ page, browserName }, testInfo) => {
    test.setTimeout(240_000);
    // Stated rather than assumed: on Chromium the page takes the MOUNT path,
    // so a pass here would say nothing about the fallback this spec exists
    // for. Skipped rather than failed, so a default suite run stays green and
    // prints the reason.
    test.skip(
      browserName === 'chromium',
      'the fallback is for browsers WITHOUT the File System Access API; run with --browser=firefox',
    );

    await page.addInitScript(({ t, expiry }) => {
      localStorage.setItem('token', t);
      localStorage.setItem('tokenExpiry', expiry);
      localStorage.setItem('bioimage-annotation-tutorial-seen', '1');
    }, { t: token!, expiry: new Date(Date.now() + 3 * 60 * 60 * 1000).toISOString() });

    await page.goto(`/#/colab/${ALIAS}`);

    // The button SAYS what it will do. On this browser there is no folder to
    // mount, so offering to mount one would be the page describing itself
    // wrongly.
    const addButton = page.getByRole('button', { name: 'Add images', exact: true });
    await expect(addButton).toBeVisible({ timeout: 90_000 });
    await expect(page.getByRole('button', { name: /mount local folder/i })).toHaveCount(0);

    const file = writePng(testInfo.outputPath('picked'));
    await page.setInputFiles('[data-testid="local-image-picker"]', file);

    // The dataset's own list is the oracle, not the upload call: the manifest
    // entry is written by the listing reconciliation, so an image that
    // appears here is indistinguishable from one uploaded through a mount.
    await expect(page.getByText('picked-scan')).toBeVisible({ timeout: 120_000 });
    await expect(page.getByTestId('picked-upload-status')).toContainText('1 image added');

    await page.screenshot({ path: testInfo.outputPath('picker-upload.png'), fullPage: true });
  });

  test('CONTROL: Chromium still gets the MOUNT button, not the picker one', async ({
    page,
    browserName,
  }) => {
    // The other half of the claim, and it runs where the first one cannot.
    // Without this, "Add images" could have replaced the mount button
    // everywhere and the Firefox case would still pass, having quietly taken
    // the folder route away from the browsers that have it.
    test.skip(
      browserName !== 'chromium',
      'this arm is about the browser that CAN mount a folder',
    );
    test.setTimeout(180_000);

    await page.addInitScript(({ t, expiry }) => {
      localStorage.setItem('token', t);
      localStorage.setItem('tokenExpiry', expiry);
      localStorage.setItem('bioimage-annotation-tutorial-seen', '1');
    }, { t: token!, expiry: new Date(Date.now() + 3 * 60 * 60 * 1000).toISOString() });

    await page.goto(`/#/colab/${ALIAS}`);
    await expect(page.getByRole('button', { name: /mount local folder/i })).toBeVisible({
      timeout: 90_000,
    });
    await expect(page.getByRole('button', { name: 'Add images', exact: true })).toHaveCount(0);
  });
});
