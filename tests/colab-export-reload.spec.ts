import { test, expect } from '@playwright/test';
import fs from 'fs';

/**
 * What a reload in the middle of an export looks like FROM THE USER'S SIDE.
 *
 * The export id lives in the dialog's own state. Nothing writes it to storage
 * or to the url, so a reload unmounts the dialog and the id is gone: the page
 * never polls again, no refusal is ever produced, and the panel simply
 * vanishes while the service carries on building the package. The user is not
 * shown an error. They are shown nothing, which is worse, because a page that
 * says nothing looks like a page where nothing happened.
 *
 * Keeping the id would not rescue it either: an anonymous reload arrives as a
 * different caller and the service binds an export to its creator, so a
 * restored poll is refused. Recovering an export across a reload needs the
 * identity to survive the reload, which is a product decision and is not
 * taken here.
 *
 * So the page says so BEFORE the loss, and this measures both halves: the
 * warning is on screen while the export runs, and after a reload there is
 * nothing left, in particular no raw service refusal.
 *
 * The reload happens while the package is still BUILDING, which is also the
 * point at which nothing has been created yet: the artifact is created only
 * once the build reports ready, so this leaves nothing behind to clean up.
 *
 * LIVE: it starts a real export on the trainer. Needs `EXPORT_DATASET_ALIAS`
 * to name a dataset with a finished run this token owns.
 */

const ALIAS = process.env.EXPORT_DATASET_ALIAS;
/**
 * Which run to export, optional. Worth setting: a dataset accumulates runs,
 * and on this trainer a micro-sam run's export FAILS during the build, which
 * would end the building phase this test needs to reload in the middle of.
 */
const RUN_ID = process.env.EXPORT_RUN_ID;

function readEnvToken(name: string): string | undefined {
  if (process.env[name]) return process.env[name];
  const envFile = process.env.BIOENGINE_ENV_FILE;
  if (!envFile) return undefined;
  try {
    return fs.readFileSync(envFile, 'utf8').match(new RegExp(`${name}=(\\S+)`))?.[1];
  } catch {
    return undefined;
  }
}

const token = readEnvToken('HYPHA_TOKEN');

test.describe('a reload in the middle of an export', () => {
  test.skip(!token, 'HYPHA_TOKEN not available');
  test.skip(!ALIAS, 'EXPORT_DATASET_ALIAS not set: needs a dataset with a run this token owns');

  test('is warned about first, and afterwards there is nothing left to see', async ({
    page,
  }, testInfo) => {
    test.setTimeout(600_000);

    await page.addInitScript(({ t, expiry }) => {
      localStorage.setItem('token', t);
      localStorage.setItem('tokenExpiry', expiry);
      localStorage.setItem('bioimage-annotation-tutorial-seen', '1');
    }, { t: token!, expiry: new Date(Date.now() + 3 * 60 * 60 * 1000).toISOString() });

    await page.goto(`/#/colab/${ALIAS}/finetune`);
    // The CARD, which is the innermost div holding BOTH the id and the
    // button: filtering on the id alone resolves to the element that prints
    // it, which has no button inside.
    const runCard = RUN_ID
      ? page
        .locator('div')
        .filter({ hasText: RUN_ID })
        .filter({ has: page.getByRole('button', { name: /export as model/i }) })
        .last()
      : page;
    const exportButton = runCard.getByRole('button', { name: /export as model/i }).first();
    await expect(exportButton).toBeVisible({ timeout: 180_000 });
    await exportButton.click();

    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible({ timeout: 60_000 });
    await dialog.getByPlaceholder(/My Cell Segmentation Model/i).fill(`Reload check ${Date.now()}`);
    await dialog.getByRole('button', { name: /^export as model$/i }).click();

    // HALF ONE: the warning is on screen while the export runs, which is the
    // only moment it can still be acted on.
    await expect(dialog.getByText(/keep this tab open/i)).toBeVisible({ timeout: 120_000 });
    await expect(dialog.getByText(/reloading or closing the page loses track of it/i)).toBeVisible();
    await page.screenshot({ path: testInfo.outputPath('01-warned-while-building.png'), fullPage: true });

    // HALF TWO: reload while it is still building, and record what is left.
    await page.reload();
    await expect(page.getByRole('button', { name: /export as model/i }).first()).toBeVisible({
      timeout: 180_000,
    });
    await page.waitForTimeout(10_000);
    await page.screenshot({ path: testInfo.outputPath('02-after-reload.png'), fullPage: true });

    // The dialog is gone, which is the loss the warning described.
    await expect(page.getByRole('dialog')).toHaveCount(0);
    // And the page shows no refusal: the user meets silence, not an error, so
    // a future change that starts surfacing `NotTheOwner` here would be a
    // DIFFERENT behaviour and this records which one is live.
    const body = await page.locator('body').innerText();
    expect(body).not.toMatch(/NotTheOwner/i);
    expect(body).not.toMatch(/Traceback/i);
    // Written into the run so the measurement is readable without the image.
    console.log('[reload] after the reload the page shows:',
      body.replace(/\s+/g, ' ').slice(0, 400));
  });
});
