import { test, expect } from '@playwright/test';
import fs from 'fs';
import { BASE_URL } from './baseUrl';

// Round-34b independent acceptance (keen-puma): the click-time preparation
// flow for Interactive Segmentation.
//   The gear button is gone; clicking the tool button opens the model dialog.
//   "Start annotating" is enabled immediately and shows a spinner while the
//   embedding + decoder are prepared ON CLICK (not on selection).
//   When preparation finishes the dialog closes and the tool is active.
//   B when ready activates directly without the dialog.
//   Recompute-embedding appears only on the SELECTED model row and only when
//   the embedding file exists (after an existence check with its own spinner).
//   Anonymous users get a surfaced error instead of an infinite spinner.

test.use({ baseURL: BASE_URL });

const DATASET_ALIAS = 'annotation-mst3ebzz-o5px';
const OUT = '/tmp/round34b-verify';

function injectAuth(page: import('@playwright/test').Page) {
  const envText = fs.readFileSync('/data/nmechtel/bioengine/.env', 'utf8');
  const token = envText.match(/HYPHA_TOKEN=(\S+)/)![1];
  return page.addInitScript(({ tok, expiry }) => {
    localStorage.setItem('token', tok);
    localStorage.setItem('tokenExpiry', expiry);
    localStorage.setItem('bioimage-annotation-tutorial-seen', '1');
  }, { tok: token, expiry: new Date(Date.now() + 3 * 60 * 60 * 1000).toISOString() });
}

async function openAnnotator(page: import('@playwright/test').Page) {
  await page.goto(`/#/colab/annotate?session_id=${DATASET_ALIAS}&label=cells`);
  await expect(page.locator('canvas').first()).toBeVisible({ timeout: 90000 });
  await expect(page.getByText('Annotation Tools')).toBeVisible({ timeout: 30000 });
  await page.waitForTimeout(3000);
  const expandToolbarBtn = page.getByRole('button', { name: 'Expand toolbar' });
  if (await expandToolbarBtn.isVisible({ timeout: 3000 }).catch(() => false)) {
    await expandToolbarBtn.click();
  }
  // Wait for the micro-sam service probe to succeed so the tool is enabled.
  await expect
    .poll(
      async () =>
        page
          .locator('[data-tool="sambox"]')
          .first()
          .isEnabled()
          .catch(() => false),
      { timeout: 60000 }
    )
    .toBe(true);
}

