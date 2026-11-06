import { test, expect } from '@playwright/test';
import { BASE_URL } from './baseUrl';

// Verifies the fix for #0259: a model declaring a FIXED input extent (`size: 256` as a plain
// integer on its space axes, rather than `{min, step}`) can be run from "Test Run Model".
//
// Before the fix, getMinShape/getStepShape read that integer as a min of 1 and a step of 1,
// which made ImgPadder a no-op, so the whole image went to the model untouched and it
// asserted `Input height (320) doesn't match model (256)`.
//
// Flow: detail page -> "Test Run Model" -> "Load Sample Image" -> "Run Model" ->
// (RUN_INFERENCE=1) inference completes and NO shape assertion appears.
//
// This spec is LIVE when RUN_INFERENCE=1: it runs real inference on a real BioEngine worker.
// It does NOT write a test report (the ModelRunner path has no put_file/commit call), so the
// only shared resource it consumes is GPU time for one run.
//
// Requires: HYPHA_TOKEN env var; a dev server (BASE_URL / E2E_BASE_URL).

// idealistic-eagle declares a fixed 256x256 input and ships a 512x512 sample image, so
// "Load Sample Image" alone puts an OVERSIZED tensor in front of a fixed-size model. That is
// the reported failure exactly, reachable from the UI with no hand-supplied image.
//
// The issue names playful-scorpion and passionate-rhino as well. Both are also fixed 256, but
// measured 2026-11-06 on the live artifacts, both have `sample_tensor: null` and
// `sample_inputs: null` and so ship NO sample image. "Load Sample Image" is therefore disabled
// for them and the UI cannot be driven this way at all, which is a separate gap from this fix:
// whatever reached the model in the original report did not come from a sample image, because
// there is none to load.
const FIXED_MODEL = 'idealistic-eagle'; // fixed 256x256, halo 16, 512x512 sample image
const FLEXIBLE_MODEL = 'affable-shark'; // min 64 step 16, the discrimination control

const injectToken = (token: string) => ({
  tok: token,
  expiry: new Date(Date.now() + 3 * 60 * 60 * 1000).toISOString(),
});

// The console lines runOneTensor and runTiles emit, which are how the tile geometry is
// observed from outside. Collected so a failure says what the model was actually handed.
const SHAPE_LOG = /Input tile shape|Padded tile shape|Output tile shape|Tiling forced|Input tensor shape|Number of tiles/;
// The failure this issue is about, in the words the worker reports it.
const SHAPE_ASSERTION = /doesn't match model|does not match model|Input height|Input width/i;

const runModelFlow = async (page: any, modelId: string) => {
  const logs: string[] = [];
  page.on('console', (msg: any) => {
    const text = msg.text();
    if (SHAPE_LOG.test(text) || SHAPE_ASSERTION.test(text)) {
      logs.push(text);
    }
  });

  const testRun = page.getByRole('button', { name: 'Test Run Model' });
  let loaded = false;
  for (let attempt = 0; attempt < 4 && !loaded; attempt++) {
    await page.goto(`/#/resources/${modelId}`);
    try {
      await testRun.waitFor({ state: 'visible', timeout: 45000 });
      loaded = true;
    } catch {
      // Fetch likely failed on mount; reload and try again.
    }
  }
  expect(loaded, `model detail page never resolved ${modelId}`).toBe(true);

  await expect(testRun).toBeEnabled({ timeout: 60000 });
  await testRun.click();

  const loadSample = page.getByRole('button', { name: 'Load Sample Image' });
  await expect(loadSample).toBeEnabled({ timeout: 240000 });
  await loadSample.click();
  await expect(page.getByText(/input loaded successfully/i)).toBeVisible({ timeout: 120000 });

  const runModel = page.getByRole('button', { name: 'Run Model' });
  await expect(runModel).toBeEnabled({ timeout: 60000 });

  if (process.env.RUN_INFERENCE !== '1') {
    return logs;
  }

  await runModel.click();
  await expect(page.getByText('Model Inference in Progress')).toBeVisible({ timeout: 60000 });
  await expect(page.getByText('Model execution completed successfully!')).toBeVisible({
    timeout: 600000,
  });
  return logs;
};

test.describe('fixed-input-size models can be test-run', () => {
  test.beforeEach(async ({ page }) => {
    const token = process.env.HYPHA_TOKEN;
    if (!token) {
      test.skip();
      return;
    }
    await page.addInitScript(({ tok, expiry }) => {
      localStorage.setItem('token', tok);
      localStorage.setItem('tokenExpiry', expiry);
    }, injectToken(token));
  });

  test(`${FIXED_MODEL} (fixed 256) runs without a shape assertion`, async ({ page }) => {
    test.setTimeout(900000);
    console.log(`[spec] base URL: ${BASE_URL}`);

    const logs = await runModelFlow(page, FIXED_MODEL);

    console.log(`[spec] ${FIXED_MODEL} shape log:\n` + logs.join('\n'));
    // The whole point of the issue: the run must not fail on input shape.
    const assertions = logs.filter((l) => SHAPE_ASSERTION.test(l));
    expect(assertions, `shape assertion seen: ${assertions.join(' | ')}`).toEqual([]);

    if (process.env.RUN_INFERENCE === '1') {
      // Every tensor actually handed to the model must be the extent the model declared.
      const padded = logs.filter((l) => /Padded tile shape/.test(l));
      expect(padded.length, 'no padded tile shapes were logged').toBeGreaterThan(0);
      padded.forEach((l) => expect(l).toMatch(/256,256$/));

      // NOTE on what this test does and does not cover. Measured 2026-11-06: the sample image
      // is 512x512 on disk, but it reaches runTiles already at 1,3,256,256, so the viewer
      // resizes it on the way in and "Tiling forced" is NOT logged. This test therefore
      // exercises the exactly-fits path end to end against a real worker; the oversize path
      // that forces tiling is covered by src/utils/modelRun.fixedInputSize.test.js instead.
      // Left as a log rather than an assertion so a future viewer change that stops resizing
      // is visible here rather than silently changing what this test means.
      const forced = logs.filter((l) => /Tiling forced/.test(l));
      console.log(`[spec] tiling forced: ${forced.length > 0 ? forced.join(' | ') : 'no'}`);
    }
  });

  test(`control: ${FLEXIBLE_MODEL} (flexible) still runs`, async ({ page }) => {
    test.setTimeout(900000);

    const logs = await runModelFlow(page, FLEXIBLE_MODEL);

    console.log(`[spec] ${FLEXIBLE_MODEL} shape log:\n` + logs.join('\n'));
    const assertions = logs.filter((l) => SHAPE_ASSERTION.test(l));
    expect(assertions, `shape assertion seen: ${assertions.join(' | ')}`).toEqual([]);
  });
});
