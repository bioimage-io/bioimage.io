import { test, expect } from '@playwright/test';
import fs from 'fs';
import { BASE_URL } from './baseUrl';

// Round-36 acceptance (keen-puma, confirmed via svamp thread h5BkpX6uBC):
// 1. Select 2+ masks with the Select tool, press Expand Mask (button or "A")
//    to merge them via geometric union. Touching/overlapping masks merge into
//    one feature with a single undo snapshot; non-touching masks no-op with a
//    brief toast instead of silently producing a disjoint multipolygon.
//    Exactly one mask selected keeps the original single-mask Expand
//    behavior (switches into the paint-to-expand tool).
// 2. LabelManager shows an info icon next to each label badge whose tooltip
//    reveals the label's description, or "No description provided" if unset.

test.use({ baseURL: BASE_URL });

const DATASET_ALIAS = 'annotation-mst3ebzz-o5px';
const LABEL = 'cells';
const HYPHA_SERVER_URL = process.env.REACT_APP_HYPHA_SERVER_URL || 'https://hypha.aicell.io';

function readHyphaToken(): string | undefined {
  if (process.env.HYPHA_TOKEN) return process.env.HYPHA_TOKEN;
  try {
    const envText = fs.readFileSync('/data/nmechtel/bioengine/.env', 'utf8');
    return envText.match(/HYPHA_TOKEN=(\S+)/)?.[1];
  } catch {
    return undefined;
  }
}

async function injectToken(page: import('@playwright/test').Page, token: string) {
  await page.addInitScript(({ tok, expiry }) => {
    localStorage.setItem('token', tok);
    localStorage.setItem('tokenExpiry', expiry);
    localStorage.setItem('bioimage-annotation-tutorial-seen', '1');
  }, { tok: token, expiry: new Date(Date.now() + 3 * 60 * 60 * 1000).toISOString() });
}

// Best-effort direct broker call for test cleanup, mirroring
// colab-overview-sharing.spec.ts's cleanupLabel: idempotent, safe even if the
// label is already gone.
async function cleanupLabel(token: string, artifactId: string, name: string): Promise<void> {
  try {
    await fetch(`${HYPHA_SERVER_URL}/bioimage-io/services/annotation-broker/delete_label`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ artifact_id: artifactId, name }),
    });
  } catch {
    // Best-effort only.
  }
}

async function clearAllMasks(page: import('@playwright/test').Page) {
  await page.getByRole('button', { name: /Clear All/ }).click({ force: true });
  const confirmClear = page.getByRole('button', { name: 'Clear All', exact: true }).last();
  if (await confirmClear.isVisible({ timeout: 2000 }).catch(() => false)) {
    await confirmClear.click();
  }
  await page.waitForTimeout(300);
}

// Reads the current mask count via the Filter Masks dialog's Count button
// (Typography "{matching} of {total} masks match the filter."), then closes
// the dialog without applying anything.
async function countMasks(page: import('@playwright/test').Page): Promise<number> {
  await page.locator('[data-tool="filter"]').first().click({ force: true });
  await expect(page.getByRole('dialog').getByText('Filter Masks by Area')).toBeVisible({ timeout: 10000 });
  await page.getByRole('button', { name: 'Count' }).click();
  const preview = page.getByText(/\d+ of \d+ masks match the filter\./);
  await expect(preview).toBeVisible({ timeout: 5000 });
  const text = (await preview.textContent())!;
  const total = parseInt(text.match(/of (\d+) masks/)![1], 10);
  await page.locator('[role="dialog"] button').filter({ has: page.locator('svg[data-testid="CloseIcon"]') }).click();
  // Wait out the MUI exit transition: the backdrop keeps intercepting clicks
  // for a moment after the dialog visually fades, which would otherwise
  // swallow the very next click aimed at the canvas underneath.
  await expect(page.getByRole('dialog')).toHaveCount(0, { timeout: 5000 });
  return total;
}

// Paints a near-circular brush blob (mouse down -> tiny move -> up) centered
// at the given screen coordinates. A minimal drag keeps the stroke a single
// smooth dab (a clean circle from createPixelCircle) instead of a long
// union-of-many-dabs capsule, which avoids the jagged-boundary slivers that
// turf.difference produces when trimming two long, near-collinear strokes
// against each other.
async function paintStroke(page: import('@playwright/test').Page, center: { x: number; y: number }) {
  await page.mouse.move(center.x, center.y);
  await page.mouse.down();
  await page.mouse.move(center.x + 4, center.y, { steps: 3 });
  await page.mouse.up();
  await page.waitForTimeout(500);
}

// page.mouse.click() has no `modifiers` option (that's a Locator-only click
// option); a real Shift-held click needs explicit keyboard down/up around it.
async function shiftClick(page: import('@playwright/test').Page, x: number, y: number) {
  await page.keyboard.down('Shift');
  await page.mouse.click(x, y);
  await page.keyboard.up('Shift');
}

