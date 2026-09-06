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

const SCHEMA_VERSION = '0.2.1-draft';
const CAMPAIGN_ID = 'stub-consortium';
const STUB_DIGEST = 'a22dba37c1e04f9b';

/** Rounds 0, 1, 4, 5 of an otherwise 0..5 series. 2 and 3 were never reported. */
function stubRounds(): Array<Record<string, unknown>> {
  return [0, 1, 4, 5].map((round) => ({
    round,
    participants: ['stub-site-a', 'stub-site-b'],
    merge_weights: null,
    metric: {
      name: 'validation Dice',
      higher_is_better: true,
      per_site: null,
      aggregate: 0.4 + round * 0.07,
      aggregate_basis: 'merge-weighted mean over the per-dataset validation Dice',
      n_sites_scored: 2,
    },
    global_sha256: STUB_DIGEST,
    // Both sites scored on the same aggregate, which is the strongest
    // provenance claim the record carries.
    scored_with: { 'stub-site-a': STUB_DIGEST, 'stub-site-b': STUB_DIGEST },
    transport: { bytes_out: 15_520_000, bytes_in: 15_520_000, n_transfers: 4 },
  }));
}

/**
 * A record shaped like the FIRST REAL campaign rather than like the design
 * mockup: full state dicts instead of a LoRA adapter, image counts with no byte
 * figure, and a metric with a name of its own. If the page renders this one
 * correctly it cannot be hardcoding "adapter", "TB" or "score".
 */
