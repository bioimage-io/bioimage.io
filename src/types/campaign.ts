/**
 * Federation campaign records, as read by the Campaigns pages.
 *
 * DRAFT. This is the website's proposal for the JSON contract exposed by the
 * `federation-campaign` BioEngine app.
 *
 * ## Scope: foundation models only
 *
 * A campaign in this contract is a community fine-tuning programme around a
 * PRE-TRAINED FOUNDATION MODEL, with Cellpose-SAM as the pilot. That is the
 * scope Nils set on 15 Sep 2026 and it is narrower than the file used to be.
 *
 * Through 0.13.0-draft this schema also typed a synchronous FedAvg consortium
 * running lockstep rounds across a fixed site roster, which was a thin view over
 * `apps/federated-unet/` in the bioengine repo:
 *
 *   TransportSummary  <- checkpoints.py  TransportLog.dump()
 *   RoundRecord       <- run_federated.py  round_records[]
 *   SiteRecord        <- entry.py  get_status() + push_weights()
 *
 * 0.14.0-draft removes that arm. `apps/federated-unet` is still live and still
 * maintained; it simply has no website contract any more, and nothing here
 * should be read as a claim about it. If a synchronous programme ever comes back
 * into scope, `progress.mode` is still a discriminated union with one member, so
 * re-adding an arm is additive rather than a re-cut of the union.
 *
 * What remains is the ASYNCHRONOUS MODEL-SOUP arm, which has no shipped producer
 * yet either. The only mapping it has is to a backend under construction
 * (live-kudu's soup service), so every field below is a proposal the backend is
 * being built against rather than a description of something already recorded.
 * That distinction matters more here than it did with the driver mapping: there
 * is no running system to check a field against, so a field that looks measured
 * is only ever as good as the declaration that carries it.
 *
 * Bump CAMPAIGN_SCHEMA_VERSION on any breaking change, and when a producer does
 * land, write its mapping here: a checkable mapping is what makes it provable
 * that the page cannot display a number nothing ever measured.
 *
 * Ownership, settled with able-clam: this file is the typed wire contract and
 * the backend conforms to it, because two files defining the same format is how
 * they drift. The backend owns the SEMANTICS of what fills each field, and the
 * service echoes `schema_version` so a mismatch is visible rather than silent.
 *
 * ## Snapshotted, not proxied
 *
 * Fields sourced from `get_status()` (datasets, accelerator, bioengine_version)
 * come from a live RPC on a contributor's deployment. The service SNAPSHOTS them
 * into the record at join and at each contribution rather than proxying a live
 * call, for two reasons: a live proxy contradicts the snapshot the rest of the
 * record is, and it goes blank the moment a campaign ends, which is exactly when
 * this page matters most. Nothing here may be wired to a live per-contributor
 * call.
 *
 * ## Declared and measured are different things
 *
 * Some values the platform measured; some a contributor typed into a join form.
 * They must never be mixed into one figure or one visual treatment.
 * `ContributorRecord` carries an explicit `declared` list naming its own
 * self-declared fields, so the roster can mark them rather than the page having
 * to remember which is which.
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
 * Cellpose-SAM campaign, and Cellpose-SAM is now the pilot. That closeness is a
 * hazard rather than a convenience: a mockup's numbers are chosen to look right,
 * and the four guards below all exist because a figure the mockup drew turned
 * out to be one no producer can supply. They are kept as guards, not as
 * history.
 *
 *  1. There is no terabyte figure, and the schema must not imply one. A byte
 *     count over a contributor's training corpus is something they DECLARE, not
 *     something the platform can measure, so it lives in its own field,
 *     `declared_data_bytes`, and is null until someone declares it. The page
 *     renders an image count and never estimates a size from it.
 *  2. The payload kind is data, not an assumption. The soup fork was ruled
 *     FULL-WEIGHT, so `PayloadDescriptor.kind` says `full_state_dict` today, and
 *     no page hardcodes either that or the word "adapter". A campaign that
 *     switches to a low-rank adapter changes a value here, not a component.
 *  3. The metric name travels with the record and is rendered verbatim. There is
 *     no generic "score" label anywhere, because the campaign, not the page,
 *     knows what it measured.
 *
 * The FOURTH guard is the largest and it is a prohibition rather than a field.
 * The mockup's headline saving figure is not a property of the campaign at all,
 * it is a property of the window it is taken over, and over a long enough
 * campaign it changes SIGN. Bytes moved accumulates with every contribution and
 * every merge; data held does not. A quotient of the two is therefore a function
 * of how long the campaign has run, so every campaign has a crossover point, and
 * whether that point falls inside the campaign depends on the corpus size
 * relative to the payload rather than on whether the payload is an adapter or a
 * whole model. This schema carries no field for a saving and no page may render
 * saving language, or any quotient of bytes moved by data held, in any form. See
 * TransportAudit.tsx for the full note.
 *
 * That rule now binds the paper as well as the page, confirmed by the paper
 * orchestrator on 2026-09-12. It is recorded here because the argument for it is
 * a property of the schema rather than of either surface, and the next person to
 * want a headline multiplier will look for the reason in this file.
 *
 * ## One mode, and why `mode` is still a discriminated union
 *
 * An asynchronous model-soup campaign has no rounds. Contributors fine-tune on
 * their own data at their own pace and push a checkpoint whenever they finish.
 * Periodically those checkpoints are merged into a new community model that
 * everyone can pull. The structural fact the record has to carry is that there
 * are TWO EVENT STREAMS, not one:
 *
 *   CONTRIBUTIONS  continuous, unordered, one per contributor per finished run,
 *                  arriving at arbitrary wall-clock times.
 *   SOUP MERGES    discrete, ordered, each one producing an immutable community
 *                  checkpoint version.
 *
 * They come apart in time: a contribution and the merge that folds it in happen
 * days apart, and between them sit other contributors' runs that will land in
 * the same merge or the next one. Nothing in this file may assume a contribution
 * and a merge share an index, a timestamp, or a cardinality.
 *
 * `progress` is nonetheless a DISCRIMINATED UNION on `mode` with exactly one
 * member. That is deliberate and it is not a leftover. Through 0.13.0-draft
 * there were two members and the union was carrying a real distinction; 0.14.0
 * removed the synchronous one. Keeping the discriminant costs every consumer one
 * switch it cannot currently get wrong, and buys the ability to add a second
 * process ADDITIVELY. Collapsing it would save that switch now and force a
 * breaking re-cut, plus a re-pin on every consumer of the fixture corpus, the
 * first time a second process appears. The union was the expensive half of
 * 0.8.0-draft and it is already paid for.
 *
 * The shape that is specifically NOT permitted, and the reason a discriminant
 * beats a bag of nullable fields: a record carrying two populated event-stream
 * families with no discriminant leaves the reader to decide which one wins, and
 * every such decision is a page inventing a semantics the producer never stated.
 *
 * ## Inclusion is a decision, and as of 0.9.0-draft the campaign makes it
 *
 * Under uniform or sample-weighted averaging, every contribution that arrives is
 * in the soup by construction, the way every participant that reported is in a
 * uniformly averaged aggregate. Under GREEDY souping it is not: checkpoints are admitted against a
 * held-out set and a contributor can do everything right and not be in the model.
 *
 * The fork was ruled greedy on 12 Sep 2026, and the hold that stood here through
 * 0.8.0-draft is lifted. `ContributionDisposition.excluded` is now a reachable
 * value and pages render it. Two constraints replace the hold, and they are
 * binding rather than stylistic:
 *
 *  1. An excluded contribution is a NEUTRAL LINEAGE FACT. It is not a failure, a
 *     rejection, or a quality judgement of the contributor or their data. The
 *     wording everywhere is that the contribution was assessed and this merge did
 *     not take it. Nothing may be worded as the contributor having done badly,
 *     because they did not: a greedy soup leaves out checkpoints that are
 *     individually fine and simply do not improve the pooled model on the day.
 *  2. NO PER-CONTRIBUTOR ACCURACY LEADERBOARD, and no per-contributor exclusion
 *     count either. A column tallying whose contributions get left out is a
 *     leaderboard with the ranking implied instead of stated, which is worse
 *     rather than better. Selection outcomes are published PER MERGE, where they
 *     describe the merge, and never aggregated per contributor. This is the same
 *     rule that keeps `CampaignMetric.per_site` withheld, arriving by a new route.
 *
 * ## A selection gate makes its own metric unusable as an improvement curve
 *
 * The consequence of greedy that the schema has to carry. Contributions are
 * SELECTED on a held-out score, so plotting that same score across versions shows
 * improvement on the very set inclusion was optimised against. The curve would go
 * up whether or not the model got better, because going up on that set is the
 * admission criterion. It is circular and it is not detectable by looking at it.
 *
 * So the campaign publishes two scores per merge and the schema names them by
 * ROLE rather than by which one is more interesting. See `MetricRole`,
 * `SoupRecord.witness_metric`, and `SoupRecord.selection_metric`. Only the
 * witness is plottable, and that is enforced by the type of `ScoredEvent.metric`
 * and again at runtime in `aggregateDisposition`, because the wire arrives as
 * JSON and a type alone cannot stop a producer putting the gate score in the
 * witness slot.
 *
 * ## Disclosure rules (binding, originally from the driver owner)
 *
 * Some fields are deliberately withholdable, and the page must render fine
 * without them rather than treating absence as an error:
 *
 *  - **Roster**: exposed, but it is a list of SELF-DECLARED display names. The
 *    platform cannot attest identity under the current deployment, so no view
 *    may present it as an authenticated membership list. In an OPEN campaign
 *    this binds harder rather than softer: the roster is no longer a short list
 *    of known institutions a reader could sanity-check by eye.
 *  - **Per-participant metric curves**: run-internal. Only the aggregate is
 *    public by default, because a live per-participant curve is a public
 *    leaderboard of whose data is hardest, which is a reputational hazard and a
 *    disincentive to join. `CampaignMetric.per_site` is therefore nullable.
 *  - **Training-set sizes**: opt-in, and this is a boundary that spans several
 *    fields rather than one. `ContributorRecord.n_train_images`,
 *    `ContributionRecord.n_train_images` and
 *    `TransportSummary.images_held.n_images` are the same protected quantity at
 *    three scopes, the last being a sum of the others. Gating one would leak the
 *    value through another panel, so all of them are nullable and all of them
 *    are governed by one flag.
 *  - **Membership is not the weight.** That a contributor took part and how much
 *    its data counted are different quantities, and only the second is
 *    protected. Presence may be derived freely; a derivation must not carry
 *    values through when the flag is off.
 *  - **Split fingerprints**: exposed for public-data campaigns, opt-in
 *    otherwise, because a fingerprint over private data is a membership
 *    oracle. Nullable.
 *  - **Outcome axis is post-hoc**: process fields (roster, transport, merge
 *    cadence, fingerprints) may update live. Accuracy may not, at all, until
 *    `policy.outcomes_released` says the campaign's primary-metric rules have
 *    resolved. `SoupRecord.witness_metric` is nullable for that reason and not
 *    by accident, but nullability is only half of it: a service that sends a
 *    metric anyway must still not have it rendered, so the page gates on the
 *    flag rather than on whether the field happens to be populated.
 *
 * ## Reporting is lossy in flight
 *
 * Reporting into the campaign service is fire-and-forget and is never awaited on
 * the training critical path, so a service outage costs records and not runs.
 * `contributions`, `soups` and `empty_merges` may all have holes.
 *
 * `reporting.dropped_reports` is what a reader has instead of being able to see
 * those holes, and the async arm's doc explains why seeing them is impossible: a
 * missing element of an unindexed stream leaves no trace. A page that ignores
 * the field is not showing a slightly short stream, it is showing a stream it
 * has no grounds to call complete.
 *
 * `reporting.reconciled` and `reconciled_at` are a HOLDOVER and are documented
 * as such rather than quietly dropped. They were defined against the federated
 * driver's end-of-arm committed record, which was the authoritative source the
 * lossy live reports were a preview of. That driver is no longer in this
 * contract, and the soup backend has not stated an equivalent, so as of
 * 0.14.0-draft there is no producer for either field and no page may read a null
 * `reconciled` as "not yet reconciled". It means nobody has said. The fields are
 * kept because removing them would be asserting that no async backend will ever
 * have a committed store worth reconciling against, which is a claim this side
 * is in no position to make.
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
 * `CampaignMetric.aggregate_withheld`, which carries the reason for a withhold so
 * the page does not reconstruct it. The page could infer every one of those
 * causes from public process fields. It must not: inference from an absence is
 * how a withhold becomes indistinguishable from a gap, which is the same bug
 * arrived at from the other side.
 *
 * The pin moved only after the handling landed. A version pin is a claim that
 * this page handles that version, so bumping first would have made the claim
 * false for as long as the gap stayed open, and the page would have accepted
 * 0.3.0 records while dropping their withheld rounds on the floor.
 *
 * 0.4.0-draft: MINOR. `CampaignMetric.per_site_basis`, and every reader of
 * `per_site` must change, so this is the clearest minor in the list.
 *
 * The previous version asserted "keyed by site_id" in a doc comment, which the
 * only known producer does not do. Everything the page then computed from that
 * map inherited the mistake, including a completeness gate comparing the map's
 * length to `n_sites_scored`. Two maps in two key spaces compared by
 * cardinality: the comparison had no meaning in EITHER direction, so extending
 * it to catch the second direction extended something that was never sound.
 *
 * That is the failure mode this file's basis fields exist for. `aggregate_basis`
 * and `images_held.basis` were both added because a number whose derivation is
 * unstated cannot be checked. A map whose KEY SPACE is unstated is the same
 * defect one level up, and it went unnoticed longer because a key space feels
 * like a property of the field rather than a claim about a value.
 *
 * Prose in a schema binds nobody. The producer never agreed to the sentence and
 * the reader cannot check it, which makes it the same class of thing as a tier
 * asserted in a comment on a method that cannot know its caller.
 *
 * 0.5.0-draft: MINOR. `RoundRecord.scored_with_basis` and
 * `ObservedTransport.per_site_basis`, which are the same defect as 0.4.0 in the
 * two places 0.4.0 did not look, plus the `KeySpace` alias that names the thing
 * once instead of three times.
 *
 * 0.4.0 fixed one field and left two more asserting their key space in prose,
 * one of them on a field of the same name in the same file, sixty lines below
 * the fix. Both assertions are TRUE today, checked against the driver. That is
 * the point rather than a mitigation: true-and-unverifiable is the state these
 * basis fields exist to eliminate, because a consumer has no way to confirm it,
 * and one producer refactor turns a true comment into a false one with every
 * reader downstream inheriting it.
 *
 * The rule this file is converging on, which is worth stating once here: a
 * property that no single side can verify has to be a declaration each side
 * publishes, never a check one side runs. Key space is that kind of property,
 * and so is provenance, and so is the derivation of an aggregate.
 *
 * 0.6.0-draft: MINOR. `policy.aggregate_min_eval_sites` becomes
 * `aggregate_min_scoring_sites` and the withhold cause `below_eval_floor`
 * becomes `below_scoring_floor`. Every consumer of either name must change.
 *
 * The rename is the visible part of a real defect. The floor exists to stop a
 * pooled figure standing on too few sites, and it was comparing the size of
 * `eval_on`, the sites ASKED to evaluate, against the threshold. `aggregate` is
 * a mean over `n_sites_scored`, the sites that ANSWERED. Nothing in the record
 * or in this page related those two numbers, so a round that asked six sites
 * and heard back from one satisfied the floor and published that one site's
 * value under a pooled label. That is precisely the leak the floor was added
 * for, restored intact, by the field the floor reads.
 *
 * This is the same class as 0.5.0's self-referential denominator, one step
 * sideways. There the check took its operand from the thing it was checking and
 * could not fail. Here the check takes an operand the published figure is not
 * derived from, and fails against the wrong quantity. Both read as a rule about
 * the number on screen, and neither was.
 *
 * A parameter named after the wrong operand is the doc-comment defect in
 * field-name form: `min_eval_sites` describes what the gate READ, and the name
 * was the argument for keeping it. So the name moves with the operand, and
 * `n_sites_scored` stops being an optional stand-in for `per_site` and becomes
 * the field the floor is checked against, required whenever an aggregate is
 * published.
 *
 * 0.7.0-draft: MINOR. `CampaignMetric.n_datasets_scored`, the denominator 0.4.0
 * left missing when it made the key space declarable. A consumer that ignores
 * it keeps withholding correct dataset-keyed aggregates forever, so ignoring it
 * is not a safe default and every reader of `per_site` must change.
 *
 * 0.4.0 let a producer SAY its map was dataset-keyed and gave it no way to say
 * how many datasets there were, so declaring the truth made the map permanently
 * uncheckable. The field was the honest move and it was half a mechanism: a
 * declaration with no matching count is a claim a reader still cannot verify,
 * which is the condition these basis fields exist to remove rather than
 * relocate.
 *
 * Named by the producer, not here. The page had the gap written down for a
 * version with the field deliberately unspecified, because inventing it would
 * have been one side asserting a property the other never agreed to, which is
 * the mistake `per_site_basis` was added to fix.
 *
 * The counts are siblings and NOT alternatives. `n_sites_scored` stays required
 * whenever `aggregate` is non-null, because the scoring floor is a rule about
 * sites however the map is keyed, and a dataset-keyed round therefore carries
 * both. Reading their co-occurrence as the contradiction would reopen 0.6.0's
 * leak in a second key space. The contradiction is a dataset count on a
 * site-keyed round, which is a record that has not decided what it counts.
 *
 * 0.8.0-draft: MINOR, and the largest change in the list. `progress` becomes a
 * discriminated union on `mode`, so `rounds` and `round` move inside the
 * synchronous arm and every consumer must switch before it can read either.
 * Adds the asynchronous arm: `ContributionRecord`, `SoupRecord`,
 * `ContributorRecord`, `MergeTrigger`, `CommunityCheckpoint`.
 *
 * It would have been half the diff to add `contributions` and `soups` as
 * nullable siblings of `rounds` and let each page check which is populated. That
 * is the version of this change that encodes a campaign shape that cannot exist,
 * and it fails in the direction this file cares about: a reader with both fields
 * in scope and no discriminant has to decide which one wins, and every such
 * decision is a page inventing a semantics the producer never stated. The same
 * argument as `per_site_basis`, one level up again. A union costs every consumer
 * a switch. A nullable pair costs the first careless consumer a wrong page.
 *
 * `disposition` on a contribution is the one field here added for a decision
 * that has NOT been taken. That is normally the mistake this file warns about,
 * and it is done deliberately and narrowly: the aggregation fork (uniform, which
 * the backend implements today, versus greedy, which would make exclusion real)
 * is live, and a field added later would mean re-cutting the shared fixture
 * corpus the backend is being built against. The hold is on the RENDERING,
 * documented at the type, so nothing on screen claims a mechanism the backend
 * cannot exercise.
 *
 * 0.9.0-draft: MAJOR in effect if not in number, and it is the fork landing. The
 * aggregation decision came back greedy with full-weight souping, which changes
 * three things here.
 *
 * `SoupRecord.metric` is GONE and is not renamed in place, which is the point of
 * doing it this way. It splits into `witness_metric` and `selection_metric`, and
 * `CampaignMetric` grows a required `role` so the two are distinguishable as values
 * and not only as field names. A consumer that was reading `.metric` gets a
 * compile error and has to choose, rather than silently continuing to read
 * whichever score now lives at the old name. Under a gate, the wrong choice draws
 * a curve that rises because rising is the admission criterion, so this is
 * precisely the case where a quiet migration is worse than a loud one.
 *
 * `SoupRecord.assessed` records the candidate pool a merge considered, which
 * under uniform souping was the same set as `contributions` and under greedy is
 * not. Without it "folded in 3" is unreadable: three out of three and three out
 * of eleven are different facts about the merge and the record could not tell
 * them apart.
 *
 * The 0.8.0 hold on `disposition: 'excluded'` is lifted, under the two
 * constraints in the inclusion section of this header. The field itself is
 * unchanged, which is what it was added early for.
 *
 * 0.10.0-draft: MINOR and additive. `EmptyMerge` and `empty_merges`, for a merge
 * that ran and admitted nothing. Greedy souping makes that a real event, and the
 * backend records it with no soup and no published version, which was correct on
 * the wire and a hole on the page: the contribution stream draws its merge
 * markers from `soups`, so a declined merge drew no marker and its excluded
 * contributions sat under a legend that said they had been assessed by one.
 *
 * Reusing `SoupRecord` with a null `community_model` was the cheaper change and
 * the wrong one. That null already means a lost record, and one field cannot
 * carry both "we never heard what this merge produced" and "this merge decided
 * to produce nothing" without the page having to guess which campaign it is
 * looking at. The same argument as the union one version up: a nullable field
 * doing two jobs costs the first careless consumer a wrong page.
 *
 * The other half is transport. A declined checkpoint still crossed the network,
 * and per-merge transport lived only on `SoupRecord`, so those bytes were in the
 * campaign total with no per-merge home and the breakdown could not reconcile
 * with the headline. `EmptyMerge.transport` closes that, and the backend is
 * putting a transport block on every merge record it stores, published or not.
 *
 * 0.11.0-draft: MINOR and additive, in two parts, both from the Cellpose-SAM
 * soup backend's field contract (live-kudu, 12 Sep 2026).
 *
 * `CampaignMetric.aggregate_scope`. The scoring floor assumed every aggregate is a
 * mean over PARTICIPANT-held scores, because that is what the synchronous
 * consortium produced, and it refuses any aggregate with a null
 * `n_sites_scored`. The soup campaign scores its witness split centrally on a
 * campaign-owned holdout, so there is no participant-held quantity in the number
 * and no site count to report. The rule did not merely fail on that record, it
 * did not apply to it, and the page's answer was to withhold the whole
 * improvement curve for want of a denominator that has no meaning here.
 *
 * The tempting fix was for the producer to put SOMETHING in `n_sites_scored`,
 * which is how a disclosure rule turns into a formality: a declared denominator
 * is the only evidence this page has, and an invented one passes every check.
 * Declaring the scope instead keeps the floor exactly as strict as it was on
 * pooled figures and stops it firing on figures it was never about. Same reason
 * `per_site_basis` is data: an eval basis asserted in prose is a claim nobody
 * can check.
 *
 * `baseline_metric` on the async arm. The lineage curve starts at the first
 * community version, so a reader can see the versions rise past each other and
 * cannot see whether any of them beat the model the campaign started from. That
 * is the comparison the campaign exists to make and it was absent. It renders as
 * a reference level rather than as the first point on the curve, because the
 * base model is not a community version and a point on that curve asserts one.
 *
 * NOT added, and worth recording as a decision rather than an oversight: a
 * witness metric on `EmptyMerge`. A no-admit merge leaves the checkpoint
 * unchanged and the backend carries the previous value forward, so plotting it
 * would restate a measurement at a timestamp where nothing was measured. If the
 * backend ever re-evaluates the unchanged head for a noise floor, that is a
 * fresh number and this decision reopens.
 *
 * 0.13.0-draft: `MergeTrigger` splits the rule from the actor, and `EmptyMerge`
 * gains a merge-level `selection_metric`.
 *
 * The trigger change is the load-bearing one. `kind` was carrying two
 * independent facts, WHAT DECIDES and WHAT THE RULE IS, so a cron in an agent
 * wrapper and a genuine agent loop produced identical records. `decided_by` and
 * `agent.invoked_by` separate them and make the decorative case detectable
 * rather than merely disallowed. This landed AHEAD of the evidence that lets
 * the flagship campaign state a rule, on purpose: the backend was already
 * emitting provenance the wire did not define, and a field set two services
 * disagree about is worse than a field nobody populates yet.
 *
 * `EmptyMerge.selection_metric` records the gate bar no candidate cleared. It
 * is never plotted, for the same reason no selection metric ever is. The
 * argument for a field rather than reading the bar off the preceding
 * `SoupRecord` is in the field doc, and it turns on the empty FIRST merge,
 * where there is no preceding record to read.
 *
 * 0.12.0-draft: `base_model` becomes `BaseModelRef` and gains `version`.
 *
 * 0.11.0-draft gave the async arm a `baseline_metric` and called it "the level
 * the community versions are read against". The reproducibility check closed on
 * 12 Sep 2026 found that the level had no address: the zoo entry "Cellpose-SAM"
 * has two committed versions with different weights, so the label the page drew
 * on that reference line named an entry, not a checkpoint, and a reader could
 * not have fetched the weights that produced the number.
 *
 * This is a MINOR bump on a draft that the backend is mid-implementation
 * against, which is a cost worth naming. Adding a required field under the
 * existing version would have been the cheaper move and the wrong one: the
 * version string is what tells a reader which wire they are on, and a wire that
 * changed without it is the drift this envelope exists to catch. The backend is
 * making the same disambiguation, so it is a coordinated change either way.
 *
 * 0.14.0-draft: MINOR, and by far the largest removal in this list. The
 * SYNCHRONOUS ARM IS GONE. Campaigns target foundation models only, with
 * Cellpose-SAM as the pilot, which is a scope decision from Nils on 15 Sep 2026
 * and not a schema judgement.
 *
 * Removed: the `mode: 'synchronous'` member of `CampaignProgressRecord` and of
 * `CampaignSummary.progress`, `RoundRecord`, `SiteRecord`, `SiteRole`,
 * `SiteActivity`, `CampaignExperiment`, `CampaignRecord.experiment`, and
 * `PayloadDescriptor.bytes_per_site_per_round`.
 *
 * Renamed, because the unit they were named after no longer exists:
 * `RoundMetric` becomes `CampaignMetric`, `RoundTransport` becomes
 * `TransportCounts`, `SiteDataset` becomes `ContributorDataset`, and
 * `DeclaredSiteField` becomes `DeclaredProfileField` (not
 * `DeclaredContributorField`, which would have sat one character from the
 * existing `DeclaredContributionField`). Earlier entries in this log use the
 * NEW names, so that every name in this file resolves to something that exists.
 *
 * Deliberately NOT renamed: `per_site`, `per_site_basis`, `n_sites_scored`,
 * `policy.aggregate_min_scoring_sites`, `CampaignSummary.n_active_sites` and
 * `KeySpace` `'site'`. The rule separating the two lists is whether the thing
 * named still exists. A round does not exist in any form, so a type called
 * `RoundMetric` points at nothing. A scoring site does exist and is now called a
 * contributor, so those names are merely stale, and renaming a live concept
 * across roughly three hundred call sites inside a removal this size would make
 * both changes harder to review than either alone. Read "site" as "a scoring
 * participant". This is a known debt, recorded rather than left to be
 * rediscovered.
 *
 * `reporting.reconciled` and `reconciled_at` survive with NO PRODUCER, which is
 * documented at the field rather than fixed. They were defined against the
 * federated driver's end-of-arm committed record, and that driver left with the
 * synchronous arm.
 *
 * The cost being accepted, recorded here so it is not re-litigated: this file
 * began as a thin typed view over `apps/federated-unet/` in the bioengine repo,
 * that app is live and maintained, and after this version the website no longer
 * types its records at all. The app keeps running and keeps its own data. It
 * simply has no website contract, which was the ruling rather than an oversight.
 *
 * `mode` stays a discriminated union with one member. Collapsing it would save
 * every consumer one switch today and cost a breaking re-cut, plus a re-pin on
 * every consumer of the fixture corpus, the first time a second process appears.
 * The union was the expensive half of 0.8.0-draft and it is already paid for.
 */
