import { test, expect } from '@playwright/test';
import fs from 'fs';
import { BASE_URL } from './baseUrl';

// Requires: HYPHA_TOKEN env var, falls back to /data/nmechtel/bioengine/.env.
// Requires: dev server running at E2E_BASE_URL (default http://localhost:3000).
//
// Regression test for the round-27 production bug report: Cellpose-SAM full
// image segmentation via the LOCAL path (kernel-warm flows + Pyodide mask
// gen in useHyphaService.ts's runCellposeFlows / runCellposeFlowsPipeline in
// AnnotatePage.tsx) reportedly produced a dense periodic tiling of tiny
// identical polygons, completely decoupled from the actual cells, while the
// SERVER path (service.runCellpose, postprocessing left on) on the same image
// was fine.
//
// This drives both paths against the same image and label and asserts the
// local-path mask count stays within a sane band relative to the server
// path's count. A periodic-tiling artifact produces dozens to hundreds of
// extra tiny masks, so a gross local/server mismatch is a strong proxy for
// the reported symptom even without pixel-level polygon inspection.
//
// The local path only engages once the Python kernel is ready
// (AnnotatePage.tsx's handleRunCellpose gates on `kernelReady`).
// AnnotatePage picks `sharedKernel || localKernel`. Every /colab/* route,
// including /colab/annotate reached via a bare URL, is wrapped in
// ColabPage's <KernelProvider> (ColabPage.tsx wraps unconditionally, not
// just for the training route), so `sharedKernel` from
// useSharedKernelIfAvailable() is NEVER null on this page -- it always wins
// the `sharedKernel || localKernel` pick. `useColabKernel`'s own
// unconditional-on-mount auto-boot (the "[Colab Kernel] ..." log lines)
// still runs (React's Rules of Hooks call it unconditionally), but its
// result is dead code here: it's never read into `kernel`/`kernelReady`.
// The ONLY way `kernelReady` becomes true on this route is
// `sharedKernel.requestKernel()`, and today the only caller of that is
// handleToggleCLAHE (the "Enhance Contrast" button, data-tool="clahe") --
// see the "[Kernel Context] ..." log lines it produces, a distinct prefix
// from "[Colab Kernel]". So this test must open (and immediately cancel)
// the CLAHE dialog to warm the kernel the local Cellpose path actually
// uses; waiting on "[Colab Kernel] Kernel initialization completed
// successfully" alone (an earlier version of this test did) never gates
// the local path -- it always falls back to the server path silently.

test.use({ baseURL: BASE_URL });

const DATASET_ALIAS = 'annotation-mst3ebzz-o5px';
const LABEL = 'cells';

function readHyphaToken(): string | undefined {
  if (process.env.HYPHA_TOKEN) return process.env.HYPHA_TOKEN;
  try {
    const envText = fs.readFileSync('/data/nmechtel/bioengine/.env', 'utf8');
    const match = envText.match(/HYPHA_TOKEN=(\S+)/);
    return match?.[1];
  } catch {
    return undefined;
  }
}

async function gotoAnnotate(page: import('@playwright/test').Page, token: string) {
  await page.addInitScript(({ tok, expiry }) => {
    localStorage.setItem('token', tok);
    localStorage.setItem('tokenExpiry', expiry);
    localStorage.setItem('bioimage-annotation-tutorial-seen', '1');
  }, { tok: token, expiry: new Date(Date.now() + 3 * 60 * 60 * 1000).toISOString() });

  const url = `/#/colab/annotate?session_id=${encodeURIComponent(DATASET_ALIAS)}&label=${encodeURIComponent(LABEL)}`;
  await page.goto(url);

  const viewer = page.getByTestId('annotation-viewer');
  await expect(viewer).toBeVisible({ timeout: 180000 });
  await expect(viewer.locator('canvas').first()).toBeVisible({ timeout: 60000 });
}

