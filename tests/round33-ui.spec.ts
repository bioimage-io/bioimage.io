import { test, expect } from '@playwright/test';
import fs from 'fs';

// Round-33 UI: brush-mode toggle, radius stepper, and Mask Color dialog.
// Confirms the new controls render, toggle, and don't throw.

test.use({ baseURL: 'http://localhost:5199' });

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

test('round 33: brush mode toggle, radius stepper, mask color dialog', async ({ page }) => {
  test.setTimeout(180000);

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

  // Expand the tools panel so row labels are queryable (panel expansion is
  // persisted, so it may already be expanded from a prior run).
  const expandToolbarBtn = page.getByRole('button', { name: 'Expand toolbar' });
  if (await expandToolbarBtn.isVisible({ timeout: 3000 }).catch(() => false)) {
    await expandToolbarBtn.click();
  }

  // Brush-mode toggle row should be present and start as Lasso Drawing.
  await expect(page.getByText('Lasso Drawing')).toBeVisible({ timeout: 10000 });
  await page.locator('[data-tool="brush-mode"]').first().click();
  await expect(page.getByText('Brush Painting')).toBeVisible({ timeout: 10000 });

  // Radius stepper appears only in brush mode.
  await expect(page.getByText('20px')).toBeVisible({ timeout: 10000 });
  const increaseBtn = page.getByLabel('Increase brush radius');
  await increaseBtn.click();
  await expect(page.getByText('25px')).toBeVisible({ timeout: 10000 });
  const decreaseBtn = page.getByLabel('Decrease brush radius');
  await decreaseBtn.click();
  await expect(page.getByText('20px')).toBeVisible({ timeout: 10000 });

  // Toggle back to lasso.
  await page.locator('[data-tool="brush-mode"]').first().click();
  await expect(page.getByText('Lasso Drawing')).toBeVisible({ timeout: 10000 });

  // Mask Color dialog: open, move slider, reset, close.
  await page.locator('[data-tool="mask-color"]').first().click();
  await expect(page.getByRole('dialog').getByText('Mask Color')).toBeVisible({ timeout: 10000 });
  await expect(page.getByText('#0084ff')).toBeVisible();
  const resetBtn = page.getByRole('button', { name: 'Reset' });
  await expect(resetBtn).toBeDisabled();
  const slider = page.getByRole('slider', { name: 'Mask hue' });
  await slider.focus();
  await slider.press('ArrowRight');
  await expect(resetBtn).toBeEnabled();
  await resetBtn.click();
  await expect(resetBtn).toBeDisabled();
  await page.getByRole('button', { name: 'Done' }).click();
  await expect(page.getByRole('dialog').getByText('Mask Color')).not.toBeVisible({ timeout: 5000 });

  expect(pageErrors).toEqual([]);
});
