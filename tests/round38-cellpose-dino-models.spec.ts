import { test, expect } from '@playwright/test';
import fs from 'fs';
import { BASE_URL } from './baseUrl';

// Round-38 acceptance (keen-puma):
//   1. The FIS backend/model select gets a 'Cellpose' group listing
//      Cellpose-SAM, CellposeDINO ViT-B, CellposeDINO ViT-L, mirroring the
//      uSAM grouping style.
//   2. Running a CellposeDINO model on the demo image adds masks.
//   3. No flow/cellprob/niter/diameter/two-pass controls for dino models
//      (they hide the same way the uSAM backend does).
//   4. The Cellpose-SAM path is unchanged.

test.use({ baseURL: BASE_URL });

const DATASET_ALIAS = 'annotation-mst3ebzz-o5px';
const OUT = '/tmp/round38-dino-verify';

function readHyphaToken(): string | undefined {
  if (process.env.HYPHA_TOKEN) return process.env.HYPHA_TOKEN;
  try {
    const envText = fs.readFileSync('/data/nmechtel/bioengine/.env', 'utf8');
    return envText.match(/HYPHA_TOKEN=(\S+)/)?.[1];
  } catch {
    return undefined;
  }
}

function injectAuth(page: import('@playwright/test').Page, token: string) {
  return page.addInitScript(({ tok, expiry }) => {
    localStorage.setItem('token', tok);
    localStorage.setItem('tokenExpiry', expiry);
    localStorage.setItem('bioimage-annotation-tutorial-seen', '1');
  }, { tok: token, expiry: new Date(Date.now() + 3 * 60 * 60 * 1000).toISOString() });
}

async function openAnnotator(page: import('@playwright/test').Page) {
  await page.goto(`/#/colab/annotate?session_id=${DATASET_ALIAS}&label=cells`);
  await expect(page.locator('canvas').first()).toBeVisible({ timeout: 90000 });
  await expect(page.getByText('Annotation Tools')).toBeVisible({ timeout: 30000 });
  await page.waitForTimeout(3000);
  const expandToolbarBtn = page.getByRole('button', { name: 'Expand toolbar' });
  if (await expandToolbarBtn.isVisible({ timeout: 3000 }).catch(() => false)) {
    await expandToolbarBtn.click();
  }
}

async function clearExistingMasks(page: import('@playwright/test').Page) {
  const clearBtn = page.locator('[data-tool="clear"]').first();
  if (await clearBtn.isVisible({ timeout: 5000 }).catch(() => false)) {
    await clearBtn.click();
    const confirmClearBtn = page.getByRole('button', { name: 'Clear All', exact: true });
    if (await confirmClearBtn.isVisible({ timeout: 3000 }).catch(() => false)) {
      await confirmClearBtn.click();
    }
  }
}

