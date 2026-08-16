import { test, expect } from '@playwright/test';

// Verifies that Cellpose-4 models (which model-runner can never run, and so
// never get a passing bioengineStatus test-report) still get a working
// "Test Run Model" button, routed to the KTH-only cellpose4-runner instead of
// model-runner, with the KTH/deNBI toggle locked to KTH.
//
// Flow: detail page -> "Test Run Model" enabled despite no bioengineStatus ->
// open Advanced Options -> deNBI disabled / KTH selected -> "Load Sample
// Image" -> "Run Model" -> (RUN_GPU=1) inference completes successfully.
//
// Target: idealistic-eagle (Cellpose-SAM), currently the only model reported
// by cellpose4-runner.list_supported_models() on KTH.
//
// Requires: HYPHA_TOKEN env var; dev server (pnpm start).

const MODEL_URL_ID = 'idealistic-eagle';
const injectToken = (token: string) => ({ tok: token, expiry: new Date(Date.now() + 3 * 60 * 60 * 1000).toISOString() });

test.describe('Cellpose-4 runner routing', () => {
  test('Test Run Model works for a cellpose4-runner-supported model, KTH locked', async ({ page }) => {
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

    // The decisive routing assertion: enabled despite this model never
    // passing (or even being scored by) the model-runner-based bioengineStatus
    // check, because cellpose4-runner support overrides that gate.
    await expect(testRun).toBeEnabled({ timeout: 60000 });
    await testRun.click();

    // ---- KTH/deNBI lock assertion ----
    await page.getByRole('button', { name: 'Advanced Options' }).click();
    const kth = page.getByRole('radio', { name: 'KTH' });
    const denbi = page.getByRole('radio', { name: 'deNBI' });
    await expect(kth).toHaveAttribute('aria-checked', 'true', { timeout: 30000 });
    await expect(denbi).toBeDisabled();
    await expect(denbi).toHaveAttribute(
      'title',
      /Cellpose-4 models .* only run on the KTH cluster/
    );
    await page.screenshot({ path: 'outputs/pw/cellpose4-kth-locked.png', fullPage: false });
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
      await page.screenshot({ path: 'outputs/pw/cellpose4-run-complete.png', fullPage: false });
    }
  });
});
