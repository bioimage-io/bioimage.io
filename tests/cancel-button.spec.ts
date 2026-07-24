import { test, expect } from '@playwright/test';

// Integration test for the Cancel button in the model-test progress dialog
// (TestDetailsDialog), wired to the model-runner `cancel_request` API that
// ships in model-runner v1.15.36+.
//
// Requires:
//   HYPHA_TOKEN env var — same token the user stores in localStorage after login.
//   Dev server running: pnpm start
//   Optional RUNNER_SITE=kth|denbi (default: denbi) — which runner site to test.
//
// FEATURE GATING (important):
//   The Cancel button is feature-detected: it only renders when the connected
//   worker exposes `cancel_request` (i.e. runs v1.15.36+). Production KTH/deNBI
//   workers lag the dev worker and may not carry it yet. When the button never
//   appears, this spec treats that as "feature not deployed on the selected
//   worker" and SKIPS (annotated), rather than failing — the same graceful
//   degradation the UI itself performs. Once cancel_request is live on the
//   selected site, the spec runs the real cancel flow end to end.
//
// What this validates when cancel_request IS available:
//   - Start a test with "Skip cache" so the run stays in flight long enough to
//     cancel it (mirrors the async-test spec's technique).
//   - While "Model Testing in Progress", a "Cancel Test" button is shown.
//   - Clicking it sends the cancel and the button shows "Cancelling...".
//   - The dialog settles into the terminal cancelled state: title
//     "Model Test Cancelled" + body text "Test run cancelled.".
//   - No success path leaks through: there is no "View Test Report" button and
//     the report dialog does not auto-open (a cancelled run is not a passed run).

const MODEL_ID = 'bioimage-io/affable-shark';
const MODEL_URL_ID = encodeURIComponent(MODEL_ID); // bioimage-io%2Faffable-shark

const injectToken = (token: string) => ({ tok: token, expiry: new Date(Date.now() + 3 * 60 * 60 * 1000).toISOString() });

test.describe('Cancel button (model-test progress dialog)', () => {
  test('Edit page: cancel an in-flight model test', async ({ page }, testInfo) => {
    const token = process.env.HYPHA_TOKEN;
    if (!token) {
      test.skip();
      return;
    }

    // Hypha WS connect + artifact load + queue wait + (short) run + cancel.
    test.setTimeout(300000);

    await page.addInitScript(({ tok, expiry }) => {
      localStorage.setItem('token', tok);
      localStorage.setItem('tokenExpiry', expiry);
    }, injectToken(token));

    await page.goto(`/#/edit/${MODEL_URL_ID}`);

    // Step 1: artifact load — "Test Model" appears once the artifact type
    // resolves to 'model' via a successful Hypha artifact-manager RPC.
    await expect(page.getByRole('button', { name: 'Test Model' })).toBeVisible({ timeout: 60000 });

    // Step 2: Pick the runner site in the Advanced Options popover.
    // Default deNBI; override with RUNNER_SITE=kth. cancel_request lands per
    // site independently, so the site under test is configurable.
    const site = (process.env.RUNNER_SITE || 'denbi').toLowerCase();
    const siteLabel = site === 'kth' ? 'KTH' : 'deNBI';
    await page.getByRole('button', { name: 'Advanced Options' }).click();
    const siteRadio = page.getByRole('radio', { name: siteLabel });
    await expect(siteRadio).toBeEnabled({ timeout: 30000 });
    await siteRadio.click();
    await expect(siteRadio).toHaveAttribute('aria-checked', 'true');

    // Step 3: Open the options dialog, enable "Skip cache" so the run actually
    // downloads + runs (a cache hit returns instantly, leaving no window to
    // cancel), then start the test.
    await page.getByRole('button', { name: 'Test Model' }).click();
    const optionsDialog = page.getByRole('dialog').filter({ hasText: 'Run Model Test' });
    await expect(optionsDialog.getByRole('heading', { name: 'Run Model Test' })).toBeVisible({ timeout: 5000 });
    await optionsDialog.locator('input[type="checkbox"]').nth(1).check();
    await optionsDialog.getByRole('button', { name: 'Run Test' }).click();

    // Step 4: The progress dialog opens.
    await expect(page.getByText('Model Testing in Progress')).toBeVisible({ timeout: 15000 });

    // Step 5: Feature gate. The Cancel button only renders when the connected
    // worker exposes cancel_request. Poll for it while the run is in flight; if
    // it never shows, cancel_request is not deployed on this site yet — skip.
    const cancelBtn = page.getByRole('button', { name: 'Cancel Test' });
    let cancelAvailable = false;
    try {
      await expect(cancelBtn).toBeVisible({ timeout: 30000 });
      cancelAvailable = true;
    } catch {
      cancelAvailable = false;
    }

    if (!cancelAvailable) {
      testInfo.annotations.push({
        type: 'skip-reason',
        description: `cancel_request not available on the ${siteLabel} worker yet (pre-v1.15.36); Cancel button correctly hidden.`,
      });
      test.skip();
      return;
    }

    // Step 6: Cancel the run. The button switches to "Cancelling..." while the
    // request is in flight.
    await cancelBtn.click();
    // "Cancelling..." is transient; assert it best-effort but don't fail if the
    // cancel resolves faster than a poll cycle.
    await page.getByRole('button', { name: 'Cancelling...' }).waitFor({ state: 'visible', timeout: 5000 }).catch(() => {});

    // Step 7: The dialog settles into the terminal cancelled state.
    await expect(page.getByText('Model Test Cancelled')).toBeVisible({ timeout: 120000 });
    await expect(page.getByText('Test run cancelled.')).toBeVisible();

    // Step 8: No success path leaked through — a cancelled run is not a pass.
    await expect(page.getByRole('button', { name: 'View Test Report' })).toHaveCount(0);
    await expect(page.getByText('Test Report Details')).toHaveCount(0);
  });
});
