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
 * Bump CAMPAIGN_SCHEMA_VERSION on any breaking change and keep the mapping
 * comments accurate: they are what makes it checkable that the page cannot
 * display a number the driver never measured.
 *
 * Ownership, settled with able-clam: this file is the typed wire contract and
 * the backend conforms to it, because two files defining the same format is how
 * they drift. The backend owns the SEMANTICS of what fills each field, and the
 * service echoes `schema_version` so a mismatch is visible rather than silent.
 *
 * ## A campaign is one arm-seed, not a whole run
 *
 * `RoundRecord.round` is the driver's `r` from `range(args.rounds)`, which
 * restarts at 0 per arm AND per seed. The consortium run is 15 arms x 5 seeds,
 * so each round number occurs 75 times across it. A campaign therefore pins
 * `experiment.arm` and `experiment.seed`, which is what makes `round` unique
 * within a campaign and what makes a campaign URL stable.
 *
 * ## Snapshotted, not proxied
 *
 * Fields sourced from `get_status()` (datasets, accelerator, bioengine_version)
 * come from a live RPC on the site. The service SNAPSHOTS them into the record
 * at join and at each round rather than proxying a live call, for two reasons:
 * a live proxy contradicts the snapshot the rest of the record is, and it goes
 * blank the moment a campaign ends, which is exactly when this page matters
 * most. Nothing here may be wired to a live per-site call.
 *
 * ## Declared and measured are different things
 *
 * Some values the platform measured; some a site typed into a join form. They
 * must never be mixed into one figure or one visual treatment. `SiteRecord`
 * carries an explicit `declared` list naming its own self-declared fields, so
 * the roster can mark them rather than the page having to remember which is
 * which.
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
 *     benchmark datasets and measures dataset sizes nowhere, so the only byte
 *     figure available is one the sites declare. It lives in its own field,
 *     `declared_data_bytes`, and is expected to be null for the U-Net campaign.
 *     The page then renders an image count and does not estimate a size from it.
 *  2. The U-Net campaign exchanges FULL state dicts, which is correct for a
 *     small U-Net. `PayloadDescriptor.kind` carries that, and no page hardcodes
 *     the word "adapter".
 *  3. The metric is validation Dice per dataset, not a generic "score".
 *     `RoundMetric.name` travels with the record and is rendered verbatim.
 *
 * There is a FOURTH mismatch, found later and larger than the other three: the
 * mockup's headline saving figure is not a property of the campaign at all, it
 * is a property of the window it is taken over, and over a long enough campaign
 * it changes SIGN. Bytes moved accumulates with every round and data held does
 * not, so a quotient of the two is a function of how long the run has gone on.
 * Every campaign therefore has a crossover round, and whether that round is
 * inside or outside the schedule depends on the corpus size relative to the
 * payload, not on whether the payload is an adapter or a whole model. This
 * schema carries no field for a saving and no page may render saving language,
 * or any quotient of bytes moved by data held, in any form. See
 * TransportAudit.tsx for the full note.
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
 *  - **Training-set sizes**: opt-in, and this is a boundary that spans three
 *    fields rather than one. `RoundRecord.merge_weights` publishes every site's
 *    training-set size because that is what FedAvg weights on. But
 *    `SiteRecord.n_train_images` is the SAME quantity read straight off
 *    `push_weights()`, and `TransportSummary.images_held.n_images` is its sum.
 *    Gating only merge_weights would leak the protected value through the
 *    roster panel instead of the metrics panel. All three are nullable and all
 *    three are governed by one flag.
 *  - **Membership is not the weight.** `joined_round` is derived from the
 *    merge_weights keys. Presence (is this site a key) and value (how much did
 *    it count) are different quantities and only the value is protected, so
 *    presence may be derived freely while the derivation must not carry values
 *    through when the flag is off.
 *  - **Split fingerprints**: exposed for public-data campaigns, opt-in
 *    otherwise, because a fingerprint over private data is a membership
 *    oracle. Nullable.
 *  - **Outcome axis is post-hoc**: process fields (roster, transport, round
 *    progress, fingerprints) may update live. Accuracy may not, at all, until
 *    `policy.outcomes_released` says the campaign's primary-metric rules have
 *    resolved. `RoundRecord.metric` is nullable for that reason and not by
 *    accident, but nullability is only half of it: a service that sends a
 *    metric anyway must still not have it rendered, so the page gates on the
 *    flag rather than on whether the field happens to be populated.
 *
 * ## Reporting is lossy in flight and reconciled at the end
 *
 * Driver-to-service reporting is fire-and-forget and is never awaited on the
 * training critical path, so a service outage costs round records and not the
 * run. `rounds` may therefore have holes WHILE a campaign runs.
 *
 * When an arm completes, the driver commits an authoritative arm record and the
 * service re-reads it to fill the rounds that were lost in flight. That is not
 * interpolation and not backfilling: the committed record is the source of
 * truth and the live reports were always a lossy preview of it. The service
 * must still never SYNTHESISE a round, and it must always prefer the committed
 * record over the live report.
 *
 * Two consequences the pages have to render:
 *
 *  - Reconciliation is an end-of-arm event, not continuous repair. A running
 *    campaign should expect gaps and say so; the same campaign after completion
 *    should be whole. The committed arm record is written once, at arm end, so
 *    a running campaign is permanently `reconciled: false`. That is the correct
 *    reading of a running campaign and not a bug to chase.
 *  - `reporting.dropped_reports` counts reports lost in flight, and
 *    `reporting.reconciled` says whether the series has been checked against
 *    the committed record. Together they let a reader tell "we lost telemetry"
 *    from "the run genuinely skipped this round", which are different facts.
 */