// Right after a label row is created, its async totals can land a moment
// later and nudge the row layout (adding the trailing "N · X%" span), which
// can shift the info icon out from under a mouse position Playwright already
// parked there, closing the MUI tooltip before the assertion runs. Retry the
// hover a few times (resetting mouse position first, so MUI's enter
// transition re-triggers cleanly) instead of guessing a fixed settle delay.
async function hoverAndExpectTooltip(
  page: import('@playwright/test').Page,
  icon: import('@playwright/test').Locator,
  tooltipText: string,
) {
  for (let attempt = 0; attempt < 3; attempt++) {
    await page.mouse.move(0, 0);
    await icon.hover();
    const visible = await page
      .getByRole('tooltip', { name: tooltipText })
      .isVisible({ timeout: 3000 })
      .catch(() => false);
    if (visible) return;
  }
  await icon.hover();
  await expect(page.getByRole('tooltip', { name: tooltipText })).toBeVisible({ timeout: 5000 });
}

test.describe('Round 36: merge touching masks', () => {
  test('2 touching masks merge via keyboard A, exactly-one stays unaffected, non-touching no-ops with a toast', async ({ page }) => {
    test.setTimeout(300000);

    const token = readHyphaToken();
    expect(token).toBeTruthy();
    await injectToken(page, token!);

    const consoleLogs: string[] = [];
    const pageErrors: string[] = [];
    page.on('pageerror', (e) => pageErrors.push(e.message));
    page.on('console', (m) => consoleLogs.push(m.text()));

    await page.goto(`/#/colab/annotate?session_id=${DATASET_ALIAS}&label=${LABEL}`);
    await expect(page.locator('canvas').first()).toBeVisible({ timeout: 90000 });
    await expect(page.getByText('Annotation Tools')).toBeVisible({ timeout: 30000 });
    await page.waitForTimeout(2000);

    const expandToolbarBtn = page.getByRole('button', { name: 'Expand toolbar' });
    if (await expandToolbarBtn.isVisible({ timeout: 3000 }).catch(() => false)) {
      await expandToolbarBtn.click();
    }

    await clearAllMasks(page);
    expect(await countMasks(page)).toBe(0);

    const canvas = page.locator('canvas').first();
    const cbox = (await canvas.boundingBox())!;
    const cx = cbox.x + cbox.width / 2;
    const cy = cbox.y + cbox.height / 2;

    // --- Case 1: two overlapping/touching strokes, merge via "A" ---
    await page.getByRole('button', { name: /Draw Mask/ }).first().click({ force: true });
    await paintStroke(page, { x: cx - 100, y: cy - 60 }); // mask A
    await paintStroke(page, { x: cx - 70, y: cy - 60 }); // mask B, overlaps A (30px center gap < 2x brush radius)
    expect(await countMasks(page)).toBe(2);

    await page.locator('[data-tool="select"]').first().click({ force: true });
    await page.mouse.click(cx - 100, cy - 60); // mask A's own paint center (never trimmed)
    await expect.poll(() => consoleLogs.some((l) => l.includes('[Select] Selected feature (1 total)'))).toBe(true);
    await shiftClick(page, cx - 70, cy - 60); // mask B's own paint center (never trimmed)
    await expect.poll(() => consoleLogs.some((l) => l.includes('[Select] Selected feature (2 total)'))).toBe(true);

    consoleLogs.length = 0;
    await page.keyboard.press('a');
    await expect.poll(() => consoleLogs.some((l) => l.includes('[Expander] Merged 2 selected masks'))).toBe(true);
    expect(await countMasks(page)).toBe(1); // two touching masks collapsed into one
    await expect(page.getByText('Selected masks do not touch, so they cannot be merged.')).not.toBeVisible();

    // Undo restores the pre-merge 2-mask state (single snapshot for the merge).
    await page.keyboard.press('Control+z');
    await page.waitForTimeout(500);
    expect(await countMasks(page)).toBe(2);

    // --- Case 2: same touching pair, merge via the Expand Mask button ---
    await page.locator('[data-tool="select"]').first().click({ force: true });
    await page.mouse.click(cx - 100, cy - 60);
    await expect.poll(() => consoleLogs.some((l) => l.includes('[Select] Selected feature (1 total)'))).toBe(true);
    await shiftClick(page, cx - 70, cy - 60);
    await expect.poll(() => consoleLogs.some((l) => l.includes('[Select] Selected feature (2 total)'))).toBe(true);
    consoleLogs.length = 0;
    await page.getByRole('button', { name: /Expand Mask/ }).first().click({ force: true });
    await expect.poll(() => consoleLogs.some((l) => l.includes('[Expander] Merged 2 selected masks'))).toBe(true);
    expect(await countMasks(page)).toBe(1);

    await clearAllMasks(page);
    expect(await countMasks(page)).toBe(0);

    // --- Case 3: exactly one mask selected, "A" keeps single-mask Expand behavior (no merge) ---
    await page.getByRole('button', { name: /Draw Mask/ }).first().click({ force: true });
    await paintStroke(page, { x: cx - 60, y: cy });
    expect(await countMasks(page)).toBe(1);

    await page.locator('[data-tool="select"]').first().click({ force: true });
    await page.mouse.click(cx - 60, cy);
    await expect.poll(() => consoleLogs.some((l) => l.includes('[Select] Selected feature (1 total)'))).toBe(true);
    consoleLogs.length = 0;
    await page.keyboard.press('a');
    await page.waitForTimeout(500);
    expect(consoleLogs.some((l) => l.includes('[Expander] Merged'))).toBe(false);
    expect(await countMasks(page)).toBe(1); // no merge, mask untouched
    await expect(page.getByText('Selected masks do not touch, so they cannot be merged.')).not.toBeVisible();

    await clearAllMasks(page);
    expect(await countMasks(page)).toBe(0);

    // --- Case 4: two non-touching masks selected, "A" no-ops with a toast ---
    await page.getByRole('button', { name: /Draw Mask/ }).first().click({ force: true });
    await paintStroke(page, { x: cx - 150, y: cy + 80 }); // mask C, far left
    await paintStroke(page, { x: cx + 95, y: cy + 130 }); // mask D, far right, no overlap
    expect(await countMasks(page)).toBe(2);

    await page.locator('[data-tool="select"]').first().click({ force: true });
    await page.mouse.click(cx - 150, cy + 80);
    await expect.poll(() => consoleLogs.some((l) => l.includes('[Select] Selected feature (1 total)'))).toBe(true);
    await shiftClick(page, cx + 95, cy + 130);
    await expect.poll(() => consoleLogs.some((l) => l.includes('[Select] Selected feature (2 total)'))).toBe(true);

    consoleLogs.length = 0;
    await page.keyboard.press('a');
    await expect(page.getByText('Selected masks do not touch, so they cannot be merged.')).toBeVisible({ timeout: 5000 });
    expect(consoleLogs.some((l) => l.includes('[Expander] Merged'))).toBe(false);
    expect(await countMasks(page)).toBe(2); // both masks still present, untouched

    await clearAllMasks(page);

    expect(pageErrors).toEqual([]);
  });
});

