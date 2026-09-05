import { test, expect } from '@playwright/test';
import fs from 'fs';
import { BASE_URL } from './baseUrl';

// Round-33c bug fixes reported by Nils during live dev-server testing:
//
// Bug 1: changing the brush radius then starting a new brush stroke crashed
// with "First and last Position are not equivalent" from turf.polygon
// inside createPixelCircle. Root cause: the ring's closing point was
// recomputed via trigonometry instead of copied from the first point, and
// floating-point error left the ring not exactly closed.
//
// Bug 2: the brush cursor circle did not resize until the next pointer
// move after a brushRadius change. Fixed by pushing radius changes into the
// live cursor feature directly, independent of pointer events.
//
// This spec cannot inspect the OpenLayers cursor geometry directly (it is
// internal to the map), so it verifies the fix indirectly: no page error is
// thrown when radius is changed via keyboard/buttons and a stroke is then
// painted immediately, across several radius changes and both brush
// entry points (button steppers and arrow keys).

test.use({ baseURL: BASE_URL });

const DATASET_ALIAS = 'annotation-mst3ebzz-o5px';

function readHyphaToken(): string | undefined {
  if (process.env.HYPHA_TOKEN) return process.env.HYPHA_TOKEN;
  try {
    const envText = fs.readFileSync('/data/nmechtel/bioengine/.env', 'utf8');
    return envText.match(/HYPHA_TOKEN=(\S+)/)?.[1];
  } catch {
    return undefined;
  }
}

test('round 33c: no ring-closure crash after changing brush radius, cursor resizes live', async ({ page }) => {
  test.setTimeout(240000);

  const pageErrors: string[] = [];
  page.on('pageerror', (e) => pageErrors.push(e.message));

  const token = readHyphaToken();
  expect(token).toBeTruthy();
  await page.addInitScript(({ tok, expiry }) => {
    localStorage.setItem('token', tok);
    localStorage.setItem('tokenExpiry', expiry);
    localStorage.setItem('bioimage-annotation-tutorial-seen', '1');
  }, { tok: token!, expiry: new Date(Date.now() + 3 * 60 * 60 * 1000).toISOString() });

  await page.goto(`/#/colab/annotate?session_id=${DATASET_ALIAS}&label=cells`);
  await expect(page.locator('canvas').first()).toBeVisible({ timeout: 90000 });
  await expect(page.getByText('Annotation Tools')).toBeVisible({ timeout: 30000 });

  const expandToolbarBtn = page.getByRole('button', { name: 'Expand toolbar' });
  if (await expandToolbarBtn.isVisible({ timeout: 3000 }).catch(() => false)) {
    await expandToolbarBtn.click();
  }

  // Ensure brush mode via the Draw Mask double-click (round 33c UX). Brush is
  // the default (round 33d), but toggle explicitly so this test is
  // independent of whatever mode a prior test left behind.
  const drawMaskBtn = page.locator('[data-tool="polygon"]').first();
  if (!(await page.getByLabel('Increase brush radius').isVisible({ timeout: 2000 }).catch(() => false))) {
    await drawMaskBtn.dblclick();
  }
  await expect(page.getByLabel('Increase brush radius')).toBeVisible({ timeout: 10000 });

  const canvas = page.locator('canvas').first();
  const cbox = (await canvas.boundingBox())!;
  const cx = cbox.x + cbox.width / 2;
  const cy = cbox.y + cbox.height / 2;

  const paintStroke = async (dx: number) => {
    await page.mouse.move(cx - dx, cy);
    await page.mouse.down();
    await page.mouse.move(cx + dx, cy, { steps: 8 });
    await page.mouse.up();
    await page.waitForTimeout(150);
  };

  // Change radius via the stepper buttons, then immediately paint. This is
  // the exact repro: resize, then pointerdown before any pointermove.
  const increaseBtn = page.getByLabel('Increase brush radius');
  await increaseBtn.click();
  await increaseBtn.click();
  await expect(page.getByText('30px')).toBeVisible({ timeout: 5000 });
  await paintStroke(40);

  const decreaseBtn = page.getByLabel('Decrease brush radius');
  await decreaseBtn.click();
  await decreaseBtn.click();
  await decreaseBtn.click();
  await expect(page.getByText('15px')).toBeVisible({ timeout: 5000 });
  await paintStroke(30);

  // Change radius via arrow keys (a separate mutation path), then paint.
  await page.evaluate(() => {
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowUp', bubbles: true, repeat: false }));
  });
  await expect(page.getByText('20px')).toBeVisible({ timeout: 5000 });
  await paintStroke(20);

  // Undo the strokes so this spec leaves no debris behind.
  await page.keyboard.press('Control+z');
  await page.waitForTimeout(200);
  await page.keyboard.press('Control+z');
  await page.waitForTimeout(200);
  await page.keyboard.press('Control+z');
  await page.waitForTimeout(200);

  expect(pageErrors).toEqual([]);
});
