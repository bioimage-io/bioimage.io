import { test, expect } from '@playwright/test';
import fs from 'fs';
import { BASE_URL } from './baseUrl';

// Regression guard for issue #0025.
//
// The dataset overview's image rows were <button> elements, and the row for a
// finetune split also carries its own train/test/unused pill (another button)
// plus an upload control. A button inside a button is markup the browser is not
// allowed to build, so it silently reparses it into something the code never
// described: React says so via validateDOMNesting, and in practice the row and
// the pill can both answer the same click.
//
// The row is a div with role="button" now. This spec fails if anything puts a
// button back inside it, in either of the two states that render controls
// inside a row: the plain overview (upload affordance) and the finetune view
// (upload affordance + split pill).
//
// Requires: HYPHA_TOKEN (falls back to /data/nmechtel/bioengine/.env) and a dev
// server at E2E_BASE_URL.

test.use({ baseURL: BASE_URL });

const DATASET_ALIAS = 'annotation-mst3ebzz-o5px';

function readHyphaToken(): string | undefined {
  if (process.env.HYPHA_TOKEN) return process.env.HYPHA_TOKEN;
  try {
    return fs.readFileSync('/data/nmechtel/bioengine/.env', 'utf8').match(/HYPHA_TOKEN=(\S+)/)?.[1];
  } catch {
    return undefined;
  }
}

test('dataset image rows nest no buttons, in the overview and the finetune view', async ({ page }) => {
  const token = readHyphaToken();
  if (!token) {
    test.skip();
    return;
  }
  test.setTimeout(120000);

  await page.addInitScript(({ tok, expiry }) => {
    localStorage.setItem('token', tok);
    localStorage.setItem('tokenExpiry', expiry);
    localStorage.setItem('bioimage-annotation-tutorial-seen', '1');
  }, { tok: token, expiry: new Date(Date.now() + 3 * 60 * 60 * 1000).toISOString() });

  const nestingWarnings: string[] = [];
  page.on('console', (m) => {
    if (m.text().includes('validateDOMNesting')) nestingWarnings.push(m.text());
  });

  // React only emits the warning on the render that produces the bad tree, so
  // the DOM has to be checked as well for the case where the page was already
  // rendered before the listener attached.
  const nestedButtonCount = () =>
    page.locator('button button, [role="button"] button button').count();

  await page.goto(`/#/colab/${encodeURIComponent(DATASET_ALIAS)}`);
  const finetuneButton = page.getByRole('button', { name: 'Finetune' });
  await expect(finetuneButton).toBeVisible({ timeout: 60000 });
  expect(await nestedButtonCount()).toBe(0);

  // The finetune view is the state that adds the split pill to every row.
  // The button renders disabled until the dataset's labels have loaded, and a
  // forced click on a disabled button dispatches nothing at all, so waiting for
  // enabled is what makes the click land rather than silently no-op.
  await expect(finetuneButton).toBeEnabled({ timeout: 60000 });
  await finetuneButton.click({ force: true });
  await expect(page.getByRole('heading', { name: 'Choose a label' })).toBeVisible({ timeout: 30000 });
  await page.getByRole('button', { name: /^cells\b/ }).click();
  await expect(page.getByText(/^Unused \(\d+\)$/)).toBeVisible({ timeout: 30000 });

  expect(await nestedButtonCount()).toBe(0);

  // The row still answers a click and a keypress, which is what role="button"
  // plus an explicit key handler has to earn back from a real <button>.
  const row = page.locator('[role="button"]').filter({ has: page.locator('button') }).first();
  await expect(row).toBeVisible();
  await row.focus();
  expect(await row.evaluate((el) => el.getAttribute('tabindex'))).toBe('0');

  expect(nestingWarnings).toEqual([]);
});
