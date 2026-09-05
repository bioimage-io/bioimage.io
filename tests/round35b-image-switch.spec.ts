import { test, expect } from '@playwright/test';
import fs from 'fs';
import { BASE_URL } from './baseUrl';

// Round-35b independent acceptance (keen-puma): switching images in the
// dataset overview removes the previous image IMMEDIATELY and shows the
// annotation-switch skeleton (centered image icon + loading text) until the
// new image renders. The same skeleton is reused when loading the next
// annotation. Supersedes the round-35 dim-old-image-with-overlay design.

test.use({ baseURL: BASE_URL });

const DATASET_ALIAS = 'annotation-mst3ebzz-o5px';
const OUT = '/tmp/round35b-verify';

test('image switch shows skeleton, previous image removed immediately', async ({ page }) => {
  test.setTimeout(300000);
  fs.mkdirSync(OUT, { recursive: true });
  const pageErrors: string[] = [];
  page.on('pageerror', (e) => pageErrors.push(e.message));

  const envText = fs.readFileSync('/data/nmechtel/bioengine/.env', 'utf8');
  const token = envText.match(/HYPHA_TOKEN=(\S+)/)![1];
  await page.addInitScript(({ tok, expiry }) => {
    localStorage.setItem('token', tok);
    localStorage.setItem('tokenExpiry', expiry);
    localStorage.setItem('bioimage-annotation-tutorial-seen', '1');
  }, { tok: token, expiry: new Date(Date.now() + 3 * 60 * 60 * 1000).toISOString() });

  await page.goto(`/#/colab/${DATASET_ALIAS}?label=cells`);
  const rows = page.getByRole('button', { name: /^\d+_\d+_[A-H]\d{1,2}_\d+$/ });
  await expect(rows.first()).toBeVisible({ timeout: 90000 });
  expect(await rows.count()).toBeGreaterThan(1);

  // --- Open the first image and wait for its preview to fully render ---
  await rows.nth(0).click();
  const preview = page.locator('img.max-w-full');
  await expect(preview).toBeVisible({ timeout: 90000 });
  const firstSrc = await preview.getAttribute('src');
  await page.screenshot({ path: `${OUT}/1-first-image.png` });

  // --- Arm an rAF watcher BEFORE switching: per-frame it records whether an
  // img is present, its src, and whether the skeleton (loading text) shows.
  // The hypha-rpc websocket fetch cannot be delayed by route interception,
  // so frame-granularity observation is the reliable way to catch the
  // transient skeleton state. ---
  await page.evaluate(() => {
    const state: any = { frames: [] };
    (window as any).__r35b = state;
    const tick = () => {
      const img = document.querySelector('img.max-w-full') as HTMLImageElement | null;
      // Matches the shipped skeleton copy "Loading image...".
      const bodyText = document.body.innerText;
      const skeleton = /image is loading|loading image/i.test(bodyText);
      state.frames.push({
        t: performance.now(),
        hasImg: !!img,
        src: img ? img.src : null,
        skeleton,
      });
      if (state.frames.length < 2400) requestAnimationFrame(tick); // ~40 s cap
    };
    requestAnimationFrame(tick);
  });

  // --- Switch to the second image ---
  await rows.nth(1).click();

  // Skeleton must appear: centered image icon + loading text.
 
  await expect(page.getByText(/image is loading|loading image/i).first()).toBeVisible({
    timeout: 15000,
  });
  await page.screenshot({ path: `${OUT}/2-skeleton.png` });

  // New image eventually renders with a different src.
  await expect(preview).toBeVisible({ timeout: 120000 });
  await expect.poll(async () => preview.getAttribute('src'), { timeout: 120000 }).not.toBe(firstSrc);
  await page.screenshot({ path: `${OUT}/3-second-image.png` });

  // --- Frame-level assertions: from the first skeleton frame onward, the OLD
  // image was never still on screen (removed immediately, no dim-overlay). ---
  const frames = await page.evaluate(() => (window as any).__r35b.frames);
  const firstSkeletonIdx = frames.findIndex((f: any) => f.skeleton);
  expect(firstSkeletonIdx).toBeGreaterThanOrEqual(0);
  const oldSrcVisibleDuringSkeleton = frames
    .slice(firstSkeletonIdx)
    .some((f: any) => f.skeleton && f.hasImg && f.src === firstSrc);
  expect(oldSrcVisibleDuringSkeleton).toBe(false);

  expect(pageErrors).toEqual([]);
});
