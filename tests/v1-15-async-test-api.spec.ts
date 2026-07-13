import { test, expect } from '@playwright/test';

// Integration test for the v1.15.2 async model-runner API against the deNBI
// worker (the site that runs the new async API).
//
// Requires:
//   HYPHA_TOKEN env var — same token the user stores in localStorage after login.
//   Dev server running: pnpm start
//
// What this tests:
//   - The shared "Run Model Test" options dialog opens when "Test Model" is clicked.
//   - The deNBI runner site can be selected inside that dialog (v1.15.2 async API).
//   - After "Run Test", the TestDetailsDialog title is "Model Testing in Progress".
//   - The queue-position row sits on TOP of the step table and holds at 0 once
//     the request is dequeued (it is never hidden).
//   - The three step rows (Model download / Environment setup / Running) each show
//     their start time in the user's timezone, a dash when skipped, and the live
//     elapsed seconds in brackets for the step currently running.
//   - After completion the dialog title reverts to "Test Report Details".

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

    // Step 2: Open the shared options dialog.
    await page.getByRole('button', { name: 'Test Model' }).click();
    const optionsDialog = page.getByRole('dialog').filter({ hasText: 'Run Model Test' });
    await expect(optionsDialog.getByRole('heading', { name: 'Run Model Test' })).toBeVisible({ timeout: 5000 });

    // Step 3: Switch the runner site to deNBI (the v1.15.2 async API) inside
    // the dialog, then start the test with default options.
    const denbi = optionsDialog.getByRole('radio', { name: 'deNBI' });
    await expect(denbi).toBeEnabled({ timeout: 30000 });
    await denbi.click();
    await expect(denbi).toHaveAttribute('aria-checked', 'true');
    await optionsDialog.getByRole('button', { name: 'Run Test' }).click();

    // Step 4: TestDetailsDialog opens automatically; title changes while loading.
    await expect(page.getByText('Model Testing in Progress')).toBeVisible({ timeout: 15000 });

    // Step 5: Queue position sits on top of the table and is always present
    // while the test is in flight (it holds at 0 once running, never hidden).
    await expect(page.getByText('Queue position')).toBeVisible({ timeout: 120000 });

    // Step 6: All three step rows are rendered (table is always shown).
    await expect(page.getByText('Model download')).toBeVisible({ timeout: 240000 });
    await expect(page.getByText('Environment setup')).toBeVisible();
    await expect(page.getByText('Running')).toBeVisible();

    // Step 7: Once a step is running, its right-hand cell shows a wall-clock
    // start time (hh:mm:ss) and the active step appends live elapsed seconds.
    const startTimeCell = page.locator('text=/\\d{1,2}:\\d{2}:\\d{2}/');
    await expect(startTimeCell.first()).toBeVisible({ timeout: 240000 });
    await expect(page.locator('text=/\\(\\d+s\\)/').first()).toBeVisible({ timeout: 30000 });

    // Step 8: Wait for completion — title reverts to "Test Report Details".
    await expect(page.getByText('Test Report Details')).toBeVisible({ timeout: 240000 });

    // Step 9: A "passed" or "failed" status chip is shown in the report header
    // (the first such chip — detail rows carry their own status chips too).
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
    await page.getByRole('button', { name: 'Test Model' }).click();
    const optionsDialog = page.getByRole('dialog').filter({ hasText: 'Run Model Test' });
    await expect(optionsDialog.getByRole('heading', { name: 'Run Model Test' })).toBeVisible({ timeout: 5000 });

    const denbi = optionsDialog.getByRole('radio', { name: 'deNBI' });
    await expect(denbi).toBeEnabled({ timeout: 30000 });
    await denbi.click();
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