test('click-time preparation flow (authenticated)', async ({ page }) => {
  test.setTimeout(420000);
  fs.mkdirSync(OUT, { recursive: true });
  const pageErrors: string[] = [];
  const samLogs: string[] = [];
  const nestingWarnings: string[] = [];
  page.on('pageerror', (e) => pageErrors.push(e.message));
  page.on('console', (m) => {
    const t = m.text();
    if (t.includes('micro-sam') || t.includes('[AnnotatePage]')) samLogs.push(t);
    if (t.includes('validateDOMNesting')) nestingWarnings.push(t);
  });

  await injectAuth(page);
  await openAnnotator(page);

  // --- The gear button is gone ---
  expect(
    await page.getByLabel('Configure Interactive Segmentation model').count()
  ).toBe(0);

  // --- Clicking the tool button opens the dialog (not the tool) ---
  await page.locator('[data-tool="sambox"]').first().click();
  const dialog = page.getByRole('dialog').filter({ hasText: 'Interactive Segmentation Model' });
  await expect(dialog).toBeVisible({ timeout: 15000 });
  await page.screenshot({ path: `${OUT}/1-dialog-via-toolbtn.png` });

  // --- All 6 models in two groups, vit_l_lm default, copy rules hold ---
  await expect(dialog.getByText('μSAM: light microscopy')).toBeVisible();
  await expect(dialog.getByText('μSAM: EM organelles')).toBeVisible();
  await expect(dialog.getByText('Large (default)')).toBeVisible();
  const dialogText = await dialog.innerText();
  expect(dialogText.includes('—')).toBe(false); // no em dashes

  // --- Start annotating is enabled IMMEDIATELY (no pre-preparation gate),
  //     and the old ready-gate tooltip is gone from the DOM ---
  const startBtn = dialog.getByRole('button', { name: /Start annotating|Preparing/ });
  await expect(startBtn).toBeEnabled({ timeout: 15000 });
  expect(await page.getByText(/Waiting for the decoder/).count()).toBe(0);

  // --- Click starts preparation: spinner + "Preparing..." label on the
  //     button, dialog stays open until prep resolves ---
  await startBtn.click();
  // Prep is at minimum one broker round-trip; tolerate a fast finish by
  // accepting either the observed spinner or an already-closed dialog.
  const sawSpinner = await dialog
    .getByRole('button', { name: 'Preparing...' })
    .isVisible({ timeout: 5000 })
    .catch(() => false);
  const dialogClosedFast = !(await dialog.isVisible().catch(() => false));
  expect(sawSpinner || dialogClosedFast).toBe(true);
  if (sawSpinner) await page.screenshot({ path: `${OUT}/2-start-preparing.png` });

  // --- Preparation completes: dialog closes, tool active ---
  await expect(dialog).not.toBeVisible({ timeout: 300000 });

  // Recenter the image first: the initial view can leave it offset from the
  // canvas center, and a box outside the image extent decodes nothing.
  await page.keyboard.press('0');
  await page.waitForTimeout(600);

  const canvas = page.locator('canvas').first();
  const cbox = (await canvas.boundingBox())!;
  const cx = cbox.x + cbox.width / 2;
  const cy = cbox.y + cbox.height / 2;
  await page.mouse.move(cx - 45, cy - 45);
  await page.mouse.down();
  await page.mouse.move(cx + 45, cy + 45, { steps: 8 });
  await page.mouse.up();
  await expect
    .poll(() => samLogs.some((t) => /micro-sam (box )?added \d+ mask/i.test(t)), { timeout: 120000 })
    .toBe(true);
  await page.screenshot({ path: `${OUT}/3-box-mask.png` });

  // --- Ready now: B activates directly, no dialog ---
  await page.keyboard.press('m');
  await page.waitForTimeout(300);
  await page.keyboard.press('b');
  await page.waitForTimeout(1200);
  await expect(dialog).not.toBeVisible();
  await page.mouse.move(cx + 60, cy - 80);
  await page.mouse.down();
  await page.mouse.move(cx + 130, cy - 20, { steps: 8 });
  await page.mouse.up();
  await expect
    .poll(
      () => samLogs.filter((t) => /micro-sam (box )?added \d+ mask/i.test(t)).length,
      { timeout: 120000 }
    )
    .toBeGreaterThan(1);

  // --- Tool button click reopens the dialog even when ready ---
  await page.locator('[data-tool="sambox"]').first().click();
  await expect(dialog).toBeVisible({ timeout: 10000 });

  // --- Recompute: exactly one button, on the selected model's row, and only
  //     because that embedding exists. The existence check may briefly show
  //     its own spinner while the dataset index loads. ---
  await expect
    .poll(
      async () => dialog.getByRole('button', { name: /^Recompute embedding for/ }).count(),
      { timeout: 60000 }
    )
    .toBe(1);
  await expect(
    dialog.getByRole('button', { name: 'Recompute embedding for Large (default)' })
  ).toBeVisible();
  await page.screenshot({ path: `${OUT}/4-dialog-when-ready.png` });

  await dialog.getByRole('button', { name: 'Start annotating' }).click();
  await expect(dialog).not.toBeVisible({ timeout: 60000 });

  // The Recompute control is no longer nested inside the row button.
  expect(nestingWarnings).toEqual([]);
  expect(pageErrors).toEqual([]);
});

test('anonymous user gets a surfaced error, not an infinite spinner', async ({ page }) => {
  test.setTimeout(240000);
  fs.mkdirSync(OUT, { recursive: true });
  // Tutorial dismissed, but NO token: the hypha connection is anonymous and
  // the broker's annotator-gated endpoints reject during prep.
  await page.addInitScript(() => {
    localStorage.setItem('bioimage-annotation-tutorial-seen', '1');
  });

  await openAnnotator(page);

  await page.locator('[data-tool="sambox"]').first().click();
  const dialog = page.getByRole('dialog').filter({ hasText: 'Interactive Segmentation Model' });
  await expect(dialog).toBeVisible({ timeout: 15000 });

  const startBtn = dialog.getByRole('button', { name: /Start annotating|Preparing/ });
  await expect(startBtn).toBeEnabled({ timeout: 15000 });
  await startBtn.click();

  // The classified error message must surface in the dialog...
  await expect(
    dialog.getByText('Sign in with annotation access to prepare this image.')
  ).toBeVisible({ timeout: 120000 });
  await page.screenshot({ path: `${OUT}/5-anonymous-error.png` });

  // ...and the spinner must stop: button back to its idle label and enabled,
  // dialog still open for a retry after signing in.
  await expect(dialog.getByRole('button', { name: 'Start annotating' })).toBeEnabled();
  expect(await dialog.getByRole('button', { name: 'Preparing...' }).count()).toBe(0);
  await expect(dialog).toBeVisible();
});
