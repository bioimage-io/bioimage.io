import { test, expect } from '@playwright/test';

// Requires: HYPHA_TOKEN env var (same token the user stores in localStorage after login).
// Requires: dev server running at http://localhost:3000.
//
// What this tests: when the artifact's last_modified is more recent than the
// latest_remote_modified timestamp embedded in the test report, Edit.tsx
// should pass isStoredReportOutdated=true to ModelTester, which renders a
// grey clock-icon pill and a tooltip that reads "Test report is outdated."

const MODEL_ID = 'bioimage-io/affable-shark';
const MODEL_URL_ID = encodeURIComponent(MODEL_ID); // bioimage-io%2Faffable-shark

test.describe('Outdated test report warning', () => {
  test('Edit page shows outdated indicator when artifact changed after test ran', async ({ page }) => {
    const token = process.env.HYPHA_TOKEN;
    if (!token) {
      test.skip();
      return;
    }

    // 90 s total: Hypha WebSocket connection + artifact RPC call + test-report fetch + render
    test.setTimeout(90000);

    // Inject a valid Hypha token into localStorage so LoginButton's auto-login
    // fires and isLoggedIn becomes true, preventing the redirect to '/'.
    await page.addInitScript(({ tok, expiry }) => {
      localStorage.setItem('token', tok);
      localStorage.setItem('tokenExpiry', expiry);
    }, { tok: token, expiry: new Date(Date.now() + 3 * 60 * 60 * 1000).toISOString() });

    // Mock the test report HTTP fetch. Set latest_remote_modified=1 (epoch)
    // so the artifact's last_modified (any real Unix timestamp in 2024+) is
    // guaranteed to be greater, triggering the outdated condition.
    // This fires for both effect runs (first with artifactInfo=null, which
    // won't trigger outdated, and second after setArtifactInfo which will).
    await page.route(/test-report-affable-shark/, route =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          name: 'affable-shark test',
          status: 'passed',
          details: [],
          latest_remote_modified: 1,
        }),
      })
    );

    await page.goto(`/#/edit/${MODEL_URL_ID}`);

    // Step 1: Wait for the artifact to load — the "Test Model" button only
    // appears once artifactType === 'model', which requires a successful RPC
    // call to the Hypha artifact manager. This confirms login + connection + read.
    await expect(page.getByRole('button', { name: 'Test Model' })).toBeVisible({ timeout: 60000 });

    // Step 2: Wait for the outdated indicator. The staleness check effect fires
    // when artifactType changes to 'model' (first run, artifactInfo=null → not
    // outdated yet) and again when setArtifactInfo provides last_modified
    // (second run → artifactModified > 1 → isTestReportOutdated=true).
    // The test report fetch typically completes before or concurrently with
    // "Test Model" appearing, so the tooltip is often already in the DOM here.
    await expect(
      page.locator('[role="tooltip"]').filter({ hasText: /test report is outdated/i })
    ).toBeAttached({ timeout: 30000 });
  });
});