async function runCellposeSAM(page: import('@playwright/test').Page) {
  const openDialogButton = page.locator('[data-tool="cellpose"]');
  // The frontend's own model-runner reachability probe can fail once and
  // retry (see "[warning] [useHyphaService] model-runner not reachable"
  // -- a direct hypha-rpc client resolves the service fine,
  // this is just registry-propagation lag right after page load), so allow
  // more than one retry cycle before concluding the tool is stuck disabled.
  await expect(openDialogButton).toBeEnabled({ timeout: 150000 });
  await openDialogButton.click();

  const dialog = page.getByRole('dialog').filter({ hasText: 'Full Image Segmentation' });
  await expect(dialog).toBeVisible({ timeout: 10000 });

  const modelSelect = dialog.getByRole('combobox');
  await modelSelect.click();
  await page.getByRole('option', { name: 'Cellpose-SAM' }).click();

  // The "Compute Flow Field" section starts collapsed once a prior run in
  // this session already produced a result (SectionHeader's `open` prop
  // defaults to `!isResultReady`), which hides the actual submit button
  // behind its accordion header. Expand it explicitly rather than assuming
  // the dialog's default state -- this test runs Cellpose twice in one page
  // session, so the second run always hits this collapsed state. The
  // "Compute Flow Field" header is always the first of the two section
  // headers regardless of open/closed state -- both headers' accessible
  // names reference the other section's name in their subtitle text, so
  // filtering by text is unreliable; position is not.
  const runSectionHeader = dialog.locator('button[aria-expanded]').first();
  await expect(runSectionHeader).toBeVisible({ timeout: 10000 });
  if ((await runSectionHeader.getAttribute('aria-expanded')) === 'false') {
    await runSectionHeader.click();
  }

  const runButton = dialog.getByRole('button', { name: 'Compute Flow Field', exact: true });
  await expect(runButton).toBeEnabled({ timeout: 10000 });
  await runButton.click();
  // Round 37 (#87) added a blocking warning when the image already carries
  // masks. Harmless no-op on a clean image, required to reach the run
  // otherwise.
  const runAnyway = page.getByRole('button', { name: /Run Anyway/i });
  if (await runAnyway.count()) await runAnyway.first().click();

  const resultBanner = page.getByText(/Added \d+ masks? from Cellpose|No masks detected by Cellpose/);
  await expect(resultBanner).toBeVisible({ timeout: 120000 });
  const bannerText = (await resultBanner.textContent()) ?? '';

  // Close the dialog, then wait for this run's banner to actually
  // disappear (it auto-dismisses after 5s) before returning. Without this,
  // a second call to runCellposeSAM in the same page session can have its
  // `resultBanner` locator resolve instantly against the still-lingering
  // banner from THIS run instead of waiting for its own run to complete.
  const closeButton = dialog.getByRole('button', { name: /^(Done|Cancel)$/ });
  if (await closeButton.isVisible().catch(() => false)) {
    await closeButton.click();
  }
  await expect(resultBanner).toBeHidden({ timeout: 10000 }).catch(() => {});

  return bannerText;
}

// Opens the CLAHE dialog just far enough to call handleToggleCLAHE's
// `sharedKernel?.requestKernel?.()`, then cancels without applying anything.
// This is the only production trigger for the shared kernel that
// handleRunCellpose's `kernelReady` gate actually reads (see module comment).
async function warmSharedKernel(page: import('@playwright/test').Page) {
  const claheButton = page.locator('[data-tool="clahe"]');
  await expect(claheButton).toBeEnabled({ timeout: 60000 });
  await claheButton.click();

  const claheDialog = page.getByRole('dialog').filter({ hasText: 'CLAHE' });
  await expect(claheDialog).toBeVisible({ timeout: 10000 });
  await claheDialog.getByRole('button', { name: 'Cancel' }).click();
  await expect(claheDialog).toBeHidden({ timeout: 10000 });
}

function parseMaskCount(bannerText: string): number {
  if (bannerText.includes('No masks detected')) return 0;
  const match = bannerText.match(/Added (\d+) masks?/);
  expect(match, `unexpected banner text: "${bannerText}"`).not.toBeNull();
  return Number(match![1]);
}

