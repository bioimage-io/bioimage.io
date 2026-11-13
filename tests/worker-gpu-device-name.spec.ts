import { test, expect } from '@playwright/test';
import fs from 'fs';
import { BASE_URL } from './baseUrl';

// Regression guard for issue #0025.
//
// The worker dashboard's node rows showed `accelerator_type`, which is the
// label Ray schedules on, not the device. Ray truncates it to a single letter
// on consumer cards ("G" for a GeForce), and on a vGPU slice it names the
// physical card rather than the slice, so an NVIDIA A40-16C (16 GB of a 48 GB
// A40) read as "A40". BioEngine 0.16.11 added `gpu_device_name` alongside it;
// the dashboard now shows the device name first and keeps the label as a
// separate labelled row, matching `_format_gpu_label` in the BioEngine CLI.
//
// This asserts against the worker's own `get_status` rather than a fixed
// device table: the fleet is upgraded and re-rolled constantly, so a
// hardcoded expectation would rot within days. That also makes the spec
// cover both arms wherever it is pointed. A worker older than 0.16.11 omits
// the field entirely and must degrade to the bare label, and a CPU-only node
// reports the string "NA" for both and must render neither row.
//
// Point it at one worker at a time, fully qualified, since the workers are
// spread over more than one Hypha workspace:
//   E2E_WORKER_SERVICE='reef-imaging/bioengine-worker-reef-server:bioengine-worker' \
//     npx playwright test tests/worker-gpu-device-name.spec.ts
//
// Requires: HYPHA_TOKEN (falls back to /data/nmechtel/bioengine/.env) and a dev
// server at E2E_BASE_URL.
//
// If get_status comes back 401, an expired HYPHA_TOKEN in the shell is
// shadowing the good one in .env; the fallback above only fires when the
// variable is unset, not when it is set and stale. Run the suite with
// `env -u HYPHA_TOKEN npx playwright test ...` to use the .env token instead.

test.use({ baseURL: BASE_URL, viewport: { width: 1280, height: 900 } });

// Deliberately the app's own seam name (src/config/hypha.ts), not a bare
// HYPHA_SERVER_URL. That shorter name is set to an unrelated Hypha deployment
// in some shells, which silently points this spec at a server where these
// workers are not registered and turns the whole run into a 404.
const HYPHA_SERVER_URL =
  process.env.REACT_APP_HYPHA_SERVER_URL || 'https://hypha.aicell.io';
const WORKER_SERVICE =
  process.env.E2E_WORKER_SERVICE ||
  'bioimage-io/bioengine-worker-denbi-ddd8bf799-kbnz7:bioengine-worker';

/** Ray's sentinel for "this node reports no value", mirroring the component. */
const NOT_AVAILABLE = 'NA';
const isReported = (v: unknown): v is string =>
  typeof v === 'string' && v.length > 0 && v !== NOT_AVAILABLE;

type NodeInfo = {
  node_ip?: string;
  head?: boolean;
  total_gpu?: number;
  accelerator_type?: string | null;
  gpu_device_name?: string | null;
};

function readHyphaToken(): string | undefined {
  if (process.env.HYPHA_TOKEN) return process.env.HYPHA_TOKEN;
  try {
    return fs.readFileSync('/data/nmechtel/bioengine/.env', 'utf8').match(/HYPHA_TOKEN=(\S+)/)?.[1];
  } catch {
    return undefined;
  }
}