/**
 * The version this page is written against.
 *
 * Which component to bump is a criterion, not a judgement call, because
 * "is this breaking?" gets answered differently by the producer and the reader:
 *
 *   MINOR  a consumer must change to stay correct.
 *   PATCH  only the producer's obligations tighten.
 *
 * `assertSchema` compares major.minor, so a patch bump is accepted silently and
 * a minor bump refuses the record until this constant moves. That asymmetry is
 * the whole point and also the hazard: "it is only a tightening" is exactly the
 * argument that would smuggle a breaking change past the component nothing
 * checks. When it is not obvious which one applies, take the minor. A spurious
 * refusal costs one bump; a wrongly-silent patch costs a reader a false page.
 *
 * 0.2.5-draft: `declared` became required and non-nullable on the service, and
 * a null `n_sites_scored` now withholds the aggregate service-side. Both narrow
 * what may be emitted and neither invalidates a reader that handled the looser
 * case, so both are patches.
 *
 * 0.3.0-draft: MINOR, and the reason is worth keeping because it is the case
 * the criterion above exists for. The change is `policy.aggregate_min_eval_sites`
 * plus a service-side withhold of `aggregate` when the eval set is smaller than
 * it, and on its face that is another tightening. It is not, because it
 * withholds aggregates on rounds a reader currently expects to render, so
 * anything holding "outcomes released implies an aggregate renders" breaks. This
 * page held exactly that: a null aggregate matched neither branch of the chart's
 * loop and produced no point, no counter and no note. Every leave-one-site-out
 * fold has a singleton eval set, so the first campaign to use one would have
 * shortened its own curve silently.
 *
 * Also in 0.3.0-draft: `RoundRecord.eval_on`, without which the transport
 * multiplier is only computable at full participation, and
 * `RoundMetric.aggregate_withheld`, which carries the reason for a withhold so
 * the page does not reconstruct it. The page could infer every one of those
 * causes from public process fields. It must not: inference from an absence is
 * how a withhold becomes indistinguishable from a gap, which is the same bug
 * arrived at from the other side.
 *
 * The pin moved only after the handling landed. A version pin is a claim that
 * this page handles that version, so bumping first would have made the claim
 * false for as long as the gap stayed open, and the page would have accepted
 * 0.3.0 records while dropping their withheld rounds on the floor.
 */
export const CAMPAIGN_SCHEMA_VERSION = '0.3.0-draft';

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
  /**
   * Measured per round from the transport log, where the log covers that round.
   * Null otherwise, and NEVER estimated from a parameter count.
   *
   * A campaign-wide measured figure is specifically not acceptable here: the
   * per-source transport logs are in-memory and reset on process restart, so a
   * campaign-wide sum silently undercounts. A trustworthy campaign-wide number
   * exists, but it is computed from the validated transfer pattern rather than
   * observed, so it belongs in `ComputedTransport` where it can be labelled.
   */
  bytes_per_site_per_round: number | null;
}

