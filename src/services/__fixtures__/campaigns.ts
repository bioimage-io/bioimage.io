/**
 * Illustrative campaign records, for design review only.
 *
 * These are reachable ONLY when `REACT_APP_CAMPAIGN_FIXTURES=1`, which no
 * production build sets. Whenever they are in use the pages show a persistent
 * prototype banner, so nothing here can be mistaken for a measurement.
 *
 * Every contributor name below is invented. No real institution appears,
 * because a real name on an illustrative roster reads as that institution
 * having joined a campaign that does not exist.
 *
 * ONE CAMPAIGN, and the file is smaller than it was for a reason worth
 * recording. Through 0.13.0-draft this file carried a second fixture,
 * `unet-consortium`, which was the SYNCHRONOUS initial test: lockstep rounds,
 * a site roster, full state dicts, per-round pooled Dice. It was deleted at
 * 0.14.0-draft along with the synchronous arm of the contract, because the
 * campaign programme targets FOUNDATION MODELS and a two-site U-Net is not
 * one. The app it described (`apps/federated-unet`) still runs and still keeps
 * its own data. It simply no longer has a website contract.
 *
 * What remains is the flagship. `cellpose-sam-community` is the ASYNCHRONOUS
 * model soup: an open community fine-tunes Cellpose-SAM locally, at its own
 * pace, and the checkpoints are periodically averaged into a growing community
 * model. Two event streams, a wall-clock axis, a version lineage, a
 * FULL-CHECKPOINT payload, GREEDY selection so some contributions are assessed
 * and not taken, a witness metric distinct from the selection gate, and a
 * transport log whose per-source windows agree.
 *
 * WHAT THE SECOND FIXTURE USED TO BUY, and what now has to be bought some
 * other way. It was the only record here that reached `status: 'completed'`
 * and the only one whose transport windows did NOT agree, so it was the only
 * exercise of the withheld-observed-total path. A permanently-open campaign
 * cannot reach either state, so those two paths are now covered by the spec's
 * own stubs rather than by a served corpus file. A component that regresses on
 * them will fail a test, not a page.
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
 * claimed to be one: it exists so the merge log renders the same shape the live
 * record will, with digests that agree within a merge and differ between them.
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

/**
 * How far apart this fixture spaces its merges, in days.
 *
 * A GENERATION CONVENIENCE, not a claim. Even spacing makes the stream readable
 * and the empty-merge slots easy to place. It used to be described as "what
 * makes the trigger scheduled", and that got the direction backwards: a merge
 * record says when a merge happened, and nothing about a set of timestamps
 * tells a reader what decided to run them.
 */
const MERGE_SPACING_DAYS = 7;

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

/**
 * Every day a merge ran. Not every one of these produces a version.
 *
 * Named for the merge, not for a schedule. Whatever decides to run a merge, the
 * record of one is the same shape.
 */
