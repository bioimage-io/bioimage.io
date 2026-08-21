import { test, expect } from '@playwright/test';
import fs from 'fs';

// Round-37 acceptance (keen-puma):
//   1. Warn before Full Image Segmentation runs over existing masks. Clicking
//      Run Segmentation / Compute Flow Field / Re-run on Server with at least
//      one existing mask on the image shows a blocking inline warning (not a
//      nested MUI Dialog) offering Run Anyway / Cancel. No warning when the
//      image has zero masks.
//   2. The collapsed µSAM model-select value carries a short LM / EM marker
//      (e.g. "μSAM Large (LM)") so the choice is unambiguous even without the
//      open dropdown's subheaders.

test.use({ baseURL: process.env.DEV_BASE_URL || 'http://localhost:5301' });

const DATASET_ALIAS = 'annotation-mst3ebzz-o5px';
const OUT = '/tmp/round37-verify';

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

test.describe('Round 37: FIS existing-masks warning + LM/EM model marker', () => {
  test('warning gates Run only when masks exist; Cancel aborts; Run Anyway proceeds; model marker present', async ({ page }) => {
    const token = readHyphaToken();
    test.skip(!token, 'requires HYPHA_TOKEN for a live annotate session');
    test.setTimeout(300000);
    fs.mkdirSync(OUT, { recursive: true });

    const pageErrors: string[] = [];
    page.on('pageerror', (e) => pageErrors.push(e.message));

    await injectAuth(page, token!);
    await openAnnotator(page);

    // Start from a known-empty state: existing masks may already be on this
    // shared test image from prior spec runs. If there's nothing to clear the
    // confirm dialog never opens, so tolerate both cases.
    const clearBtn = page.locator('[data-tool="clear"]').first();
    if (await clearBtn.isVisible({ timeout: 5000 }).catch(() => false)) {
      await clearBtn.click();
      const confirmClearBtn = page.getByRole('button', { name: 'Clear All', exact: true });
      if (await confirmClearBtn.isVisible({ timeout: 3000 }).catch(() => false)) {
        await confirmClearBtn.click();
      }
    }

    const openDialogButton = page.locator('[data-tool="cellpose"]').first();
    await expect(openDialogButton).toBeEnabled({ timeout: 60000 });
    const dialog = page.getByRole('dialog').filter({ hasText: 'Full Image Segmentation' });
    const warning = page.getByTestId('overwrite-warning');
    const runBtn = dialog.getByRole('button', { name: 'Run Segmentation', exact: true });
    const resultBanner = page.getByText(/Added \d+ masks? from μSAM|No masks detected by μSAM/);

    // --- Item 2: collapsed value carries an LM/EM marker for a µSAM selection ---
    await openDialogButton.click();
    await expect(dialog).toBeVisible({ timeout: 15000 });
    const modelSelect = dialog.getByRole('combobox');
    const collapsedText = (await modelSelect.textContent()) ?? '';
    expect(collapsedText.includes('LM') || collapsedText.includes('EM')).toBe(true);
    // Copy rules: no em dashes anywhere in the dialog.
    const dialogText = await dialog.innerText();
    expect(dialogText.includes('—')).toBe(false);
    await page.screenshot({ path: `${OUT}/1-model-marker.png` });

    // --- Item 1a: clean image (zero masks) runs directly, no warning ---
    await expect(runBtn).toBeEnabled({ timeout: 10000 });
    await runBtn.click();
    await page.waitForTimeout(500);
    await expect(warning).not.toBeVisible();
    await expect(resultBanner).toBeVisible({ timeout: 120000 });
    await page.screenshot({ path: `${OUT}/2-clean-run-no-warning.png` });

    // Guarantee at least one existing (non-preview) mask regardless of
    // whether µSAM found anything above, via a manual brush stroke.
    if (await dialog.isVisible().catch(() => false)) {
      const doneOrCancel = dialog.getByRole('button', { name: /^(Done|Cancel)$/ });
      if (await doneOrCancel.isVisible({ timeout: 3000 }).catch(() => false)) {
        await doneOrCancel.click();
      }
    }
    await expect(dialog).not.toBeVisible({ timeout: 10000 });
    const canvas = page.locator('canvas').first();
    const cbox = (await canvas.boundingBox())!;
    const cx = cbox.x + cbox.width / 2;
    const cy = cbox.y + cbox.height / 2;
    await page.locator('[data-tool="polygon"]').first().click();
    await expect(page.getByLabel('Increase brush radius')).toBeVisible({ timeout: 10000 });
    await page.mouse.move(cx - 200, cy - 150);
    await page.mouse.down();
    await page.mouse.move(cx - 140, cy - 150, { steps: 8 });
    await page.mouse.up();
    await page.waitForTimeout(500);
    await page.screenshot({ path: `${OUT}/3-manual-mask-drawn.png` });

    // --- Item 1b: reopen with an existing mask, warning appears, Cancel aborts ---
    await openDialogButton.click();
    await expect(dialog).toBeVisible({ timeout: 15000 });
    await expect(runBtn).toBeEnabled({ timeout: 10000 });
    await runBtn.click();
    await expect(warning).toBeVisible({ timeout: 5000 });
    await expect(warning).toContainText('already has masks');
    const warningText = (await warning.innerText()) ?? '';
    expect(warningText.includes('—')).toBe(false);
    expect(warningText.includes(';')).toBe(false);
    await page.screenshot({ path: `${OUT}/4-warning-shown.png` });

    await page.getByTestId('warning-cancel-button').click();
    await expect(warning).not.toBeVisible();
    // Cancel must not have triggered a run: dialog stays open on the form.
    await expect(dialog).toBeVisible();
    await expect(runBtn).toBeVisible();

    // --- Item 1c: Run Anyway proceeds with the run ---
    await runBtn.click();
    await expect(warning).toBeVisible({ timeout: 5000 });
    await page.getByTestId('run-anyway-button').click();
    await expect(warning).not.toBeVisible();
    await expect(resultBanner).toBeVisible({ timeout: 120000 });
    await page.screenshot({ path: `${OUT}/5-run-anyway.png` });

    expect(pageErrors).toEqual([]);
  });
});
