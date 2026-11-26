import { test, expect } from '@playwright/test';
import fs from 'fs';
import { BASE_URL } from './baseUrl';

// A split can exist, be named correctly, hold annotated images, and still be
// untrainable because every annotation marks nothing: the annotator writes a
// GeoJSON FeatureCollection even when the user drew nothing. Such a run used to
// be armed, accepted, ingested, and only then fail with "No training pairs with
// foreground labels after ingestion". The page must refuse it instead.
//
// Requires: HYPHA_TOKEN env var, or BIOENGINE_ENV_FILE naming a file holding
// it. Requires a dev server at E2E_BASE_URL, reached through the PUBLIC tunnel
// rather than localhost, so what is measured is what a reviewer can reach.
//
// WHY THE ANNOTATION BODIES ARE STUBBED RATHER THAN CREATED
//
// Measured read-only against the live fixture: every annotation it holds marks
// foreground (53, 65, 23 and 1 features across its two splits). A split can
// only reference stems that already exist, so there is no way to assemble this
// condition from the fixture's own data, and manufacturing it would mean
// writing an empty annotation into a shared dataset.
//
// So the broker is left completely alone and only the annotation BODIES the
// page fetches for itself are replaced. Everything else is real: the real page,
// the real readiness effect, the real split, the real listing call.
//
// THE CONTROL IS THE POINT. The first test drives the SAME url with no stub and
// requires the run to ARM. Without it, a disabled button in the second test
// would prove only that the page refused, not that it refused BECAUSE the
// annotations are empty. The pair is what makes this evidence.

test.use({ baseURL: BASE_URL, viewport: { width: 1280, height: 900 } });

const DATASET_ALIAS = 'annotation-mst3ebzz-o5px';
const LABEL = 'cells';
// A split that really is trainable. The control arm depends on that.
const GOOD_SPLIT = 'r30-accept';

const EMPTY_FEATURE_COLLECTION = JSON.stringify({ type: 'FeatureCollection', features: [] });

function readHyphaToken(): string | undefined {
  if (process.env.HYPHA_TOKEN) return process.env.HYPHA_TOKEN;
  // Named by the environment, never baked in: a hardcoded absolute path only
  // works on the machine it was written on, and this repository is public.
  const envFile = process.env.BIOENGINE_ENV_FILE;
  if (!envFile) return undefined;
  try {
    return fs.readFileSync(envFile, 'utf8').match(/HYPHA_TOKEN=(\S+)/)?.[1];
  } catch {
    return undefined;
  }
}

async function injectToken(page: import('@playwright/test').Page, token: string) {
  await page.addInitScript(
    ({ tok, expiry }) => {
      localStorage.setItem('token', tok);
      localStorage.setItem('tokenExpiry', expiry);
      localStorage.setItem('bioimage-annotation-tutorial-seen', '1');
      localStorage.removeItem('bioimage_training_service_override');
    },
    { tok: token, expiry: new Date(Date.now() + 3 * 60 * 60 * 1000).toISOString() },
  );
}

const runUrl = (split: string) =>
  `/#/colab/${encodeURIComponent(DATASET_ALIAS)}/finetune`
  + `?label=${encodeURIComponent(LABEL)}&split=${encodeURIComponent(split)}&model=cpsam`;

/** Wait for the readiness verdict, so no assertion lands on a half-resolved card. */
async function settle(page: import('@playwright/test').Page) {
  await expect(page.getByRole('heading', { name: 'New training run' })).toBeVisible({ timeout: 60000 });
  await expect(page.getByText('Checking what this split holds...')).toHaveCount(0, { timeout: 60000 });
}