function stubRecord(overrides: Record<string, unknown> = {}) {
  return {
    schema_version: SCHEMA_VERSION,
    campaign_id: CAMPAIGN_ID,
    title: 'Stub nucleus segmentation consortium',
    description: 'A stub campaign that exists only inside this test.',
    status: 'running',
    experiment: { arm: 'fedavg', seed: 0, run_id: 'stub-run' },
    policy: {
      public_data_campaign: true,
      // No per-deployment credential exists, so the roster carries its caveat.
      roster_attested: false,
      outcomes_released: true,
    },
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
        // Typed into a join form, not measured. The roster has to say so.
        declared: ['site_name', 'n_train_images'],
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
        // The service does not know what this site is doing, which is the
        // ordinary case and must not be dressed up as a state.
        activity: null,
        bioengine_version: null,
        declared: null,
      },
    ],
    rounds: stubRounds(),
    reporting: { dropped_reports: 2, reconciled: false, reconciled_at: null },
    transport: {
      observed: {
        valid: true,
        invalid_reason: null,
        per_site: null,
        driver: { bytes_out: 62_080_000, bytes_in: 62_080_000, n_transfers: 16 },
        windows: [{ source: 'driver', first_seq: 0, last_seq: 15, n_transfers: 16 }],
      },
      computed: null,
      kinds_transferred: ['model_weights'],
      only_weights_left_site: true,
      images_moved_bytes: 0,
      // No byte figure exists for this campaign, only a count of images.
      images_held: { n_images: 1018, bytes: null, basis: null },
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
    for (const figure of ['7.76', '1,018', '62.1', '536', 'Full state dict', 'a22dba37']) {
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
  // This campaign is still running, so reconciliation has not happened and the
  // page must not imply the series is already complete.
  expect(text).toContain('reconciled once it finishes');
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

// ---------------------------------------------------------------------------
// The v0.2.0 guarantees: observed against computed, the reconstruction hazard,
// digest provenance, and declared against measured.
// ---------------------------------------------------------------------------

test('an incomplete transport log withholds the total instead of undercounting', async ({
  page,
}) => {
  await stubCampaignService(page, {
    record: stubRecord({
      transport: {
        observed: {
          valid: false,
          invalid_reason: 'The driver was relaunched during this run.',
          per_site: null,
          // Present in the record and still not rendered as a total, because
          // the windows do not agree. This is the assertion that matters: the
          // page must refuse a number it has been handed.
          driver: { bytes_out: 62_080_000, bytes_in: 62_080_000, n_transfers: 16 },
          windows: [
            { source: 'driver', first_seq: 0, last_seq: 15, n_transfers: 16 },
            { source: 'stub-site-a', first_seq: 0, last_seq: 203, n_transfers: 204 },
          ],
        },
        computed: null,
        kinds_transferred: ['model_weights'],
        only_weights_left_site: true,
        images_moved_bytes: 0,
        images_held: { n_images: 1018, bytes: null, basis: null },
      },
    }),
  });
  await page.goto(`/#/campaigns/${CAMPAIGN_ID}`);
  await waitForLoaded(page);

  const text = await regionText(page);
  expect(text).toContain('The transport log is incomplete');
  expect(text).toContain('204 transfers');
  expect(text).not.toContain('62.1');
  // The weights-only check survives a truncated log, because a log that is
  // missing entries still cannot contain one that is not there.
  expect(text).toContain('Only model weights left each site');
});

test('a computed total is labelled as computed rather than measured', async ({ page }) => {
  await stubCampaignService(page, {
    record: stubRecord({
      transport: {
        observed: null,
        computed: {
          bytes_moved: 542_720_000,
          basis: '3N+1 transfers per round for N sites, times the measured payload size',
          validated_against: 'a single-site control run',
        },
        kinds_transferred: ['model_weights'],
        only_weights_left_site: true,
        images_moved_bytes: 0,
        images_held: { n_images: 1018, bytes: null, basis: null },
      },
    }),
  });
  await page.goto(`/#/campaigns/${CAMPAIGN_ID}`);
  await waitForLoaded(page);

  const text = await regionText(page);
  expect(text).toContain('Computed, not observed');
  expect(text).toContain('3N+1 transfers per round');
  expect(text).toContain('a single-site control run');
});

test('a partial per-site map withholds the aggregate as well', async ({ page }) => {
  const rounds = stubRounds().map((round: any) =>
    round.round === 4
      ? {
          ...round,
          metric: {
            ...(round.metric as Record<string, unknown>),
            // One of two sites published a curve. With two sites, the aggregate
            // plus this one value reconstructs the other exactly.
            per_site: { 'stub-site-a': 0.7314 },
            n_sites_scored: 2,
          },
        }
      : round
  );
  await stubCampaignService(page, { record: stubRecord({ rounds }) });
  await page.goto(`/#/campaigns/${CAMPAIGN_ID}/progress`);
  await waitForLoaded(page);

  const text = await regionText(page);
  expect(text).toContain('worked back out');
  expect(text).toContain('merge-weighted mean');
});

test('the round log reports the digest the sites actually scored on', async ({ page }) => {
  await stubCampaignService(page);
  await page.goto(`/#/campaigns/${CAMPAIGN_ID}/progress`);
  await waitForLoaded(page);

  const text = await regionText(page);
  expect(text).toContain('All 2 scored on');
  expect(text).toContain('a22dba37');
  // Only the first eight characters, never the whole digest.
  expect(text).not.toContain(STUB_DIGEST);
});

// ---------------------------------------------------------------------------
// The v0.2.1 guarantees: no live accuracy, and no unmarked ratio.
// ---------------------------------------------------------------------------

test('a campaign that has not released its outcomes renders no accuracy at all', async ({
  page,
}) => {
  // The record carries a full metric on every round. The page must still refuse
  // it, because permission and presence are different questions and only the
  // first one governs. This is the shape every running campaign will have.
  await stubCampaignService(page, {
    record: stubRecord({
      policy: { public_data_campaign: true, roster_attested: false, outcomes_released: false },
    }),
  });
  await page.goto(`/#/campaigns/${CAMPAIGN_ID}/progress`);
  await waitForLoaded(page);

  const text = await regionText(page);
  expect(text).toContain('No scores are published for this campaign yet');
  expect(text).toContain('primary-metric rules resolve');

  // Neither the metric's name nor any of its values may appear anywhere.
  expect(text).not.toContain('validation Dice');
  for (const value of ['0.400', '0.470', '0.680', '0.750']) {
    expect(text, `metric value ${value} rendered on an unreleased campaign`).not.toContain(value);
  }

  // Process is unaffected. The rounds, the transport and the digests stay live,
  // which is the whole point of gating the outcome axis rather than the page.
  expect(text).toContain('Round 5');
  expect(text).toContain('62.1');
  expect(text).toContain('a22dba37');
});

test('a null outcomes flag withholds accuracy just as a false one does', async ({ page }) => {
  await stubCampaignService(page, {
    record: stubRecord({
      policy: { public_data_campaign: true, roster_attested: false, outcomes_released: null },
    }),
  });
  await page.goto(`/#/campaigns/${CAMPAIGN_ID}/progress`);
  await waitForLoaded(page);

  const text = await regionText(page);
  expect(text).toContain('No scores are published for this campaign yet');
  expect(text).not.toContain('validation Dice');
});

test('a ratio built on a declared denominator says so', async ({ page }) => {
  await stubCampaignService(page, {
    record: stubRecord({
      transport: {
        observed: {
          valid: true,
          invalid_reason: null,
          per_site: null,
          driver: { bytes_out: 62_080_000, bytes_in: 62_080_000, n_transfers: 16 },
          windows: [{ source: 'driver', first_seq: 0, last_seq: 15, n_transfers: 16 }],
        },
        computed: null,
        kinds_transferred: ['model_weights'],
        only_weights_left_site: true,
        images_moved_bytes: 0,
        // A measured numerator over a figure the sites typed in themselves.
        images_held: { n_images: 1018, bytes: 11_400_000_000_000, basis: 'declared' },
      },
    }),
  });
  await page.goto(`/#/campaigns/${CAMPAIGN_ID}`);
  await waitForLoaded(page);

  const text = await regionText(page);
  expect(text).toContain('to 1');
  expect(text).toContain('declared by the participating sites, not measured by the platform');
});

test('an unknown denominator basis withholds the ratio entirely', async ({ page }) => {
  // Both halves are present and the arithmetic would work. The page still
  // refuses, because a ratio whose standing is unknown is the exact thing that
  // would quietly start reading as fully audited.
  await stubCampaignService(page, {
    record: stubRecord({
      transport: {
        observed: {
          valid: true,
          invalid_reason: null,
          per_site: null,
          driver: { bytes_out: 62_080_000, bytes_in: 62_080_000, n_transfers: 16 },
          windows: [{ source: 'driver', first_seq: 0, last_seq: 15, n_transfers: 16 }],
        },
        computed: null,
        kinds_transferred: ['model_weights'],
        only_weights_left_site: true,
        images_moved_bytes: 0,
        images_held: { n_images: 1018, bytes: 11_400_000_000_000, basis: null },
      },
    }),
  });
  await page.goto(`/#/campaigns/${CAMPAIGN_ID}`);
  await waitForLoaded(page);

  const text = await regionText(page);
  expect(text).not.toContain('to 1');
  expect(text).toContain('Not computable from what was measured');
});

test('self-declared roster values are marked, and the roster is not called attested', async ({
  page,
}) => {
  await stubCampaignService(page);
  await page.goto(`/#/campaigns/${CAMPAIGN_ID}`);
  await waitForLoaded(page);

  // Site A declared its training-image count; site B reported nothing, so the
  // mark must appear exactly where a declared value was rendered.
  await expect(page.locator('[title^="Declared by the site"]')).toHaveCount(1);

  const text = await regionText(page);
  expect(text).toContain('does not verify that a deployment belongs to the institution it names');
});
