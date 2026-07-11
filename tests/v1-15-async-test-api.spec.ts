import { test, expect } from '@playwright/test';

// Integration test for the v1.15.0+ async model-runner API.
//
// Requires:
//   HYPHA_TOKEN env var — same token the user stores in localStorage after login.
//   Dev server running with: REACT_APP_MODEL_RUNNER_DEV=true pnpm start
//
// What this tests:
//   - The "Run Model Test" options dialog opens when "Test Model" is clicked.
//   - After clicking "Run Test", the TestDetailsDialog title is "Model Testing in
//     Progress" while the test is in-flight.
//   - The v1.15.0 step-duration timeline rows (Model download / Environment setup /
//     Running) appear once the runner dequeues the request — distinguishing the new
//     format from the v1.14.0 Chip-badge format.
//   - A queue position chip (#N) is rendered while queue_position > 0 and hidden
//     once the request is dequeued.
//   - After completion the dialog title reverts to "Test Report Details" and the
//     result (passed or failed) is shown.

const MODEL_ID = 'bioimage-io/affable-shark';
const MODEL_URL_ID = encodeURIComponent(MODEL_ID); // bioimage-io%2Faffable-shark

test.describe('v1.15.0 async model test API', () => {
  test('Edit page: async polling shows step-duration timeline and final result', async ({ page }) => {
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
    }, { tok: token, expiry: new Date(Date.now() + 3 * 60 * 60 * 1000).toISOString() });

    await page.goto(`/#/edit/${MODEL_URL_ID}`);

    // Step 1: artifact load — "Test Model" only appears once the artifact type
    // resolves to 'model' via a successful Hypha artifact-manager RPC call.
    await expect(page.getByRole('button', { name: 'Test Model' })).toBeVisible({ timeout: 60000 });

    // Step 2: Open the options dialog.
    await page.getByRole('button', { name: 'Test Model' }).click();
    await expect(page.getByRole('heading', { name: 'Run Model Test' })).toBeVisible({ timeout: 5000 });

    // Step 3: Start the test (default options: no custom env, no skip-cache).
    await page.getByRole('button', { name: 'Run Test' }).click();

    // Step 4: TestDetailsDialog opens automatically; title must change while loading.
    await expect(page.getByText('Model Testing in Progress')).toBeVisible({ timeout: 15000 });

    // Step 5: Watch for v1.15.0-specific progress indicators.
    //
    // Two possible initial states:
    //   a) Queued — queue position chip (#N) is shown.
    //   b) Dequeued immediately — step-duration rows appear straight away.
    //
    // We wait for whichever arrives first.
    const queueChip = page.locator('text=/^#\\d+$/');
    const stepRow = page.getByText('Model download');

    await expect(queueChip.or(stepRow)).toBeVisible({ timeout: 120000 });

    // If queued, wait for it to dequeue (queue chip disappears).
    if (await queueChip.isVisible()) {
      await expect(queueChip).toBeHidden({ timeout: 240000 });
    }

    // Step 6: Once dequeued, all three step-duration rows must be present.
    await expect(page.getByText('Model download')).toBeVisible({ timeout: 30000 });
    await expect(page.getByText('Environment setup')).toBeVisible({ timeout: 5000 });
    await expect(page.getByText('Running')).toBeVisible({ timeout: 5000 });

    // Sanity-check: at least one duration cell shows a mm:ss value or '—'.
    // The Running step is always non-null (it's the active step), so it shows live ticking.
    const durationCells = page.locator('text=/^\\d{2}:\\d{2}$|^—$/');
    await expect(durationCells.first()).toBeVisible({ timeout: 5000 });

    // Step 7: Wait for the test to complete — title reverts to "Test Report Details".
    await expect(page.getByText('Test Report Details')).toBeVisible({ timeout: 240000 });

    // Step 8: A "passed" or "failed" chip is now shown in the report header.
    await expect(
      page.getByText(/^passed$/).or(page.getByText(/^failed$/))
    ).toBeVisible({ timeout: 5000 });
  });

  test('Edit page: queue chip absent once dequeued', async ({ page }) => {
    const token = process.env.HYPHA_TOKEN;
    if (!token) {
      test.skip();
      return;
    }

    test.setTimeout(300000);

    await page.addInitScript(({ tok, expiry }) => {
      localStorage.setItem('token', tok);
      localStorage.setItem('tokenExpiry', expiry);
    }, { tok: token, expiry: new Date(Date.now() + 3 * 60 * 60 * 1000).toISOString() });

    await page.goto(`/#/edit/${MODEL_URL_ID}`);

    await expect(page.getByRole('button', { name: 'Test Model' })).toBeVisible({ timeout: 60000 });
    await page.getByRole('button', { name: 'Test Model' }).click();
    await expect(page.getByRole('heading', { name: 'Run Model Test' })).toBeVisible({ timeout: 5000 });
    await page.getByRole('button', { name: 'Run Test' }).click();

    await expect(page.getByText('Model Testing in Progress')).toBeVisible({ timeout: 15000 });

    // Once model-download row appears, queue position chip must be gone.
    await expect(page.getByText('Model download')).toBeVisible({ timeout: 120000 });
    await expect(page.locator('text=/^#\\d+$/')).toBeHidden();
  });
});