test('node rows show the real GPU device name, not just Ray\'s label', async ({ page, request }, testInfo) => {
  const token = readHyphaToken();
  if (!token) {
    test.skip();
    return;
  }
  test.setTimeout(240000);

  const [workspace, clientAndService] = [
    WORKER_SERVICE.slice(0, WORKER_SERVICE.indexOf('/')),
    WORKER_SERVICE.slice(WORKER_SERVICE.indexOf('/') + 1),
  ];
  const statusUrl = `${HYPHA_SERVER_URL}/${workspace}/services/${clientAndService}/get_status`;
  console.log('[spec] GET', statusUrl);
  const res = await request.get(statusUrl, {
    headers: { Authorization: `Bearer ${token}` },
    timeout: 90000,
  });
  expect(res.ok(), `get_status failed: ${res.status()}`).toBeTruthy();
  const status = await res.json();

  // The nodes live under ray_cluster.nodes. The shallower `cluster` key exists
  // but is null, and reading it instead silently yields an empty cluster.
  const nodes: Record<string, NodeInfo> = status?.ray_cluster?.nodes || {};
  const nodeIds = Object.keys(nodes);
  expect(nodeIds.length, 'worker reported no Ray nodes').toBeGreaterThan(0);

  const serviceId = WORKER_SERVICE;

  testInfo.annotations.push({
    type: 'worker',
    description: `${serviceId} (bioengine ${status?.worker_version ?? status?.bioengine_version ?? 'unknown'}), ${nodeIds.length} node(s)`,
  });

  await page.addInitScript(({ tok, expiry }) => {
    localStorage.setItem('token', tok);
    localStorage.setItem('tokenExpiry', expiry);
  }, { tok: token, expiry: new Date(Date.now() + 3 * 60 * 60 * 1000).toISOString() });

  await page.goto(`/#/bioengine/worker?service_id=${encodeURIComponent(serviceId)}`);

  // The nodes list is collapsed behind a "Nodes (N)" toggle.
  const nodesToggle = page.getByRole('button', { name: /^Nodes \(\d+\)$/ });
  await expect(nodesToggle).toBeVisible({ timeout: 120000 });
  await nodesToggle.click();
  await expect(page.getByText('Node ID:').first()).toBeVisible({ timeout: 30000 });

  // Read each node card as a label -> value map, keyed by the node id the card
  // itself prints, so a reordered or re-rolled cluster cannot cross-wire the
  // comparison.
  const rendered: Record<string, Record<string, string>> = await page.evaluate(() => {
    const out: Record<string, Record<string, string>> = {};
    const idLabels = [...document.querySelectorAll('span')].filter(
      (s) => s.textContent?.trim() === 'Node ID:'
    );
    for (const label of idLabels) {
      const box = label.closest('.space-y-2');
      if (!box) continue;
      const fields: Record<string, string> = {};
      for (const row of [...box.children] as HTMLElement[]) {
        const spans = [...row.querySelectorAll(':scope > span')];
        if (spans.length < 2) continue;
        const key = (spans[0].textContent || '').trim().replace(/:$/, '');
        fields[key] = (spans[1].textContent || '').trim();
      }
      if (fields['Node ID']) out[fields['Node ID']] = fields;
    }
    return out;
  });

  expect(Object.keys(rendered).length, 'no node cards were scraped from the page').toBeGreaterThan(0);

  let deviceNamesChecked = 0;
  let fallbacksChecked = 0;
  let suppressedChecked = 0;
  const missing: string[] = [];
  const compared: string[] = [];

  for (const nodeId of nodeIds) {
    const card = rendered[nodeId];
    if (!card) {
      // A node can leave the cluster between the status call and the render.
      missing.push(nodeId);
      continue;
    }
    const info = nodes[nodeId];
    const where = `node ${nodeId.slice(0, 12)} (${info.node_ip ?? 'no ip'})`;
    compared.push(
      `${info.node_ip ?? 'no ip'}${info.head ? ' [HEAD]' : ''}: ` +
        `worker says gpu_device_name=${JSON.stringify(info.gpu_device_name)} ` +
        `accelerator_type=${JSON.stringify(info.accelerator_type)} | ` +
        `card shows GPU=${JSON.stringify(card['GPU'])} ` +
        `Accelerator Type=${JSON.stringify(card['Accelerator Type'])}`
    );

    if (isReported(info.gpu_device_name)) {
      expect(card['GPU'], `${where} should show device name "${info.gpu_device_name}"`).toBe(
        info.gpu_device_name
      );
      deviceNamesChecked += 1;
      // The bug: the label standing in for the device. Assert they are not
      // conflated whenever the worker reports two different strings.
      if (isReported(info.accelerator_type) && info.accelerator_type !== info.gpu_device_name) {
        expect(card['GPU'], `${where} shows Ray's label where the device name belongs`).not.toBe(
          info.accelerator_type
        );
      }
    } else {
      // Negative arm: no device name reported. No GPU row at all, and in
      // particular never a blank or a literal "NA".
      expect(card['GPU'], `${where} reports no device name but the card shows "${card['GPU']}"`).toBeUndefined();
      if (isReported(info.accelerator_type)) fallbacksChecked += 1;
    }

    if (isReported(info.accelerator_type)) {
      expect(card['Accelerator Type'], `${where} should show label "${info.accelerator_type}"`).toBe(
        info.accelerator_type
      );
    } else {
      // "NA" is a truthy string, so a plain truthiness check used to render it.
      expect(
        card['Accelerator Type'],
        `${where} reports accelerator_type=${JSON.stringify(info.accelerator_type)} but the card shows "${card['Accelerator Type']}"`
      ).toBeUndefined();
      suppressedChecked += 1;
    }
  }

  // Every node the worker named must have been compared. The Ray node set is
  // stable over the few seconds this takes, so a card that did not render is a
  // real gap in the check, not churn, and tolerating it would let the spec go
  // green having compared nothing.
  expect(missing, `no node card rendered for: ${missing.join(', ')}`).toEqual([]);

  // Say out loud which arms this worker actually exercised, so a green result
  // is never read as covering an arm that was never present. These are counts
  // of assertions that RAN, not of nodes that exist.
  const coverage =
    `device-name rows checked: ${deviceNamesChecked}; ` +
    `pre-0.16.11 fallback rows checked: ${fallbacksChecked}; ` +
    `"NA" suppression checked: ${suppressedChecked}`;
  for (const line of compared) console.log(`[spec]   ${line}`);
  console.log(`[spec] ${coverage}`);
  testInfo.annotations.push({ type: 'coverage', description: coverage });
  await testInfo.attach('nodes-section.png', {
    body: await page.screenshot({ fullPage: false }),
    contentType: 'image/png',
  });

  // Pin the counts to what the worker reported, so a scrape that quietly
  // stopped finding rows cannot pass as "nothing to check".
  const expectedDeviceNames = nodeIds.filter((id) => isReported(nodes[id].gpu_device_name)).length;
  const expectedSuppressed = nodeIds.filter((id) => !isReported(nodes[id].accelerator_type)).length;
  expect(deviceNamesChecked, 'device-name assertions did not run for every reporting node').toBe(
    expectedDeviceNames
  );
  expect(suppressedChecked, '"NA" suppression assertions did not run for every such node').toBe(
    expectedSuppressed
  );

  if (expectedDeviceNames === 0) {
    testInfo.annotations.push({
      type: 'note',
      description:
        'this worker reported no gpu_device_name on any node, so only the pre-0.16.11 fallback arm was exercised here.',
    });
  }
});
