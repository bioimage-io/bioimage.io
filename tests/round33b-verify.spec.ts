import { test, expect } from '@playwright/test';
import fs from 'fs';
import { BASE_URL } from './baseUrl';

// Round-33b independent acceptance (keen-puma): drawMode + brushRadius
// persistence across reload, and hold-acceleration on ArrowUp/ArrowDown.
// Playwright's keyboard.down does not synthesize OS auto-repeat, so repeat
// events are dispatched manually with `repeat: true`, which is exactly what
// the handler keys its hold tracking on. Round 33c replaced the standalone
// brush-mode toggle row with a double-click gesture on the Draw Mask button.

test.use({ baseURL: BASE_URL });

const DATASET_ALIAS = 'annotation-mst3ebzz-o5px';
const OUT = '/tmp/round33b-verify';

test('persistence + hold acceleration', async ({ page }) => {
  test.setTimeout(300000);
  fs.mkdirSync(OUT, { recursive: true });
  const pageErrors: string[] = [];
  page.on('pageerror', (e) => pageErrors.push(e.message));

  const envText = fs.readFileSync('/data/nmechtel/bioengine/.env', 'utf8');
  const token = envText.match(/HYPHA_TOKEN=(\S+)/)![1];
  await page.addInitScript(({ tok, expiry }) => {
    localStorage.setItem('token', tok);
    localStorage.setItem('tokenExpiry', expiry);
    localStorage.setItem('bioimage-annotation-tutorial-seen', '1');
    if (!sessionStorage.getItem('r33b-cleared')) {
      sessionStorage.setItem('r33b-cleared', '1');
      localStorage.removeItem('bioimage-annotation-draw-mode');
      localStorage.removeItem('bioimage-annotation-brush-radius');
    }
  }, { tok: token, expiry: new Date(Date.now() + 3 * 60 * 60 * 1000).toISOString() });

  await page.goto(`/#/colab/annotate?session_id=${DATASET_ALIAS}&label=cells`);
  await expect(page.locator('canvas').first()).toBeVisible({ timeout: 90000 });
  await expect(page.getByText('Annotation Tools')).toBeVisible({ timeout: 30000 });

  const expandToolbarBtn = page.getByRole('button', { name: 'Expand toolbar' });
  if (await expandToolbarBtn.isVisible({ timeout: 3000 }).catch(() => false)) {
    await expandToolbarBtn.click();
  }

  // Round 33d: brush is the default mode, so activating Draw Mask on a fresh
  // profile shows the radius stepper immediately at the default 20px.
  const drawMaskBtn = page.locator('[data-tool="polygon"]').first();
  await drawMaskBtn.click();
  await expect(page.getByLabel('Increase brush radius')).toBeVisible();
  await expect(page.getByText('20px')).toBeVisible();
  // Double-click still toggles to lasso (and persists it), then back to brush.
  await drawMaskBtn.dblclick();
  await expect(page.getByLabel('Increase brush radius')).not.toBeVisible({ timeout: 5000 });
  expect(await page.evaluate(() => localStorage.getItem('bioimage-annotation-draw-mode'))).toBe('lasso');
  await drawMaskBtn.dblclick();
  await expect(page.getByLabel('Increase brush radius')).toBeVisible();
  await expect(page.getByText('20px')).toBeVisible();

  // --- Hold acceleration via synthetic repeat events ---
  const dispatch = (repeat: boolean) =>
    page.evaluate((r) => {
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowUp', repeat: r, bubbles: true }));
    }, repeat);

  await dispatch(false); // hold starts: 20 -> 25
  await dispatch(true);  // quick repeat, still base step: 25 -> 30
  await expect(page.getByText('30px')).toBeVisible({ timeout: 5000 });
  await page.waitForTimeout(1150); // cross the 1s acceleration threshold
  await dispatch(true);  // accelerated: 30 -> 40 (double step)
  await expect(page.getByText('40px')).toBeVisible({ timeout: 5000 });
  // Release + new press resets to base step: 40 -> 45
  await page.evaluate(() => {
    document.dispatchEvent(new KeyboardEvent('keyup', { key: 'ArrowUp', bubbles: true }));
  });
  await dispatch(false);
  await expect(page.getByText('45px')).toBeVisible({ timeout: 5000 });
  await page.screenshot({ path: `${OUT}/1-accelerated-45px.png` });

  // --- Persistence across reload ---
  const stored = await page.evaluate(() => ({
    mode: localStorage.getItem('bioimage-annotation-draw-mode'),
    radius: localStorage.getItem('bioimage-annotation-brush-radius'),
  }));
  expect(stored.mode).toBe('brush');
  expect(stored.radius).toBe('45');

  await page.reload();
  await expect(page.locator('canvas').first()).toBeVisible({ timeout: 90000 });
  const expandBtn2 = page.getByRole('button', { name: 'Expand toolbar' });
  if (await expandBtn2.isVisible({ timeout: 3000 }).catch(() => false)) {
    await expandBtn2.click();
  }
  await expect(page.getByLabel('Increase brush radius')).toBeVisible({ timeout: 15000 });
  await expect(page.getByText('45px')).toBeVisible({ timeout: 10000 });
  await page.screenshot({ path: `${OUT}/2-restored-after-reload.png` });

  expect(pageErrors).toEqual([]);
});
