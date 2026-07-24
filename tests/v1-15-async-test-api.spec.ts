import { test, expect } from '@playwright/test';

// Integration test for the v1.15.2 async model-runner API against the deNBI
// worker (the site that runs the new async API).
//
// Requires:
//   HYPHA_TOKEN env var — same token the user stores in localStorage after login.
//   Dev server running: pnpm start
//
// What this tests:
//   - The deNBI runner site is selected in the Advanced Options popover (v1.15.2 async API).
//   - The shared "Run Model Test" options dialog opens when "Test Model" is clicked.
//   - After "Run Test", the TestDetailsDialog title is "Model Testing in Progress".
//   - The overall test start time sits on TOP. Per-step queue state is shown
//     inline in each step's right-hand cell as an amber "#N" pill while queued
//     (queue_position > 0), not as a separate always-on queue-position row.
//   - The three step rows (Preparing model / Environment setup / Running) show
//     each step's duration (mm:ss), a dash when skipped, and the live-ticking
//     duration for the step currently running.
//   - On completion the dialog stays on the timeline ("Model Test Complete")
//     with a "View Test Report" button; the report opens only when clicked.

const MODEL_ID = 'bioimage-io/affable-shark';
const MODEL_URL_ID = encodeURIComponent(MODEL_ID); // bioimage-io%2Faffable-shark

const injectToken = (token: string) => ({ tok: token, expiry: new Date(Date.now() + 3 * 60 * 60 * 1000).toISOString() });

test.describe('v1.15.2 async model test API (deNBI)', () => {
  test('Edit page: switch to deNBI, timeline shows start times and final result', async ({ page }) => {
    const token = process.env.HYPHA_TOKEN;
    if (!token) {
      test.skip();
      return;
    }

    // 5 minutes total: Hypha WS connect + artifact load + queue wait + test run
    test.setTimeout(300000);

    // Inject a valid Hypha token so the auto-login fires on page load.
    await page.addInitScript(({ tok, expiry }) => {
      localStorage.setItem('token', tok);
      localStorage.setItem('tokenExpiry', expiry);
    }, injectToken(token));

    await page.goto(`/#/edit/${MODEL_URL_ID}`);

    // Step 1: artifact load — "Test Model" only appears once the artifact type
    // resolves to 'model' via a successful Hypha artifact-manager RPC call.
    await expect(page.getByRole('button', { name: 'Test Model' })).toBeVisible({ timeout: 60000 });

    // Step 2: Switch the runner site to deNBI (the v1.15.2 async API) in the
    // Advanced Options popover — runner-site selection lives there, not in the
    // Run Model Test dialog.
    await page.getByRole('button', { name: 'Advanced Options' }).click();
    const denbi = page.getByRole('radio', { name: 'deNBI' });
    await expect(denbi).toBeEnabled({ timeout: 30000 });
    await denbi.click();
    await expect(denbi).toHaveAttribute('aria-checked', 'true');

    // Step 3: Open the shared options dialog and start the test with defaults.
    await page.getByRole('button', { name: 'Test Model' }).click();
    const optionsDialog = page.getByRole('dialog').filter({ hasText: 'Run Model Test' });
    await expect(optionsDialog.getByRole('heading', { name: 'Run Model Test' })).toBeVisible({ timeout: 5000 });
    await optionsDialog.getByRole('button', { name: 'Run Test' }).click();

    // Step 4: TestDetailsDialog opens automatically; title changes while loading.
    await expect(page.getByText('Model Testing in Progress')).toBeVisible({ timeout: 15000 });

    // Step 5: The overall test start time sits on top. (Per-step queue state now
    // renders as an inline "#N" pill only while a step is actually queued, so
    // there is no always-visible queue-position row to assert here; the #N pill
    // itself is covered by the dedicated queue-pill spec.)
    await expect(page.getByText('Test started')).toBeVisible({ timeout: 120000 });

    // Step 6: All three step rows are rendered (table is always shown).
    await expect(page.getByText('Preparing model')).toBeVisible({ timeout: 240000 });
    await expect(page.getByText('Environment setup')).toBeVisible();
    await expect(page.getByText('Running')).toBeVisible();

    // Step 7: The right-hand cell shows each step's duration (mm:ss).
    await expect(page.locator('text=/^\\d{2}:\\d{2}$/').first()).toBeVisible({ timeout: 240000 });

    // Step 8: On completion the dialog stays on the timeline (title "Model Test
    // Complete") and offers a "View Test Report" button — the report does NOT
    // auto-open, so the user can review the steps first.
    await expect(page.getByText('Model Test Complete')).toBeVisible({ timeout: 240000 });
    const viewReport = page.getByRole('button', { name: 'View Test Report' });
    await expect(viewReport).toBeVisible();
    await expect(page.getByText('Test Report Details')).toHaveCount(0);

    // Step 9: Only after clicking the button does the report open.
    await viewReport.click();
    await expect(page.getByText('Test Report Details')).toBeVisible({ timeout: 5000 });
    await expect(
      page.getByText(/^passed$/).or(page.getByText(/^failed$/)).first()
    ).toBeVisible({ timeout: 5000 });
  });

  test('Edit page: skipped step renders an em dash', async ({ page }) => {
    const token = process.env.HYPHA_TOKEN;
    if (!token) {
      test.skip();
      return;
    }

    test.setTimeout(300000);

    await page.addInitScript(({ tok, expiry }) => {
      localStorage.setItem('token', tok);
      localStorage.setItem('tokenExpiry', expiry);
    }, injectToken(token));

    await page.goto(`/#/edit/${MODEL_URL_ID}`);

    await expect(page.getByRole('button', { name: 'Test Model' })).toBeVisible({ timeout: 60000 });

    // Switch to deNBI in the Advanced Options popover first.
    await page.getByRole('button', { name: 'Advanced Options' }).click();
    const denbi = page.getByRole('radio', { name: 'deNBI' });
    await expect(denbi).toBeEnabled({ timeout: 30000 });
    await denbi.click();
    await expect(denbi).toHaveAttribute('aria-checked', 'true');

    await page.getByRole('button', { name: 'Test Model' }).click();
    const optionsDialog = page.getByRole('dialog').filter({ hasText: 'Run Model Test' });
    await expect(optionsDialog.getByRole('heading', { name: 'Run Model Test' })).toBeVisible({ timeout: 5000 });

    // Enable "Skip cache" (second checkbox) so the run actually downloads and
    // runs rather than returning instantly from cache — that gives the
    // in-progress timeline a stable window to observe. With no custom
    // environment, the Environment setup step is skipped and its start-time
    // cell must render an em dash once the Running step has started.
    await optionsDialog.locator('input[type="checkbox"]').nth(1).check();
    await optionsDialog.getByRole('button', { name: 'Run Test' }).click();

    await expect(page.getByText('Model Testing in Progress')).toBeVisible({ timeout: 15000 });
    // Once the Running step has a start time, Environment setup is skipped and
    // shows an em dash. Poll for it while the run is in its (real) running phase.
    await expect(page.getByText('Running')).toBeVisible({ timeout: 240000 });
    await expect(page.getByText('—').first()).toBeVisible({ timeout: 120000 });
  });
});
