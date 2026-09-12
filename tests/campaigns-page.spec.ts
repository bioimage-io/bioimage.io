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

const SCHEMA_VERSION = '0.11.0-draft';
const CAMPAIGN_ID = 'stub-consortium';
const ASYNC_CAMPAIGN_ID = 'stub-soup';
const STUB_DIGEST = 'a22dba37c1e04f9b';

/** Rounds 0, 1, 4, 5 of an otherwise 0..5 series. 2 and 3 were never reported. */
function stubRounds(): Array<Record<string, unknown>> {
  return [0, 1, 4, 5].map((round) => ({
    round,
    participants: ['stub-site-a', 'stub-site-b'],
    eval_on: ['stub-site-a', 'stub-site-b'],
    merge_weights: null,
    metric: {
      // The plottable role. A RoundRecord.metric that is not a witness is
      // refused by the page rather than drawn, so every stub that expects a
      // curve has to carry this.
      role: 'witness',
      name: 'validation Dice',
      higher_is_better: true,
      per_site: null,
      per_site_basis: null,
      aggregate: 0.4 + round * 0.07,
      aggregate_basis: 'merge-weighted mean over the per-dataset validation Dice',
      n_sites_scored: 2,
      aggregate_withheld: null,
    },
    global_sha256: STUB_DIGEST,
    // Both sites scored on the same aggregate, which is the strongest
    // provenance claim the record carries.
    scored_with: { 'stub-site-a': STUB_DIGEST, 'stub-site-b': STUB_DIGEST },
    scored_with_basis: 'site',
    transport: { bytes_out: 15_520_000, bytes_in: 15_520_000, n_transfers: 4, sources_complete: true },
  }));
}

/** The two-site roster. Extracted so a test can vary one site without spreading a record. */
function stubSites(): Array<Record<string, unknown>> {
  return [
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
  ];
}

/**
 * A record shaped like the FIRST REAL campaign rather than like the design
 * mockup: full state dicts instead of a LoRA adapter, image counts with no byte
 * figure, and a metric with a name of its own. If the page renders this one
 * correctly it cannot be hardcoding "adapter", "TB" or "score".
 *
 * Synchronous. The async counterpart is stubAsyncRecord() below.
 */
function stubRecord(overrides: Record<string, any> = {}) {
  // `round`, `rounds` and `sites` are the SYNCHRONOUS ARM's fields and have
  // lived inside `progress` on the wire since 0.8.0-draft. They are still
  // accepted flat here and folded in below, so a test that varies the round
  // series can say `stubRecord({ rounds })` without restating the
  // discriminant. What goes out on the wire is always the union shape, which
  // is the part that has to be right; the convenience is local to this file.
  //
  // `progress` may also be passed whole, which is how the async stubs reuse
  // every campaign-level field on this record without duplicating it.
  const { round, rounds, sites, progress, ...rest } = overrides;
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
      // Two sites, so two is the only floor that admits a pooled figure at all.
      aggregate_min_scoring_sites: 2,
    },
    base_model: null,
    aggregation: { method: 'FedAvg', weighting: 'sample count' },
    licence_policy: { accepted_data_licences: ['CC0-1.0'], model_licence: 'MIT' },
    progress: progress ?? {
      mode: 'synchronous',
      round: round ?? { current: 6, total: 12, started_at: '2026-07-19T14:03:00Z' },
      rounds: rounds ?? stubRounds(),
      sites: sites ?? stubSites(),
    },
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
      images_held: { n_images: 1018 },
      declared_data_bytes: null,
    },
    payload: {
      kind: 'full_state_dict',
      label: 'Full state dict',
      bytes_per_site_per_round: 7_760_000,
    },
    stewards: [{ name: 'Stub steward', workspace: 'stub-workspace' }],
    published_model: null,
    generated_at: '2026-09-06T00:00:00Z',
    ...rest,
  };
}

/**
 * The index summary, derived from whichever arm the record is in.
 *
 * The index carries its own discriminated `progress`, so this switches rather
 * than reaching for a round number that an async campaign has no honest value
 * for. Deriving it from the record instead of hand-writing a second literal is
 * what keeps a summary test from passing against a detail record it contradicts.
 */
function stubSummary(record: Record<string, any>) {
  const progress = record.progress;
  const isAsync = progress.mode === 'asynchronous';
  return {
    campaign_id: record.campaign_id,
    title: record.title,
    description: record.description,
    status: record.status,
    base_model: record.base_model,
    progress: isAsync
      ? {
          mode: 'asynchronous',
          n_contributions: progress.contributions.length,
          n_versions: progress.soups.length,
        }
      : {
          mode: 'synchronous',
          round: { current: progress.round.current, total: progress.round.total },
        },
    n_active_sites: isAsync ? progress.contributors.length : progress.sites.length,
    payload: record.payload,
    model_licence: record.licence_policy.model_licence,
    started_at: isAsync ? progress.started_at : progress.round.started_at,
  };
}

// ---------------------------------------------------------------------------
// The ASYNCHRONOUS arm: contributors, a contribution stream, and a soup
// lineage. Everything below is invented for this spec and shares nothing with
// the src/services/__fixtures__ corpus, on purpose. The fixtures exercise the
// page at a realistic size; these stubs are small enough that every assertion
// below can name the exact record it is about.
// ---------------------------------------------------------------------------

/** Whole Cellpose-SAM checkpoints, not adapters. The greedy fork moves full weights. */
const ASYNC_CHECKPOINT_BYTES = 1_300_000_000;

function stubContributors(): Array<Record<string, unknown>> {
  return [
    {
      contributor_id: 'stub-alpha',
      contributor_name: 'Stub contributor Alpha',
      country: null,
      joined_at: '2026-08-02T09:00:00Z',
      latest_contribution_at: '2026-08-22T09:00:00Z',
      n_contributions: 3,
      accelerator: null,
      datasets: [],
      n_train_images: 412,
      bioengine_version: null,
      declared: ['n_train_images'],
    },
    {
      contributor_id: 'stub-beta',
      contributor_name: 'Stub contributor Beta',
      country: null,
      joined_at: '2026-08-05T09:00:00Z',
      latest_contribution_at: '2026-08-21T09:00:00Z',
      n_contributions: 2,
      accelerator: null,
      datasets: [],
      n_train_images: null,
      bioengine_version: null,
      declared: null,
    },
    {
      contributor_id: 'stub-gamma',
      contributor_name: 'Stub contributor Gamma',
      country: null,
      joined_at: '2026-08-19T09:00:00Z',
      latest_contribution_at: '2026-09-04T09:00:00Z',
      n_contributions: 2,
      accelerator: null,
      datasets: [],
      n_train_images: 903,
      bioengine_version: null,
      declared: [],
    },
  ];
}

/**
 * Nine contributions across three contributors and three merges, one of which
 * published nothing.
 *
 * The dispositions are picked so no single contributor owns every exclusion.
 * That is not decoration: a lane whose every dot is grey reads as a finding
 * about that contributor, which is the one thing the excluded state must never
 * be able to say, so the stub that guards the state has to be shaped the way a
 * real campaign is rather than the way a minimal case would be.
 *
 * c8 and c9 are excluded by a merge that published NO version, which is the
 * case worth stubbing rather than a second copy of the ordinary one. Their dots
 * are grey and the merge that greyed them is not in `soups`, so a chart that
 * drew its markers from `soups` alone would leave them in a stretch of timeline
 * with no merge in it at all, under a legend saying a merge had assessed them.
 */
function stubContributions(): Array<Record<string, unknown>> {
  const rows: Array<[string, string, string, string | null, string | null]> = [
    // id, contributor, received_at, disposition, merged_into
    ['stub-c1', 'stub-alpha', '2026-08-02T09:00:00Z', 'included', 'stub-soup-1'],
    ['stub-c2', 'stub-beta', '2026-08-05T11:30:00Z', 'included', 'stub-soup-1'],
    ['stub-c3', 'stub-alpha', '2026-08-06T16:45:00Z', 'excluded', null],
    ['stub-c4', 'stub-gamma', '2026-08-19T08:15:00Z', 'included', 'stub-soup-2'],
    ['stub-c5', 'stub-beta', '2026-08-21T13:00:00Z', 'excluded', null],
    ['stub-c6', 'stub-alpha', '2026-08-22T09:00:00Z', 'included', 'stub-soup-2'],
    // Both weighed by the 3 Sept merge, which kept neither and so published no
    // version. `merged_into` is null for the same reason it is null on any
    // exclusion: nothing folded them in.
    ['stub-c8', 'stub-beta', '2026-09-01T07:40:00Z', 'excluded', null],
    ['stub-c9', 'stub-gamma', '2026-09-02T15:10:00Z', 'excluded', null],
    // After the last merge, so it has not been assessed by anything yet.
    ['stub-c7', 'stub-gamma', '2026-09-04T10:20:00Z', 'pending', null],
  ];
  return rows.map(([contribution_id, contributor_id, received_at, disposition, merged_into]) => ({
    contribution_id,
    contributor_id,
    received_at,
    base_version: 'v0',
    bytes_out: ASYNC_CHECKPOINT_BYTES,
    n_train_images: 412,
    dataset_name: 'stub-local-nuclei',
    declared: ['n_train_images', 'dataset_name'],
    disposition,
    merged_into,
  }));
}

/** The witness score, which the page may plot. Rises, but not by construction. */
function stubWitness(aggregate: number, scoring: number): Record<string, unknown> {
  return {
    role: 'witness',
    name: 'validation F1 (witness split)',
    higher_is_better: true,
    per_site: null,
    per_site_basis: null,
    aggregate,
    aggregate_basis:
      'mean over the contributors that evaluated this version on a held-out split held back from selection',
    n_sites_scored: scoring,
    n_datasets_scored: null,
    aggregate_withheld: null,
  };
}

/**
 * The gate score, which the page may NAME and must never plot.
 *
 * Deliberately monotone, and deliberately carried on every soup, because the
 * assertion worth having is that a rising series sitting right there in the
 * record still does not reach the chart.
 */
function stubSelection(aggregate: number, scoring: number): Record<string, unknown> {
  return {
    role: 'selection',
    name: 'pooled AP50 on the selection split',
    higher_is_better: true,
    per_site: null,
    per_site_basis: null,
    aggregate,
    aggregate_basis: 'the score the greedy gate admitted contributions against',
    n_sites_scored: scoring,
    n_datasets_scored: null,
    aggregate_withheld: null,
  };
}

/** Two merges. Each assessed three contributions and kept two. */
function stubSoups(): Array<Record<string, unknown>> {
  return [
    {
      soup_id: 'stub-soup-1',
      index: 0,
      merged_at: '2026-08-08T02:00:00Z',
      contributions: ['stub-c1', 'stub-c2'],
      assessed: ['stub-c1', 'stub-c2', 'stub-c3'],
      // Uniform souping has no per-contribution weight to publish, so null
      // here is inapplicability and not a withhold.
      weights: null,
      community_model: {
        artifact_id: 'stub-workspace/stub-community-model',
        version: 'v1',
        url: null,
        n_contributions_cumulative: 2,
      },
      witness_metric: stubWitness(0.7412, 2),
      selection_metric: stubSelection(0.6293, 2),
      global_sha256: STUB_DIGEST,
      transport: {
        bytes_out: ASYNC_CHECKPOINT_BYTES * 2,
        bytes_in: ASYNC_CHECKPOINT_BYTES * 3,
        n_transfers: 5,
        sources_complete: true,
      },
    },
    {
      soup_id: 'stub-soup-2',
      index: 1,
      merged_at: '2026-08-24T02:00:00Z',
      contributions: ['stub-c4', 'stub-c6'],
      assessed: ['stub-c4', 'stub-c5', 'stub-c6'],
      weights: null,
      community_model: {
        artifact_id: 'stub-workspace/stub-community-model',
        version: 'v2',
        url: null,
        n_contributions_cumulative: 4,
      },
      witness_metric: stubWitness(0.7683, 3),
      selection_metric: stubSelection(0.6466, 3),
      global_sha256: STUB_DIGEST,
      transport: {
        bytes_out: ASYNC_CHECKPOINT_BYTES * 3,
        bytes_in: ASYNC_CHECKPOINT_BYTES * 3,
        n_transfers: 6,
        sources_complete: true,
      },
    },
  ];
}

/**
 * One merge that ran and published nothing, plus one that had nothing to weigh.
 *
 * Both kinds, because the page distinguishes them and only one is interesting.
 * The 3 Sept entry weighed two real candidates and kept neither. The 12 Sept one
 * had an empty pool. Neither carries an index, a version or a metric, because
 * there is no published checkpoint to number or score.
 */
function stubEmptyMerges(): Array<Record<string, unknown>> {
  return [
    {
      merged_at: '2026-09-03T02:00:00Z',
      assessed: ['stub-c8', 'stub-c9'],
      transport: {
        // Nothing published, so nothing distributed. Zero out is a measurement.
        bytes_out: 0,
        bytes_in: ASYNC_CHECKPOINT_BYTES * 2,
        n_transfers: 2,
        sources_complete: true,
      },
    },
    {
      merged_at: '2026-09-12T02:00:00Z',
      assessed: [],
      transport: {
        bytes_out: 0,
        bytes_in: 0,
        n_transfers: 0,
        sources_complete: true,
      },
    },
  ];
}

/**
 * The async record. Reuses every campaign-level field from stubRecord() and
 * swaps the progress arm, so a field that only exists on one arm cannot drift
 * between the two stubs.
 */
function stubAsyncRecord(
  progressOverrides: Record<string, any> = {},
  overrides: Record<string, any> = {}
) {
  return stubRecord({
    campaign_id: ASYNC_CAMPAIGN_ID,
    title: 'Stub community model soup',
    description: 'A stub async campaign that exists only inside this test.',
    experiment: null,
    aggregation: { method: 'greedy soup', weighting: 'uniform' },
    payload: {
      kind: 'full_state_dict',
      label: 'Full Cellpose-SAM checkpoint',
      // No round, so no per-round figure. The per-contribution one is the
      // only honest payload size an async campaign has.
      bytes_per_site_per_round: null,
      bytes_per_contribution: ASYNC_CHECKPOINT_BYTES,
    },
    progress: {
      mode: 'asynchronous',
      started_at: '2026-08-01T00:00:00Z',
      contributions: stubContributions(),
      soups: stubSoups(),
      empty_merges: stubEmptyMerges(),
      contributors: stubContributors(),
      merge_trigger: {
        kind: 'scheduled',
        next_merge_at: '2026-09-14T02:00:00Z',
        contributions_per_merge: null,
      },
      ...progressOverrides,
    },
    ...overrides,
  });
}

