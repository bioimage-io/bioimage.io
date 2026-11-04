import { test, expect, Page } from '@playwright/test';
import * as path from 'path';
import { BASE_URL } from './baseUrl';

/**
 * The agent prompt on `/bioengine/worker-admin` (no `?service_id=`), both ways
 * round: with the Hypha token included, which is the default, and without it.
 *
 * Nothing here talks to a real worker or mints a real token. `window.__hyphaStore`
 * (a dev-only seam in src/store/hyphaStore.ts, compiled out of production) is
 * handed a fake logged-in Hypha server whose `listServices` returns one worker
 * and whose `generateToken` returns a known string, so the real component tree
 * renders against controlled data and the token is something the assertions can
 * search for by value.
 *
 * Run against a dev server (the seam does not exist in a production build):
 *   BROWSER=none ./node_modules/.bin/react-scripts start
 *   npx playwright test tests/worker-admin-token-optin.spec.ts
 */

const VIEWPORT = { width: 1280, height: 900 };

test.use({
  baseURL: BASE_URL,
  viewport: VIEWPORT,
  serviceWorkers: 'block',
  launchOptions: { args: ['--disable-gpu', '--no-sandbox'] },
});

test.beforeAll(() => {
  // The close gate wants the viewport that actually ran, printed by the
  // harness rather than typed on a command line.
  console.log(`viewport: ${VIEWPORT.width}x${VIEWPORT.height}`);
});

const PAGE = '/#/bioengine/worker-admin';
const WORKSPACE = 'stub-workspace';
const SERVICE_ID = `${WORKSPACE}/stub-bioengine-worker:bioengine-worker`;

/** Must match FEATURED_SERVICE_NAME in BioEngineWorkerList, which is what makes
 *  the admin page apply its one-shot default selection. Selecting a worker is
 *  not what this spec is about, so it leans on that default rather than
 *  clicking a card. */
const FEATURED_SERVICE_NAME = 'BioImage.IO BioEngine Worker';

/** A value no part of the app could produce by accident, so finding it in the
 *  page is proof it came from `generateToken` and not from a placeholder. */
const STUB_TOKEN = 'stub-token-8c1f4a9e-DO-NOT-SHIP';

const SHOTS = path.join(__dirname, 'screenshots');

/**
 * Cut the page off from every origin except the dev server, so the stubbed
 * store is the only thing driving the UI and real hypha.aicell.io reads cannot
 * race it. Registered first so per-test routes take precedence.
 */
async function blockExternalNetwork(page: Page) {
  const origin = new URL(BASE_URL).origin;
  await page.route('**/*', async (route) => {
    const url = route.request().url();
    if (url.startsWith(origin) || url.startsWith('data:') || url.startsWith('blob:')) {
      await route.fallback();
      return;
    }
    await route.abort();
  });
}

/**
 * Put a fake logged-in Hypha session in the store: one bioengine-worker service
 * in the user's own workspace, and a `generateToken` that hands back
 * STUB_TOKEN. `tokenCalls` is left on `window` so a test can tell "the token is
 * absent because it was cleared" from "the token is absent because minting it
 * never happened".
 */
async function stubLoggedIn(page: Page) {
  await page.evaluate(
    ({ serviceId, workspace, featuredName, stubToken }) => {
      (window as any).__tokenCalls = [];
      const worker = {
        get_status: async () => ({
          bioengine_version: '0.16.61',
          is_ready: true,
          workspace,
          geo_location: null,
          ray_cluster: {},
          bioengine_apps: { service_id: null },
        }),
        get_app_status: async () => ({}),
      };
      const server = {
        // LoginButton reads server.config.user unguarded, so a fake server
        // without a config crashes the navbar before the page renders.
        config: { user: { id: 'stub-admin-id', email: 'stub-admin@example.org' }, workspace },
        generateToken: async (opts: any) => {
          (window as any).__tokenCalls.push(opts);
          return stubToken;
        },
        listServices: async (_query: any) => [
          { id: serviceId, name: featuredName, description: 'a stubbed worker' },
        ],
        getService: async (id: string) => {
          if (id === 'public/artifact-manager') {
            return { read: async () => ({}), list: async () => ({ items: [] }) };
          }
          if (id === serviceId) return worker;
          // Every other workspace the list probes, including the public one,
          // legitimately has no worker here.
          throw new Error(`stub server has no service ${id}`);
        },
      };
      (window as any).__hyphaStore.setState({
        server,
        user: { id: 'stub-admin-id', email: 'stub-admin@example.org', roles: [] },
        isConnected: true,
        isLoggedIn: true,
        isAuthenticated: true,
        connectionStatus: 'connected',
      });
      (window as any).__hyphaStore.getState().markHyphaReachable();
    },
    { serviceId: SERVICE_ID, workspace: WORKSPACE, featuredName: FEATURED_SERVICE_NAME, stubToken: STUB_TOKEN }
  );
}

async function openPromptPage(page: Page) {
  await blockExternalNetwork(page);
  await page.goto(PAGE);
  await page.waitForFunction(() => !!(window as any).__hyphaStore, null, { timeout: 30000 });
  await stubLoggedIn(page);
  await expect(page.getByText('Manage a BioEngine Worker')).toBeVisible({ timeout: 20000 });
  // The default selection lands only once the stubbed worker has arrived, and
  // the prompt names no worker until then.
  await expect(page.locator('pre')).toContainText(SERVICE_ID, { timeout: 20000 });
}

