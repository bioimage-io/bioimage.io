import { test, expect, Page } from '@playwright/test';
import { BASE_URL } from './baseUrl';

/**
 * The worker setup wizard's Container Memory Limit field (#0042).
 *
 * `--memory` is a flag of the container RUNTIME, not of the worker: the wizard
 * emits `docker run <flags> <image> python -m bioengine.worker <args>`, and the
 * worker's own argparse has no --memory, so the flag has to land before the
 * image name or the worker aborts with argparse exit 2. These cases check
 * exactly that placement, that the default emits nothing at all, and that
 * apptainer and singularity never get it.
 *
 * Run against a dev server:
 *   PORT=3021 BROWSER=none ./node_modules/.bin/react-scripts start
 *   E2E_BASE_URL=http://localhost:3021 npx playwright test tests/worker-setup-container-memory.spec.ts
 */

const VIEWPORT = { width: 1280, height: 900 };

test.use({
  baseURL: BASE_URL,
  viewport: VIEWPORT,
  serviceWorkers: 'block',
  launchOptions: { args: ['--disable-gpu', '--no-sandbox'] },
});

test.beforeAll(() => {
  console.log(`viewport: ${VIEWPORT.width}x${VIEWPORT.height}`);
});

/** `?mode=human` is load-bearing: the guide defaults to the AI-agent prompt,
 *  which renders no wizard and no command at all. */
const SETUP_URL = '/#/bioengine/worker-setup?mode=human';

const FIELD = 'Container Memory Limit (GB)';

/**
 * Locate a wizard field by the text of its label.
 *
 * `getByLabel` does not work on this page: the labels are visual only, with no
 * `htmlFor`/`id` linkage, so the accessible name is empty and the call times
 * out. `following::` rather than `following-sibling::` because some labels sit
 * inside a flex wrapper with their info popover while the input is the
 * wrapper's sibling, and some are siblings of the input directly.
 */
function fieldByLabel(page: Page, label: string, tag: 'input' | 'select') {
  return page.locator(
    `xpath=//label[normalize-space(text())=${JSON.stringify(label)}]/following::${tag}[1]`
  );
}

/** Open the single-machine wizard with every Advanced Options disclosure
 *  expanded, which is where the memory fields live. */
