import { test, expect } from '@playwright/test';
import fs from 'fs';
import { BASE_URL } from './baseUrl';

// Requires: HYPHA_TOKEN env var (falls back to /data/nmechtel/bioengine/.env).
// Requires: a dev server at E2E_BASE_URL. Run it through the PUBLIC tunnel,
// not localhost, so what is measured is what a reviewer can reach:
//
//   E2E_BASE_URL=https://tl-colab-dev-2bc6ffc3.hypha.run \
//     npx playwright test tests/finetune-readiness.spec.ts
//
// What this covers (myco #0047, from the 2026-10-25 colab review):
//
// - C1: a training service that does not answer used to leave "Start
//   training" armed and print roughly 2 KB of Python traceback into the
//   Training sessions card. The button must now be disabled and the page must
//   carry no traceback.
// - C3: `hasPendingRun` was a truthiness check on three query parameters, so a
//   split that does not exist produced a fully armed run card. The page must
//   now resolve the split before the button goes live, and refuse a split with
//   nothing in it.
//
// Nothing here starts a real training run: every assertion is about the state
// of the page BEFORE the button is pressed, which is exactly the thing that
// was broken.

test.use({ baseURL: BASE_URL });

const DATASET_ALIAS = 'annotation-mst3ebzz-o5px';
const LABEL = 'cells';
const NO_SUCH_SPLIT = 'readiness-no-such-split';
const NO_SUCH_SERVICE = 'readiness-no-such-trainer';

function readHyphaToken(): string | undefined {
  if (process.env.HYPHA_TOKEN) return process.env.HYPHA_TOKEN;
  try {
    const envText = fs.readFileSync('/data/nmechtel/bioengine/.env', 'utf8');
    return envText.match(/HYPHA_TOKEN=(\S+)/)?.[1];
  } catch {
    return undefined;
  }
}

async function injectToken(
  page: import('@playwright/test').Page,
  token: string,
  trainingServiceOverride?: string,
) {
  await page.addInitScript(
    ({ tok, expiry, override }) => {
      localStorage.setItem('token', tok);
      localStorage.setItem('tokenExpiry', expiry);
      localStorage.setItem('bioimage-annotation-tutorial-seen', '1');
      if (override) localStorage.setItem('bioimage_training_service_override', override);
      else localStorage.removeItem('bioimage_training_service_override');
    },
    {
      tok: token,
      expiry: new Date(Date.now() + 3 * 60 * 60 * 1000).toISOString(),
      override: trainingServiceOverride ?? '',
    },
  );
}

/**
 * Every Python traceback marker that used to reach the page verbatim, plus
 * the hypha payload the traceback ended in: `KeyError: 'Service not found:
 * <workspace>/*:<id>@*'`. That last one is the readable-looking half, and it
 * still has no business in the UI, since it names the resolved service id and
 * the caller's workspace rather than anything the user can act on.
 */
const TRACEBACK_MARKERS = [
  'Traceback (most recent call last)',
  'File "/',
  'RayTaskError',
  'raise ',
  'KeyError',
  'Service not found',
];

async function expectNoTracebackOnPage(page: import('@playwright/test').Page) {
  const body = (await page.locator('body').innerText()).trim();
  for (const marker of TRACEBACK_MARKERS) {
    expect(body, `page should not render the raw traceback marker ${JSON.stringify(marker)}`).not.toContain(
      marker,
    );
  }
  // A readable failure is still allowed to be long-ish, but not 2 KB long.
  const redBanners = await page.locator('.bg-red-50, .bg-amber-50').allInnerTexts();
  for (const text of redBanners) {
    expect(text.length, `an error banner should stay readable, got ${text.length} characters`).toBeLessThan(
      400,
    );
  }
}

const runUrl = (split: string) =>
  `/#/colab/${encodeURIComponent(DATASET_ALIAS)}/finetune` +
  `?label=${encodeURIComponent(LABEL)}&split=${encodeURIComponent(split)}&model=cpsam`;

test.describe('C3: a run is not armed until the split is known to be trainable', () => {
  test('a split that does not exist disables Start training and says which split', async ({ page }) => {
    const token = readHyphaToken();
    if (!token) {
      test.skip();
      return;
    }
    test.setTimeout(120000);
    await injectToken(page, token);

    await page.goto(runUrl(NO_SUCH_SPLIT));

    // The run card still renders: the user asked for a run and is told why it
    // cannot happen, rather than being silently dropped back to the sessions
    // list with no explanation.
    await expect(page.getByRole('heading', { name: 'New training run' })).toBeVisible({ timeout: 60000 });

    const startButton = page.getByRole('button', { name: 'Start training' });
    await expect(startButton).toBeVisible();

    // The readiness check has to resolve before the verdict is meaningful, so
    // wait for the "checking" state to clear rather than asserting straight
    // away and passing on a button that merely had not gone live yet.
    await expect(page.getByText('Checking what this split holds...')).toHaveCount(0, { timeout: 60000 });

    await expect(startButton).toBeDisabled();
    await expect(page.getByText(NO_SUCH_SPLIT, { exact: false }).first()).toBeVisible();
    await expectNoTracebackOnPage(page);
  });
});

test.describe('C1: an unreachable training service cannot arm a run', () => {
  test('disables Start training, says so in one sentence, and prints no traceback', async ({ page }) => {
    const token = readHyphaToken();
    if (!token) {
      test.skip();
      return;
    }
    test.setTimeout(120000);
    await injectToken(page, token, NO_SUCH_SERVICE);

    await page.goto(runUrl(NO_SUCH_SPLIT));

    await expect(page.getByRole('heading', { name: 'New training run' })).toBeVisible({ timeout: 60000 });

    // The one sentence that replaces the traceback. This is attributable to
    // the unreachable service specifically: it renders off the capabilities
    // error, not off the split readiness check.
    await expect(page.getByText('The training service did not answer')).toBeVisible({ timeout: 60000 });

    await expect(page.getByRole('button', { name: 'Start training' })).toBeDisabled();
    await expectNoTracebackOnPage(page);
  });
});
