import { test, expect, Page } from '@playwright/test';
import * as fs from 'fs';
import * as path from 'path';
import { BASE_URL } from './baseUrl';

/**
 * The worker setup wizard's default image tag (#0048).
 *
 * The pin sat at 0.16.1 while 0.16.92 was published, so every user who took the
 * default got a worker 91 releases old. `scripts/check-prebuilt-image-tags.js`
 * is what keeps the constant current; this spec is the other half, and the two
 * are not redundant. The guard can only see the constant. It cannot see whether
 * the constant reaches the command a user actually copies, which is the thing
 * that was broken.
 *
 * The expected tag is READ FROM THE SOURCE rather than written here. Hardcoding
 * it would mean every future bump reds this spec for no reason, and the pressure
 * that creates is to delete the assertion. What is hardcoded is 0.16.1, as a
 * value that must never reappear.
 *
 * Run against a dev server:
 *   PORT=3021 BROWSER=none ./node_modules/.bin/react-scripts start
 *   E2E_BASE_URL=http://localhost:3021 npx playwright test tests/worker-setup-default-image.spec.ts
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

const SETUP_URL = '/#/bioengine/worker-setup?mode=human';

/** The tag that must never come back. */
const RETIRED_TAG = '0.16.1';

/**
 * Read DEFAULT_IMAGE_VERSION out of the component, so a bump does not red this
 * file. Extraction failing is a hard error rather than a skip: a spec that
 * quietly tests nothing is the failure this issue is about.
 */
function pinnedVersion(): string {
  const src = fs.readFileSync(
    path.join(__dirname, '..', 'src', 'components', 'bioengine', 'BioEngineGuide.tsx'),
    'utf8',
  );
  const m = src.match(/const DEFAULT_IMAGE_VERSION = '([^']+)';/);
  if (!m) {
    throw new Error(
      'could not read DEFAULT_IMAGE_VERSION from BioEngineGuide.tsx. It was renamed or reshaped, ' +
        'and this spec would otherwise have asserted nothing. Fix the regex before trusting a pass.',
    );
  }
  return m[1];
}

const VERSION = pinnedVersion();

async function openWizard(page: Page, mode: string) {
  await page.goto(SETUP_URL);
  const radio = page.locator(`input[name="deployment-mode"][value="${mode}"]`);
  await expect(radio).toBeVisible({ timeout: 30000 });
  await radio.check();
}

/** Every rendered command block on the page, joined, with line continuations
 *  folded out. Joining rather than picking one means a tag that appears in a
 *  block this spec did not think to look at is still caught. */
async function allCommands(page: Page): Promise<string> {
  const pres = page.locator('pre');
  await expect(pres.first()).toBeVisible({ timeout: 20000 });
  const texts = await pres.allInnerTexts();
  return texts.join('\n').replace(/\\\n\s+/g, ' ');
}

test('the pinned version is not the retired one', async () => {
  // A plain guard on the constant, so the reason the cases below pass is
  // visible without reading them.
  expect(VERSION).not.toBe(RETIRED_TAG);
});

for (const mode of ['single-machine', 'external-cluster']) {
  test(`${mode}: the emitted command carries the pinned tag and never ${RETIRED_TAG}`, async ({ page }) => {
    await openWizard(page, mode);

    const cmd = await allCommands(page);
    expect(cmd).toContain(`ghcr.io/aicell-lab/bioengine-worker:${VERSION}`);
    expect(cmd).not.toContain(`bioengine-worker:${RETIRED_TAG}`);
  });
}

test('slurm names no image at all unless one is typed, so the pin does not govern it', async ({ page }) => {
  await openWizard(page, 'slurm');

  // Measured, not assumed, and the opposite of what this case first asserted.
  // The SLURM command is `bash <(curl ... start_hpc_worker.sh)`, and
  // BioEngineGuide.tsx only pushes `--image` when the user has typed a custom
  // one. So on this path the image version is start_hpc_worker.sh's decision,
  // not the wizard's, and asserting the pin here would be asserting something
  // the wizard does not control. What still has to hold is that the retired tag
  // cannot appear.
  const cmd = await allCommands(page);
  expect(cmd).toContain('start_hpc_worker.sh');
  expect(cmd).not.toContain(`bioengine-worker:${RETIRED_TAG}`);
  expect(cmd).not.toContain('--image ');
});