test.describe('Round 36: label description info icon', () => {
  test('hover reveals the description, or the no-description fallback when unset', async ({ page }) => {
    test.setTimeout(120000);

    const token = readHyphaToken();
    expect(token).toBeTruthy();
    await injectToken(page, token!);

    const withDescLabel = `pw-desc-test-${Date.now()}`;
    const noDescLabel = `pw-nodesc-test-${Date.now()}`;
    const descriptionText = 'Nuclei stained with DAPI, round 36 acceptance fixture.';

    const pageErrors: string[] = [];
    page.on('pageerror', (e) => pageErrors.push(e.message));

    try {
      await page.goto(`/#/colab/${encodeURIComponent(DATASET_ALIAS)}`);
      await expect(page.getByRole('heading', { name: 'Labels' })).toBeVisible({ timeout: 60000 });

      // Label with a description.
      await page.getByRole('button', { name: '+ New label' }).click({ force: true });
      await page.getByPlaceholder('Label name').fill(withDescLabel);
      await page.getByPlaceholder('Description (optional)').fill(descriptionText);
      await page.getByRole('button', { name: 'Create', exact: true }).click({ force: true });

      const withDescRow = page.locator('span.truncate', { hasText: withDescLabel });
      await expect(withDescRow).toBeVisible({ timeout: 30000 });
      const withDescIcon = withDescRow.locator('xpath=following-sibling::*[1]');
      await hoverAndExpectTooltip(page, withDescIcon, descriptionText);

      // Move the mouse away and let any open tooltip popper fully close before
      // interacting with the header again, in case the popper (anchored near
      // the topmost label row) visually overlaps the "+ New label" button and
      // would otherwise intercept the click at the OS/browser level (force:true
      // only skips Playwright's actionability checks, not real hit-testing).
      await page.mouse.move(0, 0);
      await page.waitForTimeout(300);

      // Label without a description falls back to the placeholder copy.
      await page.getByRole('button', { name: '+ New label' }).click({ force: true });
      const nameField = page.getByPlaceholder('Label name');
      await expect(nameField).toBeVisible({ timeout: 5000 });
      await nameField.fill(noDescLabel);
      await expect(nameField).toHaveValue(noDescLabel);
      await page.getByRole('button', { name: 'Create', exact: true }).click({ force: true });

      const noDescRow = page.locator('span.truncate', { hasText: noDescLabel });
      await expect(noDescRow).toBeVisible({ timeout: 30000 });
      const noDescIcon = noDescRow.locator('xpath=following-sibling::*[1]');
      await hoverAndExpectTooltip(page, noDescIcon, 'No description provided');

      expect(pageErrors).toEqual([]);
    } finally {
      if (token) {
        await cleanupLabel(token, `bioimage-io/${DATASET_ALIAS}`, withDescLabel);
        await cleanupLabel(token, `bioimage-io/${DATASET_ALIAS}`, noDescLabel);
      }
    }
  });
});
