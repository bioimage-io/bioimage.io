/**
 * Illustrative campaign records, for design review only.
 *
 * These are reachable ONLY when `REACT_APP_CAMPAIGN_FIXTURES=1`, which no
 * production build sets. Whenever they are in use the pages show a persistent
 * prototype banner, so nothing here can be mistaken for a measurement.
 *
 * Every site name below is invented. No real institution appears, because a
 * real name on an illustrative roster reads as that institution having joined
 * a campaign that does not exist.
 *
 * The two fixtures deliberately differ in shape, so the components are
 * exercised against both of the profiles the schema has to serve. Since
 * 0.8.0-draft those profiles are the two campaign MODES, which is a deeper
 * split than the payload-and-units differences they started as:
 *
 *  - `cellpose-sam-community` is the ASYNCHRONOUS model-soup flagship. An open
 *    community fine-tunes Cellpose-SAM locally, at its own pace, and the
 *    checkpoints are periodically averaged into a growing community model.
 *    Two event streams, a wall-clock axis, a version lineage, a FULL-CHECKPOINT
 *    payload, GREEDY selection so some contributions are assessed and not taken,
 *    a witness metric distinct from the selection gate, and a transport log
 *    whose per-source windows agree.
 *  - `unet-consortium` is the SYNCHRONOUS initial test, and it is kept rather
 *    than deleted for two reasons. It is the only fixture that exercises the
 *    completed-and-reconciled path, which a permanently-open async campaign
 *    structurally cannot reach. And it is the record of what was actually run
 *    first: lockstep rounds, full state dicts, no byte figure for data held
 *    (only image counts), a metric named "validation Dice" rather than a
 *    generic score, and a transport log whose windows do NOT agree, so the
 *    observed total is withheld and only the computed figure is offered.
 *
 * If a component renders the second one correctly it cannot be hardcoding
 * "adapter", "TB", "score", or a summable transport log. If it renders both it
 * cannot be hardcoding a round axis either.
 *
 * THE EMPTY-MERGE CASE IS NOW EXERCISED, and the history is worth keeping
 * because it is the shape of the mistake this file exists to avoid. Through
 * 0.9.0-draft a merge that assessed candidates and admitted none of them was
 * deliberately unreachable here: whether the backend recorded such a merge at
 * all was undecided, a fixture that guessed would have been the website
 * answering a question it does not own, and every component built against the
 * guess would have hardened around it.
 *
 * The decision landed on 12 Sep 2026. A merge that admits nothing publishes no
 * version and is recorded as an `EmptyMerge`, so `empty_merges` below carries
 * both kinds: slots whose pool was empty, and slots that weighed a real pool and
 * kept none of it. The second is the one components get wrong, because its
 * contributions are 'excluded' and draw as grey dots, and a chart that took its
 * merge markers from `soups` alone would leave them in a stretch of timeline
 * with no merge in it under a legend saying a merge had assessed them.
 */

import {
  CAMPAIGN_SCHEMA_VERSION,
  CampaignRecord,
  CampaignSummary,
  ContributionRecord,
  ContributorRecord,
  EmptyMerge,
  RoundRecord,
  SiteRecord,
  SoupRecord,
} from '../../types/campaign';

/**
 * One Cellpose-SAM checkpoint, in bytes.
 *
 * The campaign soups FULL WEIGHTS rather than a low-rank adapter, which is the
 * aggregation decision of 12 Sep 2026 and not a detail: it is roughly 370 times
 * the adapter figure this fixture carried through 0.8.0-draft, and every
 * transport number on the async screen moves with it.
 *
 * That is the point of changing it here rather than leaving a small number in
 * place. The "too much data to move" argument has to survive the real payload,
 * and with full weights the two figures it rests on are about 134 GB moved
 * against 11.4 TB held, not 12 GB against 11.4 TB. Still two orders of
 * magnitude apart, still no ratio drawn between them, and now the panel is
 * showing the campaign that is actually being run.
 */
const CHECKPOINT_BYTES = 1_300_000_000;

/**
 * A deterministic stand-in for a merged-weights digest. Not a real hash and not
 * claimed to be one: it exists so the round log renders the same shape the live
 * record will, with digests that agree within a round and differ between them.
 */
