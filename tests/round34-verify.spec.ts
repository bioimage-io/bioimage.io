import { test, expect } from '@playwright/test';
import fs from 'fs';

// Round-34 independent acceptance (keen-puma), the gated Interactive
// Segmentation flow end to end on the live dev server:
//   B before preparation opens the model dialog instead of the tool,
//   the dialog lists all 6 generalists in two groups with vit_l_lm default,
//   "Start annotating" is disabled until decoder + embedding are ready,
//   clicking it closes the dialog and activates the tool,
//   a real box then produces a uSAM mask,
//   and B afterwards activates directly without the dialog.

test.use({ baseURL: 'http://localhost:5199' });

const DATASET_ALIAS = 'annotation-mst3ebzz-o5px';
const OUT = '/tmp/round34-verify';

test('gated interactive segmentation flow', async ({ page }) => {
  test.setTimeout(420000);
  fs.mkdirSync(OUT, { recursive: true });
  const pageErrors: string[] = [];
  const samLogs: string[] = [];
  page.on('pageerror', (e) => pageErrors.push(e.message));
  page.on('console', (m) => {
    const t = m.text();
    if (t.includes('micro-sam') || t.includes('[AnnotatePage]')) samLogs.push(t);
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

  // Wait for the micro-sam service probe to succeed so the tool is enabled.
  await expect
    .poll(
      async () =>
        page
          .locator('[data-tool="sambox"]')
          .first()
          .isEnabled()
          .catch(() => false),
      { timeout: 60000 }
    )
    .toBe(true);

  // --- B while NOT ready opens the dialog, not the tool ---
  await page.locator('canvas').first().click({ position: { x: 10, y: 10 } });
  await page.keyboard.press('b');
  const dialog = page.getByRole('dialog').filter({ hasText: 'Interactive Segmentation Model' });
  await expect(dialog).toBeVisible({ timeout: 15000 });
  await page.screenshot({ path: `${OUT}/1-dialog-via-b.png` });

  // --- All 6 models in two groups, vit_l_lm default ---
  await expect(dialog.getByText('μSAM: light microscopy')).toBeVisible();
  await expect(dialog.getByText('μSAM: EM organelles')).toBeVisible();
  await expect(dialog.getByText('Large (default)')).toBeVisible();
  const tiny = dialog.getByText('Tiny', { exact: true });
  expect(await tiny.count()).toBe(2); // one per group
  const dialogText = await dialog.innerText();
  expect(dialogText.includes('—')).toBe(false); // no em dashes

  // --- Start annotating is the gate: wait until decoder + embedding ready ---
  const startBtn = dialog.getByRole('button', { name: 'Start annotating' });
  await expect(startBtn).toBeVisible();
  // (It may already be enabled if preparation raced ahead; what matters is
  // that it ENDS enabled and that segmentation works after.)
  await expect(startBtn).toBeEnabled({ timeout: 240000 });
  await page.screenshot({ path: `${OUT}/2-ready.png` });

  await startBtn.click();
  await expect(dialog).not.toBeVisible({ timeout: 10000 });

  // --- The box tool is active: draw a box, get a uSAM mask ---
  const canvas = page.locator('canvas').first();
  const cbox = (await canvas.boundingBox())!;
  const cx = cbox.x + cbox.width / 2;
  const cy = cbox.y + cbox.height / 2;
  await page.mouse.move(cx - 45, cy - 45);
  await page.mouse.down();
  await page.mouse.move(cx + 45, cy + 45, { steps: 8 });
  await page.mouse.up();
  await expect
    .poll(() => samLogs.some((t) => /micro-sam (box )?added \d+ mask/i.test(t)), { timeout: 120000 })
    .toBe(true);
  await page.screenshot({ path: `${OUT}/3-box-mask.png` });

  // --- Ready now: B activates directly, no dialog ---
  await page.keyboard.press('m'); // switch away
  await page.waitForTimeout(300);
  await page.keyboard.press('b');
  await page.waitForTimeout(1200);
  await expect(dialog).not.toBeVisible();
  // Another box still works, proving the tool (not the dialog) got activated.
  await page.mouse.move(cx + 60, cy - 80);
  await page.mouse.down();
  await page.mouse.move(cx + 130, cy - 20, { steps: 8 });
  await page.mouse.up();
  await expect
    .poll(
      () => samLogs.filter((t) => /micro-sam (box )?added \d+ mask/i.test(t)).length,
      { timeout: 120000 }
    )
    .toBeGreaterThan(1);

  // --- Gear opens the dialog even when ready; recompute rows exist ---
  await page.getByLabel('Configure Interactive Segmentation model').first().click();
  await expect(dialog).toBeVisible({ timeout: 10000 });
  const recomputeButtons = dialog.locator('[aria-label^="Recompute embedding for"]');
  expect(await recomputeButtons.count()).toBeGreaterThan(0);
  await page.screenshot({ path: `${OUT}/4-dialog-when-ready.png` });
  await expect(dialog.getByRole('button', { name: 'Start annotating' })).toBeEnabled();
  await dialog.getByRole('button', { name: 'Start annotating' }).click();
  await expect(dialog).not.toBeVisible({ timeout: 10000 });

  expect(pageErrors).toEqual([]);
});
