import { test, expect, Page } from '@playwright/test';
import fs from 'fs';
import { BASE_URL } from './baseUrl';

// Verification harness for issue #0035: the three live blockers the
// 2026-10-25 colab review found on the annotate page.
//
//   B2  save reported success even when the presigned PUT returned an HTTP error
//   B3  no unsaved-work protection anywhere
//   D3  a saved annotation was never restored into the viewer
//
// Requires a dev server (the production build compiles the dev-only seams out)
// and HYPHA_TOKEN. Point it at the PUBLIC tunnel, not localhost:
//
//   E2E_BASE_URL=https://tl-colab-dev-2bc6ffc3.hypha.run \
//     npx playwright test tests/annotate-save-reliability.spec.ts
//
// LIVE SIDE EFFECTS: test 3 writes a real annotation into the fixture dataset
// named below. Create a throwaway one with notes/verify/make_fixture.py and
// delete it afterwards. Do not point this at a dataset anyone is using.
//
// The tests run in order and share the fixture: 1 and 2 must run BEFORE 3,
// because they assume the image has no saved annotation yet.

test.use({ baseURL: BASE_URL });

const DATASET_ALIAS = process.env.FIXTURE_ALIAS || 'verify35-47a780080dae';
const LABEL = process.env.FIXTURE_LABEL || 'cells';
const STEM = process.env.FIXTURE_STEM || 'verify35_cells';

function readHyphaToken(): string | undefined {
  if (process.env.HYPHA_TOKEN) return process.env.HYPHA_TOKEN;
  try {
    const envText = fs.readFileSync('/data/nmechtel/bioimage.io/.env', 'utf8');
    return envText.match(/HYPHA_TOKEN=(\S+)/)?.[1];
  } catch {
    return undefined;
  }
}

const ANNOTATE_URL =
  `/#/colab/annotate?session_id=${encodeURIComponent(DATASET_ALIAS)}` +
  `&label=${encodeURIComponent(LABEL)}&image=${encodeURIComponent(STEM)}`;

async function seedToken(page: Page, token: string) {
  await page.addInitScript(
    ({ tok, expiry }) => {
      localStorage.setItem('token', tok);
      localStorage.setItem('tokenExpiry', expiry);
      // Otherwise the first-visit tutorial modal swallows every click.
      localStorage.setItem('bioimage-annotation-tutorial-seen', '1');
    },
    { tok: token, expiry: new Date(Date.now() + 3 * 60 * 60 * 1000).toISOString() },
  );
}

/** Wait for the image itself, not just the viewer shell. */
async function openImage(page: Page) {
  await page.goto(ANNOTATE_URL);
  const viewer = page.getByTestId('annotation-viewer');
  await expect(viewer).toBeVisible({ timeout: 180000 });
  await expect(viewer.locator('canvas').first()).toBeVisible({ timeout: 60000 });
  // The image-info row is the only place the loaded stem is exposed as text.
  await expect(page.getByText(/\(\d+×\d+ px\)/)).toBeVisible({ timeout: 90000 });
  // Two fits with a pause: the first can run before the container has its
  // final size, which would leave the draw clicks on empty map canvas.
  await page.locator('[data-tool="fit"]').click();
  await page.waitForTimeout(1000);
  await page.locator('[data-tool="fit"]').click();
  await page.waitForTimeout(500);
  return viewer;
}

/** Draw one closed polygon near the centre of the image. */
async function drawPolygon(page: Page, viewer: ReturnType<Page['getByTestId']>) {
  await page.locator('[data-tool="polygon"]').click();
  await page.waitForTimeout(300); // the OL Draw interaction installs in an effect
  const box = await viewer.boundingBox();
  if (!box) throw new Error('annotation-viewer has no bounding box');
  const pt = (fx: number, fy: number): [number, number] => [
    box.x + box.width * fx,
    box.y + box.height * fy,
  ];
  const vertices: Array<[number, number]> = [pt(0.42, 0.42), pt(0.58, 0.42), pt(0.58, 0.58), pt(0.42, 0.58)];
  for (const [x, y] of vertices) {
    await page.mouse.click(x, y);
    await page.waitForTimeout(150);
  }
  await page.mouse.dblclick(...vertices[0]);
  await page.waitForTimeout(600);
}

/**
 * Fire the real `beforeunload` listener and report whether it cancelled.
 *
 * Playwright auto-dismisses native beforeunload dialogs on reload/goto without
 * emitting a `dialog` event, so the prompt itself is not observable here. This
 * dispatches a cancelable `beforeunload` at `window`, which runs the page's
 * actual registered handler: a cancelled event is exactly what makes Chromium
 * show its prompt. MEASURED = the handler cancels; INFERRED = the browser then
 * prompts.
 */
