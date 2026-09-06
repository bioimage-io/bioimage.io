import { test, expect, Page } from '@playwright/test';
import { BASE_URL } from './baseUrl';

// The campaigns section, driven entirely by a STUBBED campaign service.
//
// Nothing here has a live side effect. Every read the page makes is intercepted
// with page.route(), so no BioEngine app runs, no model is executed and no
// artifact in the bioimage-io collection is touched. It also does not depend on
// REACT_APP_CAMPAIGN_FIXTURES: stubbing the HTTP layer exercises the real
// campaignService fetch path, which the fixture seam bypasses entirely.
//
// Run against a dev server:
//   BROWSER=none pnpm start
//   npx playwright test tests/campaigns-page.spec.ts
//
// What these assertions are for: the campaigns page is only worth deploying if
// it renders what the campaign service reported and nothing else. So the tests
// below are mostly negative. They check that a figure the service did not send
// does not appear, that a vocabulary word the service did not use is not
// invented, and that an unreachable service produces an empty screen rather
// than a plausible one.

test.use({
  baseURL: BASE_URL,
  viewport: { width: 1280, height: 900 },
  serviceWorkers: 'block',
  launchOptions: { args: ['--disable-gpu', '--no-sandbox'] },
});

// ---------------------------------------------------------------------------
// Stub records. Every identifier below is invented for this spec.
// ---------------------------------------------------------------------------

const SCHEMA_VERSION = '0.1.0-draft';
const CAMPAIGN_ID = 'stub-consortium';

/**
 * A record shaped like the FIRST REAL campaign rather than like the design
 * mockup: full state dicts instead of a LoRA adapter, image counts with no byte
 * figure, and a metric with a name of its own. If the page renders this one
 * correctly it cannot be hardcoding "adapter", "TB" or "score".
 *
 * Rounds 2 and 3 are deliberately absent from an otherwise 0..5 series, because
 * driver-to-service reporting is fire-and-forget and a real series has holes.
 */
function stubRecord(overrides: Record<string, unknown> = {}) {
  const rounds = [0, 1, 4, 5].map((round) => ({
    round,
    participants: ['stub-site-a', 'stub-site-b'],
    merge_weights: null,
    metric: {
      name: 'validation Dice',
      higher_is_better: true,
      per_site: null,
      aggregate: 0.4 + round * 0.07,
    },
    global_sha256: null,
    transport: { bytes_out: 15_520_000, bytes_in: 15_520_000, n_transfers: 4 },
  }));

  return {
    schema_version: SCHEMA_VERSION,
    campaign_id: CAMPAIGN_ID,
    title: 'Stub nucleus segmentation consortium',
    description: 'A stub campaign that exists only inside this test.',
    status: 'running',
    base_model: null,
    aggregation: { method: 'FedAvg', weighting: 'sample count' },
    licence_policy: { accepted_data_licences: ['CC0-1.0'], model_licence: 'MIT' },
    round: { current: 6, total: 12, started_at: '2026-07-19T14:03:00Z' },
    sites: [
      {
        site_id: 'stub-site-a',
        site_name: 'Stub site A',
        country: null,
        role: 'founding',
        joined_round: 0,
        left_round: null,
        accelerator: null,
        datasets: [
          {
            name: 'stub-nuclei',
            objects: 'nuclei',
            n_train: 536,
            n_val: null,
            n_test: null,
            source: null,
            licence: 'CC0-1.0',
            citation: null,
            split_fingerprint: null,
          },
        ],
        n_train_images: 536,
        activity: 'reported',
        bioengine_version: null,
      },
      {
        site_id: 'stub-site-b',
        site_name: 'Stub site B',
        country: null,
        role: 'founding',
        joined_round: 0,
        left_round: null,
        accelerator: null,
        datasets: [],
        // Not reported by this site, which must render as such and never as 0.
        n_train_images: null,
        activity: 'idle',
        bioengine_version: null,
      },
    ],
    rounds,
    reporting: { dropped_reports: 2 },
    transport: {
      bytes_out: 62_080_000,
      bytes_in: 62_080_000,
      n_transfers: 16,
      kinds_transferred: ['model_weights'],
      only_weights_left_site: true,
      images_moved_bytes: 0,
      // No byte figure exists for this campaign, only a count of images.
      images_held: { n_images: 1018, bytes: null },
    },
    payload: {
      kind: 'full_state_dict',
      label: 'Full state dict',
      bytes_per_site_per_round: 7_760_000,
    },
    stewards: [{ name: 'Stub steward', workspace: 'stub-workspace' }],
    published_model: null,
    generated_at: '2026-09-06T00:00:00Z',
    ...overrides,
  };
}

function stubSummary(record: ReturnType<typeof stubRecord>) {
  return {
    campaign_id: record.campaign_id,
    title: record.title,
    description: record.description,
    status: record.status,
    base_model: record.base_model,
    round: { current: record.round.current, total: record.round.total },
    n_active_sites: record.sites.length,
    payload: record.payload,
    model_licence: record.licence_policy.model_licence,
    started_at: record.round.started_at,
  };
}

