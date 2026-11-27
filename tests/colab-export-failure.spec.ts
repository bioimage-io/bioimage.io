import { test, expect } from '@playwright/test';
import fs from 'fs';

/**
 * What a user is shown when an export really fails.
 *
 * Not a stub: on the deployed trainer, exporting a MICRO-SAM run fails during
 * the build after about two minutes, with `RuntimeError: BioImage.IO export
 * failed (rc=1)` wrapped in six frames of Ray internals. That is a genuine
 * failure path a user can reach today, so this drives it and reads what the
 * page says.
 *
 * It used to say the whole traceback, beginning `ray::ServeReplica:...
 * (pid=492359, ip=172.25.5.249, ...)`. The assertions below are the two
 * halves of the fix: a sentence is what the reader meets, and the service's
 * own text is still there for whoever can use it, one click away.
 *
 * LIVE, and it needs a run whose export FAILS. `EXPORT_FAILING_RUN` names
 * one. If the service is fixed so that micro-sam exports succeed, this test
 * will fail at the error panel, which is the correct way to find that out:
 * the fixture it depends on would have stopped being a failure.
 */

const ALIAS = process.env.EXPORT_DATASET_ALIAS;
const RUN_ID = process.env.EXPORT_FAILING_RUN;

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

test.describe('an export that fails', () => {
  test.skip(!token, 'HYPHA_TOKEN not available');
  test.skip(!ALIAS || !RUN_ID, 'EXPORT_DATASET_ALIAS and EXPORT_FAILING_RUN must name a run whose export fails');

  test('says one sentence, and keeps the service text under a toggle', async ({ page }, testInfo) => {
    test.setTimeout(900_000);

    await page.addInitScript(({ t, expiry }) => {
      localStorage.setItem('token', t);
      localStorage.setItem('tokenExpiry', expiry);
      localStorage.setItem('bioimage-annotation-tutorial-seen', '1');
    }, { t: token!, expiry: new Date(Date.now() + 3 * 60 * 60 * 1000).toISOString() });

    await page.goto(`/#/colab/${ALIAS}/finetune`);
    const runCard = page
      .locator('div')
      .filter({ hasText: RUN_ID! })
      .filter({ has: page.getByRole('button', { name: /export as model/i }) })
      .last();
    const exportButton = runCard.getByRole('button', { name: /export as model/i }).first();
    await expect(exportButton).toBeVisible({ timeout: 180_000 });
    await exportButton.click();

    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible({ timeout: 60_000 });
    await dialog.getByPlaceholder(/My Cell Segmentation Model/i).fill(`Failure copy check ${Date.now()}`);
    await dialog.getByRole('button', { name: /^export as model$/i }).click();

    // The failure takes a couple of minutes on the service.
    const panel = dialog.getByText(/could not be built|belongs to a different sign-in/i);
    await expect(panel).toBeVisible({ timeout: 600_000 });
    await page.screenshot({ path: testInfo.outputPath('export-failed.png'), fullPage: true });

    // WHAT THE READER MEETS. Not a process id, not a container address, not
    // a Python object address, and not a stack frame.
    const headline = await panel.innerText();
    expect(headline).not.toMatch(/ray::|ServeReplica/);
    expect(headline).not.toMatch(/pid=\d+/);
    expect(headline).not.toMatch(/0x[0-9a-f]{6,}/);
    expect(headline).not.toMatch(/File "/);

    // AND THE RAW TEXT IS STILL THERE, which is the other half: hiding it
    // would trade one useless page for another.
    // OPENED, not just present. A collapsed `details` renders its content
    // hidden, so `innerText` is empty and a test that read it without
    // clicking would be asserting on nothing. Clicking it is also the thing
    // the claim is about: the raw text has to be REACHABLE.
    const details = page.getByTestId('export-error-details');
    await expect(details).toHaveCount(1);
    await dialog.getByText(/what the training service reported/i).click();
    await expect(details).toBeVisible();
    const raw = await details.innerText();
    expect(raw).toMatch(/ray::ServeReplica|Traceback|File "/);
    expect(raw).toMatch(/rc=1|Error/);
  });
});