/**
 * Intercept every campaign-service read.
 *
 * `status` drives the failure tests: a non-200 makes campaignService throw,
 * which is what an unreachable service looks like from the page's side.
 */
async function stubCampaignService(
  page: Page,
  opts: {
    record?: Record<string, any>;
    status?: number;
    /**
     * Version the stub service claims, on BOTH endpoints. Defaults to the one
     * the page expects. The mismatch tests below are the only callers that set
     * it, and they are what proves assertSchema can still refuse something.
     */
    servedSchema?: string;
  } = {}
) {
  const record = opts.record ?? stubRecord();
  const status = opts.status ?? 200;
  const servedSchema = opts.servedSchema ?? SCHEMA_VERSION;

  await page.route('**/federation-campaign/**', async (route) => {
    if (status !== 200) {
      await route.fulfill({ status, contentType: 'application/json', body: '{}' });
      return;
    }
    const url = route.request().url();
    const body = url.includes('list_campaigns')
      ? { schema_version: servedSchema, campaigns: [stubSummary(record)] }
      : { ...record, schema_version: servedSchema };
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

/**
 * The campaigns region with the error diagnostic line removed, for the honesty
 * check. That line carries an HTTP status or a schema version, so it holds
 * digits that are not campaign figures, and it is excluded by testid rather
 * than by matching its text so the exclusion cannot silently widen.
 *
 * Reads from the LIVE dom. innerText depends on layout, so doing this on a
 * detached cloneNode() returns the empty string and any assertion over the
 * result passes without having looked at anything.
 */
async function regionTextWithoutDiagnostics(page: Page): Promise<string> {
  return page.evaluate(() => {
    const el = document.querySelector('div.mx-auto.max-w-6xl, div.mx-auto.max-w-5xl');
    if (!el) return '';
    const detail = el.querySelector('[data-testid="campaign-error-detail"]') as HTMLElement | null;
    const previous = detail?.style.display ?? null;
    if (detail) detail.style.display = 'none';
    const read = (el as HTMLElement).innerText.replace(/\s+/g, ' ').trim();
    if (detail) detail.style.display = previous ?? '';
    return read;
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

    // This case really is an unreachable service, and it must say so rather
    // than borrowing the schema-mismatch wording. Paired with the mismatch
    // tests below, this is what proves the two states are distinguished
    // instead of one string being shown for every failure.
    expect(text).toContain('could not be reached');
    expect(text).not.toContain('format this page does not recognise');
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
  // Site B holds no declared dataset, which must read as an absence.
  await expect(page.getByText('Not reported').first()).toBeVisible();
  // Site A's count is real and must still be shown.
  await expect(page.getByText('536').first()).toBeVisible();
});

/**
 * Absence has more than one cause, and the causes point at different people to
 * go and ask. These three assertions exist because the page once had a single
 * absence tooltip, "the campaign service did not report this value", rendered
 * under labels that said something else. A reader who hovered over "Not
 * published" was told the service had stayed silent about a figure the service
 * had deliberately withheld, which sends them to check whether a service is up
 * when nothing is wrong with it.
 *
 * Asserting the three titles differ is the positive control. A component that
 * regressed to one hardcoded title would satisfy any single one of these and
 * fail the set, which is the property that makes them evidence rather than
 * three chances to pass.
 */
test('an absent value says which kind of absent it is', async ({ page }) => {
  await stubCampaignService(page);
  await page.goto(`/#/campaigns/${CAMPAIGN_ID}`);
  await waitForLoaded(page);

  const titleFor = (reason: string) =>
    page.locator(`[data-missing-reason="${reason}"]`).first().getAttribute('title');

  const [unreported, withheld, undeclared] = await Promise.all([
    titleFor('unreported'),
    titleFor('withheld'),
    titleFor('undeclared'),
  ]);

  // Site B's empty dataset list, its null training count, and its null country
  // are three different situations and the record distinguishes them.
  expect(unreported).toContain('did not report');
  expect(withheld).toContain('does not publish');
  expect(undeclared).toContain('did not declare');

  // The failure this guards against is convergence, so check they stayed apart
  // rather than only that each matched something.
  expect(new Set([unreported, withheld, undeclared]).size).toBe(3);

  // A withheld figure is a decision, and calling it unreported blames the wrong
  // component. Neither may borrow the other's explanation.
  expect(withheld).not.toContain('did not report');
  expect(undeclared).not.toContain('did not report');
});

/**
 * `base_model` is nullable and the schema gives null exactly one meaning:
 * not reported. The page used to render null as "Trained from scratch", which
 * is a fact the record never stated, and it is the unsafe reading. A campaign
 * that fine-tuned from a published model and failed to report which one would
 * have been described to every visitor as having trained from nothing.
 */
test('a campaign with no reported base model is not described as trained from scratch', async ({
  page,
}) => {
  await stubCampaignService(page);
  await page.goto(`/#/campaigns/${CAMPAIGN_ID}`);
  await waitForLoaded(page);

  // Lowercased because the field labels are uppercased in CSS, so innerText
  // reads "BASE MODEL". Asserting the label at all is the point: without it,
  // "does not say from scratch" would pass just as happily on a page that had
  // stopped rendering the field.
  const text = (await regionText(page)).toLowerCase();
  expect(text).toContain('base model');
  expect(text).not.toContain('from scratch');
  expect(text).not.toContain('trained from');
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

test('absent per-site curves are not described as a decision', async ({ page }) => {
  await stubCampaignService(page);
  await page.goto(`/#/campaigns/${CAMPAIGN_ID}/progress`);
  await waitForLoaded(page);

  const text = await regionText(page);
  // The metric name travels in the record and is rendered verbatim.
  expect(text).toContain('validation Dice');
  expect(text).not.toContain('Stub site A 0.');
  expect(text).toContain('No per-site curves are in this record');
  // `per_site` carries no cause, so a null one is an absence. The page must not
  // name an actor for it, and must not supply the campaign's reasoning either:
  // the old copy argued that publishing per-site curves would rank the sites,
  // which is a good argument and still the page's own rather than the record's.
  expect(text).not.toContain('kept within the campaign');
  expect(text).not.toContain('public ranking');
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
        images_held: { n_images: 1018 },
        declared_data_bytes: null,
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
        images_held: { n_images: 1018 },
        declared_data_bytes: null,
      },
    }),
  });
  await page.goto(`/#/campaigns/${CAMPAIGN_ID}`);
  await waitForLoaded(page);

  const text = await regionText(page);
  expect(text).toContain('Computed, not observed');
  expect(text).toContain('3N+1 transfers per round');
  expect(text).toContain('a single-site control run');
  // The formula counts each arm once, but a restarted campaign re-runs the arm
  // that was in flight and those rounds really did move weights. So the figure
  // is a floor. Nothing in the record says whether this campaign restarted, and
  // the page does not need to know, because "at least" holds either way.
  expect(text).toContain('at least');
  expect(text).toContain('lower bound');
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
            per_site_basis: 'site',
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
  // This round is KNOWN to be short. It must not borrow the wording used when
  // the record never said how many sites were scored.
  expect(text).not.toContain('without saying how many sites were scored');
  // The record carried an aggregate and the PAGE declined to render it, which
  // is not the campaign choosing to withhold. Saying so is the difference
  // between reporting the system working and reporting a defect.
  expect(text).toContain('holding back figures the campaign did publish');
});

/**
 * `n_sites_scored` is the only field that can establish the per-site map is
 * complete, and the completeness gate used to require it to be non-null before
 * it would call a round partial. So a service that simply did not send the
 * count made the gate evaluate to "not partial" and the aggregate was
 * published, which is exactly the aggregate-plus-partial-map combination the
 * gate exists to prevent. A gate that fires only when the record volunteers
 * the number it needs is not a gate.
 *
 * The direction is the whole point. Silence resolved to the permissive
 * reading, and it did so in the case where the page had the least basis for
 * any reading at all.
 */
test('an aggregate is withheld when the record does not say how many sites were scored', async ({
  page,
}) => {
  const rounds = stubRounds().map((round: any) => ({
    ...round,
    metric: {
      ...(round.metric as Record<string, unknown>),
      per_site: { 'stub-site-a': 0.7314 },
      per_site_basis: 'site',
      // The service says nothing about how many sites this covers, so the page
      // cannot tell one of two from two of two.
      n_sites_scored: null,
    },
  }));
  await stubCampaignService(page, { record: stubRecord({ rounds }) });
  await page.goto(`/#/campaigns/${CAMPAIGN_ID}/progress`);
  await waitForLoaded(page);

  const text = await regionText(page);
  expect(text).toContain('without saying how many sites were scored');
  expect(text).toContain('cannot be told from a partial one');

  // A missing count is a gap in the record, not a disclosure decision, so it
  // must not be described with the wording for a deliberately short map.
  // Asserting the two states stay apart is what makes this more than a check
  // that some caveat rendered.
  expect(text).not.toContain('worked back out');
});

/**
 * The defect these four tests exist for.
 *
 * The chart's loop plotted an aggregate that passed its gates and counted one
 * that failed them. A NULL aggregate matched neither branch, so it produced no
 * point, no counter and no note: a score the campaign had deliberately withheld
 * arrived as an unexplained shortening of the line, indistinguishable from a
 * round that was never reported.
 *
 * Testing the states one at a time would not have caught it. Each of the three
 * renders something plausible in isolation, and the property that matters only
 * exists BETWEEN them: that a reader can tell which one they are looking at.
 * The baseline case is the one nobody thinks to assert, because it is the state
 * where nothing appears.
 */
test('a withheld aggregate is attributed to the campaign and names its reason', async ({
  page,
}) => {
  const rounds = stubRounds().map((round: any) =>
    round.round === 4
      ? {
          ...round,
          metric: {
            ...(round.metric as Record<string, unknown>),
            aggregate: null,
            aggregate_withheld: 'below_scoring_floor',
          },
        }
      : round
  );
  await stubCampaignService(page, { record: stubRecord({ rounds }) });
  await page.goto(`/#/campaigns/${CAMPAIGN_ID}/progress`);
  await waitForLoaded(page);

  const text = await regionText(page);
  expect(text).toContain('1 round has no combined score');
  expect(text).toContain('Fewer sites returned a score than the campaign publishes a combined figure over');
  // The campaign made this decision, so the page must not present it as its own
  // refusal, which is what the amber block says and which would read as a
  // defect in the record rather than as the disclosure rule working.
  expect(text).not.toContain('holding back figures the campaign did publish');
  expect(text).not.toContain('no reason recorded');
});

test('a null aggregate with no stated reason is not reported as a withhold', async ({ page }) => {
  const rounds = stubRounds().map((round: any) =>
    round.round === 4
      ? {
          ...round,
          metric: {
            ...(round.metric as Record<string, unknown>),
            aggregate: null,
            // No cause. An absence with no basis is not a withhold, and calling
            // it one would attribute a decision to a campaign that made none.
            aggregate_withheld: null,
          },
        }
      : round
  );
  await stubCampaignService(page, { record: stubRecord({ rounds }) });
  await page.goto(`/#/campaigns/${CAMPAIGN_ID}/progress`);
  await waitForLoaded(page);

  const text = await regionText(page);
  expect(text).toContain('no reason recorded for its absence');
  expect(text).toContain('does not describe it as either');
  expect(text).not.toContain('Fewer sites returned a score');
  expect(text).not.toContain('holding back figures the campaign did publish');
});

test('the three reasons a round has no combined score stay distinguishable', async ({ page }) => {
  const rounds = stubRounds().map((round: any) => {
    if (round.round === 1) {
      // The campaign withheld and said why.
      return {
        ...round,
        metric: { ...(round.metric as any), aggregate: null, aggregate_withheld: 'partial_map' },
      };
    }
    if (round.round === 4) {
      // The campaign published a figure over one SCORING site, under a floor of
      // two. Both sites were asked; one answered. That is the shape the floor
      // exists for, and it used to be written here as a short `eval_on`, which
      // is a different round: it cleared the floor because the floor was
      // reading the sites asked rather than the sites that scored.
      return { ...round, metric: { ...(round.metric as any), n_sites_scored: 1 } };
    }
    if (round.round === 5) {
      // Neither: no figure and no reason.
      return {
        ...round,
        metric: { ...(round.metric as any), aggregate: null, aggregate_withheld: null },
      };
    }
    return round;
  });
  await stubCampaignService(page, { record: stubRecord({ rounds }) });
  await page.goto(`/#/campaigns/${CAMPAIGN_ID}/progress`);
  await waitForLoaded(page);

  const text = await regionText(page);
  // All three fire at once and each says something the other two do not.
  expect(text).toContain('Only some sites published a curve');
  expect(text).toContain('holding back figures the campaign did publish');
  expect(text).toContain('over fewer scoring sites than the campaign');
  expect(text).toContain('no reason recorded for its absence');
  // One round each, so none of them absorbed another's count. A round counted
  // twice overstates how much is missing and a round counted nowhere is the
  // original bug.
  expect(text.match(/1 round /g)?.length).toBe(3);
  // Round 0 still plots, which is what makes the three refusals above findings
  // rather than the behaviour of a chart that refuses everything.
  expect(text).toContain('validation Dice 0.400');
});

test('a short per-site map is reported even when no aggregate reasoning runs', async ({ page }) => {
  // Two sites scored, one published a curve, and there is no aggregate at all.
  // Every aggregate note is correctly silent here, and the per-site curves were
  // relying on those notes to mention that the set was short: the chart drew
  // one line for a round that two sites scored and nothing said so.
  const rounds = stubRounds().map((round: any) => ({
    ...round,
    metric: {
      ...(round.metric as any),
      per_site: { 'stub-site-a': 0.71 },
      per_site_basis: 'site',
      n_sites_scored: 2,
      aggregate: null,
      aggregate_withheld: null,
    },
  }));
  await stubCampaignService(page, { record: stubRecord({ rounds }) });
  await page.goto(`/#/campaigns/${CAMPAIGN_ID}/progress`);
  await waitForLoaded(page);

  const text = await regionText(page);
  expect(text).toContain('not every site that took part');
  // The aggregate side stays on its own axis: these rounds are absences, not
  // withholds, and nothing about the short map may be reported as one.
  expect(text).toContain('no reason recorded for its absence');
  expect(text).not.toContain('holding back figures the campaign did publish');
});

test('per-site curves of unknowable completeness say so', async ({ page }) => {
  const rounds = stubRounds().map((round: any) => ({
    ...round,
    metric: {
      ...(round.metric as any),
      per_site: { 'stub-site-a': 0.71, 'stub-site-b': 0.69 },
      per_site_basis: 'site',
      n_sites_scored: null,
      aggregate: null,
      aggregate_withheld: null,
    },
  }));
  await stubCampaignService(page, { record: stubRecord({ rounds }) });
  await page.goto(`/#/campaigns/${CAMPAIGN_ID}/progress`);
  await waitForLoaded(page);

  const text = await regionText(page);
  expect(text).toContain('without saying how many sites scored');
  // A full-looking map is not a map known to be full, and the page must not
  // upgrade one to the other by staying quiet.
  expect(text).not.toContain('not every site that took part');
});

test('neither per-site note fires on a record that reports a complete map', async ({ page }) => {
  // The control for both tests above. Both notes are about absences, so both
  // would be invisible if they fired always, and a note that fires always says
  // nothing about the record it is printed under.
  const rounds = stubRounds().map((round: any) => ({
    ...round,
    metric: {
      ...(round.metric as any),
      per_site: { 'stub-site-a': 0.71, 'stub-site-b': 0.69 },
      per_site_basis: 'site',
      n_sites_scored: 2,
    },
  }));
  await stubCampaignService(page, { record: stubRecord({ rounds }) });
  await page.goto(`/#/campaigns/${CAMPAIGN_ID}/progress`);
  await waitForLoaded(page);

  const text = await regionText(page);
  expect(text).not.toContain('not every site that took part');
  expect(text).not.toContain('without saying how many sites scored');
  expect(text).not.toContain('more per-site scores than sites recorded as scoring');
  // The key-space notes are absences too, so they need the same control. A
  // basis of 'site' is the case where both must stay quiet.
  expect(text).not.toContain('without recording what those units are');
  expect(text).not.toContain('keyed by something other than site');
  // And the curves really are on the chart, so this is not the empty state.
  // This is also the control for the two key-space tests below, which assert
  // the chart is absent. Without a case that draws one, "no chart" would pass
  // just as well if the chart had been deleted.
  await expect(page.getByRole('img', { name: /by round$/ })).toHaveCount(1);
  expect(text).toContain('Stub site A');
});

test('a per-site map with more entries than sites scored is not drawn at all', async ({ page }) => {
  // The other direction of the completeness comparison, in the one space where
  // that comparison means anything: the record SAYS this map is site-keyed and
  // it still carries three entries against two sites. That is a contradiction
  // inside a single key space rather than an inference across two, which is
  // what the earlier revision of this test got wrong. It asserted that an
  // over-long map proves the keys are not site ids, and a dataset-keyed map is
  // over-long by construction without any key being wrong.
  //
  // What survives is the consequence. Something here does not add up, and the
  // label fall-through would render whichever keys those are as though each
  // were a site. A wrong curve under a plausible label is worse than a missing
  // one.
  //
  // No aggregate either, so nothing else on the page has any reason to mention
  // these rounds. That also puts the chart in its empty branch, which is where
  // a dropped map is easiest to misread as data never collected.
  const rounds = stubRounds().map((round: any) => ({
    ...round,
    metric: {
      ...(round.metric as any),
      per_site: { 'stub-site-a': 0.71, 'stub-site-b': 0.69, 'stub-dataset-x': 0.66 },
      per_site_basis: 'site',
      n_sites_scored: 2,
      aggregate: null,
      aggregate_withheld: null,
    },
  }));
  await stubCampaignService(page, { record: stubRecord({ rounds }) });
  await page.goto(`/#/campaigns/${CAMPAIGN_ID}/progress`);
  await waitForLoaded(page);

  const text = await regionText(page);
  expect(text).toContain('more per-site scores than sites recorded as scoring');
  // The unmatched key is never printed as a series label, which is the whole
  // point of dropping the map rather than plotting it with a caveat.
  expect(text).not.toContain('stub-dataset-x');
  // And the record is not described as carrying no per-site curves. It carries
  // them; this page declined to draw them, which is a different sentence.
  expect(text).not.toContain('No per-site curves are in this record');
  expect(text).not.toContain('not every site that took part');
});

test('an over-long map is named in the refusal box when an aggregate is published', async ({
  page,
}) => {
  // One round over-long among three sound ones, so the chart really renders and
  // the note is read against a drawn curve rather than an empty panel. The
  // aggregate for that round is refused by the page, so it belongs in the amber
  // box: the record carries a combination its own format rules out.
  const rounds = stubRounds().map((round: any) =>
    round.round === 5
      ? {
          ...round,
          metric: {
            ...(round.metric as any),
            per_site: { 'stub-site-a': 0.71, 'stub-site-b': 0.69, 'stub-dataset-x': 0.66 },
            per_site_basis: 'site',
            n_sites_scored: 2,
          },
        }
      : round
  );
  await stubCampaignService(page, { record: stubRecord({ rounds }) });
  await page.goto(`/#/campaigns/${CAMPAIGN_ID}/progress`);
  await waitForLoaded(page);

  const text = await regionText(page);
  expect(text).toContain('holding back figures the campaign did publish');
  // "per-unit", not "per-site". Since 0.7.0 this cause also fires on a
  // dataset-keyed map counted against its own datasets, so the sentence cannot
  // name a key space the record did not declare. The separate per-site PANEL
  // note, asserted against elsewhere in this file, still says "site", because
  // that one really does only fire on a site-keyed map.
  expect(text).toContain('more per-unit scores than the number of units it records');
  expect(text).not.toContain('stub-dataset-x');
  // The three sound rounds still plot, so this is a single round withheld and
  // not the gate swallowing the series.
  expect(text).toContain('The combined curve is a merge-weighted mean');
});

/**
 * The two tests below cover the defect the pair above were built on top of.
 *
 * Both cardinality gates compare the length of `per_site` against
 * `n_sites_scored`, which counts sites. That comparison means nothing unless
 * the map is site-keyed, and the schema used to assert it was in a doc comment
 * while the only known producer keys by dataset. So a correct dataset-keyed
 * round was arriving at a gate built for a malformed site-keyed one.
 *
 * Nothing catches that by looking at the keys. In the launch consortium every
 * dataset name is also a client name, so a dataset-keyed map resolves cleanly
 * against the roster and renders as labelled site curves with nothing reporting
 * a problem. A check that passes by naming coincidence is worse than no check.
 * Hence `per_site_basis`, and hence these two tests: the key space has to come
 * from the record, and each of the two ways it can fail has to be visible as
 * itself rather than borrowing the count-mismatch wording.
 *
 * READ THIS BEFORE TRUSTING THE SITE-KEYED PATH. The driver emits 'dataset'
 * today, so in production the site-keyed branch of that gate is never taken and
 * the cardinality comparisons behind it never run. Every assertion here that
 * exercises them does so on a stub. That makes them untested against a real
 * record, not validated by one, and the distinction erodes fast: a year of
 * green turns into "this has been working in production for a year" in
 * somebody's memory. It has not been running at all. What makes the branch safe
 * to keep is that removing it fails these tests and nothing else, which is a
 * statement about coverage rather than about the field ever having been
 * exercised. The real exercise arrives when `#0001` carries (site, dataset)
 * through.
 */
test('a per-site map that does not say what it is keyed by is not drawn', async ({ page }) => {
  const rounds = stubRounds().map((round: any) => ({
    ...round,
    metric: {
      ...(round.metric as any),
      per_site: { 'stub-site-a': 0.71, 'stub-site-b': 0.69 },
      per_site_basis: null,
      n_sites_scored: 2,
      aggregate: null,
      aggregate_withheld: null,
    },
  }));
  await stubCampaignService(page, { record: stubRecord({ rounds }) });
  await page.goto(`/#/campaigns/${CAMPAIGN_ID}/progress`);
  await waitForLoaded(page);

  const text = await regionText(page);
  expect(text).toContain('without recording what those units are');
  // Two entries, two sites scored. The counts agree, so nothing about this
  // round is a count mismatch and the page must not report one.
  expect(text).not.toContain('more per-site scores than sites recorded as scoring');
  expect(text).not.toContain('not every site that took part');
  // And the record is not described as carrying nothing. It carried a map and
  // this page declined to draw it.
  expect(text).not.toContain('No per-site curves are in this record');

  // Nothing is plotted. Checked on the chart itself rather than by looking for
  // "Stub site A" in the page text, because these keys DO resolve against the
  // roster and the site names appear in the round log and the roster table
  // regardless of what the chart does. A text-absence assertion would have
  // failed here for a reason that has nothing to do with the chart, and in the
  // mirror case it would have passed while a curve was on screen.
  await expect(page.getByRole('img', { name: /by round$/ })).toHaveCount(0);
});

test('the pooled arm is refused for its key space, not as a count mismatch', async ({ page }) => {
  // Six datasets scored at one site, which is the pooled arm of the current
  // federated layout and a CORRECT round. The over-long gate rejected it as a
  // malformed site map, which is the case that proved the gate was comparing
  // across two key spaces.
  const rounds = stubRounds().map((round: any) => ({
    ...round,
    metric: {
      ...(round.metric as any),
      per_site: { 'stub-dataset-x': 0.66, 'stub-dataset-y': 0.68, 'stub-dataset-z': 0.7 },
      per_site_basis: 'dataset',
      n_sites_scored: 1,
      aggregate: null,
      aggregate_withheld: null,
    },
  }));
  await stubCampaignService(page, { record: stubRecord({ rounds }) });
  await page.goto(`/#/campaigns/${CAMPAIGN_ID}/progress`);
  await waitForLoaded(page);

  const text = await regionText(page);
  expect(text).toContain('keyed by something other than site');
  // Three entries against one site scored. Under the old gate that was an
  // over-long map; it is a well-formed record and must not be reported as
  // malformed, because that sends a reader to look for a producer bug that is
  // not there.
  expect(text).not.toContain('more per-site scores than sites recorded as scoring');
  expect(text).not.toContain('not every site that took part');
  expect(text).not.toContain('stub-dataset-x');
  await expect(page.getByRole('img', { name: /by round$/ })).toHaveCount(0);
});

/**
 * Who the page accuses when it holds a figure back.
 *
 * The two key-space tests above both set `aggregate: null`, so neither of them
 * ever reached the block that decides an aggregate. That is why this went
 * unseen: the key space was tested, the accusation attached to it was not, and
 * the two only meet when a round publishes a combined score AND a map the page
 * cannot check. Both tests below do that, and before the fix both landed in the
 * amber box, which ends by telling the reader the record broke a rule.
 *
 * Neither record broke anything. A dataset basis is a value the format added a
 * field for, and a null basis is documented as "the producer did not say". The
 * pooled arm of the federated layout is permanently dataset-keyed, one site
 * scoring several datasets, and it is 15 of the 75 arms in the only completed
 * run there is, so this was not a corner: the page told every reader of that
 * campaign that a fifth of it was malformed.
 *
 * The withholding is correct and unchanged in both. Only the attribution moves.
 */
test('a map the page cannot check is not called a breach of the format', async ({ page }) => {
  const rounds = stubRounds().map((round: any) => ({
    ...round,
    metric: {
      ...(round.metric as any),
      per_site: { 'stub-dataset-x': 0.66, 'stub-dataset-y': 0.68 },
      per_site_basis: 'dataset',
      n_sites_scored: 1,
      aggregate: 0.67,
      aggregate_withheld: null,
    },
  }));
  await stubCampaignService(page, { record: stubRecord({ rounds }) });
  await page.goto(`/#/campaigns/${CAMPAIGN_ID}/progress`);
  await waitForLoaded(page);

  const text = await regionText(page);
  expect(text).toContain('not keyed by site');
  expect(text).toContain('the record is not at fault');
  // The accusation, and the sentence underneath it that spells the accusation
  // out. Both must be absent, because the heading alone is what a reader skims.
  expect(text).not.toContain('holding back figures the campaign did publish');
  expect(text).not.toContain('its own record then broke');
  // Still withheld. The fix is about who is blamed, not about what is shown,
  // and a fix that started plotting this would be a worse bug than the one it
  // replaced: the map has no denominator, so the figure could fill in a gap.
  expect(text).not.toContain('0.67');
  await expect(page.getByRole('img', { name: /by round$/ })).toHaveCount(0);
});

test('an unstated key space is not called a breach of the format either', async ({ page }) => {
  const rounds = stubRounds().map((round: any) => ({
    ...round,
    metric: {
      ...(round.metric as any),
      per_site: { 'stub-site-a': 0.71, 'stub-site-b': 0.69 },
      per_site_basis: null,
      n_sites_scored: 2,
      aggregate: 0.7,
      aggregate_withheld: null,
    },
  }));
  await stubCampaignService(page, { record: stubRecord({ rounds }) });
  await page.goto(`/#/campaigns/${CAMPAIGN_ID}/progress`);
  await waitForLoaded(page);

  const text = await regionText(page);
  expect(text).toContain('without recording what the units are');
  expect(text).toContain('Saying nothing is a permitted answer');
  expect(text).not.toContain('holding back figures the campaign did publish');
  expect(text).not.toContain('its own record then broke');
  await expect(page.getByRole('img', { name: /by round$/ })).toHaveCount(0);
});

/**
 * 0.7.0, and the reason the two tests above stop short of the whole story.
 *
 * Both of them end with the figure withheld and nobody blamed, which was the
 * best available answer while `n_sites_scored` was the schema's only
 * denominator: a dataset-keyed map had no count in its own units, so its
 * completeness was not checkable by anyone. Not blaming the producer was
 * correct. Leaving the pooled arm permanently unreadable was not a fix, it was
 * an accurate description of a gap.
 *
 * `n_datasets_scored` closes it, and these two tests are the two directions
 * that closing has to work in. Given the count, the map is checked in its own
 * key space and the figure is published. Given the count in a key space the
 * record does not claim, the record really has contradicted itself and the
 * amber is correct.
 *
 * The first of the two is the one worth watching. Every other assertion in this
 * region checks that something is withheld, and a page that withheld everything
 * would pass all of them.
 */
test('a dataset-keyed map with a dataset count is checked and published', async ({ page }) => {
  const rounds = stubRounds().map((round: any) => ({
    ...round,
    metric: {
      ...(round.metric as any),
      per_site: { 'stub-dataset-x': 0.66, 'stub-dataset-y': 0.68, 'stub-dataset-z': 0.7 },
      per_site_basis: 'dataset',
      // Both counts, which is the shape able-clam's proposal would have read as
      // a contradiction. It is not one. The map is complete in datasets and the
      // floor of 2 stands on sites, so the round satisfies both and publishes.
      n_datasets_scored: 3,
      n_sites_scored: 2,
      aggregate: 0.67,
      aggregate_withheld: null,
    },
  }));
  await stubCampaignService(page, { record: stubRecord({ rounds }) });
  await page.goto(`/#/campaigns/${CAMPAIGN_ID}/progress`);
  await waitForLoaded(page);

  const text = await regionText(page);
  // Neither of the two ways the page used to decline this round.
  expect(text).not.toContain('the record is not at fault');
  expect(text).not.toContain('holding back figures the campaign did publish');
  expect(text).not.toContain('its own record then broke');
  // The combined curve is drawn. This is the assertion the whole version turns
  // on and it is the only positive one in the region, so if the gate reverts to
  // withholding every dataset-keyed round, this fails alone.
  await expect(page.getByRole('img', { name: /by round$/ })).toHaveCount(1);

  // The per-site PANEL still declines these curves, and that is deliberate
  // rather than an oversight this test forgot to update. Its lines stand for
  // sites, and in the launch consortium every dataset name is also a client
  // name, so drawing three dataset curves there would render as three labelled
  // site curves that resolve against the roster with nothing for a reader to
  // check them against. The aggregate is publishable because the record now
  // proves the set behind it is complete. That says nothing about what the
  // lines on a per-site chart are allowed to mean.
  expect(text).toContain('keyed by something other than site');
});

test('a dataset count on a site-keyed round is a breach, and is named as one', async ({ page }) => {
  const rounds = stubRounds().map((round: any) => ({
    ...round,
    metric: {
      ...(round.metric as any),
      per_site: { 'stub-site-a': 0.71, 'stub-site-b': 0.69 },
      per_site_basis: 'site',
      n_sites_scored: 2,
      // The count in a key space this record does not claim. This is the
      // contradiction, and it is the ONLY co-occurrence that is one: the two
      // counts appearing together on a dataset-keyed round is the normal shape,
      // tested above.
      n_datasets_scored: 3,
      aggregate: 0.67,
      aggregate_withheld: null,
    },
  }));
  await stubCampaignService(page, { record: stubRecord({ rounds }) });
  await page.goto(`/#/campaigns/${CAMPAIGN_ID}/progress`);
  await waitForLoaded(page);

  const text = await regionText(page);
  expect(text).toContain('has not settled what it is counting');
  // Amber, unlike the two panel limits above. Here the record did break a rule
  // it declared, so the accusation is the right one and must not have been
  // softened along with the two that were wrong.
  expect(text).toContain('holding back figures the campaign did publish');
  expect(text).toContain('its own record then broke');
  expect(text).not.toContain('the record is not at fault');
});

/**
 * The scoring floor, and the operand it is checked against.
 *
 * The floor exists to stop a pooled figure being published when too few sites
 * stand behind it. It was comparing `eval_on`, the sites ASKED to evaluate,
 * against the threshold, while the figure it gates is a mean over
 * `n_sites_scored`, the sites that ANSWERED. Nothing in the record or in this
 * page related those two numbers, so a round that asked six sites and heard
 * back from one satisfied a floor of six and published that one site's own
 * value under a pooled label.
 *
 * The failure is invisible on screen by construction. A wrong point and a right
 * point are the same dot, and the reader has no surface to check the pairing
 * against: the round is real, the sites are real, the number is real, and only
 * the claim about what it is an average of is wrong. So these tests assert on
 * the refusal sentence and on the absence of the value, and the last one is the
 * control that stops a page which simply refuses everything from passing.
 */
test('a pooled figure over one site is withheld even when the eval set is large', async ({
  page,
}) => {
  const rounds = stubRounds().map((round: any) => ({
    ...round,
    // Asked three, heard from one. Under the old operand this cleared a floor
    // of two and plotted.
    eval_on: ['stub-site-a', 'stub-site-b', 'stub-site-c'],
    metric: {
      ...(round.metric as any),
      per_site: null,
      per_site_basis: null,
      n_sites_scored: 1,
      aggregate: 0.88,
      aggregate_withheld: null,
    },
  }));
  await stubCampaignService(page, { record: stubRecord({ rounds }) });
  await page.goto(`/#/campaigns/${CAMPAIGN_ID}/progress`);
  await waitForLoaded(page);

  const text = await regionText(page);
  expect(text).toContain('fewer scoring sites than the campaign');
  // The value itself never reaches the page. Asserting only the sentence would
  // pass on a page that printed both.
  expect(text).not.toContain('0.880');
  expect(text).not.toContain('0.88');
});

test('an aggregate with no count of scoring sites is withheld', async ({ page }) => {
  // The wider half of the same defect. With `per_site` null the whole per-site
  // block was skipped, `n_sites_scored` was never read at all, and the floor
  // passed on the eval set. Withholding the map is a legitimate disclosure
  // choice; withholding the count leaves the floor with no operand.
  const rounds = stubRounds().map((round: any) => ({
    ...round,
    metric: {
      ...(round.metric as any),
      per_site: null,
      per_site_basis: null,
      n_sites_scored: null,
      aggregate: 0.88,
      aggregate_withheld: null,
    },
  }));
  await stubCampaignService(page, { record: stubRecord({ rounds }) });
  await page.goto(`/#/campaigns/${CAMPAIGN_ID}/progress`);
  await waitForLoaded(page);

  const text = await regionText(page);
  expect(text).toContain('without saying how many sites were scored');
  expect(text).not.toContain('0.88');
});

test('more scoring sites than evaluating sites is reported as a contradiction', async ({
  page,
}) => {
  // Not a coverage shortfall. A site cannot return a score it was not asked
  // for, so this cannot come from the driver and says the record was assembled
  // wrong. Reported as its own finding rather than folded into the floor,
  // because the two send a reader to different places.
  const rounds = stubRounds().map((round: any) => ({
    ...round,
    eval_on: ['stub-site-a'],
    metric: {
      ...(round.metric as any),
      per_site: null,
      per_site_basis: null,
      n_sites_scored: 2,
      aggregate: 0.88,
      aggregate_withheld: null,
    },
  }));
  await stubCampaignService(page, { record: stubRecord({ rounds }) });
  await page.goto(`/#/campaigns/${CAMPAIGN_ID}/progress`);
  await waitForLoaded(page);

  const text = await regionText(page);
  expect(text).toContain('more scoring sites than the record says were asked to evaluate');
  expect(text).not.toContain('fewer scoring sites than the campaign');
  expect(text).not.toContain('0.88');
});

test('a short eval set does not withhold when enough sites scored', async ({ page }) => {
  // The control, and the one that stops the fix from being a relabelled version
  // of the same mistake. If the floor had simply moved to a different wrong
  // field, or if the page refused any round whose two counts differ, this
  // withholds and the three tests above would still pass.
  //
  // Two sites asked, two scored, floor of two. The eval set is smaller than the
  // roster and that is not disqualifying: what the threshold is about is how
  // many results the published mean is over.
  await stubCampaignService(page);
  await page.goto(`/#/campaigns/${CAMPAIGN_ID}/progress`);
  await waitForLoaded(page);

  const text = await regionText(page);
  expect(text).not.toContain('fewer scoring sites than the campaign');
  expect(text).not.toContain('more scoring sites than the record says');
  expect(text).not.toContain('without saying how many sites were scored');
  await expect(page.getByRole('img', { name: /by round$/ })).toHaveCount(1);
});

test('the caption describing the combined curve does not outlive the curve', async ({ page }) => {
  // Every aggregate withheld, per-site curves present, so the chart still draws
  // something and the empty state does not fire. That combination is the only
  // one where the defect is visible: the caption is present tense about a line
  // on the chart, and it was keyed off the metric carrying a basis rather than
  // off a combined curve having been plotted.
  const rounds = stubRounds().map((round: any) => ({
    ...round,
    metric: {
      ...(round.metric as any),
      per_site: { 'stub-site-a': 0.71, 'stub-site-b': 0.69 },
      per_site_basis: 'site',
      aggregate: null,
      aggregate_withheld: 'below_scoring_floor',
    },
  }));
  await stubCampaignService(page, { record: stubRecord({ rounds }) });
  await page.goto(`/#/campaigns/${CAMPAIGN_ID}/progress`);
  await waitForLoaded(page);

  const text = await regionText(page);
  expect(text).not.toContain('The combined curve is a');
  // The per-site curves really are on the chart, so this is a caption suppressed
  // next to a rendered chart and not the empty state swallowing everything.
  expect(text).toContain('Fewer sites returned a score');
});

test('the same caption does render when a combined curve is actually plotted', async ({ page }) => {
  // The control for the test above. Without it, deleting the caption outright
  // would pass and the page would have lost the one sentence that says the
  // combined curve is worked out rather than measured.
  await stubCampaignService(page);
  await page.goto(`/#/campaigns/${CAMPAIGN_ID}/progress`);
  await waitForLoaded(page);

  const text = await regionText(page);
  expect(text).toContain('The combined curve is a merge-weighted mean');
  expect(text).toContain('named here rather than presented as a measurement');
});

test('a campaign with nothing missing renders none of the missing-round notes', async ({
  page,
}) => {
  // The baseline the other three are read against, and the state that would
  // never be asserted on its own: nothing renders, so there is nothing to look
  // at. If a note leaked into this case the contrast would be gone and every
  // per-case test above would still pass.
  await stubCampaignService(page);
  await page.goto(`/#/campaigns/${CAMPAIGN_ID}/progress`);
  await waitForLoaded(page);

  const text = await regionText(page);
  expect(text).not.toContain('has no combined score');
  expect(text).not.toContain('have no combined score');
  expect(text).not.toContain('holding back figures the campaign did publish');
  expect(text).not.toContain('no reason recorded');
});

test('the round log does not print a figure the chart refuses', async ({ page }) => {
  // The log and the chart used to make the decision separately, and only the
  // chart made it properly. Between a surface that shows a number and one that
  // does not, the number is what a reader takes away, so the permissive surface
  // decides in practice however careful the other one is.
  const rounds = stubRounds().map((round: any) =>
    round.round === 5 ? { ...round, eval_on: ['stub-site-a'] } : round
  );
  await stubCampaignService(page, { record: stubRecord({ rounds }) });
  await page.goto(`/#/campaigns/${CAMPAIGN_ID}/progress`);
  await waitForLoaded(page);

  const text = await regionText(page);
  // Round 5's aggregate is 0.75 and it is refused on the disclosure floor.
  expect(text).not.toContain('validation Dice 0.750');
  // Round 0's is not refused, which is what proves the log still prints scores.
  expect(text).toContain('validation Dice 0.400');
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

/**
 * The provenance sentence, which had the same two defects as the per-site map
 * and kept them one commit longer.
 *
 * "All N scored on X" took N from `scored_with` itself. A map is always all of
 * itself, so the word "all" could not be wrong and could not be right: it read
 * as a coverage claim and asserted nothing. The denominator has to come from
 * `eval_on`, which is the set the driver builds the map over.
 *
 * And the sentence calls those entries sites, which is a claim about the key
 * space that the schema used to make in a doc comment. `scored_with` comes out
 * of the same driver function as the per-site metric map, keyed differently.
 *
 * The four tests below are the four states, and the control above is the fifth.
 * Without the control, every one of these would pass on a page that had simply
 * deleted the sentence.
 */
test('a short digest set is reported as a fraction, not as all of itself', async ({ page }) => {
  const rounds = stubRounds().map((round: any) => ({
    ...round,
    // Two sites evaluated, one digest came back.
    scored_with: { 'stub-site-a': STUB_DIGEST },
  }));
  await stubCampaignService(page, { record: stubRecord({ rounds }) });
  await page.goto(`/#/campaigns/${CAMPAIGN_ID}/progress`);
  await waitForLoaded(page);

  const text = await regionText(page);
  expect(text).toContain('1 of 2 scored on');
  // The old sentence would have rendered "All 1 scored on", which is true about
  // the map and false about the round.
  expect(text).not.toContain('All 1 scored on');
  expect(text).toContain('a22dba37');
});

test('with no evaluating set recorded, the digest carries no coverage claim', async ({ page }) => {
  const rounds = stubRounds().map((round: any) => ({
    ...round,
    eval_on: null,
    scored_with: { 'stub-site-a': STUB_DIGEST },
  }));
  await stubCampaignService(page, { record: stubRecord({ rounds }) });
  await page.goto(`/#/campaigns/${CAMPAIGN_ID}/progress`);
  await waitForLoaded(page);

  const text = await regionText(page);
  // The digest is still worth showing. What is not available is the denominator,
  // so the sentence states what it has and claims nothing further.
  expect(text).toContain('1 site scored on');
  expect(text).not.toContain('All 1');
  expect(text).not.toContain(' of 2 scored on');
});

test('digests reported without a key space are not counted as sites', async ({ page }) => {
  const rounds = stubRounds().map((round: any) => ({
    ...round,
    scored_with_basis: null,
  }));
  await stubCampaignService(page, { record: stubRecord({ rounds }) });
  await page.goto(`/#/campaigns/${CAMPAIGN_ID}/progress`);
  await waitForLoaded(page);

  const text = await regionText(page);
  expect(text).toContain('without recording that they belong to sites');
  expect(text).not.toContain('All 2 scored on');
  // The digest is not shown either, because the sentence that carries it is the
  // sentence making the claim.
  expect(text).not.toContain('a22dba37');
});

test('more digests than evaluating sites withholds provenance and says so', async ({ page }) => {
  const rounds = stubRounds().map((round: any) => ({
    ...round,
    scored_with: {
      'stub-site-a': STUB_DIGEST,
      'stub-site-b': STUB_DIGEST,
      'stub-site-c': STUB_DIGEST,
    },
  }));
  await stubCampaignService(page, { record: stubRecord({ rounds }) });
  await page.goto(`/#/campaigns/${CAMPAIGN_ID}/progress`);
  await waitForLoaded(page);

  const text = await regionText(page);
  expect(text).toContain('does not match the evaluating set');
  // Both directions of the wrong reading are refused. "All 3" would invent a
  // third site and "3 of 2" would print an impossible fraction rather than
  // reporting that the record contradicts itself.
  expect(text).not.toContain('All 3 scored on');
  expect(text).not.toContain('3 of 2 scored on');
  expect(text).not.toContain('a22dba37');
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

test('no ratio of bytes moved to data held is rendered, in either direction', async ({
  page,
}) => {
  // Both halves are present and the arithmetic is trivial. The page still does
  // not do it, because the two quantities have different shapes: bytes moved
  // accumulates with rounds and data held does not, so the quotient depends on
  // the window it is taken over and for a whole-model payload it changes sign
  // partway through the campaign. There is no window a scalar can carry.
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
        images_held: { n_images: 1018 },
        declared_data_bytes: 11_400_000_000_000,
      },
    }),
  });
  await page.goto(`/#/campaigns/${CAMPAIGN_ID}`);
  await waitForLoaded(page);

  const text = await regionText(page);
  // "to 1" as a RATIO, not as a sequence range: the incomplete-log window list
  // legitimately renders "entries 0 to 1,011", so a bare substring match fires
  // on honest copy. Require that nothing numeric follows the 1.
  expect(text).not.toMatch(/\bto 1(?![\d,.])/);
  expect(text).not.toMatch(/\bratio\b/i);
  expect(text).not.toContain('Transport asymmetry');
  // Nor any of the framing a quotient would have carried. "saving" is in the
  // list on purpose and the page copy is written around it: the word cannot
  // appear at all, so no sentence containing it can be quoted as a claim.
  for (const phrase of ['times less', 'times more', 'less data in motion', 'saving', 'saves']) {
    expect(text, `saving language "${phrase}" rendered on a campaign page`).not.toContain(phrase);
  }
  // Both figures are still shown. Withholding the comparison is not the same as
  // withholding the measurements, and this page exists to show the latter.
  expect(text).toContain('62.1 MB');
  expect(text).toContain('11.4 TB');
});

