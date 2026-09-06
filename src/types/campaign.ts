/**
 * Federation campaign records, as read by the Campaigns pages.
 *
 * DRAFT. This is the website's proposal for the JSON contract exposed by the
 * `federation-campaign` BioEngine app, written to be a thin view over what the
 * federated driver ALREADY records rather than a new vocabulary. The mapping,
 * against `apps/federated-unet/` in the bioengine repo:
 *
 *   TransportSummary  <- checkpoints.py  TransportLog.dump()
 *   RoundRecord       <- run_federated.py  round_records[]
 *   SiteRecord        <- entry.py  get_status() + push_weights()
 *
 * Nothing here is agreed with the backend yet. Bump CAMPAIGN_SCHEMA_VERSION on
 * any breaking change and keep the mapping comments accurate: they are what
 * makes it checkable that the page cannot display a number the driver never
 * measured.
 *
 * ## The nullability rule
 *
 * Every measured quantity is `T | null`. A campaign service that does not know
 * a value MUST send `null`, never `0`, `""` or an omitted key. The pages render
 * a "not reported" state for null and never substitute a default, because a
 * plausible-looking zero is indistinguishable from a measurement at a glance
 * and this page's entire purpose is to be checkable.
 *
 * ## What this schema deliberately does NOT assume
 *
 * The design mockup this page came from was drawn against a hypothetical
 * Cellpose-SAM campaign. The first real campaign (the U-Net consortium) differs
 * in three ways, and the schema accommodates all three rather than hiding them:
 *
 *  1. There is no terabyte figure. The driver records image COUNTS on public
 *     benchmark datasets, so `images_held.bytes` is nullable and is expected to
 *     be null for the U-Net campaign. The page then renders an image count.
 *  2. The U-Net campaign exchanges FULL state dicts, which is correct for a
 *     small U-Net. `PayloadDescriptor.kind` carries that, and no page hardcodes
 *     the word "adapter".
 *  3. The metric is validation Dice per dataset, not a generic "score".
 *     `RoundMetric.name` travels with the record and is rendered verbatim.
 *
 * ## Disclosure rules (binding, from the driver owner)
 *
 * Some fields are deliberately withholdable, and the page must render fine
 * without them rather than treating absence as an error:
 *
 *  - **Roster**: exposed, but it is a list of SELF-DECLARED display names. The
 *    driver cannot attest identity under the current deployment, so no view
 *    may present it as an authenticated membership list.
 *  - **Per-site metric curves**: run-internal. Only the aggregate is public by
 *    default, because a live per-site curve is a public leaderboard of whose
 *    data is hardest, which is a reputational hazard and a disincentive to
 *    join. `RoundMetric.per_site` is therefore nullable.
 *  - **merge_weights**: opt-in. Sample-count weights publish every site's
 *    training-set size, which is fine for public benchmarks and not fine for a
 *    clinical site. Nullable.
 *  - **Split fingerprints**: exposed for public-data campaigns, opt-in
 *    otherwise, because a fingerprint over private data is a membership
 *    oracle. Nullable.
 *  - **Outcome axis is post-hoc**: process fields (roster, transport, round
 *    progress) may update live, but a running campaign may report no metric at
 *    all. `RoundRecord.metric` is nullable for that reason, not by accident.
 */

/** Bump on any breaking change to the shapes below. */
export const CAMPAIGN_SCHEMA_VERSION = '0.1.0-draft';

/**
 * What crosses the site boundary each round.
 *
 * `kind` exists so the page can describe the payload truthfully for campaigns
 * with very different transport profiles. A small U-Net exchanging its whole
 * state dict and a 300M-parameter foundation model exchanging a low-rank
 * adapter are both legitimate; they are not the same claim.
 */
export interface PayloadDescriptor {
  kind: 'full_state_dict' | 'lora_adapter' | 'gradient' | 'other';
  /** Human-readable, rendered verbatim. e.g. "Full state dict", "LoRA adapter (r=8, qkv and head)". */
  label: string;
  /** Measured, not derived from a parameter count. Null until a round has actually run. */
  bytes_per_site_per_round: number | null;
}

/** One dataset a site contributes. Mirrors `get_status().datasets_loaded[name]`. */
export interface SiteDataset {
  name: string;
  /** What the images contain, e.g. "fluorescence nuclei". */
  objects: string | null;
  n_train: number | null;
  n_val: number | null;
  n_test: number | null;
  /** Where the data came from. Null for data the site has not published. */
  source: string | null;
  licence: string | null;
  citation: string | null;
  /**
   * Digest over the train/val/test split, so a result can be tied to the exact
   * partition it was measured on. Null for private-data campaigns, where a
   * fingerprint would act as a membership oracle.
   */
  split_fingerprint: string | null;
}

/** How a site currently relates to the campaign. */
export type SiteRole = 'founding' | 'joined' | 'pending_review' | 'withdrawn';

/** What a site is doing in the round being displayed. */
export type SiteActivity =
  | 'training'
  | 'reported'
  | 'idle'
  | 'unreachable'
  | 'pending_review';

/**
 * One participating site.
 *
 * `joined_round` is recorded rather than smoothed over: a site that joined
 * mid-campaign contributed to fewer rounds and its weight in the merged model
 * is correspondingly smaller, which the provenance has to show.
 *
 * `site_name` is SELF-DECLARED. The platform does not verify that a
 * participating deployment belongs to the institution it names, so no view may
 * present this list as attested membership.
 */