test.describe('a run whose annotations mark no foreground cannot be armed', () => {
  test('CONTROL: the same split arms when its annotations are left alone', async ({ page }) => {
    const token = readHyphaToken();
    if (!token) {
      test.skip();
      return;
    }
    test.setTimeout(180000);
    await injectToken(page, token);

    // Count the annotation bodies that really came back 200. A reviewer found
    // that this arm passed whether or not the reads SUCCEEDED, because a
    // failed read also leaves the run armed: the control could not tell "the
    // annotations were read and have foreground" from "nothing could be read
    // at all". Counting them closes that.
    let okGeojson = 0;
    page.on('response', (r) => {
      if (/\.geojson(\?|$)/.test(r.url()) && r.status() === 200) okGeojson += 1;
    });

    await page.goto(runUrl(GOOD_SPLIT));
    await settle(page);

    const startButton = page.getByRole('button', { name: 'Start training' });
    await expect(startButton).toBeVisible();
    // If this ever goes red, the second test proves nothing: it would be
    // refusing for a reason that has nothing to do with foreground.
    await expect(startButton).toBeEnabled();
    await expect(page.getByText('none of them mark any foreground')).toHaveCount(0);
    // Measured on this split: its two annotations really are fetched and
    // really do return 200.
    expect(okGeojson, 'the real annotation bodies should have been read').toBeGreaterThan(0);

    await page.screenshot({ path: 'test-results/foreground-control-armed.png', fullPage: false });
  });

  test('refuses, and says the annotations mark no foreground, when every one is empty', async ({ page }) => {
    const token = readHyphaToken();
    if (!token) {
      test.skip();
      return;
    }
    test.setTimeout(180000);
    await injectToken(page, token);

    // Replace only the annotation bodies. The listing call that mints these
    // urls is untouched, so the page still sees two real training images.
    let intercepted = 0;
    await page.route(/\.geojson(\?|$)/, async (route) => {
      intercepted += 1;
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: EMPTY_FEATURE_COLLECTION,
      });
    });

    await page.goto(runUrl(GOOD_SPLIT));
    await settle(page);

    const startButton = page.getByRole('button', { name: 'Start training' });
    await expect(startButton).toBeVisible();
    await expect(startButton).toBeDisabled();

    // The sentence has to name foreground, because the no-annotations refusal
    // is a different sentence with a different fix.
    await expect(page.getByText('none of them mark any foreground')).toBeVisible();
    // It must also say how many were annotated, so the user can tell the two
    // refusals apart. This split really holds 2.
    await expect(page.getByText('2 annotated images', { exact: false })).toBeVisible();

    await page.screenshot({ path: 'test-results/foreground-refused.png', fullPage: false });

    // Asserted last so a failure above is reported as the real symptom rather
    // than as a routing problem, but asserted, because a route that matched
    // nothing would make this test meaningless.
    expect(intercepted, 'the annotation bodies should have been intercepted').toBeGreaterThan(0);
  });

  test('STAYS ARMED when one annotation could not be read and the rest are empty', async ({ page }) => {
    // The defect this arm exists for, and it shipped once: the probe treated
    // "one annotation read empty" as a determined verdict even when another
    // could not be read at all. On this very split, whose two annotations hold
    // 53 and 65 features, a single failed request made the page refuse the run
    // and tell the user that none of their annotations mark any foreground.
    // That sentence was false about an annotation nobody had looked at.
    //
    // A transient 503 on one presigned URL is an ordinary event. It must not
    // be able to say the work is empty.
    const token = readHyphaToken();
    if (!token) {
      test.skip();
      return;
    }
    test.setTimeout(180000);
    await injectToken(page, token);

    let failedOnce = false;
    let intercepted = 0;
    await page.route(/\.geojson(\?|$)/, async (route) => {
      intercepted += 1;
      // The FIRST body fails; every other one is empty. So the only
      // annotations the page can read say "nothing here", and the one it
      // cannot read is the one that actually holds the work.
      if (!failedOnce) {
        failedOnce = true;
        await route.fulfill({ status: 503, contentType: 'text/plain', body: 'unavailable' });
        return;
      }
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: EMPTY_FEATURE_COLLECTION,
      });
    });

    await page.goto(runUrl(GOOD_SPLIT));
    await settle(page);

    const startButton = page.getByRole('button', { name: 'Start training' });
    await expect(startButton).toBeVisible();
    // ARMED, not refused. An unread annotation leaves the question open, and
    // an open question must not block a valid run.
    await expect(startButton).toBeEnabled();
    // And the page must not assert emptiness about what it could not read.
    await expect(page.getByText('none of them mark any foreground')).toHaveCount(0);

    await page.screenshot({ path: 'test-results/foreground-mixed-armed.png', fullPage: false });

    expect(failedOnce, 'one annotation body should have been failed').toBe(true);
    expect(intercepted, 'the annotation bodies should have been intercepted').toBeGreaterThan(1);
  });
});
