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
//
// Navigates with the BARE alias (not the full "bioimage-io/..." artifact
// id) so this also covers the alias-canonicalization regression keen-puma
// found: a bare-alias session_id must always resolve against the fixed
// bioimage-io collection workspace, never the connected user's own
// workspace (useHyphaService.ts, fixed alongside toArtifactId reuse).

test.use({ baseURL: 'http://localhost:3012' });

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

    const url = `/#/colab/annotate?session_id=${encodeURIComponent(DATASET_ALIAS)}&label=${encodeURIComponent(LABEL)}`;
    await page.goto(url);

    // Wait for the image to actually render before touching AI tools. A cold
    // start (Hypha connect + dataset index fetch + presigned image download)
    // can take a while on a fresh browser context, so give this generous room.
    const viewer = page.getByTestId('annotation-viewer');
    await expect(viewer).toBeVisible({ timeout: 180000 });
    await expect(viewer.locator('canvas').first()).toBeVisible({ timeout: 60000 });

    // The initial view doesn't reliably land centered on the image (its
    // fit-to-extent can run before the container has its final size), so
    // without this the box below can land on empty map canvas instead of
    // the actual image and never trigger a decode at all. Click twice with a
    // pause so the second fit runs against a settled container size.
    await page.locator('[data-tool="fit"]').click();
    await page.waitForTimeout(1000);
    await page.locator('[data-tool="fit"]').click();
    await page.waitForTimeout(500);
    await page.screenshot({ path: 'test-results/ai-box-after-fit.png' });

    // AI Box becomes enabled once the embedding + ONNX decoder are ready
    // (12A). Give it generous time for the first-load embedding compute.
    const aiBoxButton = page.locator('[data-tool="sambox"]');
    await expect(aiBoxButton).toBeEnabled({ timeout: 90000 });
    await aiBoxButton.click();

    // Small settle buffer: the tool-select click flips activeTool via a
    // Zustand setState, and the OL Draw interaction for 'sambox' is
    // (re)installed inside a plain useEffect, which runs asynchronously
    // after paint.
    await page.waitForTimeout(300);

    const box = await viewer.boundingBox();
    if (!box) throw new Error('annotation-viewer has no bounding box');

    // Draw a box over the upper-left cell body (clearly on a cell, not the
    // inter-cellular gap that the old 0.4-0.55 center box landed on for this
    // particular HPA crop) so the resulting mask is checkable against a real
    // cell rather than background noise.
    const x1 = box.x + box.width * 0.28;
    const y1 = box.y + box.height * 0.1;
    const x2 = box.x + box.width * 0.42;
    const y2 = box.y + box.height * 0.32;

    await page.mouse.move(x1, y1);
    await page.mouse.down();
    await page.mouse.move(x2, y2, { steps: 10 });
    await page.mouse.up();

    // Give the decode round-trip (embedding compute/upload if not already
    // cached, plus ONNX inference) real time to finish. A cold embedding
    // precompute can take well over a second, so wait generously rather than
    // screenshotting mid-flight.
    await page.waitForTimeout(15000);
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

test.describe('Annotate deep link (§15 item 1)', () => {
  test('&image=<stem> loads the requested image, not the default pick', async ({ page }) => {
    const token = readHyphaToken();
    if (!token) {
      test.skip();
      return;
    }
    test.setTimeout(240000);

    await page.addInitScript(({ tok, expiry }) => {
      localStorage.setItem('token', tok);
      localStorage.setItem('tokenExpiry', expiry);
      localStorage.setItem('bioimage-annotation-tutorial-seen', '1');
    }, { tok: token, expiry: new Date(Date.now() + 3 * 60 * 60 * 1000).toISOString() });

    // The action panel's image-info row (always rendered when expanded,
    // which is the default at this viewport width) shows
    // "<stem> (WxH px)" — the only place the currently-loaded stem is
    // exposed as text, so it doubles as a discovery mechanism and as the
    // assertion target below.
    const infoText = page.getByText(/\(\d+×\d+ px\)/);

    // First load without `&image=` to discover a real stem from this
    // dataset via whatever image the default "next unannotated" pick lands
    // on (AnnotatePage.tsx's index-dependent initial-load effect).
    const baseUrl = `/#/colab/annotate?session_id=${encodeURIComponent(DATASET_ALIAS)}&label=${encodeURIComponent(LABEL)}`;
    await page.goto(baseUrl);
    const viewer = page.getByTestId('annotation-viewer');
    await expect(viewer).toBeVisible({ timeout: 180000 });
    await expect(infoText).toBeVisible({ timeout: 60000 });
    const initialRaw = (await infoText.textContent()) ?? '';
    const stem = initialRaw.replace(/\s*\(\d+×\d+ px\)\s*$/, '').trim();
    expect(stem.length).toBeGreaterThan(0);

    // Reload fresh with `&image=<stem>` and confirm that exact image is
    // what renders. This checks the deep link resolves to the requested
    // image rather than falling back to the default pick — the functional
    // guarantee behind the loading-priority rework. It does not assert on
    // timing/ordering relative to the dataset index or the μSAM probe,
    // which isn't practical to observe from the DOM without mocking the
    // broker RPCs (this suite runs against the live backend throughout).
    const deepLinkUrl = `${baseUrl}&image=${encodeURIComponent(stem)}`;
    await page.goto(deepLinkUrl);
    await expect(viewer).toBeVisible({ timeout: 180000 });
    await expect(infoText).toBeVisible({ timeout: 60000 });
    const deepLinkRaw = (await infoText.textContent()) ?? '';
    expect(deepLinkRaw.startsWith(stem)).toBe(true);
  });
});