test('a campaign that moved more than it held renders both figures unflinchingly', async ({
  page,
}) => {
  // The failure this guards is specific and it was live: a plausibility guard
  // that dropped ratios below 1 suppressed exactly the answers unfavourable to
  // federation and passed the favourable ones. Any campaign run past its
  // crossover round moves more than it avoided moving, and that is a real
  // finding the page must not be able to hide. The figures below are a
  // constructed case rather than a record of any campaign here, which is the
  // point: the page has to render it whoever supplies it. With no quotient
  // anywhere, the two figures stand alone and a reader can see which is larger.
  await stubCampaignService(page, {
    record: stubRecord({
      transport: {
        observed: {
          valid: true,
          invalid_reason: null,
          per_site: null,
          driver: { bytes_out: 1_390_000_000_000, bytes_in: 1_390_000_000_000, n_transfers: 360 },
          windows: [{ source: 'driver', first_seq: 0, last_seq: 359, n_transfers: 360 }],
        },
        computed: null,
        kinds_transferred: ['model_weights'],
        only_weights_left_site: true,
        images_moved_bytes: 0,
        images_held: { n_images: 1018 },
        declared_data_bytes: 600_000_000_000,
      },
    }),
  });
  await page.goto(`/#/campaigns/${CAMPAIGN_ID}`);
  await waitForLoaded(page);

  const text = await regionText(page);
  expect(text).toContain('1.39 TB');
  expect(text).toContain('600 GB');
  // No "not computable" excuse, because it was computable. It was unflattering.
  expect(text).not.toContain('Not computable');
  expect(text).not.toMatch(/\bto 1(?![\d,.])/);
});

