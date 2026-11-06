import { test, expect, Page } from '@playwright/test';
import * as fs from 'fs';
import * as path from 'path';
import { BASE_URL } from './baseUrl';

// Read rather than `import`: this repo's tsconfig does not enable
// resolveJsonModule, and the fixture is data, not code.
const LIVE_RAY_CLUSTER: Record<string, unknown> = JSON.parse(
  fs.readFileSync(path.join(__dirname, 'fixtures', 'worker-0.16.48-ray-cluster.json'), 'utf8')
);

// The worker dashboard's host co-tenancy panel, both ways round.
//
// `co_tenancy_warnings` is a bioengine 0.16.75 field and 0.16.75 is not
// published yet, so nothing here talks to a 0.16.75 worker. Instead
// `window.__hyphaStore` (a dev-only seam in src/store/hyphaStore.ts) is handed
// a fake Hypha server whose `get_status()` returns whatever payload a case
// needs. That makes the real component tree render against controlled data.
//
// The empty/absent case is NOT invented: tests/fixtures/worker-0.16.48-ray-cluster.json
// is the verbatim `ray_cluster` block read off the live KTH worker
// (bioimage-io/bioengine-worker-kth-6858b6d768-ccxbj:bioengine-worker,
// bioengine_version 0.16.48) on 2026-11-03, where the key is absent rather
// than an empty list. That is the shape the defensive read has to survive.
//
// Run against a dev server (the seam is compiled out of production):
//   BROWSER=none pnpm start
//   npx playwright test tests/worker-dashboard-co-tenancy.spec.ts

const VIEWPORT = { width: 1280, height: 900 };

test.use({
  baseURL: BASE_URL,
  viewport: VIEWPORT,
  serviceWorkers: 'block',
  launchOptions: { args: ['--disable-gpu'] },
});

test.beforeAll(() => {
  // The close gate wants the viewport that actually ran, printed by the
  // harness rather than typed on a command line.
  console.log(`viewport: ${VIEWPORT.width}x${VIEWPORT.height}`);
});

const SERVICE_ID = 'stub-workspace/stub-bioengine-worker:bioengine-worker';
const PAGE = `/#/bioengine/worker-admin?service_id=${encodeURIComponent(SERVICE_ID)}`;

// Two warnings in the shape bioengine/utils/host_census.py emits: long prose,
// written for a human by the worker, GPU first then memory. Shortened here
// only so the assertions can quote them whole.
const WARNINGS = [
  'GPU device(s) handed to this worker are also held by another BioEngine worker on this host: stub-worker-b (device 0). Each single-machine worker is its own Ray cluster, so neither scheduler can see the other\'s claim on the device.',
  'BioEngine workers on this host have together been promised more memory than it has: this worker claims 40.0 GiB and 1 co-tenant worker(s) claim 40.0 GiB, a total of 80.0 GiB against a budget of 57.6 GiB.',
];

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

async function waitForStoreSeam(page: Page) {
  await page.waitForFunction(() => !!(window as any).__hyphaStore, null, { timeout: 30000 });
}

/**
 * Put a fake logged-in Hypha session in the store whose worker service returns
 * `rayCluster` from `get_status()`. The dashboard's fetch effect depends on
 * `server` and `isLoggedIn`, so setting them here is what triggers the fetch.
 */
async function stubWorker(page: Page, rayCluster: Record<string, unknown>) {
  await page.evaluate(
    ({ rayCluster, serviceId }) => {
      const worker = {
        get_status: async () => ({
          service_start_time: Date.now() / 1000,
          service_uptime: 1234,
          worker_mode: 'external-cluster',
          bioengine_version: '0.16.75',
          is_ready: true,
          admin_users: ['stub-admin@example.org'],
          workspace: 'stub-workspace',
          client_id: 'stub-client',
          ray_cluster: rayCluster,
          bioengine_apps: { service_id: null },
        }),
        get_app_status: async () => ({}),
      };
      const server = {
        // LoginButton reads server.config.user unguarded, so a fake server
        // without a config crashes the navbar before the dashboard renders.
        config: { user: { id: 'stub-admin-id', email: 'stub-admin@example.org' }, workspace: 'stub-workspace' },
        getService: async (id: string) => {
          if (id === 'public/artifact-manager') {
            return { read: async () => ({}), list: async () => ({ items: [] }) };
          }
          if (id === serviceId) return worker;
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
    { rayCluster, serviceId: SERVICE_ID }
  );
}

async function openDashboard(page: Page, rayCluster: Record<string, unknown>) {
  await blockExternalNetwork(page);
  await page.goto(PAGE);
  await waitForStoreSeam(page);
  await stubWorker(page, rayCluster);
  // The panel this spec is about lives inside the Cluster Status card, so
  // waiting for that card is waiting for the status fetch to have landed.
  await expect(page.getByText('Cluster Status')).toBeVisible({ timeout: 20000 });
}

test('warnings present: the dashboard renders every string the worker returned', async ({ page }, testInfo) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(String(e)));

  await openDashboard(page, { ...LIVE_RAY_CLUSTER, co_tenancy_warnings: WARNINGS });

  const panel = page.getByTestId('co-tenancy-warnings');
  await expect(panel).toBeVisible();
  await expect(panel).toContainText('This host is shared with other BioEngine workers');

  const items = page.getByTestId('co-tenancy-warning');
  await expect(items).toHaveCount(WARNINGS.length);
  for (const [i, warning] of WARNINGS.entries()) {
    await expect(items.nth(i)).toHaveText(warning);
  }

  expect(errors).toEqual([]);

  const shot = testInfo.outputPath('co-tenancy-warnings.png');
  await page.screenshot({ path: shot, fullPage: false });
  testInfo.annotations.push({ type: 'screenshot', description: shot });
});

test('field absent (live 0.16.48 payload): nothing renders and nothing throws', async ({ page }, testInfo) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(String(e)));

  // Guard the fixture itself: if a future refresh of it ever carries the key,
  // this case would silently stop testing the absent shape.
  expect(Object.keys(LIVE_RAY_CLUSTER)).not.toContain('co_tenancy_warnings');

  await openDashboard(page, LIVE_RAY_CLUSTER);

  await expect(page.getByTestId('co-tenancy-warnings')).toHaveCount(0);
  await expect(page.getByTestId('co-tenancy-warning')).toHaveCount(0);
  // The rest of the card still rendered, so "nothing" means the panel only.
  await expect(page.getByText('Head Address')).toBeVisible();
  expect(errors).toEqual([]);

  const shot = testInfo.outputPath('co-tenancy-absent.png');
  await page.screenshot({ path: shot, fullPage: false });
  testInfo.annotations.push({ type: 'screenshot', description: shot });
});

test('warnings empty list: nothing renders', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(String(e)));

  await openDashboard(page, { ...LIVE_RAY_CLUSTER, co_tenancy_warnings: [] });

  await expect(page.getByTestId('co-tenancy-warnings')).toHaveCount(0);
  await expect(page.getByText('Head Address')).toBeVisible();
  expect(errors).toEqual([]);
});

test('one warning: the heading is singular', async ({ page }) => {
  await openDashboard(page, { ...LIVE_RAY_CLUSTER, co_tenancy_warnings: [WARNINGS[0]] });

  const panel = page.getByTestId('co-tenancy-warnings');
  await expect(panel).toBeVisible();
  await expect(panel).toContainText('This host is shared with another BioEngine worker');
  await expect(page.getByTestId('co-tenancy-warning')).toHaveCount(1);
});
