/**
 * Worker setup wizard: the CDI opt-in checkbox and the two popovers around it.
 *
 * scripts/check-gpu-flag.js already pins the pure `getGpuFlag()` truth table.
 * What it cannot see is the panel a human actually reads: whether the checkbox
 * renders at all, whether ticking it changes the command that gets copied, and
 * whether the two popovers still agree with each other. The CDI story was
 * implemented twice (merged eae73b7 and stranded 4228b16) and the failure mode
 * was one panel telling the reader to swap the flag by hand while a checkbox
 * underneath it did the same job. These assertions are what keeps that from
 * silently coming back.
 *
 * Needs a dev server for this checkout:
 *   BROWSER=none PORT=3021 ./node_modules/.bin/react-scripts start
 *   E2E_BASE_URL=http://localhost:3021 npx playwright test tests/worker-setup-cdi.spec.ts
 *
 * No network side effects: the wizard only composes a command string.
 */
import { test, expect } from '@playwright/test';
import { BASE_URL } from './baseUrl';

test.use({ baseURL: BASE_URL, viewport: { width: 1280, height: 900 } });

/**
 * `?mode=human` is load-bearing. The guide defaults to the AI-agent prompt,
 * which renders no wizard and no docker command at all, so without this the
 * spec times out on a page that is behaving exactly as designed.
 */
const SETUP_URL = '/#/bioengine/worker-setup?mode=human';

/** Read the GPU flag out of the docker command the wizard offers to copy. */
async function gpuFlagInCommand(page: import('@playwright/test').Page) {
  const command = await page.evaluate(() => {
    const el = [...document.querySelectorAll('pre, code')]
      .map((e) => e.textContent || '')
      .find(
        (s) =>
          s.includes('docker run') &&
          (s.includes('--gpus=all') || s.includes('nvidia.com/gpu=all'))
      );
    return el || '(no docker run command rendered)';
  });
  const match = command.match(/(--gpus=all|--device nvidia\.com\/gpu=all)/);
  return match ? match[1] : `(no GPU flag in: ${command.slice(0, 120)})`;
}

/**
 * Only one InfoPopover can be open at a time: each lays a full-screen
 * click-away overlay over the page, so clicking a second trigger merely
 * dismisses the first. Escape closes the open one.
 *
 * The scroll settle is not padding. InfoPopover closes itself on any scroll,
 * because its panel is `position: fixed` and anchored to where the trigger
 * was, so a scrolling page would tear the two apart. Playwright scrolls the
 * trigger into view as part of the click, and the trailing scroll events then
 * land after React has opened the panel and close it again. A human clicking a
 * button already on screen never scrolls, so this is a harness artefact, not a
 * defect: settle the scroll, then click.
 */
async function openPopover(page: import('@playwright/test').Page, label: string) {
  const trigger = page.getByRole('button', { name: label }).first();
  await trigger.scrollIntoViewIfNeeded();
  await page.waitForTimeout(400);
  await trigger.click();
  await expect(page.locator('div[style*="z-index: 999"]')).toBeVisible();
  return (await page.evaluate(() => document.body.innerText)) as string;
}

test.describe('worker setup wizard: CDI opt-in', () => {
  test('the checkbox rewrites the GPU flag in the copied command', async ({ page }) => {
    await page.goto(SETUP_URL);

    const label = page.getByText(/Use CDI/).last();
    await expect(label).toBeVisible({ timeout: 60000 });
    expect((await label.innerText()).replace(/\s+/g, ' ')).toBe(
      'Use CDI (--device nvidia.com/gpu=all) instead of --gpus=all'
    );

    const checkbox = label.locator('xpath=ancestor::label[1]//input[@type="checkbox"]');
    await expect(checkbox).not.toBeChecked();

    // `--gpus=all` stays the default: it is the form that works on any host
    // with the NVIDIA Container Toolkit, and CDI needs host setup on top.
    expect(await gpuFlagInCommand(page)).toBe('--gpus=all');

    await checkbox.check();
    expect(await gpuFlagInCommand(page)).toBe('--device nvidia.com/gpu=all');

    await checkbox.uncheck();
    expect(await gpuFlagInCommand(page)).toBe('--gpus=all');
  });

  test('the GPU popover gives the reason and points at the checkbox', async ({ page }) => {
    await page.goto(SETUP_URL);
    await expect(page.getByText(/Use CDI/).last()).toBeVisible({ timeout: 60000 });

    const text = await openPopover(page, 'GPU info');

    // The WHY, which the merged commit contributed and which must survive.
    expect(text, 'cgroup-reconcile motivation is missing').toMatch(/cgroup reconcile/i);
    // The HOW is the checkbox, not an instruction to edit the command text.
    expect(text, 'popover does not send the reader to the toggle').toMatch(/tick the box below/i);
    expect(text, 'popover still tells the reader to edit the flag by hand').not.toMatch(
      /swap the flag/i
    );
  });

  test('the CDI popover states BOTH prerequisites and one spec path', async ({ page }) => {
    await page.goto(SETUP_URL);
    await expect(page.getByText(/Use CDI/).last()).toBeVisible({ timeout: 60000 });

    const text = await openPopover(page, 'CDI info');
    expect(text, 'CDI popover did not open').toMatch(/Only tick this if you already use CDI/);

    // Prerequisite 1: a CDI spec on the host. Check first, then generate a
    // persistent one; /var/run/cdi is tmpfs and a worker meant to stay up for
    // days will lose it at the next reboot.
    expect(text).toMatch(/nvidia-ctk cdi list/);
    expect(text).toMatch(/does not survive a reboot/);
    expect(text).toMatch(/--output=\/etc\/cdi\/nvidia\.yaml/);

    // Prerequisite 2, the one the merged version omitted entirely. Without it
    // an older daemon just fails to start the container.
    expect(text, 'Docker daemon prerequisite is missing').toMatch(/28\.3\.0/);
    expect(text).toMatch(/daemon\.json/);
  });

  test('the CDI toggle is Docker-only and GPU-only', async ({ page }) => {
    await page.goto(SETUP_URL);
    const label = page.getByText(/Use CDI/).last();
    await expect(label).toBeVisible({ timeout: 60000 });

    // Podman already emits the CDI form unconditionally and apptainer uses
    // --nv, so offering the toggle there would be a control that does nothing.
    // Selects, in DOM order: Operating System, Container Runtime.
    const runtime = page.locator('select').nth(1);
    await expect(runtime).toHaveValue('docker');
    await runtime.selectOption('podman');
    await expect(label).toBeHidden();

    await runtime.selectOption('docker');
    await expect(label).toBeVisible();

    // No GPUs requested means no GPU flag at all, so there is nothing to pick.
    // Number inputs, in DOM order: Shared Memory Size, CPU Cores, GPUs, Memory.
    const gpus = page.locator('input[type="number"]').nth(2);
    await expect(gpus).toHaveValue('1');
    await gpus.fill('0');
    await expect(label).toBeHidden();
  });
});
