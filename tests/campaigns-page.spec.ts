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

const SCHEMA_VERSION = '0.14.0-draft';
const CAMPAIGN_ID = 'stub-soup';
const STUB_DIGEST = 'a22dba37c1e04f9b';

// ---------------------------------------------------------------------------
// The campaign record: contributors, a contribution stream, and a soup lineage.
// Everything below is invented for this spec and shares nothing with the
// src/services/__fixtures__ corpus, on purpose. The fixtures exercise the page
// at a realistic size; these stubs are small enough that every assertion below
// can name the exact record it is about.
//
// THERE USED TO BE TWO RECORD BUILDERS. Through 0.13.0-draft the contract had a
// synchronous arm, so this file carried a sync builder with rounds and a site
// roster, and an async builder layered on top of it. The sync arm
// left the contract at 0.14.0-draft and the two builders folded into the one
// below. The split existed only to hold two arms apart and had no other job.
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
      // The bar nothing cleared (0.13.0-draft). Deliberately a value that
      // appears nowhere else in this file, so the never-rendered assertion
      // catches a leak by NUMBER and not only by the word "selection". It is
      // also set ABOVE every witness value in the stub, so a leak into the
      // lineage chart would be visibly wrong rather than plausible.
      selection_metric: {
        role: 'selection',
        aggregate_scope: 'campaign_holdout',
        name: 'pooled AP50 on the selection split',
        higher_is_better: true,
        per_site: null,
        per_site_basis: null,
        aggregate: 0.8137,
        aggregate_basis: 'the bar the assessed contributions did not clear',
        n_sites_scored: null,
        n_datasets_scored: null,
        aggregate_withheld: null,
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
      // The ordinary reporting gap: a merge declined everything and the service
      // did not publish what it was measuring against.
      selection_metric: null,
    },
  ];
}

/**
 * The campaign record.
 *
 * Shaped like the real pilot rather than like a design mockup: whole Cellpose-SAM
 * checkpoints instead of a LoRA adapter, image counts with no byte figure, and a
 * metric with a name of its own. If the page renders this one correctly it cannot
 * be hardcoding "adapter", "TB" or "score".
 *
 * Two argument objects because the interesting variation is almost all inside
 * `progress`, and a test that varies one merge should not have to restate the
 * campaign around it. `progressOverrides` is merged into the progress arm and
 * `overrides` into the record itself.
 */
function stubRecord(
  progressOverrides: Record<string, any> = {},
  overrides: Record<string, any> = {}
) {
  return {
    schema_version: SCHEMA_VERSION,
    campaign_id: CAMPAIGN_ID,
    title: 'Stub community model soup',
    description: 'A stub campaign that exists only inside this test.',
    status: 'running',
    policy: {
      public_data_campaign: true,
      // No per-deployment credential exists, so the roster carries its caveat.
      roster_attested: false,
      outcomes_released: true,
      // Two, so two is the only floor that admits a pooled figure at all.
      aggregate_min_scoring_sites: 2,
    },
    base_model: null,
    aggregation: { method: 'greedy soup', weighting: 'uniform' },
    licence_policy: { accepted_data_licences: ['CC0-1.0'], model_licence: 'MIT' },
    progress: {
      mode: 'asynchronous',
      started_at: '2026-08-01T00:00:00Z',
      contributions: stubContributions(),
      soups: stubSoups(),
      empty_merges: stubEmptyMerges(),
      contributors: stubContributors(),
      // Rule stated, ACTOR unstated, which is the shape most of these tests want:
      // it exercises the rule branches without a second sentence about who runs
      // the merges landing in every assertion on region text. The tests that care
      // about the actor state it themselves.
      merge_trigger: {
        kind: 'scheduled',
        decided_by: null,
        agent: null,
        next_merge_at: '2026-09-14T02:00:00Z',
        contributions_per_merge: null,
      },
      ...progressOverrides,
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
      label: 'Full Cellpose-SAM checkpoint',
      bytes_per_contribution: ASYNC_CHECKPOINT_BYTES,
    },
    stewards: [{ name: 'Stub steward', workspace: 'stub-workspace' }],
    published_model: null,
    generated_at: '2026-09-06T00:00:00Z',
    ...overrides,
  };
}

/**
 * The index summary, derived from the record rather than hand-written.
 *
 * Deriving it is what keeps a summary test from passing against a detail record
 * it contradicts.
 */
