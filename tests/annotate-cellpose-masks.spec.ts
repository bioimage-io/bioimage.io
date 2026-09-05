import { test, expect } from '@playwright/test';
import fs from 'fs';
import { BASE_URL } from './baseUrl';

// Requires: HYPHA_TOKEN env var, falls back to /data/nmechtel/bioengine/.env.
// Requires: dev server running at E2E_BASE_URL (default http://localhost:3000).
//
// Regression test for colab-rework-plan.md §18.6: "Cellpose-SAM detects no
// masks". Root cause was a leading batch dimension (e.g. (1,1,H,W) instead
// of (H,W)) in the ndarrays the runner returns, silently misread by
// decodeLabelMask (useHyphaService.ts) as a 1x1 image, producing zero
// polygons with no error. This drives the actual "Full Image Segmentation"
// dialog end to end against the live backend and asserts the resulting
// banner reports at least one detected mask.

test.use({ baseURL: BASE_URL });

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

test.describe('Full Image Segmentation (Cellpose-SAM)', () => {
  test('detects at least one mask on the HPA demo image', async ({ page }) => {
    const token = readHyphaToken();
    if (!token) {
      test.skip();
      return;
    }

    // Generous timeout: the Cellpose inference alone can take 30-60s on
    // a 256px HPA crop, on top of connect + image load + kernel boot.
    test.setTimeout(240000);

    const consoleLines: string[] = [];
    page.on('console', (msg) => consoleLines.push(`[${msg.type()}] ${msg.text()}`));

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

    // Open the Full Image Segmentation dialog.
    const openDialogButton = page.locator('[data-tool="cellpose"]');
    await expect(openDialogButton).toBeEnabled({ timeout: 60000 });
    await openDialogButton.click();

    const dialog = page.getByRole('dialog').filter({ hasText: 'Full Image Segmentation' });
    await expect(dialog).toBeVisible({ timeout: 10000 });

    // The backend selector defaults to μSAM (§18.4); explicitly switch to
    // Cellpose-SAM since that's the backend the reported bug named.
    const modelSelect = dialog.getByRole('combobox');
    await modelSelect.click();
    await page.getByRole('option', { name: 'Cellpose-SAM' }).click();

    // First run: button reads "Compute Flow Field".
    const runButton = dialog.getByRole('button', { name: 'Compute Flow Field', exact: true });
    await expect(runButton).toBeEnabled({ timeout: 10000 });
    await runButton.click();
    // Round 37 (#87) added a blocking warning when the image already carries
    // masks. Harmless no-op on a clean image, required to reach the run
    // otherwise.
    const runAnyway = page.getByRole('button', { name: /Run Anyway/i });
    if (await runAnyway.count()) await runAnyway.first().click();

    // Wait for the run to finish: either a success banner with a mask count,
    // or the "no masks" warning banner (the bug's exact reported symptom).
    const resultBanner = page.getByText(/Added \d+ masks? from Cellpose|No masks detected by Cellpose/);
    await expect(resultBanner).toBeVisible({ timeout: 120000 });
    const bannerText = (await resultBanner.textContent()) ?? '';

    console.log('--- browser console ---');
    console.log(consoleLines.join('\n'));
    console.log('--- result banner ---');
    console.log(bannerText);

    expect(bannerText).not.toContain('No masks detected');
    const match = bannerText.match(/Added (\d+) masks?/);
    expect(match, `unexpected banner text: "${bannerText}"`).not.toBeNull();
    const maskCount = Number(match![1]);
    expect(maskCount).toBeGreaterThan(0);
  });
});
