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
 * exercised against both of the profiles the schema has to serve:
 *
 *  - `cellpose-sam-community` mirrors the design mockup: a LoRA adapter
 *    payload, a byte figure for data held, a roster that grows mid-campaign,
 *    and a transport log whose per-source windows agree.
 *  - `unet-consortium` mirrors the first real campaign: full state dicts, no
 *    byte figure at all for data held (only image counts), a metric named
 *    "validation Dice" rather than a generic score, and a transport log whose
 *    windows do NOT agree, so the observed total is withheld and only the
 *    computed figure is offered, labelled as such.
 *
 * If a component renders the second one correctly, it cannot be hardcoding
 * "adapter", "TB", "score", or a summable transport log.
 */

import {
  CAMPAIGN_SCHEMA_VERSION,
  CampaignRecord,
  CampaignSummary,
  RoundRecord,
  SiteRecord,
} from '../../types/campaign';

const ADAPTER_BYTES = 3_500_000;

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

function adapterSite(
  site_id: string,
  site_name: string,
  country: string,
  joined_round: number,
  n_train_images: number,
  dataset: { name: string; objects: string },
  accelerator: string
): SiteRecord {
  return {
    site_id,
    site_name,
    country,
    role: joined_round === 0 ? 'founding' : 'joined',
    joined_round,
    left_round: null,
    accelerator,
    datasets: [
      {
        name: dataset.name,
        objects: dataset.objects,
        n_train: n_train_images,
        n_val: Math.round(n_train_images * 0.12),
        n_test: Math.round(n_train_images * 0.1),
        source: 'Local facility archive',
        licence: 'CC-BY-4.0',
        citation: null,
        // Private facility archives, so a fingerprint would act as a
        // membership oracle over data nobody else can see.
        split_fingerprint: null,
      },
    ],
    n_train_images,
    activity: 'reported',
    bioengine_version: '0.7.2',
    // Everything a site typed into its join form. The platform measured none
    // of it, and the roster marks each one so a reader can tell.
    declared: ['site_name', 'country', 'datasets', 'n_train_images'],
  };
}

const ADAPTER_SITES: SiteRecord[] = [
  adapterSite('northfield', 'Northfield Imaging Centre', 'Sweden', 0, 41200,
    { name: 'northfield-nuclei', objects: 'fluorescence nuclei' }, 'NVIDIA A100'),
  adapterSite('rivermouth', 'Rivermouth Bioimaging Facility', 'Germany', 0, 28400,
    { name: 'rivermouth-cyto', objects: 'cytoplasm, brightfield' }, 'NVIDIA A100'),
  adapterSite('kestrel', 'Kestrel Institute Microscopy Core', 'Netherlands', 20, 19800,
    { name: 'kestrel-organoids', objects: 'organoid cross-sections' }, 'NVIDIA L40S'),
  adapterSite('saltmarsh', 'Saltmarsh Marine Station', 'Portugal', 20, 12600,
    { name: 'saltmarsh-plankton', objects: 'plankton, phase contrast' }, 'NVIDIA A40'),
  adapterSite('highvale', 'Highvale Pathology Unit', 'Ireland', 40, 22500,
    { name: 'highvale-tissue', objects: 'H&E tissue sections' }, 'NVIDIA A100'),
];

function rosterAtRound(round: number): SiteRecord[] {
  return ADAPTER_SITES.filter((s) => (s.joined_round ?? 0) <= round);
}

function adapterRounds(total: number): RoundRecord[] {
  const rounds: RoundRecord[] = [];
  for (let round = 0; round < total; round += 1) {
    const roster = rosterAtRound(round);
    const participants = roster.map((s) => s.site_id);
    const merge_weights: Record<string, number> = {};
    const per_site: Record<string, number> = {};
    roster.forEach((site, i) => {
      merge_weights[site.site_id] = site.n_train_images ?? 0;
      // A plausible learning curve, offset per site so the lines are legible.
      const ceiling = 0.93 - i * 0.015;
      per_site[site.site_id] = Number(
        (ceiling - (ceiling - 0.62) * Math.exp(-round / 11)).toFixed(4)
      );
    });
    const values = Object.values(per_site);
    const digest = fixtureDigest(`cellpose-sam-community/${round}`);
    const scored_with: Record<string, string> = {};
    roster.forEach((site) => {
      scored_with[site.site_id] = digest;
    });
    rounds.push({
      round,
      participants,
      // Everyone on the roster at this round both trains and evaluates, so the
      // union term equals the participant count and the multiplier lands on
      // 3N+1. That is this campaign's shape, not the formula: a fold that
      // trains a subset would read differently, which is why the sets are
      // carried per round rather than a site count being carried once.
      eval_on: participants,
      merge_weights,
      metric: {
        name: 'validation F1',
        higher_is_better: true,
        // Withheld on purpose, and this is the DEFAULT disclosure for a
        // running campaign: a live per-site curve is a public leaderboard of
        // whose data is hardest. Only the aggregate is published.
        per_site: null,
        per_site_basis: null,
        aggregate: Number((values.reduce((a, b) => a + b, 0) / values.length).toFixed(4)),
        aggregate_basis: 'merge-weighted mean over the per-site validation F1',
        n_sites_scored: roster.length,
        // An aggregate is present, so nothing was withheld and there is no
        // cause to state. Null here is the absence of a decision, not a
        // decision to say nothing.
        aggregate_withheld: null,
      },
      global_sha256: digest,
      scored_with,
      scored_with_basis: 'site' as const,
      transport: {
        bytes_out: ADAPTER_BYTES * roster.length,
        bytes_in: ADAPTER_BYTES * roster.length,
        n_transfers: roster.length * 2,
        sources_complete: true,
      },
    });
  }
  return rounds;
}

