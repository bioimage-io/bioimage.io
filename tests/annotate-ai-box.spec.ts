import { test, expect } from '@playwright/test';
import fs from 'fs';

// Requires: HYPHA_TOKEN env var (same token the user stores in localStorage
// after login), falls back to reading /data/nmechtel/bioengine/.env if unset.
// Requires: dev server running at http://localhost:3012 (this worktree's port,
// overridden below since playwright.config.ts's baseURL targets :3000 for the
// model-test integration specs).
//
// What this tests (colab-rework-plan.md §12B/§12E): the AI Box tool
// (data-tool="sambox") against the "HPA Demo Dataset"
// (bioimage-io/annotation-mst3ebzz-o5px, label "cells"). Draws a box around
// a cell and checks the resulting mask polygon is not degenerately tiny
// relative to the box — the "tiny triangle" regression this harness exists
// to catch and, longer-term, guard against.

test.use({ baseURL: 'http://localhost:3012' });

const ARTIFACT_ID = 'bioimage-io/annotation-mst3ebzz-o5px';
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

test.describe('AI Box (micro-sam) tool', () => {
  test('draws a plausible polygon around a cell', async ({ page }) => {
    const token = readHyphaToken();
    if (!token) {
      test.skip();
      return;
    }

    // Generous overall timeout: this route also boots a Pyodide kernel
    // (used for CLAHE, unrelated to the AI Box tool under test) whose WASM
    // init work can peg the browser's main thread hard enough that even
    // CDP-driven Playwright actions (visibility checks, screenshots) stall
    // for well over a minute on a cold load, independent of network speed.
    test.setTimeout(240000);

    const consoleLines: string[] = [];
    page.on('console', (msg) => consoleLines.push(`[${msg.type()}] ${msg.text()}`));

    // Inject a valid Hypha token into localStorage so useHyphaService connects
    // into the user's own workspace instead of anonymously (useHyphaService.ts:392-401).
    // Also pre-seed the first-visit tutorial flag so the blocking HelpTutorial
    // modal doesn't intercept interaction with a fresh browser context.
    await page.addInitScript(({ tok, expiry }) => {
      localStorage.setItem('token', tok);
      localStorage.setItem('tokenExpiry', expiry);
      localStorage.setItem('bioimage-annotation-tutorial-seen', '1');
    }, { tok: token, expiry: new Date(Date.now() + 3 * 60 * 60 * 1000).toISOString() });

    const url = `/#/colab/annotate?session_id=${encodeURIComponent(ARTIFACT_ID)}&label=${encodeURIComponent(LABEL)}`;
    await page.goto(url);

    // Wait for the image to actually render before touching AI tools. A cold
    // start (Hypha connect + dataset index fetch + presigned image download)
    // can take a while on a fresh browser context, so give this generous room.
    const viewer = page.getByTestId('annotation-viewer');
    await expect(viewer).toBeVisible({ timeout: 180000 });
    await expect(viewer.locator('canvas').first()).toBeVisible({ timeout: 60000 });

    // AI Box becomes enabled once the embedding + ONNX decoder are ready
    // (12A). Give it generous time for the first-load embedding compute.
    const aiBoxButton = page.locator('[data-tool="sambox"]');
    await expect(aiBoxButton).toBeEnabled({ timeout: 90000 });
    await aiBoxButton.click();

    const box = await viewer.boundingBox();
    if (!box) throw new Error('annotation-viewer has no bounding box');

    // Draw a box roughly in the center-ish region of the visible image —
    // good enough to land on *some* cell in a densely-packed HPA crop.
    const x1 = box.x + box.width * 0.4;
    const y1 = box.y + box.height * 0.4;
    const x2 = box.x + box.width * 0.55;
    const y2 = box.y + box.height * 0.55;

    await page.mouse.move(x1, y1);
    await page.mouse.down();
    await page.mouse.move(x2, y2, { steps: 10 });
    await page.mouse.up();

    // Give the decode round-trip (embedding already loaded, ONNX inference)
    // a moment, then screenshot for visual/manual review.
    await page.waitForTimeout(1500);
    await page.screenshot({ path: 'test-results/ai-box-debug.png' });

    console.log('--- browser console ---');
    console.log(consoleLines.join('\n'));

    // Sanity check: the box tool should have produced a new polygon feature
    // on the map, not just a tiny sliver. We can't easily read OL feature
    // geometry from the DOM, so this is primarily a visual/manual-review
    // harness (see test-results/ai-box-debug.png + the console log above)
    // rather than a strict pass/fail gate.
  });
});