test.describe('Cellpose-SAM local vs server mask-count sanity', () => {
  test('local (kernel-warm flows) and server paths agree within a sane band', async ({ page }) => {
    const token = readHyphaToken();
    if (!token) {
      test.skip();
      return;
    }

    test.setTimeout(540000);

    const consoleLines: string[] = [];
    page.on('console', (msg) => {
      const line = `[${msg.type()}] ${msg.text()}`;
      consoleLines.push(line);
      if (process.env.DEBUG_CONSOLE) console.log(line);
    });

    await gotoAnnotate(page, token);

    // Trigger sharedKernel.requestKernel() via the CLAHE dialog (see module
    // comment -- this is the only production trigger handleRunCellpose's
    // `kernelReady` actually reads). Boot itself takes a couple of minutes;
    // poll for it in parallel with the first (server) run so run 2 doesn't
    // pay the full boot latency serially.
    await warmSharedKernel(page);
    const kernelReadyPoll = expect
      .poll(
        () => consoleLines.some((l) => /\[Kernel Context\] Kernel initialization completed successfully/.test(l)),
        { timeout: 240000, message: 'waiting for shared kernel initialization to complete' },
      )
      .toBeTruthy()
      .catch(() => {
        // Best-effort signal only -- the actual gate is whether the local
        // path engages at all (asserted via the "local=true" log line after
        // run 2), so a missed console-line heuristic isn't fatal on its own.
      });

    // --- Run 1: server path. Kernel is not ready yet this early, so
    // handleRunCellpose's `if (kernelReady)` gate is false and it goes
    // straight to service.runCellpose (postprocessing left on).
    const serverBannerText = await runCellposeSAM(page);
    const serverMaskCount = parseMaskCount(serverBannerText);
    expect(serverMaskCount, `server run detected no masks: "${serverBannerText}"`).toBeGreaterThan(0);

    const serverLogLine = consoleLines.find((l) => l.includes('Cellpose added') && l.includes('masks (local='));
    expect(serverLogLine, 'expected a "Cellpose added N masks (local=...)" log line for the server run').toBeTruthy();
    expect(serverLogLine).toContain('local=false');

    await kernelReadyPoll;

    // --- Run 2: local path (flows + Pyodide mask gen), same raw image.
    const localBannerText = await runCellposeSAM(page);
    const localMaskCount = parseMaskCount(localBannerText);

    const localLogLine = [...consoleLines].reverse().find((l) => l.includes('Cellpose added') && l.includes('masks (local='));
    expect(localLogLine, 'expected a "Cellpose added N masks (local=...)" log line for the local run').toBeTruthy();

    console.log('--- server run ---', serverBannerText, serverLogLine);
    console.log('--- local run ---', localBannerText, localLogLine);
    if (process.env.DEBUG_CONSOLE) {
      console.log('--- full console ---\n' + consoleLines.join('\n'));
    }

    if (localLogLine?.includes('local=false')) {
      // Kernel never came up warm enough within the wait budget; the local
      // path silently fell back to server (handleRunCellpose's documented
      // fallback-on-throw behavior). Nothing to compare -- skip rather than
      // pass on an untested path.
      test.skip(true, 'local path did not engage (kernel not warm in time); local=false fallback used');
      return;
    }

    expect(localBannerText).not.toContain('No masks detected');
    expect(localMaskCount).toBeGreaterThan(0);

    // Sanity band: a periodic-tiling artifact produces dozens to hundreds of
    // extra tiny masks packed across the whole image, which blows this ratio
    // (and the absolute ceiling below) well past what any real threshold
    // difference between the two paths could plausibly produce.
    const ratio = localMaskCount / serverMaskCount;
    expect(ratio, `local=${localMaskCount} vs server=${serverMaskCount} masks -- ratio out of sane band`).toBeGreaterThan(0.3);
    expect(ratio, `local=${localMaskCount} vs server=${serverMaskCount} masks -- ratio out of sane band`).toBeLessThan(3);
    expect(localMaskCount, 'absolute mask-count ceiling for this crop -- a periodic-tiling artifact would blow past this').toBeLessThan(150);
  });
});
