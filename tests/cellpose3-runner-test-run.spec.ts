import { test, expect } from '@playwright/test';

// Verifies that Cellpose-3 models (which model-runner 2.0.0 refuses on infer,
// because its runtime ships Cellpose 4 and those architectures were dropped)
// still get a working "Test Run Model" button, routed to cellpose3-runner
// instead of model-runner.
//
// Flow: detail page -> "Test Run Model" enabled -> open Advanced Options ->
// the KTH/deNBI site toggle is absent (the cellpose3-runner service id is
// unqualified, so the cluster is picked by load, not by the user) and the
// Service ID field advertises cellpose3-runner -> "Load Sample Image" ->
// "Run Model" -> (RUN_GPU=1) inference completes successfully.
//
// Target: philosophical-panda, one of the five ids reported by
// cellpose3-runner.list_supported_models(). It runs CPU-only, ~1 min.
//
// Requires: HYPHA_TOKEN env var; dev server (pnpm start).

const MODEL_URL_ID = 'philosophical-panda';
const CELLPOSE3_SERVICE_ID = 'bioimage-io/cellpose3-runner';
const injectToken = (token: string) => ({ tok: token, expiry: new Date(Date.now() + 3 * 60 * 60 * 1000).toISOString() });

test.describe('Cellpose-3 runner routing', () => {
  test('Test Run Model works for a cellpose3-runner-supported model', async ({ page }) => {
    const token = process.env.HYPHA_TOKEN;
    if (!token) {
      test.skip();
      return;
    }
    test.setTimeout(600000);

    await page.addInitScript(({ tok, expiry }) => {
      localStorage.setItem('token', tok);
      localStorage.setItem('tokenExpiry', expiry);
    }, injectToken(token));

    const testRun = page.getByRole('button', { name: 'Test Run Model' });
    let loaded = false;
    for (let attempt = 0; attempt < 4 && !loaded; attempt++) {
      await page.goto(`/#/resources/${MODEL_URL_ID}`);
      try {
        await testRun.waitFor({ state: 'visible', timeout: 45000 });
        loaded = true;
      } catch {
        // Fetch likely failed on mount; reload and try again.
      }
    }
    expect(loaded, 'model detail page never resolved the artifact').toBe(true);

    await expect(testRun).toBeEnabled({ timeout: 60000 });
    await testRun.click();

    // ---- Routing assertions ----
    await page.getByRole('button', { name: 'Advanced Options' }).click();
    // The site toggle is hidden for these models: an unqualified service id
    // means the toggle could not steer anything, so showing it would mislead.
    await expect(page.getByRole('radio', { name: 'KTH' })).toHaveCount(0);
    await expect(page.getByRole('radio', { name: 'deNBI' })).toHaveCount(0);
    // The Service ID field advertises the runner the next init() will use.
    await expect(page.getByPlaceholder(CELLPOSE3_SERVICE_ID)).toBeVisible({ timeout: 30000 });
    await page.keyboard.press('Escape');

    // ---- Run flow ----
    const loadSample = page.getByRole('button', { name: 'Load Sample Image' });
    await expect(loadSample).toBeEnabled({ timeout: 240000 });
    await loadSample.click();
    await expect(page.getByText(/input loaded successfully/i)).toBeVisible({ timeout: 120000 });

    const runModel = page.getByRole('button', { name: 'Run Model' });
    await expect(runModel).toBeEnabled({ timeout: 60000 });

    const runGpu = process.env.RUN_GPU === '1';
    if (runGpu) {
      await runModel.click();
      await expect(page.getByText('Model Inference in Progress')).toBeVisible({ timeout: 30000 });
      await expect(page.getByText('Model execution completed successfully!')).toBeVisible({ timeout: 300000 });
    }
  });
});
