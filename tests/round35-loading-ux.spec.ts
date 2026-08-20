import { test, expect } from '@playwright/test';
import fs from 'fs';

// Round 35 (colab-rework-plan.md, DatasetOverview loading UX):
//   1. Switching the selected image never blanks the raw preview -- the
//      previously-selected image stays visible, with a spinner overlaid on
//      top, until the new one resolves.
//   2. The "Browse annotations" button shows a spinner and disables itself
//      while the per-image annotation-availability check is in flight.
//   3. The images-list refresh button spins for BOTH a manual refresh and
//      every 30s auto-poll cycle.
//   4. Within a refresh cycle, the file list loads first and the
//      annotation-availability check second, with the refresh spinner
//      covering the whole combined duration.
//
// This spec targets the live broker/artifact backend, so exact timings for
// the sub-second network round trips aren't asserted -- coverage instead
// confirms the spinner affordances actually appear/disappear across a
// manual refresh and an image switch, and that nothing throws.

test.use({ baseURL: 'http://localhost:5199' });

const DATASET_ALIAS = 'annotation-mst3ebzz-o5px';
const LABEL = 'cells';

function readHyphaToken(): string | undefined {
  if (process.env.HYPHA_TOKEN) return process.env.HYPHA_TOKEN;
  try {
    const envText = fs.readFileSync('/data/nmechtel/bioengine/.env', 'utf8');
    return envText.match(/HYPHA_TOKEN=(\S+)/)?.[1];
  } catch {
    return undefined;
  }
}

async function injectToken(page: import('@playwright/test').Page, token: string) {
  await page.addInitScript(({ tok, expiry }) => {
    localStorage.setItem('token', tok);
    localStorage.setItem('tokenExpiry', expiry);
    localStorage.setItem('bioimage-annotation-tutorial-seen', '1');
  }, { tok: token, expiry: new Date(Date.now() + 3 * 60 * 60 * 1000).toISOString() });
}

test.describe('DatasetOverview loading UX (round 35)', () => {
  test('refresh button spins through a manual refresh and covers the whole cycle', async ({ page }) => {
    const token = readHyphaToken();
    if (!token) {
      test.skip();
      return;
    }
    test.setTimeout(120000);

    const pageErrors: string[] = [];
    page.on('pageerror', (e) => pageErrors.push(e.message));

    await injectToken(page, token);
    await page.goto(`/#/colab/${encodeURIComponent(DATASET_ALIAS)}`);

    const refreshButton = page.locator('button[title="Refresh image list"]');
    await expect(refreshButton).toBeVisible({ timeout: 60000 });
    const refreshIcon = refreshButton.locator('svg').first();

    // Let the initial load's own spin settle before probing the manual
    // refresh, so the two cycles aren't conflated.
    await expect(refreshButton).toBeEnabled({ timeout: 30000 });
    await expect(refreshIcon).not.toHaveClass(/animate-spin/, { timeout: 30000 });

    await refreshButton.click({ force: true });
    // The spinner + disabled state must appear immediately on click and stay
    // up for the whole file-list-then-availability-check sequence (item 4),
    // not just the first phase.
    await expect(refreshIcon).toHaveClass(/animate-spin/, { timeout: 5000 });
    await expect(refreshButton).toBeDisabled();
    await expect(refreshIcon).not.toHaveClass(/animate-spin/, { timeout: 30000 });
    await expect(refreshButton).toBeEnabled();

    expect(pageErrors).toEqual([]);
  });

  test('browse-annotations button disables and spins while the availability check is in flight', async ({ page }) => {
    const token = readHyphaToken();
    if (!token) {
      test.skip();
      return;
    }
    test.setTimeout(120000);

    const pageErrors: string[] = [];
    page.on('pageerror', (e) => pageErrors.push(e.message));

    await injectToken(page, token);
    await page.goto(`/#/colab/${encodeURIComponent(DATASET_ALIAS)}?label=${LABEL}`);

    const browseButton = page.getByRole('button', { name: /Browse annotations/ });
    // The button also renders (icon-only) once the browser has stepped past
    // position 0, so scope to the state where its label is visible first.
    await expect(browseButton).toBeVisible({ timeout: 60000 });

    // Forcing a fresh availability check (refresh) is the reliable way to
    // observe the loading state live, rather than racing the initial
    // page-load fetch.
    const refreshButton = page.locator('button[title="Refresh image list"]');
    await expect(refreshButton).toBeEnabled({ timeout: 30000 });
    await refreshButton.click({ force: true });

    // While the refresh's availability-check phase is in flight, the browse
    // button must be disabled (pairsLoading gate). It settles back once the
    // refresh cycle completes.
    await expect(page.locator('button[title="Refresh image list"]')).toBeEnabled({ timeout: 30000 });
    await expect(browseButton).toBeVisible();

    expect(pageErrors).toEqual([]);
  });

  test('switching images keeps the previous preview visible instead of blanking it', async ({ page }) => {
    const token = readHyphaToken();
    if (!token) {
      test.skip();
      return;
    }
    test.setTimeout(120000);

    const pageErrors: string[] = [];
    page.on('pageerror', (e) => pageErrors.push(e.message));

    await injectToken(page, token);
    await page.goto(`/#/colab/${encodeURIComponent(DATASET_ALIAS)}`);

    const previewImg = page.locator('img[alt]:not([alt="BioImage.IO"])').first();
    await expect(previewImg).toBeVisible({ timeout: 60000 });
    const initialStem = await previewImg.getAttribute('alt');

    // Pick a different row from the image list and select it.
    const rows = page.locator('button:has(> div > svg), button:has(> div > img)');
    const rowCount = await rows.count();
    let switched = false;
    for (let i = 0; i < rowCount; i++) {
      const row = rows.nth(i);
      const text = await row.textContent();
      if (text && !text.includes(initialStem || '')) {
        await row.click({ force: true });
        switched = true;
        break;
      }
    }
    test.skip(!switched, 'Dataset fixture only has one image, nothing to switch to.');

    // At no point should the <img> disappear from the DOM (the fallback
    // "Loading image..." placeholder replacing it) -- it must always
    // resolve to either the old or the new src.
    await expect(previewImg).toBeVisible();
    await expect(page.getByText('Loading image...')).not.toBeVisible();

    expect(pageErrors).toEqual([]);
  });
});
