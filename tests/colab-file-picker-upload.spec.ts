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

/**
 * A REAL png of a size the viewer can actually draw, written to the test's own
 * output directory.
 *
 * Not 1x1. A review pointed out that the one-pixel fixture never left
 * "Loading image..." in my own screenshot, so the upload could be measured
 * while the thing it produced was unusable. 384x384 is small enough to be
 * instant and big enough to render and be annotated.
 *
 * Written with zlib's stored (uncompressed) deflate blocks and a hand-built
 * CRC, so this needs no image library.
 */
function writePng(dir: string, name = IMAGE_NAME, size = 384): string {
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, name);

  const crcTable: number[] = [];
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    crcTable[n] = c >>> 0;
  }
  const crc32 = (buf: Buffer) => {
    let c = 0xffffffff;
    for (const b of buf) c = crcTable[(c ^ b) & 0xff] ^ (c >>> 8);
    return (c ^ 0xffffffff) >>> 0;
  };
  const chunk = (type: string, data: Buffer) => {
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length);
    const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(crc32(body));
    return Buffer.concat([len, body, crc]);
  };

  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; // 8 bits per sample
  ihdr[9] = 0; // greyscale
  const raw = Buffer.alloc((size + 1) * size);
  for (let y = 0; y < size; y++) {
    raw[y * (size + 1)] = 0; // filter: none
    for (let x = 0; x < size; x++) {
      // A gradient with a bright square, so a human reading the screenshot
      // can see it is the picked image and not a blank canvas.
      const inSquare = x > size / 4 && x < size / 2 && y > size / 4 && y < size / 2;
      raw[y * (size + 1) + 1 + x] = inSquare ? 250 : (x + y) % 200;
    }
  }
  const zlib = require('zlib');
  return (
    fs.writeFileSync(
      file,
      Buffer.concat([
        Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
        chunk('IHDR', ihdr),
        chunk('IDAT', zlib.deflateSync(raw)),
        chunk('IEND', Buffer.alloc(0)),
      ]),
    ),
    file
  );
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

    // THE BUTTON IS STILL USABLE. A review measured the first version leaving
    // it disabled for ever, because the summary text was what disabled it, so
    // a user could add one batch per page load. This is the assertion that
    // would have caught it.
    await expect(addButton).toBeEnabled();

    // And a SECOND batch really goes through, which is the behaviour rather
    // than the attribute.
    const second = writePng(testInfo.outputPath('picked'), 'picked-scan-2.png');
    await page.setInputFiles('[data-testid="local-image-picker"]', second);
    await expect(page.getByText('picked-scan-2')).toBeVisible({ timeout: 120_000 });

    await page.screenshot({ path: testInfo.outputPath('picker-upload.png'), fullPage: true });
  });

  test('offers a FOLDER pick, and uploads what is in it', async ({ page, browserName }, testInfo) => {
    // Clause 2 asks for `webkitdirectory` "where it works", and a review
    // measured that it works here: `'webkitdirectory' in input` is true on
    // Firefox and WebKit while `showDirectoryPicker` is false on both. The
    // first version left it off on the false grounds that it was as
    // Chromium-specific as the API this replaces.
    test.skip(
      browserName === 'chromium',
      'the fallback is for browsers WITHOUT the File System Access API; run with --browser=firefox',
    );
    test.setTimeout(240_000);

    await page.addInitScript(({ t, expiry }) => {
      localStorage.setItem('token', t);
      localStorage.setItem('tokenExpiry', expiry);
      localStorage.setItem('bioimage-annotation-tutorial-seen', '1');
    }, { t: token!, expiry: new Date(Date.now() + 3 * 60 * 60 * 1000).toISOString() });

    await page.goto(`/#/colab/${ALIAS}`);

    const folderButton = page.getByRole('button', { name: 'Add a folder', exact: true });
    await expect(folderButton).toBeVisible({ timeout: 90_000 });

    // The browser supports the attribute, which is the claim the first
    // version got wrong. Asserted on the real input rather than on a version
    // table.
    const supported = await page.evaluate(
      () => 'webkitdirectory' in document.createElement('input'),
    );
    expect(supported, 'this browser should support webkitdirectory').toBe(true);

    const dir = testInfo.outputPath('plate1');
    writePng(dir, 'folder-scan-a.png');
    writePng(dir, 'folder-scan-b.png');
    // THE DIRECTORY, not its files: a `webkitdirectory` input refuses a file
    // list, which is the shape a folder pick really has and is why this input
    // exists separately from the file one.
    await page.setInputFiles('[data-testid="local-folder-picker"]', dir);

    await expect(page.getByText('folder-scan-a')).toBeVisible({ timeout: 120_000 });
    await expect(page.getByText('folder-scan-b')).toBeVisible({ timeout: 120_000 });
    await expect(page.getByTestId('picked-upload-status')).toContainText('2 images added');
  });

  test('ANNOTATES an image added through the picker, and the annotation persists', async ({
    page,
    browserName,
  }, testInfo) => {
    // Clause 3's last words, "then annotate one". A review pointed out the
    // first version stopped at "listed", which shows a manifest entry and not
    // that the object behind it is a usable image. Saving an annotation is
    // what proves the whole chain.
    test.skip(
      browserName === 'chromium',
      'the fallback is for browsers WITHOUT the File System Access API; run with --browser=firefox',
    );
    // KNOWN FAILING, and the failure is in the service rather than here.
    // Measured: `get_save_urls` mints with `put_file` BEFORE it re-stages the
    // artifact, and the upload's finishing call COMMITS it (its own payload
    // says `"committed": true`). So the first `put_file` after any upload
    // throws "Artifact must be in staging mode" and every save on that
    // dataset is refused. Filed against the service; this arm turns green by
    // itself when the ordering is fixed, which is why it is marked rather
    // than deleted.
    //
    // Everything up to the save is measured and passing: the image uploads,
    // the annotate page opens on it, and the GeoJSON import reaches
    // "Saving 1 annotations...".
    test.fixme(
      true,
      'blocked on the service: get_save_urls mints before re-staging, so saving after an upload is refused',
    );
    test.setTimeout(300_000);

    await callHttp(token!, BROKER, 'create_label', { artifact_id: ARTIFACT_ID, name: 'cells' });

    await page.addInitScript(({ t, expiry }) => {
      localStorage.setItem('token', t);
      localStorage.setItem('tokenExpiry', expiry);
      localStorage.setItem('bioimage-annotation-tutorial-seen', '1');
    }, { t: token!, expiry: new Date(Date.now() + 3 * 60 * 60 * 1000).toISOString() });

    await page.goto(
      `/#/colab/annotate?session_id=${encodeURIComponent(ALIAS)}&label=cells`
        + `&image=${encodeURIComponent('picked-scan')}`,
    );

    // It DRAWS. The 1x1 fixture never left "Loading image...", so this is
    // asserted on the canvas rather than on the absence of an error.
    await expect(page.locator('canvas').first()).toBeVisible({ timeout: 180_000 });

    // IMPORTED rather than painted. The brush paints along a mask edge and a
    // synthetic drag is a poor way to produce a polygon, which is how my
    // first attempt produced none: the save then had nothing to write and the
    // measurement said "no annotation" about a page that was working. A
    // GeoJSON import puts a known polygon in, which is what this arm is
    // actually about.
    const geojson = testInfo.outputPath('mask.geojson');
    fs.writeFileSync(
      geojson,
      JSON.stringify({
        type: 'FeatureCollection',
        features: [
          {
            type: 'Feature',
            properties: {},
            geometry: {
              type: 'Polygon',
              coordinates: [[[40, 40], [160, 40], [160, 160], [40, 160], [40, 40]]],
            },
          },
        ],
      }),
    );
    await page.setInputFiles('input[accept*="geojson"]', geojson);
    await page.getByRole('button', { name: /save annotation/i }).first().click();

    // The ORACLE is the dataset, not the page: the annotation has to exist on
    // the service for this to mean anything.
    await expect
      .poll(
        async () => {
          const index = await callHttp(token!, BROKER, 'get_dataset_index', {
            artifact_id: ARTIFACT_ID,
          });
          return Object.keys(index?.my_annotations?.cells || {});
        },
        { timeout: 180_000 },
      )
      .toContain('picked-scan');

    await page.screenshot({ path: testInfo.outputPath('picker-annotated.png'), fullPage: true });
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
