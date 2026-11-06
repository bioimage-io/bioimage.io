import { test, expect, Page } from '@playwright/test';
import { BASE_URL } from './baseUrl';

/**
 * The worker setup wizard must be able to join the host resource census and to
 * move its directory, and must emit NOTHING about it when left alone.
 *
 * The census is NOT a worker argument, which is why nothing here looks for a
 * `--census` flag. Measured against ghcr.io/aicell-lab/bioengine-worker:0.16.92:
 * `python -m bioengine.worker --help` lists 56 flags and none of them match
 * census or host, while `bioengine worker start --help` lists --census,
 * --census-dir and --no-census. Those launcher options are translated into a
 * bind mount plus environment variables, and bioengine/utils/host_census.py
 * reads the directory from BIOENGINE_HOST_CENSUS_DIR (its census_dir() returns
 * None when the variable is unset).
 *
 * The wizard emits a plain container run rather than going through the
 * launcher, so the census is OFF in today's command and this is an opt-IN
 * control. That is also why the default-emits-nothing case below is the
 * important one: it is what keeps every existing user's command unchanged.
 *
 * apptainer and singularity take no `-e`. They read host variables under a
 * runtime-specific prefix (_SIF_ENV_PREFIX in bioengine/cli/worker.py), so the
 * prefix cases are load-bearing rather than cosmetic: an `-e` on an apptainer
 * line is silently dropped and the worker would never join the census.
 *
 * `getByLabel` resolves nothing on these pages: the labels are visual only,
 * with no htmlFor/id, so everything is located by xpath off the label text.
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

const CENSUS_LABEL = 'Host Resource Census';
const CONTAINER_DIR = '/.bioengine-hosts';
const DIR_ENV = 'BIOENGINE_HOST_CENSUS_DIR';
const ID_ENV = 'BIOENGINE_WORKER_ID';

function fieldByLabel(page: Page, label: string, tag: 'input' | 'select') {
  return page.locator(
    `xpath=//label[normalize-space(text())=${JSON.stringify(label)}]/following::${tag}[1]`,
  );
}

/** The census checkbox sits under its own label, next to a text input that only
 *  appears once it is ticked, so it is addressed by type rather than position. */
function censusCheckbox(page: Page) {
  return page.locator(
    `xpath=//label[normalize-space(text())=${JSON.stringify(CENSUS_LABEL)}]` +
      `/following::input[@type="checkbox"][1]`,
  );
}

/**
 * The census directory field, which only exists while the box is ticked.
 *
 * Located by its placeholder, NOT by `following::input[@type="text"][1]` off the
 * label. `following::` is document order rather than a subtree, so when the
 * field is absent that xpath silently resolves to the next unrelated text input
 * further down the form (the Authentication Token field) and a count assertion
 * passes for the wrong reason. Measured: it returned 1 where 0 was expected.
 */
function censusDirField(page: Page) {
  return page.locator('input[placeholder$=".bioengine-hosts"]');
}

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
  expect(expanded, 'at least one disclosure should have been opened').toBeGreaterThan(0);
}

/** The generated run command, with shell line continuations folded out. */
async function command(page: Page): Promise<string> {
  const pre = page.locator('pre', { hasText: 'python -m bioengine.worker' });
  await expect(pre.first()).toBeVisible({ timeout: 20000 });
  return (await pre.first().innerText()).replace(/\\\n\s+/g, ' ');
}

/** The mkdir line the wizard tells the user to run first. */
async function mkdirCommand(page: Page): Promise<string> {
  const pre = page.locator('pre', { hasText: 'mkdir' });
  await expect(pre.first()).toBeVisible({ timeout: 20000 });
  return (await pre.first().innerText()).replace(/\\\n\s+/g, ' ');
}

async function setRuntime(page: Page, value: string) {
  const select = fieldByLabel(page, 'Container Runtime', 'select');
  await select.scrollIntoViewIfNeeded();
  await select.selectOption(value);
}

async function enableCensus(page: Page) {
  const box = censusCheckbox(page);
  await box.scrollIntoViewIfNeeded();
  await box.check();
  await expect(box).toBeChecked();
}

test('the default says nothing about the census, so an untouched command is unchanged', async ({ page }) => {
  await openWizard(page);

  // The control is present and off. Asserting it exists means a later rename
  // reds this rather than making the no-emit assertion pass for the wrong
  // reason.
  await expect(censusCheckbox(page)).not.toBeChecked();

  const cmd = await command(page);
  expect(cmd).not.toContain(DIR_ENV);
  expect(cmd).not.toContain(ID_ENV);
  expect(cmd).not.toContain('bioengine-hosts');
  // The directory field does not exist until the box is ticked.
  await expect(censusDirField(page)).toHaveCount(0);
  // Control: the command IS being read, and does carry the unrelated flags, so
  // the absences above are not an empty string passing three assertions.
  expect(cmd).toContain('python -m bioengine.worker');
  expect(cmd).toContain('-v $HOME/.bioengine:/.bioengine');
});

