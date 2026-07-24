import { test, expect } from '@playwright/test';
import { spawn, ChildProcess } from 'child_process';
import path from 'path';

// Visual verification of the amber "#N" queue-position pill in the INFERENCE
// progress dialog (InferenceProgressDialog), the twin of the model-test dialog.
// Both share StepTimeline, so this asserts the same pill renders on the "Running"
// step of a real inference run while it waits for a GPU slot.
//
// Flow (mirrors a real user on the model detail page):
//   detail page -> "Test Run Model" reveals the in-browser runner -> the model
//   initializes in Pyodide -> "Load Sample Image" -> "Run Model". A Python filler
//   (tests/queue-fill.py) holds the shared run queue backed up so the browser's
//   infer job lands at run.queue_position > 0 and the #N pill shows.
//
// The heavy Pyodide setup runs FIRST; the filler starts only just before "Run
// Model" so the queue is fresh (not drained during the ~1-3 min model init).
//
// PRECONDITION: the cache.py download-marker race fix must be deployed.
// Requires: HYPHA_TOKEN env var; dev server (pnpm start).

// The detail route is single-segment `/resources/:id` and prepends the
// `bioimage-io/` workspace itself (ArtifactDetails L158), so the URL carries the
// bare nickname, NOT the workspace-qualified id.
const MODEL_URL_ID = 'affable-shark';
const injectToken = (token: string) => ({ tok: token, expiry: new Date(Date.now() + 3 * 60 * 60 * 1000).toISOString() });

test.describe('inference #N pill', () => {
  let filler: ChildProcess | undefined;

  test.afterEach(() => {
    if (filler && !filler.killed) filler.kill('SIGKILL');
  });

  test('inference run step shows an amber #N pill while queued', async ({ page }) => {
    const token = process.env.HYPHA_TOKEN;
    if (!token) {
      test.skip();
      return;
    }
    // Generous: Pyodide model init + sample load + queue wait + inference.
    test.setTimeout(480000);

    await page.addInitScript(({ tok, expiry }) => {
      localStorage.setItem('token', tok);
      localStorage.setItem('tokenExpiry', expiry);
    }, injectToken(token));

    // The in-browser runner lives on the model DETAIL page. The detail page
    // fetches the artifact once on mount with no retry, so a transient network
    // blip leaves a stuck "Failed to fetch" error — reload until the artifact
    // resolves and the runner button appears.
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

    // Reveal the runner. "Test Run Model" is enabled once the model is logged-in
    // and has a passing BioEngine status (affable-shark does).
    await expect(testRun).toBeEnabled({ timeout: 120000 });
    await testRun.click();

    // Model initializes in Pyodide; "Load Sample Image" enables when ready. KTH
    // is the runner default here, matching the filler's target so they share one
    // run queue.
    const loadSample = page.getByRole('button', { name: 'Load Sample Image' });
    await expect(loadSample).toBeEnabled({ timeout: 240000 });
    await loadSample.click();
    // Wait until the sample is actually in the viewer before running.
    await expect(page.getByText(/input loaded successfully/i)).toBeVisible({ timeout: 120000 });

    const runModel = page.getByRole('button', { name: 'Run Model' });
    await expect(runModel).toBeEnabled({ timeout: 60000 });

    // Now that setup is done, start queue pressure so the run queue is backed up
    // the moment this job reaches the run step. Fixed in-flight pool of 8
    // (poll-to-completion) keeps ~2 running + ~6 queued, under Ray's admission
    // ceiling.
    filler = spawn('python3', [path.join(__dirname, 'queue-fill.py')], {
      env: { ...process.env, FILL_SECONDS: '240', FILL_POOL: '8' },
      stdio: 'inherit',
    });
    await new Promise(r => setTimeout(r, 15000));

    await runModel.click();

    // The inference progress dialog auto-opens.
    await expect(page.getByText('Model Inference in Progress')).toBeVisible({ timeout: 30000 });

    // The infer timeline has only "Preparing model" and "Running" (no env setup),
    // so the queued job's #N pill lands on the Running row. Target the last #N
    // chip so the tooltip we hover is unambiguously the GPU-slot one.
    const pill = page.locator('.MuiChip-root').filter({ hasText: /^#\d+$/ }).last();
    await expect(pill).toBeVisible({ timeout: 240000 });

    await page.screenshot({ path: 'outputs/pw/inference-queue-pill.png', fullPage: false });

    const label = (await pill.textContent())?.trim() ?? '';
    expect(label).toMatch(/^#[1-9]\d*$/);

    // Hover reveals the stage-aware tooltip: the run queue waits for a GPU slot.
    await pill.hover();
    await expect(page.getByText(/Queue position \d+:.*GPU slot/)).toBeVisible({ timeout: 5000 });

    // The pill reads as WAITING (an MUI Chip), not a live elapsed timer.
    await expect(pill).toHaveClass(/MuiChip-root/);
  });
});
