import { test, expect } from '@playwright/test';
import { BASE_URL } from './baseUrl';

/**
 * The SLURM worker setup wizard must attach pass-through argument values with
 * `=`, not separate them with a space.
 *
 * The worker parses its command line with argparse, which accepts a value
 * beginning with `-` only when that value ALSO contains a space. The shell
 * removes the wizard's quotes before argparse sees the token, so the
 * space-separated form `--further-slurm-args "--reservation=bioengine"` reaches
 * the worker as two flags and it exits 2 with "expected one argument". A single
 * directive, which is the common case (a SLURM reservation is exactly one), has
 * no space in it and is therefore exactly the shape that failed.
 *
 * `scripts/check-slurm-arg-quoting.js` checks the helper and the call sites
 * without a browser. This spec checks the thing a user actually copies: the
 * command text rendered on the page. The two are not redundant. The guard
 * cannot see a value mangled on its way from the input field into the command,
 * and this spec cannot see a fourth flag added the old way in a branch the
 * wizard does not reach with these settings.
 */

test.use({ baseURL: BASE_URL, viewport: { width: 1280, height: 900 } });

/**
 * `?mode=human` is load-bearing. The guide defaults to the AI-agent prompt,
 * which renders no wizard and no command at all, so without this the spec times
 * out on a page that is behaving exactly as designed.
 */
const SETUP_URL = '/#/bioengine/worker-setup?mode=human';

/** Select HPC Cluster mode and open every Advanced Options disclosure, which is
 *  where the three pass-through fields live. */
async function openSlurmWizard(page: import('@playwright/test').Page) {
  await page.goto(SETUP_URL);
  const slurm = page.locator('input[name="deployment-mode"][value="slurm"]');
  await expect(slurm).toBeVisible({ timeout: 30000 });
  await slurm.check();

  // Two separate disclosures render under this mode. Expanding by aria-expanded
  // rather than by index means a third one appearing does not silently leave a
  // field hidden and the assertion passing on a command that omits it.
  const toggles = page.locator('button[aria-expanded]');
  const count = await toggles.count();
  let expanded = 0;
  for (let i = 0; i < count; i += 1) {
    const t = toggles.nth(i);
    if ((await t.getAttribute('aria-expanded')) === 'false') {
      await t.scrollIntoViewIfNeeded();
      await t.click();
      expanded += 1;
    }
  }
  expect(expanded, 'at least one Advanced Options disclosure should have been opened').toBeGreaterThan(0);
}

/**
 * Locate a wizard field by the text of the label above it.
 *
 * `getByLabel` does not work on this page: the labels are visual only, with no
 * `htmlFor`/`id` linkage to their inputs, so the accessible name is empty and
 * every `getByLabel` call here times out. That is a real accessibility gap in
 * the wizard, but fixing it touches every field in the form and is not what
 * this spec is for, so these locators walk the DOM instead.
 */
function fieldByLabel(page: import('@playwright/test').Page, label: string, tag: 'input' | 'select') {
  return page.locator(
    `xpath=//label[normalize-space(text())=${JSON.stringify(label)}]/following-sibling::${tag}[1]`
  );
}

/** The rendered start command, read from the dark <pre> that holds it. */
async function slurmCommand(page: import('@playwright/test').Page): Promise<string> {
  const pre = page.locator('pre', { hasText: 'start_hpc_worker.sh' });
  await expect(pre.first()).toBeVisible();
  return (await pre.first().innerText()).replace(/\\\n\s+/g, ' ');
}

test('a single SLURM directive is attached with = and not separated by a space', async ({ page }) => {
  await openSlurmWizard(page);

  const field = fieldByLabel(page, 'Further SLURM Args', 'input');
  await field.scrollIntoViewIfNeeded();
  await field.fill('--reservation=bioengine');

  const cmd = await slurmCommand(page);
  expect(cmd).toContain('--further-slurm-args="--reservation=bioengine"');
  // The broken form, spelled out so a failure says which shape it found.
  expect(cmd).not.toContain('--further-slurm-args "');
});

test('a multi-directive SLURM value keeps working, quoted as one shell token', async ({ page }) => {
  await openSlurmWizard(page);

  const field = fieldByLabel(page, 'Further SLURM Args', 'input');
  await field.scrollIntoViewIfNeeded();
  // This value contains a space, so it parsed before the fix too. It is here to
  // show the fix did not trade one broken case for another.
  await field.fill('--account=naiss-1234 --partition=gpu');

  const cmd = await slurmCommand(page);
  expect(cmd).toContain('--further-slurm-args="--account=naiss-1234 --partition=gpu"');
});

test('a single Apptainer flag is attached with =', async ({ page }) => {
  await openSlurmWizard(page);

  const field = fieldByLabel(page, 'Further Apptainer Args', 'input');
  await field.scrollIntoViewIfNeeded();
  await field.fill('--writable-tmpfs');

  const cmd = await slurmCommand(page);
  expect(cmd).toContain('--further-apptainer-args="--writable-tmpfs"');
  expect(cmd).not.toContain('--further-apptainer-args "');
});

test('the gres GPU directive option emits a command the worker accepts', async ({ page }) => {
  await openSlurmWizard(page);

  // This select has three options and only one of them is both non-default and
  // non-empty, so before the fix the single real choice a user could make here
  // produced a worker that refused to start.
  const select = fieldByLabel(page, 'GPU sbatch directive', 'select');
  await select.scrollIntoViewIfNeeded();
  await select.selectOption('--gres=gpu:{n}');

  const cmd = await slurmCommand(page);
  expect(cmd).toContain('--gpu-slurm-flag="--gres=gpu:{n}"');
  expect(cmd).not.toContain('--gpu-slurm-flag "');
});

test('omitting the GPU directive still emits an empty value, not a bare flag', async ({ page }) => {
  await openSlurmWizard(page);

  const select = fieldByLabel(page, 'GPU sbatch directive', 'select');
  await select.scrollIntoViewIfNeeded();
  await select.selectOption('');

  const cmd = await slurmCommand(page);
  // A bare `--gpu-slurm-flag` with nothing after it would swallow the next flag.
  expect(cmd).toContain('--gpu-slurm-flag=""');
});

test('the default GPU directive is still omitted from the command entirely', async ({ page }) => {
  await openSlurmWizard(page);

  // Nothing touched: the default matches the worker's own default, so emitting
  // it would be noise. This is the control for the two tests above, which would
  // both also pass if the flag were suddenly always emitted.
  const cmd = await slurmCommand(page);
  expect(cmd).not.toContain('--gpu-slurm-flag');
});