/**
 * Intercept every campaign-service read.
 *
 * `status` drives the failure tests: a non-200 makes campaignService throw,
 * which is what an unreachable service looks like from the page's side.
 */
async function stubCampaignService(
  page: Page,
  opts: { record?: ReturnType<typeof stubRecord>; status?: number } = {}
) {
  const record = opts.record ?? stubRecord();
  const status = opts.status ?? 200;

  await page.route('**/federation-campaign/**', async (route) => {
    if (status !== 200) {
      await route.fulfill({ status, contentType: 'application/json', body: '{}' });
      return;
    }
    const url = route.request().url();
    const body = url.includes('list_campaigns') ? [stubSummary(record)] : record;
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(body),
    });
  });
}

/**
 * Wait for the record to arrive.
 *
 * regionText() is a one-shot read with no auto-retry, so without this it races
 * the fetch and reads the loading spinner instead of the page.
 */
async function waitForLoaded(page: Page) {
  await expect(page.getByText(/^Loading campaign/)).toHaveCount(0, { timeout: 20000 });
}

/** Visible text of the campaigns region, excluding the shared navbar and footer. */
async function regionText(page: Page): Promise<string> {
  return page.evaluate(() => {
    const el = document.querySelector('div.mx-auto.max-w-6xl, div.mx-auto.max-w-5xl');
    return el ? (el as HTMLElement).innerText.replace(/\s+/g, ' ').trim() : '';
  });
}

// ---------------------------------------------------------------------------

test('index lists what the service reported', async ({ page }) => {
  await stubCampaignService(page);
  await page.goto('/#/campaigns');

  await expect(page.getByText('Stub nucleus segmentation consortium')).toBeVisible();
  // Read from the record, never hardcoded.
  await expect(page.getByText('Full state dict').first()).toBeVisible();
  await expect(page.getByText('7.76 MB per site, per round')).toBeVisible();
});

test('an unreachable service renders an empty screen, not a plausible one', async ({ page }) => {
  await stubCampaignService(page, { status: 500 });

  for (const route of [
    '/#/campaigns',
    `/#/campaigns/${CAMPAIGN_ID}`,
    `/#/campaigns/${CAMPAIGN_ID}/progress`,
  ]) {
    await page.goto(route);
    await expect(page.locator('[data-testid="campaign-error-state"]')).toBeVisible();

    // The load-bearing assertion: no figure from the record survives a failed
    // read. Checked against the stub's own numbers so it cannot pass by the
    // page happening to be blank for some other reason.
    const text = await regionText(page);
    for (const figure of ['7.76', '1,018', '62.1', '536', 'Full state dict']) {
      expect(text, `"${figure}" leaked into a failed ${route}`).not.toContain(figure);
    }
  }
});

test('the prototype banner is absent in a normal build', async ({ page }) => {
  await stubCampaignService(page);
  await page.goto('/#/campaigns');
  await expect(page.getByText('Stub nucleus segmentation consortium')).toBeVisible();
  await expect(page.locator('[data-testid="campaign-prototype-banner"]')).toHaveCount(0);
});

test('unreported values say so instead of showing a zero', async ({ page }) => {
  await stubCampaignService(page);
  await page.goto(`/#/campaigns/${CAMPAIGN_ID}`);

  await expect(page.getByText('Stub site B')).toBeVisible();
  // Site B reports no training-image count and holds no declared dataset.
  await expect(page.getByText('Not reported').first()).toBeVisible();
  // Site A's count is real and must still be shown.
  await expect(page.getByText('536').first()).toBeVisible();
});

test('image data held is rendered as a count when no byte figure exists', async ({ page }) => {
  await stubCampaignService(page);
  await page.goto(`/#/campaigns/${CAMPAIGN_ID}`);
  await waitForLoaded(page);

  const text = await regionText(page);
  expect(text).toContain('1,018 images');
  // The mockup's terabyte headline has no counterpart in this record, so the
  // asymmetry ratio must be withheld rather than estimated from an image count.
  expect(text).not.toContain('to 1');
});

test('a gap in the round series is shown as a lost record, not a lost round', async ({ page }) => {
  await stubCampaignService(page);
  await page.goto(`/#/campaigns/${CAMPAIGN_ID}/progress`);
  await waitForLoaded(page);

  const text = await regionText(page);
  expect(text).toContain('Round 5');
  expect(text).toContain('Round 4');
  expect(text).toContain('Round 1');
  // Rounds 2 and 3 were never reported, so the log must not invent them.
  expect(text).not.toContain('Round 3');
  expect(text).not.toContain('Round 2');
  expect(text).toContain('did not reach this service');
});

test('per-site curves are withheld when the service does not publish them', async ({ page }) => {
  await stubCampaignService(page);
  await page.goto(`/#/campaigns/${CAMPAIGN_ID}/progress`);
  await waitForLoaded(page);

  const text = await regionText(page);
  // The metric name travels in the record and is rendered verbatim.
  expect(text).toContain('validation Dice');
  expect(text).toContain('Per-site curves are kept within the campaign');
  expect(text).not.toContain('Stub site A 0.');
});