/**
 * One dataset a site contributes. Mirrors `get_status().datasets_loaded[name]`,
 * snapshotted into the record at join and at each round. Never read live: see
 * the snapshotted-not-proxied note in the file header.
 */
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

/**
 * How a site currently relates to the campaign.
 *
 * 'founding' is presentation rather than an independent fact: it means
 * `joined_round === 0`. The service should derive it rather than asserting it,
 * so it cannot drift from the merge_weights the aggregate was actually
 * computed from.
 */
export type SiteRole = 'founding' | 'joined' | 'pending_review' | 'withdrawn';

/**
 * What a site is doing in the round being displayed.
 *
 * Only the states the driver can actually back. There is deliberately no
 * 'training' or 'unreachable' here: the driver records nothing live per site,
 * and the only way to produce those would be to poll `get_status()`, which is a
 * live call and therefore goes blank when the campaign ends. Both backed states
 * are derived from whether the site appears in the latest round's participants.
 *
 * `SiteRecord.activity` is nullable on top of this, for the ordinary case where
 * the service does not know.
 */
export type SiteActivity = 'reported' | 'idle' | 'pending_review';

/**
 * Names of `SiteRecord` fields whose values a site typed into a join form
 * rather than the platform measuring them.
 */
export type DeclaredSiteField = 'site_name' | 'country' | 'datasets' | 'n_train_images';

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
  /** Derived: 'founding' is `joined_round === 0`, not an independent assertion. */
  role: SiteRole;
  /**
   * Derived from the merge_weights keys. Presence is derivable even when the
   * weight VALUES are withheld, so this stays populated in a campaign that has
   * opted out of publishing training-set sizes.
   */
  joined_round: number | null;
  /** Set when a site leaves; its earlier rounds still count. */
  left_round: number | null;
  /** Snapshot of `get_status().torch.cuda_device`. Null on CPU-only or undisclosed sites. */
  accelerator: string | null;
  datasets: SiteDataset[];
  /**
   * From `push_weights().n_train_images`, the count actually used for FedAvg
   * weighting. Opt-in and governed by the same flag as `merge_weights`: this is
   * the site's training-set size, which is the exact quantity that flag exists
   * to protect.
   */
  n_train_images: number | null;
  /** Null when the service does not know. See SiteActivity for why it often will not. */
  activity: SiteActivity | null;
  /** Snapshot of `get_status()`. Null when the site did not report one. */
  bioengine_version: string | null;
  /**
   * Which of this site's own fields are self-declared rather than measured.
   * Rendered visually distinct from measured values, so a reader can tell a
   * form entry from an observation without being told per field.
   *
   * An empty array is a positive statement that nothing was declared. It is not
   * the same as null and must not be collapsed into it.
   *
   * Still nullable here even though the service has required it since
   * 0.2.5-draft, because this type describes what can arrive over the wire, not
   * what the producer promises to send. Nothing on this side type-checks the
   * JSON. Dropping the null would delete the page's only handling of a producer
   * regression and replace it with the assumption that regressions do not
   * happen, which is how the self-declared values would go back to being
   * presented as platform-measured. SiteRoster renders the third state visibly
   * rather than silently picking a side.
   */
  declared: DeclaredSiteField[] | null;
}

/**
 * Why the service published no aggregate for a round.
 *
 * A closed union, emitted by the service, and the page never infers which
 * applies. It could: every one of these is derivable from public process
 * fields. It must not, because inference from an absence is how a withhold
 * becomes indistinguishable from a gap, and a reconstructed cause is a guess
 * wearing the service's voice.
 *
 *  - `partial_map`          some sites' per-site values were published and the
 *                           aggregate would reconstruct the rest.
 *  - `completeness_unknown` the service could not establish that the per-site
 *                           map was complete, so it could not rule out the above.
 *  - `below_eval_floor`     fewer than `policy.aggregate_min_eval_sites` sites
 *                           evaluated. At one site the aggregate IS that site's
 *                           value under a pooled label, and every
 *                           leave-one-site-out fold has a singleton eval set.
 *  - `floor_unknown`        the floor itself was not stated, so the service
 *                           could not prove it was met.
 *
 * Null alongside a null aggregate is NOT a withhold. It is an absence, and
 * absences carry no argument: the page says the score is not in the record
 * rather than reporting a decision nobody made.
 */
