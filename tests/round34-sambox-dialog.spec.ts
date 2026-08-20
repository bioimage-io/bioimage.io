import { test, expect } from '@playwright/test';
import fs from 'fs';

// Round 34: Interactive Segmentation model-selection dialog. Coverage is
// deliberately read-only (open dialog, assert content, close) — clicking
// "Recompute embedding" would call the real broker remove_embedding RPC and
// mutate the shared dataset's cached embeddings, so that path is left for a
// live end-to-end pass rather than exercised here.

test.use({ baseURL: 'http://localhost:5199' });

const DATASET_ALIAS = 'annotation-mst3ebzz-o5px';
const OUT = '/tmp/round34-sambox-dialog';

async function loginAndOpenAnnotate(page: import('@playwright/test').Page) {
  const envText = fs.readFileSync('/data/nmechtel/bioengine/.env', 'utf8');
  const token = envText.match(/HYPHA_TOKEN=(\S+)/)![1];
  await page.addInitScript(
    ({ tok, expiry }) => {
      localStorage.setItem('token', tok);
      localStorage.setItem('tokenExpiry', expiry);
      localStorage.setItem('bioimage-annotation-tutorial-seen', '1');
    },
    { tok: token, expiry: new Date(Date.now() + 3 * 60 * 60 * 1000).toISOString() },
  );

  await page.goto(`/#/colab/annotate?session_id=${DATASET_ALIAS}&label=cells`);
  await expect(page.locator('canvas').first()).toBeVisible({ timeout: 90000 });
  await expect(page.getByText('Annotation Tools')).toBeVisible({ timeout: 30000 });
  await page.waitForTimeout(2000);

  const expandToolbarBtn = page.getByRole('button', { name: 'Expand toolbar' });
  if (await expandToolbarBtn.isVisible({ timeout: 3000 }).catch(() => false)) {
    await expandToolbarBtn.click();
  }
}

test('B activates the tool without opening the dialog; gear opens it', async ({ page }) => {
  test.setTimeout(180000);
  fs.mkdirSync(OUT, { recursive: true });
  const pageErrors: string[] = [];
  page.on('pageerror', (e) => pageErrors.push(e.message));

  await loginAndOpenAnnotate(page);

  // Pressing the shortcut activates the tool but never opens the dialog.
  await page.locator('body').click({ position: { x: 10, y: 10 } }); // ensure focus isn't in a text field
  await page.keyboard.press('b');
  await page.waitForTimeout(300);
  await expect(page.getByText('Interactive Segmentation Model')).not.toBeVisible();

  // Gear affordance opens the dialog.
  const gearBtn = page.getByRole('button', { name: 'Configure Interactive Segmentation model' });
  await expect(gearBtn).toBeVisible({ timeout: 10000 });
  await gearBtn.click();
  await expect(page.getByText('Interactive Segmentation Model')).toBeVisible({ timeout: 10000 });

  await page.screenshot({ path: `${OUT}/1-dialog-open.png` });

  expect(pageErrors).toEqual([]);
});

test('dialog lists all 6 generalists grouped LM / EM, default is Large', async ({ page }) => {
  test.setTimeout(180000);
  const pageErrors: string[] = [];
  page.on('pageerror', (e) => pageErrors.push(e.message));

  await loginAndOpenAnnotate(page);

  const gearBtn = page.getByRole('button', { name: 'Configure Interactive Segmentation model' });
  await gearBtn.click();
  await expect(page.getByText('Interactive Segmentation Model')).toBeVisible({ timeout: 10000 });

  await expect(page.getByText('μSAM: light microscopy')).toBeVisible();
  await expect(page.getByText('μSAM: EM organelles')).toBeVisible();

  // 6 model rows total, one per MICRO_SAM_MODEL_OPTIONS entry.
  const dialog = page.locator('.MuiDialog-root').filter({ hasText: 'Interactive Segmentation Model' });
  await expect(dialog.getByText('Tiny')).toHaveCount(2); // one per group
  await expect(dialog.getByText('Base')).toHaveCount(2);
  await expect(dialog.getByText('Large (default)')).toHaveCount(1);
  await expect(dialog.getByText('Large')).toHaveCount(2); // "Large (default)" + the EM "Large" row

  // Selecting a model updates the persisted preference without any spinner
  // or blocking network wait — the dialog closes cleanly on Done right after.
  const tinyRow = dialog.getByText('Tiny').first();
  await tinyRow.click();
  await page.waitForTimeout(300);

  await page.getByRole('button', { name: 'Done' }).click();
  await expect(page.getByText('Interactive Segmentation Model')).not.toBeVisible();

  expect(pageErrors).toEqual([]);
});

test('Full Image Segmentation dialog shows Recompute embedding for μSAM', async ({ page }) => {
  test.setTimeout(180000);
  const pageErrors: string[] = [];
  page.on('pageerror', (e) => pageErrors.push(e.message));

  await loginAndOpenAnnotate(page);

  await page.getByRole('button', { name: 'Full Image Segmentation' }).click();
  await expect(page.getByRole('heading', { name: 'Full Image Segmentation' })).toBeVisible({ timeout: 10000 });

  const recomputeBtn = page.getByRole('button', { name: /Recompute embedding/ });
  await expect(recomputeBtn).toBeVisible({ timeout: 10000 });

  await page.screenshot({ path: `${OUT}/2-cellpose-config-recompute.png` });

  expect(pageErrors).toEqual([]);
});
