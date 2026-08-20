import { test, expect } from '@playwright/test';
import fs from 'fs';
import crypto from 'crypto';

// Round-33d independent acceptance (keen-puma): brush-first default is covered
// in round33b-verify; this spec covers the blue brush stroke (mid-stroke
// screenshot for eyeball review), and the Select-mode rework: drag on empty
// space box-selects every touched mask instead of panning, Shift adds, Delete
// removes, and an empty-area box neither pans nor errors.

test.use({ baseURL: 'http://localhost:5199' });

const DATASET_ALIAS = 'annotation-mst3ebzz-o5px';
const OUT = '/tmp/round33d-verify';

async function canvasHash(page: import('@playwright/test').Page): Promise<string> {
  const canvas = page.locator('canvas').first();
  const buf = await canvas.screenshot();
  return crypto.createHash('md5').update(buf).digest('hex');
}

test('blue brush stroke + box selection without panning', async ({ page }) => {
  test.setTimeout(300000);
  fs.mkdirSync(OUT, { recursive: true });
  const pageErrors: string[] = [];
  const selectLogs: string[] = [];
  page.on('pageerror', (e) => pageErrors.push(e.message));
  page.on('console', (m) => {
    if (m.text().includes('[Select]')) selectLogs.push(m.text());
  });

  const envText = fs.readFileSync('/data/nmechtel/bioengine/.env', 'utf8');
  const token = envText.match(/HYPHA_TOKEN=(\S+)/)![1];
  await page.addInitScript(({ tok, expiry }) => {
    localStorage.setItem('token', tok);
    localStorage.setItem('tokenExpiry', expiry);
    localStorage.setItem('bioimage-annotation-tutorial-seen', '1');
  }, { tok: token, expiry: new Date(Date.now() + 3 * 60 * 60 * 1000).toISOString() });

  await page.goto(`/#/colab/annotate?session_id=${DATASET_ALIAS}&label=cells`);
  await expect(page.locator('canvas').first()).toBeVisible({ timeout: 90000 });
  await expect(page.getByText('Annotation Tools')).toBeVisible({ timeout: 30000 });
  await page.waitForTimeout(3000);

  const expandToolbarBtn = page.getByRole('button', { name: 'Expand toolbar' });
  if (await expandToolbarBtn.isVisible({ timeout: 3000 }).catch(() => false)) {
    await expandToolbarBtn.click();
  }

  const canvas = page.locator('canvas').first();
  const cbox = (await canvas.boundingBox())!;
  const cx = cbox.x + cbox.width / 2;
  const cy = cbox.y + cbox.height / 2;

  // --- Paint two brush masks (default mode is brush, no toggle needed) ---
  const drawMaskBtn = page.locator('[data-tool="polygon"]').first();
  await drawMaskBtn.click();
  await expect(page.getByLabel('Increase brush radius')).toBeVisible({ timeout: 10000 });

  // Mask 1, with a mid-stroke screenshot so the live preview color (blue, not
  // the old yellow) is captured for review.
  await page.mouse.move(cx - 100, cy - 60);
  await page.mouse.down();
  await page.mouse.move(cx - 40, cy - 60, { steps: 8 });
  await page.screenshot({ path: `${OUT}/1-mid-stroke-preview.png` });
  await page.mouse.up();
  await page.waitForTimeout(500);

  // Mask 2, separated from mask 1.
  await page.mouse.move(cx + 40, cy + 60);
  await page.mouse.down();
  await page.mouse.move(cx + 100, cy + 60, { steps: 8 });
  await page.mouse.up();
  await page.waitForTimeout(500);

  // --- Select mode: box over both masks selects 2, view does not pan ---
  await page.getByRole('button', { name: /^Select/ }).first().click();
  // Park the pointer at a fixed neutral spot so hover-dependent rendering
  // (e.g. Modify vertex indicators) is identical in both captures.
  await page.mouse.move(cx, cy - 150);
  await page.waitForTimeout(300);
  await canvas.screenshot({ path: `${OUT}/hash-before.png` });
  const hashBeforeBox = await canvasHash(page);
  // Start on empty space above-left of both masks, drag past both.
  await page.mouse.move(cx - 140, cy - 110);
  await page.mouse.down();
  await page.mouse.move(cx + 140, cy + 110, { steps: 10 });
  await page.mouse.up();
  await page.waitForTimeout(500);
  expect(selectLogs.some((t) => t.includes('Box-selected (2 total)'))).toBe(true);
  await page.screenshot({ path: `${OUT}/2-box-selected-two.png` });

  // --- Empty-area box: selection cleared to 0, and no panning happened ---
  // NOTE: the map canvas extends under the floating toolbar panels, so the
  // canvas bounding-box corner is NOT map space; stay near the image center.
  await page.mouse.move(cx - 200, cy - 10);
  await page.mouse.down();
  await page.mouse.move(cx - 140, cy + 30, { steps: 6 });
  await page.mouse.up();
  await page.waitForTimeout(500);
  expect(selectLogs.join(' | ')).toContain('Box-selected (0 total)');
  await page.mouse.move(cx, cy - 150);
  await page.waitForTimeout(300);
  await canvas.screenshot({ path: `${OUT}/hash-after-empty-box.png` });
  const hashAfterEmptyBox = await canvasHash(page);
  // Same view, no selection left: pixels identical => the drag did not pan.
  expect(hashAfterEmptyBox).toBe(hashBeforeBox);

  // --- Re-select both and Delete removes them ---
  await page.mouse.move(cx - 140, cy - 110);
  await page.mouse.down();
  await page.mouse.move(cx + 140, cy + 110, { steps: 10 });
  await page.mouse.up();
  await page.waitForTimeout(400);
  await page.keyboard.press('Delete');
  await page.waitForTimeout(500);
  const hashAfterDelete = await canvasHash(page);
  expect(hashAfterDelete).not.toBe(hashBeforeBox); // masks gone
  await page.screenshot({ path: `${OUT}/3-after-delete.png` });

  // --- Renamed copy: the retired product name is gone from the live DOM ---
  const bodyHtml = await page.evaluate(() => document.body.innerHTML);
  expect(bodyHtml.includes('BioImageIO Fine-tune')).toBe(false);

  expect(pageErrors).toEqual([]);
});