test('a custom image still wins over the default', async ({ page }) => {
  await openWizard(page, 'single-machine');

  const toggles = page.locator('button[aria-expanded]');
  const n = await toggles.count();
  for (let i = 0; i < n; i += 1) {
    const t = toggles.nth(i);
    if ((await t.getAttribute('aria-expanded')) === 'false') {
      await t.scrollIntoViewIfNeeded();
      await t.click();
    }
  }

  // Located by PLACEHOLDER, which is the default image itself. That makes the
  // locator do double duty: finding the field at all is evidence the field
  // advertises the pinned tag as what you get by leaving it empty. An xpath off
  // the "Container Image" label would not, and would also have to step over the
  // preset picker that sits between the label and this input.
  const field = page.getByPlaceholder(`ghcr.io/aicell-lab/bioengine-worker:${VERSION}`);
  if ((await field.count()) === 0) {
    throw new Error(
      `no input whose placeholder is the default image ghcr.io/aicell-lab/bioengine-worker:${VERSION}; ` +
        'this case asserted nothing',
    );
  }
  await field.first().scrollIntoViewIfNeeded();
  await field.first().fill('ghcr.io/example/my-worker:1.2.3');

  // The control for the three cases above: they would also pass if the image
  // were hardcoded rather than read from state.
  const cmd = await allCommands(page);
  expect(cmd).toContain('ghcr.io/example/my-worker:1.2.3');
  expect(cmd).not.toContain(`ghcr.io/aicell-lab/bioengine-worker:${VERSION}`);
});

/**
 * DONE WHEN asks that the build-your-own-image instructions agree with the run
 * command. They are not in the single-machine flow: they live inside
 * `{mode === 'external-cluster' && ...}` and are further gated on a Ray version
 * being set, because their whole purpose is rebuilding the image on a different
 * Ray pin. Both gates have to be opened, or the block does not exist and a
 * search for it reports a broken page instead of a missing assertion.
 *
 * Two readers live in getDockerBuildCommand(): the `BIOENGINE_VERSION=` line and
 * a push tag of the form `<version>-ray<rayVersion>`. A third, which the issue
 * did not name, is the Kubernetes YAML's `image:` key. All of them interpolate
 * DEFAULT_IMAGE_VERSION, so what is guarded here is that they are still readers
 * of the constant rather than literals that drifted.
 */
test('the build-your-own-image instructions agree with the run command', async ({ page }) => {
  await openWizard(page, 'external-cluster');

  const toggles = page.locator('button[aria-expanded="false"]');
  for (let i = (await toggles.count()) - 1; i >= 0; i -= 1) {
    const t = toggles.nth(i);
    await t.scrollIntoViewIfNeeded();
    await t.click();
  }

  const rayField = page.locator(
    'xpath=//label[normalize-space(text())="Ray Version"]/following::input[@type="text"][1]',
  );
  await expect(rayField.first()).toBeVisible({ timeout: 20000 });
  await rayField.first().scrollIntoViewIfNeeded();
  await rayField.first().fill('2.55.1');

  const cmd = await allCommands(page);
  if (!cmd.includes('BIOENGINE_VERSION=')) {
    throw new Error(
      'the docker build block is not on the page, so this case asserted nothing. Its two gates are ' +
        "mode === 'external-cluster' and a non-empty Ray Version.",
    );
  }
  expect(cmd).toContain(`BIOENGINE_VERSION=${VERSION}`);
  expect(cmd).toContain('bioengine-worker:${BIOENGINE_VERSION}-ray');
  expect(cmd).not.toContain(RETIRED_TAG);
});

/**
 * A floating or placeholder tag would satisfy every assertion above while making
 * the generated command unreproducible: `latest` moves under the user, and a
 * pre-release is not something to hand someone setting up their first worker.
 */
test('the pin is a plain release tag, not latest or a pre-release', async ({ page }) => {
  expect(VERSION).toMatch(/^\d+\.\d+\.\d+$/);
  await openWizard(page, 'single-machine');
  expect(await allCommands(page)).not.toContain('bioengine-worker:latest');
});
