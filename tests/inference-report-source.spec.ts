import { test, expect } from '@playwright/test';

// Verifies the ArtifactDetails "Test Run Model" badge reads its pass/fail state
// from the per-model test-report artifact (bioimage-io/test-report-<id>) rather
// than the former collection.manifest.bioengine_inference field.
//
// This asserts against the REAL published artifacts rather than a fixture. Two
// facts make that a decisive check of the source switch:
//   - affable-shark scores in the inference-passing band and affectionate-cow
//     does not; the badge must reflect both.
//   - affectionate-cow's failure carries its FULL runtime traceback. The old
//     manifest field stored message[:20], so seeing any of that text past the
//     first 20 characters proves both the new source and the removal of the
//     truncation, end to end.
//
// The expected failure text is read from the live report at run time rather
// than hardcoded. The traceback changes whenever the model is re-tested, and
// what this test is about is that the dialog shows the WHOLE message, not that
// the message says any particular thing.
//
// Requires:
//   HYPHA_TOKEN env var — auto-login makes the (login-gated) badge interactive.
//   Dev server running: pnpm start
//   The test-reports collection populated for these two models
//   (scripts/bioengine_model_infer.py --model-ids affable-shark affectionate-cow).

const REPORT_URL = (alias: string) =>
  `https://hypha.aicell.io/bioimage-io/artifacts/test-report-${alias}/files/published/test_report.json?use_proxy=true`;

const injectToken = (token: string) => ({
  tok: token,
  expiry: new Date(Date.now() + 3 * 60 * 60 * 1000).toISOString(),
});

const gotoArtifact = async (page: import('@playwright/test').Page, alias: string) => {
  // The ArtifactDetails route takes the bare alias; the component prepends the
  // bioimage-io/ workspace itself (fetchResource(`bioimage-io/${id}`)).
  await page.goto(`/#/artifacts/${alias}`);
};

test.describe('ArtifactDetails BioEngine badge reads the test-report artifact', () => {
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

    // The longest line of the recorded traceback: it renders as one contiguous
    // run inside the dialog's <pre>, and it is far longer than the 20 characters
    // the old source would have kept.
    const report = await (await fetch(REPORT_URL('affectionate-cow'))).json();
    const recorded: string = report?.inference_check?.error ?? '';
    const longest = recorded
      .split('\n')
      .map((line: string) => line.trim().replace(/^\|\s*/, ''))
      .sort((a: string, b: string) => b.length - a.length)[0];
    expect(longest.length).toBeGreaterThan(20);

    const dialogText = await page.getByRole('dialog').innerText();
    expect(dialogText).toContain(longest);
  });
});
