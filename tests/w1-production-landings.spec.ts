import { test, expect } from '@playwright/test';
import fs from 'fs';
import path from 'path';
import { BASE_URL } from './baseUrl';

/**
 * Drives the two W1 changes that have LANDED, against production.
 *
 * Point it at the real site:
 *   E2E_BASE_URL=https://bioimage.io npx playwright test tests/w1-production-landings.spec.ts
 *
 * Two things this is careful about.
 *
 * The viewport is set AND printed. A `frontend`-labelled row will not close
 * unless a desktop viewport is named in evidence output, and more importantly a
 * screenshot of an unknown window size is not evidence about a desktop layout.
 *
 * It asserts on strings the landings INTRODUCED, never on strings that were
 * already deployed. 'Cellpose-SAM' was in the bundle 24 times before either
 * landing, so finding it proves nothing; 'ViT-H' and 'Stopped tracking these
 * runs' were absent until these two merges, so they do.
 */

const VIEWPORT = { width: 1280, height: 900 };
// Relative, and under Playwright's own output directory: an absolute path
// here names one person's machine, which does not belong in a public
// repository and would not resolve on anybody else's checkout anyway.
const OUT = process.env.W1_SHOT_DIR || 'test-results/w1-prod-shots';

test.use({ viewport: VIEWPORT });

test.beforeAll(() => {
  fs.mkdirSync(OUT, { recursive: true });
  console.log(`viewport: ${VIEWPORT.width}x${VIEWPORT.height}`);
  console.log(`target: ${BASE_URL}`);
});

test('the deployed bundle carries both landings, and neither marker pre-existed', async ({ page }) => {
  const res = await page.goto('/', { waitUntil: 'domcontentloaded' });
  expect(res?.status(), 'the site itself must answer 200').toBe(200);

  // Read the asset the running page actually loaded, rather than guessing a name.
  const assetPath = await page.evaluate(() => {
    const el = Array.from(document.querySelectorAll('script[src]')).find((s) =>
      (s as HTMLScriptElement).src.includes('/static/js/main.'),
    );
    return el ? new URL((el as HTMLScriptElement).src).pathname : null;
  });
  expect(assetPath, 'the page must load a main bundle').toBeTruthy();
  console.log(`asset: ${assetPath}`);

  const js = await (await page.request.get(assetPath!)).text();
  console.log(`bundle bytes: ${js.length}`);

  // Introduced by the export-dialog landing.
  expect(js.includes('ViT-H'), 'ViT-H marks the export-dialog landing').toBe(true);
  // Introduced by the poll-recovery landing.
  expect(
    js.includes('Stopped tracking these runs'),
    'this banner marks the poll-recovery landing',
  ).toBe(true);
  // Controls: one string that must never appear, and one that pre-dates both
  // landings, so a pass cannot come from matching everything or nothing.
  expect(js.includes('zzznotathing'), 'negative control').toBe(false);
  expect(js.includes('Cellpose-SAM'), 'pre-existing control').toBe(true);
});

test('the colab finetune route renders at a desktop viewport', async ({ page }) => {
  // Failed requests are collected from the RESPONSE event, not from console
  // text. Chromium's console message for a failed subresource is the bare
  // string "Failed to load resource: the server responded with a status of 404
  // ()" with no URL in it, so filtering console text by hostname silently
  // matches nothing and every route looks broken.
  const failed: string[] = [];
  page.on('response', (r) => {
    if (r.status() >= 400) failed.push(`${r.status()} ${r.url()}`);
  });
  const pageErrors: string[] = [];
  page.on('pageerror', (e) => pageErrors.push(String(e)));

  await page.goto('/#/colab', { waitUntil: 'domcontentloaded' });
  // The app mounts into #root; a blank root is what a broken bundle looks like,
  // and it returns 200 just the same.
  await expect.poll(
    () => page.evaluate(() => document.getElementById('root')?.childElementCount ?? 0),
    { timeout: 30_000 },
  ).toBeGreaterThan(0);

  const shot = path.join(OUT, 'colab-production-1280x900.png');
  await page.screenshot({ path: shot, fullPage: false });
  console.log(`screenshot: ${shot}`);
  console.log(`viewport used: ${VIEWPORT.width}x${VIEWPORT.height}`);

  // matomo 404s on every route here and is known noise, so it is excluded BY
  // URL. Everything else that failed is named, so a real broken asset cannot
  // hide behind the exclusion.
  console.log(`failed requests, all: ${failed.length}`);
  for (const f of failed) console.log(`  failed: ${f}`);
  const real = failed.filter((f) => !f.includes('matomo'));
  console.log(`failed requests, matomo excluded: ${real.length}`);
  console.log(`uncaught page errors: ${pageErrors.length}`);
  expect(real, real.join('\n')).toHaveLength(0);
  expect(pageErrors, pageErrors.join('\n')).toHaveLength(0);
});