export type AggregateWithholdCause =
  | 'partial_map'
  | 'completeness_unknown'
  | 'below_eval_floor'
  | 'floor_unknown';

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
  /**
   * Null when the campaign does not define a single pooled figure, which is the
   * honest default: the driver records the metric per dataset and there is no
   * pooled number in the record. Whoever computes one is DEFINING a new
   * quantity, so `aggregate_basis` has to name it.
   *
   * Withhold this whenever `per_site` is partially populated. With few sites,
   * an aggregate plus n-1 per-site values reconstructs the nth, which would
   * leak the value the per-site withholding exists to protect.
   *
   * Also withheld when fewer than `policy.aggregate_min_eval_sites` sites
   * evaluated. See `aggregate_withheld`.
   */
  aggregate: number | null;
  /**
   * Set when `aggregate` is null BECAUSE the service decided to withhold it,
   * naming which rule fired. Null when no aggregate was ever computed, or when
   * the service simply did not say.
   *
   * This exists because a null field cannot distinguish a decision from a gap
   * on its own, and the page had no third state for it: a null aggregate fell
   * out of both branches of the chart's loop, contributing no point, no
   * counter, and no note. The round silently shortened the line, and every
   * missing round was rendered as if the campaign had never had one.
   */
  aggregate_withheld: AggregateWithholdCause | null;
  /**
   * How `aggregate` was pooled, e.g. "merge-weighted mean over per-dataset
   * validation Dice". Rendered wherever the aggregate is, because a pooled
   * figure with an unnamed basis is not checkable.
   */
  aggregate_basis: string | null;
  /** How many sites contributed a score this round. The public stand-in for per_site. */
  n_sites_scored: number | null;
}

/**
 * Bytes moved in one round.
 *
 * Transport entries carry no round field, but their paths are
 * `{seed}/{arm}/round_{NN}/{site}.pt` on both the driver and the site side, so
 * every entry attributes to a round by parsing its own path.
 *
 * That per-round attribution is what makes transport reportable at all. The
 * per-source logs are in-memory and reset on process restart, so a
 * campaign-wide sum silently undercounts: it looks complete and is not. The
 * same truncated log read per round gives exact bytes for the rounds it covers
 * and null for the rounds it does not, which turns an invisible undercount into
 * a visible gap.
 *
 * These figures are rendered PER ROUND and are never summed, extrapolated, or
 * put over the data held. A per-round transport figure and a campaign-wide one
 * are different quantities and the comparison between them reverses sign
 * depending on which you use. See the note at the top of TransportAudit.tsx.
 */
export interface RoundTransport {
  bytes_out: number | null;
  bytes_in: number | null;
  n_transfers: number | null;
  /**
   * True only when EVERY source's log covers this round.
   *
   * This is the per-round analogue of `ObservedTransport.valid` and it exists
   * for the same reason. A round covered by four sources out of six produces a
   * `bytes_out` that is a real sum of real entries and is still not the round's
   * transport: it is a partial sum that looks complete, which is the exact
   * failure the campaign-wide total has, moved down one level.
   *
   * The round log therefore gates the per-round byte figure on this flag rather
   * than on `bytes_out` being populated, because a populated value cannot tell
   * a reader whether it is whole. Null fails closed, like every other flag in
   * this schema, so a service that cannot answer this per round simply shows no
   * per-round bytes.
   */
  sources_complete: boolean | null;
}