async function openWizard(page: Page) {
  await page.goto(SETUP_URL);
  const single = page.locator('input[name="deployment-mode"][value="single-machine"]');
  await expect(single).toBeVisible({ timeout: 30000 });
  await single.check();

  // Expanding by aria-expanded rather than by index means a new disclosure
  // appearing does not silently leave a field hidden with the assertion passing.
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

/** The generated run command, with the shell line continuations folded out. */
async function command(page: Page): Promise<string> {
  const pre = page.locator('pre', { hasText: 'python -m bioengine.worker' });
  await expect(pre.first()).toBeVisible({ timeout: 20000 });
  return (await pre.first().innerText()).replace(/\\\n\s+/g, ' ');
}

async function setRuntime(page: Page, value: string) {
  const select = fieldByLabel(page, 'Container Runtime', 'select');
  await select.scrollIntoViewIfNeeded();
  await select.selectOption(value);
}

test('the default emits no --memory at all', async ({ page }) => {
  await openWizard(page);

  await expect(fieldByLabel(page, FIELD, 'input')).toHaveValue('0');
  const cmd = await command(page);
  expect(cmd).not.toContain('--memory');
  // The control: the adjacent runtime flag IS emitted by default, so a command
  // that simply failed to render would not pass this.
  expect(cmd).toContain('--shm-size=');
});

test('a cap is emitted as a runtime flag, attached with = and before the image', async ({ page }) => {
  await openWizard(page);

  const field = fieldByLabel(page, FIELD, 'input');
  await field.scrollIntoViewIfNeeded();
  await field.fill('64');

  const cmd = await command(page);
  expect(cmd).toContain('--memory=64g');
  // Never space-separated: a dash-leading value with no space in it is the
  // shape Python argparse rejects (#0027), and docker's own parser is happier
  // with the attached form too.
  expect(cmd).not.toContain('--memory 64g');

  // Placement is the whole point. The worker's argparse has no --memory, so the
  // flag must appear before the image name, where the runtime consumes it.
  const memoryAt = cmd.indexOf('--memory=');
  const workerAt = cmd.indexOf('python -m bioengine.worker');
  expect(memoryAt).toBeGreaterThan(-1);
  expect(workerAt).toBeGreaterThan(-1);
  expect(memoryAt, '--memory must precede the image and the worker entrypoint').toBeLessThan(workerAt);
});

test('podman gets the cap too', async ({ page }) => {
  await openWizard(page);
  await setRuntime(page, 'podman');

  const field = fieldByLabel(page, FIELD, 'input');
  await field.scrollIntoViewIfNeeded();
  await field.fill('32');

  const cmd = await command(page);
  expect(cmd).toContain('podman run');
  expect(cmd).toContain('--memory=32g');
});

for (const runtime of ['apptainer', 'singularity']) {
  test(`${runtime} hides the field and never emits --memory`, async ({ page }) => {
    await openWizard(page);

    // Set a cap while on docker first, so the absence below is the runtime
    // gate and not an unset value. This is what catches a stale state leak:
    // switching runtime does not reset the number, only hides the field.
    //
    // What this case does and does not prove, measured by mutation rather than
    // assumed. The guarantee is STRUCTURAL: the apptainer/singularity branch of
    // getCommand never interpolates `memoryFlag`. Deleting the runtime test from
    // the `memoryFlag` guard leaves 8 of 8 passing, so this case cannot red that
    // conjunct and never could, which is why the conjunct is gone. Adding
    // `memoryFlag` to that branch DOES red this case and its singularity twin
    // and nothing else, so it is a live guard on the regression that matters.
    const field = fieldByLabel(page, FIELD, 'input');
    await field.scrollIntoViewIfNeeded();
    await field.fill('48');
    expect(await command(page)).toContain('--memory=48g');

    await setRuntime(page, runtime);

    await expect(page.getByText(FIELD, { exact: true })).toHaveCount(0);
    const cmd = await command(page);
    expect(cmd).not.toContain('--memory');
    // And the runtime really did change, so this is not a command that failed
    // to re-render.
    expect(cmd).toContain(runtime);
  });
}

test('a cap at or below the Ray reservation plus shared memory warns', async ({ page }) => {
  await openWizard(page);

  const memory = fieldByLabel(page, 'Memory (GB)', 'input');
  await memory.scrollIntoViewIfNeeded();
  await memory.fill('24');

  const shm = fieldByLabel(page, 'Shared Memory Size (GB)', 'input');
  await shm.scrollIntoViewIfNeeded();
  const shmValue = parseInt((await shm.inputValue()) || '0', 10);

  const cap = fieldByLabel(page, FIELD, 'input');
  await cap.scrollIntoViewIfNeeded();

  // At the floor exactly: still a problem, because Ray can schedule into the
  // whole reservation and the object store needs its shared memory on top.
  await cap.fill(String(24 + shmValue));
  await expect(page.getByText(/Raise this above/)).toBeVisible();

  // One GB above the floor clears it. This is the control: without it the
  // assertion above would also pass for a warning that is always on.
  await cap.fill(String(24 + shmValue + 1));
  await expect(page.getByText(/Raise this above/)).toHaveCount(0);
});

test('CONTROL: the cap is not emitted in external-cluster mode', async ({ page }) => {
  await openWizard(page);

  const field = fieldByLabel(page, FIELD, 'input');
  await field.scrollIntoViewIfNeeded();
  await field.fill('64');
  expect(await command(page)).toContain('--memory=64g');

  // The flag is gated on single-machine, the only mode that renders the field.
  // A value set and then abandoned must not leak into a command that does not
  // show it.
  const other = page.locator('input[name="deployment-mode"][value="external-cluster"]');
  await other.scrollIntoViewIfNeeded();
  await other.check();

  const pre = page.locator('pre').filter({ hasText: 'bioengine' }).first();
  await expect(pre).toBeVisible({ timeout: 20000 });
  expect(await pre.innerText()).not.toContain('--memory');
});

/**
 * Writes the two desktop-viewport screenshots the issue thread shows. Kept as a
 * test rather than a script so the images and the assertions above are produced
 * by one command and cannot drift apart.
 */
test('SCREENSHOTS: the field at its default and with the warning showing', async ({ page }) => {
  await openWizard(page);

  const panel = page.locator('xpath=//h5[normalize-space(text())="Container & Compute"]/..');
  await expect(panel).toBeVisible();

  await panel.scrollIntoViewIfNeeded();
  await panel.screenshot({ path: 'tests/screenshots/0042-container-memory-default.png' });

  const cap = fieldByLabel(page, FIELD, 'input');
  await cap.scrollIntoViewIfNeeded();
  await cap.fill('16');
  await expect(page.getByText(/Raise this above/)).toBeVisible();
  await panel.screenshot({ path: 'tests/screenshots/0042-container-memory-warning.png' });

  // The copied command, which is the thing a user actually takes away.
  const cmd = await command(page);
  expect(cmd).toContain('--memory=16g');
  const pre = page.locator('pre', { hasText: 'python -m bioengine.worker' }).first();
  await pre.scrollIntoViewIfNeeded();
  await pre.screenshot({ path: 'tests/screenshots/0042-container-memory-command.png' });
});