const ADAPTER_ROUNDS = adapterRounds(35);

const ADAPTER_TRANSFERS = ADAPTER_ROUNDS.reduce((a, r) => a + (r.transport?.n_transfers ?? 0), 0);

const CELLPOSE_SAM_CAMPAIGN: CampaignRecord = {
  schema_version: CAMPAIGN_SCHEMA_VERSION,
  campaign_id: 'cellpose-sam-community',
  title: 'Community Cellpose-SAM fine-tuning',
  description:
    'Five imaging facilities fine-tune a shared segmentation foundation model on their own '
    + 'microscopy archives. The base model is frozen and only a low-rank adapter is trained, '
    + 'so what travels each round is a few megabytes of weights rather than the images.',
  status: 'running',
  experiment: { arm: 'fedavg', seed: 0, run_id: 'cellpose-sam-community-2026-08' },
  policy: {
    // Private facility archives throughout, which is why the fingerprints
    // above are null.
    public_data_campaign: false,
    // No per-deployment credential exists yet, so the roster is a list of
    // self-declared names and the page says so.
    roster_attested: false,
    // Still running, so no accuracy is published: the whole outcome axis is
    // withheld until the primary-metric rules resolve. This fixture exists to
    // exercise that path, which is the one every live campaign will be on.
    outcomes_released: false,
    // Four sites on the roster, so a floor of three still admits a pooled
    // figure while ruling out the case where the pooled figure is one site's
    // own result under a shared label.
    aggregate_min_eval_sites: 3,
  },
  base_model: {
    id: 'bioimage-io/cellpose-sam',
    name: 'Cellpose-SAM',
    url: '#/models/cellpose-sam',
  },
  aggregation: { method: 'FedAvg', weighting: 'sample count' },
  licence_policy: {
    accepted_data_licences: ['CC0-1.0', 'CC-BY-4.0'],
    model_licence: 'CC-BY-4.0',
  },
  round: { current: 34, total: 60, started_at: '2026-08-04T09:12:00Z' },
  sites: ADAPTER_SITES,
  rounds: ADAPTER_ROUNDS,
  reporting: { dropped_reports: 0, reconciled: false, reconciled_at: null },
  transport: {
    // The clean case: one driver process for the whole campaign, so its log
    // covers every transfer and the total means what it says.
    observed: {
      valid: true,
      invalid_reason: null,
      per_site: null,
      per_site_basis: null,
      driver: {
        bytes_out: ADAPTER_ROUNDS.reduce((a, r) => a + (r.transport?.bytes_out ?? 0), 0),
        bytes_in: ADAPTER_ROUNDS.reduce((a, r) => a + (r.transport?.bytes_in ?? 0), 0),
        n_transfers: ADAPTER_TRANSFERS,
      },
      windows: [
        {
          source: 'driver',
          first_seq: 0,
          last_seq: ADAPTER_TRANSFERS - 1,
          n_transfers: ADAPTER_TRANSFERS,
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
    kind: 'lora_adapter',
    label: 'LoRA adapter (r=8, qkv and head)',
    bytes_per_site_per_round: ADAPTER_BYTES,
  },
  stewards: [{ name: 'Campaign steward', workspace: 'bioimage-io' }],
  published_model: null,
  generated_at: '2026-09-06T00:00:00Z',
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
        name: 'validation Dice',
        higher_is_better: true,
        per_site,
        per_site_basis: 'site' as const,
        aggregate,
        aggregate_basis: 'merge-weighted mean over the per-dataset validation Dice',
        // Both sites scored every round. Round 7 published only one of the two
        // curves, which is what makes its per-site map partial.
        n_sites_scored: UNET_SITES.length,
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
    aggregate_min_eval_sites: 2,
  },
  base_model: null,
  aggregation: { method: 'FedAvg', weighting: 'sample count' },
  licence_policy: {
    accepted_data_licences: ['CC0-1.0', 'CC-BY-4.0'],
    model_licence: 'MIT',
  },
  round: { current: 12, total: 12, started_at: '2026-07-19T14:03:00Z' },
  sites: UNET_SITES,
  rounds: UNET_ROUNDS,
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
  return {
    campaign_id: record.campaign_id,
    title: record.title,
    description: record.description,
    status: record.status,
    base_model: record.base_model,
    round: { current: record.round.current, total: record.round.total },
    n_active_sites: record.sites.filter((s) => s.role !== 'withdrawn' && s.role !== 'pending_review')
      .length,
    payload: record.payload,
    model_licence: record.licence_policy.model_licence,
    started_at: record.round.started_at,
  };
}

export const FIXTURE_CAMPAIGN_SUMMARIES: CampaignSummary[] = [
  toSummary(CELLPOSE_SAM_CAMPAIGN),
  toSummary(UNET_CAMPAIGN),
];