function stubSummary(record: Record<string, any>) {
  const progress = record.progress;
  return {
    campaign_id: record.campaign_id,
    title: record.title,
    description: record.description,
    status: record.status,
    base_model: record.base_model,
    progress: {
      mode: 'asynchronous',
      n_contributions: progress.contributions.length,
      n_versions: progress.soups.length,
    },
    n_active_sites: progress.contributors.length,
    payload: record.payload,
    model_licence: record.licence_policy.model_licence,
    started_at: progress.started_at,
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

  await expect(page.getByText('Stub community model soup')).toBeVisible();
  // Read from the record, never hardcoded.
  await expect(page.getByText('Full Cellpose-SAM checkpoint').first()).toBeVisible();
  await expect(page.getByText('1.30 GB per contribution')).toBeVisible();
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
    for (const figure of ['1.30 GB', '1,018', '62.1', '412', 'Full Cellpose-SAM checkpoint', 'a22dba37']) {
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
  await expect(page.getByText('Stub community model soup')).toBeVisible();
  await expect(page.locator('[data-testid="campaign-prototype-banner"]')).toHaveCount(0);
});

test('unreported values say so instead of showing a zero', async ({ page }) => {
  await stubCampaignService(page);
  await page.goto(`/#/campaigns/${CAMPAIGN_ID}`);

  await expect(page.getByText('Stub contributor Beta')).toBeVisible();
  // Beta reports no training-image count, which must read as an absence.
  await expect(page.getByText('Not published').first()).toBeVisible();
  // Alpha's count is real and must still be shown.
  await expect(page.getByText('412').first()).toBeVisible();
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

// THE LOST-ROUND TEST IS GONE, AND SO IS THE DISCLOSURE IT GUARDED. The round
// log numbered its rows, so a missing round 2 was visible as a hole in a
// sequence and the page could say a record had not arrived. Contributions and
// merges carry dates, not ordinals, and a gap in a date series is
// indistinguishable from a quiet fortnight. `reporting.dropped_reports` is
// still on the wire and still rendered as a count, which is the part that
// survives. Locating the gap is not recoverable on this arm and nothing here
// pretends otherwise.

// The per-site-curve note was drawn by the round chart, which plotted one line
// per site and therefore had to say something when it had none. The lineage
// plots one point per published version and never draws per-contributor lines
// at all, so it has no absent series to explain. The rule the test enforced,
// that an absence is not narrated as a decision, is carried by the four-actor
// split above.

// ---------------------------------------------------------------------------
// The v0.2.0 guarantees: observed against computed, the reconstruction hazard,
// digest provenance, and declared against measured.
// ---------------------------------------------------------------------------

test('an incomplete transport log withholds the total instead of undercounting', async ({
  page,
}) => {
  await stubCampaignService(page, {
    record: stubRecord({}, {
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
            { source: 'stub-alpha', first_seq: 0, last_seq: 203, n_transfers: 204 },
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
  expect(text).toContain('Only model weights left each contributor');
});

test('a computed total is labelled as computed rather than measured', async ({ page }) => {
  await stubCampaignService(page, {
    record: stubRecord({}, {
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

// ---------------------------------------------------------------------------
// The lineage disposition: why a published version is or is not on the curve.
//
// `aggregateDisposition()` survived the removal of the synchronous arm intact.
// Every soup carries a `witness_metric`, and SoupLineage runs the same function
// over it that RoundChart used to run over a round, so the logic is as covered
// as it ever was.
//
// What did NOT survive is the round chart's PROSE. That chart rendered its own
// sentence for each refusal cause, about fourteen of them. The lineage renders
// four, one per ACTOR, and names nothing finer than that outside the metric
// cell's hover text.
//
// So these tests assert what the page actually discriminates, which is the
// four-actor split. The cause-level cases moved to
// scripts/aggregate-disposition-check.js, which calls the function directly and
// can assert a `cause` code without a rendered sentence having to exist for it.
// Re-basing them here instead would have produced nine tests asserting one
// shared sentence: still running, no longer discriminating, which is worse than
// deleting them because it looks like coverage.
// ---------------------------------------------------------------------------

/**
 * A soup carrying whatever witness metric a disposition test needs.
 *
 * Built from the first real stub rather than from a literal, so a field added
 * to SoupRecord cannot be silently absent from every test below.
 */
function soupWith(
  metric: Record<string, unknown> | null,
  over: Record<string, unknown> = {}
): Record<string, unknown> {
  return { ...stubSoups()[0], witness_metric: metric, ...over };
}

/**
 * All four dispositions on one lineage.
 *
 * Asserted together rather than one at a time. Each sentence is plausible in
 * isolation, and the property that matters only exists BETWEEN them: that a
 * reader can tell which one they are looking at. A component that collapsed two
 * actors into one sentence would pass every per-state test and fail this one.
 */
test('the four reasons a version is not on the curve stay distinguishable', async ({ page }) => {
  const soups = [
    // Absent: no metric at all. Nobody decided anything.
    soupWith(null, { soup_id: 'd-absent', merged_at: '2026-08-08T02:00:00Z' }),
    // Service: the campaign withheld and named the rule that fired.
    soupWith(
      { ...stubWitness(0.74, 2), aggregate: null, aggregate_withheld: 'below_scoring_floor' },
      { soup_id: 'd-service', merged_at: '2026-08-12T02:00:00Z' }
    ),
    // Page: an aggregate published beside a partial per-site map, from which
    // the missing entries could be worked back out.
    soupWith(
      {
        ...stubWitness(0.75, 2),
        per_site: { 'stub-alpha': 0.7314 },
        per_site_basis: 'site',
      },
      { soup_id: 'd-page', merged_at: '2026-08-16T02:00:00Z' }
    ),
    // Unrenderable: a map whose key space the record never states, so the page
    // cannot tell a complete set from a partial one. Nothing is wrong with it.
    soupWith(
      { ...stubWitness(0.76, 2), per_site: { 'stub-alpha': 0.7314 }, per_site_basis: null },
      { soup_id: 'd-unrenderable', merged_at: '2026-08-20T02:00:00Z' }
    ),
  ];
  await stubCampaignService(page, { record: stubRecord({ soups }) });
  await page.goto(`/#/campaigns/${CAMPAIGN_ID}/progress`);
  await waitForLoaded(page);

  const text = await regionText(page);
  expect(text).toContain('carry no score in this record');
  expect(text).toContain('The campaign withheld the pooled score for');
  expect(text).toContain('published a pooled score this page will not render');
  expect(text).toContain('has no way to check');

  // Each note counts its own versions. If two actors were tallied into one
  // bucket the sentences would still all render and the counts would not be
  // four ones, which is what this catches.
  expect(text).toContain('1 version carry no score in this record');
});

test('a withheld score is attributed to the campaign, not to this page', async ({ page }) => {
  const soups = [
    soupWith(
      { ...stubWitness(0.74, 2), aggregate: null, aggregate_withheld: 'below_scoring_floor' },
      { soup_id: 'd-service' }
    ),
  ];
  await stubCampaignService(page, { record: stubRecord({ soups }) });
  await page.goto(`/#/campaigns/${CAMPAIGN_ID}/progress`);
  await waitForLoaded(page);

  const text = await regionText(page);
  expect(text).toContain('The campaign withheld the pooled score for');
  // The campaign made this decision, so the page must not present it as its
  // own refusal. That would read as a defect in the record rather than as the
  // disclosure rule working as designed.
  expect(text).not.toContain('this page will not render');
  expect(text).not.toContain('carry no score in this record');
});

test('a score this page refuses is attributed to this page, not to the campaign', async ({
  page,
}) => {
  const soups = [
    soupWith(
      {
        ...stubWitness(0.75, 2),
        // One of two contributors published a curve. With the aggregate beside
        // it, the other value reconstructs exactly.
        per_site: { 'stub-alpha': 0.7314 },
        per_site_basis: 'site',
      },
      { soup_id: 'd-page' }
    ),
  ];
  await stubCampaignService(page, { record: stubRecord({ soups }) });
  await page.goto(`/#/campaigns/${CAMPAIGN_ID}/progress`);
  await waitForLoaded(page);

  const text = await regionText(page);
  expect(text).toContain('published a pooled score this page will not render');
  expect(text).toContain('breaks a rule it declares it follows');
  // The campaign published the figure. Saying it withheld one would attribute
  // a decision to a campaign that made the opposite one.
  expect(text).not.toContain('The campaign withheld');
});

test('a score this page cannot check is not reported as a breach of the format', async ({
  page,
}) => {
  const soups = [
    soupWith(
      // A per-site map with no stated key space. The format permits it and the
      // record is not at fault, so the note must not read like an accusation.
      { ...stubWitness(0.76, 2), per_site: { 'stub-alpha': 0.7314 }, per_site_basis: null },
      { soup_id: 'd-unrenderable' }
    ),
  ];
  await stubCampaignService(page, { record: stubRecord({ soups }) });
  await page.goto(`/#/campaigns/${CAMPAIGN_ID}/progress`);
  await waitForLoaded(page);

  const text = await regionText(page);
  expect(text).toContain('has no way to check');
  // The sentence that exonerates the record. Without it this state is
  // indistinguishable from the page refusing a malformed record.
  expect(text).toContain('Nothing about those records is wrong');
  expect(text).not.toContain('breaks a rule it declares it follows');
});

test('a version with no score and no stated reason is not reported as a withhold', async ({
  page,
}) => {
  const soups = [soupWith(null, { soup_id: 'd-absent' })];
  await stubCampaignService(page, { record: stubRecord({ soups }) });
  await page.goto(`/#/campaigns/${CAMPAIGN_ID}/progress`);
  await waitForLoaded(page);

  const text = await regionText(page);
  expect(text).toContain('carry no score in this record');
  // An absence with no basis is not a withhold, and calling it one would
  // attribute a decision to a campaign that made none.
  expect(text).not.toContain('The campaign withheld');
  expect(text).not.toContain('this page will not render');
});

/**
 * The baseline the four above are read against, and the state nobody thinks to
 * assert because nothing renders in it. If a note leaked into this case the
 * contrast would be gone and every test above would still pass.
 */
test('a lineage with nothing missing renders none of the four notes', async ({ page }) => {
  await stubCampaignService(page);
  await page.goto(`/#/campaigns/${CAMPAIGN_ID}/progress`);
  await waitForLoaded(page);

  const text = await regionText(page);
  expect(text).not.toContain('carry no score in this record');
  expect(text).not.toContain('The campaign withheld the pooled score');
  expect(text).not.toContain('this page will not render');
  expect(text).not.toContain('has no way to check');
});

/**
 * The per-cell half of the same split.
 *
 * The notes under the table count versions; the cell has to say which kind of
 * absence THIS row is. They are separate code paths (`missingReasonFor` against
 * the tally), and a component that got the notes right while rendering one
 * shared placeholder in every cell would pass all five tests above.
 */
test('the metric cell names which kind of absence it is', async ({ page }) => {
  const soups = [
    soupWith(null, { soup_id: 'd-absent', merged_at: '2026-08-08T02:00:00Z' }),
    soupWith(
      { ...stubWitness(0.74, 2), aggregate: null, aggregate_withheld: 'below_scoring_floor' },
      { soup_id: 'd-service', merged_at: '2026-08-12T02:00:00Z' }
    ),
    soupWith(
      { ...stubWitness(0.75, 2), per_site: { 'stub-alpha': 0.7314 }, per_site_basis: 'site' },
      { soup_id: 'd-page', merged_at: '2026-08-16T02:00:00Z' }
    ),
  ];
  await stubCampaignService(page, { record: stubRecord({ soups }) });
  await page.goto(`/#/campaigns/${CAMPAIGN_ID}/progress`);
  await waitForLoaded(page);

  // Three different placeholders, one per actor. Lowercased because the labels
  // are uppercased in CSS and innerText reads them back that way.
  const text = (await regionText(page)).toLowerCase();
  expect(text).toContain('not reported');
  expect(text).toContain('not published');
  expect(text).toContain('not shown');
});

// ---------------------------------------------------------------------------
// The v0.2.1 guarantees: no live accuracy, and no unmarked ratio.
// ---------------------------------------------------------------------------

test('a campaign that has not released its outcomes renders no accuracy at all', async ({
  page,
}) => {
  // The record carries a full metric on every soup. The page must still refuse
  // it, because permission and presence are different questions and only the
  // first one governs. This is the shape every running campaign will have.
  await stubCampaignService(page, {
    record: stubRecord({}, {
      policy: { public_data_campaign: true, roster_attested: false, outcomes_released: false },
    }),
  });
  await page.goto(`/#/campaigns/${CAMPAIGN_ID}/progress`);
  await waitForLoaded(page);

  const text = await regionText(page);
  expect(text).toContain('No scores are published for this campaign yet');
  expect(text).toContain('primary-metric rules resolve');

  // Neither the metric's name nor any of its values may appear anywhere. The
  // gate score is listed alongside, because "no accuracy" has to mean both
  // metrics: withholding only the witness would leave the one that cannot show
  // improvement as the only score on the page.
  expect(text).not.toContain('validation F1 (witness split)');
  expect(text).not.toContain('pooled AP50 on the selection split');
  for (const value of ['0.741', '0.768', '0.772', '0.814']) {
    expect(text, `metric value ${value} rendered on an unreleased campaign`).not.toContain(value);
  }

  // Process is unaffected. The merges, the transport and the digests stay live,
  // which is the whole point of gating the outcome axis rather than the page.
  expect(text).toContain('Stub contributor Alpha');
  expect(text).toContain('62.1');
  expect(text).toContain('a22dba37');
});

test('a null outcomes flag withholds accuracy just as a false one does', async ({ page }) => {
  await stubCampaignService(page, {
    record: stubRecord({}, {
      policy: { public_data_campaign: true, roster_attested: false, outcomes_released: null },
    }),
  });
  await page.goto(`/#/campaigns/${CAMPAIGN_ID}/progress`);
  await waitForLoaded(page);

  const text = await regionText(page);
  expect(text).toContain('No scores are published for this campaign yet');
  expect(text).not.toContain('validation F1 (witness split)');
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
    record: stubRecord({}, {
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
    record: stubRecord({}, {
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

// ---------------------------------------------------------------------------
// The per-merge transport gate.
//
// These three ran against per-ROUND bytes through 0.13.0-draft. The gate itself
// is unchanged: `sources_complete` is still the only field that separates a
// complete sum from a partial one, and SoupLineage reads it exactly the way the
// round log did. Only the row it hangs off moved.
// ---------------------------------------------------------------------------

test('per-merge bytes are withheld when the merge was not fully logged', async ({ page }) => {
  // Every soup carries a populated bytes_out. The lineage still shows none of
  // them: a merge covered by some sources and not others is a real sum of real
  // entries that is not the merge's transport, and the value cannot say which
  // of the two it is. The flag is asked instead.
  await stubCampaignService(page, {
    record: stubRecord({
      soups: stubSoups().map((soup: any) => ({
        ...soup,
        transport: { ...(soup.transport as object), sources_complete: false },
      })),
    }),
  });
  await page.goto(`/#/campaigns/${CAMPAIGN_ID}/progress`);
  await waitForLoaded(page);

  // Lowercased because the column headings are uppercased in CSS and innerText
  // reads them back that way.
  const text = (await regionText(page)).toLowerCase();
  // The column is still drawn, so this is a withheld cell and not a missing
  // table.
  expect(text).toContain('weights moved');
  expect(text).not.toContain('2.60 gb');
  expect(text).not.toContain('3.90 gb');
});

test('a null coverage flag withholds per-merge bytes just as a false one does', async ({
  page,
}) => {
  await stubCampaignService(page, {
    record: stubRecord({
      soups: stubSoups().map((soup: any) => ({
        ...soup,
        transport: { ...(soup.transport as object), sources_complete: null },
      })),
    }),
  });
  await page.goto(`/#/campaigns/${CAMPAIGN_ID}/progress`);
  await waitForLoaded(page);

  const text = (await regionText(page)).toLowerCase();
  expect(text).toContain('weights moved');
  expect(text).not.toContain('2.60 gb');
  expect(text).not.toContain('3.90 gb');
});

test('a fully logged merge does show its bytes', async ({ page }) => {
  // The gate must not be a blanket suppression. stubSoups() reports complete
  // coverage, so the figures are rendered.
  await stubCampaignService(page);
  await page.goto(`/#/campaigns/${CAMPAIGN_ID}/progress`);
  await waitForLoaded(page);

  const text = await regionText(page);
  expect(text).toContain('2.60 GB');
  expect(text).toContain('3.90 GB');
});

test('self-declared roster values are marked, and the roster is not called attested', async ({
  page,
}) => {
  await stubCampaignService(page);
  await page.goto(`/#/campaigns/${CAMPAIGN_ID}`);
  await waitForLoaded(page);

  // Alpha declared its training-image count. Beta reported no count at all and
  // Gamma's empty `declared` list says the platform measured theirs, so the
  // mark must appear exactly once, on the one value that was declared.
  await expect(page.locator('[data-provenance="declared"]')).toHaveCount(1);

  const text = await regionText(page);
  expect(text).toContain('does not verify that a participant belongs to the institution they name');
});

/**
 * `declared` is the only mechanism separating a figure a contributor typed into
 * a join form from one the platform observed, and the mark is the only visual
 * difference between them. The check used to be
 * `contributor.declared?.includes(field) ?? false`, so a contributor that
 * reported no provenance at all had every value it did report rendered
 * unmarked, which is how the page spells "the platform measured this".
 *
 * The marker for weaker evidence failed open toward the stronger claim, which
 * is the one direction it must never fail in: a reader loses nothing when a
 * measured value is left unlabelled, and is misled when a self-reported one is
 * presented as observed.
 */
test('a contributor that reports no provenance does not get its values presented as measured', async ({
  page,
}) => {
  const contributors = stubContributors().map((contributor, i) =>
    i === 0
      ? {
          ...contributor,
          // Values are present. What is absent is any statement of where they
          // came from, which is not the same as a statement that they were
          // measured.
          country: 'Elbonia',
          declared: null,
        }
      : contributor
  );
  await stubCampaignService(page, { record: stubRecord({ contributors }) });
  await page.goto(`/#/campaigns/${CAMPAIGN_ID}`);
  await waitForLoaded(page);

  // Both of Alpha's reported values carry the unknown-provenance mark, and
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
  expect(text).toContain('412');
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
  const base = stubContributors()[0];
  const contributors = [
    // Declared: the contributor listed this field on its join form.
    {
      ...base,
      contributor_id: 'prov-declared',
      contributor_name: 'Declared contributor',
      declared: ['n_train_images'],
    },
    // Measured: a declared list exists and this field is not on it, so the
    // platform observed it. An empty list is a positive statement, not silence.
    {
      ...base,
      contributor_id: 'prov-measured',
      contributor_name: 'Measured contributor',
      declared: [],
    },
    // Unknown: no declared list at all. Not evidence of measurement.
    {
      ...base,
      contributor_id: 'prov-unknown',
      contributor_name: 'Unknown contributor',
      declared: null,
    },
  ];
  await stubCampaignService(page, { record: stubRecord({ contributors }) });
  await page.goto(`/#/campaigns/${CAMPAIGN_ID}`);
  await waitForLoaded(page);

  // Two marks, not three: the measured contributor is deliberately unmarked.
  await expect(page.locator('[data-provenance]')).toHaveCount(2);
  await expect(page.locator('[data-provenance="declared"]')).toHaveCount(1);
  await expect(page.locator('[data-provenance="unknown"]')).toHaveCount(1);

  // Asserted on the row itself, so this fails if the measured contributor picks
  // up a mark of any kind rather than only if the total count changes.
  const measuredRow = page.locator('tr', { hasText: 'Measured contributor' });
  await expect(measuredRow.locator('[data-provenance]')).toHaveCount(0);
  // ...and the row still shows its value. Unmarked means observed, not hidden.
  await expect(measuredRow).toContainText('412');

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
  // mark must not claim the contributor declared anything.
  expect(declaredTitle).toContain('Declared by the contributor');
  expect(unknownTitle).toContain('did not report where their values came from');
  expect(unknownTitle).not.toContain('Declared by the contributor');
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
  await expect(page.getByText(/this page expects 0\.14\.0-draft/)).toBeVisible();

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
  await expect(page.getByText(/this page expects 0\.14\.0-draft/)).toBeVisible();

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
  await stubCampaignService(page, { servedSchema: '0.14.99-draft' });
  await page.goto('/#/campaigns');

  await expect(page.getByText('Stub community model soup')).toBeVisible();
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
  expect(text).toContain('1.30 GB');
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
  await stubCampaignService(page, { record: stubRecord() });
  await page.goto(`/#/campaigns/${CAMPAIGN_ID}/progress`);
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
  await stubCampaignService(page, { record: stubRecord() });
  await page.goto(`/#/campaigns/${CAMPAIGN_ID}/progress`);
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
  await stubCampaignService(page, { record: stubRecord() });
  await page.goto(`/#/campaigns/${CAMPAIGN_ID}/progress`);
  await waitForLoaded(page);

  const text = await regionText(page);
  expect(text).toContain('Assessed by a merge, not included in it');
  expect(text).toContain('not a mark against the contribution or the data behind it');

  for (const word of ['rejected', 'Rejected', 'failed', 'Failed', 'refused', 'worse']) {
    expect(text, `the excluded state was described as "${word}"`).not.toContain(word);
  }
});

test('the excluded dot is neutral, not a warning colour', async ({ page }) => {
  await stubCampaignService(page, { record: stubRecord() });
  await page.goto(`/#/campaigns/${CAMPAIGN_ID}/progress`);
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
  await stubCampaignService(page, { record: stubRecord() });
  await page.goto(`/#/campaigns/${CAMPAIGN_ID}/progress`);
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
  await stubCampaignService(page, { record: stubRecord() });
  await page.goto(`/#/campaigns/${CAMPAIGN_ID}/progress`);
  await waitForLoaded(page);

  const chart = page.locator('svg[aria-label*="community version"]');
  await expect(chart).toHaveCount(1);
  await expect(chart).toHaveAttribute('aria-label', /validation F1 \(witness split\)/);
  await expect(chart).not.toHaveAttribute('aria-label', /AP50/);

  const text = await regionText(page);
  // The gate is NAMED, because a reader told that some contributions were not
  // taken is entitled to know what the criterion was...
  expect(text).toContain('pooled AP50 on the selection split');
  // ...and it is named in the sentence that separates it from what is plotted.
  // The separation is drawn on the SPLIT rather than on the name, because the
  // two may share a name. See the same-name test below.
  expect(text).toContain('runs on a different split');
  expect(text).toContain('cannot show whether the model improved');

  // None of the gate's values reach the page. Naming a metric is publication of
  // a criterion; rendering its series is publication of a result, and this is
  // the one series on the page that would be circular.
  //
  // 0.8137 is the newest origin, added with `EmptyMerge.selection_metric` in
  // 0.13.0-draft: the bar no candidate cleared on a merge that published
  // nothing. It is a second place a selection value can enter the page, and the
  // rule that it is never drawn does not care which door it came through. It is
  // listed here rather than in a test of its own so that this loop stays the one
  // place that has to be updated when a third origin appears.
  for (const value of ['0.629', '0.647', '0.6293', '0.6466', '0.813', '0.8137']) {
    expect(text, `a selection-metric value ${value} was rendered`).not.toContain(value);
  }
});

test('a gate that shares the witness metric name is separated by split, not by name', async ({
  page,
}) => {
  // The reference producer applies ONE matcher to both splits, so witness and
  // selection arrive carrying an identical `name`. That is honest and it is the
  // realistic case, not an edge case.
  //
  // It breaks any copy that distinguishes the two by naming one of them. The
  // wording this replaced said "it is not the <gate name>" immediately below a
  // chart labelled with that exact string, so the page appeared to deny its own
  // axis. Worse, a reader who resolved the contradiction the natural way would
  // conclude the plotted curve IS the gate score, which is the single reading
  // this whole paragraph exists to prevent.
  const shared = 'mean instance F1 at IoU 0.5';
  const soups = stubSoups().map((soup) => ({
    ...soup,
    witness_metric: { ...(soup.witness_metric as Record<string, unknown>), name: shared },
    selection_metric: soup.selection_metric
      ? { ...(soup.selection_metric as Record<string, unknown>), name: shared }
      : null,
  }));
  await stubCampaignService(page, { record: stubRecord({ soups }) });
  await page.goto(`/#/campaigns/${CAMPAIGN_ID}/progress`);
  await waitForLoaded(page);

  const text = await regionText(page);

  // The shared name is stated as shared rather than quietly avoided. A reader
  // seeing one name in two places assumes one number unless told plainly.
  expect(text).toContain('applies the same metric to a different split');
  expect(text).toContain('without being the same measurement');

  // And the page must NOT claim the plotted curve is not the thing it is
  // labelled as. This is the assertion that would have caught the old wording.
  expect(text).not.toContain(`It is not the ${shared}`);

  // The gate's values still never reach the page, which is the invariant that
  // does not care whether the names collide.
  for (const value of ['0.629', '0.647', '0.6293', '0.6466']) {
    expect(text, `a selection-metric value ${value} was rendered`).not.toContain(value);
  }
});

test('the gate score does not appear as a lineage column', async ({ page }) => {
  await stubCampaignService(page, { record: stubRecord() });
  await page.goto(`/#/campaigns/${CAMPAIGN_ID}/progress`);
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
  await stubCampaignService(page, { record: stubRecord() });
  await page.goto(`/#/campaigns/${CAMPAIGN_ID}/progress`);
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
  await stubCampaignService(page, { record: stubRecord({ soups }) });
  await page.goto(`/#/campaigns/${CAMPAIGN_ID}/progress`);
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
  await stubCampaignService(page, { record: stubRecord() });
  await page.goto(`/#/campaigns/${CAMPAIGN_ID}/progress`);
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
    record: stubRecord({
      merge_trigger: {
        kind: 'manual',
        decided_by: null,
        agent: null,
        next_merge_at: null,
        contributions_per_merge: null,
      },
    }),
  });
  await page.goto(`/#/campaigns/${CAMPAIGN_ID}/progress`);
  await waitForLoaded(page);

  const text = await regionText(page);
  expect(text).toContain('Merges run on demand');
  expect(text).toContain('no next date to show');
  expect(text).not.toContain('scheduled for');
  // The rule branch says nothing about WHO, and this record does not state an
  // actor. Before 0.13.0-draft this copy read "run by the campaign stewards",
  // which was `kind` making an actor claim it had no field to support.
  expect(text).not.toContain('run by the campaign stewards');
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
    record: stubRecord({
      merge_trigger: {
        kind: 'on_contributions',
        decided_by: null,
        agent: null,
        next_merge_at: null,
        contributions_per_merge: 5,
      },
    }),
  });
  await page.goto(`/#/campaigns/${CAMPAIGN_ID}/progress`);
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
  await stubCampaignService(page, { record: stubRecord({ merge_trigger: null }) });
  await page.goto(`/#/campaigns/${CAMPAIGN_ID}/progress`);
  await waitForLoaded(page);

  const text = await regionText(page);
  expect(text).toContain('Contributions and merges');
  expect(text).not.toContain('scheduled for');
  expect(text).not.toContain('A merge runs every');
  expect(text).not.toContain('run by the campaign stewards');
});

/**
 * An unstated trigger is NAMED as unstated, rather than rendering as silence.
 *
 * This used to be silence, and silence was defensible while `merge_trigger:
 * null` only ever meant a campaign whose steward had not configured one. It
 * stopped being defensible on 12 Sep 2026, when the flagship async campaign
 * moved to this state on purpose: its merges are driven by something the wire
 * cannot describe yet, so it reports no trigger rather than claim the nearest
 * member of a union that does not contain the truth.
 *
 * A reader looking at merge markers with no explanation supplies one, and the
 * one they supply is a schedule. That is the claim the field was just corrected
 * to stop making, so an unnamed gap would reinstate it by implication.
 */
test('an unstated merge trigger is disclosed rather than left as silence', async ({ page }) => {
  await stubCampaignService(page, { record: stubRecord({ merge_trigger: null }) });
  await page.goto(`/#/campaigns/${CAMPAIGN_ID}/progress`);
  await waitForLoaded(page);

  const text = await regionText(page);
  expect(text).toContain('does not state a rule for when a merge fires');
  expect(text).toContain('nothing here should be read as a schedule');

  // It reports the absence and stops. A record with no trigger at all states no
  // actor either, so nothing here may describe the merges as agent-run: drawing
  // an agent from an empty field is the decorative case in its purest form.
  expect(text.toLowerCase()).not.toContain('agent');
  expect(text).not.toContain('scheduled for');
});

/**
 * The rule and the actor are INDEPENDENT, and the page renders each on its own
 * evidence.
 *
 * This is the flagship campaign's real shape as of 12 Sep 2026 and the case
 * that forced `MergeTrigger` apart in 0.13.0-draft. The backend read its own
 * code: no scheduler, cron or timer fires a merge anywhere, and an agent
 * decides each batch by its own reading of the pool. So the actor is known and
 * there is no rule to name.
 *
 * Under the old single-field encoding this campaign had to report nothing at
 * all, and the page said the record did not say what decides a merge, which
 * denied the half that was actually established.
 */
test('a stated actor and an unstated rule are reported separately', async ({ page }) => {
  await stubCampaignService(page, {
    record: stubRecord({
      merge_trigger: {
        kind: null,
        decided_by: 'agent',
        agent: { invoked_by: 'skill_call' },
        next_merge_at: null,
        contributions_per_merge: null,
      },
    }),
  });
  await page.goto(`/#/campaigns/${CAMPAIGN_ID}/progress`);
  await waitForLoaded(page);

  const text = await regionText(page);
  // The actor, stated.
  expect(text).toContain('run by an agent acting through the campaign skill interface');
  // The rule, absent, and still named as absent. The actor being known does not
  // license a prediction, and this is the assertion that would fail if anyone
  // ever decided a known agent implies a cadence.
  expect(text).toContain('does not state a rule for when a merge fires');
  expect(text).toContain('nothing here should be read as a schedule');
  expect(text).not.toContain('scheduled for');
  expect(text).not.toContain('A merge runs every');
});

/**
 * An agent the record says a TIMER starts is not drawn as an agent.
 *
 * The decorative-agent case, caught by the field that exists to catch it. A
 * scheduled loop with an agent-shaped wrapper is a scheduled loop, and the
 * whole reason `decided_by` and `invoked_by` are separate fields is that the
 * collapsed encoding made this record indistinguishable from a genuine one.
 *
 * The page reports what the record says rather than silently downgrading it,
 * because a refusal that renders nothing looks exactly like a record that said
 * nothing, and this is a case worth someone noticing.
 */
test('an agent started by a timer is reported as a scheduled job, not an agent', async ({
  page,
}) => {
  await stubCampaignService(page, {
    record: stubRecord({
      merge_trigger: {
        kind: null,
        decided_by: 'agent',
        agent: { invoked_by: 'timer' },
        next_merge_at: null,
        contributions_per_merge: null,
      },
    }),
  });
  await page.goto(`/#/campaigns/${CAMPAIGN_ID}/progress`);
  await waitForLoaded(page);

  const text = await regionText(page);
  expect(text).toContain('says the agent is started by a timer');
  expect(text).toContain('what it describes is a scheduled job');
  // The claim the refusal exists to block. The word "agent" DOES appear, in the
  // sentence explaining the refusal, so this asserts on the claim rather than on
  // the word.
  expect(text).not.toContain('run by an agent acting through');
  expect(text).not.toContain('applies the gate that decides which contributions are kept');
});

/**
 * An agent whose invocation the record does not state is not drawn either.
 *
 * The strict-branch default, for the same reason `aggregate_scope` has one: a
 * check that can be disabled by omitting a field is not a check. If a missing
 * `agent` block bought the agent depiction, the cheapest route past the
 * decorative-agent guard would be to send less than the honest record does,
 * which inverts the incentive the guard is for.
 */
test('an agent with no stated invocation is not described as agent-run', async ({ page }) => {
  await stubCampaignService(page, {
    record: stubRecord({
      merge_trigger: {
        kind: null,
        decided_by: 'agent',
        agent: null,
        next_merge_at: null,
        contributions_per_merge: null,
      },
    }),
  });
  await page.goto(`/#/campaigns/${CAMPAIGN_ID}/progress`);
  await waitForLoaded(page);

  const text = await regionText(page);
  expect(text).toContain('does not say what starts the agent');
  expect(text).not.toContain('run by an agent acting through');
  expect(text).not.toContain('applies the gate that decides which contributions are kept');
});

/**
 * The disclosure appears ONLY when there is an absence to disclose.
 *
 * Without this, the sentence could be rendered unconditionally and every test
 * above would still pass, which would put "nothing here should be read as a
 * schedule" on a campaign that had just given a schedule.
 */
test('a stated trigger does not also report an unstated one', async ({ page }) => {
  await stubCampaignService(page, { record: stubRecord() });
  await page.goto(`/#/campaigns/${CAMPAIGN_ID}/progress`);
  await waitForLoaded(page);

  const text = await regionText(page);
  expect(text).toContain('The next merge is scheduled for');
  expect(text).not.toContain('does not say what decides when a merge runs');
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
  await stubCampaignService(page, { record: stubRecord() });
  await page.goto(`/#/campaigns/${CAMPAIGN_ID}/progress`);
  await waitForLoaded(page);

  const text = await regionText(page);
  expect(text).toContain('left the participating contributors');
  expect(text).not.toContain('left the participating sites');
  expect(text).not.toContain('per site per round');
});

// The mirror of the test above deleted with the synchronous arm. It asserted
// that a sync campaign said "sites" where an async one said "contributors", and
// the pairing was the whole point: it proved the noun tracked the record rather
// than being hardcoded. With one arm left there is no second noun to track, and
// the surviving negative above is what remains checkable.

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
  await stubCampaignService(page, { record: stubRecord() });
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
  await stubCampaignService(page, { record: stubRecord() });
  await page.goto(`/#/campaigns/${CAMPAIGN_ID}/progress`);
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
  await stubCampaignService(page, { record: stubRecord() });
  await page.goto(`/#/campaigns/${CAMPAIGN_ID}/progress`);
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
  await stubCampaignService(page, { record: stubRecord() });
  await page.goto(`/#/campaigns/${CAMPAIGN_ID}/progress`);
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
  await stubCampaignService(page, { record: stubRecord() });
  await page.goto(`/#/campaigns/${CAMPAIGN_ID}/progress`);
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
  await stubCampaignService(page, { record: stubRecord({ empty_merges: [] }) });
  await page.goto(`/#/campaigns/${CAMPAIGN_ID}/progress`);
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
  await stubCampaignService(page, { record: stubRecord({ empty_merges: null }) });
  await page.goto(`/#/campaigns/${CAMPAIGN_ID}/progress`);
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
  await stubCampaignService(page, { record: stubRecord() });
  await page.goto(`/#/campaigns/${CAMPAIGN_ID}/progress`);
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
  await stubCampaignService(page, { record: stubRecord() });
  await page.goto(`/#/campaigns/${CAMPAIGN_ID}/progress`);
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
  { path: `/#/campaigns/${CAMPAIGN_ID}`, label: 'asynchronous detail' },
  { path: `/#/campaigns/${CAMPAIGN_ID}/progress`, label: 'asynchronous progress' },
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
  await stubCampaignService(page, { record: stubRecord() });
  for (const path of [`/#/campaigns/${CAMPAIGN_ID}`, `/#/campaigns/${CAMPAIGN_ID}/progress`]) {
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
  await stubCampaignService(page, { record: stubRecord() });
  for (const path of [`/#/campaigns/${CAMPAIGN_ID}`, `/#/campaigns/${CAMPAIGN_ID}/progress`]) {
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
  await stubCampaignService(page, { record: stubRecord() });
  await page.goto(`/#/campaigns/${CAMPAIGN_ID}`);
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
  await stubCampaignService(page, { record: stubRecord() });
  await page.goto(`/#/campaigns/${CAMPAIGN_ID}`);
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
  await stubCampaignService(page, { record: stubRecord() });
  await page.goto(`/#/campaigns/${CAMPAIGN_ID}/progress`);
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
 * `CampaignMetric.name` has said "never abbreviated to 'score' by the page" since
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
  await stubCampaignService(page, { record: stubRecord() });
  await page.goto(`/#/campaigns/${CAMPAIGN_ID}/progress`);
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

/**
 * The named base model, so the reference level has something to be a level of.
 *
 * It carries a `version` because the default case is the identified one. A zoo
 * entry can hold several committed versions with different weights, so a stub
 * without one would have made "the record does not say which checkpoint" the
 * shape every baseline test ran against.
 */
const STUB_BASE_MODEL = {
  id: 'stub-workspace/stub-base-model',
  name: 'Stub base model',
  version: '3.1.0',
  url: null,
};

test('the base model is drawn as a reference level and adds no point to the curve', async ({
  page,
}) => {
  await stubCampaignService(page, {
    record: stubRecord({ baseline_metric: stubBaseline() }, { base_model: STUB_BASE_MODEL }),
  });
  await page.goto(`/#/campaigns/${CAMPAIGN_ID}/progress`);
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

// ---------------------------------------------------------------------------
// Which checkpoint the level is (0.12.0-draft).
//
// A model NAME is an entry over a sequence of committed versions, and those
// versions are not the same weights: the reproducibility check on 12 Sep 2026
// found "Cellpose-SAM" carries two. So a reference level labelled with a bare
// entry name gives a reader an address that does not resolve, and gives them
// no way to notice. The value is still the service's to state, so it renders
// either way. The identity is the part the page will not invent.
// ---------------------------------------------------------------------------

test('the reference level names the checkpoint it was scored from', async ({ page }) => {
  await stubCampaignService(page, {
    record: stubRecord({ baseline_metric: stubBaseline() }, { base_model: STUB_BASE_MODEL }),
  });
  await page.goto(`/#/campaigns/${CAMPAIGN_ID}/progress`);
  await waitForLoaded(page);

  const svgText = await page.evaluate(() => {
    const g = document.querySelector('svg g[data-baseline]');
    return g ? (g.textContent ?? '') : '';
  });
  // The version is on the line itself, not only in prose further down. The
  // label is what a reader carries away from the chart.
  expect(svgText).toContain('Stub base model 3.1.0');

  // And the page does not also apologise for an absence that is not there.
  expect(await regionText(page)).not.toContain('does not say which published version');
});

test('an unversioned base model is not named on the reference level', async ({ page }) => {
  await stubCampaignService(page, {
    record: stubRecord(
      { baseline_metric: stubBaseline() },
      { base_model: { ...STUB_BASE_MODEL, version: null } }
    ),
  });
  await page.goto(`/#/campaigns/${CAMPAIGN_ID}/progress`);
  await waitForLoaded(page);

  const svgText = await page.evaluate(() => {
    const g = document.querySelector('svg g[data-baseline]');
    return g ? (g.textContent ?? '') : '';
  });

  // The level is still drawn: the score is a figure the service stated, and
  // the missing piece is the identity, not the measurement.
  await expect(page.locator('svg g[data-baseline]')).toHaveCount(1);
  expect(svgText).toContain('0.689');

  // But it is not labelled with the entry name, which would read as a
  // checkpoint the reader could go and fetch.
  expect(svgText).not.toContain('Stub base model');
  expect(svgText).toContain('Base model');

  // And the gap is stated rather than left looking like a style choice.
  const text = await regionText(page);
  expect(text).toContain('does not say which published version');
  expect(text).toContain('several versions with different weights');
});

test('the baseline value is rendered, so the comparison can actually be made', async ({ page }) => {
  await stubCampaignService(page, {
    record: stubRecord({ baseline_metric: stubBaseline() }),
  });
  await page.goto(`/#/campaigns/${CAMPAIGN_ID}/progress`);
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
    record: stubRecord({
      baseline_metric: stubBaseline({ name: 'some other validation score' }),
    }),
  });
  await page.goto(`/#/campaigns/${CAMPAIGN_ID}/progress`);
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
    record: stubRecord({
      // Same metric name, same split name, measured on the campaign's own
      // holdout while the versions are pooled over participants. This is the
      // harder half of comparability and the one a name check alone misses:
      // everything the reader can see about the two figures agrees.
      baseline_metric: stubBaseline({ aggregate_scope: 'campaign_holdout', n_sites_scored: null }),
    }),
  });
  await page.goto(`/#/campaigns/${CAMPAIGN_ID}/progress`);
  await waitForLoaded(page);

  await expect(page.locator('svg g[data-baseline]')).toHaveCount(0);
  expect(await regionText(page)).toContain('measured differently from the versions above');
});

test('a baseline the page refuses is reported, not silently dropped', async ({ page }) => {
  await stubCampaignService(page, {
    record: stubRecord({
      // Comparable, and unrenderable for the ordinary reason: a figure with no
      // count of what it is a mean over. The baseline goes through the same
      // disposition function as every version, so it fails the same way.
      baseline_metric: stubBaseline({ n_sites_scored: null }),
    }),
  });
  await page.goto(`/#/campaigns/${CAMPAIGN_ID}/progress`);
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
  await stubCampaignService(page, { record: stubRecord() });
  await page.goto(`/#/campaigns/${CAMPAIGN_ID}/progress`);
  await waitForLoaded(page);

  await expect(page.locator('svg g[data-baseline]')).toHaveCount(0);
  const text = await regionText(page);
  expect(text).not.toContain('scored the same way before the first merge');
  expect(text).not.toContain('measured differently from the versions above');
});

/**
 * The house punctuation rule, checked where the rule can actually be broken.
 *
 * CLAUDE.md bans the em dash from every string that reaches a user, and bans
 * the en dash from prose. A grep over `src/` enforces that for the copy we
 * author, and that is the easy half. The half that has no check is the half
 * that matters here: metric names, `aggregate_basis`, campaign descriptions and
 * contributor labels all arrive over the wire and render VERBATIM. They are not
 * in our source, so no source-level check can see them, and the page has no
 * business rewriting a producer's prose on the way to the screen.
 *
 * This is not hypothetical. The backend shipped an em dash in SELECTION_BASIS
 * and an unnecessary semicolon in WITNESS_BASIS, and both were caught by a
 * human reading a message rather than by anything that runs. A rule enforced
 * only by careful reading is a rule that holds until the first busy week.
 *
 * WHAT IS AUTOMATED, AND WHAT IS DELIBERATELY NOT. The em dash is decidable:
 * it is banned everywhere, no exceptions. The en dash is decidable with one
 * carve-out, because CLAUDE.md permits it between numeric bounds in a compact
 * label such as `5-95%`, so a dash with a digit on both sides is allowed and
 * anything else is not. "Unnecessary semicolon" is a judgement about whether a
 * cleaner rewrite exists, not a pattern, so it is NOT automated. That omission
 * is recorded rather than quietly accepted: this guard covers two of the three
 * house rules and a semicolon still needs a reader.
 *
 * THE LIMIT. This reads rendered text, so it covers exactly the strings some
 * test actually renders: our JSX, and the producer strings our stubs and
 * fixtures carry. A live backend string that no test ever puts on screen is
 * invisible to it. That is the same shape as the role-guard limit and it is
 * worth stating plainly, because the guard's value is regression protection
 * over the strings we do render, not coverage of the wire.
 */
const EM_DASH = '—';
const EN_DASH = '–';

/** The predicate both the guard and its mutation test run, so they cannot drift. */
function bannedPunctuationIn(text: string): string[] {
  const findings: string[] = [];
  const context = (index: number): string =>
    text
      .slice(Math.max(0, index - 40), index + 40)
      .replace(/\s+/g, ' ')
      .trim();

  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i];
    if (ch === EM_DASH) {
      findings.push(`em dash: ...${context(i)}...`);
      continue;
    }
    if (ch !== EN_DASH) continue;
    // Permitted only between numeric bounds, e.g. a compact `5-95%` label.
    const numericRange = /\d/.test(text[i - 1] ?? '') && /\d/.test(text[i + 1] ?? '');
    if (!numericRange) findings.push(`en dash in prose: ...${context(i)}...`);
  }
  return findings;
}

test('no campaign route renders a banned dash, including in wire-sourced strings', async ({
  page,
}) => {
  await stubCampaignService(page, { record: stubRecord() });
  for (const route of GLYPH_ROUTES) {
    await page.goto(route.path);
    await waitForLoaded(page);
    const offending = bannedPunctuationIn(await regionText(page));
    expect(offending, `${route.label} breaks the house punctuation rule: ${offending.join(' | ')}`).toEqual(
      []
    );
  }
});

test('the async campaign routes are covered by the same punctuation rule', async ({ page }) => {
  // Stubbed separately for the same reason the glyph rule is: the async record
  // is what drives the lineage caption and the contribution stream, and those
  // carry the longest stretches of producer-supplied prose on the page.
  await stubCampaignService(page, { record: stubRecord() });
  for (const path of [
    `/#/campaigns/${CAMPAIGN_ID}`,
    `/#/campaigns/${CAMPAIGN_ID}/progress`,
  ]) {
    await page.goto(path);
    await waitForLoaded(page);
    const offending = bannedPunctuationIn(await regionText(page));
    expect(offending, `${path} breaks the house punctuation rule: ${offending.join(' | ')}`).toEqual([]);
  }
});

test('the punctuation guard fires on an em dash arriving from the wire', async ({ page }) => {
  // The mutation is planted in a PRODUCER string rather than in our JSX,
  // because a guard that only catches our own copy would be redundant with a
  // source grep. This proves it catches the case a grep structurally cannot.
  const record = stubRecord() as Record<string, unknown>;
  const dirty = `pooled over the shared corpus ${EM_DASH} not per site`;
  record.description = dirty;

  await stubCampaignService(page, { record });
  await page.goto(`/#/campaigns/${CAMPAIGN_ID}`);
  await waitForLoaded(page);

  const text = await regionText(page);
  expect(text, 'the planted string never reached the screen, so this proves nothing').toContain(
    'pooled over the shared corpus'
  );
  const offending = bannedPunctuationIn(text);
  expect(offending.length, 'an em dash from the wire walked through the punctuation guard').toBeGreaterThan(0);
  expect(offending[0]).toContain('em dash');
});

test('the punctuation guard allows a numeric range but not a prose en dash', async ({ page }) => {
  // Both halves of the en-dash carve-out, checked directly on the predicate.
  // Without the negative half the rule could be satisfied by never firing.
  expect(bannedPunctuationIn(`central 5${EN_DASH}95% of sites`)).toEqual([]);
  expect(bannedPunctuationIn(`merged weekly ${EN_DASH} whenever checkpoints arrived`)).toHaveLength(1);
  expect(bannedPunctuationIn(`a clean sentence with no dashes at all`)).toEqual([]);
});

// ---------------------------------------------------------------------------
// A zero that is a starting state, versus a zero that is a result.
//
// `formatCount(0)` returns "0", so `Value` renders it and `MissingValue` never
// fires. Nothing is missing and that is correct. The hazard is downstream: a
// campaign that has not begun and a campaign that ran and admitted nothing both
// render "0 contributions, 0 community versions", and those are opposite
// claims. The second says the selection gate weighed real work and took none of
// it, which is a genuine and fairly damning result. The first says the gate was
// never asked a question.
//
// `status` separates them and the page previously spent it only on a chip, a
// colour and the join button. These tests hold both halves: the note appears
// where the zeros are a starting state, and stays away where they are a finding.
// ---------------------------------------------------------------------------

test('an open campaign with nothing yet says its zeros are a starting state', async ({ page }) => {
  await stubCampaignService(page, {
    record: stubRecord(
      { contributions: [], contributors: [], soups: [], empty_merges: [] },
      { status: 'open' }
    ),
  });
  await page.goto(`/#/campaigns/${CAMPAIGN_ID}/progress`);
  const note = page.getByTestId('not-started-note');
  await expect(note).toBeVisible();
  await expect(note).toContainText('has not started');
  await expect(note).toContainText('not a result');
});

test('a completed campaign that published nothing is NOT reassured', async ({ page }) => {
  // The asymmetry is the whole point. This campaign ran and took nothing, which
  // is a real outcome, and softening it with a not-started note would erase the
  // only case the reader most needs to see.
  await stubCampaignService(page, {
    record: stubRecord(
      { contributions: [], contributors: [], soups: [], empty_merges: [] },
      { status: 'completed' }
    ),
  });
  await page.goto(`/#/campaigns/${CAMPAIGN_ID}/progress`);
  await expect(page.getByTestId('not-started-note')).toHaveCount(0);
});

test('the note disappears as soon as a campaign has anything to show', async ({ page }) => {
  // Open but already moving. Gating on status alone would leave the note
  // sitting above real figures, calling measured work a starting state.
  await stubCampaignService(page, { record: stubRecord({}, { status: 'open' }) });
  await page.goto(`/#/campaigns/${CAMPAIGN_ID}/progress`);
  await expect(page.getByTestId('not-started-note')).toHaveCount(0);
});

// The synchronous half of the not-started note went with the synchronous arm.
// It drove the note off an empty round list where the three above drive it off
// an empty contribution list, so the branch it covered no longer exists.