async function beforeUnloadCancels(page: Page): Promise<boolean> {
  return page.evaluate(() => {
    const e = new Event('beforeunload', { cancelable: true });
    window.dispatchEvent(e);
    return e.defaultPrevented;
  });
}

test.describe.configure({ mode: 'serial' });

test.describe('annotate save reliability (#0035)', () => {
  test('B3: unsaved masks prompt on an in-app exit and arm the unload guard', async ({ page }) => {
    const token = readHyphaToken();
    if (!token) {
      test.skip();
      return;
    }
    test.setTimeout(300000);
    const consoleLines: string[] = [];
    page.on('console', (m) => consoleLines.push(`[${m.type()}] ${m.text()}`));

    await seedToken(page, token);
    const viewer = await openImage(page);

    // Positive control: with a clean canvas the guard must be DISARMED, so a
    // later `true` cannot just be a handler that always cancels.
    expect(await beforeUnloadCancels(page)).toBe(false);

    await drawPolygon(page, viewer);
    // Undo only enables once a feature was actually added, so this confirms
    // the draw landed rather than clicking on empty canvas.
    await expect(page.locator('[data-tool="undo"]').first()).toBeEnabled({ timeout: 10000 });

    expect(await beforeUnloadCancels(page)).toBe(true);

    // The in-app back button is a `navigate()`, which no unload handler sees.
    let dialogMessage = '';
    page.once('dialog', async (d) => {
      dialogMessage = d.message();
      await d.dismiss(); // "Cancel": the user chose to stay
    });
    // The visible label is "Session overview", but the MUI Tooltip wrapping it
    // puts its own title on the button as `aria-label`, which wins the
    // accessible-name computation. Match what the a11y tree actually exposes.
    await page.getByRole('button', { name: /Go back to the Colab session/i }).first().click();
    await page.waitForTimeout(1500);

    expect(dialogMessage).toContain('have not been saved');
    // Cancelling must keep us on the annotate page with the work intact.
    expect(page.url()).toContain('/colab/annotate');
    await expect(viewer).toBeVisible();
    await page.screenshot({ path: 'test-results/0035-b3-unsaved-guard.png' });
    console.log('--- console (B3) ---\n' + consoleLines.join('\n'));
  });

  test('B2: a save whose upload returns 403 reports failure and keeps the masks', async ({ page }) => {
    const token = readHyphaToken();
    if (!token) {
      test.skip();
      return;
    }
    test.setTimeout(300000);
    const consoleLines: string[] = [];
    page.on('console', (m) => consoleLines.push(`[${m.type()}] ${m.text()}`));

    await seedToken(page, token);
    const viewer = await openImage(page);
    await drawPolygon(page, viewer);
    await expect(page.locator('[data-tool="undo"]').first()).toBeEnabled({ timeout: 10000 });

    // Fail the GeoJSON upload with a real S3-shaped error body. Everything
    // else, including the broker's get_save_urls, still runs for real.
    let interceptedPuts = 0;
    await page.route('**/*', async (route) => {
      const req = route.request();
      if (req.method() === 'PUT' && /\.geojson/i.test(req.url())) {
        interceptedPuts += 1;
        await route.fulfill({
          status: 403,
          contentType: 'application/xml',
          body:
            '<?xml version="1.0" encoding="UTF-8"?><Error><Code>AccessDenied</Code>' +
            '<Message>Access Denied by the verification harness</Message></Error>',
        });
        return;
      }
      await route.continue();
    });

    await page.locator('[data-tool="save"]').first().click();

    // `handleSave`'s catch shows a fixed headline and hides the thrown
    // message behind the banner's details button, so both are checked: the
    // headline proves the throw was caught as a failure, the detail proves it
    // was MY check that threw and not something incidental.
    const failureBanner = page.getByText('Failed to save annotation');
    await expect(failureBanner).toBeVisible({ timeout: 60000 });
    await page.screenshot({ path: 'test-results/0035-b2-failed-save.png' });

    expect(interceptedPuts, 'the PUT route never matched, so nothing was failed').toBeGreaterThan(0);
    // The old behaviour: a success banner plus a cleared canvas.
    await expect(page.getByText('Annotation saved successfully')).toHaveCount(0);

    await failureBanner.locator('xpath=following-sibling::button[1]').click();
    const dialog = page.getByRole('dialog');
    await expect(dialog).toContainText('Could not upload the annotation outline');
    await expect(dialog).toContainText('HTTP 403');
    // The readable part of S3's XML body, extracted from <Message>.
    await expect(dialog).toContainText('Access Denied by the verification harness');
    await page.screenshot({ path: 'test-results/0035-b2-failed-save-detail.png' });
    await page.keyboard.press('Escape');
    await page.waitForTimeout(500);
    // Masks must still be there: undo is only enabled while features exist.
    await expect(page.locator('[data-tool="undo"]').first()).toBeEnabled();
    // And the unsaved guard must still be armed, because nothing was saved.
    expect(await beforeUnloadCancels(page)).toBe(true);
    // Still on the same image: a failed save must not auto-advance.
    await expect(page.getByText(new RegExp(STEM))).toBeVisible();

    console.log('--- console (B2) ---\n' + consoleLines.join('\n'));
  });

  test('D3: a saved annotation is restored when the image is reopened', async ({ page }) => {
    const token = readHyphaToken();
    if (!token) {
      test.skip();
      return;
    }
    test.setTimeout(300000);
    const consoleLines: string[] = [];
    page.on('console', (m) => consoleLines.push(`[${m.type()}] ${m.text()}`));

    await seedToken(page, token);
    const viewer = await openImage(page);
    await drawPolygon(page, viewer);
    await expect(page.locator('[data-tool="undo"]').first()).toBeEnabled({ timeout: 10000 });

    // A real save, no interception. The save logs how many features it wrote,
    // which is the number the reopen has to come back with.
    await page.locator('[data-tool="save"]').first().click();
    await expect(page.getByText('Annotation saved successfully')).toBeVisible({ timeout: 120000 });
    await page.screenshot({ path: 'test-results/0035-d3-saved.png' });

    const savedMatch = consoleLines.join('\n').match(/Saving\s+(\d+)\s+annotations/);
    expect(savedMatch, 'no "Saving N annotations" log').not.toBeNull();
    const savedCount = Number(savedMatch![1]);
    expect(savedCount).toBeGreaterThan(0);

    // After a successful save the guard must be DISARMED. This is the exact
    // ordering bug worth pinning: `vs.clear()` re-fires `removefeature`, so a
    // flag reset placed before it would leave the guard armed here.
    await page.waitForTimeout(2000);
    expect(await beforeUnloadCancels(page)).toBe(false);

    // Now the defect itself: reload and reopen the same image. Before the fix
    // this showed an empty canvas with Undo disabled, indefinitely.
    //
    // The assertion target is the console log, not the banner: the banner
    // auto-dismisses after 8 s and `openImage` spends over a second on its
    // fit clicks, so a banner check can miss a restore that did happen. The
    // log line is durable for the whole page lifetime.
    const reloadLogs: string[] = [];
    page.on('console', (m) => reloadLogs.push(`[${m.type()}] ${m.text()}`));
    await page.goto('about:blank');
    const viewer2 = await openImage(page);

    // Poll for the restore to land rather than asserting immediately: it runs
    // after the image decode, so it is not done when `openImage` returns.
    const deadline = Date.now() + 120000;
    let restored: RegExpMatchArray | null = null;
    while (Date.now() < deadline) {
      restored = reloadLogs.join('\n').match(/Restored\s+(\d+)\s+saved masks/);
      if (restored) break;
      if (/restoreSavedAnnotation failed/.test(reloadLogs.join('\n'))) break;
      await page.waitForTimeout(1000);
    }
    await page.screenshot({ path: 'test-results/0035-d3-restored.png' });
    console.log('--- console after reopen (D3) ---\n' + reloadLogs.join('\n'));

    // The log carries the count, so this asserts masks were actually put back
    // rather than an empty collection being reported as a success.
    expect(restored, 'no "Restored N saved masks" log after reopening the image').not.toBeNull();
    expect(Number(restored![1])).toBeGreaterThan(0);

    // Round-trip identity. The restore must reproduce what was stored, not
    // re-resolve it: `importGeoJSON`'s overlap trimming is lossy, and with it
    // on a 9-feature save came back as 10 features, so every open/save cycle
    // would rewrite the user's masks a little.
    expect(
      Number(restored![1]),
      `saved ${savedCount} masks but restored ${restored![1]}`,
    ).toBe(savedCount);

    // Restored work is the baseline, not unsaved work, and undo must not be
    // able to step back past it into the empty canvas.
    expect(await beforeUnloadCancels(page)).toBe(false);
    await expect(page.locator('[data-tool="undo"]').first()).toBeDisabled();
    await expect(viewer2).toBeVisible();

    console.log('--- console (D3, full) ---\n' + consoleLines.join('\n'));
  });
});