const MERGE_SLOT_DAYS: number[] = [];
for (let day = MERGE_SPACING_DAYS; day <= TODAY; day += MERGE_SPACING_DAYS) {
  MERGE_SLOT_DAYS.push(day);
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

const SLOTS: MergeSlot[] = MERGE_SLOT_DAYS.map((day, i) => {
  // Merges land at hour 2 and pushes at hour 3 or later, so a contribution
  // recorded on the day of a merge missed it and waits for the next one.
  const previous = i === 0 ? -1 : MERGE_SLOT_DAYS[i - 1];
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
/**
 * The gate's score for the model the campaign started from, on the SELECTION
 * split. Not the same figure as `baseline_metric`, which is the base model on
 * the WITNESS split, and deliberately a different number so the two cannot be
 * confused by eye or swapped without the value changing.
 *
 * This exists for one case: an empty FIRST merge, where there is no published
 * version yet and the bar a candidate failed to clear is the base model's own.
 * That case is the whole argument for `EmptyMerge.selection_metric` being a
 * field rather than something read off the preceding record, so the fixture
 * would be a poor test of it if the value were unavailable.
 */
const BASE_MODEL_GATE = 0.5981;

/** The gate score of the version current on a given day, or the base model's before the first. */
function gateBarAt(day: number): number {
  const published = SOUP_DAYS.filter((d) => d <= day).length;
  return published === 0
    ? BASE_MODEL_GATE
    : Number((0.612 + 0.0173 * published).toFixed(4));
}

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
    // The bar nothing cleared. Carried so the record is a complete audit row,
    // and never drawn, under the same role refusal that protects every other
    // selection figure. A merge that declines everything leaves the head
    // unchanged, so this is the head's own score and not a fresh measurement of
    // anything the merge produced.
    selection_metric: {
      role: 'selection' as const,
      aggregate_scope: 'campaign_holdout' as const,
      name: 'pooled AP50 on the selection split',
      higher_is_better: true,
      per_site: null,
      per_site_basis: null,
      aggregate: gateBarAt(slot.day),
      aggregate_basis:
        'the score the greedy gate required a contribution to beat, which none of the assessed contributions did',
      n_sites_scored: null,
      n_datasets_scored: null,
      aggregate_withheld: null,
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
    declared: ['contributor_name', 'country', 'datasets', 'n_train_images'],
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
    // Pinned, and the pin is the point. The zoo entry has two committed
    // versions with different weights (0.1.0, and 0.2.0 carrying cpsam_v2), so
    // "started from Cellpose-SAM" names a set. The baseline level on the
    // lineage chart is only reproducible if the record says which one it is.
    //
    // CONFIRMED UPSTREAM 12 Sep 2026 by digest, not by name, and the digest was
    // MEASURED rather than taken on the registry's word. The full 1,233,586,851
    // byte weight file at zoo idealistic-eagle v1 (the commit carrying
    // `version: 0.2.0`) was streamed through sha256sum and hashes to
    // 0f1cc3f7ecdd...c667. The backend reached the same digest and byte count
    // independently, from the file cellpose's own downloader resolves for the
    // name cpsam_v2, which is a different host and a different path to the same
    // bytes.
    //
    // WHAT THAT DOES AND DOES NOT ESTABLISH, because the two are easy to blur
    // and this comment had blurred them. It establishes the IDENTITY of the
    // checkpoint this fixture pins: the name cpsam_v2 and zoo 0.2.0 are the
    // same bytes. It does not by itself establish what any DEPLOYED worker
    // loaded, which is a claim about a machine nobody measured. A deployed soup
    // instance has since been hashed and reproduces the same digest, so that
    // claim is now partly observed rather than inferred from the download URL,
    // but "training ran from this checkpoint in deployment" still waits on the
    // campaign run itself. None of that weakens the pin, which is what this
    // field is for. It only marks where the evidence for the pin stops.
    //
    // Count the evidence carefully, because it is easy to inflate. Two
    // independent CONTENT measurements agree, reached by different routes. The
    // RDF's declared pytorch_state_dict sha is a third data point but not a
    // third measurement: it is the claim those measurements tested, and it
    // passed. That is worth recording in its own right, since the entire reason
    // this field is pinned by digest is that a registry's declared version can
    // be re-pointed, so "the declaration turned out to be accurate here" is a
    // finding rather than an assumption.
    //
    // Worth knowing before anyone re-derives this: the packaged weight file is
    // named `cpsam` in BOTH committed versions. Only the sha changes (v0
    // declares e1440429...abe2, the April 2025 cpsam). So matching on the
    // filename says "this entry ships cpsam, not cpsam_v2" and is wrong at
    // every version. The two-versions-one-name hazard that motivated pinning
    // this field in the first place turns out to repeat one level down, at the
    // file inside the package, which is why the digest is the identifier that
    // actually settles it.
    //
    // The backend still sends `version: null` because it reports what it loads
    // rather than resolving it to a zoo version, so the generic-label path is
    // live and both paths stay covered by tests.
    version: '0.2.0',
    // The measured digest, in full. Truncating it would leave a reader with the
    // appearance of content identification and no way to check anything, which
    // is the failure the field's own doc names.
    sha256: '0f1cc3f7ecdd8a037a57c6c48d9d8921391be4cbce3fa9f13c3e3a2e1253c667',
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
      // DISTINCT from every value the curve generates, on purpose. Three series
      // come out of the same scoring path here (witness, selection, baseline),
      // and a fixture where two of them can coincide only catches a swap by its
      // tag. Distinct values catch it by the number, which is the check that
      // still works when the tag is the thing that went wrong. It is also below
      // the whole curve, which is the shape the campaign is claiming.
      //
      // Deliberately NOT the curve's zero-contribution intercept, even though
      // that reads as tidier. Equal values are exactly what makes a
      // baseline/witness swap draw a plausible chart.
      aggregate: 0.6412,
      aggregate_basis:
        'Cellpose-SAM 0.2.0 as published, scored on the campaign holdout before the first merge',
      n_sites_scored: null,
      n_datasets_scored: null,
      aggregate_withheld: null,
    },
    // Every scheduled slot that published no version, which is what makes the
    // merge markers on the stream complete. Without these the chart would show
    // eleven merges for a campaign that ran more than eleven.
    empty_merges: EMPTY_MERGES,
    contributors: CONTRIBUTORS,
    // HALF STATED, HALF NULL, and the split is the point. Read this before
    // filling in the null half.
    //
    // This fixture said `kind: 'scheduled'` with a next-merge date until
    // 12 Sep 2026, which was FALSE about the campaign it stands for. The
    // model-finetune backend (live-kudu) then read the shipped code: no
    // scheduler, cron or timer fires a merge anywhere in the app, the only
    // timed calls being a PUT-retry backoff and training and export tasks, none
    // of which merge. The trigger went null while `kind` was the only field,
    // because none of manual | scheduled | on_contributions was true and the
    // nearest member would have been the fixture asserting what the schema
    // could express over what was the case.
    //
    // 0.13.0-draft split the rule from the actor, so the two halves no longer
    // share a fate.
    //
    // decided_by AND invoked_by ARE HELD NULL, and this is the half most likely
    // to be filled in by someone who reads only the first paragraph. Two
    // independent reasons, either of which is sufficient.
    //
    // ONE, the value would not be evidence. `aggregate()` threads no caller
    // identity, so `decided_by` would be a hard-set constant that reads 'agent'
    // no matter who called. A human invoking the same method would be
    // mislabelled by it, and threading a principal id would NOT repair that: a
    // principal id is an identity, not an actor TYPE, so it cannot separate an
    // agent from a person either. The field would be a label describing how the
    // campaign is meant to be operated, presented in the position where this
    // page puts measurements.
    //
    // TWO, and this is the binding one: how loudly the flagship claims agent
    // autonomy is not a call the page makes. "An agent decides each merge with
    // no rule behind it" is the strongest autonomy claim in the surrounding
    // work, and there is a conservative fork (give the campaign a simple merge
    // policy, weaker claim, more reproducible) that is a live option. That is
    // reserved for the project owner, and until it is decided the fixture does
    // not pre-empt it by asserting the loud version.
    //
    // Note what is NOT the reason: dishonesty. The no-timer finding is grounded
    // in shipped code and the agent-operated description is accurate. This is a
    // hold on a claim that is probably true, which is the kind most worth
    // holding deliberately rather than by accident.
    //
    // kind IS NULL, and not for want of asking. live-kudu checked: nothing in
    // the code fires a merge. There is no threshold, no cadence and no
    // schedule. The agent decides each merge by its own reading of the pool.
    // So there is no rule to name, and null says exactly that.
    //
    // 'manual' was offered as an alternative and is refused. It means a person
    // decided, and the whole finding here is that an agent did.
    //
    // DO NOT read max_batch=32 as `contributions_per_merge`. It bounds how many
    // undecided candidates a merge weighs once it has ALREADY been triggered,
    // deferring the overflow to be re-scored next time. It triggers nothing. It
    // is the most plausible wrong answer in the codebase to the question this
    // field asks, which is why it is written down here.
    // An all-null trigger rather than `merge_trigger: null`, and the difference
    // is small but real: this campaign HAS been characterised and the answer to
    // every question was "nothing to state yet". A missing trigger is a campaign
    // nobody asked about. The page renders them the same, the record does not.
    merge_trigger: {
      kind: null,
      decided_by: null,
      agent: null,
      next_merge_at: null,
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

export const FIXTURE_CAMPAIGNS: Record<string, CampaignRecord> = {
  [CELLPOSE_SAM_CAMPAIGN.campaign_id]: CELLPOSE_SAM_CAMPAIGN,
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
];