/** One federation round. Mirrors an entry of `run_federated.py` `round_records`. */
export interface RoundRecord {
  round: number;
  /** Site ids that trained this round. May be a subset of the roster. */
  participants: string[];
  /**
   * Site ids that evaluated this round's aggregate. May include sites that did
   * not train, which is the whole reason it is a separate field: a
   * leave-one-site-out fold trains five and evaluates six.
   *
   * Needed for the transport multiplier, whose last term is
   * `|participants union eval_on|`, one store read per site that pulls the
   * aggregate. Without it the multiplier is only computable at full
   * participation, and assuming full participation is the same class of error
   * as any other flattering default.
   *
   * It is NOT derived from `scored_with`, whose keys are the same set, because
   * `scored_with` belongs to the outcome axis: it travels with `metric` and the
   * page gates that whole surface on `policy.outcomes_released`. Deriving the
   * multiplier from it would make a process quantity conditional on an outcome
   * flag, and the transport curve would be withheld for every running campaign,
   * which is exactly when it is worth reading.
   *
   * The test that settles which axis it belongs to: the model was shipped to
   * those sites whether or not any score is ever released. The bytes moved. So
   * the SET is a process quantity and only the VALUES are an outcome.
   *
   * Nullable and fails closed. A null withholds the point rather than assuming
   * the eval set equalled the participant set, which is the flattering
   * assumption: it undercounts the aggregate reads, understates the multiplier,
   * and so puts the crossover later than it belongs.
   */
  eval_on: string[] | null;
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
  /**
   * Keyed by site id: the digest of the aggregate each site ACTUALLY scored on.
   * The driver already writes this and raises if the digests disagree, which
   * makes it the strongest provenance field in the record. The honest rendering
   * of "6 sites training" is "6 sites scored on a22dba37...".
   */
  scored_with: Record<string, string> | null;
  transport: RoundTransport | null;
}

/** The span of the transport log one source contributed, used to check agreement. */
export interface TransportWindow {
  /** "driver", or a `SiteRecord.site_id`. */
  source: string;
  first_seq: number | null;
  last_seq: number | null;
  n_transfers: number | null;
}

/**
 * What the transport log actually recorded.
 *
 * Renders ONLY when `valid` is true. The per-source logs are in-memory and
 * reset on process restart, so the sources sit on unsynchronised windows and
 * summing across them has no defined meaning. On the U-Net consortium campaign
 * they do not agree, so this block is expected to report `valid: false` and
 * render nothing at all. `invalid_reason` is what the page shows instead.
 */
export interface ObservedTransport {
  valid: boolean;
  /** Why the windows disagree, in words a reader can act on. Null when valid. */
  invalid_reason: string | null;
  /** Keyed by site id. */
  per_site: Record<string, RoundTransport> | null;
  driver: RoundTransport | null;
  windows: TransportWindow[] | null;
}

/**
 * A campaign-wide figure derived from the validated transfer pattern rather
 * than summed from the log.
 *
 * This is trustworthy where the observed sum is not, and it is a different kind
 * of claim, so it is a different field and it renders labelled
 * computed-not-observed. Never merge it with `ObservedTransport` into one
 * number.
 */
export interface ComputedTransport {
  /**
   * A LOWER BOUND on the bytes moved, never a total. Render it as "at least".
   *
   * The formula counts each arm once, but a driver relaunch keeps the arms that
   * finished and restarts the arm that was in flight from round 0. The rounds
   * that arm had already run really did put weights on the network and the
   * formula does not see them, so a restarted campaign moved strictly more than
   * this. The consortium run is on its seventh relaunch.
   *
   * Nothing in the record says whether a given campaign was restarted, so the
   * page cannot qualify this conditionally, and it does not need to: "at least"
   * is true of a clean run as well. Both of this page's transport figures now
   * fail in the same direction. The observed sum undercounts when the windows
   * disagree, the computed figure undercounts when the run was resumed, and
   * neither can overstate what crossed the network. That is the right direction
   * for the only claim this page is really making.
   */
  bytes_moved: number | null;
  /**
   * The formula, rendered verbatim, e.g.
   * "2|participants| + 1 + |participants union eval_on| transfers per round
   * x measured payload size".
   *
   * The example here used to read "3N+1", which is that expression evaluated at
   * full participation and not the general form. It is only an example string,
   * but a wrong coefficient sitting in a doc comment is how a flat one ends up
   * in code, so it is corrected rather than left as shorthand.
   */
  basis: string;
  /** What the formula was checked against, e.g. a control run. Null if unchecked. */
  validated_against: string | null;
}

/**
 * The campaign-wide transport audit. Mirrors `TransportLog.dump()`, split into
 * the part that was observed and the part that was computed.
 *
 * `only_weights_left_site` is the whole point and it survives the split intact:
 * a truncated log cannot manufacture a non-weights transfer, so the check holds
 * even when the totals do not. It is a boolean the platform computed over its
 * own append-only log, not a sentence anyone wrote. Null means the service did
 * not report it, and the page then says so rather than assuming either answer.
 */
