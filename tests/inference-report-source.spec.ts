import { test, expect } from '@playwright/test';

// Verifies the ArtifactDetails "Test Run Model" badge reads its pass/fail state
// from the NEW inference-report artifact
// (bioimage-io/inference-report/files/inference_report.json) rather than the
// former collection.manifest.bioengine_inference field.
//
// This asserts against the REAL published artifact rather than a fixture. Two
// facts make that a decisive check of the source switch:
//   - affable-shark is recorded "passed" and affectionate-cow "failed" in the
//     new artifact; the badge must reflect both.
//   - affectionate-cow's failure carries its FULL runtime traceback
//     (ml_collections / usplit_wrapper.py). That text is far longer than 20
//     chars, so it can only come from the new report — the old manifest field
//     stored message[:20]. Seeing it in the failure dialog proves both the new
//     source and the removal of the message[:20] truncation, end to end.
//
// Requires:
//   HYPHA_TOKEN env var — auto-login makes the (login-gated) badge interactive.
//   Dev server running: pnpm start
//   The inference-report artifact populated for these two models
//   (scripts/bioengine_model_infer.py --model-ids affable-shark affectionate-cow).

const injectToken = (token: string) => ({
  tok: token,
  expiry: new Date(Date.now() + 3 * 60 * 60 * 1000).toISOString(),
});

const gotoArtifact = async (page: import('@playwright/test').Page, alias: string) => {
  // The ArtifactDetails route takes the bare alias; the component prepends the
  // bioimage-io/ workspace itself (fetchResource(`bioimage-io/${id}`)).
  await page.goto(`/#/artifacts/${alias}`);
};

test.describe('ArtifactDetails BioEngine badge reads the inference-report artifact', () => {
  test('passed model → green check badge, enabled Test Run Model button', async ({ page }) => {
    const token = process.env.HYPHA_TOKEN;
    if (!token) {
      test.skip();
      return;
    }
    test.setTimeout(120000);

    await page.addInitScript(({ tok, expiry }) => {
      localStorage.setItem('token', tok);
      localStorage.setItem('tokenExpiry', expiry);
    }, injectToken(token));

    await gotoArtifact(page, 'affable-shark');

    const testButton = page.getByRole('button', { name: 'Test Run Model' });
    await expect(testButton).toBeVisible({ timeout: 60000 });
    // Enabled = logged in AND bioengineStatus resolved from the new source.
    await expect(testButton).toBeEnabled({ timeout: 30000 });
    // Passed state renders the CheckCircle icon (not the Cancel icon).
    await expect(testButton.locator('svg[data-testid="CheckCircleIcon"]')).toBeVisible();
    await expect(testButton.locator('svg[data-testid="CancelIcon"]')).toHaveCount(0);
  });

  test('failed model → cancel badge, dialog shows the full untruncated message', async ({ page }) => {
    const token = process.env.HYPHA_TOKEN;
    if (!token) {
      test.skip();
      return;
    }
    test.setTimeout(120000);

    await page.addInitScript(({ tok, expiry }) => {
      localStorage.setItem('token', tok);
      localStorage.setItem('tokenExpiry', expiry);
    }, injectToken(token));

    await gotoArtifact(page, 'affectionate-cow');

    const testButton = page.getByRole('button', { name: 'Test Run Model' });
    await expect(testButton).toBeVisible({ timeout: 60000 });
    await expect(testButton).toBeEnabled({ timeout: 30000 });
    // Failed state renders the Cancel icon (not the CheckCircle icon).
    await expect(testButton.locator('svg[data-testid="CancelIcon"]')).toBeVisible();
    await expect(testButton.locator('svg[data-testid="CheckCircleIcon"]')).toHaveCount(0);

    // Clicking the failed badge opens the error dialog carrying the full
    // (untruncated) runtime traceback — text that only exists in the new report.
    // force: the badge carries a hover transform/transition; we only need to
    // fire its onClick, not wait for MUI actionability to settle.
    await testButton.click({ force: true });
    await expect(page.getByText('BioEngine Test Run Failed')).toBeVisible({ timeout: 15000 });
    await expect(page.getByText('usplit_wrapper.py', { exact: false })).toBeVisible();
    await expect(page.getByText('ml_collections', { exact: false })).toBeVisible();
  });
});
