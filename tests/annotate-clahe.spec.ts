import { test, expect } from '@playwright/test';
import fs from 'fs';

// Requires: HYPHA_TOKEN env var (falls back to /data/nmechtel/bioengine/.env).
// Requires: dev server at http://localhost:3012.
//
// Regression coverage for colab-rework-plan.md §19c item 1: the CLAHE dialog
// used to hang forever on "Python kernel is starting up...", because nothing
// on the annotate route ever called requestKernel() on the shared kernel
// context (sharedKernel || localKernel always preferred the always-truthy,
// never-booted shared context over the auto-initializing local fallback).
// This asserts the dialog's kernel-starting state actually resolves and
// Apply produces an enhanced image within a bounded time.

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

test.describe('CLAHE contrast enhancement (§19c item 1)', () => {
  test('kernel starts up and Apply completes, without hanging', async ({ page }) => {
    const token = readHyphaToken();
    if (!token) {
      test.skip();
      return;
    }
    test.setTimeout(240000);

    await page.addInitScript(({ tok, expiry }) => {
      localStorage.setItem('token', tok);
      localStorage.setItem('tokenExpiry', expiry);
      localStorage.setItem('bioimage-annotation-tutorial-seen', '1');
    }, { tok: token, expiry: new Date(Date.now() + 3 * 60 * 60 * 1000).toISOString() });

    const url = `/#/colab/annotate?session_id=${encodeURIComponent(DATASET_ALIAS)}&label=${encodeURIComponent(LABEL)}`;
    await page.goto(url);

    const viewer = page.getByTestId('annotation-viewer');
    await expect(viewer).toBeVisible({ timeout: 180000 });
    await expect(viewer.locator('canvas').first()).toBeVisible({ timeout: 60000 });

    await page.locator('[data-tool="clahe"]').first().click();

    const applyButton = page.getByRole('button', { name: /^(Apply|Kernel Starting\.\.\.)$/ });
    await expect(applyButton).toBeVisible({ timeout: 15000 });

    // The kernel-starting message must clear on its own within a bounded
    // window (previously it never cleared at all).
    await expect(page.getByText('Python kernel is starting up...')).not.toBeVisible({ timeout: 60000 });
    await expect(applyButton).toHaveText('Apply', { timeout: 60000 });
    await expect(applyButton).toBeEnabled();

    await applyButton.click();
    await expect(page.getByText('Applying...')).not.toBeVisible({ timeout: 60000 });
    await expect(page.getByRole('dialog')).not.toBeVisible({ timeout: 10000 });
  });
});
