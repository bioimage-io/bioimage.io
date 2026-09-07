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

const SCHEMA_VERSION = '0.3.0-draft';
const CAMPAIGN_ID = 'stub-consortium';
const STUB_DIGEST = 'a22dba37c1e04f9b';

/** Rounds 0, 1, 4, 5 of an otherwise 0..5 series. 2 and 3 were never reported. */
function stubRounds(): Array<Record<string, unknown>> {
  return [0, 1, 4, 5].map((round) => ({
    round,
    participants: ['stub-site-a', 'stub-site-b'],
    eval_on: ['stub-site-a', 'stub-site-b'],
    merge_weights: null,
    metric: {
      name: 'validation Dice',
      higher_is_better: true,
      per_site: null,
      aggregate: 0.4 + round * 0.07,
      aggregate_basis: 'merge-weighted mean over the per-dataset validation Dice',
      n_sites_scored: 2,
      aggregate_withheld: null,
    },
    global_sha256: STUB_DIGEST,
    // Both sites scored on the same aggregate, which is the strongest
    // provenance claim the record carries.
    scored_with: { 'stub-site-a': STUB_DIGEST, 'stub-site-b': STUB_DIGEST },
    transport: { bytes_out: 15_520_000, bytes_in: 15_520_000, n_transfers: 4, sources_complete: true },
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
      // Two sites, so two is the only floor that admits a pooled figure at all.
      aggregate_min_eval_sites: 2,
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
  opts: {
    record?: ReturnType<typeof stubRecord>;
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
            aggregate_withheld: 'below_eval_floor',
          },
        }
      : round
  );
  await stubCampaignService(page, { record: stubRecord({ rounds }) });
  await page.goto(`/#/campaigns/${CAMPAIGN_ID}/progress`);
  await waitForLoaded(page);

  const text = await regionText(page);
  expect(text).toContain('1 round has no combined score');
  expect(text).toContain('Fewer sites evaluated than the campaign publishes a combined figure over');
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
  expect(text).not.toContain('Fewer sites evaluated');
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
      // The campaign published a figure over one evaluating site, under a floor
      // of two. Every leave-one-site-out fold has a singleton eval set, so this
      // is the shape the floor exists for.
      return { ...round, eval_on: ['stub-site-a'] };
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
  expect(text).toContain('over fewer evaluating sites than the campaign');
  expect(text).toContain('no reason recorded for its absence');
  // One round each, so none of them absorbed another's count. A round counted
  // twice overstates how much is missing and a round counted nowhere is the
  // original bug.
  expect(text.match(/1 round /g)?.length).toBe(3);
  // Round 0 still plots, which is what makes the three refusals above findings
  // rather than the behaviour of a chart that refuses everything.
  expect(text).toContain('validation Dice 0.400');
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
  const record = stubRecord();
  const sites = (record.sites as any[]).map((site, i) =>
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
  await stubCampaignService(page, { record: { ...record, sites } });
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
  const record = stubRecord();
  const base = (record.sites as any[])[0];
  const sites = [
    // Declared: the site listed this field on its join form.
    { ...base, site_id: 'prov-declared', site_name: 'Declared site', declared: ['n_train_images'] },
    // Measured: a declared list exists and this field is not on it, so the
    // platform observed it. An empty list is a positive statement, not silence.
    { ...base, site_id: 'prov-measured', site_name: 'Measured site', declared: [] },
    // Unknown: no declared list at all. Not evidence of measurement.
    { ...base, site_id: 'prov-unknown', site_name: 'Unknown site', declared: null },
  ];
  await stubCampaignService(page, { record: { ...record, sites } });
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
  await stubCampaignService(page, { servedSchema: '0.4.0-draft' });
  await page.goto('/#/campaigns');

  // The refusal is visible. A silent empty list would be the wrong outcome:
  // it reads as "no campaigns exist" when the truth is "we cannot read this".
  await expect(page.getByText(/schema 0\.4\.0-draft/)).toBeVisible({ timeout: 20000 });

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
  await stubCampaignService(page, { servedSchema: '0.4.0-draft' });
  await page.goto(`/#/campaigns/${CAMPAIGN_ID}`);

  await expect(page.getByText(/schema 0\.4\.0-draft/)).toBeVisible({ timeout: 20000 });

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
  await stubCampaignService(page, { servedSchema: '0.3.99-draft' });
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