test.describe('Round 38: CellposeDINO ViT-B/ViT-L in Full Image Segmentation', () => {
  test('both dino entries are listed and selectable; cellpose-only controls hide for dino; Cellpose-SAM path unchanged', async ({ page }) => {
    const token = readHyphaToken();
    test.skip(!token, 'requires HYPHA_TOKEN for a live annotate session');
    test.setTimeout(120000);
    fs.mkdirSync(OUT, { recursive: true });

    const pageErrors: string[] = [];
    page.on('pageerror', (e) => pageErrors.push(e.message));

    await injectAuth(page, token!);
    await openAnnotator(page);

    const openDialogButton = page.locator('[data-tool="cellpose"]').first();
    await expect(openDialogButton).toBeEnabled({ timeout: 60000 });
    const dialog = page.getByRole('dialog').filter({ hasText: 'Full Image Segmentation' });
    await openDialogButton.click();
    await expect(dialog).toBeVisible({ timeout: 15000 });

    const modelSelect = dialog.getByRole('combobox');

    // --- Item 1: both dino entries + Cellpose-SAM listed under the same group ---
    await modelSelect.click();
    const listbox = page.getByRole('listbox');
    await expect(listbox).toBeVisible({ timeout: 10000 });
    await expect(listbox.getByText('Cellpose', { exact: true })).toBeVisible();
    const cellposeSamOption = listbox.getByRole('option', { name: 'Cellpose-SAM', exact: true });
    const vitBOption = listbox.getByRole('option', { name: 'CellposeDINO ViT-B', exact: true });
    const vitLOption = listbox.getByRole('option', { name: 'CellposeDINO ViT-L', exact: true });
    await expect(cellposeSamOption).toBeVisible();
    await expect(vitBOption).toBeVisible();
    await expect(vitLOption).toBeVisible();
    // Selectable: not disabled (only disabled when cellposeAvailable === false).
    await expect(vitBOption).toBeEnabled();
    await expect(vitLOption).toBeEnabled();
    await page.screenshot({ path: `${OUT}/1-dino-options-listed.png` });

    // --- Item 3: select ViT-B, cellpose-only controls (Compute Flow Field
    // section, diameter, flow/cellprob thresholds) are hidden ---
    await vitBOption.click();
    await expect(modelSelect).toContainText('CellposeDINO ViT-B');
    await expect(dialog.getByText('CellposeDINO segments every object automatically.')).toBeVisible();
    await expect(dialog.getByText('Compute Flow Field')).not.toBeVisible();
    await expect(dialog.getByText('Flow Threshold')).not.toBeVisible();
    await expect(dialog.getByText('Cell Prob Threshold')).not.toBeVisible();
    await expect(dialog.getByText('Diameter', { exact: false })).not.toBeVisible();
    await expect(dialog.getByText('Min Mask Area')).toBeVisible();
    await expect(dialog.getByRole('button', { name: 'Run Segmentation', exact: true })).toBeVisible();
    await page.screenshot({ path: `${OUT}/2-dino-vitb-selected-controls-hidden.png` });

    // Also confirm ViT-L is independently selectable and renders the same way.
    await modelSelect.click();
    await expect(page.getByRole('listbox')).toBeVisible({ timeout: 10000 });
    await page.getByRole('option', { name: 'CellposeDINO ViT-L', exact: true }).click();
    await expect(modelSelect).toContainText('CellposeDINO ViT-L');
    await expect(dialog.getByText('CellposeDINO segments every object automatically.')).toBeVisible();
    await page.screenshot({ path: `${OUT}/3-dino-vitl-selected.png` });

    // --- Item 4: Cellpose-SAM path is unchanged (regression check) ---
    await modelSelect.click();
    await expect(page.getByRole('listbox')).toBeVisible({ timeout: 10000 });
    await page.getByRole('option', { name: 'Cellpose-SAM', exact: true }).click();
    await expect(modelSelect).toContainText('Cellpose-SAM');
    await expect(dialog.getByRole('button', { name: 'Compute Flow Field', exact: true })).toBeVisible();
    await expect(dialog.getByText('CellposeDINO segments every object automatically.')).not.toBeVisible();
    // No em dashes anywhere in the dialog copy (copy rules).
    const dialogText = await dialog.innerText();
    expect(dialogText.includes('—')).toBe(false);
    await page.screenshot({ path: `${OUT}/4-cellpose-sam-unchanged.png` });

    const cancelBtn = dialog.getByRole('button', { name: /^Cancel$/ });
    if (await cancelBtn.isVisible({ timeout: 3000 }).catch(() => false)) {
      await cancelBtn.click();
    }

    expect(pageErrors).toEqual([]);
  });

  test('running CellposeDINO ViT-B on the demo image adds masks', async ({ page }) => {
    const token = readHyphaToken();
    test.skip(!token, 'requires HYPHA_TOKEN for a live annotate session');
    // Ground truth (warm worker): passionate-bug (ViT-B) ~38s / 31 instances
    // on the demo image. A cold worker can take minutes of env_setup, so the
    // run assertion below gets a generous timeout matching the 6-minute
    // pollRunnerInfer budget.
    test.setTimeout(420000);
    fs.mkdirSync(OUT, { recursive: true });

    const pageErrors: string[] = [];
    page.on('pageerror', (e) => pageErrors.push(e.message));

    await injectAuth(page, token!);
    await openAnnotator(page);
    await clearExistingMasks(page);

    const openDialogButton = page.locator('[data-tool="cellpose"]').first();
    await expect(openDialogButton).toBeEnabled({ timeout: 60000 });
    const dialog = page.getByRole('dialog').filter({ hasText: 'Full Image Segmentation' });
    await openDialogButton.click();
    await expect(dialog).toBeVisible({ timeout: 15000 });

    const modelSelect = dialog.getByRole('combobox');
    await modelSelect.click();
    await expect(page.getByRole('listbox')).toBeVisible({ timeout: 10000 });
    await page.getByRole('option', { name: 'CellposeDINO ViT-B', exact: true }).click();
    await expect(modelSelect).toContainText('CellposeDINO ViT-B');

    const runBtn = dialog.getByRole('button', { name: 'Run Segmentation', exact: true });
    await expect(runBtn).toBeEnabled({ timeout: 10000 });
    await runBtn.click();

    // The round-37 existing-masks warning must gate dino runs too, but we
    // cleared masks above, so it should not appear here.
    const warning = page.getByTestId('overwrite-warning');
    await page.waitForTimeout(500);
    await expect(warning).not.toBeVisible();

    const resultBanner = page.getByText(/Added \d+ masks? from CellposeDINO|No masks detected by CellposeDINO/);
    await expect(resultBanner).toBeVisible({ timeout: 360000 });
    const bannerText = (await resultBanner.innerText()) ?? '';
    expect(bannerText.startsWith('Added')).toBe(true);
    await page.screenshot({ path: `${OUT}/5-dino-run-added-masks.png` });

    expect(pageErrors).toEqual([]);
  });
});