function fixtureDigest(seedText: string): string {
  let h = 2166136261;
  for (let i = 0; i < seedText.length; i += 1) {
    h ^= seedText.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  const block = (h >>> 0).toString(16).padStart(8, '0');
  return `${block}${block}${block}${block}`;
}

// Day 0 of the campaign. Every timestamp below is an offset from it, so the
// fixture is deterministic and the wall-clock axis has real spacing on it
// rather than evenly-spaced ticks pretending to be times.
const CAMPAIGN_START_MS = Date.UTC(2026, 5, 15, 9, 0, 0);
const DAY_MS = 86_400_000;

/** The day the fixture is generated "as of". Contributions land up to here. */
const TODAY = 89;

/** Soups run every 7 days from day 7, which is what makes the trigger scheduled. */
const SOUP_INTERVAL_DAYS = 7;

function isoAt(day: number, hourOffset = 0): string {
  return new Date(CAMPAIGN_START_MS + day * DAY_MS + hourOffset * 3_600_000).toISOString();
}

interface ContributorSeed {
  id: string;
  name: string;
  country: string;
  /** Day this contributor first contributed. */
  joinDay: number;
  /** Days between this contributor's runs. Varies, because nobody is in lockstep. */
  cadence: number;
  nTrainImages: number;
  dataset: { name: string; objects: string };
  accelerator: string;
}

// Nine contributors, joining over three months. The roster GROWS, which is the
// shape an open campaign has and a fixed consortium does not.
const CONTRIBUTOR_SEEDS: ContributorSeed[] = [
  { id: 'northfield', name: 'Northfield Imaging Centre', country: 'Sweden', joinDay: 0, cadence: 17, nTrainImages: 41200,
    dataset: { name: 'northfield-nuclei', objects: 'fluorescence nuclei' }, accelerator: 'NVIDIA A100' },
  { id: 'rivermouth', name: 'Rivermouth Bioimaging Facility', country: 'Germany', joinDay: 0, cadence: 21, nTrainImages: 28400,
    dataset: { name: 'rivermouth-cyto', objects: 'cytoplasm, brightfield' }, accelerator: 'NVIDIA A100' },
  { id: 'kestrel', name: 'Kestrel Institute Microscopy Core', country: 'Netherlands', joinDay: 3, cadence: 26, nTrainImages: 19800,
    dataset: { name: 'kestrel-organoids', objects: 'organoid cross-sections' }, accelerator: 'NVIDIA L40S' },
  { id: 'saltmarsh', name: 'Saltmarsh Marine Station', country: 'Portugal', joinDay: 12, cadence: 19, nTrainImages: 12600,
    dataset: { name: 'saltmarsh-plankton', objects: 'plankton, phase contrast' }, accelerator: 'NVIDIA A40' },
  { id: 'highvale', name: 'Highvale Pathology Unit', country: 'Ireland', joinDay: 19, cadence: 23, nTrainImages: 22500,
    dataset: { name: 'highvale-tissue', objects: 'H&E tissue sections' }, accelerator: 'NVIDIA A100' },
  { id: 'thornbury', name: 'Thornbury Plant Phenotyping Lab', country: 'France', joinDay: 33, cadence: 16, nTrainImages: 31700,
    dataset: { name: 'thornbury-roots', objects: 'root tips, brightfield' }, accelerator: 'NVIDIA L40S' },
  { id: 'copperlake', name: 'Copperlake Neuroimaging Group', country: 'Canada', joinDay: 47, cadence: 24, nTrainImages: 17300,
    dataset: { name: 'copperlake-neurons', objects: 'cultured neurons' }, accelerator: 'NVIDIA A40' },
  { id: 'driftwood', name: 'Driftwood Coastal Ecology Unit', country: 'Australia', joinDay: 61, cadence: 20, nTrainImages: 9400,
    dataset: { name: 'driftwood-diatoms', objects: 'diatoms, darkfield' }, accelerator: 'NVIDIA T4' },
  { id: 'ashgrove', name: 'Ashgrove Developmental Biology Unit', country: 'Japan', joinDay: 75, cadence: 22, nTrainImages: 26100,
    dataset: { name: 'ashgrove-embryos', objects: 'embryo cross-sections' }, accelerator: 'NVIDIA A100' },
];

/** Every scheduled merge slot. Not every one of these produces a version. */
const SCHEDULED_SOUP_DAYS: number[] = [];
for (let day = SOUP_INTERVAL_DAYS; day <= TODAY; day += SOUP_INTERVAL_DAYS) {
  SCHEDULED_SOUP_DAYS.push(day);
}

/** One finished local run, before soup slots are resolved to versions. */
interface RawContribution {
  seed: ContributorSeed;
  /** 0-based index of this run within its own contributor's stream. */
  n: number;
  /** Day the run finished and the weights were pushed. */
  day: number;
  /** Day the run started, which is what decides how stale its base version is. */
  startDay: number;
}

/**
 * The raw contribution stream.
 *
 * Generated per contributor from its own cadence and join day, so the stream is
 * genuinely unordered across contributors: two arrive on day 51, none arrive on
 * day 52, and nothing about the sequence is periodic. That is the property the
 * wall-clock axis exists to show, and an evenly-spaced fixture would let a chart
 * that silently treats the index as the axis look correct.
 */
const RAW: RawContribution[] = (() => {
  const out: RawContribution[] = [];
  CONTRIBUTOR_SEEDS.forEach((seed) => {
    let n = 0;
    for (let day = seed.joinDay; day <= TODAY; day += seed.cadence) {
      out.push({ seed, n, day, startDay: n === 0 ? day : day - seed.cadence });
      n += 1;
    }
  });
  return out.sort((a, b) => a.day - b.day);
})();

/** A contribution's id, in one place, because four builders key off it. */
const idOf = (r: RawContribution) => `${r.seed.id}-${r.n}`;

/**
 * Whether the greedy gate admitted one contribution.
 *
 * Deterministic and ARBITRARY, and the arbitrariness is the honest part. A real
 * gate admits a checkpoint when adding it improves the pooled model on a
 * held-out split, which depends on what else is already in the soup and on data
 * nothing in this repository has. Any rule invented here that LOOKED principled
 * would be a claim about why contributions get left out, and it would be read as
 * one: a fixture where the stale bases or the small datasets are the ones
 * dropped teaches a reader a pattern the real campaign never asserted.
 *
 * So this is a hash of the id and nothing else. No property of the data
 * correlates with the outcome, and the only thing a component can learn from it
 * is how to render the state.
 *
 * The salt and the modulus were then chosen, out of several that give a similar
 * rate, for two properties a bare hash cannot guarantee at n=33.
 *
 * The refusals land on ALL NINE contributors and on at most two apiece. A hash
 * that happened to grey out one contributor's entire lane would be read as a
 * finding about that contributor, and "it was random, honestly" is not something
 * a screenshot can say back.
 *
 * And two merge slots weigh a real pool and admit none of it, one of them a pool
 * of three rather than of one. That case has to occur here or nothing renders
 * it: the empty-merge marker, the caption that explains it, and the grey dots
 * that would otherwise sit under no merge at all are only exercised when the
 * gate declines a whole pool, and a pool of one declined is a weak version of
 * the case. Picking the salt for that is the same kind of choice as picking it
 * for the spread. It is a choice about what the fixture COVERS, not about which
 * contributions get left out, which stays a hash of the id and nothing else.
 */
function admitted(r: RawContribution): boolean {
  // Roughly one in three assessed, which is the order of selectivity a greedy
  // soup actually shows once the pool stops being tiny.
  return parseInt(fixtureDigest(`gate-a/${idOf(r)}`).slice(0, 4), 16) % 3 !== 0;
}

/**
 * One scheduled merge, resolved: what it weighed and what it kept.
 *
 * The slot is the unit, not the soup, because a slot is what the schedule
 * produces and a soup is only one of the two things a slot can end in. Deriving
 * the soup list from the slot list rather than the other way round is what lets
 * the empty case exist at all: a fixture built soup-first has nowhere to put a
 * merge that published nothing, which is exactly how it went missing until the
 * backend semantics landed on 12 Sep 2026.
 */
interface MergeSlot {
  day: number;
  /** Everything that had arrived since the previous slot. May be empty. */
  pool: RawContribution[];
  /** What the gate admitted. May be empty even when the pool is not. */
  taken: RawContribution[];
}

const SLOTS: MergeSlot[] = SCHEDULED_SOUP_DAYS.map((day, i) => {
  // Merges land at hour 2 and pushes at hour 3 or later, so a contribution
  // recorded on the day of a merge missed it and waits for the next one.
  const previous = i === 0 ? -1 : SCHEDULED_SOUP_DAYS[i - 1];
  const pool = RAW.filter((r) => r.day >= previous && r.day < day);
  // No fallback. An earlier revision of this fixture forced every slot to admit
  // at least one candidate, because whether the backend even recorded a merge
  // that admitted nothing was undecided and a fixture that guessed would have
  // hardened every component around the guess. That decision has been taken, so
  // the guard is gone and the gate is allowed to decline a whole pool.
  return { day, pool, taken: pool.filter(admitted) };
});

/**
 * The slots that published a version, in order, and the slots that did not.
 *
 * Two ways to publish nothing and the fixture carries both, because the page
 * phrases them differently and only one of them is interesting. A slot with an
 * empty pool is a quiet fortnight. A slot that weighed candidates and kept none
 * is the community model being good enough that nothing on offer improved it.
 */
const PUBLISHED_SLOTS = SLOTS.filter((s) => s.taken.length > 0);
const EMPTY_SLOTS = SLOTS.filter((s) => s.taken.length === 0);

/**
 * The days a version was published.
 *
 * A scheduled soup with nothing to fold does NOT publish a checkpoint. It would
 * be byte-identical to the one before it, so the version number would move while
 * the model did not, and the lineage would carry a release that changed nothing.
 * The schedule triggers a merge attempt. A version is what comes out of a merge
 * that had something to merge AND kept some of it.
 *
 * This is also why `SoupRecord.index` counts published merges rather than slots,
 * and why nothing may derive a cadence by dividing elapsed time by version count.
 */
const SOUP_DAYS = PUBLISHED_SLOTS.map((s) => s.day);

/** The published version current on a given day, or null before the first merge. */
function versionAt(day: number): string | null {
  const n = SOUP_DAYS.filter((d) => d <= day).length;
  return n === 0 ? null : `v${n}`;
}

/** contribution_id -> the soup_id that folded it in. Absent means no merge took it. */
const TAKEN_BY = new Map<string, string>();
PUBLISHED_SLOTS.forEach((slot, soupIndex) => {
  slot.taken.forEach((r) => TAKEN_BY.set(idOf(r), `soup-${soupIndex}`));
});

/**
 * Every contribution that some merge weighed, taken or not.
 *
 * A SET and not a map to a soup_id, which it used to be. A contribution weighed
 * by a merge that published nothing was still weighed, and there is no soup_id
 * to name as the thing that weighed it. Keying on the outcome would have made
 * those contributions look unassessed, which would have put them back in
 * 'pending' forever: still waiting for a merge that has already happened.
 */
const ASSESSED = new Set<string>();
SLOTS.forEach((slot) => slot.pool.forEach((r) => ASSESSED.add(idOf(r))));

function buildContributions(): ContributionRecord[] {
  // Sorted by received_at, because that is the ordering key the schema names.
  // Two runs finishing the same day are ordered by their hour offset, not by
  // which contributor happens to come first in the seed list.
  return RAW.map((raw) => {
    const { seed, day, startDay } = raw;
    const id = idOf(raw);
    const takenBy = TAKEN_BY.get(id) ?? null;
    const assessed = ASSESSED.has(id);
    return {
      contribution_id: id,
      contributor_id: seed.id,
      // Offset by contributor so two runs finishing the same day do not land on
      // an identical timestamp.
      received_at: isoAt(day, 3 + (seed.cadence % 11)),
      // Which community version existed when this run STARTED. Contributors
      // begin from whatever was current, which may be several soups behind by
      // the time they finish, and that staleness is a real property of async
      // training rather than a defect to smooth over.
      base_version: versionAt(startDay),
      bytes_out: CHECKPOINT_BYTES,
      n_train_images: seed.nTrainImages,
      dataset_name: seed.dataset.name,
      declared: ['n_train_images', 'dataset_name'],
      // Three states, all of them reachable since the greedy ruling of
      // 12 Sep 2026. 'excluded' means a merge assessed this checkpoint and the
      // pooled model did not improve on the held-out split when it was added.
      // It says nothing about the contributor and nothing about the data: the
      // same checkpoint offered against a different soup could well go in, which
      // is why the state is not terminal and why nothing downstream counts it.
      disposition: !assessed ? 'pending' : takenBy !== null ? 'included' : 'excluded',
      merged_into: takenBy,
    };
  }).sort((a, b) => a.received_at.localeCompare(b.received_at));
}

const CONTRIBUTIONS = buildContributions();

/**
 * The soup stream: one merge per scheduled interval that had something to fold,
 * each writing an immutable community checkpoint version.
 */
function buildSoups(): SoupRecord[] {
  return PUBLISHED_SLOTS.map((slot, index) => {
    const day = slot.day;
    const soupId = `soup-${index}`;
    const folded = CONTRIBUTIONS.filter((c) => c.merged_into === soupId);
    const poolIds = new Set(slot.pool.map(idOf));
    const pool = CONTRIBUTIONS.filter((c) => poolIds.has(c.contribution_id));
    // Included only. A contribution the gate assessed and did not take is not in
    // the published checkpoint, so counting it here would overstate what the
    // model was built from.
    const cumulative = CONTRIBUTIONS.filter(
      (c) => c.merged_into !== null && index >= Number(c.merged_into.split('-')[1])
    ).length;
    // Everyone who had contributed at least once by this merge pulls the new
    // version, which is what the outbound byte count is a multiple of. It is
    // NOT a scoring denominator: the witness figure below is one central
    // measurement on a campaign-held split, not a mean over these people.
    const pullers = CONTRIBUTOR_SEEDS.filter((s) => s.joinDay < day).length;
    const version = `v${index + 1}`;
    const ceiling = 0.906;
    const witness = Number((ceiling - (ceiling - 0.71) * Math.exp(-cumulative / 14)).toFixed(4));
    // The gate's own number, and note what it does that the witness figure does
    // not: it climbs on EVERY merge without exception, because a merge only
    // publishes a version when the gate improved. That is the circularity in
    // numeric form. It is carried here so the fixture exercises the field and
    // the refusal that protects it, not so anything can draw it.
    const gate = Number((0.612 + 0.0173 * (index + 1)).toFixed(4));
    const digest = fixtureDigest(`cellpose-sam-community/${version}`);
    return {
      soup_id: soupId,
      index,
      merged_at: isoAt(day, 2),
      contributions: folded.map((c) => c.contribution_id),
      // Everything the gate looked at, which is a superset of what it took.
      // Published so the page can say "folded in 3 of 7 assessed" rather than
      // leaving a reader to infer that four contributions never arrived.
      assessed: pool.map((c) => c.contribution_id),
      // Uniform averaging over whatever the gate admitted, so there is no
      // per-contribution weight to publish. Null here is inapplicable, NOT a
      // withhold, and `aggregation.weighting` is what tells a reader which of
      // the two they are looking at.
      weights: null,
      community_model: {
        artifact_id: 'bioimage-io/cellpose-sam-community',
        version,
        url: `#/models/cellpose-sam-community?version=${version}`,
        n_contributions_cumulative: cumulative,
      },
      witness_metric: {
        role: 'witness' as const,
        // A campaign-owned split, scored centrally on one machine, so there is
        // no pooling and no participant denominator. This is the shape the
        // model-finetune backend actually emits, and the reason `aggregate_scope`
        // exists: the earlier draft of this fixture pooled per-contributor
        // scores, which made `n_sites_scored` the curve's denominator and put
        // the whole async arm under the scoring floor. The real producer has no
        // such number to report, and would have had to invent one to be drawn.
        aggregate_scope: 'campaign_holdout' as const,
        name: 'mean instance F1 at IoU 0.5',
        higher_is_better: true,
        // Withheld by the standing disclosure rule. A per-contributor curve is
        // a public leaderboard of whose data is hardest, and that is a worse
        // hazard in an open community than in a closed consortium.
        //
        // Under 'campaign_holdout' it is also structurally empty: nothing here
        // was measured per participant, so there is no map to withhold. Both
        // readings give null, and the page refuses the record outright if a
        // holdout-scoped metric ever arrives carrying one.
        per_site: null,
        per_site_basis: null,
        aggregate: witness,
        aggregate_basis:
          'scored on the campaign holdout, which is held back from the selection split and from every contributor',
        // Legitimately absent rather than withheld. See `AggregateScope`.
        n_sites_scored: null,
        // No per-unit map at all, so no key space to count in.
        n_datasets_scored: null,
        aggregate_withheld: null,
      },
      selection_metric: {
        role: 'selection' as const,
        // Also campaign-held: the gate runs centrally against a split the
        // campaign owns. Declared for the same reason the witness is, even
        // though the role refusal fires first and this figure is never a curve.
        aggregate_scope: 'campaign_holdout' as const,
        name: 'pooled AP50 on the selection split',
        higher_is_better: true,
        per_site: null,
        per_site_basis: null,
        aggregate: gate,
        aggregate_basis: 'the score the greedy gate admitted contributions against, on the split it selects on',
        n_sites_scored: null,
        n_datasets_scored: null,
        aggregate_withheld: null,
      },
      global_sha256: digest,
      transport: {
        // The merge distributes the new version to everyone who pulls it.
        bytes_out: CHECKPOINT_BYTES * pullers,
        // Every ASSESSED checkpoint crossed the network, including the ones the
        // gate declined. Billing this to the taken set would be the audit
        // quietly undercounting itself.
        bytes_in: CHECKPOINT_BYTES * pool.length,
        n_transfers: pullers + pool.length,
        sources_complete: true,
      },
    };
  });
}

const SOUPS = buildSoups();

/**
 * The merges that ran and published nothing.
 *
 * Both kinds, and the fixture needs both because the page says different things
 * about them. `assessed` empty is a slot whose fortnight brought nothing in.
 * `assessed` non-empty is a slot that weighed what arrived and kept none of it,
 * which is the case the backend and this schema spent a round trip on, and the
 * one a component is most likely to get wrong: the contributions in it are
 * 'excluded', so they draw as grey dots, and without a marker here they would sit
 * in a stretch of timeline with no merge in it at all.
 *
 * No index and no version, because there is nothing to number. The transport is
 * inbound only: the candidates were pulled and scored, and nothing went back out
 * because there was no new version to send.
 */
function buildEmptyMerges(): EmptyMerge[] {
  return EMPTY_SLOTS.map((slot) => ({
    merged_at: isoAt(slot.day, 2),
    assessed: slot.pool.map(idOf),
    transport: {
      // Nothing published, so nothing distributed. Zero here is a MEASUREMENT,
      // not a missing value: the merge really did send no bytes out.
      bytes_out: 0,
      bytes_in: CHECKPOINT_BYTES * slot.pool.length,
      n_transfers: slot.pool.length,
      sources_complete: true,
    },
  }));
}

const EMPTY_MERGES = buildEmptyMerges();

function toContributor(seed: ContributorSeed): ContributorRecord {
  const mine = CONTRIBUTIONS.filter((c) => c.contributor_id === seed.id);
  return {
    contributor_id: seed.id,
    contributor_name: seed.name,
    country: seed.country,
    joined_at: isoAt(seed.joinDay),
    latest_contribution_at: mine.length ? mine[mine.length - 1].received_at : null,
    n_contributions: mine.length,
    accelerator: seed.accelerator,
    datasets: [
      {
        name: seed.dataset.name,
        objects: seed.dataset.objects,
        n_train: seed.nTrainImages,
        n_val: Math.round(seed.nTrainImages * 0.12),
        n_test: Math.round(seed.nTrainImages * 0.1),
        source: 'Local facility archive',
        licence: 'CC-BY-4.0',
        // Private facility archives, so a fingerprint would act as a
        // membership oracle over data nobody else can see.
        split_fingerprint: null,
      },
    ],
    n_train_images: seed.nTrainImages,
    bioengine_version: '0.7.2',
    // Everything a contributor typed into its join form. The platform measured
    // none of it, and the roster marks each one so a reader can tell.
    declared: ['site_name', 'country', 'datasets', 'n_train_images'],
  };
}

const CONTRIBUTORS = CONTRIBUTOR_SEEDS.map(toContributor);

const ASYNC_TRANSFERS =
  CONTRIBUTIONS.length + SOUPS.reduce((a, s) => a + (s.transport?.n_transfers ?? 0), 0);

const CELLPOSE_SAM_CAMPAIGN: CampaignRecord = {
  schema_version: CAMPAIGN_SCHEMA_VERSION,
  campaign_id: 'cellpose-sam-community',
  title: 'Community Cellpose-SAM fine-tuning',
  description:
    'An open community fine-tunes Cellpose-SAM on microscopy archives that are too large to move. '
    + 'Each contributor trains locally, whenever it suits them, and the checkpoints that come back '
    + 'are periodically averaged into a community model that everyone can use. Each merge tries the '
    + 'checkpoints it has received one at a time and keeps the ones that improve the pooled model.',
  // Open AND accumulating. For an async campaign these are the same state, not
  // two: it is permanently joinable and it has been training since June. A
  // status of 'running' would read as closed to new contributors, which is the
  // opposite of what this campaign is.
  status: 'open',
  // Not a slice of a larger experiment. There is no arm and no seed to pin,
  // because there is no round number for them to disambiguate.
  experiment: null,
  policy: {
    // Private facility archives throughout, which is why the fingerprints
    // above are null.
    public_data_campaign: false,
    // No per-deployment credential exists yet, so the roster is a list of
    // self-declared names and the page says so. This matters MORE in an open
    // campaign: the roster is no longer a short list of known institutions a
    // reader could sanity-check by eye.
    roster_attested: false,
    // True here, and the reasoning differs from the synchronous case rather
    // than contradicting it. What that flag protects against is a partial
    // observation being read as a result, and a mid-experiment comparison
    // between sites. A soup's figure is neither: it evaluates an immutable,
    // published checkpoint that people can download and use, so its score is a
    // model-card number rather than a peek at a running experiment. The
    // per-contributor curves stay withheld, which is the half of the disclosure
    // that was ever about comparison.
    outcomes_released: true,
    // Kept, and inert on this campaign's current metrics, which is the correct
    // state rather than a leftover. Three rules out the case where a pooled
    // figure is one contributor's own result wearing a community label. Both
    // metrics here are campaign-held holdouts, so nothing they publish is
    // pooled over contributors and the floor has nothing to check. It stays
    // because the campaign is open-ended: the moment it publishes a figure
    // pooled over participant-held data, the threshold it is checked against
    // has to already be on the record, not chosen after the number is known.
    aggregate_min_scoring_sites: 3,
  },
  base_model: {
    id: 'bioimage-io/cellpose-sam',
    name: 'Cellpose-SAM',
    url: '#/models/cellpose-sam',
  },
  // Greedy souping. A merge walks the checkpoints it has received, adds each to
  // the pool in turn, and keeps it only if the pooled model improves on the
  // selection split. Whatever survives is averaged with equal weight, which is
  // why SoupRecord.weights stays null as inapplicable rather than as a withhold:
  // the selection is where the decision lives, not the weighting.
  aggregation: { method: 'greedy soup', weighting: 'uniform' },
  licence_policy: {
    accepted_data_licences: ['CC0-1.0', 'CC-BY-4.0'],
    model_licence: 'CC-BY-4.0',
  },
  progress: {
    mode: 'asynchronous',
    started_at: isoAt(0),
    contributions: CONTRIBUTIONS,
    soups: SOUPS,
    // Stock Cellpose-SAM on the same holdout, scored before anything was folded
    // in. Same name and same scope as the soups' witness metrics, which is what
    // makes it comparable to them at all, and 0.71 is not a free parameter: it
    // is the value the curve above takes at zero folded contributions, so the
    // reference line meets the lineage where the lineage starts.
    //
    // It is here and not in `soups` deliberately. See `baseline_metric`.
    baseline_metric: {
      role: 'witness' as const,
      aggregate_scope: 'campaign_holdout' as const,
      name: 'mean instance F1 at IoU 0.5',
      higher_is_better: true,
      per_site: null,
      per_site_basis: null,
      aggregate: 0.71,
      aggregate_basis: 'the published Cellpose-SAM weights, scored on the campaign holdout before the first merge',
      n_sites_scored: null,
      n_datasets_scored: null,
      aggregate_withheld: null,
    },
    // Every scheduled slot that published no version, which is what makes the
    // merge markers on the stream complete. Without these the chart would show
    // eleven merges for a campaign that ran more than eleven.
    empty_merges: EMPTY_MERGES,
    contributors: CONTRIBUTORS,
    // Weekly, so the page may render a next merge. Under 'manual' there would
    // be nothing to predict, and under 'on_contributions' a countdown would
    // depend on when volunteers finish runs on hardware nobody here controls.
    merge_trigger: {
      kind: 'scheduled',
      // Off the schedule, not off the last published version. A slot that
      // published nothing still consumed its turn, so counting forward from the
      // newest version would predict a merge that has already gone by.
      next_merge_at: isoAt(
        SCHEDULED_SOUP_DAYS[SCHEDULED_SOUP_DAYS.length - 1] + SOUP_INTERVAL_DAYS,
        2
      ),
      contributions_per_merge: null,
    },
  },
  reporting: { dropped_reports: 0, reconciled: false, reconciled_at: null },
  transport: {
    // The clean case: one service process for the whole campaign, so its log
    // covers every transfer and the total means what it says.
    observed: {
      valid: true,
      invalid_reason: null,
      per_site: null,
      per_site_basis: null,
      driver: {
        bytes_out:
          CHECKPOINT_BYTES * CONTRIBUTIONS.length
          + SOUPS.reduce((a, s) => a + (s.transport?.bytes_out ?? 0), 0),
        bytes_in:
          CHECKPOINT_BYTES * CONTRIBUTIONS.length
          + SOUPS.reduce((a, s) => a + (s.transport?.bytes_in ?? 0), 0),
        n_transfers: ASYNC_TRANSFERS,
      },
      windows: [
        {
          source: 'driver',
          first_seq: 0,
          last_seq: ASYNC_TRANSFERS - 1,
          n_transfers: ASYNC_TRANSFERS,
        },
      ],
    },
    computed: null,
    kinds_transferred: ['model_weights'],
    only_weights_left_site: true,
    images_moved_bytes: 0,
    // The byte figure is what the facilities said they hold. Nothing in the
    // platform measures the size of an archive it never touches, so the ratio
    // built on this renders marked as a declared denominator.
    images_held: { n_images: 124500 },
    declared_data_bytes: 11_400_000_000_000,
  },
  payload: {
    kind: 'full_state_dict',
    label: 'Full Cellpose-SAM checkpoint',
    // Null: this campaign has no rounds, so a per-round-per-site figure would
    // be a number about a schedule it does not have.
    bytes_per_site_per_round: null,
    bytes_per_contribution: CHECKPOINT_BYTES,
  },
  stewards: [{ name: 'Campaign steward', workspace: 'bioimage-io' }],
  // The latest soup's checkpoint. The lineage lives on the soup series rather
  // than being duplicated here: two lists that must stay in step is how they
  // drift, and this field is the pointer to the current head of that series.
  published_model: {
    artifact_id: 'bioimage-io/cellpose-sam-community',
    version: `v${SOUPS.length}`,
  },
  generated_at: isoAt(TODAY, 6),
};

const UNET_SITES: SiteRecord[] = [
  {
    site_id: 'site-a',
    site_name: 'Consortium site A',
    country: null,
    role: 'founding',
    joined_round: 0,
    left_round: null,
    accelerator: 'NVIDIA A100',
    datasets: [
      {
        name: 'dsb2018',
        objects: 'nuclei',
        n_train: 536,
        n_val: 67,
        n_test: 67,
        source: 'Data Science Bowl 2018',
        licence: 'CC0-1.0',
        citation: 'Caicedo et al., Nature Methods 2019',
        split_fingerprint: 'a41f0c7e',
      },
    ],
    n_train_images: 536,
    activity: 'reported',
    bioengine_version: '0.7.2',
    // Public benchmark data, read off disk by the site's own loader, so the
    // counts are measured rather than typed into a form. Only the display
    // name is declared.
    declared: ['site_name'],
  },
  {
    site_id: 'site-b',
    site_name: 'Consortium site B',
    country: null,
    role: 'founding',
    joined_round: 0,
    left_round: null,
    accelerator: 'NVIDIA A100',
    datasets: [
      {
        name: 'tissuenet',
        objects: 'whole cells',
        n_train: 482,
        n_val: 60,
        n_test: 61,
        source: 'TissueNet',
        licence: 'CC-BY-4.0',
        citation: 'Greenwald et al., Nature Biotechnology 2022',
        split_fingerprint: '9b2d5514',
      },
    ],
    n_train_images: 482,
    activity: 'reported',
    bioengine_version: '0.7.2',
    declared: ['site_name'],
  },
];

const UNET_STATE_DICT_BYTES = 7_760_000;

// One round where only one of the two sites reported a score. The aggregate is
// still in the record, and the chart deliberately withholds it: with two sites,
// an aggregate plus one per-site value reconstructs the other exactly.
const UNET_PARTIAL_ROUND = 7;

function unetRounds(total: number): RoundRecord[] {
  const rounds: RoundRecord[] = [];
  for (let round = 0; round < total; round += 1) {
    const per_site: Record<string, number> = {};
    UNET_SITES.forEach((site, i) => {
      const ceiling = 0.874 - i * 0.021;
      per_site[site.site_id] = Number(
        (ceiling - (ceiling - 0.41) * Math.exp(-round / 4)).toFixed(4)
      );
    });
    const values = Object.values(per_site);
    const aggregate = Number((values.reduce((a, b) => a + b, 0) / values.length).toFixed(4));
    if (round === UNET_PARTIAL_ROUND) {
      delete per_site['site-b'];
    }
    const digest = fixtureDigest(`unet-consortium/${round}`);
    rounds.push({
      round,
      participants: UNET_SITES.map((s) => s.site_id),
      eval_on: UNET_SITES.map((s) => s.site_id),
      merge_weights: { 'site-a': 536, 'site-b': 482 },
      metric: {
        // Lockstep FedAvg selects nothing, so this is a witness by
        // construction. It is still declared, because "by construction" is a
        // fact about the campaign and not a property of the record, and
        // `RoundRecord.metric` is typed `WitnessMetric` so the declaration is
        // what makes it assignable.
        role: 'witness' as const,
        // The opposite arm from the community soup above, and the reason both
        // exist in this file: this aggregate IS pooled over scores each site
        // computed on data it holds, so `n_sites_scored` is its denominator and
        // the floor is about exactly this number.
        aggregate_scope: 'participant_pool' as const,
        name: 'validation Dice',
        higher_is_better: true,
        per_site,
        per_site_basis: 'site' as const,
        aggregate,
        aggregate_basis: 'merge-weighted mean over the per-dataset validation Dice',
        // Both sites scored every round. Round 7 published only one of the two
        // curves, which is what makes its per-site map partial.
        n_sites_scored: UNET_SITES.length,
        // Site-keyed round, so this stays null. Setting it would be the
        // `count_key_space_mismatch` refusal, which is exactly what that gate
        // is for.
        n_datasets_scored: null,
        // The aggregate is present on every round including the partial one.
        // That is deliberate: this fixture exercises the PAGE refusing a figure
        // the record carries, which is a different path from the campaign
        // withholding one and saying why.
        aggregate_withheld: null,
      },
      global_sha256: digest,
      scored_with: { 'site-a': digest, 'site-b': digest },
      scored_with_basis: 'site' as const,
      transport: {
        bytes_out: UNET_STATE_DICT_BYTES * UNET_SITES.length,
        bytes_in: UNET_STATE_DICT_BYTES * UNET_SITES.length,
        n_transfers: UNET_SITES.length * 2,
        sources_complete: true,
      },
    });
  }
  return rounds;
}

const UNET_ALL_ROUNDS = unetRounds(12);

// Two round reports never reached the campaign service. Reporting is
// fire-and-forget, so a gap here is a lost record rather than a round that did
// not happen, and the driver's own committed arm record still has both. This
// campaign has completed, so the two have been reconciled and the remaining
// gaps are the ones reconciliation could not close.
const UNET_DROPPED_ROUNDS = [4, 9];
const UNET_ROUNDS = UNET_ALL_ROUNDS.filter((r) => !UNET_DROPPED_ROUNDS.includes(r.round));

// The driver was relaunched seven times over the run, so its in-memory log
// covers only the tail. The site logs cover far more. Adding them together
// would produce a total that looks complete and undercounts by most of the run.
const UNET_COMPUTED_BYTES =
  UNET_ALL_ROUNDS.length * (3 * UNET_SITES.length + 1) * UNET_STATE_DICT_BYTES;

const UNET_CAMPAIGN: CampaignRecord = {
  schema_version: CAMPAIGN_SCHEMA_VERSION,
  campaign_id: 'unet-consortium',
  title: 'U-Net nucleus segmentation consortium',
  description:
    'Two sites train a small U-Net on public benchmark datasets that stay where they are. '
    + 'The network is small enough that the whole state dict is exchanged each round.',
  status: 'completed',
  experiment: { arm: 'fedavg', seed: 0, run_id: 'unet-consortium-2026-07' },
  policy: {
    public_data_campaign: true,
    roster_attested: false,
    outcomes_released: true,
    // Two sites, so two is the only floor that admits a pooled figure at all.
    // A floor equal to the roster size is weaker than it looks: it is
    // underdetermined within one round, but across rounds where membership
    // changes while the protected quantity does not, the system can solve. This
    // fixture holds membership fixed, which is the case where it does not.
    aggregate_min_scoring_sites: 2,
  },
  base_model: null,
  aggregation: { method: 'FedAvg', weighting: 'sample count' },
  licence_policy: {
    accepted_data_licences: ['CC0-1.0', 'CC-BY-4.0'],
    model_licence: 'MIT',
  },
  progress: {
    mode: 'synchronous',
    round: { current: 12, total: 12, started_at: '2026-07-19T14:03:00Z' },
    rounds: UNET_ROUNDS,
    sites: UNET_SITES,
  },
  reporting: {
    dropped_reports: UNET_DROPPED_ROUNDS.length,
    reconciled: true,
    reconciled_at: '2026-07-21T08:40:00Z',
  },
  transport: {
    observed: {
      valid: false,
      invalid_reason:
        'The driver was relaunched several times during this run, so its log covers only the '
        + 'last stretch of it while the site logs cover much more.',
      per_site: null,
      per_site_basis: null,
      driver: {
        bytes_out: UNET_STATE_DICT_BYTES * 123,
        bytes_in: UNET_STATE_DICT_BYTES * 123,
        n_transfers: 246,
      },
      windows: [
        { source: 'driver', first_seq: 0, last_seq: 245, n_transfers: 246 },
        { source: 'site-a', first_seq: 0, last_seq: 1011, n_transfers: 1012 },
        { source: 'site-b', first_seq: 0, last_seq: 987, n_transfers: 988 },
      ],
    },
    computed: {
      bytes_moved: UNET_COMPUTED_BYTES,
      basis: '3N+1 transfers per round for N sites, times the measured payload size',
      validated_against: 'a single-site control run whose log covered the whole of it',
    },
    kinds_transferred: ['model_weights'],
    only_weights_left_site: true,
    images_moved_bytes: 0,
    // No byte figure exists for this campaign: the driver counts images on
    // public benchmark datasets and never measures their size on disk.
    // Public benchmark datasets, counted rather than sized. No byte figure
    // exists at all, so there is no basis to state and no ratio to render.
    images_held: { n_images: 1753 },
    declared_data_bytes: null,
  },
  payload: {
    kind: 'full_state_dict',
    label: 'Full state dict',
    bytes_per_site_per_round: UNET_STATE_DICT_BYTES,
    // Null: a synchronous campaign has no contributions to measure per.
    bytes_per_contribution: null,
  },
  stewards: [{ name: 'Campaign steward', workspace: 'bioimage-io' }],
  published_model: null,
  generated_at: '2026-09-06T00:00:00Z',
};

export const FIXTURE_CAMPAIGNS: Record<string, CampaignRecord> = {
  [CELLPOSE_SAM_CAMPAIGN.campaign_id]: CELLPOSE_SAM_CAMPAIGN,
  [UNET_CAMPAIGN.campaign_id]: UNET_CAMPAIGN,
};

function toSummary(record: CampaignRecord): CampaignSummary {
  const p = record.progress;
  const shared = {
    campaign_id: record.campaign_id,
    title: record.title,
    description: record.description,
    status: record.status,
    base_model: record.base_model,
    payload: record.payload,
    model_licence: record.licence_policy.model_licence,
  };
  if (p.mode === 'synchronous') {
    return {
      ...shared,
      progress: { mode: 'synchronous', round: { current: p.round.current, total: p.round.total } },
      n_active_sites: p.sites.filter((s) => s.role !== 'withdrawn' && s.role !== 'pending_review')
        .length,
      started_at: p.round.started_at,
    };
  }
  return {
    ...shared,
    progress: {
      mode: 'asynchronous',
      n_contributions: p.contributions.length,
      n_versions: p.soups.length,
    },
    // Everyone on the roster of an open campaign is active. There is no
    // withdrawn state to filter on, because a contributor that stops
    // contributing has not left, it has simply not contributed lately, and
    // `latest_contribution_at` is where a reader sees that.
    n_active_sites: p.contributors.length,
    started_at: p.started_at,
  };
}

export const FIXTURE_CAMPAIGN_SUMMARIES: CampaignSummary[] = [
  toSummary(CELLPOSE_SAM_CAMPAIGN),
  toSummary(UNET_CAMPAIGN),
];
