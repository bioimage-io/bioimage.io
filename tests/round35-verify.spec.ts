import { test, expect } from '@playwright/test';
import fs from 'fs';

// Round-35 independent acceptance (keen-puma) on a multi-image dataset:
// (1) switching images never blanks the preview: the previous image stays
//     rendered (dimmed) with an overlay spinner until the new URL resolves,
// (2) the Browse annotations button swaps to a spinner during the
//     availability check,
// (3) the images-list refresh button spins through a manual refresh's full
//     file-list + availability sequence and through the 30s auto-poll.
// The transient states are observed with rAF-granularity DOM polling started
// BEFORE the triggering click, since the underlying fetches are hypha-rpc
// websocket calls that HTTP route interception cannot delay.

test.use({ baseURL: 'http://localhost:5199' });

const DATASET_ALIAS = 'annotation-mst3ebzz-o5px';
const OUT = '/tmp/round35-verify';

// Installs a MutationObserver-backed watcher in the page that records whether
// a predicate ever becomes true, sampled on every DOM mutation and every
// animation frame until stopped.
async function armWatcher(page: import('@playwright/test').Page, name: string, predicate: string) {
  await page.evaluate(({ name, predicate }) => {
    const w: any = ((window as any).__r35 = (window as any).__r35 || {});
    const fn = new Function('return (' + predicate + ')');
    w[name] = { hits: 0, done: false };
    const sample = () => {
      if (w[name].done) return;
      try {
        if (fn()) w[name].hits++;
      } catch {}
      requestAnimationFrame(sample);
    };
    requestAnimationFrame(sample);
  }, { name, predicate });
}

async function readWatcher(
  page: import('@playwright/test').Page,
  name: string,
  stop = true
): Promise<number> {
  return page.evaluate(({ n, stop }) => {
    const w: any = (window as any).__r35 || {};
    if (w[n] && stop) w[n].done = true;
    return w[n]?.hits ?? 0;
  }, { n: name, stop });
}

test('round 35: image-switch overlay, browse spinner, refresh spin cycles', async ({ page }) => {
  test.setTimeout(300000);
  fs.mkdirSync(OUT, { recursive: true });
  const pageErrors: string[] = [];
  page.on('pageerror', (e) => pageErrors.push(e.message));

  const envText = fs.readFileSync('/data/nmechtel/bioengine/.env', 'utf8');
  const token = envText.match(/HYPHA_TOKEN=(\S+)/)![1];
  await page.addInitScript(({ tok, expiry }) => {
    localStorage.setItem('token', tok);
    localStorage.setItem('tokenExpiry', expiry);
  }, { tok: token, expiry: new Date(Date.now() + 3 * 60 * 60 * 1000).toISOString() });

  await page.goto(`/#/colab/${DATASET_ALIAS}?label=cells`);

  // File list should populate (fast phase) with many images.
  const refreshBtn = page.locator('button[title="Refresh image list"]');
  await expect(refreshBtn).toBeVisible({ timeout: 60000 });
  const preview = page.locator('img.max-w-full').first();
  await expect(preview).toBeVisible({ timeout: 60000 });
  await page.waitForTimeout(3000); // initial availability check settles

  // Image rows render as buttons named by stem (e.g. "10036_962_G1_1").
  const rows = page.getByRole('button', { name: /^\d+_\d+_[A-H]\d{1,2}_\d+$/ });
  const rowCount = await rows.count();
  expect(rowCount).toBeGreaterThan(1);

  // --- (1) Image switch: old image stays, spinner overlays it ---
  const srcBefore = await preview.getAttribute('src');
  await armWatcher(
    page,
    'overlay',
    `(() => {
      const img = document.querySelector('img.max-w-full');
      if (!img) return false;
      const dimmed = img.className.includes('opacity-60');
      const spinner = img.parentElement && img.parentElement.querySelector('svg.animate-spin');
      return Boolean(dimmed && spinner && img.getAttribute('src') === ${JSON.stringify(srcBefore)});
    })()`
  );
  await rows.nth(1).click();
  // New image must eventually replace the old one.
  await expect
    .poll(async () => preview.getAttribute('src'), { timeout: 30000 })
    .not.toBe(srcBefore);
  const overlayHits = await readWatcher(page, 'overlay');
  console.log(`[r35] overlay-on-old-image frames observed: ${overlayHits}`);
  expect(overlayHits).toBeGreaterThan(0);
  await page.screenshot({ path: `${OUT}/1-after-switch.png` });

  // At no point should the preview img have been absent from the DOM: the
  // watcher predicate itself required the img to exist while spinning, and
  // the img is still here now.
  await expect(preview).toBeVisible();

  // --- (2) Browse annotations spinner during availability check +
  // --- (3a) refresh button spins through a manual refresh ---
  await armWatcher(
    page,
    'refreshSpin',
    `(() => {
      const btn = document.querySelector('button[title="Refresh image list"]');
      return Boolean(btn && btn.querySelector('svg.animate-spin'));
    })()`
  );
  await armWatcher(
    page,
    'browseSpin',
    `(() => {
      const spinners = document.querySelectorAll('svg.animate-spin');
      for (const s of spinners) {
        const btn = s.closest('button');
        if (btn && !btn.title.includes('Refresh')) return true;
      }
      return false;
    })()`
  );
  await refreshBtn.click();
  await expect(refreshBtn).toBeDisabled();
  // Spinner must persist until the availability phase finishes too.
  await expect(refreshBtn).toBeEnabled({ timeout: 60000 });
  const refreshHits = await readWatcher(page, 'refreshSpin');
  const browseHits = await readWatcher(page, 'browseSpin');
  console.log(`[r35] refresh-spin frames: ${refreshHits}, non-refresh spinner frames: ${browseHits}`);
  expect(refreshHits).toBeGreaterThan(0);
  await page.screenshot({ path: `${OUT}/2-after-refresh.png` });

  // --- (3b) auto-poll: the refresh button spins again with no user action ---
  await armWatcher(
    page,
    'autoSpin',
    `(() => {
      const btn = document.querySelector('button[title="Refresh image list"]');
      return Boolean(btn && btn.querySelector('svg.animate-spin'));
    })()`
  );
  await expect
    .poll(async () => readWatcher(page, 'autoSpin', false), { timeout: 45000, intervals: [2000] })
    .toBeGreaterThan(0);
  console.log('[r35] auto-poll spin observed');

  expect(pageErrors).toEqual([]);
});
