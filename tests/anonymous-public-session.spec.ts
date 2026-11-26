import { test, expect } from '@playwright/test';
import { BASE_URL } from './baseUrl';

/**
 * What a visitor with NO account sees.
 *
 * The collection `bioimage-io/colab-annotations` was tightened so it is no
 * longer anonymously listable or readable, which closed an exposure of
 * owners' email addresses. That raised a question this spec answers by
 * measurement rather than by reading the code: does anything a logged-out
 * visitor can reach still depend on a direct artifact read?
 *
 * Measured against the live service, anonymously, before writing it:
 *   - a direct read of the collection OR of a child now raises
 *     PermissionError, so any page path that needed one is dead;
 *   - the broker's `get_dataset_index` DOES answer for a dataset its owner
 *     deliberately made public (86 images), and its payload carries no
 *     address;
 *   - the same call for a non-public dataset is refused with
 *     "role 'none'; 'public' or higher is required".
 *
 * So the two arms below are the page-level consequence of those three facts.
 * The second one is the control: without it, the first passing would only
 * show that something rendered, not that the public dataset is what made it
 * render.
 *
 * NO TOKEN IS INJECTED ANYWHERE in this file, deliberately, and the storage
 * state is cleared before each run so a token left by another spec cannot
 * make these pass as a logged-in user.
 */

test.use({ baseURL: BASE_URL, viewport: { width: 1280, height: 900 }, storageState: { cookies: [], origins: [] } });

/** Public on purpose: its owner set the broker's public flag. */
const PUBLIC_DATASET = 'annotation-mst3ebzz-o5px';
/** Not public. The refusal arm needs a dataset that really is private. */
const PRIVATE_DATASET = 'annotation-mnxnayjn-gd8c';
const LABEL = 'cells';

const annotateUrl = (alias: string, imageStem?: string) =>
  `/#/colab/annotate?session_id=${encodeURIComponent(alias)}&label=${encodeURIComponent(LABEL)}` +
  (imageStem ? `&image=${encodeURIComponent(imageStem)}` : '');

/** The once-ever onboarding flag, read as the page writes it. */
const tutorialFlag = (page: import('@playwright/test').Page) =>
  page.evaluate(() => localStorage.getItem('bioimage-annotation-tutorial-seen'));

/** Fails the test if anything put a token back. */
async function assertLoggedOut(page: import('@playwright/test').Page) {
  const token = await page.evaluate(() => localStorage.getItem('token'));
  expect(token, 'this spec must run logged out').toBeNull();
}

test.describe('a visitor with no account', () => {
  test('opens a deliberately public dataset and sees its images', async ({ page }) => {
    test.setTimeout(180000);
    await page.goto(annotateUrl(PUBLIC_DATASET));
    await assertLoggedOut(page);

    // The page must NOT ask this visitor to log in: the dataset is public and
    // the broker serves it anonymously.
    await expect(page.getByText('This dataset is private', { exact: false })).toHaveCount(0, {
      timeout: 60000,
    });

    // A CANVAS, which is what makes this arm discriminate. Measured on the
    // live page: the public dataset renders 1 canvas and the private one
    // renders 0, while BOTH render the same tool chrome, the same label chip
    // and the same single img. So asserting on the chrome would pass for a
    // dataset the visitor cannot read, and only the canvas separates them.
    await expect(page.locator('canvas').first()).toBeVisible({ timeout: 90000 });

    await page.screenshot({ path: 'test-results/anon-public-dataset.png' });
  });

  test('CONTROL: a private dataset is refused with a sentence, not a blank page', async ({ page }) => {
    test.setTimeout(180000);
    await page.goto(annotateUrl(PRIVATE_DATASET));
    await assertLoggedOut(page);

    // The refusal has to SAY something. A blank page and a refusal look the
    // same to a visitor, and only one of them is honest.
    await expect(page.getByText('This dataset is private', { exact: false })).toBeVisible({
      timeout: 90000,
    });
    await expect(page.getByRole('button', { name: /log ?in/i }).first()).toBeVisible();

    // And NOTHING covers that sentence. The thirteen-step onboarding guide
    // used to open on mount, before access was known, so the first thing a
    // visitor met was a tour of tools they cannot use, layered over the
    // explanation. Screenshot read by eye before this assertion was written.
    await expect(page.getByText('Welcome to the BioImage.IO Annotation Tool', { exact: false })).toHaveCount(0);
    await expect(page.getByRole('button', { name: /skip guide/i })).toHaveCount(0);

    // The canvas count is the same measurement as the first arm, inverted:
    // a private dataset has no image to draw.
    await expect(page.locator('canvas')).toHaveCount(0);

    await page.screenshot({ path: 'test-results/anon-private-refused.png' });
  });

  test('a private dataset reached by an &image= DEEP LINK neither shows nor burns the guide', async ({
    page,
  }) => {
    // The same refusal, by the URL a reader copies out of the address bar.
    // Found in review, and it is the harder half: the deep-link fast path sets
    // `hasLoadedOnce` as soon as the service resolves, which is BEFORE
    // get_dataset_index has answered, so a gate reading `hasLoadedOnce` saw no
    // denial yet, opened the guide and wrote the once-ever flag. The guide was
    // then hidden when the denial arrived, which is why the previous arm
    // passed while this one did not.
    //
    // The FLAG is the assertion that matters. A visitor who arrives on such a
    // link and logs in later never sees the guide at all, and nothing on
    // screen afterwards shows that it was spent.
    test.setTimeout(180000);
    await page.addInitScript(() => localStorage.removeItem('bioimage-annotation-tutorial-seen'));
    await page.goto(annotateUrl(PRIVATE_DATASET, 'any-stem'));
    await assertLoggedOut(page);

    await expect(page.getByText('This dataset is private', { exact: false })).toBeVisible({
      timeout: 90000,
    });
    await expect(page.getByText('Welcome to the BioImage.IO Annotation Tool', { exact: false })).toHaveCount(0);
    await expect(page.getByRole('button', { name: /skip guide/i })).toHaveCount(0);
    expect(await tutorialFlag(page), 'the once-ever guide must not be spent on a refusal').toBeNull();
    await expect(page.locator('canvas')).toHaveCount(0);

    await page.screenshot({ path: 'test-results/anon-private-deeplink-refused.png' });
  });

  test('CONTROL: the guide DOES still open on a dataset the visitor can read', async ({ page }) => {
    // Without this, the two refusal arms would pass just as well if the fix
    // had disabled the onboarding guide outright. The gate is "the dataset
    // index came back, the page is past loading, and access was not denied",
    // so this arm proves the positive half still fires. `tutorial-seen` is
    // cleared first, because the guide is a once-ever dialog and a leftover
    // flag would make this pass vacuously.
    test.setTimeout(180000);
    await page.addInitScript(() => localStorage.removeItem('bioimage-annotation-tutorial-seen'));
    await page.goto(annotateUrl(PUBLIC_DATASET));
    await assertLoggedOut(page);

    await expect(
      page.getByText('Welcome to the BioImage.IO Annotation Tool', { exact: false }),
    ).toBeVisible({ timeout: 90000 });
    // And the flag IS written here, which is the other side of the deep-link
    // arm's assertion: the gate moved, it did not stop writing.
    await expect.poll(() => tutorialFlag(page), { timeout: 30000 }).toBe('1');
  });
});