export interface TransportSummary {
  observed: ObservedTransport | null;
  computed: ComputedTransport | null;
  /**
   * Distinct `kind` values seen in the log, e.g. ["model_weights"]. Null when
   * unreported: an empty array would read as "nothing was transferred", which
   * is a measurement rather than an absence.
   */
  kinds_transferred: string[] | null;
  only_weights_left_site: boolean | null;
  /** Expected to be 0 for a correct campaign. Null means unreported, which is not the same. */
  images_moved_bytes: number | null;
  /**
   * How many images stayed where they were: the roster's summed training-set
   * size, MEASURED, off the same `push_weights()` call as
   * `SiteRecord.n_train_images`. Null when unreported.
   *
   * It therefore sits behind the same opt-in flag as `merge_weights` and
   * `SiteRecord.n_train_images`. It looks innocuous and is not.
   *
   * The SUM has a failure the individual values do not. A published total plus
   * n-1 opted-in sites reconstructs the site that opted out, so the service
   * serves `n_images` only when EVERY site on the roster has set the flag, not
   * merely when the sites being summed have. Withholding one site's
   * contribution from a total that is still published is not withholding it.
   * This is the same shape as the partial-aggregate rule on `RoundMetric`.
   */
  images_held: {
    n_images: number | null;
  } | null;
  /**
   * How many bytes of data the sites hold, AS THE SITES THEMSELVES DECLARED IT.
   * Null when unreported, and null unless every roster site declared.
   *
   * The basis lives in the field name because there is no other basis this
   * quantity can have. Nothing in the driver records dataset sizes on disk: the
   * only file-size call in the app is a download-completeness check, and what
   * gets recorded from the datasets is counts. So there is no code path, present
   * or planned, that would produce a measured version of this number, and the
   * schema does not offer a field that could hold one. An enum admitting
   * `'measured'` would read as achievable-but-unwired to whoever picks this up.
   *
   * Kept separate from `images_held` for the same reason. That object holds a
   * measured count; this holds a declared size. One basis flag over both would
   * be ambiguous exactly where the distinction matters, which is the transport
   * asymmetry ratio: its numerator is measured and unusable today only because
   * the source windows disagree, a defect with a fix, while this denominator is
   * declared and stays declared however much the numerator improves. Fixing the
   * log must not silently promote a measured-over-declared quotient into
   * something that reads as fully audited, so any ratio built on this field
   * renders with the declared half named on screen.
   *
   * Being a sum over the roster, it inherits the same reconstruction rule as
   * `images_held.n_images`: published only when every site declared, else null.
   */
  declared_data_bytes: number | null;
}

export type CampaignStatus = 'open' | 'running' | 'completed' | 'closed';

/**
 * Which arm-seed of an experiment this campaign is.
 *
 * Pinned because round numbers restart at 0 per arm and per seed, so `round` is
 * only unique once both are fixed. A campaign is one arm-seed, never a whole
 * run. Null for a campaign that is not a slice of a larger experiment.
 */
export interface CampaignExperiment {
  /** e.g. "fedavg". */
  arm: string | null;
  seed: number | null;
  /** The parent experiment, when the campaign is one slice of it. */
  run_id: string | null;
}

/**
 * Campaign-level policy, so components read a flag instead of hardcoding a
 * caveat that nobody remembers to delete when it stops being true.
 */
