import { test, expect } from '@playwright/test';
import fs from 'fs';
import { BASE_URL } from './baseUrl';

// Round-36 independent acceptance (keen-puma): merging touching masks.
//   Two overlapping brush masks, box-selected, merge into ONE via the A
//   shortcut, with an undo snapshot taken first (Ctrl+Z restores both).
//   Two separated masks no-op with the exact warning toast.
//   The guide documents the merge gesture.

test.use({ baseURL: BASE_URL });

const DATASET_ALIAS = 'annotation-mst3ebzz-o5px';
const OUT = '/tmp/round36-verify';

test('merge touching masks, undo restores, non-touching toast, guide mentions merge', async ({ page }) => {
  test.setTimeout(300000);
  fs.mkdirSync(OUT, { recursive: true });
  const pageErrors: string[] = [];
  const logs: string[] = [];
  page.on('pageerror', (e) => pageErrors.push(e.message));
  page.on('console', (m) => {
    const t = m.text();
    if (t.includes('[Select]') || t.includes('[Expander]')) logs.push(t);
  });

  const envText = fs.readFileSync('/data/nmechtel/bioengine/.env', 'utf8');
  const token = envText.match(/HYPHA_TOKEN=(\S+)/)![1];
  await page.addInitScript(({ tok, expiry }) => {
    localStorage.setItem('token', tok);
    localStorage.setItem('tokenExpiry', expiry);
    localStorage.setItem('bioimage-annotation-tutorial-seen', '1');
  }, { tok: token, expiry: new Date(Date.now() + 3 * 60 * 60 * 1000).toISOString() });

  await page.goto(`/#/colab/annotate?session_id=${DATASET_ALIAS}&label=cells`);
  await expect(page.locator('canvas').first()).toBeVisible({ timeout: 90000 });
  await expect(page.getByText('Annotation Tools')).toBeVisible({ timeout: 30000 });
  await page.waitForTimeout(3000);
  const expandToolbarBtn = page.getByRole('button', { name: 'Expand toolbar' });
  if (await expandToolbarBtn.isVisible({ timeout: 3000 }).catch(() => false)) {
    await expandToolbarBtn.click();
  }
  await page.keyboard.press('0');
  await page.waitForTimeout(600);

  const canvas = page.locator('canvas').first();
  const cbox = (await canvas.boundingBox())!;
  const cx = cbox.x + cbox.width / 2;
  const cy = cbox.y + cbox.height / 2;

  // --- Paint two OVERLAPPING brush masks (brush is the default mode) ---
  await page.locator('[data-tool="polygon"]').first().click();
  await expect(page.getByLabel('Increase brush radius')).toBeVisible({ timeout: 10000 });
  await page.mouse.move(cx - 60, cy - 20);
  await page.mouse.down();
  await page.mouse.move(cx - 10, cy - 20, { steps: 6 });
  await page.mouse.up();
  await page.waitForTimeout(400);
  await page.mouse.move(cx - 20, cy + 10);
  await page.mouse.down();
  await page.mouse.move(cx + 40, cy + 10, { steps: 6 });
  await page.mouse.up();
  await page.waitForTimeout(400);

  // --- Select both via box, merge with A ---
  await page.getByRole('button', { name: /^Select/ }).first().click();
  await page.mouse.move(cx - 110, cy - 70);
  await page.mouse.down();
  await page.mouse.move(cx + 90, cy + 60, { steps: 8 });
  await page.mouse.up();
  await page.waitForTimeout(400);
  expect(logs.some((t) => t.includes('Box-selected (2 total)'))).toBe(true);
  await page.keyboard.press('a');
  await page.waitForTimeout(500);
  expect(logs.some((t) => /\[Expander\] Merged 2 selected masks/.test(t))).toBe(true);
  await page.screenshot({ path: `${OUT}/1-merged.png` });

  // --- Undo restores both masks (snapshot was taken before the merge) ---
  await page.keyboard.press('Control+z');
  await page.waitForTimeout(600);
  await page.mouse.move(cx - 110, cy - 70);
  await page.mouse.down();
  await page.mouse.move(cx + 90, cy + 60, { steps: 8 });
  await page.mouse.up();
  await page.waitForTimeout(400);
  expect(logs.filter((t) => t.includes('Box-selected (2 total)')).length).toBeGreaterThan(1);
  await page.screenshot({ path: `${OUT}/2-after-undo.png` });

  // --- Clean up the two restored masks, then two SEPARATED masks: A shows
  //     the exact non-touching toast and merges nothing ---
  await page.keyboard.press('Delete');
  await page.waitForTimeout(400);
  await page.locator('[data-tool="polygon"]').first().click();
  await page.mouse.move(cx - 120, cy - 80);
  await page.mouse.down();
  await page.mouse.move(cx - 80, cy - 80, { steps: 5 });
  await page.mouse.up();
  await page.waitForTimeout(400);
  await page.mouse.move(cx + 80, cy + 70);
  await page.mouse.down();
  await page.mouse.move(cx + 120, cy + 70, { steps: 5 });
  await page.mouse.up();
  await page.waitForTimeout(400);
  await page.getByRole('button', { name: /^Select/ }).first().click();
  await page.mouse.move(cx - 160, cy - 120);
  await page.mouse.down();
  await page.mouse.move(cx + 160, cy + 110, { steps: 8 });
  await page.mouse.up();
  await page.waitForTimeout(400);
  await page.keyboard.press('a');
  await expect(
    page.getByText('Selected masks do not touch, so they cannot be merged.')
  ).toBeVisible({ timeout: 5000 });
  expect(logs.some((t) => /\[Expander\] Merged/.test(t) && logs.indexOf(t) > logs.length - 3)).toBe(false);
  await page.screenshot({ path: `${OUT}/3-non-touching-toast.png` });
  await page.keyboard.press('Delete');
  await page.waitForTimeout(400);

  // --- The guide documents the merge gesture ---
  await page.getByRole('button', { name: 'Open the Guide' }).click();
  const nextBtn = page.getByRole('button', { name: /^(Next|Finish)$/ });
  await expect(nextBtn).toBeVisible({ timeout: 15000 });
  const card = page
    .locator('.MuiPaper-root')
    .filter({ has: page.getByRole('button', { name: /^(Next|Finish)$/ }) })
    .first();
  let guideText = '';
  for (let step = 0; step < 30; step++) {
    guideText += (await card.innerText()) + '\n';
    const label = (await nextBtn.innerText()).toLowerCase();
    await nextBtn.click();
    if (label === 'finish') break;
    await page.waitForTimeout(200);
    if (!(await nextBtn.isVisible().catch(() => false))) break;
  }
  expect(/merge/i.test(guideText)).toBe(true);
  expect(guideText.includes('—')).toBe(false); // no em dashes

  expect(pageErrors).toEqual([]);
});
