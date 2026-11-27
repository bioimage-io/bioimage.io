import { test, expect } from '@playwright/test';
import fs from 'fs';
import { BASE_URL } from './baseUrl';

/**
 * The fine-tuning page's export flow, end to end, for the person who ran the
 * training.
 *
 * Asserted on a DOWNLOADABLE PACKAGE rather than on the dialog saying it
 * finished. The export builds a bioimage.io package server-side, creates a
 * staged artifact and pushes the weights into it; a dialog can report success
 * for any of those having happened, and only a signed download URL that really
 * answers shows the whole chain ran.
 *
 * REQUIRES a dataset of its own with a COMPLETED run that this token owns,
 * because `export_model` permits only the caller who started the run. That is
 * machine-specific, so both are named by the environment and this file skips
 * without them rather than inventing a fixture it cannot build in a browser:
 *
 *   EXPORT_DATASET_ALIAS=annotation-...  EXPORT_LABEL=cells \
 *   BIOENGINE_ENV_FILE=<env file with HYPHA_TOKEN> \
 *   E2E_BASE_URL=http://localhost:<port> \
 *   npx playwright test tests/colab-export-flow.spec.ts
 *
 * LIVE, and it WRITES: a successful run creates a staged model artifact under
 * the caller's own account. The test deletes it again and says so if it
 * cannot.
 */

const ALIAS = process.env.EXPORT_DATASET_ALIAS;
/**
 * Which run to export. Optional, and worth setting: a dataset accumulates
 * runs, `.first()` then means "whichever the page happens to list first", and
 * two runs of different model types produce packages that differ by a factor
 * of twenty-five in size and by whether they build at all.
 */
const RUN_ID = process.env.EXPORT_RUN_ID;
const LABEL = process.env.EXPORT_LABEL || 'cells';
const HYPHA_SERVER_URL = process.env.REACT_APP_HYPHA_SERVER_URL || 'https://hypha.aicell.io';
const AM = 'public/services/artifact-manager';

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

test.use({ baseURL: BASE_URL, viewport: { width: 1280, height: 1000 } });

