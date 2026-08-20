import { test, expect } from '@playwright/test';
import fs from 'fs';

// Round 34: Interactive Segmentation model-selection dialog. Coverage is
// deliberately read-only (open dialog, assert content, close) — clicking a
// model row now triggers a real decoder download + embedding compute (round
// 34 rework), and clicking "Recompute embedding" would call the real broker
// remove_embedding RPC and mutate the shared dataset's cached embeddings, so
// both paths are left for a live end-to-end pass rather than exercised here.

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

test('B opens the dialog on fresh load (not ready); gear opens it too', async ({ page }) => {
  test.setTimeout(180000);
  fs.mkdirSync(OUT, { recursive: true });
  const pageErrors: string[] = [];
  page.on('pageerror', (e) => pageErrors.push(e.message));

  await loginAndOpenAnnotate(page);

  // Round 34 rework: nothing downloads or encodes until the model dialog
  // opens, so a fresh page load is never ready for any model. Press B before
  // ever touching the gear icon, so nothing has started preparing yet: B
  // must open the dialog instead of activating the tool.
  await page.locator('body').click({ position: { x: 10, y: 10 } }); // ensure focus isn't in a text field
  await page.keyboard.press('b');
  await expect(page.getByText('Interactive Segmentation Model')).toBeVisible({ timeout: 10000 });
  await page.screenshot({ path: `${OUT}/1-dialog-open-via-shortcut-not-ready.png` });

  // Click a corner of the dialog's centering container, outside the paper:
  // that's what MUI actually wires its outside-click close handler to, not
  // the backdrop element itself (which sits behind the container in z-order).
  await page.locator('.MuiDialog-container').click({ position: { x: 10, y: 10 } });
  await expect(page.getByText('Interactive Segmentation Model')).not.toBeVisible();

  // The gear icon opens the same dialog.
  const gearBtn = page.getByRole('button', { name: 'Configure Interactive Segmentation model' });
  await expect(gearBtn).toBeVisible({ timeout: 10000 });
  await gearBtn.click();
  await expect(page.getByText('Interactive Segmentation Model')).toBeVisible({ timeout: 10000 });
  await page.screenshot({ path: `${OUT}/2-dialog-open-via-gear.png` });

  await page.locator('.MuiDialog-container').click({ position: { x: 10, y: 10 } });
  await expect(page.getByText('Interactive Segmentation Model')).not.toBeVisible();

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

  // 6 model rows total, one per MICRO_SAM_MODEL_OPTIONS entry. Rows are not
  // clicked here: selecting a model now triggers a real decoder download and
  // embedding compute (round 34 rework), which belongs in a live e2e pass.
  const dialog = page.locator('.MuiDialog-root').filter({ hasText: 'Interactive Segmentation Model' });
  await expect(dialog.getByText('Tiny')).toHaveCount(2); // one per group
  await expect(dialog.getByText('Base')).toHaveCount(2);
  await expect(dialog.getByText('Large (default)')).toHaveCount(1);
  await expect(dialog.getByText('Large')).toHaveCount(2); // "Large (default)" + the EM "Large" row

  // "Start annotating" replaces the old "Done" button and stays disabled
  // until the selected model's decoder and this image's embedding are both
  // ready. Round 34 rework: preparation only starts once this dialog opens,
  // so on this fresh page load neither has had a chance to finish yet, and
  // the button is reliably still disabled right after the dialog appears.
  const startBtn = page.getByRole('button', { name: 'Start annotating' });
  await expect(startBtn).toBeVisible();
  await expect(startBtn).toBeDisabled();

  // Click a corner of the dialog's centering container, outside the paper:
  // that's what MUI actually wires its outside-click close handler to, not
  // the backdrop element itself (which sits behind the container in z-order).
  await page.locator('.MuiDialog-container').click({ position: { x: 10, y: 10 } });
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
