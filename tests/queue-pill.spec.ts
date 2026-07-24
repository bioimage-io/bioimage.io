import { test, expect } from '@playwright/test';
import { spawn, ChildProcess } from 'child_process';
import path from 'path';

// Visual verification of the amber "#N" queue-position pill in the shared
// StepTimeline (used by TestDetailsDialog + InferenceProgressDialog).
//
// The pill only renders when a step's queue_position > 0, so we must MAKE a
// queue: a Python filler (tests/queue-fill.py) keeps the shared run queue
// backed up with affable-shark infers while the browser launches its own test.
// When the browser job reaches the (contended) run step it sits at #N, which we
// screenshot and assert reads as queued (amber pill + hourglass + GPU-slot
// tooltip), not running (no live timer on that row).
//
// PRECONDITION: the cache.py download-marker race fix must be deployed, else the
// concurrent same-model infers crash on the shared .downloading_ marker.
//
// Requires: HYPHA_TOKEN env var; dev server (pnpm start).

const MODEL_ID = 'bioimage-io/affable-shark';
const MODEL_URL_ID = encodeURIComponent(MODEL_ID);
const injectToken = (token: string) => ({ tok: token, expiry: new Date(Date.now() + 3 * 60 * 60 * 1000).toISOString() });

test.describe('queue #N pill', () => {
  let filler: ChildProcess | undefined;

  test.afterEach(() => {
    if (filler && !filler.killed) filler.kill('SIGKILL');
  });

  test('run-queue step shows an amber #N pill while queued', async ({ page }) => {
    const token = process.env.HYPHA_TOKEN;
    if (!token) {
      test.skip();
      return;
    }
    test.setTimeout(360000);

    // Start queue pressure ~5s before the browser job so a queue exists when it
    // reaches the run step. Keep it up for the whole run.
    // Hold a FIXED in-flight pool of 8 (poll-to-completion, no fire-and-forget)
    // so the shared run queue keeps ~2 running (pos0) + ~6 queued (#1..#6),
    // well under Ray Serve's admission ceiling. FILL_BURST/FILL_INTERVAL are
    // obsolete (the old runaway burst model that tripped admission).
    filler = spawn('python3', [path.join(__dirname, 'queue-fill.py')], {
      env: { ...process.env, FILL_SECONDS: '240', FILL_POOL: '8' },
      stdio: 'inherit',
    });
    await new Promise(r => setTimeout(r, 15000));

    await page.addInitScript(({ tok, expiry }) => {
      localStorage.setItem('token', tok);
      localStorage.setItem('tokenExpiry', expiry);
    }, injectToken(token));

    await page.goto(`/#/edit/${MODEL_URL_ID}`);
    await expect(page.getByRole('button', { name: 'Test Model' })).toBeVisible({ timeout: 60000 });

    // KTH is the default runner site (RUNNER_SITES[0]) and now carries 1.15.32
    // with the stages{} API + cache.py fix, so we leave the site toggle alone.
    // The filler is pinned to the same KTH worker, so both share one run queue.

    // Skip cache so the run really executes (no instant cache return), giving a
    // stable in-progress window; no custom env so env_setup is skipped and the
    // job reaches the contended run step quickly.
    await page.getByRole('button', { name: 'Test Model' }).click();
    const optionsDialog = page.getByRole('dialog').filter({ hasText: 'Run Model Test' });
    await expect(optionsDialog.getByRole('heading', { name: 'Run Model Test' })).toBeVisible({ timeout: 5000 });
    await optionsDialog.locator('input[type="checkbox"]').nth(1).check();
    await optionsDialog.getByRole('button', { name: 'Run Test' }).click();

    await expect(page.getByText('Model Testing in Progress')).toBeVisible({ timeout: 15000 });

    // The queued job contends for a GPU slot at the RUN step, so the #N pill
    // lands on the "Running" row. env_setup carries no per-step queue here (no
    // custom env) and no longer inherits the flat backlog, so it shows no pill;
    // model_download shows a duration, not a pill. The run row is therefore the
    // last #N chip in the timeline — target it directly so the tooltip we hover
    // is unambiguously the GPU-slot one.
    const pill = page.locator('.MuiChip-root').filter({ hasText: /^#\d+$/ }).last();
    await expect(pill).toBeVisible({ timeout: 240000 });

    // Screenshot the timeline the moment the pill is up.
    await page.screenshot({ path: 'outputs/pw/queue-pill.png', fullPage: false });

    // The pill label reads as a queue position (#N, N >= 1).
    const label = (await pill.textContent())?.trim() ?? '';
    expect(label).toMatch(/^#[1-9]\d*$/);

    // Hover reveals the stage-aware tooltip: the run queue waits for a GPU slot.
    await pill.hover();
    await expect(page.getByText(/Queue position \d+:.*GPU slot/)).toBeVisible({ timeout: 5000 });

    // The pill must read as WAITING, not running: it is an MUI Chip (amber #N),
    // not a live elapsed timer.
    await expect(pill).toHaveClass(/MuiChip-root/);
  });
});
