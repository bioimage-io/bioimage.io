import { test, expect } from '@playwright/test';
import fs from 'fs';
import { BASE_URL } from './baseUrl';

// Round-33c gap fills (keen-puma): the parts silver-crane flagged as not
// live-tested — tutorial click-through with the new shortcut copy, the
// threshold rows without numeric readouts, and the mode-dependent icons.

test.use({ baseURL: BASE_URL });

const DATASET_ALIAS = 'annotation-mst3ebzz-o5px';
const OUT = '/tmp/round33c-verify';

test('tutorial click-through, threshold rows, icons', async ({ page }) => {
  test.setTimeout(300000);
  fs.mkdirSync(OUT, { recursive: true });
  const pageErrors: string[] = [];
  page.on('pageerror', (e) => pageErrors.push(e.message));

  const envText = fs.readFileSync('/data/nmechtel/bioengine/.env', 'utf8');
  const token = envText.match(/HYPHA_TOKEN=(\S+)/)![1];
  await page.addInitScript(({ tok, expiry }) => {
    localStorage.setItem('token', tok);
    localStorage.setItem('tokenExpiry', expiry);
    // Deliberately NOT setting tutorial-seen: the tutorial should open.
    localStorage.setItem('bioimage-annotation-draw-mode', 'lasso');
  }, { tok: token, expiry: new Date(Date.now() + 3 * 60 * 60 * 1000).toISOString() });

  await page.goto(`/#/colab/annotate?session_id=${DATASET_ALIAS}&label=cells`);
  await expect(page.locator('canvas').first()).toBeVisible({ timeout: 90000 });

  // --- Tutorial click-through: it auto-opens as a fixed overlay card (not
  // role=dialog); page through every step via Next, end with Finish ---
  const tutorialTexts: string[] = [];
  // The tutorial card is the MUI Paper holding the nav buttons; a bare div
  // filter resolves to the innermost button row and misses the step text.
  const card = page.locator('.MuiPaper-root').filter({ has: page.getByRole('button', { name: /^(Next|Finish)$/ }) }).first();
  const nextBtn = page.getByRole('button', { name: /^(Next|Finish)$/ });
  await expect(nextBtn).toBeVisible({ timeout: 20000 });
  for (let step = 0; step < 30; step++) {
    tutorialTexts.push(await card.innerText());
    await page.screenshot({ path: `${OUT}/tutorial-step-${step}.png` });
    // MUI uppercases button text via CSS, so innerText yields "FINISH".
    const label = (await nextBtn.innerText()).toLowerCase();
    await nextBtn.click();
    if (label === 'finish') break;
    await page.waitForTimeout(200);
    if (!(await nextBtn.isVisible().catch(() => false))) break;
  }
  await expect(nextBtn).not.toBeVisible({ timeout: 10000 });

  const allText = tutorialTexts.join('\n');
  // Every shortcut family must be documented
  for (const needle of ['Ctrl+Z', 'M', 'S', 'D', 'C', 'E', 'A', 'B', '0']) {
    expect(allText).toContain(needle);
  }
  expect(allText.toLowerCase()).toContain('double');
  expect(/Arrow ?Up|↑/i.test(allText)).toBe(true);
  expect(/Arrow ?Down|↓/i.test(allText)).toBe(true);
  expect(/zoom/i.test(allText)).toBe(true);
  // Punctuation rules on rendered copy
  expect(allText.includes('—')).toBe(false); // em dash
  fs.writeFileSync(`${OUT}/tutorial-text.txt`, allText);

  // --- Icons: Draw Mask icon changes between modes ---
  const expandToolbarBtn = page.getByRole('button', { name: 'Expand toolbar' });
  if (await expandToolbarBtn.isVisible({ timeout: 3000 }).catch(() => false)) {
    await expandToolbarBtn.click();
  }
  const drawBtn = page.locator('[data-tool="polygon"]').first();
  const iconPath = async () =>
    drawBtn.locator('svg path').first().getAttribute('d');
  const lassoIcon = await iconPath();
  await drawBtn.dblclick();
  await expect(page.getByLabel('Increase brush radius')).toBeVisible({ timeout: 10000 });
  const brushIcon = await iconPath();
  expect(brushIcon).not.toBe(lassoIcon);
  await page.screenshot({ path: `${OUT}/toolbar-brush-mode.png` });
  await drawBtn.dblclick();
  await expect(page.getByLabel('Increase brush radius')).not.toBeVisible({ timeout: 10000 });
  expect(await iconPath()).toBe(lassoIcon);

  // --- Threshold rows: no numeric readout next to the info buttons ---
  await page.getByRole('button', { name: 'Full Image Segmentation' }).first().click({ force: true });
  const backendSelect = page.getByRole('combobox').first();
  await expect(backendSelect).toBeVisible({ timeout: 15000 });
  await backendSelect.click();
  await page.getByRole('option', { name: 'Cellpose-SAM', exact: true }).click();
  // Expand Refine Results (pre-run it renders collapsed but expandable)
  const refineHeader = page.getByRole('button', { name: /^Refine Results/ }).and(page.locator('button[aria-expanded]'));
  if ((await refineHeader.getAttribute('aria-expanded')) === 'false') {
    await refineHeader.click();
  }
  for (const label of ['Flow Threshold', 'Cell Probability Threshold']) {
    const labelRow = page.getByText(label, { exact: true }).locator('xpath=ancestor::*[position()=1]');
    const rowText = (await labelRow.innerText()).replace(label, '').trim();
    // No digits in the label row itself (slider value chips live elsewhere)
    expect(/\d/.test(rowText)).toBe(false);
  }
  await page.screenshot({ path: `${OUT}/refine-threshold-rows.png` });

  expect(pageErrors).toEqual([]);
});