test('per-round bytes are withheld when the round was not fully logged', async ({ page }) => {
  // Every round carries a populated bytes_out. The round log still shows none of
  // them: a round covered by some sources and not others is a real sum of real
  // entries that is not the round's transport, and the value cannot say which of
  // the two it is. The flag is asked instead.
  await stubCampaignService(page, {
    record: stubRecord({
      rounds: stubRounds().map((round: any) => ({
        ...round,
        transport: { ...(round.transport as object), sources_complete: false },
      })),
    }),
  });
  await page.goto(`/#/campaigns/${CAMPAIGN_ID}/progress`);
  await waitForLoaded(page);

  const text = await regionText(page);
  expect(text).toContain('Round 5');
  expect(text).not.toContain('of weights moved');
});

test('a null coverage flag withholds per-round bytes just as a false one does', async ({
  page,
}) => {
  await stubCampaignService(page, {
    record: stubRecord({
      rounds: stubRounds().map((round: any) => ({
        ...round,
        transport: { ...(round.transport as object), sources_complete: null },
      })),
    }),
  });
  await page.goto(`/#/campaigns/${CAMPAIGN_ID}/progress`);
  await waitForLoaded(page);

  const text = await regionText(page);
  expect(text).toContain('Round 5');
  expect(text).not.toContain('of weights moved');
});