export const CAMPAIGN_SCHEMA_VERSION = '0.14.0-draft';

/**
 * What a per-unit map is keyed by.
 *
 * One alias rather than a repeated union, because the three maps that carry a
 * basis must offer the same vocabulary. A site-keyed map and a dataset-keyed
 * map are both well-formed, and which one a page can use depends entirely on
 * what else in the record shares that space.
 *
 * Null is not a member and never means 'site'. Every field of this type is
 * `KeySpace | null` at its use site, and null there means the producer did not
 * say, which is a third state the reader has to handle separately.
 */
export type KeySpace = 'site' | 'dataset';

/**
 * What crosses the network per contribution and per merge.
 *
 * `kind` exists so the page can describe the payload truthfully for campaigns
 * with very different transport profiles. A 300M-parameter foundation model
 * exchanging full weights and the same model exchanging a low-rank adapter are
 * both legitimate; they are not the same claim, and no component hardcodes
 * either one.
 */
export interface PayloadDescriptor {
  kind: 'full_state_dict' | 'lora_adapter' | 'gradient' | 'other';
  /** Human-readable, rendered verbatim. e.g. "Full state dict", "LoRA adapter (r=8, qkv and head)". */
  label: string;
  /**
   * Measured bytes for one contribution's upload, where the transport log covers
   * it. Null otherwise, and NEVER estimated from a parameter count.
   *
   * A campaign-wide measured figure is specifically not acceptable here: the
   * per-source transport logs are in-memory and reset on process restart, so a
   * campaign-wide sum silently undercounts. A trustworthy campaign-wide number
   * exists, but it is computed from the validated transfer pattern rather than
   * observed, so it belongs in `ComputedTransport` where it can be labelled.
   *
   * Through 0.13.0-draft this sat beside `bytes_per_site_per_round`, its
   * synchronous sibling, and the pair was deliberately not collapsed into one
   * field. The sibling went with the synchronous arm in 0.14.0-draft. The reason
   * they were separate is still the rule here: this figure is multiplied by
   * however many contributions happen to arrive, which no schedule fixes, so it
   * must never be read as a per-period quantity.
   */
  bytes_per_contribution: number | null;
}

