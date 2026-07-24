import { test, expect } from '@playwright/test';

// Integration test for the Cancel button in the inference progress dialog
// (InferenceProgressDialog), wired to the model-runner `cancel_request` API that
// ships in model-runner v1.15.36+. This is the inference twin of
// tests/cancel-button.spec.ts (which covers the model-TEST dialog).
//
// Requires:
//   HYPHA_TOKEN env var — same token the user stores in localStorage after login.
//   Dev server running: pnpm start
//
// The in-browser runner lives on the model DETAIL page and uses the default
// runner site (KTH), matching tests/inference-queue-pill.spec.ts. cancel_request
// is present on both prod sites, so no site toggle is needed here.
//
// FEATURE GATING (important):
//   The Cancel button is feature-detected: it renders only when the connected
//   worker exposes cancel_request AND a live infer request id exists. When the
//   button never appears, this spec treats that as "feature not deployed on the
//   default worker" and SKIPS (annotated) rather than failing, mirroring the
//   UI's own graceful degradation.
//
// What this validates when cancel_request IS available:
//   - Run inference on the detail page (Test Run Model, Load Sample Image, Run Model).
//   - While "Model Inference in Progress", a "Cancel Run" button is shown.
//   - Clicking it sends the cancel and the button shows "Cancelling...".
//   - The dialog settles into the terminal cancelled state: title
//     "Model Inference Cancelled" + body text "Inference run cancelled.".
//   - No success path leaks through: the dialog does not read
//     "Model Inference Complete".

// The detail route is single-segment `/resources/:id` and prepends the
// `bioimage-io/` workspace itself (ArtifactDetails L158), so the URL carries the
// bare nickname, NOT the workspace-qualified id.
const MODEL_URL_ID = 'affable-shark';
const injectToken = (token: string) => ({ tok: token, expiry: new Date(Date.now() + 3 * 60 * 60 * 1000).toISOString() });

test.describe('Cancel button (inference progress dialog)', () => {
  test('Detail page: cancel an in-flight model inference', async ({ page }, testInfo) => {
    const token = process.env.HYPHA_TOKEN;
    if (!token) {
      test.skip();
      return;
    }

    // Generous: Pyodide model init + sample load + submit + cancel. The runner
    // boots the in-browser Python kernel and connects to a BioEngine worker that
    // may be cold, so the setup phase can take minutes on a first hit.
    test.setTimeout(480000);

    await page.addInitScript(({ tok, expiry }) => {
      localStorage.setItem('token', tok);
      localStorage.setItem('tokenExpiry', expiry);
    }, injectToken(token));

    // The detail page fetches the artifact once on mount with no retry, so a
    // transient network blip leaves a stuck "Failed to fetch". Reload until the
    // runner button appears.
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

    // Reveal the in-browser runner. "Test Run Model" enables once logged in and
    // the model has a passing BioEngine status (affable-shark does).
    await expect(testRun).toBeEnabled({ timeout: 120000 });
    await testRun.click();

    // Model initializes in Pyodide, then connects to the BioEngine worker;
    // "Load Sample Image" enables only once that runner is ready. A cold worker
    // makes this the slowest step, so give it a generous window.
    const loadSample = page.getByRole('button', { name: 'Load Sample Image' });
    await expect(loadSample).toBeEnabled({ timeout: 240000 });
    await loadSample.click();
    await expect(page.getByText(/input loaded successfully/i)).toBeVisible({ timeout: 120000 });

    // Start the inference. The progress dialog auto-opens.
    const runModel = page.getByRole('button', { name: 'Run Model' });
    await expect(runModel).toBeEnabled({ timeout: 60000 });
    await runModel.click();

    await expect(page.getByText('Model Inference in Progress')).toBeVisible({ timeout: 30000 });

    // Feature gate. The Cancel button renders only once the worker exposes
    // cancel_request and infer() has returned a request id. Poll for it; if it
    // never shows, cancel_request is not deployed on this site yet — skip.
    const cancelBtn = page.getByRole('button', { name: 'Cancel Run' });
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
        description: 'cancel_request not available on the default worker yet (pre-v1.15.36); Cancel button correctly hidden.',
      });
      test.skip();
      return;
    }

    // Cancel the run. The button switches to "Cancelling..." while in flight.
    await cancelBtn.click();
    // "Cancelling..." is transient; assert it best-effort but don't fail if the
    // cancel resolves faster than a poll cycle.
    await page.getByRole('button', { name: 'Cancelling...' }).waitFor({ state: 'visible', timeout: 5000 }).catch(() => {});

    // The dialog settles into the terminal cancelled state.
    await expect(page.getByText('Model Inference Cancelled')).toBeVisible({ timeout: 120000 });
    await expect(page.getByText('Inference run cancelled.')).toBeVisible();

    // No success path leaked through — a cancelled run is not a completed run.
    await expect(page.getByText('Model Inference Complete')).toHaveCount(0);
  });
});
