import { test, expect } from '@playwright/test';
import fs from 'fs';
import { BASE_URL } from './baseUrl';

// Requires: HYPHA_TOKEN env var, falls back to /data/nmechtel/bioengine/.env.
// Requires: dev server running at E2E_BASE_URL (default http://localhost:3000).
//
// Regression test for colab-rework-plan.md §18.1: every tool/action row's
// title text in the expanded ToolBar and ActionPanel sidebars must share a
// common left edge (icon column width + gap + padding are supposed to be
// identical across rows). Reads each `data-testid="row-title"` element's
// bounding box and asserts the left x is consistent within 1px, per sidebar.

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

test('tool and action row titles share a common left edge within 1px, per sidebar', async ({ page }) => {
  const token = readHyphaToken();
  if (!token) {
    test.skip();
    return;
  }
  test.setTimeout(120000);

  // Wide desktop viewport so both sidebars default to their expanded state
  // (usePanelExpansion.defaultExpanded requires window.innerWidth >= 900).
  await page.setViewportSize({ width: 1400, height: 900 });

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

  const toolsSidebar = page.locator('[role="toolbar"][aria-label="Annotation tools"]');
  const actionsSidebar = page.locator('[role="toolbar"][aria-label="Annotation actions"]');
  await expect(toolsSidebar).toBeVisible();
  await expect(actionsSidebar).toBeVisible();

  for (const [name, sidebar] of [['ToolBar', toolsSidebar], ['ActionPanel', actionsSidebar]] as const) {
    const titles = sidebar.getByTestId('row-title');
    const count = await titles.count();
    expect(count, `${name}: expected at least 2 row titles to compare`).toBeGreaterThan(1);

    const xs: number[] = [];
    for (let i = 0; i < count; i++) {
      const box = await titles.nth(i).boundingBox();
      expect(box, `${name}: row title ${i} has no bounding box (not rendered/visible)`).not.toBeNull();
      xs.push(box!.x);
    }

    const minX = Math.min(...xs);
    const maxX = Math.max(...xs);
    expect(maxX - minX, `${name}: row title left-x spread is ${maxX - minX}px (xs=${JSON.stringify(xs)})`).toBeLessThanOrEqual(1);
  }
});