/**
 * One dataset a contributor holds. Mirrors `get_status().datasets_loaded[name]`,
 * snapshotted into the record at join and at each contribution. Never read live:
 * see the snapshotted-not-proxied note in the file header.
 */
export interface ContributorDataset {
  name: string;
  /** What the images contain, e.g. "fluorescence nuclei". */
  objects: string | null;
  n_train: number | null;
  n_val: number | null;
  n_test: number | null;
  /** Where the data came from. Null for data the contributor has not published. */
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
 * Names of `ContributorRecord` profile fields whose values a contributor typed
 * into a join form rather than the platform measuring them.
 *
 * Named for the PROFILE rather than the contributor, to keep it one character
 * apart from nothing. `DeclaredContributionField` already exists and names the
 * declared fields of a single CONTRIBUTION, which is a different record with a
 * different lifetime, and `DeclaredContributorField` beside it would have been
 * two near-identical names for two things a reader has to keep apart.
 */
export type DeclaredProfileField = 'contributor_name' | 'country' | 'datasets' | 'n_train_images';

/**
 * Why the service published no aggregate for a scored event.
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
 *  - `below_scoring_floor`  fewer than `policy.aggregate_min_scoring_sites`
 *                           sites SCORED. At one site the aggregate IS that
 *                           site's value under a pooled label, and every
 *                           leave-one-site-out fold has a singleton eval set.
 *
 *                           Scored, not asked. This cause was `below_eval_floor`
 *                           and both the name and the check read the size of the
 *                           eval set, which is the set of sites invited to
 *                           evaluate. The aggregate is a mean over the ones that
 *                           returned a score. Where those differ the gate passes
 *                           on a number the published figure has nothing to do
 *                           with.
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
  | 'below_scoring_floor'
  | 'floor_unknown';

/**
 * What a score is FOR, which decides whether it may be drawn as improvement.
 *
 * Not a description of how the score was computed. Both roles are ordinary
 * metrics on ordinary held-out splits and may even be the same metric function.
 * The difference is entirely in what the campaign does with the number, and that
 * is a fact only the campaign knows, which is why it is declared rather than
 * inferred.
 *
 *  - 'witness': scored on a split that GATES NOTHING. No contribution was ever
 *    admitted or refused on the strength of it, so a series of these across
 *    versions is an honest improvement curve.
 *  - 'selection': the score the greedy gate admitted contributions against.
 *    Real, useful, and unplottable as improvement, because the series can only
 *    go up: going up on that split is the admission criterion. Plotting it would
 *    show the selection rule working and would be read as the model improving.
 *
 * There is no third value and no null. An unroled metric would be one a reader
 * cannot classify, and the safe reading of "unknown role" is 'selection', which
 * means the page would withhold it anyway. Requiring the field makes the producer
 * state which it is instead of the page guessing conservatively and quietly
 * dropping curves the campaign was entitled to show.
 *
 * A campaign that selects nothing, as uniform souping and FedAvg both do,
 * publishes only witnesses by construction. It still declares the role, because
 * "by construction" is an argument about the campaign and not a property of the
 * record, and a reader holding one record cannot check the argument.
 *
 * NOTE TO PRODUCERS. The page enforces this field in one direction only. It
 * refuses a metric declaring 'selection' in a slot it plots, and it cannot
 * detect a gate score declared 'witness', because the declaration is the only
 * evidence it has. Emitting the gate metric as a witness produces a curve that
 * rises by construction and looks exactly like a real result. Make the witness
 * split structurally unreachable from the selection code path rather than
 * relying on this field being filled carefully.
 *
 * The reference producer does this, as of 12 Sep 2026: its contract test
 * compares the emitted curve against split B rather than inspecting the tag, so
 * a witness value fabricated from split A is caught despite carrying the right
 * label, and it cross-checks its field-sets against this repository's fixture
 * corpus. Note what that is and is not. It is a guarantee at the producer, and
 * it does not make the paragraph above stale: this page still trusts the label
 * at render time, because at render time the label is still all there is. See
 * the trust point in `aggregateDisposition.ts`.
 */
export type MetricRole = 'witness' | 'selection';

/**
 * Who holds the data an aggregate was measured on, which decides whether the
 * scoring floor is a rule about this number or a rule about a different kind of
 * number entirely.
 *
 *  - 'participant_pool': the aggregate is pooled over scores computed on data
 *    each participant holds. `n_sites_scored` is its denominator and is
 *    REQUIRED, and the floor applies, because a mean over few participants is
 *    one participant's value wearing a pooled label.
 *  - 'campaign_holdout': one measurement on a split the campaign owns, scored
 *    centrally. No participant-held quantity enters it, so there is nothing for
 *    the floor to protect and no site count to report. `n_sites_scored` is
 *    legitimately null and the completeness gate and the floor are both
 *    INAPPLICABLE rather than failed.
 *
 * Null means the producer did not say, and the page treats that as
 * 'participant_pool', which is the strict reading. That default is deliberate
 * and is the opposite of the usual "null means unknown, so withhold": here the
 * conservative branch is the one that keeps checking, and silently upgrading an
 * unlabelled metric to 'campaign_holdout' would let a pooled figure skip the
 * floor by omitting a field.
 *
 * NOTE TO PRODUCERS, and this is the whole point of the field. If your metric is
 * a central holdout, declare it. Do NOT reach for a plausible `n_sites_scored`
 * to get past the floor. A denominator is the only evidence the page has about
 * where a number came from, an invented one passes every check, and the result
 * is a pooled-looking figure standing on nothing. That is the same failure as
 * declaring a gate metric 'witness', and this schema now has two fields whose
 * only defence is that the producer told the truth.
 */
export type AggregateScope = 'participant_pool' | 'campaign_holdout';

/**
 * The scoring for one event: a merge's witness or selection score, or the
 * campaign's baseline. `name` is campaign-specific and rendered as given.
 *
 * Was `RoundMetric` through 0.13.0-draft. The shape is unchanged; the unit it
 * hangs off is not, and several of the field docs below still say "round" where
 * they mean "scored event". They are being corrected as they are touched rather
 * than in one sweep, because a mechanical pass over prose is how a true sentence
 * becomes a plausible false one.
 */
export interface CampaignMetric {
  /**
   * Whether this score gates anything. See `MetricRole`. Required, and the one
   * field here that is about the campaign's process rather than its numbers.
   */
  role: MetricRole;
  /**
   * Whose data `aggregate` was measured on. See `AggregateScope`. Null is read
   * as 'participant_pool', the strict branch, so an unlabelled metric cannot
   * skip the scoring floor by omission.
   */
  aggregate_scope: AggregateScope | null;
  /** e.g. "validation Dice". Never abbreviated to "score" by the page. */
  name: string;
  higher_is_better: boolean;
  /**
   * Per-unit scores. Null when the campaign publishes none.
   *
   * The key space is NOT implied. It is stated by `per_site_basis` and this
   * field means nothing without it.
   *
   * This doc comment used to assert a site-id key space, and that was the
   * defect. The producer it was written against keyed by DATASET: `val_dice()`
   * in run_federated.py built `scores[dataset]` while returning
   * `scored_with[site]` from the same loop, so two key spaces came out of one
   * function. A page that reads this map as site-keyed resolves dataset names
   * through the roster and renders whichever ones happen to match as labelled
   * per-participant curves.
   *
   * Nothing detects that by inspection. In the launch consortium the client
   * name and the dataset name are the identical string for all six datasets
   * (deploy.py:60-71), so every dataset key resolves against the roster and a
   * dataset-keyed map is indistinguishable from a site-keyed one. An
   * attributability check passes by naming coincidence, which is the worst
   * case: it passes, so nobody looks again.
   *
   * Hence the basis is data and not prose. A key space asserted in a comment is
   * the same class of error as a tier asserted in a comment: the producer never
   * agreed to it and the reader cannot check it.
   */
  per_site: Record<string, number> | null;
  /**
   * What `per_site` is keyed by. Null means the producer did not say, which is
   * not a default to 'site'.
   *
   * The page draws per-site curves only for 'site'. For 'dataset' it has a map
   * it can label but no denominator in the record to check it against, since
   * `n_sites_scored` counts sites. For null it has neither.
   *
   * For 'dataset' the denominator is `n_datasets_scored`, added in 0.7.0 and
   * named by the producer rather than here, which is the same reason this field
   * is data and not prose. Before it existed there was no count in any key space
   * but site, so a campaign whose map is permanently dataset-keyed, the correct
   * and unchanging shape of a pooled arm, had its aggregate withheld forever
   * with nothing it could do about it.
   */
  per_site_basis: KeySpace | null;
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
   * Also withheld when fewer than `policy.aggregate_min_scoring_sites` sites
   * scored, and when `n_sites_scored` is null, since that is the count the
   * threshold is checked against. See `aggregate_withheld`.
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
   * counter, and no note. The event silently shortened the line, and every
   * withheld score was rendered as if the campaign had never produced one.
   */
  aggregate_withheld: AggregateWithholdCause | null;
  /**
   * How `aggregate` was pooled, e.g. "merge-weighted mean over per-dataset
   * validation Dice". Rendered wherever the aggregate is, because a pooled
   * figure with an unnamed basis is not checkable.
   */
  aggregate_basis: string | null;
  /**
   * How many participants contributed a score to this event.
   *
   * The denominator of `aggregate`, and therefore the operand the scoring floor
   * is checked against. It began life as the public stand-in for `per_site`, a
   * way to state completeness without publishing the map, and it is still that.
   * It is no longer only that, which is why the doc comment grew: the floor used
   * to read a count of participants ASKED instead, and a page reading this
   * field as an optional completeness hint would not notice that the floor now
   * depends on it.
   *
   * Required whenever `aggregate` is non-null, whether or not `per_site` is
   * published. Null withholds the aggregate rather than skipping the floor,
   * because the alternative is publishing a pooled figure with no statement of
   * how many sites stand behind it, which is the condition the floor exists to
   * rule out.
   *
   * Never greater than the number of participants asked, where a campaign
   * publishes that: a participant cannot return a score it was not asked for.
   * That is a contradiction rather than a coverage gap, and the page reports it
   * as one.
   */
  n_sites_scored: number | null;
  /**
   * How many datasets contributed a score to this event.
   *
   * A count in the same key space as the VALUES of the driver's `scored_by` map,
   * which is what makes it comparable to `len(val_dice)` and to nothing else.
   * That sentence is the whole point of the field and it lives here rather than
   * in the page, because a page-side derivation is exactly the unverifiable
   * claim `per_site_basis` was added to replace, and the next reader would
   * otherwise have to re-derive it from the driver.
   *
   * Present when and only when `per_site_basis` is 'dataset'. On a site-keyed
   * event there is nothing for it to count, and a record carrying both a site
   * map and a dataset count has not decided what it counts, so the page refuses
   * it rather than picking one. That is a louder failure than silently
   * preferring either, which is the point of requiring the key spaces to agree.
   *
   * This does NOT displace `n_sites_scored`, and the two are not alternatives
   * even though they are siblings. The scoring floor is a rule about SITES
   * whatever the map is keyed by: a pooled arm averaging six datasets from one
   * site is still one site's data under a pooled label, which is the disclosure
   * the floor exists to stop. So a dataset-keyed event with an aggregate carries
   * both counts, this one to show its map is complete and `n_sites_scored` for
   * the floor to stand on. Treating their co-occurrence as the contradiction
   * would reopen 0.6.0's leak in a second key space.
   *
   * Null on a dataset-keyed event is not a fault and is not refused as one. The
   * field postdates the first completed campaign, whose records cannot be
   * regenerated, so a dataset-keyed event without it falls back to the older
   * behaviour: the map cannot be checked, and the aggregate is withheld with no
   * accusation attached.
   */
  n_datasets_scored: number | null;
}

/**
 * A metric that gates nothing, and therefore the only kind that may be plotted
 * as improvement.
 *
 * The alias exists so the restriction lives in a TYPE rather than in a comment
 * asking the next author to read the right field. `ScoredEvent.metric` is
 * declared as this, so handing it a `SelectionMetric` fails to compile, and the
 * mistake it prevents is one that produces a chart that looks correct. Every
 * other rule in this file that could be stated as a type is, for the same
 * reason: `per_site_basis` exists because a key space asserted in prose is a
 * claim nobody can check.
 */
export type WitnessMetric = CampaignMetric & { role: 'witness' };

/**
 * The score a greedy soup admitted contributions against.
 *
 * Carried in the record because withholding it would make the selection
 * unauditable: a reader is entitled to see what the gate was and what it said.
 * It is simply never the improvement curve. See `MetricRole`.
 *
 * A page may render one of these as a stated gate figure beside the merge that
 * used it. What no page may do is put a series of them on an axis against time
 * or version, which is the shape the type prevents by not being assignable to
 * `ScoredEvent.metric`.
 */
export type SelectionMetric = CampaignMetric & { role: 'selection' };

/**
 * Bytes moved by one unit of campaign activity: a contribution upload, a merge,
 * or one source's share of either.
 *
 * Was `RoundTransport` through 0.13.0-draft, when the unit was always a round.
 * The shape did not change with the rename; the unit did, and the unit is the
 * whole content of the type.
 *
 * Per-unit attribution is what makes transport reportable at all. The per-source
 * logs are in-memory and reset on process restart, so a campaign-wide sum
 * silently undercounts: it looks complete and is not. The same truncated log
 * read per unit gives exact bytes for the units it covers and null for the units
 * it does not, which turns an invisible undercount into a visible gap.
 *
 * These figures are rendered PER UNIT and are never summed, extrapolated, or put
 * over the data held. A per-unit transport figure and a campaign-wide one are
 * different quantities and the comparison between them reverses sign depending
 * on which you use. See the note at the top of TransportAudit.tsx.
 */
export interface TransportCounts {
  bytes_out: number | null;
  bytes_in: number | null;
  n_transfers: number | null;
  /**
   * True only when EVERY source's log covers this unit.
   *
   * This is the per-unit analogue of `ObservedTransport.valid` and it exists for
   * the same reason. A merge covered by four sources out of six produces a
   * `bytes_out` that is a real sum of real entries and is still not the merge's
   * transport: it is a partial sum that looks complete, which is the exact
   * failure the campaign-wide total has, moved down one level.
   *
   * Views therefore gate the byte figure on this flag rather than on `bytes_out`
   * being populated, because a populated value cannot tell a reader whether it is
   * whole. Null fails closed, like every other flag in this schema, so a service
   * that cannot answer this per unit simply shows no per-unit bytes.
   */
  sources_complete: boolean | null;
}

/**
 * Whether a contribution ended up in a soup.
 *
 * All three values are reachable as of 0.9.0-draft. The campaign soups greedily
 * and admits contributions against a held-out split, so a contribution can be
 * assessed and left out.
 *
 *  - 'pending': arrived, and no merge has considered it yet.
 *  - 'included': a merge folded it into a published community version.
 *  - 'excluded': a merge assessed it and did not take it.
 *
 * 'excluded' IS NOT A VERDICT ON THE CONTRIBUTOR and pages must not word it as
 * one. A greedy soup leaves out checkpoints that are individually fine: the gate
 * asks whether adding this one improves the POOLED model on the day, which
 * depends on what else is in the pool, and a contribution that adds nothing to a
 * soup that already covers its imaging modality is the ordinary case rather than
 * a bad one. The only defensible rendering is the one that says what happened:
 * assessed, not taken.
 *
 * Nor is it terminal. This field is the state as of the most recent merge that
 * considered the contribution, and a campaign is free to reconsider it later.
 * Nothing here licenses a page to say a contribution "will not" be used.
 *
 * Null is the fourth state and means the service did not say, which is not
 * 'pending'. A contribution whose disposition is unknown and one the service
 * knows has not been merged yet are different facts, and the difference is
 * exactly whether a soup has run since it landed.
 */
export type ContributionDisposition = 'pending' | 'included' | 'excluded';

/** Names of `ContributionRecord` fields the contributor typed rather than the platform measuring. */
export type DeclaredContributionField = 'n_train_images' | 'dataset_name';

/**
 * One finished local fine-tune, pushed by one contributor.
 *
 * The continuous stream. There is no round number here and there must not be
 * one: contributions arrive at arbitrary wall-clock times and any integer index
 * the page assigned would be a position in the service's reporting order rather
 * than a property of the campaign. `received_at` is the ordering key, and it is
 * the x-axis of every async view.
 *
 * `base_version` is the field that makes a contribution checkable at all. A
 * lockstep process would not need it: every participant trains from the same
 * aggregate by construction, so "which weights did this start from" is answered
 * by the schedule. Here contributors start from whatever community version was
 * current when they began, which may be several soups behind by the time they
 * finish, and nothing but this field records it. A contribution built on a stale base is
 * not invalid and is not hidden; it is a real property of async training that
 * the record carries so a reader can see it rather than assuming freshness.
 */
export interface ContributionRecord {
  contribution_id: string;
  /** FK to `ContributorRecord.contributor_id`. */
  contributor_id: string;
  /** ISO 8601. When the service recorded the push. The ordering key, and the x-axis. */
  received_at: string;
  /**
   * The `CommunityCheckpoint.version` this fine-tune started from. Null when the
   * contributor trained from the campaign's base model rather than from a soup,
   * which is the correct value for every contribution before the first merge,
   * and null also when the service did not record it. Those two are not
   * distinguished here, which is a known weakness of this field: the first case
   * is derivable from `received_at` preceding the first `SoupRecord.merged_at`
   * and the second is not derivable at all. Named so the next reader does not
   * mistake the ambiguity for a statement.
   */
  base_version: string | null;
  /**
   * Bytes this contribution put on the network, MEASURED off the transport log.
   * Null when the log does not cover it, and NEVER estimated from a parameter
   * count or copied from `PayloadDescriptor.bytes_per_contribution`, which is a
   * campaign-level typical figure and not this contribution's.
   */
  bytes_out: number | null;
  /**
   * The contributor's training-set size for this run. Opt-in, and governed by
   * the SAME flag as every other appearance of a training-set size, because it
   * is the same protected quantity: under sample-count weighting this is
   * literally the weight this contribution carried into the soup.
   */
  n_train_images: number | null;
  /** What the contributor trained on, as declared. Null when not declared. */
  dataset_name: string | null;
  /**
   * Which of this contribution's own fields are self-declared. Same contract and
   * same rendering rule as `ContributorRecord.declared`, including that an empty
   * array is a positive statement and is not null.
   */
  declared: DeclaredContributionField[] | null;
  /**
   * Whether this contribution is in a soup. All values render as of 0.9.0-draft.
   * See ContributionDisposition for the wording constraints on 'excluded', which
   * are binding rather than advisory.
   */
  disposition: ContributionDisposition | null;
  /**
   * The `SoupRecord.soup_id` that folded this in. Null when none has, which is
   * the ordinary state for any contribution that arrived since the last merge.
   *
   * Redundant with `disposition` on a uniform campaign and NOT redundant on a
   * greedy one, where a contribution can be evaluated and left out: excluded with
   * a null soup_id says it was considered and not taken, and 'pending' with a
   * null soup_id says no soup has run. Keeping both is what lets those stay
   * distinguishable if the greedy fork is chosen, without a schema change at the
   * point the distinction first matters.
   */
  merged_into: string | null;
}

/**
 * One soup merge: the discrete, ordered stream.
 *
 * Each one averages some set of contributions into a new IMMUTABLE community
 * checkpoint. Immutability is what makes the soup series a lineage rather than a
 * history of edits to one model, and it is why `CommunityCheckpoint` hangs off
 * this record rather than there being a separate versions array. Two lists that
 * must stay in step is how they drift, and the soup sequence already is the
 * lineage.
 *
 * `index` is an ordinal over merges within the campaign and is genuinely
 * sequential, unlike anything in the contribution stream. It is safe to use as
 * an axis. It is NOT a round number: it counts merges, not training cycles, and
 * the count of contributions behind merge N is not fixed.
 */
export interface SoupRecord {
  soup_id: string;
  /** 0-based ordinal over merges in this campaign. Sequential, unlike contributions. */
  index: number;
  /** ISO 8601. */
  merged_at: string;
  /**
   * The contribution ids folded into this soup.
   *
   * Publishing the SET is a process fact and is not gated. Publishing how much
   * each one counted is the protected quantity, and it lives in `weights` under
   * the training-set-size flag. Presence and weight are different quantities and
   * only the weight is protected, so the set may be published while the values
   * are withheld.
   *
   * Under greedy souping this is the set the gate ADMITTED, which is a subset of
   * `assessed` rather than equal to it.
   */
  contributions: string[];
  /**
   * The contribution ids this merge CONSIDERED, admitted or not.
   *
   * A superset of `contributions`, and the field that makes "folded in 3"
   * readable: three of three and three of eleven describe very different merges
   * and the record could not tell them apart without this.
   *
   * Null means the service did not publish the candidate pool, which is NOT the
   * same as the pool having been equal to `contributions`. A page that defaulted
   * it that way would report every unreported greedy merge as having taken
   * everything it looked at, which is the flattering reading and the wrong one.
   * With null the page says how many were folded in and does not imply a
   * denominator.
   *
   * On a uniform campaign the two sets genuinely coincide, and such a campaign
   * should publish them both rather than sending null, because "we considered
   * these and took all of them" is a real statement about how the campaign works
   * and is worth being able to make.
   *
   * This is per MERGE on purpose. The same information aggregated per
   * contributor would be a rejection tally with the ranking left for the reader
   * to do, which the inclusion section of the file header rules out.
   */
  assessed: string[] | null;
  /**
   * Per-contribution merge weights, keyed by `contribution_id`. Opt-in under the
   * same flag as `ContributionRecord.n_train_images`, because under sample-count
   * weighting these ARE the training-set sizes.
   *
   * Null on a uniform campaign is not a withhold. Uniform weighting has no
   * per-contribution weight to publish, and `aggregation.weighting` is what says
   * which case a reader is in.
   */
  weights: Record<string, number> | null;
  /**
   * The community checkpoint this merge produced. Null when the service has not
   * recorded one, i.e. a REPORTING GAP, and the page says so in those words
   * rather than showing a merge with no output.
   *
   * A null here never means "the merge admitted nothing and so published
   * nothing". Under greedy souping a merge that admits nothing produces no
   * SoupRecord at all; it is an `EmptyMerge` instead (backend semantics fixed by
   * live-kudu, 12 Sep 2026). That separation is deliberate. If both cases landed
   * on this one null, the page could not tell a lost record from a merge that
   * declined its whole candidate pool, and those are opposite facts: the first
   * is a hole in the reporting, the second is the community model being good
   * enough that nothing on offer improved it.
   *
   * So: every SoupRecord published a version. `soups.length` is the number of
   * community versions, `index` is an ordinal over them, and neither counts
   * merges that ran and published nothing.
   */
  community_model: CommunityCheckpoint | null;
  /**
   * Evaluation of THIS soup's checkpoint on a split that gates nothing.
   *
   * THE ONLY FIELD IN THIS RECORD THAT MAY BE PLOTTED AS IMPROVEMENT. See
   * `MetricRole`. Named `witness_metric` rather than keeping the old `metric`
   * name so that reading the plottable score is a positive act: with a field
   * called `metric` sitting next to a field called `selection_metric`, the
   * shorter name reads as the default and the default would be the circular one
   * on any campaign that publishes both.
   *
   * Gated on `policy.outcomes_released`, because it is the outcome axis and a
   * metric published mid-campaign reads as a result when it is a partial
   * observation.
   *
   * Reusing `CampaignMetric` rather than defining a parallel type is deliberate.
   * Every rule that type carries (the key-space basis, the scoring floor, the
   * withhold causes, the required denominator) applies unchanged to a soup: a
   * pooled figure over too few contributors is the same disclosure hazard as one
   * over too few sites. A parallel type would be the same rules re-derived, and
   * the ones that got re-derived loosely are what versions 0.4.0 through 0.7.0 of
   * this schema were spent fixing.
   */
  witness_metric: WitnessMetric | null;
  /**
   * The score the greedy gate admitted this merge's contributions against.
   *
   * Published so the selection is auditable: a reader who is told some
   * contributions were not taken is entitled to see what the criterion was.
   * Null on a campaign that selects nothing, where there is no gate to report
   * and its absence is inapplicability rather than a withhold.
   *
   * Never a series and never an axis. `ScoredEvent.metric` will not accept it,
   * which is the mechanical half of that rule.
   */
  selection_metric: SelectionMetric | null;
  /** Digest of the merged weights, so a point on the eval curve ties to an exact checkpoint. */
  global_sha256: string | null;
  /** Bytes moved by this merge: the distribution of the new checkpoint to contributors. */
  transport: TransportCounts | null;
}

/**
 * One immutable version of the growing community model.
 *
 * The payoff of the whole campaign, and the thing a visitor is most likely to
 * want: not the process, but the model they can go and use. It carries a zoo
 * link because a community checkpoint that cannot be opened is a claim rather
 * than a deliverable.
 */
export interface CommunityCheckpoint {
  /** Fully qualified, e.g. "bioimage-io/collaborative-narwhal". Null before publication. */
  artifact_id: string | null;
  /** The immutable version this soup wrote, e.g. "v4". */
  version: string;
  /** Zoo URL, when the checkpoint is published and browsable. */
  url: string | null;
  /**
   * How many contributions stand behind this version CUMULATIVELY, across every
   * soup up to and including the one that produced it.
   *
   * Stated by the service rather than summed by the page from `contributions`
   * lengths. The contribution stream may have gaps, for the fire-and-forget
   * reason in the file header, so a page-side sum would silently report the
   * reporting coverage as the campaign's size, and it would do it on the single
   * number most likely to be quoted.
   */
  n_contributions_cumulative: number | null;
}

/**
 * A merge that RAN and published no new community version.
 *
 * Under greedy souping the gate can decline every candidate it was offered. The
 * backend records that as a merge event with no soup and no checkpoint, which is
 * correct on the wire and would have been a hole on the page: the contribution
 * stream draws its merge markers from `soups`, so a declined merge would have
 * drawn no marker, and its excluded contributions would have sat in a stretch of
 * timeline with no merge in it under a legend reading "assessed by a merge, not
 * included in it". The chart would have contradicted its own key, and a reader
 * resolving that by attributing those contributions to the next VISIBLE merge
 * would have been wrong with nothing on screen to correct them.
 *
 * A merge that declines everything is also not nothing happening. It is the
 * community model being good enough that nothing on offer improved it, which is
 * one of the more interesting things an async campaign can show, and it would
 * otherwise have rendered as a quiet week.
 *
 * This is a SEPARATE type rather than a `SoupRecord` with a null
 * `community_model`, and the distinction is load-bearing in both directions.
 * A null `community_model` means a lost record. An `EmptyMerge` means a merge
 * that admitted nothing. Folding them together would have put a version-less row
 * in the table of versions and re-muddled the reporting-gap contract on the one
 * field that exists to keep it clean.
 *
 * It carries no `index`, no version and no witness metric on purpose. There is
 * no published checkpoint to number, name or score, so there is nothing for it to
 * contribute to the improvement curve and it does not appear there. It appears
 * on the stream, where the question is what happened and when, and in the
 * transport totals, because a declined checkpoint still crossed the network.
 */
export interface EmptyMerge {
  /** ISO 8601. */
  merged_at: string;
  /**
   * The contribution ids this merge CONSIDERED and did not admit.
   *
   * Empty and null mean different things and the page phrases them differently.
   * An empty array is a merge that ran with nothing to consider, i.e. the trigger
   * fired and no contribution had arrived. A non-empty array is a merge that
   * considered these and declined them. Null is the service not having published
   * the candidate pool, exactly as in `SoupRecord.assessed`, and the page then
   * says a merge ran without saying what it looked at.
   *
   * Per MERGE, never aggregated per contributor, under the same rule as
   * `SoupRecord.assessed`: the per-contributor version of this is a rejection
   * tally with the ranking left for the reader to do.
   */
  assessed: string[] | null;
  /**
   * Bytes moved by this merge.
   *
   * Inbound only in the usual case: the candidate checkpoints arrived and nothing
   * was distributed back, because there was no new version to distribute. Those
   * bytes are real and belong in the campaign total, and without a per-merge home
   * here the per-merge breakdown would have omitted them while the campaign-wide
   * figure included them, leaving the two disagreeing with no way to explain why.
   *
   * The page does not currently render this, and that is not an oversight. It
   * never sums per-merge transport into anything: the campaign total comes from
   * `CampaignTransport`, stated by the service, and `SoupRecord.transport` is
   * only ever shown per row. Summing across merges would be the same
   * unsynchronised-window mistake the transport audit exists to refuse. The field
   * is here so the two figures CAN be reconciled by whoever holds both, and so
   * that the reconciliation does not require the campaign total and the sum of
   * published merges to be silently different numbers.
   */
  transport: TransportCounts | null;
  /**
   * The gate bar no candidate cleared, on the SELECTION split. Never plotted.
   *
   * `role` is 'selection' and the page holds to the rule it holds everywhere:
   * the selection metric is the score the greedy gate admits against, it rises
   * by construction, and drawing it would be drawing the gate's own opinion of
   * itself. This is on the wire for audit, named in prose at most, and the
   * suite asserts it is not rendered.
   *
   * It is MERGE-LEVEL, one scalar for the bar, and carries no per-member
   * scores. The per-contributor version of this is a rejection ranking, which
   * the campaign does not publish in any form.
   *
   * The deciding argument for putting it HERE rather than reading the bar off
   * the preceding `SoupRecord`: an empty FIRST merge has no preceding record,
   * and the bar in that case is the base model's own score on the selection
   * split, which is nowhere on the wire. The read-it-off-the-previous-row
   * shortcut is also only sound while the community checkpoint is unchanged,
   * which is true across a run of empty merges but is a property the reader has
   * to derive rather than read. A field that is recoverable most of the time
   * and silently unrecoverable at the one moment a campaign is most likely to
   * decline everything is not the cheaper option.
   *
   * Null is the ordinary reporting gap: a merge declined everything and the
   * service did not publish what it was measuring against.
   */
  selection_metric: CampaignMetric | null;
}

/**
 * What causes the next soup to run.
 *
 * Campaign-level, and TWO independent facts rather than one: the rule a merge
 * batch fires on (`kind`), and the actor that makes the call (`decided_by`,
 * with `agent` when that actor is an agent). Either can be stated without the
 * other, and the page renders whichever it is given.
 *
 * The page renders a NEXT merge ONLY for 'scheduled' with a non-null
 * `next_merge_at`. Under 'manual' there is nothing to predict. Under
 * 'on_contributions' a countdown looks predictive and is not, because it depends
 * on when volunteers finish runs on hardware nobody here controls, so the page
 * shows the threshold and the count against it and stops short of a time. A
 * predicted merge time that slips is worse than no prediction on a page whose
 * entire claim is that its numbers are observations.
 *
 * THE UNION WAS INCOMPLETE AND IS NOW SPLIT IN TWO. Resolved 12 Sep 2026, and
 * recorded here because the shape of the fix is the part worth keeping.
 *
 * The Cellpose-SAM community campaign's merges are driven by an AGENT through
 * the skill interface: it fires the merge, runs the greedy gate, publishes the
 * versioned checkpoint, and records a non-improving contribution as evaluated
 * and not included. None of the three original members said that. 'scheduled'
 * is a timer, and the backend has since verified in shipped code that no
 * scheduler, cron or timer fires a merge anywhere in the app. 'manual' is a
 * person pressing something, which is a claim about a human doing the work.
 *
 * The gap was not cosmetic, because `kind` was doing two jobs at once. It mixed
 * WHAT DECIDES to merge with WHAT THE RULE IS, and those are independent: an
 * agent could act on a clock, on a threshold, or on its own reading of what has
 * arrived. Collapsed, a cron in an agent-shaped wrapper and a genuine agent
 * loop produce identical records, and a page drawing an agent from one of them
 * would be decorating an automated loop.
 *
 * So they are separate fields now. `kind` carries only the RULE. `decided_by`
 * carries the ACTOR. `agent.invoked_by` carries what called the agent, and it
 * is there to make the decorative case CHECKABLE rather than merely forbidden:
 * `decided_by: 'agent'` alongside `invoked_by: 'timer'` describes a cron in an
 * agent wrapper, and the page refuses to draw an agent for that combination. A
 * rule the page can only state in prose is not a rule the page enforces.
 *
 * DEFINING A FIELD IS NOT POPULATING IT, and the two moved separately on
 * purpose. The fields landed as soon as the encoding was agreed, because the
 * backend was already emitting provenance the wire did not define, which is the
 * precise drift the schema version exists to catch. What each field is allowed
 * to SAY is gated on evidence independently: `decided_by` and `invoked_by` are
 * grounded in the backend's code reading, so the flagship campaign states them.
 * `kind` is not, because nobody has yet established whether this campaign fires
 * merges on a nameable rule or the agent reads each batch for itself, so it
 * stays null and the page says the record does not state the rule.
 *
 * DECIDED AND WORTH NOT RELITIGATING: there will be no 'agent_judgement' kind.
 * It was proposed here and ruled out on 12 Sep 2026, and the reason is a
 * distinction this type should carry rather than a preference.
 *
 * The agent's genuine judgement in this design is WHAT TO ADMIT: the greedy
 * gate takes a contribution or records it as evaluated and not included. That
 * decision is already in the record, in the gate and assessed fields, and it is
 * not a property of the trigger. WHEN a merge batch fires is a rule (a cadence,
 * a contribution threshold, a human, or nothing), and the agent executes that
 * rule rather than deliberating over it.
 *
 * A trigger member meaning "the agent decided it was time" would invite the
 * page to draw the agent choosing WHEN, which is a bigger claim than anything
 * the backend makes, and the harder kind of overclaim to notice because it
 * flatters the design. Two axes, rule and actor, describe every campaign;
 * judgement is a third thing and it lives with the gate.
 *
 * The one case that reopens this: a backend that says the agent genuinely
 * decides timing by its own reading, with no rule it can name. That does not
 * get drawn on this page without going back to the paper side first. Note the
 * two failures point in opposite directions, so both need guarding. An
 * agent label over a timer is a decorative agent. A deliberation claim over a
 * nameable rule is an inflated one.
 */
export interface MergeTrigger {
  /**
   * The RULE that fires a merge batch. Not who runs it.
   *
   * Null means the record does not state the rule, and the page says so rather
   * than leaving a gap for the reader to fill with "a schedule". Null is NOT
   * 'manual': a campaign nobody has characterised and a campaign someone runs
   * by hand are different facts.
   */
  kind: MergeRule | null;
  /**
   * The ACTOR that makes the call. Not the rule it acts on.
   *
   * Independent of `kind` in both directions. An agent can execute a cadence, a
   * threshold, or its own reading, and a human can do the same. Null means
   * unstated.
   *
   * A LABEL, NOT MEASURED PROVENANCE, and the distinction limits how much the
   * refusal below can be trusted. Established 12 Sep 2026 against the
   * model-finetune backend: the merge entry point threads no caller identity,
   * so any value here is a constant chosen by whoever configured the campaign
   * rather than an observation of who called. A human invoking the same method
   * is mislabelled by it.
   *
   * Threading a caller id would NOT repair this, which is the part worth
   * writing down before someone tries. A principal id is an identity, not an
   * actor type: it cannot separate an agent from a person, because both arrive
   * as principals. Distinguishing them needs the invocation path to say what
   * KIND of thing it is, which is what `agent.invoked_by` does, and which is
   * why the anti-decorative check keys on that field and not on this one.
   *
   * So `resolveMergeActor` is strong on the pair (agent + timer is caught) and
   * weak on this field alone (it reads 'agent' whenever the campaign says so).
   * Anyone reading a drawn agent as verified provenance is reading more than is
   * here.
   */
  decided_by: MergeDecider | null;
  /**
   * Present only when `decided_by` is 'agent'. Null otherwise, and null when an
   * agent decided but the service did not say what called it.
   *
   * Nested rather than flattened into a sibling `invoked_by` so that the
   * dependency is structural: there is no way to describe how an agent was
   * invoked without saying an agent was involved, and no orphan field sitting
   * null for every human-driven campaign, which is how a reader learns to
   * ignore a field.
   */
  agent: MergeAgent | null;
  /** ISO 8601. Only meaningful for kind 'scheduled'. Null under every other kind, and null when unknown. */
  next_merge_at: string | null;
  /** The N for kind 'on_contributions'. Null under every other kind. */
  contributions_per_merge: number | null;
}

/**
 * What fires a merge batch: a person, a clock, or an agent.
 *
 * 'timer' and an agent are not mutually exclusive in the world, only in this
 * field. A timer that calls an agent is recorded as `decided_by: 'agent'` with
 * `invoked_by: 'timer'`, because the agent is what runs and the timer is what
 * started it. That pair is exactly the decorative case, and it is written down
 * rather than made unrepresentable so that the page can DETECT it. A schema
 * that cannot express the dishonest case cannot catch it either.
 */
export type MergeDecider = 'human' | 'timer' | 'agent';

/**
 * What invoked the agent.
 *
 * 'skill_call' is an agent acting through the skill interface, which is the
 * case this campaign is in. 'human' is a person starting an agent run, which is
 * still a genuine agent doing the work. 'timer' is a scheduled invocation, and
 * the page treats it as a loop wearing an agent label.
 *
 * HONOUR SYSTEM, and worth being precise about the limit. This field is
 * self-reported by the service, so the refusal it drives catches the honest
 * case where a timer-invoked agent is described accurately, not a service that
 * decides to write 'skill_call' over a cron. That is still worth having: the
 * failure this guards against is a system drifting into decoration without
 * anyone intending it, which is the likely failure, not a lie.
 */
export type AgentInvocation = 'skill_call' | 'timer' | 'human';

/** The rule a merge batch fires on. Carries no claim about who applies it. */
export type MergeRule = 'manual' | 'scheduled' | 'on_contributions';

export interface MergeAgent {
  invoked_by: AgentInvocation | null;
}

/**
 * One participant in a campaign.
 *
 * Characterised by WHEN it first contributed and how often it has since, which
 * is what `joined_at`, `latest_contribution_at` and `n_contributions` carry.
 * There is deliberately no join INDEX of any kind. Through 0.13.0-draft this
 * type had a synchronous sibling whose participants were characterised by the
 * rounds they were present for, and the two were kept separate rather than
 * merged behind nullable fields, because a field that is structurally always
 * null for half the campaigns is how a reader learns to ignore it. The sibling
 * is gone and that reasoning is kept, because the field it warns against is the
 * one someone will propose adding back.
 *
 * `contributor_name` is SELF-DECLARED: the platform does not verify that a
 * deployment belongs to the institution or person it names. In an OPEN campaign
 * this matters more rather than less, because the roster is no longer a short
 * list of known institutions that a reader could sanity-check by eye.
 */
export interface ContributorRecord {
  contributor_id: string;
  /** Self-declared. Not verified against any institutional identity. */
  contributor_name: string;
  /** ISO 3166 country name or null if not declared. */
  country: string | null;
  /** ISO 8601. When this contributor's first contribution was recorded. */
  joined_at: string | null;
  /** ISO 8601. Null for a contributor that has never contributed. */
  latest_contribution_at: string | null;
  /**
   * How many contributions this contributor has made. Stated by the service, not
   * counted page-side from the stream, for the same coverage reason as
   * `CommunityCheckpoint.n_contributions_cumulative`.
   */
  n_contributions: number | null;
  /** Snapshot of `get_status().torch.cuda_device`. Null on CPU-only or undisclosed. */
  accelerator: string | null;
  datasets: ContributorDataset[];
  /**
   * Summed training-set size across this contributor's datasets. Opt-in under
   * the same flag as everywhere else this quantity appears.
   */
  n_train_images: number | null;
  /** Snapshot of `get_status()`. Null when not reported. */
  bioengine_version: string | null;
  /**
   * Which of this contributor's profile fields are self-declared rather than
   * measured. Rendered visually distinct from measured values, so a reader can
   * tell a form entry from an observation without being told per field.
   *
   * An empty array is a positive statement that nothing was declared. It is not
   * the same as null and must not be collapsed into it.
   *
   * Still nullable even though the service has required it since 0.2.5-draft,
   * because this type describes what can arrive over the wire, not what the
   * producer promises to send. Nothing on this side type-checks the JSON.
   * Dropping the null would delete the page's only handling of a producer
   * regression and replace it with the assumption that regressions do not
   * happen, which is how self-declared values would go back to being presented
   * as platform-measured. ContributorRoster renders the third state visibly
   * rather than silently picking a side.
   */
  declared: DeclaredProfileField[] | null;
}

/**
 * The progress model, discriminated on `mode`.
 *
 * One member since 0.14.0-draft. See the one-mode note in the file header for
 * why the discriminant stays: it costs a switch nobody can currently get wrong
 * and it is what makes a second process additive instead of breaking.
 */
export type CampaignProgressRecord = {
  mode: 'asynchronous';
  /** ISO 8601. When the campaign opened for contributions. */
  started_at: string | null;
  /**
   * The continuous stream, ordered by `received_at`. May have gaps: reporting
   * into the campaign service is fire-and-forget and is never awaited on the
   * training critical path, so a service outage costs records and not runs. A
   * gap is a LOST RECORD rather than a contribution that did not happen, and the
   * pages must say so in those words.
   *
   * A gap here is NOT detectable by inspection, and that is the hard part. An
   * indexed series makes a missing element visible as a hole in the integers; a
   * missing contribution leaves nothing at all, because the stream has no index
   * to be discontinuous in. `reporting.dropped_reports` is therefore the ONLY
   * signal this campaign has that its stream is incomplete, which makes it
   * load-bearing rather than diagnostic. A page that ignores it is not showing a
   * slightly short stream, it is showing a stream it has no grounds to call
   * complete.
   */
  contributions: ContributionRecord[];
  /**
   * The discrete ordered stream of PUBLISHED versions. `index` is sequential
   * and safe as an axis.
   *
   * This is not every merge the campaign ran. A merge whose gate admitted
   * nothing published no version and is in `empty_merges`. So
   * `soups.length` is the number of community versions, and the number of
   * merges is `soups.length + empty_merges.length`. Any view that says
   * "merges" rather than "versions" has to add the two, and the copy has to
   * pick one noun and mean it.
   */
  soups: SoupRecord[];
  /**
   * The base model's own witness score, measured on the same split by the
   * same code before any contribution was folded in. Null when the campaign
   * did not measure one.
   *
   * It is NOT the first point of the lineage, and the field exists at this
   * level rather than as `soups[-1]` so that it cannot be made into one by
   * an off-by-one. A lineage point is a published community version with a
   * `soup_id`, an `index`, a member list and a digest. The baseline has
   * none of those: it is the starting checkpoint, which the campaign did
   * not produce and cannot point a reader at as its own output. Splicing it
   * into the series would put a version-0 on the axis that never existed,
   * and would make the first real merge look like an increment from a
   * campaign artefact rather than from the published model everyone
   * already had.
   *
   * What it is for is the question a witness curve cannot answer alone.
   * Without it the curve says the community model improved over successive
   * merges, which is true and uninteresting, since a greedy gate admits
   * only what improves. With it the curve says whether the community model
   * is better than the thing it started from, which is the only comparison
   * a reader outside the campaign has any use for. Render it as a reference
   * LEVEL across the whole chart, labelled with the base model's name.
   *
   * Typed `WitnessMetric` so the role declaration is required and the same
   * refusals apply. A baseline measured on the selection split is a gate
   * figure and must not be drawn beside a witness curve as though the two
   * were comparable, and nothing about being a baseline exempts it. For the
   * comparison to mean anything it must carry the same `name` and the same
   * `aggregate_scope` as the soups' witness metrics, and a page that finds
   * they differ should say so rather than drawing the line anyway.
   */
  baseline_metric: WitnessMetric | null;
  /**
   * Merges that ran and published nothing. Separate array because they are a
   * different kind of event, not a degenerate soup. See `EmptyMerge`.
   *
   * Empty array and null are the usual distinction: empty says the campaign
   * has run no such merge, null says the service does not report them, and
   * on null the page stops claiming the merge markers are complete rather
   * than showing a timeline it cannot vouch for.
   */
  empty_merges: EmptyMerge[] | null;
  contributors: ContributorRecord[];
  merge_trigger: MergeTrigger | null;
};

/** The span of the transport log one source contributed, used to check agreement. */
export interface TransportWindow {
  /** The merge side, or a `ContributorRecord.contributor_id`. */
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
 * summing across them has no defined meaning. `valid: false` and a rendered
 * `invalid_reason` is the expected state for any campaign whose sources restart,
 * which is most of them, and the page shows the reason instead of the numbers.
 */
export interface ObservedTransport {
  valid: boolean;
  /** Why the windows disagree, in words a reader can act on. Null when valid. */
  invalid_reason: string | null;
  /**
   * One transport window per contributing unit.
   *
   * Nothing renders this today. The basis below is here anyway, because the
   * reason the other two maps went wrong was not that someone read the comment
   * carelessly, it was that the comment was the only thing a consumer had. A
   * field with no consumer is exactly where that gap survives longest: the
   * first component to use it inherits an unverifiable claim and there is
   * nothing at that point to notice it against.
   */
  per_site: Record<string, TransportCounts> | null;
  /**
   * What `per_site` is keyed by. Null means the producer did not say.
   *
   * No producer has yet declared a key space for this map. That is a fact about
   * the current state of the backend rather than about the record, which is the
   * distinction this field exists to carry: a page may not assume contributor
   * keys merely because `TransportWindow.source` uses them.
   */
  per_site_basis: KeySpace | null;
  driver: TransportCounts | null;
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
   * The formula counts the transfers the campaign's pattern implies, and a
   * campaign that restarted a merge, re-uploaded a contribution, or retried a
   * failed transfer really did put weights on the network in ways the pattern
   * does not see. Such a campaign moved strictly more than this.
   *
   * Nothing in the record says whether a given campaign retried anything, so the
   * page cannot qualify this conditionally, and it does not need to: "at least"
   * is true of a clean run as well. Both of this page's transport figures now
   * fail in the same direction. The observed sum undercounts when the windows
   * disagree, the computed figure undercounts when the run was resumed, and
   * neither can overstate what crossed the network. That is the right direction
   * for the only claim this page is really making.
   */
  bytes_moved: number | null;
  /**
   * The formula, rendered verbatim, e.g. "one upload per contribution plus one
   * download per contributor per published version x measured payload size".
   *
   * Rendered verbatim and never reconstructed page-side. That property became
   * load-bearing rather than incidental when the contract carried two modes with
   * genuinely different formulae, and it stays that way: a campaign that changes
   * how it counts transfers must change a string here, not a component.
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
   * size, MEASURED, and the same quantity as
   * `ContributorRecord.n_train_images`. Null when unreported.
   *
   * It therefore sits behind the same opt-in flag as every other appearance of a
   * training-set size. It looks innocuous and is not.
   *
   * The SUM has a failure the individual values do not. A published total plus
   * n-1 opted-in contributors reconstructs the one that opted out, so the
   * service serves `n_images` only when EVERY contributor on the roster has set
   * the flag, not merely when the ones being summed have. Withholding one
   * contributor from a total that is still published is not withholding it.
   * This is the same shape as the partial-aggregate rule on `CampaignMetric`.
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
   * The minimum number of SCORING sites below which `CampaignMetric.aggregate` is
   * withheld. A campaign-level judgement, not a derivation, which is exactly
   * why it lives here and is not a constant in this repo: a page that supplied
   * its own value would present one consortium's disclosure threshold as a
   * property of the platform.
   *
   * Checked against `CampaignMetric.n_sites_scored`, the participants that
   * ANSWERED, and deliberately never against a count of participants ASKED. That
   * distinction is the whole reason for the current name. The aggregate is a
   * mean over who answered, so a campaign that invites six and hears from one
   * publishes that one participant's own value under a pooled label: the exact
   * disclosure this threshold exists to prevent, passing the threshold. The
   * field it used to read, `eval_on`, went with the synchronous arm. Nothing may
   * reintroduce an asked-count operand here under any name.
   *
   * "Sites" is a STALE NOUN and is kept on purpose, unlike `RoundMetric`, which
   * was renamed to `CampaignMetric` in the same version. The difference is that
   * a round no longer exists in this contract at all, whereas the thing this
   * counts, a participant that held data and returned a score, exists exactly as
   * before and is now called a contributor. `per_site`, `per_site_basis`,
   * `n_sites_scored` and `KeySpace` `'site'` are the same family and are all
   * left alone for the same reason: renaming a live concept across roughly three
   * hundred call sites in the middle of a mode removal makes both changes harder
   * to review, and the noun is wrong rather than misleading. Read "site" as "a
   * scoring participant" throughout.
   *
   * The long name is deliberate. A bare `min_scoring_sites` reads as a validity
   * condition on the whole record, which would have the page drop the record
   * entirely. This gates ONE outcome field and leaves every process field
   * standing.
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
  aggregate_min_scoring_sites: number | null;
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
 * The model a campaign started from.
 *
 * One interface rather than the inline shape it replaces, because the summary
 * and the detail both carry it and had drifted apart once already.
 *
 * WHY `version` EXISTS. A zoo entry is a name over a sequence of committed
 * versions, and those versions are not the same weights. The reproducibility
 * check closed on 12 Sep 2026 found the entry "Cellpose-SAM" has two committed
 * versions, 0.1.0 and 0.2.0 (cpsam_v2), with DIFFERENT weights under the one
 * name. So "the published Cellpose-SAM weights" does not identify a checkpoint,
 * and a baseline labelled that way cannot be reproduced by a reader: they would
 * have to guess which of the two produced the number.
 *
 * The page treats an unstated `version` the way it treats every other unstated
 * field. The VALUE still renders, because a score the service stated is a score
 * the service stated. The NAME does not, because naming the entry while the
 * checkpoint is unknown is the page asserting an identity the record does not
 * carry. See SoupLineage for where that falls out.
 */
export interface BaseModelRef {
  /** Fully qualified artifact id, e.g. "bioimage-io/cellpose-sam". */
  id: string;
  name: string;
  /**
   * Which committed version the campaign started from, e.g. "0.2.0".
   *
   * Null means the service did not say. It does NOT mean "latest": resolving it
   * that way would silently re-point an old campaign's baseline every time the
   * zoo entry gains a version, which is the exact failure this field exists to
   * prevent.
   */
  version: string | null;
  url: string | null;
  /**
   * Digest of the exact weights the campaign started from, lowercase hex.
   *
   * WHY THIS EXISTS AT ALL, given `version` above. The base model is the ONE
   * checkpoint in the chain the campaign did not make. Every checkpoint it
   * produces carries `SoupRecord.global_sha256`, so this is the only identity
   * in the chain that rests on an external registry agreeing with itself, and
   * the weak link sits exactly where the external dependency is.
   *
   * A digest is the stronger identifier even when `version` is confirmed, and
   * not by a small margin. A registry can re-upload the same version string
   * over different weights; a digest cannot be re-pointed. That asymmetry bites
   * the PAGE rather than the paper: authored captions freeze at publication and
   * can anchor on a hash directly, while this interface re-renders whatever the
   * wire currently says, so a silent re-upload would change which weights the
   * page describes with nothing in the record to catch it.
   *
   * FULL DIGEST ONLY, never truncated. A reader cannot check a partial hash
   * against anything, so a truncated value has the appearance of content
   * identification without the substance, which is worse than omitting it.
   *
   * REQUIRED-NULLABLE SINCE 0.14.0-draft, matching `version` one field up.
   *
   * It shipped optional at 0.13.0-draft on the reasoning that required would
   * force every producer and the fixture corpus to restate the field while two
   * services were mid-re-pin, with the stated plan to tighten it on the next
   * change that already forced a re-pin. Dropping the synchronous arm is that
   * change, so the debt is paid here rather than carried further: an optional
   * field lets a producer omit it indefinitely, and "absent" and "null" saying
   * the same thing is one distinction too many for a field whose whole job is
   * to be checkable.
   *
   * Note what this does and does not buy when populated. Showing a digest lets
   * a reader check; it is not itself a check, because the page has no
   * independent expected value to compare against. Calling it verification
   * would be the same overclaim `resolveMergeActor` documents about
   * `decided_by`.
   */
  sha256: string | null;
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
 * The summaries carry `payload` and `progress`, which is exactly where a
 * renamed unit turns a byte count into a megabyte count, so the argument for
 * checking the detail applies to the index with no weakening at all.
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
  base_model: BaseModelRef | null;
  /**
   * Headline progress, discriminated exactly as the full record's is.
   *
   * The index used to carry a bare `round: {current, total}`, which a soup
   * campaign has no honest value for. Sending `{current: null, total: null}`
   * would have rendered as an unreported round on a campaign that has no rounds
   * to report, so the index would have shown every campaign as a lockstep one
   * with missing telemetry. That is the reason the discriminant is here and the
   * reason it stays now that there is one member: an index that flattens its
   * shape is exactly where the next mode would be misread.
   */
  progress: {
    mode: 'asynchronous';
    /** Contributions recorded so far. Stated by the service, not counted page-side. */
    n_contributions: number | null;
    /** Community model versions published so far, i.e. how many soups have run. */
    n_versions: number | null;
  };
  /**
   * Active contributors. The name is inherited from the two-mode era, when this
   * one field counted sites or contributors depending on the arm, and it is left
   * alone with the rest of the site-noun family. See
   * `CampaignPolicy.aggregate_min_scoring_sites` for why that family was not
   * renamed here.
   */
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
   * Nothing experiment-shaped belongs in this path. An arm, a seed or a sweep
   * index identifies a campaign but is re-cut whenever the experiment is, and
   * baking one into the URL breaks every existing link at that moment.
   */
  campaign_id: string;
  title: string;
  description: string | null;
  status: CampaignStatus;
  policy: CampaignPolicy | null;
  base_model: BaseModelRef | null;
  /**
   * How contributions become a shared model. Free text, rendered verbatim,
   * because the page must not be the thing that decides what counts as a method.
   *
   * A model-soup campaign says "greedy soup" under the fork ruled on 12 Sep
   * 2026, and said "uniform soup" or "sample-weighted soup" under the
   * alternatives that were live until then. `weighting` is what tells a reader
   * whether
   * `SoupRecord.weights` being null is a withhold or simply inapplicable:
   * uniform weighting has no per-contribution weight to publish.
   */
  aggregation: {
    /** e.g. "greedy soup", "uniform soup". */
    method: string;
    /** e.g. "sample count", "uniform". */
    weighting: string;
  };
  licence_policy: {
    /** Data licences a joining site may attest to, e.g. ["CC0-1.0", "CC-BY-4.0"]. */
    accepted_data_licences: string[];
    model_licence: string | null;
  };
  /**
   * The progress model. Switch on `progress.mode` before reading anything in it,
   * even though there is one mode to switch on. See the one-mode note in the
   * file header.
   */
  progress: CampaignProgressRecord;
  reporting: {
    /** How many reports the service knows it lost in flight, when it counts them. */
    dropped_reports: number | null;
    /**
     * Whether the reported series has been checked against an authoritative
     * committed store.
     *
     * NO PRODUCER as of 0.14.0-draft. It was defined against the federated
     * driver's end-of-arm record, which left this contract with the synchronous
     * arm, and the soup backend has not stated an equivalent. Null therefore
     * means nobody has said, NOT "not yet reconciled", and a page must not
     * render the second reading. See the lossy-reporting note in the file
     * header for why the field is kept rather than dropped.
     */
    reconciled: boolean | null;
    /** ISO 8601. When reconciliation last ran. Null if it never has, which is always today. */
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
