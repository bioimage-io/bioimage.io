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
 *    payload, a byte figure for data held, a roster that grows mid-campaign.
 *  - `unet-consortium` mirrors the first real campaign: full state dicts, no
 *    byte figure at all for data held (only image counts), and a metric named
 *    "validation Dice" rather than a generic score.
 *
 * If a component renders the second one correctly, it cannot be hardcoding
 * "adapter", "TB" or "score".
 */

import {
  CAMPAIGN_SCHEMA_VERSION,
  CampaignRecord,
  CampaignSummary,
  RoundRecord,
  SiteRecord,
} from '../../types/campaign';

const ADAPTER_BYTES = 3_500_000;

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
        split_fingerprint: null,
      },
    ],
    n_train_images,
    activity: 'reported',
    bioengine_version: '0.7.2',
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
    rounds.push({
      round,
      participants,
      merge_weights,
      metric: {
        name: 'validation F1',
        higher_is_better: true,
        // Withheld on purpose, and this is the DEFAULT disclosure for a
        // running campaign: a live per-site curve is a public leaderboard of
        // whose data is hardest. Only the aggregate is published.
        per_site: null,
        aggregate: Number((values.reduce((a, b) => a + b, 0) / values.length).toFixed(4)),
      },
      global_sha256: null,
      transport: {
        bytes_out: ADAPTER_BYTES * roster.length,
        bytes_in: ADAPTER_BYTES * roster.length,
        n_transfers: roster.length * 2,
      },
    });
  }
  return rounds;
}

const ADAPTER_ROUNDS = adapterRounds(35);

const CELLPOSE_SAM_CAMPAIGN: CampaignRecord = {
  schema_version: CAMPAIGN_SCHEMA_VERSION,
  campaign_id: 'cellpose-sam-community',
  title: 'Community Cellpose-SAM fine-tuning',
  description:
    'Five imaging facilities fine-tune a shared segmentation foundation model on their own '
    + 'microscopy archives. The base model is frozen and only a low-rank adapter is trained, '
    + 'so what travels each round is a few megabytes of weights rather than the images.',
  status: 'running',
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
  reporting: { dropped_reports: 0 },
  transport: {
    bytes_out: ADAPTER_ROUNDS.reduce((a, r) => a + (r.transport?.bytes_out ?? 0), 0),
    bytes_in: ADAPTER_ROUNDS.reduce((a, r) => a + (r.transport?.bytes_in ?? 0), 0),
    n_transfers: ADAPTER_ROUNDS.reduce((a, r) => a + (r.transport?.n_transfers ?? 0), 0),
    kinds_transferred: ['model_weights'],
    only_weights_left_site: true,
    images_moved_bytes: 0,
    images_held: { n_images: 124500, bytes: 11_400_000_000_000 },
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
  },
];

const UNET_STATE_DICT_BYTES = 7_760_000;

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
    rounds.push({
      round,
      participants: UNET_SITES.map((s) => s.site_id),
      merge_weights: { 'site-a': 536, 'site-b': 482 },
      metric: {
        name: 'validation Dice',
        higher_is_better: true,
        per_site,
        aggregate: Number((values.reduce((a, b) => a + b, 0) / values.length).toFixed(4)),
      },
      global_sha256: null,
      transport: {
        bytes_out: UNET_STATE_DICT_BYTES * UNET_SITES.length,
        bytes_in: UNET_STATE_DICT_BYTES * UNET_SITES.length,
        n_transfers: UNET_SITES.length * 2,
      },
    });
  }
  return rounds;
}

const UNET_ALL_ROUNDS = unetRounds(12);

// Two round reports never reached the campaign service. The transport log is
// kept by the driver itself and is not lossy, so the summary below still covers
// all twelve rounds while `rounds` has holes at 4 and 9. That asymmetry is the
// whole point of the dropped-report count: a gap in the series is a lost
// record, not a round that did not happen.
const UNET_DROPPED_ROUNDS = [4, 9];
const UNET_ROUNDS = UNET_ALL_ROUNDS.filter((r) => !UNET_DROPPED_ROUNDS.includes(r.round));

const UNET_CAMPAIGN: CampaignRecord = {
  schema_version: CAMPAIGN_SCHEMA_VERSION,
  campaign_id: 'unet-consortium',
  title: 'U-Net nucleus segmentation consortium',
  description:
    'Two sites train a small U-Net on public benchmark datasets that stay where they are. '
    + 'The network is small enough that the whole state dict is exchanged each round.',
  status: 'completed',
  base_model: null,
  aggregation: { method: 'FedAvg', weighting: 'sample count' },
  licence_policy: {
    accepted_data_licences: ['CC0-1.0', 'CC-BY-4.0'],
    model_licence: 'MIT',
  },
  round: { current: 12, total: 12, started_at: '2026-07-19T14:03:00Z' },
  sites: UNET_SITES,
  rounds: UNET_ROUNDS,
  reporting: { dropped_reports: UNET_DROPPED_ROUNDS.length },
  transport: {
    bytes_out: UNET_ALL_ROUNDS.reduce((a, r) => a + (r.transport?.bytes_out ?? 0), 0),
    bytes_in: UNET_ALL_ROUNDS.reduce((a, r) => a + (r.transport?.bytes_in ?? 0), 0),
    n_transfers: UNET_ALL_ROUNDS.reduce((a, r) => a + (r.transport?.n_transfers ?? 0), 0),
    kinds_transferred: ['model_weights'],
    only_weights_left_site: true,
    images_moved_bytes: 0,
    // No byte figure exists for this campaign: the driver counts images on
    // public benchmark datasets and never measures their size on disk.
    images_held: { n_images: 1753, bytes: null },
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
