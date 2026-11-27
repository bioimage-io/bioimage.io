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
 * Keeping the id WOULD be enough to re-attach, and an earlier version of this
 * header said the opposite. Measured: only a signed-in owner can reach the
 * dialog, that token sits in localStorage and survives the reload, and a
 * second connection carrying it polled an export the first connection had
 * started. The export is bound to the USER, not to the socket. So recovery
 * is a piece of work on this page rather than an identity problem, which is
 * why it is a proposal on the issue and not built here.
 *
 * So the page says so BEFORE the loss, and this measures both halves: the
 * warning is on screen while the export runs, and after a reload there is
 * nothing left, in particular no raw service refusal.
 *
 * TWO PHASES, because the warning shows in three and they do not leave the
 * same thing behind. Reloading while the package is still BUILDING leaves
 * nothing at all: the artifact is created only once the build reports ready.
 * Reloading while it is PUSHING is the opposite, the artifact exists by
 * then, so the second arm goes looking for it and records what it finds.
 * A review asked for that, having noticed the first version measured one
 * phase and let the page speak for three.
 *
 * LIVE: it starts a real export on the trainer. Needs `EXPORT_DATASET_ALIAS`
 * to name a dataset with a finished run this token owns.
 */

const ALIAS = process.env.EXPORT_DATASET_ALIAS;
const HYPHA_SERVER_URL = process.env.REACT_APP_HYPHA_SERVER_URL || 'https://hypha.aicell.io';
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

  test('is warned about first, and during the BUILD leaves nothing behind', async ({
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
    await expect(
      dialog.getByText(/does not keep track of an export across a reload/i),
    ).toBeVisible();
    // And it does not blame the sign-in, which is the claim a review showed
    // my own measurement had refuted.
    await expect(dialog.getByText(/tied to the sign-in/i)).toHaveCount(0);
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

  test('during the UPLOAD, leaves a draft the user can be told about', async ({
    page,
  }, testInfo) => {
    // The other side of the same warning. By the upload the page has already
    // created a staged artifact, so a reload here does not leave nothing: it
    // leaves a draft in My Artifacts that the service may even finish
    // filling. This records which of those is true, because the row asks
    // what the user is left with and the first version of this spec only
    // measured the phase where the answer is "nothing".
    test.setTimeout(1_800_000);

    await page.addInitScript(({ t, expiry }) => {
      localStorage.setItem('token', t);
      localStorage.setItem('tokenExpiry', expiry);
      localStorage.setItem('bioimage-annotation-tutorial-seen', '1');
    }, { t: token!, expiry: new Date(Date.now() + 3 * 60 * 60 * 1000).toISOString() });

    await page.goto(`/#/colab/${ALIAS}/finetune`);
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
    const name = `Reload during upload ${Date.now()}`;
    await dialog.getByPlaceholder(/My Cell Segmentation Model/i).fill(name);
    await dialog.getByRole('button', { name: /^export as model$/i }).click();

    // Wait for the UPLOAD, which is the phase this arm is about. The build
    // takes minutes, so this is the long part of the test.
    await expect(dialog.getByText(/Uploading model files/i)).toBeVisible({ timeout: 1_500_000 });
    await page.screenshot({ path: testInfo.outputPath('03-uploading.png'), fullPage: true });

    await page.reload();
    await expect(page.getByRole('button', { name: /export as model/i }).first()).toBeVisible({
      timeout: 180_000,
    });
    await page.waitForTimeout(15_000);
    await page.screenshot({ path: testInfo.outputPath('04-after-reload-upload.png'), fullPage: true });

    const body = await page.locator('body').innerText();
    expect(body).not.toMatch(/NotTheOwner/i);
    expect(body).not.toMatch(/Traceback/i);

    // AND THE DRAFT: the page created an artifact before uploading, so ask
    // the collection whether it is there. This is the answer the row wants
    // recorded, whichever way it comes out.
    const listed = await page.request.post(
      `${HYPHA_SERVER_URL}/public/services/artifact-manager/list`,
      {
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        data: { parent_id: 'bioimage-io/bioimage.io', stage: true, limit: 100 },
      },
    );
    const drafts = listed.ok() ? await listed.json() : [];
    const mine = (Array.isArray(drafts) ? drafts : []).filter(
      (d: any) => (d?.manifest?.name || '') === name,
    );
    console.log(`[reload] after reloading during the upload, drafts named "${name}": ${mine.length}`);
    if (mine.length) {
      console.log('[reload] draft id:', mine[0].id, 'files:', JSON.stringify(mine[0].manifest?.weights || {}).slice(0, 200));
    }
  });
});