export interface SiteRecord {
  site_id: string;
  /** Self-declared. Not verified against any institutional identity. */
  site_name: string;
  /** ISO 3166 country name or null if the site has not declared one. */
  country: string | null;
  role: SiteRole;
  joined_round: number | null;
  /** Set when a site leaves; its earlier rounds still count. */
  left_round: number | null;
  /** From `get_status().torch.cuda_device`. Null on CPU-only or undisclosed sites. */
  accelerator: string | null;
  datasets: SiteDataset[];
  /** From `push_weights().n_train_images`, the count actually used for FedAvg weighting. */
  n_train_images: number | null;
  activity: SiteActivity;
  bioengine_version: string | null;
}

/** The scoring for one round. `name` is campaign-specific and rendered as given. */
export interface RoundMetric {
  /** e.g. "validation Dice". Never abbreviated to "score" by the page. */
  name: string;
  higher_is_better: boolean;
  /**
   * Keyed by `SiteRecord.site_id`. Null when the campaign withholds per-site
   * curves, which is the default: publishing them live amounts to a
   * leaderboard of whose data is hardest. Where it is present, a site absent
   * from the map was not scored that round.
   */
  per_site: Record<string, number> | null;
  /** Null when the campaign does not define a single pooled figure. */
  aggregate: number | null;
}

/** Bytes moved in one round, summed from the transport log entries for that round. */
export interface RoundTransport {
  bytes_out: number;
  bytes_in: number;
  n_transfers: number;
}

/** One federation round. Mirrors an entry of `run_federated.py` `round_records`. */
export interface RoundRecord {
  round: number;
  /** Site ids that trained this round. May be a subset of the roster. */
  participants: string[];
  /**
   * FedAvg weights actually applied, keyed by site id. Opt-in: sample-count
   * weights publish every site's training-set size. Null when withheld.
   */
  merge_weights: Record<string, number> | null;
  /**
   * Null while a campaign is running and reporting process axes only. Accuracy
   * is an outcome axis and may be published post-hoc.
   */
  metric: RoundMetric | null;
  /** Digest of the merged weights, so a curve can be tied to the exact aggregate. */
  global_sha256: string | null;
  transport: RoundTransport | null;
}

/**
 * The campaign-wide transport audit. Mirrors `TransportLog.dump()`.
 *
 * `only_weights_left_site` is the whole point: a boolean the platform computed
 * over its own append-only log, not a sentence anyone wrote. Null means the
 * service did not report it, and the page then says so rather than assuming
 * either answer.
 */
export interface TransportSummary {
  bytes_out: number | null;
  bytes_in: number | null;
  n_transfers: number | null;
  /** Distinct `kind` values seen in the log, e.g. ["model_weights"]. */
  kinds_transferred: string[];
  only_weights_left_site: boolean | null;
  /** Expected to be 0 for a correct campaign. Null means unreported, which is not the same. */
  images_moved_bytes: number | null;
  images_held: {
    n_images: number | null;
    /** Null whenever the campaign records counts rather than sizes. Do not estimate. */
    bytes: number | null;
  };
}

export type CampaignStatus = 'open' | 'running' | 'completed' | 'closed';

export interface CampaignSteward {
  name: string;
  workspace: string | null;
}

/** The model a campaign published, once it has one. */
export interface PublishedModel {
  /** Fully qualified, e.g. "bioimage-io/collaborative-narwhal". */
  artifact_id: string;
  version: string | null;
}

/** Summary shape returned by the campaign index. A subset of CampaignRecord. */
export interface CampaignSummary {
  campaign_id: string;
  title: string;
  description: string | null;
  status: CampaignStatus;
  base_model: { id: string; name: string; url: string | null } | null;
  round: { current: number | null; total: number | null };
  n_active_sites: number | null;
  payload: PayloadDescriptor | null;
  model_licence: string | null;
  started_at: string | null;
}

/** The full record behind one campaign page. */
export interface CampaignRecord {
  /** The service's own schema version. Compared against CAMPAIGN_SCHEMA_VERSION. */
  schema_version: string;
  campaign_id: string;
  title: string;
  description: string | null;
  status: CampaignStatus;
  base_model: { id: string; name: string; url: string | null } | null;
  aggregation: {
    /** e.g. "FedAvg". */
    method: string;
    /** e.g. "sample count", "uniform". */
    weighting: string;
  };
  licence_policy: {
    /** Data licences a joining site may attest to, e.g. ["CC0-1.0", "CC-BY-4.0"]. */
    accepted_data_licences: string[];
    model_licence: string | null;
  };
  round: {
    current: number | null;
    total: number | null;
    /** ISO 8601. */
    started_at: string | null;
  };
  sites: SiteRecord[];
  /**
   * May have gaps. Reporting from the driver into the campaign service is
   * fire-and-forget and is never awaited on the training critical path, so a
   * service outage costs round records and not the run. Views must render a
   * discontinuous series rather than assuming `rounds[i].round === i`.
   */
  rounds: RoundRecord[];
  /** How many reports the service knows it lost, when it counts them. */
  reporting: { dropped_reports: number | null } | null;
  transport: TransportSummary | null;
  payload: PayloadDescriptor | null;
  stewards: CampaignSteward[];
  published_model: PublishedModel | null;
  /** ISO 8601. When the service generated this view. */
  generated_at: string;
}

/**
 * A request to join a campaign.
 *
 * Deliberately a request and not a registration: joining is steward-approved,
 * which is the honest depiction of today's process. Nothing is deployed to the
 * requesting site until a steward accepts.
 */
export interface JoinRequest {
  campaign_id: string;
  /** The requester's BioEngine deployment, e.g. "bioimage-io/bioengine-worker-...". */
  deployment_id: string;
  dataset: {
    name: string;
    n_images: number | null;
    licence: string;
  };
  licence_attested: boolean;
  contact: string;
}

export interface JoinRequestReceipt {
  request_id: string;
  status: 'pending' | 'accepted' | 'declined';
  /** Free text from the steward, shown to the requester. */
  message: string | null;
}
