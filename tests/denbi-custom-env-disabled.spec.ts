import { test, expect } from '@playwright/test';

// Verifies the deNBI clock-skew guard in the "Run Model Test" options dialog:
// when the deNBI runner site is selected, the "Custom environment" option is
// disabled (its conda env builds fail on deNBI's unfixable clock skew), while
// on the default KTH site it stays enabled.
//
// Requires: HYPHA_TOKEN env var; dev server (pnpm start).

const MODEL_ID = 'bioimage-io/affable-shark';
const MODEL_URL_ID = encodeURIComponent(MODEL_ID);
const injectToken = (token: string) => ({ tok: token, expiry: new Date(Date.now() + 3 * 60 * 60 * 1000).toISOString() });

test.describe('deNBI disables custom environment', () => {
  test('custom-env checkbox is disabled on deNBI, enabled on KTH', async ({ page }) => {
    const token = process.env.HYPHA_TOKEN;
    if (!token) {
      test.skip();
      return;
    }
    test.setTimeout(120000);

    await page.addInitScript(({ tok, expiry }) => {
      localStorage.setItem('token', tok);
      localStorage.setItem('tokenExpiry', expiry);
    }, injectToken(token));

    await page.goto(`/#/edit/${MODEL_URL_ID}`);
    await expect(page.getByRole('button', { name: 'Test Model' })).toBeVisible({ timeout: 60000 });

    // The custom-environment checkbox is the first checkbox in the dialog; skip
    // cache is the second. Target by its label text to stay robust.
    const openDialog = async () => {
      await page.getByRole('button', { name: 'Test Model' }).click();
      const dlg = page.getByRole('dialog').filter({ hasText: 'Run Model Test' });
      await expect(dlg.getByRole('heading', { name: 'Run Model Test' })).toBeVisible({ timeout: 5000 });
      return dlg;
    };

    // --- KTH (default): custom-env enabled ---
    let dlg = await openDialog();
    const kthCustomEnv = dlg.locator('input[type="checkbox"]').first();
    await expect(kthCustomEnv).toBeEnabled();
    await dlg.getByRole('button', { name: 'Cancel' }).click();

    // --- Switch to deNBI via Advanced Options ---
    await page.getByRole('button', { name: 'Advanced Options' }).click();
    const denbi = page.getByRole('radio', { name: 'deNBI' });
    await expect(denbi).toBeEnabled({ timeout: 30000 });
    await denbi.click();
    await expect(denbi).toHaveAttribute('aria-checked', 'true');
    // Close the popover so it does not overlap the dialog trigger.
    await page.keyboard.press('Escape');

    // --- deNBI: custom-env disabled + explanation visible ---
    dlg = await openDialog();
    const denbiCustomEnv = dlg.locator('input[type="checkbox"]').first();
    await expect(denbiCustomEnv).toBeDisabled();
    await expect(denbiCustomEnv).not.toBeChecked();
    await expect(dlg.getByText(/Not available on the deNBI site right now/)).toBeVisible();

    await page.screenshot({ path: 'outputs/pw/denbi-custom-env-disabled.png', fullPage: false });
  });
});
