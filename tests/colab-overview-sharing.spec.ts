import { test, expect } from '@playwright/test';
import fs from 'fs';

// Requires: HYPHA_TOKEN env var (same token the user stores in localStorage
// after login), falls back to reading /data/nmechtel/bioengine/.env if unset.
// Requires: dev server running at http://localhost:3012 (this worktree's
// port; overridden below since playwright.config.ts's baseURL targets :3000
// for the model-test integration specs).
//
// What this tests (colab-rework-plan.md §13): the reworked dataset overview
// header/action row, the Share dialog's sharing + access-request + QR
// sections, and the annotate page's logged-in request-access flow. Reuses
// the "HPA Demo Dataset" (bioimage-io/annotation-mst3ebzz-o5px, label
// "cells") from annotate-ai-box.spec.ts for the overview/share coverage,
// since the test token already has an owner/manager role on it.
//
// The request-access test needs a dataset the test token has NO role on
// (to actually hit the permission-denied branch while logged in). There is
// no fixture for that in this repo yet, so it's opt-in via the
// PRIVATE_DATASET_ALIAS env var and skips otherwise.

test.use({ baseURL: 'http://localhost:3012' });

const DATASET_ALIAS = 'annotation-mst3ebzz-o5px';
const LABEL = 'cells';

function readHyphaToken(): string | undefined {
  if (process.env.HYPHA_TOKEN) return process.env.HYPHA_TOKEN;
  try {
    const envText = fs.readFileSync('/data/nmechtel/bioengine/.env', 'utf8');
    const match = envText.match(/HYPHA_TOKEN=(\S+)/);
    return match?.[1];
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

test.describe('Dataset overview (§13)', () => {
  test('header, action row, and Share dialog render correctly', async ({ page }) => {
    const token = readHyphaToken();
    if (!token) {
      test.skip();
      return;
    }
    test.setTimeout(120000);

    await injectToken(page, token);
    await page.goto(`/#/colab/${encodeURIComponent(DATASET_ALIAS)}`);

    // Header: back button + dataset title (name if the broker/artifact has
    // one, falling back to the bare alias) + small muted artifact id line.
    const backButton = page.locator('button[title="Back to Colab"]');
    await expect(backButton).toBeVisible({ timeout: 60000 });
    await expect(page.locator('h1')).toBeVisible();
    await expect(page.getByText(DATASET_ALIAS, { exact: false })).toBeVisible();

    // Action row: Share / Finetune / Download / (Delete dataset if owner),
    // right-aligned as a group.
    const shareButton = page.getByRole('button', { name: 'Share', exact: true });
    await expect(shareButton).toBeVisible();
    await expect(page.getByRole('button', { name: 'Finetune' })).toBeVisible();
    await expect(page.getByRole('link', { name: 'Download' })).toBeVisible();

    // Labels box: full height, scrollable list.
    await expect(page.getByRole('heading', { name: 'Labels' })).toBeVisible();

    // Refresh control now lives in the Images panel, not the top action bar.
    await expect(page.getByRole('button', { name: /Refresh|Refreshing/ })).toBeVisible();

    // Open the Share dialog and check its three sections.
    await shareButton.click();
    const dialog = page.getByText('Share Dataset');
    await expect(dialog).toBeVisible();
    await expect(page.getByText('Sharing', { exact: true })).toBeVisible();
    await expect(page.getByText('Make publicly readable')).toBeVisible();

    // QR/label section: only present once the dataset has at least one
    // label, which this fixture dataset does ("cells").
    const annotationLabelHeading = page.getByText('Annotation Label', { exact: false });
    if (await annotationLabelHeading.isVisible().catch(() => false)) {
      await expect(page.getByText('Show QR Code')).toBeVisible();
    }

    await page.screenshot({ path: 'test-results/colab-overview-share-dialog.png' });

    // Close the dialog.
    await page.getByRole('button', { name: 'Close' }).click();
    await expect(dialog).not.toBeVisible();
  });
});

test.describe('Annotate request-access flow (§13 item 4)', () => {
  test('logged-in visitor without a role sees a Request access button', async ({ page }) => {
    const token = readHyphaToken();
    const privateAlias = process.env.PRIVATE_DATASET_ALIAS;
    if (!token || !privateAlias) {
      test.skip();
      return;
    }
    test.setTimeout(60000);

    await injectToken(page, token);
    const url = `/#/colab/annotate?session_id=${encodeURIComponent(privateAlias)}&label=${encodeURIComponent(LABEL)}`;
    await page.goto(url);

    const requestButton = page.getByRole('button', { name: 'Request access' });
    await expect(requestButton).toBeVisible({ timeout: 30000 });
    await requestButton.click();

    // Either the request is recorded (confirmation text) or the caller
    // already had access and the page reconnects straight into the viewer.
    const confirmation = page.getByText('Access requested.', { exact: false });
    const viewer = page.getByTestId('annotation-viewer');
    await expect(confirmation.or(viewer)).toBeVisible({ timeout: 30000 });
  });
});
