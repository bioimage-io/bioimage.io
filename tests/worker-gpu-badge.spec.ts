import { test, expect } from '@playwright/test';
import fs from 'fs';
import { BASE_URL } from './baseUrl';

// Regression guard for issue #0027.
//
// A BioEngine app can hold a GPU in two ways. Whole-GPU apps set num_gpus.
// Partial-GPU apps ask by VRAM instead (gpu_memory_mb), which leaves num_gpus
// at 0. The worker dashboard used to gate its GPU badge on num_gpus > 0 alone,
// so a partial-GPU app rendered no badge and read as CPU-only on the card.
//
// Rather than assert against a fixed app list, this spec asks the worker what
// it is actually running and cross-checks every card against that answer. The
// live deployment set changes constantly, so a hardcoded expectation would rot
// within days.
//
// Requires: HYPHA_TOKEN (falls back to /data/nmechtel/bioengine/.env) and a dev
// server at E2E_BASE_URL.

test.use({ baseURL: BASE_URL });

const HYPHA_SERVER_URL = process.env.HYPHA_SERVER_URL || 'https://hypha.aicell.io';

// A worker's client id carries a random suffix that changes on every roll, so
// the spec globs for the site and resolves the concrete id from the response.
const WORKER_GLOB = process.env.E2E_WORKER_GLOB || 'bioengine-worker-denbi-*:bioengine-worker';

type AppStatus = {
  gpu_enabled?: boolean;
  application_resources?: { num_gpus?: number };
  deployed_by_worker_client_id?: string;
};

function readHyphaToken(): string | undefined {
  if (process.env.HYPHA_TOKEN) return process.env.HYPHA_TOKEN;
  try {
    return fs.readFileSync('/data/nmechtel/bioengine/.env', 'utf8').match(/HYPHA_TOKEN=(\S+)/)?.[1];
  } catch {
    return undefined;
  }
}

/** The badge text the card should carry for an app, or null when it should carry none. */
function expectedGpuBadge(app: AppStatus): string | null {
  const n = app.application_resources?.num_gpus ?? 0;
  if (n > 0) return `${n} GPU${n !== 1 ? 's' : ''}`;
  return app.gpu_enabled === true ? 'Shared GPU' : null;
}

test('worker dashboard badges every GPU app, including partial-GPU ones', async ({ page, request }, testInfo) => {
  const token = readHyphaToken();
  if (!token) {
    test.skip();
    return;
  }
  test.setTimeout(180000);

  const statusUrl =
    `${HYPHA_SERVER_URL}/bioimage-io/services/${WORKER_GLOB}/get_app_status?_mode=first`;
  const res = await request.get(statusUrl, { headers: { Authorization: `Bearer ${token}` }, timeout: 60000 });
  expect(res.ok(), `get_app_status failed: ${res.status()}`).toBeTruthy();
  const apps: Record<string, AppStatus> = await res.json();

  const appIds = Object.keys(apps).filter((k) => apps[k] && typeof apps[k] === 'object');
  if (appIds.length === 0) {
    testInfo.annotations.push({
      type: 'skip-reason',
      description: 'no apps deployed on the worker, so there are no cards to check.',
    });
    test.skip();
    return;
  }

  const clientId = appIds.map((id) => apps[id].deployed_by_worker_client_id).find(Boolean);
  expect(clientId, 'worker did not report deployed_by_worker_client_id').toBeTruthy();
  const serviceId = `bioimage-io/${clientId}:bioengine-worker`;

  await page.addInitScript(({ tok, expiry }) => {
    localStorage.setItem('token', tok);
    localStorage.setItem('tokenExpiry', expiry);
  }, { tok: token, expiry: new Date(Date.now() + 3 * 60 * 60 * 1000).toISOString() });

  await page.goto(`/#/bioengine/worker?service_id=${encodeURIComponent(serviceId)}`);
  await expect(page.getByText(/Application ID:/).first()).toBeVisible({ timeout: 90000 });
  // The cards mount per app as their status resolves, so let the list settle
  // before reading it rather than racing the slowest card.
  await expect
    .poll(() => page.getByText(/Application ID:/).count(), { timeout: 60000 })
    .toBeGreaterThan(0);
  await page.waitForTimeout(3000);

  const badgesByApp: Record<string, string[] | null> = await page.evaluate(() => {
    const out: Record<string, string[] | null> = {};
    const idParagraphs = [...document.querySelectorAll('p')].filter((p) =>
      p.textContent?.trim().startsWith('Application ID:')
    );
    for (const p of idParagraphs) {
      const appId = (p.textContent || '').replace('Application ID:', '').trim();
      // Walk up to the smallest ancestor that holds this card's Resources
      // section and exactly one Application ID, so a two-column grid can never
      // hand back the neighbouring card's badges.
      let node: HTMLElement | null = p.parentElement;
      let root: HTMLElement | null = null;
      for (let i = 0; i < 12 && node; i++) {
        const ps = [...node.querySelectorAll('p')];
        const ownIds = ps.filter((q) => q.textContent?.trim().startsWith('Application ID:')).length;
        const resLabel = ps.find((q) => q.textContent?.trim() === 'Resources:');
        if (ownIds > 1) break;
        if (resLabel && ownIds === 1) { root = node; break; }
        node = node.parentElement;
      }
      if (!root) { out[appId] = null; continue; }
      const resLabel = [...root.querySelectorAll('p')].find((q) => q.textContent?.trim() === 'Resources:');
      const section = resLabel?.parentElement;
      out[appId] = section ? [...section.querySelectorAll('span')].map((s) => (s.textContent || '').trim()) : null;
    }
    return out;
  });

  let partialGpuChecked = 0;
  const missingCards: string[] = [];

  for (const appId of appIds) {
    const badges = badgesByApp[appId];
    if (badges == null) {
      // An app can be undeployed between the status call and the render.
      missingCards.push(appId);
      continue;
    }
    const expectedBadge = expectedGpuBadge(apps[appId]);
    const actualBadge = badges.find((b) => /GPU/.test(b));

    if (expectedBadge === null) {
      expect(actualBadge, `${appId} is CPU-only but the card shows "${actualBadge}"`).toBeUndefined();
    } else {
      expect(actualBadge, `${appId} should show "${expectedBadge}"`).toBe(expectedBadge);
      if (expectedBadge === 'Shared GPU') partialGpuChecked += 1;
    }
  }

  if (missingCards.length > 0) {
    testInfo.annotations.push({
      type: 'note',
      description: `no card rendered for ${missingCards.join(', ')} (undeployed mid-run).`,
    });
  }

  // The whole point of #0027 is the partial-GPU case. Say so out loud when the
  // live worker happens not to be running one, so a green result is not read as
  // proof that case still works.
  if (partialGpuChecked === 0) {
    testInfo.annotations.push({
      type: 'note',
      description:
        'no partial-GPU app (gpu_enabled with num_gpus 0) was deployed, so the #0027 case itself was not exercised.',
    });
  }
});