test('a fully logged round does show its bytes', async ({ page }) => {
  // The gate must not be a blanket suppression. stubRounds() reports complete
  // coverage, so the figure is rendered.
  await stubCampaignService(page);
  await page.goto(`/#/campaigns/${CAMPAIGN_ID}/progress`);
  await waitForLoaded(page);

  const text = await regionText(page);
  expect(text).toContain('15.5 MB of weights moved');
});

test('self-declared roster values are marked, and the roster is not called attested', async ({
  page,
}) => {
  await stubCampaignService(page);
  await page.goto(`/#/campaigns/${CAMPAIGN_ID}`);
  await waitForLoaded(page);

  // Site A declared its training-image count; site B reported nothing, so the
  // mark must appear exactly where a declared value was rendered.
  await expect(page.locator('[data-provenance="declared"]')).toHaveCount(1);

  const text = await regionText(page);
  expect(text).toContain('does not verify that a deployment belongs to the institution it names');
});

/**
 * `declared` is the only mechanism separating a figure a site typed into a
 * join form from one the platform observed, and the mark is the only visual
 * difference between them. The check used to be
 * `site.declared?.includes(field) ?? false`, so a site that reported no
 * provenance at all had every value it did report rendered unmarked, which is
 * how the page spells "the platform measured this".
 *
 * The marker for weaker evidence failed open toward the stronger claim, which
 * is the one direction it must never fail in: a reader loses nothing when a
 * measured value is left unlabelled, and is misled when a self-reported one is
 * presented as observed.
 */
test('a site that reports no provenance does not get its values presented as measured', async ({
  page,
}) => {
  const sites = stubSites().map((site, i) =>
    i === 0
      ? {
          ...site,
          // Values are present. What is absent is any statement of where they
          // came from, which is not the same as a statement that they were
          // measured.
          country: 'Elbonia',
          declared: null,
        }
      : site
  );
  await stubCampaignService(page, { record: stubRecord({ sites }) });
  await page.goto(`/#/campaigns/${CAMPAIGN_ID}`);
  await waitForLoaded(page);

  // Both of site A's reported values carry the unknown-provenance mark, and
  // neither is silently promoted by being left unmarked.
  await expect(page.locator('[data-provenance="unknown"]')).toHaveCount(2);
  await expect(page.locator('[data-provenance="declared"]')).toHaveCount(0);

  const text = await regionText(page);
  // Lowercased: the mark is uppercased in CSS, so innerText reads it back as
  // "SOURCE NOT STATED".
  expect(text.toLowerCase()).toContain('source not stated');
  // The values themselves are still shown. Withholding provenance is not a
  // reason to withhold the figure, only a reason not to vouch for it.
  expect(text).toContain('Elbonia');
  expect(text).toContain('536');
});

/**
 * The three provenance states must be mutually distinguishable ON THE PAGE.
 *
 * The unknown branch is kept even though the service now guarantees `declared`,
 * on the argument that a producer guarantee is not a mechanism on this side.
 * That argument only holds while the branch is LOUD. A fallback that renders
 * like the success case is worse than no fallback, because it converts a loud
 * failure into a quiet one: the code would still be there, the protection would
 * be gone, and nothing would say so.
 *
 * So this asserts discrimination directly rather than checking each state in
 * isolation. Every per-state assertion elsewhere in this file would still pass
 * on a component that had collapsed two states into one rendering. This one
 * would not.
 *
 * Measured is asserted to be UNMARKED specifically, because unmarked is the
 * baseline the other two are read against. If a mark ever appears on measured
 * values, the absence of a mark stops meaning anything and both other states
 * lose their contrast, even though each would still render its own string.
 */
test('the three provenance states are distinguishable from each other', async ({ page }) => {
  const base = stubSites()[0];
  const sites = [
    // Declared: the site listed this field on its join form.
    { ...base, site_id: 'prov-declared', site_name: 'Declared site', declared: ['n_train_images'] },
    // Measured: a declared list exists and this field is not on it, so the
    // platform observed it. An empty list is a positive statement, not silence.
    { ...base, site_id: 'prov-measured', site_name: 'Measured site', declared: [] },
    // Unknown: no declared list at all. Not evidence of measurement.
    { ...base, site_id: 'prov-unknown', site_name: 'Unknown site', declared: null },
  ];
  await stubCampaignService(page, { record: stubRecord({ sites }) });
  await page.goto(`/#/campaigns/${CAMPAIGN_ID}`);
  await waitForLoaded(page);

  // Two marks, not three: the measured site is deliberately unmarked.
  await expect(page.locator('[data-provenance]')).toHaveCount(2);
  await expect(page.locator('[data-provenance="declared"]')).toHaveCount(1);
  await expect(page.locator('[data-provenance="unknown"]')).toHaveCount(1);

  // Asserted on the row itself, so this fails if the measured site picks up a
  // mark of any kind rather than only if the total count changes.
  const measuredRow = page.locator('tr', { hasText: 'Measured site' });
  await expect(measuredRow.locator('[data-provenance]')).toHaveCount(0);
  // ...and the row still shows its value. Unmarked means observed, not hidden.
  await expect(measuredRow).toContainText('536');

  const declaredMark = page.locator('[data-provenance="declared"]');
  const unknownMark = page.locator('[data-provenance="unknown"]');
  const [declaredText, unknownText, declaredTitle, unknownTitle] = await Promise.all([
    declaredMark.innerText(),
    unknownMark.innerText(),
    declaredMark.getAttribute('title'),
    unknownMark.getAttribute('title'),
  ]);

  // Both the visible string and the hover text discriminate. A component that
  // kept the attribute correct while rendering one shared caption would pass
  // the count assertions above and fail here.
  expect(new Set([declaredText, unknownText]).size).toBe(2);
  expect(new Set([declaredTitle, unknownTitle]).size).toBe(2);

  // And they say different things, rather than merely differing. The unknown
  // mark must not claim the site declared anything.
  expect(declaredTitle).toContain('Declared by the site');
  expect(unknownTitle).toContain('did not report where its values came from');
  expect(unknownTitle).not.toContain('Declared by the site');
});

// ---------------------------------------------------------------------------
// Positive controls for the schema guard.
//
// Every other assertion about assertSchema is negative: no mismatched record
// renders. That class of assertion passes identically when the guard works and
// when the guard has been deleted, so on its own it is not evidence the guard
// exists. These two make it throw. If someone breaks assertSchema, these fail
// and nothing else in this file does.
//
// The detail path is checked as well as the index because the guard was added
// to the two paths at different times, and a guard on one endpoint reads, from
// the outside, exactly like a guard on both.
// ---------------------------------------------------------------------------

test('a service on a different schema is refused at the index, not rendered', async ({ page }) => {
  await stubCampaignService(page, { servedSchema: '0.8.0-draft' });
  await page.goto('/#/campaigns');

  // The refusal is visible. A silent empty list would be the wrong outcome:
  // it reads as "no campaigns exist" when the truth is "we cannot read this".
  //
  // Both versions are named, and both are written out. Matching only one of
  // them is what this assertion used to do, and it meant a pin bump left the
  // test green while it had quietly stopped checking that the page reports
  // which version IT is on. A mismatch message that names one side tells a
  // reader half of what they need to fix it.
  await expect(page.getByText(/reports schema 0\.8\.0-draft/)).toBeVisible({ timeout: 20000 });
  await expect(page.getByText(/this page expects 0\.11\.0-draft/)).toBeVisible();

  // And nothing from the stub leaked onto the page behind the error.
  const text = await regionText(page);
  expect(text).not.toContain('Stub nucleus segmentation consortium');
  expect(text).not.toContain('Full state dict');

  // The service answered. Saying it could not be reached would point the
  // reader at the wrong problem.
  expect(text).toContain('format this page does not recognise');
  expect(text).not.toContain('could not be reached');
});

test('a service on a different schema is refused at the detail page too', async ({ page }) => {
  await stubCampaignService(page, { servedSchema: '0.8.0-draft' });
  await page.goto(`/#/campaigns/${CAMPAIGN_ID}`);

  await expect(page.getByText(/reports schema 0\.8\.0-draft/)).toBeVisible({ timeout: 20000 });
  await expect(page.getByText(/this page expects 0\.11\.0-draft/)).toBeVisible();

  const text = await regionText(page);
  expect(text).not.toContain('7.76 MB');
  expect(text).not.toContain('validation Dice');
  expect(text).toContain('format this page does not recognise');
});

test('a response carrying no schema version at all is refused', async ({ page }) => {
  // The absent case is separate from the wrong case because they take
  // different branches, and the absent one is what a service that predates the
  // version field returns.
  await page.route('**/federation-campaign/**', async (route) => {
    const url = route.request().url();
    const body = url.includes('list_campaigns')
      ? { campaigns: [stubSummary(stubRecord())] }
      : { ...stubRecord(), schema_version: undefined };
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(body),
    });
  });

  await page.goto('/#/campaigns');
  await expect(page.getByText(/schema none/)).toBeVisible({ timeout: 20000 });
});