test.describe('exporting a finished run as a model', () => {
  test.skip(!token, 'HYPHA_TOKEN not available');
  test.skip(!ALIAS, 'EXPORT_DATASET_ALIAS not set: needs a dataset with a run this token owns');

  test('reaches a package that really downloads', async ({ page }, testInfo) => {
    test.setTimeout(2_400_000);

    await page.addInitScript(({ t, expiry }) => {
      localStorage.setItem('token', t);
      localStorage.setItem('tokenExpiry', expiry);
      localStorage.setItem('bioimage-annotation-tutorial-seen', '1');
    }, { t: token!, expiry: new Date(Date.now() + 3 * 60 * 60 * 1000).toISOString() });

    await page.goto(`/#/colab/${ALIAS}/finetune`);

    // The run has to be LISTED as this dataset's before anything can be
    // exported from it: the page finds a dataset's runs by the `<alias>/`
    // prefix on the training label.
    // The CARD, which is the innermost div holding BOTH the id and the
    // button. Filtering on the id alone resolves to the little element that
    // prints the id, which has no button inside it.
    const runCard = RUN_ID
      ? page
        .locator('div')
        .filter({ hasText: RUN_ID })
        .filter({ has: page.getByRole('button', { name: /export as model/i }) })
        .last()
      : page;
    const exportButton = runCard.getByRole('button', { name: /export as model/i }).first();
    await expect(exportButton).toBeVisible({ timeout: 180_000 });
    await page.screenshot({ path: testInfo.outputPath('01-run-listed.png'), fullPage: true });

    await exportButton.click();
    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible({ timeout: 60_000 });

    const name = `Export flow check ${Date.now()}`;
    await dialog.getByPlaceholder(/My Cell Segmentation Model/i).fill(name);
    await page.screenshot({ path: testInfo.outputPath('02-dialog-filled.png'), fullPage: true });

    const logs: string[] = [];
    page.on('console', (m) => { if (/error|export/i.test(m.text())) logs.push(`${m.type()}: ${m.text().slice(0, 260)}`); });
    page.on('pageerror', (e) => logs.push(`pageerror: ${e.message.slice(0, 260)}`));
    await dialog.getByRole('button', { name: /^export as model$/i }).click();
    // The phase is logged while it runs, and it is not temporary scaffolding:
    // an export takes about a quarter of an hour, and a run that fails with
    // no line in the log leaves nothing to tell a service failure from a
    // selector that stopped matching. One line per fifteen seconds is cheap
    // and it is the only record of where a long run got to. It stops as soon
    // as the dialog reports a terminal state, so a passing run does not sit
    // in it.
    for (let i = 0; i < 120; i++) {
      await page.waitForTimeout(15_000);
      const count = await page.getByRole('dialog').count();
      let text = '';
      if (count > 0) text = (await page.getByRole('dialog').innerText()).replace(/\s+/g, ' ').slice(0, 220);
      console.log(`[export] t+${(i + 1) * 15}s dialogs=${count} :: ${text}`);
      if (count === 0 || /exported and staged|failed/i.test(text)) break;
    }
    console.log('[export] CONSOLE', JSON.stringify(logs.slice(0, 12)));

    // The export builds, creates and pushes. Each phase can take minutes, and
    // the dialog is the only progress there is.
    await expect(dialog.getByText(/exported and staged for review/i)).toBeVisible({
      timeout: 1_800_000,
    });
    await page.screenshot({ path: testInfo.outputPath('03-exported.png'), fullPage: true });

    // THE ASSERTION THAT MATTERS. A link whose href is signed and which really
    // answers, not a sentence saying it worked.
    const download = dialog.getByRole('link', { name: /download package/i });
    await expect(download).toBeVisible();
    const href = await download.getAttribute('href');
    expect(href, 'the done panel must carry a signed download URL').toBeTruthy();

    // THE SIZE COMES FROM A RANGED REQUEST, not from the length of a body
    // this test read, and that distinction is a measured one. Reading the
    // whole object here returned 581,818,177 bytes for a package the store
    // reports as 1,072,179,768: a short read of 54%, which the old assertion
    // (`> 10_000`) accepted silently and which I then reported as the
    // package's size. `Content-Range` is answered by the store itself, so it
    // cannot be truncated on the way.
    const probe = await page.request.get(href!, { headers: { Range: 'bytes=0-0' } });
    expect(probe.status(), `the package URL must answer: ${href}`).toBe(206);
    const total = Number((probe.headers()['content-range'] || '').split('/')[1]);
    console.log(`[export] package is ${total} bytes at ${href!.split('?')[0]}`);
    // A real package, not an error document served with a 200. A cellpose
    // export is over a gigabyte, so this is two orders of magnitude below
    // what it should be and still rules out an error page.
    expect(total).toBeGreaterThan(10_000_000);

    // And bytes really flow, since a size in a header is not a download.
    const chunk = await page.request.get(href!, { headers: { Range: 'bytes=0-1048575' } });
    expect(chunk.status()).toBe(206);
    expect((await chunk.body()).length).toBe(1_048_576);
    // The first four bytes of a zip, so what arrives is the archive and not
    // an error document the store served inside a 206.
    const head4 = (await chunk.body()).subarray(0, 4);
    expect(head4[0]).toBe(0x50);
    expect(head4[1]).toBe(0x4b);

    // CLEAN UP the artifact this created, and say so if it cannot be removed.
    const artifactLink = dialog.getByRole('link', { name: /open artifact page/i });
    const artifactHref = await artifactLink.getAttribute('href');
    const artifactId = decodeURIComponent((artifactHref || '').replace(/^#\/edit\//, '').replace(/\/stage$/, ''));
    console.log(`[export] created artifact ${artifactId}`);
    if (artifactId) {
      const res2 = await fetch(`${HYPHA_SERVER_URL}/${AM}/delete`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ artifact_id: artifactId }),
      });
      console.log(`[export] cleanup delete -> ${res2.status}`);
    }
  });
});
