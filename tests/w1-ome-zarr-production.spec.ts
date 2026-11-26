import { test, expect } from '@playwright/test';
import fs from 'fs';
import path from 'path';
import { BASE_URL } from './baseUrl';

/**
 * Drives the landed remote OME-Zarr UI against production.
 *
 *   E2E_BASE_URL=https://bioimage.io npx playwright test tests/w1-ome-zarr-production.spec.ts
 *
 * WHAT THIS DOES NOT DO, and why, because the gap is the finding rather than a
 * shortcut. It does not complete an actual import. That needs a public OME-Zarr
 * store that is BOTH reachable from this machine AND serves CORS headers to
 * bioimage.io, and neither host tested has both:
 *
 *   uk1s3.embassy.ebi.ac.uk (IDR)   connection refused on 443 from the machine these ran on
 *                                   (and unreachable from the training worker too)
 *   s3.embl.de (NGFF examples)      HTTP 200 to curl, but NO
 *                                   access-control-allow-origin, so a browser
 *                                   fetch from bioimage.io is blocked
 *
 * curl ignores CORS, so "the store is reachable" and "the browser can read it"
 * are different measurements, and only the second one matters for this feature.
 */

const VIEWPORT = { width: 1280, height: 900 };
// Relative, and under Playwright's own output directory: an absolute path
// here names one person's machine, which does not belong in a public
// repository and would not resolve on anybody else's checkout anyway.
const OUT = process.env.W1_SHOT_DIR || 'test-results/w1-prod-shots';
const DATASET = 'annotation-mst3ebzz-o5px';
// A real public NGFF v0.4 store: axes y/x, levels s0/s1/s2, 256x256 blosc
// chunks. Reachable by curl from the machine these ran on, but it sends NO
// access-control-allow-origin, so a BROWSER fetch from bioimage.io is blocked.
//
// And the browser is what matters here. The probe runs server-side, but the
// ANNOTATOR reads chunks directly from the store, so a store without CORS
// cannot be annotated however reachable it is from the broker. That is why
// the page refuses this store, and refusing it is the behaviour this spec
// drives.
//
// Overridable so the CONTROL is repeatable without editing this file: point
// W1_STORE_URL at an unreachable host and the assertion below must go RED,
// because a store that cannot be reached produces a different refusal from a
// store that refuses cross-origin reads.
const STORE =
  process.env.W1_STORE_URL || 'https://s3.embl.de/i2k-2020/ngff-example-data/v0.4/yx.ome.zarr/';

const token = (() => {
  const f = process.env.BIOENGINE_ENV_FILE;
  if (!f) return undefined;
  try { return (fs.readFileSync(f, 'utf8').match(/HYPHA_TOKEN=(\S+)/) || [])[1]; } catch { return undefined; }
})();

test.use({ viewport: VIEWPORT });
// The default test timeout is 30s, which is SHORTER than the waits below, so an
// expect asking for 60s could never get it and failed as a test timeout with a
// misleading 'element not found'.
test.setTimeout(150_000);

test.beforeAll(() => {
  fs.mkdirSync(OUT, { recursive: true });
  console.log(`viewport: ${VIEWPORT.width}x${VIEWPORT.height}`);
  console.log(`target: ${BASE_URL}`);
});