export interface CampaignPolicy {
  /**
   * Public benchmark data throughout, which is what makes split fingerprints
   * and training-set sizes safe to publish for this campaign.
   */
  public_data_campaign: boolean | null;
  /**
   * Whether the platform can attest that a roster entry is who it says it is.
   * False today: under a shared-token deployment the driver cannot, so entries
   * are self-declared display names, with no lock icons and no "verified
   * participant" anywhere. The roster caveat is keyed off this rather than
   * hardcoded, so it disappears when per-deployment credentials land and not
   * one release before.
   */
  roster_attested: boolean | null;
  /**
   * Whether the outcome axis has been released.
   *
   * BINDING: the live page shows PROCESS only. No accuracy is rendered anywhere
   * until this is true, and it becomes true only after the campaign's
   * primary-metric rules have resolved. A metric published mid-run is read as a
   * result when it is a partial observation, and as a comparison between sites
   * when the sites hold different data. Neither is recoverable by putting a
   * caveat next to it.
   *
   * The service owns this flag and the page does not second-guess it against
   * `status`. Null fails closed, because not saying whether a figure may be
   * published is not permission to publish it. See `disclosure.ts`.
   */
  outcomes_released: boolean | null;
  /**
   * The minimum number of evaluating sites below which `RoundMetric.aggregate`
   * is withheld. A campaign-level judgement, not a derivation, which is exactly
   * why it lives here and is not a constant in this repo: a page that supplied
   * its own value would present one consortium's disclosure threshold as a
   * property of the platform.
   *
   * The long name is deliberate. A bare `min_eval_sites` reads as a validity
   * condition on the round, which would have the page drop the round entirely.
   * This gates ONE outcome field and leaves every process field standing.
   *
   * Readable regardless of `outcomes_released`, because it describes a rule and
   * not a result. That generalises: a gate's parameter must not be hidden by
   * its own gate, or the withhold becomes unexplainable exactly when it fires,
   * which is the failure the withhold exists to prevent.
   *
   * Null fails closed. The page does not substitute a default and does not
   * treat an unstated floor as met. Service-side a null floor also withholds,
   * which makes "aggregate present alongside a null floor" a can't-happen. The
   * page keeps a branch for it anyway and renders it as a drifted service,
   * because the service refusing at the boundary is its guarantee, not a
   * mechanism on this side.
   */
  aggregate_min_eval_sites: number | null;
}

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

/**
 * What `list_campaigns` returns.
 *
 * It is an envelope rather than a bare array, and the version lives on the
 * envelope rather than on each summary, for two reasons.
 *
 * The index is FIRST CONTACT with the campaign service. Until 0.2.4-draft only
 * `get_campaign` carried a version, so a service that had drifted rendered its
 * whole index correctly and failed only when a reader clicked into a detail.
 * The summaries carry `payload` and `round`, which is exactly where a renamed
 * unit turns a byte count into a megabyte count, so the argument for checking
 * the detail applies to the index with no weakening at all.
 *
 * The version sits on the envelope because N copies can disagree with each
 * other, and a per-item version would invent a failure mode the page has no
 * sensible answer for. One response carries one version.
 */
export interface CampaignListResponse {
  schema_version: string;
  campaigns: CampaignSummary[];
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
  /**
   * Stable, opaque-to-the-page slug. Doubles as the Hypha artifact alias, so it
   * is lowercase alphanumeric with hyphens and nothing else, and it is the only
   * thing in the campaign URL: `/campaigns/<campaign_id>`.
   *
   * Arm and seed are carried in `experiment` rather than being URL segments on
   * purpose. They identify a campaign but they are experiment-shaped, and
   * baking them into the path would break every existing link the first time an
   * experiment is re-cut.
   */
  campaign_id: string;
  title: string;
  description: string | null;
  status: CampaignStatus;
  /** Which arm-seed this campaign is. See CampaignExperiment for why it is pinned. */
  experiment: CampaignExperiment | null;
  policy: CampaignPolicy | null;
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
   *
   * A gap is a LOST RECORD, not a round that did not happen, and the pages must
   * say so in those words. Read with `reporting` to tell the two apart.
   */
  rounds: RoundRecord[];
  reporting: {
    /** How many reports the service knows it lost in flight, when it counts them. */
    dropped_reports: number | null;
    /**
     * Whether the series has been checked against the driver's committed arm
     * record. False or null while a campaign runs, because reconciliation only
     * happens once the arm finishes. This is what lets a reader tell lost
     * telemetry from a round the run genuinely skipped.
     */
    reconciled: boolean | null;
    /** ISO 8601. When reconciliation last ran. Null if it never has. */
    reconciled_at: string | null;
  } | null;
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
 *
 * Unlike every read in this file, this write CANNOT be anonymous. A steward
 * approving an unattributable string is not approving anything, so the request
 * carries the caller's Hypha identity and the join form requires a signed-in
 * visitor even though the campaign pages themselves render logged out.
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
