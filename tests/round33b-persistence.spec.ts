import { test, expect } from '@playwright/test';
import fs from 'fs';
import { BASE_URL } from './baseUrl';

// Round-33 follow-up: drawMode + brushRadius persist across reload (like
// maskHue), and holding ArrowUp/ArrowDown accelerates after ~1s of
// continuous hold. Round 33c replaced the standalone brush-mode toggle row
// with a double-click gesture on the Draw Mask button, so brush mode is
// detected here via the radius stepper's visibility instead of a
// "Brush Painting" / "Lasso Drawing" label.

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

async function gotoAnnotate(page: import('@playwright/test').Page) {
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
}

async function isBrushMode(page: import('@playwright/test').Page): Promise<boolean> {
  return page.getByLabel('Increase brush radius').isVisible({ timeout: 2000 }).catch(() => false);
}

test('round 33b: drawMode and brushRadius persist across reload', async ({ page }) => {
  test.setTimeout(180000);

  await gotoAnnotate(page);

  const drawMaskBtn = page.locator('[data-tool="polygon"]').first();

  // Reset to a known state first (in case a prior run left brush mode on).
  if (!(await isBrushMode(page))) {
    await drawMaskBtn.dblclick();
  }
  await expect(page.getByLabel('Increase brush radius')).toBeVisible({ timeout: 10000 });
  await expect(page.getByText('20px')).toBeVisible({ timeout: 10000 });

  const increaseBtn = page.getByLabel('Increase brush radius');
  await increaseBtn.click();
  await increaseBtn.click();
  await expect(page.getByText('30px')).toBeVisible({ timeout: 10000 });

  await page.reload();
  await expect(page.locator('canvas').first()).toBeVisible({ timeout: 90000 });
  await expect(page.getByText('Annotation Tools')).toBeVisible({ timeout: 30000 });
  const expandAgain = page.getByRole('button', { name: 'Expand toolbar' });
  if (await expandAgain.isVisible({ timeout: 3000 }).catch(() => false)) {
    await expandAgain.click();
  }

  // Persisted: still brush mode, still 30px, with no re-click needed.
  await expect(page.getByLabel('Increase brush radius')).toBeVisible({ timeout: 10000 });
  await expect(page.getByText('30px')).toBeVisible({ timeout: 10000 });

  // Reset back to lasso + default radius so other specs/runs start clean.
  const decreaseBtn = page.getByLabel('Decrease brush radius');
  await decreaseBtn.click();
  await decreaseBtn.click();
  await expect(page.getByText('20px')).toBeVisible({ timeout: 10000 });
  await drawMaskBtn.dblclick();
  await expect(page.getByLabel('Increase brush radius')).not.toBeVisible({ timeout: 10000 });
});

test('round 33b: holding ArrowUp accelerates brush radius after ~1s', async ({ page }) => {
  test.setTimeout(180000);

  await gotoAnnotate(page);

  const drawMaskBtn = page.locator('[data-tool="polygon"]').first();

  if (!(await isBrushMode(page))) {
    await drawMaskBtn.dblclick();
  }
  await expect(page.getByLabel('Increase brush radius')).toBeVisible({ timeout: 10000 });
  await expect(page.getByText('20px')).toBeVisible({ timeout: 10000 });

  // Focus the page body so document-level keydown listeners fire, then
  // simulate a real key press (repeat:false) -> +5, confirming key repeat
  // isn't filtered.
  await page.evaluate(() => {
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowUp', bubbles: true, repeat: false }));
  });
  await expect(page.getByText('25px')).toBeVisible({ timeout: 5000 });

  // Wait past the 1s acceleration threshold, then dispatch a repeat:true
  // keydown for the SAME held key -> should jump by the doubled step (10),
  // landing on 35px, not the base 5px step (30px).
  await page.waitForTimeout(1100);
  await page.evaluate(() => {
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowUp', bubbles: true, repeat: true }));
  });
  await expect(page.getByText('35px')).toBeVisible({ timeout: 5000 });

  // Reset back to lasso + default radius.
  const decreaseBtn = page.getByLabel('Decrease brush radius');
  for (let i = 0; i < 3; i++) await decreaseBtn.click();
  await expect(page.getByText('20px')).toBeVisible({ timeout: 10000 });
  await drawMaskBtn.dblclick();
  await expect(page.getByLabel('Increase brush radius')).not.toBeVisible({ timeout: 10000 });
});