test('a patch-level difference is accepted, so the guard is not merely refusing everything', async ({
  page,
}) => {
  // The complement of the three above. Without this a guard hardwired to
  // `throw` would pass every positive control in this file, which would make
  // them evidence of nothing.
  //
  // Both this literal and the refused ones above are written out rather than
  // derived from SCHEMA_VERSION, so a pin bump breaks them on purpose. A
  // version-relative expression would keep passing while silently testing a
  // different pair of versions, and these four are the only tests here that
  // exercise the guard at all.
  await stubCampaignService(page, { servedSchema: '0.11.99-draft' });
  await page.goto('/#/campaigns');

  await expect(page.getByText('Stub nucleus segmentation consortium')).toBeVisible();
});

// ---------------------------------------------------------------------------
// The honesty check.
//
// The product brief's hardest constraint is that the deployed page renders
// what the campaign service reports or renders nothing, with no illustrative
// figures ever. This is the general form of that check and it lives here, in
// the suite, on purpose. It was previously a scratch script re-created and
// deleted each round, which is exactly how the sibling fixture-leak gate came
// to spend several rounds passing for the wrong reason without anyone noticing.
// A check that is not checked in is a check that decays privately.
//
// It asserts on DIGITS rather than on a list of known figures, because the
// enumerated form can only catch the numbers someone remembered to enumerate,
// and the failure being guarded against is a number nobody expected.
// ---------------------------------------------------------------------------

test('with no service reachable, not one digit is rendered on any campaign route', async ({
  page,
}) => {
  await stubCampaignService(page, { status: 500 });

  for (const route of [
    '/#/campaigns',
    `/#/campaigns/${CAMPAIGN_ID}`,
    `/#/campaigns/${CAMPAIGN_ID}/progress`,
  ]) {
    await page.goto(route);
    await expect(page.locator('[data-testid="campaign-error-state"]')).toBeVisible();

    // The diagnostic line is excluded, and only that line. It carries an HTTP
    // status or a schema version, so it legitimately contains digits that are
    // not campaign figures. The exclusion is by testid rather than by matching
    // the text, so it cannot silently widen to cover a real figure that
    // happens to be phrased like a diagnostic.
    const text = await regionTextWithoutDiagnostics(page);

    // Non-empty, so a blank page cannot pass this by rendering nothing at all.
    expect(text.length, `${route} rendered no text at all`).toBeGreaterThan(50);

    const digits = text.match(/\d/g);
    expect(
      digits,
      `${route} rendered digits with no data behind them: ${JSON.stringify(text.slice(0, 400))}`
    ).toBeNull();
  }
});

test('the same digit scan does find digits when the service answers', async ({ page }) => {
  // The complement of the check above, and the reason to trust it. A digit
  // scan that is silently reading the wrong element, or an empty string,
  // reports "no digits" forever and looks like a clean pass every time. This
  // is the case that makes the scanner prove it can see anything at all.
  await stubCampaignService(page);
  await page.goto(`/#/campaigns/${CAMPAIGN_ID}`);
  await waitForLoaded(page);

  const text = await regionTextWithoutDiagnostics(page);
  expect(text.match(/\d/g)).not.toBeNull();
  expect(text).toContain('7.76 MB');
});

// ---------------------------------------------------------------------------
// The asynchronous arm.
//
// These are the same kind of assertions as everything above: mostly negative,
// and aimed at the things this page can get wrong in a way nobody would notice.
// Two of them are load-bearing beyond ordinary rendering.
//
// The first is the improvement curve. Contributions are SELECTED on a held-out
// score, so a plot of that score rises on every published version whether or
// not the model improved. The curve is only information when it is measured on
// a split the gate never consulted. Both scores travel in the record and both
// are rising, so nothing about the rendered page distinguishes the honest curve
// from the circular one by eye. A test is the only thing that can.
//
// The second is the excluded state. "Assessed, not included" is a neutral
// lineage fact and it must not be rendered as a failure or as a ranking, which
// means the assertions are about colour, wording and the ABSENCE of a
// per-contributor breakdown rather than about a number being present.
// ---------------------------------------------------------------------------

test('an async campaign reports contributions and versions, never rounds', async ({ page }) => {
  await stubCampaignService(page, { record: stubAsyncRecord() });
  await page.goto(`/#/campaigns/${ASYNC_CAMPAIGN_ID}/progress`);
  await waitForLoaded(page);

  // Lowercased throughout: the tile labels are uppercased in CSS, so innerText
  // reads them back as "COMMUNITY VERSIONS".
  const text = await regionText(page);
  expect(text.toLowerCase()).toContain('contributors');
  expect(text.toLowerCase()).toContain('contributions');
  expect(text.toLowerCase()).toContain('community versions');
  // The counts come from the stub and not from anywhere else.
  expect(text).toContain('Latest is v2');

  // A campaign with no rounds must not be described as being in one. This is
  // the failure the progress union exists to make impossible, and it is worth
  // asserting on the rendered page as well as in the type, because the type
  // only binds code that was written after the split.
  expect(text).not.toContain('Round ');
  expect(text).not.toMatch(/\bof 12 rounds\b/);
});

test('the contribution counters split pending from assessed-and-not-included', async ({ page }) => {
  await stubCampaignService(page, { record: stubAsyncRecord() });
  await page.goto(`/#/campaigns/${ASYNC_CAMPAIGN_ID}/progress`);
  await waitForLoaded(page);

  const text = await regionText(page);
  // Seven contributions: four folded in, two assessed and left out, one that
  // arrived after the last merge and has not been looked at.
  expect(text).toContain('1 waiting for the next merge');
  expect(text).toContain('4 assessed and not included');
});

/**
 * The wording of the excluded state, asserted as wording.
 *
 * Every other test in this file would still pass if "not included" were
 * rendered as "rejected" in red with a cross. That is the version of this
 * feature that does real harm, because a contributor reads the colour before
 * the caption, and it is invisible to any assertion about counts.
 */
test('a contribution that was not taken is never rendered as a failure', async ({ page }) => {
  await stubCampaignService(page, { record: stubAsyncRecord() });
  await page.goto(`/#/campaigns/${ASYNC_CAMPAIGN_ID}/progress`);
  await waitForLoaded(page);

  const text = await regionText(page);
  expect(text).toContain('Assessed by a merge, not included in it');
  expect(text).toContain('not a mark against the contribution or the data behind it');

  for (const word of ['rejected', 'Rejected', 'failed', 'Failed', 'refused', 'worse']) {
    expect(text, `the excluded state was described as "${word}"`).not.toContain(word);
  }
});

test('the excluded dot is neutral, not a warning colour', async ({ page }) => {
  await stubCampaignService(page, { record: stubAsyncRecord() });
  await page.goto(`/#/campaigns/${ASYNC_CAMPAIGN_ID}/progress`);
  await waitForLoaded(page);

  // Grey. Asserted on the fill itself rather than on a class name, because the
  // class name is not what a reader sees and a palette change that swapped the
  // colour under the same class would pass a class assertion.
  const fills = await page.evaluate(() =>
    Array.from(document.querySelectorAll('circle[data-state="excluded"]')).map((c) =>
      (c as SVGElement).getAttribute('fill')
    )
  );
  expect(fills.length).toBeGreaterThan(0);
  for (const fill of fills) {
    expect(fill).toBe('#9ca3af');
  }
});

/**
 * No per-contributor exclusion count, anywhere.
 *
 * A count of how often each contributor was not taken is a leaderboard of
 * whose data is hardest with the ranking implied instead of stated. The
 * campaign-wide total is published and the breakdown is not, and the only way
 * to hold that line is to assert the breakdown's absence, since it is the kind
 * of thing that gets added later as an obvious convenience.
 */
test('no per-contributor exclusion breakdown is published', async ({ page }) => {
  await stubCampaignService(page, { record: stubAsyncRecord() });
  await page.goto(`/#/campaigns/${ASYNC_CAMPAIGN_ID}/progress`);
  await waitForLoaded(page);

  const text = await regionText(page);
  // Alpha has one exclusion and Beta has one; a per-contributor column would
  // put a count next to each name. None of these phrasings may appear.
  for (const phrase of [
    'Not included',
    'not taken',
    'Exclusions',
    'excluded contributions',
    'acceptance rate',
  ]) {
    expect(text, `a per-contributor breakdown appeared as "${phrase}"`).not.toContain(phrase);
  }

  // And there is no table column for it either. The roster is a table, so a
  // header assertion is the specific thing that would catch this.
  const headers = await page.evaluate(() =>
    Array.from(document.querySelectorAll('th')).map((h) => (h as HTMLElement).innerText.trim())
  );
  for (const header of headers) {
    expect(header.toLowerCase()).not.toContain('excluded');
    expect(header.toLowerCase()).not.toContain('rejected');
  }
});

/**
 * The improvement curve plots the witness split and not the gate.
 *
 * Both scores are in the stub and both rise. The chart's accessible label
 * carries the metric name, which is what makes this checkable without reading
 * pixels.
 */
test('the improvement curve is drawn from the witness metric, never the selection metric', async ({
  page,
}) => {
  await stubCampaignService(page, { record: stubAsyncRecord() });
  await page.goto(`/#/campaigns/${ASYNC_CAMPAIGN_ID}/progress`);
  await waitForLoaded(page);

  const chart = page.locator('svg[aria-label*="community version"]');
  await expect(chart).toHaveCount(1);
  await expect(chart).toHaveAttribute('aria-label', /validation F1 \(witness split\)/);
  await expect(chart).not.toHaveAttribute('aria-label', /AP50/);

  const text = await regionText(page);
  // The gate is NAMED, because a reader told that some contributions were not
  // taken is entitled to know what the criterion was...
  expect(text).toContain('pooled AP50 on the selection split');
  // ...and it is named in the sentence that says it is not what is plotted.
  expect(text).toContain('It is not the');
  expect(text).toContain('cannot show whether the model improved');

  // None of the gate's values reach the page. Naming a metric is publication of
  // a criterion; rendering its series is publication of a result, and this is
  // the one series on the page that would be circular.
  for (const value of ['0.629', '0.647', '0.6293', '0.6466']) {
    expect(text, `a selection-metric value ${value} was rendered`).not.toContain(value);
  }
});

test('the gate score does not appear as a lineage column', async ({ page }) => {
  await stubCampaignService(page, { record: stubAsyncRecord() });
  await page.goto(`/#/campaigns/${ASYNC_CAMPAIGN_ID}/progress`);
  await waitForLoaded(page);

  // A column read top to bottom IS a series, whatever it is called, so the
  // no-series rule rules out the column as well as the chart.
  const headers = await page.evaluate(() =>
    Array.from(document.querySelectorAll('th')).map((h) => (h as HTMLElement).innerText.trim())
  );
  for (const header of headers) {
    expect(header.toLowerCase()).not.toContain('ap50');
    expect(header.toLowerCase()).not.toContain('selection');
    expect(header.toLowerCase()).not.toContain('gate');
  }
});

test('the lineage says how many contributions a merge assessed, not just how many it kept', async ({
  page,
}) => {
  await stubCampaignService(page, { record: stubAsyncRecord() });
  await page.goto(`/#/campaigns/${ASYNC_CAMPAIGN_ID}/progress`);
  await waitForLoaded(page);

  const text = await regionText(page);
  // The column header is uppercased in CSS, so innerText reads "FOLDED IN".
  expect(text.toLowerCase()).toContain('folded in');
  // Both merges kept two of the three they looked at. Without the denominator
  // the table reads as though two arrived and two were taken.
  expect(text).toContain('of 3 assessed');
  expect(text).toContain('v1');
  expect(text).toContain('v2');
});

/**
 * A merge that did not publish an assessed count renders without a denominator
 * rather than inventing one.
 *
 * `assessed: null` is a producer that does not record the selection, which is
 * a different campaign from one that assessed exactly what it kept. Falling
 * back to `contributions.length` would render "2 of 2 assessed" and assert that
 * the merge took everything, which is the one thing the record does not say.
 */
test('a merge with no assessed list shows no denominator', async ({ page }) => {
  const soups = stubSoups().map((soup) => ({ ...soup, assessed: null }));
  await stubCampaignService(page, { record: stubAsyncRecord({ soups }) });
  await page.goto(`/#/campaigns/${ASYNC_CAMPAIGN_ID}/progress`);
  await waitForLoaded(page);

  // Scoped to the lineage table, not the whole region. The campaign-wide
  // "2 assessed and not included" tile is still correct and still rendered
  // here: what this test is about is the DENOMINATOR next to a merge, and a
  // region-wide search for the word would fail on the tile instead.
  const table = await page.evaluate(() => {
    const heads = Array.from(document.querySelectorAll('th')).map((h) =>
      (h as HTMLElement).innerText.trim().toLowerCase()
    );
    if (!heads.includes('folded in')) return null;
    const el = Array.from(document.querySelectorAll('table')).find((t) =>
      Array.from(t.querySelectorAll('th')).some(
        (h) => (h as HTMLElement).innerText.trim().toLowerCase() === 'folded in'
      )
    );
    return el ? (el as HTMLElement).innerText.replace(/\s+/g, ' ').trim() : null;
  });

  expect(table).not.toBeNull();
  // The counts a merge DID fold in are still published. What is absent is the
  // "of N assessed" it would take a record that states the selection to say.
  expect(table).toContain('v1');
  expect(table).toContain('v2');
  expect(table).not.toContain('assessed');
});

test('a scheduled trigger gives a date and says what it covers', async ({ page }) => {
  await stubCampaignService(page, { record: stubAsyncRecord() });
  await page.goto(`/#/campaigns/${ASYNC_CAMPAIGN_ID}/progress`);
  await waitForLoaded(page);

  const text = await regionText(page);
  expect(text).toContain('The next merge is scheduled for');
  // "assessed for it" and not "in it": under a greedy gate, arriving before the
  // merge is not the same as being in the version it publishes.
  expect(text).toContain('is assessed for it');
  expect(text).not.toContain('then is in it');
});

test('a manual trigger predicts nothing', async ({ page }) => {
  await stubCampaignService(page, {
    record: stubAsyncRecord({
      merge_trigger: { kind: 'manual', next_merge_at: null, contributions_per_merge: null },
    }),
  });
  await page.goto(`/#/campaigns/${ASYNC_CAMPAIGN_ID}/progress`);
  await waitForLoaded(page);

  const text = await regionText(page);
  expect(text).toContain('run by the campaign stewards');
  expect(text).toContain('no next date to show');
  expect(text).not.toContain('scheduled for');
});

