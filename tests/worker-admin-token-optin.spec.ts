import { test, expect, Page } from '@playwright/test';
import fs from 'fs';
import { BASE_URL } from './baseUrl';

// Regression guard for issue #0034.
//
// "Manage a BioEngine Worker" used to mint a read-write Hypha token
// unconditionally, and refused to copy the prompt until it had one. So there
// was no way to obtain the prompt without a live credential embedded in it,
// and logged out the page produced nothing at all.
//
// #0034 added a checkbox, ticked by default, and this spec pins both states.
// The box is deliberately NOT disabled while logged out, unlike the same box on
// the apps page, which the anonymous test below asserts directly.
//
// Requires: a dev server at E2E_BASE_URL (the page is store-driven, so it needs
// the dev build, not build/). The logged-in half additionally needs
// HYPHA_TOKEN, and skips without it; the anonymous half needs no credential and
// is not a degraded mode of the test.

test.use({ baseURL: BASE_URL, viewport: { width: 1280, height: 900 } });

const PAGE = '/#/bioengine/worker-admin';

/** The line buildPrompt emits in place of a token. */
const ENV_FALLBACK = 'Authenticate with HYPHA_TOKEN from the environment';

const injectToken = (token: string) => ({
  tok: token,
  expiry: new Date(Date.now() + 3 * 60 * 60 * 1000).toISOString(),
});

function readHyphaToken(): string | undefined {
  if (process.env.HYPHA_TOKEN) return process.env.HYPHA_TOKEN;
  try {
    return fs.readFileSync('/data/nmechtel/bioimage.io/.env', 'utf8').match(/HYPHA_TOKEN=(\S+)/)?.[1];
  } catch {
    return undefined;
  }
}

/**
 * Wait for the worker list to seed its default selection.
 *
 * The featured worker is matched by name and the list refreshes every 10 s, so
 * the first poll often returns some other site's workers. Rather than click a
 * card by a label that embeds a ReplicaSet hash and changes on every pod roll,
 * wait for the page's own selection summary to report a selection.
 */
async function waitForWorkerSelected(page: Page) {
  await expect(page.getByText(/\d+ workers? selected/)).toBeVisible({ timeout: 90000 });
}

/**
 * Screenshot the page, masking the prompt only when it holds a live credential.
 *
 * A screenshot of a ticked, logged-in prompt is a read-write Hypha token in a
 * file, so that one case is painted over. Every other case is exactly the thing
 * a reviewer needs to read, so it is left legible.
 */
async function shot(
  page: Page,
  testInfo: import('@playwright/test').TestInfo,
  name: string,
  { maskPrompt = false } = {},
) {
  const path = testInfo.outputPath(name);
  await page.screenshot({ path, mask: maskPrompt ? [page.locator('pre').first()] : [] });
  testInfo.annotations.push({ type: 'screenshot', description: path });
  return path;
}

test.describe('logged out', () => {
  test('the box is ticked by default, and unticking it is possible without logging in', async ({ page }, testInfo) => {
    test.setTimeout(120000);
    await page.goto(PAGE);

    const box = page.getByTestId('include-token');
    await expect(box).toBeVisible({ timeout: 30000 });
    await expect(box).toBeChecked();

    // Ticked with no session: the prompt promises a token nothing can mint, so
    // Copy stays disabled and the banner says how to get unstuck.
    const copy = page.getByRole('button', { name: /copy/i }).first();
    await expect(copy).toBeDisabled();
    await expect(page.getByText('A Hypha token is required.')).toBeVisible();
    await expect(page.getByText(/untick the box above/i)).toBeVisible();
    await shot(page, testInfo, 'logged-out-ticked.png');

    // This is the assertion that separates this page from the apps page, where
    // the identical checkbox carries disabled={!isLoggedIn}. Logging out is
    // exactly when someone wants the token-free prompt, so here it must be
    // reachable with no session at all.
    await expect(box).toBeEnabled();
    await box.uncheck();
    await expect(box).not.toBeChecked();

    // With no credential promised there is nothing to report, so the banner
    // goes away rather than flipping colour, and the only thing still missing
    // is a worker.
    await expect(page.getByText('A Hypha token is required.')).toHaveCount(0);
    await expect(page.getByText(/is included in the prompt/i)).toHaveCount(0);
    await expect(page.getByText('Select at least one worker below to enable copying.')).toBeVisible();

    const prompt = await page.locator('pre').first().innerText();
    expect(prompt).toContain('https://bioimage.io/skills/bioengine/SKILL.md');
    expect(prompt).toContain(ENV_FALLBACK);
    expect(prompt).not.toMatch(/HYPHA_TOKEN=\S/);
    await shot(page, testInfo, 'logged-out-unticked.png');
  });
});

test.describe('logged in', () => {
  test('ticked copies a prompt with a token, unticked copies one without', async ({ page }, testInfo) => {
    const token = readHyphaToken();
    if (!token) {
      testInfo.annotations.push({
        type: 'skip-reason',
        description: 'no HYPHA_TOKEN, so no session can be injected and the worker list stays empty.',
      });
      test.skip();
      return;
    }
    test.setTimeout(180000);

    await page.addInitScript(({ tok, expiry }) => {
      localStorage.setItem('token', tok);
      localStorage.setItem('tokenExpiry', expiry);
    }, injectToken(token));

    await page.goto(PAGE);

    const box = page.getByTestId('include-token');
    await expect(box).toBeVisible({ timeout: 30000 });
    await expect(box).toBeChecked();
    await waitForWorkerSelected(page);

    // --- ticked: today's behaviour, unchanged ---
    const copy = page.getByRole('button', { name: /copy/i }).first();
    await expect(copy).toBeEnabled({ timeout: 90000 });
    await expect(page.getByText(/is included in the prompt/i)).toBeVisible();

    const withToken = await page.locator('pre').first().innerText();
    expect(withToken).toMatch(/HYPHA_TOKEN=\S{20,}/);
    expect(withToken).toMatch(/Workers?:/);
    expect(withToken).not.toContain(ENV_FALLBACK);
    await shot(page, testInfo, 'logged-in-ticked.png', { maskPrompt: true });

    // --- unticked: same prompt, no credential, Copy still live ---
    await box.uncheck();
    await expect(box).not.toBeChecked();
    await expect(page.getByText(/is included in the prompt/i)).toHaveCount(0);
    await expect(page.getByText('A Hypha token is required.')).toHaveCount(0);
    await expect(copy).toBeEnabled();

    const withoutToken = await page.locator('pre').first().innerText();
    expect(withoutToken).not.toMatch(/HYPHA_TOKEN=\S/);
    expect(withoutToken).toContain(ENV_FALLBACK);
    // The worker selection survives the toggle: only the credential changed.
    expect(withoutToken).toMatch(/Workers?:/);
    await shot(page, testInfo, 'logged-in-unticked.png');

    // --- re-ticking mints a fresh token rather than leaving the prompt bare ---
    await box.check();
    await expect(page.locator('pre').first()).toContainText(/HYPHA_TOKEN=\S{20,}/, { timeout: 60000 });
  });
});