test('docker joins the census with an env var and a mount, and says to create the directory', async ({ page }) => {
  await openWizard(page);
  await enableCensus(page);

  const cmd = await command(page);
  expect(cmd).toContain(`-e ${DIR_ENV}="${CONTAINER_DIR}"`);
  expect(cmd).toContain(`-v $HOME/.bioengine-hosts:${CONTAINER_DIR}`);
  // Still not a worker argument: it must sit before the image, not after the
  // entrypoint, or the runtime never sees it.
  expect(cmd.indexOf(DIR_ENV)).toBeLessThan(cmd.indexOf('python -m bioengine.worker'));

  // Bound by the runtime before the worker starts, so the directory has to
  // exist or docker creates it root-owned and the worker cannot write to it.
  expect(await mkdirCommand(page)).toContain('$HOME/.bioengine-hosts');
});

test('the census directory can be overridden, and the container side does not move', async ({ page }) => {
  await openWizard(page);
  await enableCensus(page);

  const dir = censusDirField(page);
  await dir.scrollIntoViewIfNeeded();
  await dir.fill('/srv/shared/hosts');

  const cmd = await command(page);
  expect(cmd).toContain(`-v /srv/shared/hosts:${CONTAINER_DIR}`);
  expect(cmd).not.toContain('$HOME/.bioengine-hosts');
  // The container path is fixed: every worker on the host has to agree on it,
  // and it is what the env var names.
  expect(cmd).toContain(`-e ${DIR_ENV}="${CONTAINER_DIR}"`);
  expect(await mkdirCommand(page)).toContain('/srv/shared/hosts');
});

test('a named worker advertises that name, and an unnamed one does not invent a label', async ({ page }) => {
  await openWizard(page);
  await enableCensus(page);

  // Worker Name is empty by default, so there is nothing legible to advertise
  // and the worker falls back to its hostname.
  expect(await command(page)).not.toContain(ID_ENV);

  const name = fieldByLabel(page, 'Worker Name', 'input');
  await name.scrollIntoViewIfNeeded();
  await name.fill('Lab GPU box');

  // Quoted, because the name may contain spaces and this lands on a shell line.
  expect(await command(page)).toContain(`-e ${ID_ENV}="Lab GPU box"`);
});

for (const [runtime, prefix] of [
  ['apptainer', 'APPTAINERENV_'],
  ['singularity', 'SINGULARITYENV_'],
] as const) {
  test(`${runtime} gets the ${prefix} prefix and never a bare -e`, async ({ page }) => {
    await openWizard(page);
    await enableCensus(page);
    const name = fieldByLabel(page, 'Worker Name', 'input');
    await name.scrollIntoViewIfNeeded();
    await name.fill('Lab GPU box');
    await setRuntime(page, runtime);

    const cmd = await command(page);
    expect(cmd).toContain(`${runtime} exec`);
    expect(cmd).toContain(`${prefix}${DIR_ENV}="${CONTAINER_DIR}"`);
    expect(cmd).toContain(`${prefix}${ID_ENV}="Lab GPU box"`);
    expect(cmd).toContain(`--bind $HOME/.bioengine-hosts:${CONTAINER_DIR}`);

    // The whole point of the prefix: a bare -e is accepted by the shell, dropped
    // by apptainer, and the worker would never join the census.
    expect(cmd).not.toContain(`-e ${DIR_ENV}`);
    expect(cmd).not.toMatch(/ -e /);
    // And the other runtime's prefix must not leak in.
    const otherPrefix = prefix === 'APPTAINERENV_' ? 'SINGULARITYENV_' : 'APPTAINERENV_';
    expect(cmd).not.toContain(otherPrefix);

    // The env assignments are a prefix of the command line, not arguments to
    // the runtime, so they have to precede `<runtime> exec`.
    expect(cmd.indexOf(`${prefix}${DIR_ENV}`)).toBeLessThan(cmd.indexOf(`${runtime} exec`));
  });
}

test('turning the census back off removes every trace of it', async ({ page }) => {
  await openWizard(page);
  await enableCensus(page);
  await censusDirField(page).fill('/srv/shared/hosts');
  expect(await command(page)).toContain('/srv/shared/hosts');

  const box = censusCheckbox(page);
  await box.scrollIntoViewIfNeeded();
  await box.uncheck();

  // A value typed and then abandoned must not survive in the command, which is
  // the same leak the runtime gating is there to prevent.
  const cmd = await command(page);
  expect(cmd).not.toContain('/srv/shared/hosts');
  expect(cmd).not.toContain(DIR_ENV);
  expect(cmd).not.toContain('bioengine-hosts');
  expect(await mkdirCommand(page)).not.toContain('/srv/shared/hosts');
});