/**
 * An on-contributions trigger shows the threshold and stops short of a time.
 *
 * The countdown is the tempting version and it is a prediction: when N is
 * reached depends on when volunteers finish runs on hardware nobody here
 * controls. A predicted merge time that slips is worse than no prediction on a
 * page whose whole claim is that its numbers are observations.
 */
test('an on-contributions trigger names the threshold and gives no date', async ({ page }) => {
  await stubCampaignService(page, {
    record: stubAsyncRecord({
      merge_trigger: { kind: 'on_contributions', next_merge_at: null, contributions_per_merge: 5 },
    }),
  });
  await page.goto(`/#/campaigns/${ASYNC_CAMPAIGN_ID}/progress`);
  await waitForLoaded(page);

  const text = await regionText(page);
  expect(text).toContain('A merge runs every 5 contributions');
  expect(text).toContain('there is no date to give');
  expect(text).not.toContain('scheduled for');
});

/**
 * A trigger the service did not state predicts nothing either.
 *
 * `merge_trigger: null` is the ordinary case for a campaign whose steward has
 * not configured one, and the page must render the stream without any of the
 * three trigger sentences rather than defaulting to the friendliest of them.
 */
test('an unstated merge trigger produces no prediction of any kind', async ({ page }) => {
  await stubCampaignService(page, { record: stubAsyncRecord({ merge_trigger: null }) });
  await page.goto(`/#/campaigns/${ASYNC_CAMPAIGN_ID}/progress`);
  await waitForLoaded(page);

  const text = await regionText(page);
  expect(text).toContain('Contributions and merges');
  expect(text).not.toContain('scheduled for');
  expect(text).not.toContain('A merge runs every');
  expect(text).not.toContain('run by the campaign stewards');
});

/**
 * The nouns follow the mode.
 *
 * A contributor trains when it suits them and owes nobody a schedule. Calling
 * them a site imports an obligation the campaign never asked for, and it is
 * exactly the sort of wrong nobody files a bug about.
 */
test('an async campaign calls its participants contributors and its steps merges', async ({
  page,
}) => {
  await stubCampaignService(page, { record: stubAsyncRecord() });
  await page.goto(`/#/campaigns/${ASYNC_CAMPAIGN_ID}/progress`);
  await waitForLoaded(page);

  const text = await regionText(page);
  expect(text).toContain('left the participating contributors');
  expect(text).not.toContain('left the participating sites');
  expect(text).not.toContain('per site per round');
});

test('a synchronous campaign still calls its participants sites', async ({ page }) => {
  await stubCampaignService(page);
  await page.goto(`/#/campaigns/${CAMPAIGN_ID}/progress`);
  await waitForLoaded(page);

  const text = await regionText(page);
  expect(text).toContain('left the participating sites');
  expect(text).not.toContain('left the participating contributors');
});

/**
 * The index renders an async campaign without inventing a round number.
 *
 * The summary used to carry a bare `round: {current, total}`, which an async
 * campaign has no honest value for: sending nulls would have rendered every
 * async campaign as a synchronous one with missing telemetry, which is a
 * stronger and wronger claim than saying nothing.
 */
test('the campaign index shows contributions and versions for an async campaign', async ({
  page,
}) => {
  await stubCampaignService(page, { record: stubAsyncRecord() });
  await page.goto('/#/campaigns');
  await waitForLoaded(page);

  const text = await regionText(page);
  expect(text).toContain('Stub community model soup');
  expect(text).not.toMatch(/Round \d/);
  expect(text).not.toContain('of 12');
});

/**
 * Two numbers, never their quotient, on the async arm too.
 *
 * The no-ratio rule was written against the synchronous page. Under full-weight
 * souping it matters more rather than less: bytes moved accumulates with every
 * contribution and the data held does not, so the quotient is a function of how
 * long the campaign has run and changes sign partway through a long one.
 */
test('no saving ratio is rendered on an async campaign', async ({ page }) => {
  await stubCampaignService(page, { record: stubAsyncRecord() });
  await page.goto(`/#/campaigns/${ASYNC_CAMPAIGN_ID}/progress`);
  await waitForLoaded(page);

  const text = await regionText(page);
  for (const phrase of [
    'saving',
    'savings',
    'times less',
    'times smaller',
    'reduction',
    '% of the data',
    'x less',
  ]) {
    expect(text, `a saving ratio was rendered as "${phrase}"`).not.toContain(phrase);
  }
  expect(text).not.toMatch(/\d+\s*(?:x|×)\s*(?:less|smaller|fewer)/i);
});

/**
 * A merge that published nothing is still drawn.
 *
 * The defect this guards is a chart that takes its merge markers from `soups`.
 * Under greedy souping a merge can weigh a pool and keep none of it, and the
 * backend records that with no soup and no version, so a soups-only chart shows
 * the contributions it greyed out sitting in a stretch of timeline with no merge
 * anywhere in it, under a legend that says a merge assessed them. The chart
 * contradicts its own key and a reader resolves it by blaming the next visible
 * merge, which is the wrong one.
 *
 * Asserted on the marker count rather than on any caption, because the caption
 * is the thing a well-meaning edit deletes and the marker is the claim.
 */
test('a merge that published no version is drawn on the stream', async ({ page }) => {
  await stubCampaignService(page, { record: stubAsyncRecord() });
  await page.goto(`/#/campaigns/${ASYNC_CAMPAIGN_ID}/progress`);
  await waitForLoaded(page);

  const published = page.locator('svg g[data-merge-kind="published"]');
  const empty = page.locator('svg g[data-merge-kind="empty"]');
  await expect(published).toHaveCount(2);
  await expect(empty).toHaveCount(2);
});

/**
 * And drawn DIFFERENTLY, which is the other half of the same claim.
 *
 * A marker that looked like a version marker would say a version was published,
 * so the stroke has to differ and not only the element. Asserted on the computed
 * stroke rather than on a class name, because the class is not what a reader
 * sees.
 */
test('an empty merge marker is visually distinct from a published one', async ({ page }) => {
  await stubCampaignService(page, { record: stubAsyncRecord() });
  await page.goto(`/#/campaigns/${ASYNC_CAMPAIGN_ID}/progress`);
  await waitForLoaded(page);

  const strokes = await page.evaluate(() => {
    const read = (kind: string) => {
      const line = document.querySelector(`svg g[data-merge-kind="${kind}"] line`);
      return line
        ? {
            stroke: line.getAttribute('stroke'),
            dash: line.getAttribute('stroke-dasharray'),
          }
        : null;
    };
    return { published: read('published'), empty: read('empty') };
  });
  expect(strokes.published).not.toBeNull();
  expect(strokes.empty).not.toBeNull();
  expect(strokes.empty!.stroke).not.toBe(strokes.published!.stroke);
  // Dashed, and the published marker is not. Two channels rather than one, so
  // the distinction survives a reader who cannot separate the two colours.
  expect(strokes.empty!.dash).toBeTruthy();
  expect(strokes.published!.dash).toBeFalsy();
});

/**
 * An empty merge publishes no version, so it must not reach the lineage table
 * or the improvement curve.
 *
 * The table is a table of VERSIONS. A row with no version in it would be the
 * page inventing a release, and a point on the curve with no checkpoint behind
 * it would be a score attributed to a model that was never published.
 */
test('an empty merge adds no row to the lineage and no point to the curve', async ({ page }) => {
  await stubCampaignService(page, { record: stubAsyncRecord() });
  await page.goto(`/#/campaigns/${ASYNC_CAMPAIGN_ID}/progress`);
  await waitForLoaded(page);

  const lineageRows = await page.evaluate(() => {
    const tables = Array.from(document.querySelectorAll('table'));
    const table = tables.find((t) =>
      Array.from(t.querySelectorAll('th')).some((th) =>
        (th.textContent ?? '').toLowerCase().includes('folded in')
      )
    );
    return table ? table.querySelectorAll('tbody tr').length : -1;
  });
  // Two soups, two rows. Not four.
  expect(lineageRows).toBe(2);

  const points = await page.locator('svg circle[data-version]').count();
  expect(points).toBe(2);
});

/**
 * The legend entry is conditional, on the same rule as the dot states.
 *
 * A legend that explains a marker the reader cannot see on the chart tells them
 * something happened that did not, which on this particular marker would mean
 * reporting a merge that declined contributions when none ever did.
 */
test('the empty merge legend appears only when an empty merge is on the chart', async ({
  page,
}) => {
  await stubCampaignService(page, { record: stubAsyncRecord({ empty_merges: [] }) });
  await page.goto(`/#/campaigns/${ASYNC_CAMPAIGN_ID}/progress`);
  await waitForLoaded(page);

  const text = await regionText(page);
  expect(text).toContain('Merge that published a version');
  expect(text).not.toContain('Merge that published no new version');
  expect(text).not.toContain('published no new version. That happens when');
  await expect(page.locator('svg g[data-merge-kind="empty"]')).toHaveCount(0);
});

/**
 * A campaign that does not report empty merges says so.
 *
 * Null is not zero. Without this the page shows a complete-looking set of merge
 * markers for a campaign whose service simply never sent the other kind, and
 * every gap between markers reads as a quiet stretch rather than as a stretch
 * the page cannot see into.
 */
test('an unreported empty-merge list is disclosed rather than read as none', async ({ page }) => {
  await stubCampaignService(page, { record: stubAsyncRecord({ empty_merges: null }) });
  await page.goto(`/#/campaigns/${ASYNC_CAMPAIGN_ID}/progress`);
  await waitForLoaded(page);

  const text = await regionText(page);
  expect(text).toContain('Only merges that published a version are marked');
  expect(text).toContain('not drawn');
  // And no claim about a count it does not have.
  expect(text).not.toContain('merges published no new version');
});

/**
 * The empty-merge caption must not turn into a fault report.
 *
 * A merge that weighed contributions and kept none is the community model
 * already being at least as good as anything on offer. The standing rule is that
 * "evaluated, not included" is never a failure and never a ranking, and it binds
 * the merge-level phrasing exactly as it binds the contribution-level one.
 */
test('the empty merge caption states no failure and names no contributor', async ({ page }) => {
  await stubCampaignService(page, { record: stubAsyncRecord() });
  await page.goto(`/#/campaigns/${ASYNC_CAMPAIGN_ID}/progress`);
  await waitForLoaded(page);

  const text = await regionText(page);
  expect(text).toContain('2 merges published no new version');
  for (const phrase of [
    'failed',
    'failure',
    'rejected',
    'wasted',
    'unsuccessful',
    'poor',
    'not good enough',
  ]) {
    expect(text, `the empty-merge copy read as a fault: "${phrase}"`).not.toContain(phrase);
  }
  // The contributors whose work that merge declined are not named next to it.
  const caption = text.slice(text.indexOf('2 merges published no new version'));
  expect(caption).not.toContain('Stub Beta');
  expect(caption).not.toContain('Stub Gamma');
});

/**
 * The campaign-wide "assessed and not included" total counts exclusions from a
 * merge that published nothing, exactly as live-kudu specified.
 *
 * This is the seam where the two records meet: those contributions have no
 * `merged_into` and belong to no soup, so a page that derived the total by
 * walking `soups` would silently drop them and report a more selective-looking
 * campaign than the one that ran.
 */
test('exclusions from an empty merge still reach the campaign-wide total', async ({ page }) => {
  await stubCampaignService(page, { record: stubAsyncRecord() });
  await page.goto(`/#/campaigns/${ASYNC_CAMPAIGN_ID}/progress`);
  await waitForLoaded(page);

  const text = await regionText(page);
  // c3 and c5 were declined by merges that published; c8 and c9 by one that did
  // not. All four are in the total.
  expect(text).toContain('4 assessed and not included');
  // Still no per-contributor breakdown of any of them.
  expect(text).not.toMatch(/Stub (Alpha|Beta|Gamma)[^.]{0,40}(excluded|not included|assessed)/i);
});

/*
 * ICON GUARDS.
 *
 * Every other honesty guard on this page reads TEXT: `regionText` returns
 * `innerText`, so a claim made in words is catchable and a claim made in a
 * glyph is not. The render keeps an icon's PATHS and forgets its NAME, so a
 * padlock asserting protection is, to a text guard, a handful of bezier
 * coordinates. calm-elan hit exactly this on the paper figures: a lock glyph
 * walked through a guard built to reject the word "privacy".
 *
 * That blind spot was live here. The payload pill on the campaign detail page
 * was drawn with a shield-check in emerald beside "Only model weights leave
 * each site", which is the privacy claim this page bans in words, made in
 * iconography instead. Weight averaging is not a confidentiality mechanism and
 * the pitch is deliberately data gravity, not privacy. See the note in
 * CampaignList.
 *
 * The fix has to be at DRAW time, because nothing downstream can recover a name
 * the render discarded. Every `<svg>` under `src/components/campaigns/` carries
 * `data-icon`, and these guards read those names.
 */

/** Glyph names rendered in the campaign region, plus a count of unnamed ones. */
async function campaignGlyphs(page: Page): Promise<{ named: string[]; unnamed: number }> {
  return page.evaluate(() => {
    const region = document.querySelector('div.mx-auto.max-w-6xl, div.mx-auto.max-w-5xl');
    const svgs = Array.from(region ? region.querySelectorAll('svg') : []);
    const named: string[] = [];
    let unnamed = 0;
    for (const svg of svgs) {
      const name = svg.getAttribute('data-icon');
      if (name === null || name.trim() === '') unnamed += 1;
      else named.push(name.trim().toLowerCase());
    }
    return { named, unnamed };
  });
}

/**
 * Glyph families that assert protection, secrecy, or a safety verdict.
 *
 * Deliberately broader than the word list the text guards use. A text guard can
 * afford to be precise because prose says what it means; an icon is read as a
 * gestalt, so anything in the padlock-shield-verified family carries the claim
 * whatever the designer called the file.
 */
const BANNED_GLYPHS = [
  'lock',
  'padlock',
  'unlock',
  'shield',
  'secure',
  'security',
  'privacy',
  'private',
  'key',
  'vault',
  'safe',
  'guard',
  'fingerprint',
  'badge-check',
  'verified',
  'certificate',
];

/** The predicate both the guard and its mutation test run, so they cannot drift. */
function bannedGlyphsIn(names: string[]): string[] {
  return names.filter((name) => BANNED_GLYPHS.some((banned) => name.includes(banned)));
}

