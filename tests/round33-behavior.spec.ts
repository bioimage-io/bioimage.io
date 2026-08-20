import { test, expect } from '@playwright/test';
import fs from 'fs';
import crypto from 'crypto';

// Round-33 supplementary acceptance (keen-puma): behavioral evidence beyond
// control wiring — brush actually paints a mask (with undo), arrow keys move
// the radius, +/-/0 drive the view, hue persists across reload and recolors
// existing masks.

test.use({ baseURL: 'http://localhost:5199' });

const DATASET_ALIAS = 'annotation-mst3ebzz-o5px';
const OUT = '/tmp/round33-verify';

function readHyphaToken(): string | undefined {
  if (process.env.HYPHA_TOKEN) return process.env.HYPHA_TOKEN;
  try {
    const envText = fs.readFileSync('/data/nmechtel/bioengine/.env', 'utf8');
    return envText.match(/HYPHA_TOKEN=(\S+)/)?.[1];
  } catch {
    return undefined;
  }
}

async function canvasHash(page: import('@playwright/test').Page): Promise<string> {
  const canvas = page.locator('canvas').first();
  const buf = await canvas.screenshot();
  return crypto.createHash('md5').update(buf).digest('hex');
}

test('round 33 behavior: brush paint + undo, radius keys, keyboard zoom, hue persistence', async ({ page }) => {
  test.setTimeout(300000);
  fs.mkdirSync(OUT, { recursive: true });

  const pageErrors: string[] = [];
  const drawLogs: string[] = [];
  page.on('pageerror', (e) => pageErrors.push(e.message));
  page.on('console', (m) => {
    if (m.text().includes('[Draw]')) drawLogs.push(m.text());
  });

  const token = readHyphaToken();
  expect(token).toBeTruthy();
  await page.addInitScript(({ tok, expiry }) => {
    localStorage.setItem('token', tok);
    localStorage.setItem('tokenExpiry', expiry);
    localStorage.setItem('bioimage-annotation-tutorial-seen', '1');
    // Init scripts re-run on reload; only clear the hue on the first load so
    // the reload-persistence assertion below sees the app's own value.
    if (!sessionStorage.getItem('r33-hue-cleared')) {
      sessionStorage.setItem('r33-hue-cleared', '1');
      localStorage.removeItem('bioimage-annotation-mask-hue');
    }
  }, { tok: token!, expiry: new Date(Date.now() + 3 * 60 * 60 * 1000).toISOString() });

  await page.goto(`/#/colab/annotate?session_id=${DATASET_ALIAS}&label=cells`);
  await expect(page.locator('canvas').first()).toBeVisible({ timeout: 90000 });
  await expect(page.getByText('Annotation Tools')).toBeVisible({ timeout: 30000 });
  await page.waitForTimeout(3000); // let initial render settle

  const expandToolbarBtn = page.getByRole('button', { name: 'Expand toolbar' });
  if (await expandToolbarBtn.isVisible({ timeout: 3000 }).catch(() => false)) {
    await expandToolbarBtn.click();
  }

  // --- Keyboard zoom: +, -, 0 all repaint the view ---
  await page.locator('canvas').first().click({ position: { x: 10, y: 10 } }); // focus page, corner to avoid tools
  const hashStart = await canvasHash(page);
  await page.keyboard.press('+');
  await page.waitForTimeout(700); // 200ms animation + settle
  const hashZoomedIn = await canvasHash(page);
  expect(hashZoomedIn).not.toBe(hashStart);
  await page.keyboard.press('-');
  await page.waitForTimeout(700);
  const hashZoomedOut = await canvasHash(page);
  expect(hashZoomedOut).not.toBe(hashZoomedIn);
  await page.keyboard.press('+');
  await page.waitForTimeout(700);
  await page.keyboard.press('0');
  await page.waitForTimeout(900); // 300ms fit animation
  const hashRecentered = await canvasHash(page);
  expect(hashRecentered).not.toBe(hashZoomedIn);
  await page.screenshot({ path: `${OUT}/1-after-recenter.png` });

  // --- Brush paints a new mask via Draw Mask tool ---
  const drawMaskBtn = page.getByRole('button', { name: /Draw Mask/ }).first();
  await drawMaskBtn.click();
  await expect(page.getByLabel('Increase brush radius')).not.toBeVisible({ timeout: 10000 });
  await drawMaskBtn.dblclick();
  await expect(page.getByLabel('Increase brush radius')).toBeVisible({ timeout: 10000 });

  // Radius arrow keys (canvas focused so we're not inside an input)
  await expect(page.getByText('20px')).toBeVisible();
  await page.keyboard.press('ArrowUp');
  await expect(page.getByText('25px')).toBeVisible({ timeout: 5000 });
  await page.keyboard.press('ArrowUp');
  await expect(page.getByText('30px')).toBeVisible({ timeout: 5000 });
  await page.keyboard.press('ArrowDown');
  await expect(page.getByText('25px')).toBeVisible({ timeout: 5000 });

  // Paint a stroke across the canvas center
  const canvas = page.locator('canvas').first();
  const cbox = (await canvas.boundingBox())!;
  const cx = cbox.x + cbox.width / 2;
  const cy = cbox.y + cbox.height / 2;
  const hashBeforePaint = await canvasHash(page);
  await page.mouse.move(cx - 60, cy);
  await page.mouse.down();
  await page.mouse.move(cx + 60, cy, { steps: 12 });
  await page.mouse.up();
  await page.waitForTimeout(800);
  expect(drawLogs.some((t) => t.includes('Brush-created polygon'))).toBe(true);
  const hashAfterPaint = await canvasHash(page);
  expect(hashAfterPaint).not.toBe(hashBeforePaint);
  await page.screenshot({ path: `${OUT}/2-brush-painted.png` });

  // Undo removes the stroke (single snapshot per stroke)
  await page.keyboard.press('Control+z');
  await page.waitForTimeout(800);
  const hashAfterUndo = await canvasHash(page);
  expect(hashAfterUndo).not.toBe(hashAfterPaint);
  await page.screenshot({ path: `${OUT}/3-after-undo.png` });

  // Paint again and KEEP it so the hue change below has an existing mask
  await page.mouse.move(cx - 60, cy - 40);
  await page.mouse.down();
  await page.mouse.move(cx + 60, cy - 40, { steps: 12 });
  await page.mouse.up();
  await page.waitForTimeout(800);

  // Brush mode also available for Eraser and Expand Mask (no crash on drag)
  for (const tool of ['Eraser', 'Expand Mask']) {
    await page.getByRole('button', { name: new RegExp(tool) }).first().click();
    await page.mouse.move(cx - 20, cy - 40);
    await page.mouse.down();
    await page.mouse.move(cx + 20, cy - 40, { steps: 6 });
    await page.mouse.up();
    await page.waitForTimeout(400);
  }

  // --- Hue dialog recolors the existing mask and persists ---
  const hashBeforeHue = await canvasHash(page);
  await page.locator('[data-tool="mask-color"]').first().click();
  await expect(page.getByRole('dialog').getByText('Mask Color')).toBeVisible({ timeout: 10000 });
  const slider = page.getByRole('slider', { name: 'Mask hue' });
  await slider.focus();
  for (let i = 0; i < 30; i++) await slider.press('ArrowRight'); // shift hue well away
  await page.waitForTimeout(600);
  await page.getByRole('button', { name: 'Done' }).click();
  const hashAfterHue = await canvasHash(page);
  expect(hashAfterHue).not.toBe(hashBeforeHue); // existing mask recolored live
  const storedHue = await page.evaluate(() => localStorage.getItem('bioimage-annotation-mask-hue'));
  expect(storedHue).not.toBeNull();
  expect(Number(storedHue)).not.toBe(209);
  await page.screenshot({ path: `${OUT}/4-hue-changed.png` });

  // Survives reload
  await page.reload();
  await expect(page.locator('canvas').first()).toBeVisible({ timeout: 90000 });
  const storedHueAfterReload = await page.evaluate(() => localStorage.getItem('bioimage-annotation-mask-hue'));
  expect(storedHueAfterReload).toBe(storedHue);
  await page.locator('[data-tool="mask-color"]').first().click();
  await expect(page.getByRole('dialog').getByText('Mask Color')).toBeVisible({ timeout: 10000 });
  const resetBtn = page.getByRole('button', { name: 'Reset' });
  await expect(resetBtn).toBeEnabled(); // non-default hue restored from storage
  await resetBtn.click();
  await expect(page.getByText('#0084ff')).toBeVisible();
  await page.getByRole('button', { name: 'Done' }).click();

  expect(pageErrors).toEqual([]);
});