test('the remote OME-Zarr import UI is live on production and opens', async ({ page }) => {
  test.skip(!token, 'HYPHA_TOKEN not available');

  const failed: string[] = [];
  page.on('response', (r) => { if (r.status() >= 400) failed.push(`${r.status()} ${r.url()}`); });

  await page.addInitScript(({ tok, expiry }) => {
    localStorage.setItem('token', tok as string);
    localStorage.setItem('tokenExpiry', expiry as string);
  }, { tok: token!, expiry: new Date(Date.now() + 3 * 3600 * 1000).toISOString() });

  await page.goto(`/#/colab/${DATASET}`, { waitUntil: 'domcontentloaded' });

  // The button the landing added. Found by its title, which is the string the
  // source actually carries, rather than by a label I guessed at.
  // Diagnose before asserting, so a failure says WHY rather than just that a
  // locator was absent: unauthenticated, wrong route and still-loading all
  // produce the same missing element.
  await page.waitForTimeout(8000);
  const diag = await page.evaluate(() => ({
    hash: location.hash,
    rootChildren: document.getElementById('root')?.childElementCount ?? 0,
    signedIn: !!localStorage.getItem('token'),
    buttons: Array.from(document.querySelectorAll('button')).map((b) => (b.getAttribute('title') || b.textContent || '').trim().slice(0, 48)).filter(Boolean).slice(0, 18),
    bodyText: (document.body.innerText || '').slice(0, 400),
  }));
  console.log('DIAG hash=' + diag.hash + ' root=' + diag.rootChildren + ' signedIn=' + diag.signedIn);
  console.log('DIAG buttons: ' + JSON.stringify(diag.buttons));
  console.log('DIAG text: ' + diag.bodyText.replace(/\s+/g, ' '));

  const open = page.getByTitle('Link an image that stays where it is, without copying it here');
  await expect(open).toBeVisible({ timeout: 60_000 });
  console.log('import button: visible');

  await open.click();
  await page.waitForTimeout(4000);
  const modal = await page.evaluate(() => ({
    text: (document.body.innerText || '').slice(0, 700).replace(/\s+/g, ' '),
    inputs: Array.from(document.querySelectorAll('input')).map((i) => (i.getAttribute('placeholder') || i.getAttribute('aria-label') || '').trim()).filter(Boolean),
  }));
  console.log('MODAL inputs: ' + JSON.stringify(modal.inputs));
  // The URL field's placeholder is unique to the landed component, so it is a
  // sounder assertion than a heading I could not locate in innerText (the
  // dialog renders outside the snapshot I took).
  const urlField = page.getByPlaceholder('https://example.org/data/my-sample.zarr/');
  await expect(urlField).toBeVisible();
  console.log('modal URL field: visible');

  // Drive the PROBE, then ASSERT what came back.
  //
  // The probe itself runs server-side, but the page refuses a store the
  // BROWSER cannot read, because the annotator fetches chunks directly. An
  // earlier version of this comment claimed CORS did not gate the feature,
  // which is the opposite of what the page says and of what this run shows.
  await urlField.fill(STORE);
  // Scoped to the dialog and matched on the button's real label. A page-wide
  // /load/ also matches "Download" and "Upload", both of which sit on the page
  // behind this dialog, so the old locator could have clicked either.
  const dialog = page.getByRole('dialog');
  await dialog.getByRole('button', { name: 'Check source' }).click();

  // THE ASSERTION THIS SPEC EXISTED WITHOUT. Until now the outcome was only
  // logged, so a broken probe, a hang, an unreachable host and the correct
  // refusal all produced the same green. A reviewer proved it by pointing the
  // store at an invalid host and watching the test still pass.
  //
  // Waited for rather than slept on: the expect polls, so a fast answer does
  // not cost 25 seconds and a slow one is still caught.
  await expect(dialog).toContainText(
    /does not allow cross-origin reads[\s\S]*Access-Control-Allow-Origin/,
    { timeout: 60_000 },
  );

  const after = (await dialog.innerText()).replace(/\s+/g, ' ');
  console.log('AFTER PROBE: ' + after.slice(0, 600));

  const shot = path.join(OUT, 'ome-zarr-import-modal-1280x900.png');
  await page.screenshot({ path: shot });
  console.log(`screenshot: ${shot}`);
  console.log(`viewport used: ${VIEWPORT.width}x${VIEWPORT.height}`);

  const real = failed.filter((f) => !f.includes('matomo'));
  console.log(`failed requests: ${failed.length} total, ${real.length} excluding matomo`);
  for (const f of real) console.log(`  failed: ${f}`);
  expect(real, real.join('\n')).toHaveLength(0);
});