const promptText = (page: Page) => page.locator('pre').first().innerText();
const checkbox = (page: Page) => page.getByTestId('include-token');
/** `exact` is load-bearing: every worker card carries a "Copy service ID"
 *  button, whose accessible name contains "Copy", so a substring match resolves
 *  to two elements and fails on strict mode rather than on the behaviour. */
const copyButton = (page: Page) => page.getByRole('button', { name: 'Copy', exact: true });

test('by default the token is included, and the prompt is copyable', async ({ page }, testInfo) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(String(e)));

  await openPromptPage(page);

  await expect(checkbox(page)).toBeChecked();
  await expect(page.getByText('A read-write Hypha token for your workspace is included')).toBeVisible();

  const prompt = await promptText(page);
  expect(prompt).toContain(`HYPHA_TOKEN=${STUB_TOKEN}`);
  expect(prompt).toContain(`Worker: ${SERVICE_ID}`);
  expect(prompt).toContain('https://bioimage.io/skills/bioengine/SKILL.md');
  await expect(copyButton(page)).toBeEnabled();

  const shot = path.join(SHOTS, 'worker-admin-token-included.png');
  await page.screenshot({ path: shot, fullPage: false });
  console.log(`screenshot: ${shot}`);

  expect(errors, `page errors: ${errors.join(' | ')}`).toHaveLength(0);
});

test('unticking the box removes the token from the prompt and still allows copying', async ({ page }, testInfo) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(String(e)));

  await openPromptPage(page);
  // Establish the token really was there first, so a later absence is the
  // untick and not a prompt that never carried one.
  expect(await promptText(page)).toContain(STUB_TOKEN);
  expect(await page.evaluate(() => (window as any).__tokenCalls.length)).toBeGreaterThan(0);

  await checkbox(page).uncheck();
  await expect(checkbox(page)).not.toBeChecked();

  const prompt = await promptText(page);
  expect(prompt).not.toContain(STUB_TOKEN);
  expect(prompt).not.toContain('HYPHA_TOKEN=');
  // It must still say a token is needed, rather than silently omitting it.
  expect(prompt).toContain('read-write Hypha token');
  expect(prompt).toContain('HYPHA_TOKEN');
  // Still names the worker and the skill, so unticking cost nothing else.
  expect(prompt).toContain(`Worker: ${SERVICE_ID}`);
  expect(prompt).toContain('https://bioimage.io/skills/bioengine/SKILL.md');

  // The whole point: copying is no longer blocked.
  await expect(copyButton(page)).toBeEnabled();
  await expect(page.getByText('No token is included, so this prompt is safe to paste anywhere')).toBeVisible();

  // And the cleared token is nowhere else on the page either.
  expect(await page.content()).not.toContain(STUB_TOKEN);

  const shot = path.join(SHOTS, 'worker-admin-token-excluded.png');
  await page.screenshot({ path: shot, fullPage: false });
  console.log(`screenshot: ${shot}`);

  expect(errors, `page errors: ${errors.join(' | ')}`).toHaveLength(0);
});

test('re-ticking the box mints a fresh token and puts it back', async ({ page }) => {
  await openPromptPage(page);

  await checkbox(page).uncheck();
  expect(await promptText(page)).not.toContain(STUB_TOKEN);
  const callsAfterUntick = await page.evaluate(() => (window as any).__tokenCalls.length);

  await checkbox(page).check();
  await expect(page.locator('pre')).toContainText(`HYPHA_TOKEN=${STUB_TOKEN}`, { timeout: 15000 });

  // A fresh mint, not a cached value that was never dropped. This is the
  // control for the previous test: if `clearToken` had only hidden the token,
  // this count would not move.
  const callsAfterRecheck = await page.evaluate(() => (window as any).__tokenCalls.length);
  expect(callsAfterRecheck).toBeGreaterThan(callsAfterUntick);
});

test('the token is requested read_write, not admin', async ({ page }) => {
  await openPromptPage(page);

  const calls = await page.evaluate(() => (window as any).__tokenCalls);
  expect(calls.length).toBeGreaterThan(0);
  for (const call of calls) {
    expect(call.permission).toBe('read_write');
    expect(call.expires_in).toBe(12 * 3600);
  }
});

test('the prompt is flat: no blank lines, one line per fact', async ({ page }) => {
  await openPromptPage(page);

  // With the token: skill line, worker line, token line.
  const withToken = await promptText(page);
  expect(withToken).not.toContain('\n\n');
  expect(withToken.trim().split('\n')).toHaveLength(3);

  await checkbox(page).uncheck();
  const withoutToken = await promptText(page);
  expect(withoutToken).not.toContain('\n\n');
  expect(withoutToken.trim().split('\n')).toHaveLength(3);
});

test('CONTROL: with no worker selected the copy is blocked even with a token', async ({ page }) => {
  await openPromptPage(page);

  // Deselect the default worker. The worker list's selection control is a
  // toggle button carrying aria-pressed, not a checkbox. This is the control
  // for the two copy-enabled assertions above: both would also pass if the
  // Copy button had simply been left permanently enabled.
  const selected = page.locator('button[aria-pressed="true"]');
  const n = await selected.count();
  expect(n, 'the default selection should have put one worker in the prompt').toBeGreaterThan(0);
  for (let i = 0; i < n; i += 1) {
    await selected.nth(0).click();
  }

  await expect(page.getByText('No worker selected')).toBeVisible({ timeout: 10000 });
  await expect(copyButton(page)).toBeDisabled();
});