const GLYPH_ROUTES = [
  { path: `/#/campaigns`, label: 'index' },
  { path: `/#/campaigns/${CAMPAIGN_ID}`, label: 'synchronous detail' },
  { path: `/#/campaigns/${CAMPAIGN_ID}/progress`, label: 'synchronous progress' },
  { path: `/#/campaigns/${ASYNC_CAMPAIGN_ID}`, label: 'asynchronous detail' },
  { path: `/#/campaigns/${ASYNC_CAMPAIGN_ID}/progress`, label: 'asynchronous progress' },
];

test('no glyph on any campaign route asserts protection or secrecy', async ({ page }) => {
  await stubCampaignService(page, { record: stubRecord() });
  for (const route of GLYPH_ROUTES) {
    await page.goto(route.path);
    await waitForLoaded(page);
    const { named } = await campaignGlyphs(page);
    const offending = bannedGlyphsIn(named);
    expect(
      offending,
      `${route.label} renders a glyph making a protection claim: ${offending.join(', ')}`
    ).toEqual([]);
  }
});

test('the async campaign routes are covered by the same glyph rule', async ({ page }) => {
  // Stubbed separately because the async record is what drives the soup
  // lineage, the contribution stream and the payload pill, and the pill is
  // where the shield actually was.
  await stubCampaignService(page, { record: stubAsyncRecord() });
  for (const path of [`/#/campaigns/${ASYNC_CAMPAIGN_ID}`, `/#/campaigns/${ASYNC_CAMPAIGN_ID}/progress`]) {
    await page.goto(path);
    await waitForLoaded(page);
    const { named } = await campaignGlyphs(page);
    expect(bannedGlyphsIn(named), `${path} renders a protection glyph`).toEqual([]);
  }
});

/**
 * The omission hole, closed.
 *
 * A name-based guard is only as good as the naming discipline, and the natural
 * way to defeat it is not to rename a padlock but to add one with no name at
 * all. An unnamed glyph is indistinguishable from an absent one to every check
 * above, so the absence of names is itself the failure.
 */
test('every campaign glyph carries a name, so none can hide from the guard', async ({ page }) => {
  await stubCampaignService(page, { record: stubAsyncRecord() });
  for (const path of [`/#/campaigns/${ASYNC_CAMPAIGN_ID}`, `/#/campaigns/${ASYNC_CAMPAIGN_ID}/progress`]) {
    await page.goto(path);
    await waitForLoaded(page);
    const { named, unnamed } = await campaignGlyphs(page);
    expect(unnamed, `${path} renders ${unnamed} glyph(s) with no data-icon`).toBe(0);
    // And the guard is actually looking at something, rather than passing
    // because the page drew no icons at all.
    expect(named.length).toBeGreaterThan(0);
  }
});

/**
 * MUTATION TEST. A guard that passes on good input has not been shown to fail
 * on bad input.
 *
 * This drops a padlock into the live DOM and asserts the guard catches it,
 * through the same collection helper and the same predicate the real tests use.
 * Without this, every assertion above would keep passing if `campaignGlyphs`
 * silently returned an empty array.
 */
test('the glyph guard fails when a padlock is deliberately planted', async ({ page }) => {
  await stubCampaignService(page, { record: stubAsyncRecord() });
  await page.goto(`/#/campaigns/${ASYNC_CAMPAIGN_ID}`);
  await waitForLoaded(page);

  const clean = bannedGlyphsIn((await campaignGlyphs(page)).named);
  expect(clean, 'the page was already dirty, so this test proves nothing').toEqual([]);

  await page.evaluate(() => {
    const region = document.querySelector('div.mx-auto.max-w-6xl, div.mx-auto.max-w-5xl');
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('data-icon', 'lock-closed');
    svg.setAttribute('viewBox', '0 0 24 24');
    region?.appendChild(svg);
  });

  const dirty = bannedGlyphsIn((await campaignGlyphs(page)).named);
  expect(dirty, 'a planted padlock walked through the glyph guard').toEqual(['lock-closed']);
});

/**
 * The same mutation, against the unnamed-glyph rule.
 *
 * Proves the omission check fires rather than merely counting zero forever.
 */
test('the naming rule fails when an unnamed glyph is planted', async ({ page }) => {
  await stubCampaignService(page, { record: stubAsyncRecord() });
  await page.goto(`/#/campaigns/${ASYNC_CAMPAIGN_ID}`);
  await waitForLoaded(page);

  expect((await campaignGlyphs(page)).unnamed).toBe(0);

  await page.evaluate(() => {
    const region = document.querySelector('div.mx-auto.max-w-6xl, div.mx-auto.max-w-5xl');
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('viewBox', '0 0 24 24');
    region?.appendChild(svg);
  });

  expect(
    (await campaignGlyphs(page)).unnamed,
    'an unnamed glyph was not counted, so the omission hole is open'
  ).toBe(1);
});

/**
 * The no-ratio rule, extended past text.
 *
 * cool-ruff's point (2): the two transport numbers must never become a quotient
 * in ANY form, and a badge or glyph is a form. A "12x" pill would carry the
 * saving claim with no matching text, so the text guard at the top of this file
 * would pass it.
 */
test('no glyph or badge renders the transport figures as a ratio', async ({ page }) => {
  await stubCampaignService(page, { record: stubAsyncRecord() });
  await page.goto(`/#/campaigns/${ASYNC_CAMPAIGN_ID}/progress`);
  await waitForLoaded(page);

  const { named } = await campaignGlyphs(page);
  for (const name of named) {
    expect(name, `glyph "${name}" names a ratio`).not.toMatch(
      /ratio|saving|multiple|fold|times|quotient|percent/
    );
  }

  // Nor as an image, which is the other way a rendered number escapes innerText.
  const images = await page.evaluate(() => {
    const region = document.querySelector('div.mx-auto.max-w-6xl, div.mx-auto.max-w-5xl');
    return Array.from(region ? region.querySelectorAll('img') : []).map(
      (img) => `${img.getAttribute('src') ?? ''} ${img.getAttribute('alt') ?? ''}`
    );
  });
  for (const image of images) {
    expect(image, `an image carries saving framing: ${image}`).not.toMatch(
      /ratio|saving|times.less|x.less/i
    );
  }
});

/**
 * The lineage table names its metric, and never calls it "Score".
 *
 * `RoundMetric.name` has said "never abbreviated to 'score' by the page" since
 * the field existed, and this column was the last place breaking it. The cost
 * is specific rather than stylistic: the record carries a witness metric and a
 * gate metric, and a column headed "Score" beside a column of version numbers
 * says nothing about which split produced it. The chart above names its metric
 * in the caption; a reader who scrolls past that caption to the table had
 * nothing. The circular reading, that these are the numbers the merge selected
 * on, is the one that needs no extra assumption, so an unlabelled column
 * defaults to exactly the reading the witness/selection split exists to prevent.
 */
test('the lineage table heads its metric column with the metric name', async ({ page }) => {
  await stubCampaignService(page, { record: stubAsyncRecord() });
  await page.goto(`/#/campaigns/${ASYNC_CAMPAIGN_ID}/progress`);
  await waitForLoaded(page);

  const heads = await page.evaluate(() =>
    Array.from(document.querySelectorAll('th')).map((th) =>
      (th as HTMLElement).innerText.trim().toLowerCase()
    )
  );
  expect(heads, 'the metric column is headed with the bare word "score"').not.toContain('score');
  // And it is headed with the name the record supplied, so the column is not
  // merely renamed to something else equally uninformative.
  expect(heads.some((h) => h.includes('witness'))).toBe(true);
});

// ---------------------------------------------------------------------------
// The baseline reference level (0.11.0-draft).
//
// The lineage curve on its own answers a question nobody asked. A greedy gate
// admits a contribution only when the pooled model improves, so successive
// versions rising past each other is the selection rule working, and it is
// true of any campaign that ran the rule correctly. What a reader outside the
// campaign wants to know is whether the community model beat the published
// model they already have, and that comparison needs a second number the curve
// does not contain.
//
// `progress.baseline_metric` carries it. Every test below is about the same
// distinction: the baseline is a LEVEL the versions are read against, and the
// moment it becomes a point on the curve the page has asserted that the base
// model is a community version this campaign produced.
// ---------------------------------------------------------------------------

/** The base model on the same split, below every version the campaign published. */
function stubBaseline(over: Record<string, unknown> = {}): Record<string, unknown> {
  // Built from stubWitness so the name, the basis and the scope match the
  // soups' metrics by construction rather than by two literals being kept in
  // step by hand. The comparability rule under test is exactly that they match,
  // so a copy-pasted second literal would be the thing most likely to drift.
  return { ...stubWitness(0.6891, 3), ...over };
}

/** The named base model, so the reference level has something to be a level of. */
const STUB_BASE_MODEL = {
  id: 'stub-workspace/stub-base-model',
  name: 'Stub base model',
  url: null,
};

test('the base model is drawn as a reference level and adds no point to the curve', async ({
  page,
}) => {
  await stubCampaignService(page, {
    record: stubAsyncRecord({ baseline_metric: stubBaseline() }, { base_model: STUB_BASE_MODEL }),
  });
  await page.goto(`/#/campaigns/${ASYNC_CAMPAIGN_ID}/progress`);
  await waitForLoaded(page);

  await expect(page.locator('svg g[data-baseline]')).toHaveCount(1);

  // The whole point. Two soups, two points, still two with a baseline present.
  // A third point here would be a version on the axis that the campaign never
  // published and nobody can download.
  expect(await page.locator('svg circle[data-version]').count()).toBe(2);

  // And no row either. The lineage table is a list of published checkpoints.
  const lineageRows = await page.evaluate(() => {
    const table = Array.from(document.querySelectorAll('table')).find((t) =>
      Array.from(t.querySelectorAll('th')).some((th) =>
        (th.textContent ?? '').toLowerCase().includes('folded in')
      )
    );
    return table ? table.querySelectorAll('tbody tr').length : -1;
  });
  expect(lineageRows).toBe(2);

  // The level says what it is a level OF. An unlabelled dashed line is a line
  // the reader has to guess the meaning of, and the available guess is wrong.
  const text = await regionText(page);
  expect(text).toContain('Stub base model');
  expect(text).toContain('scored the same way before the first merge');
  expect(text).toContain('not one of them');
});

test('the baseline value is rendered, so the comparison can actually be made', async ({ page }) => {
  await stubCampaignService(page, {
    record: stubAsyncRecord({ baseline_metric: stubBaseline() }),
  });
  await page.goto(`/#/campaigns/${ASYNC_CAMPAIGN_ID}/progress`);
  await waitForLoaded(page);

  // A line at an unstated height is a picture of a comparison rather than the
  // comparison. The version figures are on the page in this form already, so
  // withholding only the one they are measured against would be the odd choice.
  const svgText = await page.evaluate(() => {
    const g = document.querySelector('svg g[data-baseline]');
    return g ? (g.textContent ?? '') : '';
  });
  expect(svgText).toContain('0.689');

  // This stub reports no base model, so the level falls back to a generic
  // label. It does NOT fall back to a name, which is the mistake this page
  // made once before: a null `base_model` was rendered as "Trained from
  // scratch", a claim the record never made.
  expect(svgText).toContain('Base model');
});

test('a baseline measured under a different name is not drawn across the curve', async ({
  page,
}) => {
  await stubCampaignService(page, {
    record: stubAsyncRecord({
      baseline_metric: stubBaseline({ name: 'some other validation score' }),
    }),
  });
  await page.goto(`/#/campaigns/${ASYNC_CAMPAIGN_ID}/progress`);
  await waitForLoaded(page);

  // A line drawn across a curve asserts the two are the same measurement. Two
  // scores under different names may sit at the same height and mean different
  // things, and the reader has no way to tell from the picture.
  await expect(page.locator('svg g[data-baseline]')).toHaveCount(0);

  // Not silently. An absent reference level and one this page declined to draw
  // look identical, and only one of them is the campaign's doing.
  const text = await regionText(page);
  expect(text).toContain('measured differently from the versions above');
  // The rejected figure does not leak in as a number somewhere else.
  expect(text).not.toContain('0.689');
});

test('a baseline on a different scope is not drawn either', async ({ page }) => {
  await stubCampaignService(page, {
    record: stubAsyncRecord({
      // Same metric name, same split name, measured on the campaign's own
      // holdout while the versions are pooled over participants. This is the
      // harder half of comparability and the one a name check alone misses:
      // everything the reader can see about the two figures agrees.
      baseline_metric: stubBaseline({ aggregate_scope: 'campaign_holdout', n_sites_scored: null }),
    }),
  });
  await page.goto(`/#/campaigns/${ASYNC_CAMPAIGN_ID}/progress`);
  await waitForLoaded(page);

  await expect(page.locator('svg g[data-baseline]')).toHaveCount(0);
  expect(await regionText(page)).toContain('measured differently from the versions above');
});

test('a baseline the page refuses is reported, not silently dropped', async ({ page }) => {
  await stubCampaignService(page, {
    record: stubAsyncRecord({
      // Comparable, and unrenderable for the ordinary reason: a figure with no
      // count of what it is a mean over. The baseline goes through the same
      // disposition function as every version, so it fails the same way.
      baseline_metric: stubBaseline({ n_sites_scored: null }),
    }),
  });
  await page.goto(`/#/campaigns/${ASYNC_CAMPAIGN_ID}/progress`);
  await waitForLoaded(page);

  await expect(page.locator('svg g[data-baseline]')).toHaveCount(0);
  const text = await regionText(page);
  expect(text).toContain('will not render');
  expect(text).not.toContain('measured differently from the versions above');
});

test('a campaign with no baseline draws no reference level and says nothing about one', async ({
  page,
}) => {
  // The control. Without it every negative case above would also pass on a
  // page that had never implemented the baseline at all.
  await stubCampaignService(page, { record: stubAsyncRecord() });
  await page.goto(`/#/campaigns/${ASYNC_CAMPAIGN_ID}/progress`);
  await waitForLoaded(page);

  await expect(page.locator('svg g[data-baseline]')).toHaveCount(0);
  const text = await regionText(page);
  expect(text).not.toContain('scored the same way before the first merge');
  expect(text).not.toContain('measured differently from the versions above');
});
