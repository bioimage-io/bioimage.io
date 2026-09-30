import { AggregateWithholdCause, WitnessMetric } from '../../types/campaign';

/**
 * Whether a pooled score may be plotted, and if not, who decided so.
 *
 * Three outcomes and not two, because "no point on the chart" covers three
 * situations a reader must be able to tell apart:
 *
 *  - the campaign decided not to publish it, and said which rule fired
 *  - the page decided not to render one the campaign did publish
 *  - nobody decided anything and the value is simply not in the record
 *
 * The chart used to collapse the third into nothing at all. Its loop plotted
 * when the aggregate was present and passed the gates, counted a withhold when
 * the aggregate was present and failed them, and a null aggregate fell out of
 * both branches: no point, no counter, no note. So a score the service had
 * deliberately withheld arrived as an unexplained shortening of the line.
 *
 * That is the same silent-permissive shape as a gate that treats a null
 * predicate as "the condition does not hold", one layer further out: every
 * absence the page PRODUCED carried its cause, and every absence the page
 * RECEIVED went through the branch that does nothing. The audit boundary had
 * been drawn at what this code authors rather than at what it renders.
 */

/**
 * Why the page refused to plot an aggregate the service did publish.
 *
 * Distinct from AggregateWithholdCause even where the words coincide. The
 * service's causes describe a decision it made. These describe a decision it
 * did NOT make and the page made instead, which at this schema version means
 * the record is inconsistent with the contract it claims to satisfy. Same
 * reason, different actor, and the note has to say which, because one of them
 * is the system working and the other is a defect to report.
 *
 * Every member of this union names a stated obligation the record breaks. The
 * service commits to withholding the aggregate for `partial_map`,
 * `completeness_unknown`, `below_scoring_floor` and `floor_unknown`, so a
 * record that publishes one anyway has broken a rule it declared. The rest are
 * self-contradictions: a value beside a reason there is no value, a cardinality
 * that cannot occur, a count in a key space the map does not use, and a metric
 * in a witness slot that declares itself a selection score.
 *
 * That is the membership test, and it is stated here because the note under the
 * chart tells the reader this in as many words. Anything that fails the test
 * belongs in `PanelLimit`. See there for the two that did.
 */
export type PageRefusal =
  /** An aggregate arrived alongside a stated reason for there being none. */
  | 'contradictory_withhold'
  /** Some per-site values published; the aggregate reconstructs the rest. */
  | 'partial_map'
  /** A site-keyed map with more entries than sites recorded as having scored. */
  | 'map_exceeds_count'
  /** No `n_sites_scored`, so neither completeness nor the floor can be checked. */
  | 'completeness_unknown'
  /**
   * A dataset count on a record whose map is not dataset-keyed.
   *
   * `n_datasets_scored` is specified as present when and only when
   * `per_site_basis` is 'dataset', so a record carrying it anywhere else has
   * not decided what it counts. Note the direction: it is the COUNT that is
   * out of place, never the co-occurrence of the two counts. A dataset-keyed
   * record with an aggregate carries both, because the floor is a rule about
   * sites however the map is keyed, and reading their co-occurrence as the
   * contradiction would reopen 0.6.0's leak in the dataset key space.
   */
  | 'count_key_space_mismatch'
  /** Fewer SCORING sites than the campaign's own floor. */
  | 'below_scoring_floor'
  /** No floor stated, so it cannot be shown to have been met. */
  | 'floor_unstated'
  /**
   * A metric declaring `role: 'selection'` arrived in a slot the page plots as
   * improvement.
   *
   * The type of `ScoredEvent.metric` stops this at every call site in this
   * repository, so nothing here can produce it. The wire can: the record is JSON
   * off an RPC boundary, and a producer that puts its gate score in
   * `witness_metric` breaks the one obligation the `role` field exists to carry.
   *
   * A refusal rather than a panel limit, and the membership test is satisfied
   * cleanly: the field is declared as carrying a witness, so a selection metric
   * in it is the record contradicting its own declaration.
   *
   * This one is worth the belt and braces that the other causes are not. Every
   * other refusal here withholds a number that would merely be unsupported. This
   * one withholds a curve that would be WRONG IN A DIRECTION: a series of gate
   * scores rises because rising is the admission criterion, so a circular curve
   * is indistinguishable from a real improvement by inspection, and it is
   * flattering. A defect that looks like success and cannot be seen is the one
   * that survives review.
   */
  | 'gate_metric_as_witness'
  /**
   * A metric declaring `aggregate_scope: 'campaign_holdout'` also published a
   * per-participant map.
   *
   * The scope says the number was measured centrally on data the campaign owns,
   * and the map says it was measured on data the participants hold. Both cannot
   * be true of one figure, and the page cannot pick, because the two readings
   * differ in exactly the way the scoring floor cares about: one has a
   * disclosure hazard and the other does not.
   *
   * A refusal rather than a panel limit, and cleanly so: `aggregate_scope` is a
   * declaration about the record's own contents, and the map contradicts it.
   * The cause exists because 'campaign_holdout' SKIPS the floor. Any field that
   * can turn a check off has to be unable to turn it off by accident, so the
   * one shape where the declaration is not credible is refused rather than
   * quietly honoured.
   */
  | 'holdout_scope_with_per_site_map';

/**
 * Why this panel cannot check an aggregate whose record is entirely correct.
 *
 * A fourth outcome, and the reason it is fourth is the same reason there were
 * three. `PageRefusal` means the record contradicts its own declared format, and
 * the note under the chart says so in as many words. That sentence was true of
 * every member when it was written, and then `per_site_basis` was added in
 * 0.4.0 so a producer could DECLARE a non-site key space, which made
 * `'dataset'` a conforming value and left a conforming record sitting inside a
 * category the page describes as malformed.
 *
 * That is this file's own defect class arriving in prose. 0.4.0 and 0.5.0 both
 * removed doc comments asserting a property of a value the comment could not
 * see. This was a RENDERED sentence asserting a property of a set the sentence
 * could not see, filled at runtime, and it is the worse of the two because a
 * doc comment misleads a maintainer while this misleads a reader about somebody
 * else's data.
 *
 * The cost is not hypothetical. The pooled arm of the federated layout is one
 * site scoring six datasets, its map is dataset-keyed permanently and by
 * design, and it is 15 of the 75 arms in the completed consortium run. Under
 * the old category the page told a reader that a fifth of that run failed to
 * match its own format. Nothing about those records is wrong.
 *
 * The aggregate is still withheld, and that part was never the mistake. A
 * dataset-keyed map has no denominator anywhere in the record to check its
 * completeness against, so an aggregate published beside it can still fill in
 * entries the map omits. Withholding is right. Calling it a defect was not.
 *
 * Both members are key-space causes, and that is not a coincidence. Key space
 * is the one property the schema made declarable in 0.4.0 without attaching any
 * completeness commitment to the non-site case, so it is exactly the region
 * where a producer can conform fully and still leave this page unable to check
 * anything. Only one of the two was reported. The other was found by asking
 * which remaining members actually fail the membership test written above
 * `PageRefusal`, which is the check that should have existed when that sentence
 * was first rendered.
 */
export type PanelLimit =
  /**
   * The map is keyed by something this record carries no count of.
   *
   * Until 0.7.0 that was every dataset-keyed record, because `n_sites_scored`
   * was the schema's only denominator and it counts sites, so completeness was
   * assertable in the site key space and in no other. `n_datasets_scored`
   * closed that gap, and it closed it the way the gap had to be closed: by the
   * producer publishing a count in the map's own key space rather than by this
   * page inferring one.
   *
   * So this now fires only on a dataset-keyed record that carries no dataset
   * count, which after 0.7.0 means a record written before the field existed.
   * It stays a panel limit and does not become a refusal, because the completed
   * consortium run cannot be regenerated and a record cannot be at fault for
   * omitting a field that did not exist when it was written. The behaviour it
   * selects is the pre-0.7.0 behaviour exactly: the map cannot be checked, so
   * the aggregate is withheld, and nobody is accused.
   */
  | 'per_site_not_site_keyed'
  /**
   * A per-unit map arrived without saying what it is keyed by.
   *
   * `per_site_basis: null` is documented as "the producer did not say", an
   * explicitly permitted value rather than an omission, and no service withhold
   * cause covers it. So a record can reach here having broken nothing. It
   * carries less than this page needs, which is a different thing from carrying
   * something it should not.
   */
  | 'per_site_basis_unstated';

/**
 * The obligation each refusal says the record broke.
 *
 * This exists because the membership test above `PageRefusal` was applied once,
 * by hand, and found two members that failed it. A test applied once catches the
 * instances present that day. The two it caught had been wrong since 0.4.0 and
 * were not noticed for three versions, so the useful output of that exercise is
 * the test, not its two results, and a test only survives as something the code
 * runs.
 *
 * So each cause has to name the obligation, in one sentence, and the check
 * script asserts the two directions that make the naming load-bearing: every
 * cause this module can emit is registered, and every registered cause is
 * actually reachable. Adding a member to either union without deciding which
 * side it belongs on now fails a test instead of shipping.
 *
 * The sentences are for the maintainer, not the reader. Reader-facing wording
 * lives in `SoupLineage`, phrased as the withhold rather than as the breach.
 */
export const REFUSAL_OBLIGATION: Record<PageRefusal, string> = {
  contradictory_withhold:
    'A record states a reason there is no aggregate, or it publishes one. Not both.',
  partial_map:
    'The service withholds the aggregate when the per-unit map is short of the count, because the aggregate would fill the omissions back in.',
  map_exceeds_count:
    'A map cannot hold more entries than the record says scored, in whatever key space the map declares.',
  completeness_unknown:
    '`n_sites_scored` is required whenever `aggregate` is non-null, since it is the denominator the mean is over.',
  count_key_space_mismatch:
    '`n_datasets_scored` is present when and only when `per_site_basis` is `dataset`.',
  below_scoring_floor:
    'The service withholds the aggregate when fewer sites scored than the campaign\'s own floor.',
  floor_unstated:
    'A campaign publishing aggregates states its floor, or the floor cannot be shown to have been met.',
  gate_metric_as_witness:
    'A metric in a plotted slot declares `role: witness`. A score contributions were selected on is not one, and a series of it rises by construction.',
  holdout_scope_with_per_site_map:
    'A metric measured on a campaign-owned holdout has no per-participant map, so a record declaring `campaign_holdout` and publishing one has contradicted itself about where the number came from.',
};

/**
 * Why each panel limit is NOT a broken obligation.
 *
 * The other half of the same test. A member here has to be defensible as a
 * record that conformed, so the entry says what permits it. If no such sentence
 * can be written, the cause belongs in `PageRefusal` instead.
 */
export const PANEL_LIMIT_PERMISSION: Record<PanelLimit, string> = {
  per_site_not_site_keyed:
    '`per_site_basis: dataset` is a conforming declaration, and before 0.7.0 the schema offered no count to pair it with.',
  per_site_basis_unstated:
    '`per_site_basis: null` is documented as "the producer did not say", an explicitly permitted answer rather than an omission.',
};

export type AggregateDisposition =
  | { plot: true; value: number }
  | { plot: false; by: 'service'; cause: AggregateWithholdCause }
  | { plot: false; by: 'page'; cause: PageRefusal }
  | { plot: false; by: 'unrenderable'; cause: PanelLimit }
  | { plot: false; by: 'absent' };

/**
 * Decides one scored event's aggregate.
 *
 * `minScoringSites` comes from `policy.aggregate_min_scoring_sites` and is never
 * defaulted. Supplying a value here would present one campaign's disclosure
 * threshold as a property of the platform, which is a worse error than a wrong
 * default: it misattributes whose judgement it is.
 *
 * It is checked against `n_sites_scored`. That was the whole of the 0.6.0
 * change and it is not a nuance: the value this function returns is a mean over
 * the participants that scored, so a floor read from the participants that were
 * ASKED is a rule about a different number than the one that gets published.
 *
 * THERE IS NO LONGER A SET THAT WERE ASKED. Through 0.13.0-draft this interface
 * carried a second field, `eval_on`, read in exactly one place: a contradiction
 * check that refused an aggregate when more participants were recorded as
 * scoring than the campaign had asked to evaluate. Only the synchronous arm
 * ever populated it, every other caller passed null, and with that arm gone at
 * 0.14.0-draft the field had no producer at all. It was removed rather than
 * left as a permanently-null parameter, because a gate that cannot fire reads
 * like a gate that never fires.
 *
 * `scoring_exceeds_eval_set` went with it. That is a narrowing of what this
 * function checks and it is recorded rather than glossed: an inconsistency
 * between the evaluating set and the scoring count is no longer detectable
 * here, because the record no longer states the evaluating set.
 *
 * When several refusals apply, the first in source order is reported and the
 * rest are not enumerated. One event produces one reason, because the note
 * under the chart counts events and one counted twice overstates how much is
 * missing.
 *
 * The parameter is STRUCTURAL rather than `SoupRecord`, because more than one
 * kind of record publishes a pooled figure under exactly these rules. One field
 * is read, and taking it alone states that: everything here is a property of
 * the metric.
 */
export interface ScoredEvent {
  /**
   * Declared as a witness, which is the first of the two guards against a
   * circular improvement curve. A `SelectionMetric` is not assignable here, so
   * `soup.selection_metric` cannot reach this function by accident. The second
   * guard is the role check in the body, which covers the wire.
   */
  metric: WitnessMetric | null;
}

export function aggregateDisposition(
  event: ScoredEvent,
  minScoringSites: number | null
): AggregateDisposition {
  const metric = event.metric;
  if (!metric) return { plot: false, by: 'absent' };

  if (metric.aggregate === null) {
    // A stated cause is a withhold. A null one is an absence, and absences
    // carry no argument: saying "held back" here would report a decision
    // nobody made, which is the mirror of the bug this function exists to fix.
    if (metric.aggregate_withheld !== null) {
      return { plot: false, by: 'service', cause: metric.aggregate_withheld };
    }
    return { plot: false, by: 'absent' };
  }

  if (metric.aggregate_withheld !== null) {
    return { plot: false, by: 'page', cause: 'contradictory_withhold' };
  }

  // Before every completeness and floor check below, and after the two absence
  // arms above. Both halves of that placement are deliberate.
  //
  // Before, because those checks ask whether the number is well supported and
  // none of them is meaningful for a number that must not be on this axis at all
  // however well supported it is. A campaign can gate its scores and still
  // publish a complete per-site map, a stated basis and a healthy denominator,
  // so running this last would let a perfectly well-formed circular curve
  // through on every record that happens to be tidy.
  //
  // After, because a refusal is reported to the reader as a figure the campaign
  // published that this page declined to draw, and with no aggregate present
  // there is no such figure. Firing here on an absence would put a sentence
  // under the chart describing a value that was never in the record.
  //
  // The cast is what makes the check possible: this arm exists precisely for
  // values the type says cannot occur. TypeScript has narrowed `role` to the
  // literal 'witness' and it is right about every call site in this repository.
  // It is not right about the wire, which is JSON off an RPC boundary, and this
  // function is where the wire is first trusted.
  //
  // THE LIMIT OF WHAT THIS GUARD CAN DO, which is unchanged by the backend
  // work below and is the thing most likely to be misread as fixed.
  //
  // The check is one-directional. It catches a producer that labels its gate
  // score honestly and puts it in the wrong slot, which is the careless
  // mistake. It cannot catch a producer that emits the GATE METRIC UNDER
  // `role: 'witness'`, because at that point the only evidence the page has
  // that a score gates nothing is the score's own claim that it gates nothing.
  // The guard trusts exactly the label that would be wrong.
  //
  // That failure is worse than the one above, not milder. The page renders a
  // curve, the curve rises, and it rises because rising is the admission
  // criterion. Nothing about it looks wrong, and the reader it misleads is the
  // one the whole page was built for.
  //
  // The fix was never on this side, and as of 12 Sep 2026 it has landed on the
  // other one. `role` is pinned end to end by two things that had to arrive
  // together:
  //   1. a single shared fixture corpus, carrying DISTINCT known witness and
  //      gate values so a swap is detectable from either side by NUMBER and not
  //      only by tag. The backend cross-checks against this repository's
  //      corpus, so the two sides are pinned to one artifact rather than to two
  //      readings of one agreement.
  //   2. a backend contract test that FAILS if the aggregation or publish path
  //      emits the gate metric under `role: 'witness'`. It compares the emitted
  //      curve against split B rather than inspecting the tag, so a value
  //      fabricated from split A is caught even though its label is correct.
  // That retires the PENDING-TEST status this comment used to carry, when the
  // definition rested on an agreement in writing rather than on a code path
  // that cannot violate it.
  //
  // What it does NOT retire is the paragraph above, and the distinction is
  // worth holding onto. The defence now exists at the PRODUCER. This function
  // still trusts the label, because at render time the label is still the only
  // evidence it has. A gate score reaching this page under `role: 'witness'`
  // would still be drawn. The difference is that it is now hard to emit, not
  // that it became detectable here. Reading (2) as "the page validates role"
  // is the overclaim to avoid: a test on the other side of an RPC boundary is
  // not a check on this side of it.
  //
  // The definition, which is fixed: witness is split B, gates nothing, and is
  // the only thing plotted or reported. Selection is split A, the greedy gate,
  // internal, nameable, never drawn.
  //
  // One rule that is NOT this function's to enforce and belongs with it
  // anyway. A per-member gate score must not reach the wire at all, which is
  // stronger than "must not be plotted": the no-leaderboard rule is about
  // publication, not display. `SoupRecord.assessed` is a list of ids and
  // carries no score field, so the shape forbids it, and a payload that
  // carried one would be a contract violation to report rather than a
  // rendering decision to make.
  if ((metric.role as string) !== 'witness') {
    return { plot: false, by: 'page', cause: 'gate_metric_as_witness' };
  }

  // The scope gate, and it sits here for a reason: after the role check, which
  // is about whether this number may be plotted AT ALL, and before every
  // completeness and floor check, which are about a denominator a central
  // holdout does not have.
  //
  // Normalised to the STRICT branch on null. That is the opposite of the usual
  // rule in this file, where an unstated property withholds. Here an unstated
  // scope keeps checking, because the permissive branch is the one that turns
  // the floor off, and a check that can be disabled by omitting a field is not
  // a check. See `AggregateScope`.
  const scope = metric.aggregate_scope ?? 'participant_pool';
  if (scope === 'campaign_holdout') {
    // The one shape where the declaration is not credible. A central
    // measurement has no per-participant map, so a record carrying both has
    // contradicted itself about where its number came from, and this is the
    // branch that skips the floor, so it must not be reachable by accident.
    if (metric.per_site !== null) {
      return { plot: false, by: 'page', cause: 'holdout_scope_with_per_site_map' };
    }
    // No participant-held quantity in the number, so `n_sites_scored` has
    // nothing to count and the floor has nothing to protect. INAPPLICABLE, not
    // satisfied: the page is not deciding the record passed a weaker check, it
    // is recognising that the check was about a different kind of figure.
    return { plot: true, value: metric.aggregate };
  }

  // Normalised, and this is load-bearing rather than defensive tidiness. Every
  // record written before 0.7.0 arrives over HTTP with no such key, so the
  // field reads `undefined` and not `null`, and a strict `!== null` below would
  // have read "absent" as "present" and accused the entire completed
  // consortium run of a key-space contradiction. The type says `number | null`,
  // the wire says the key may not be there, and the gate has to agree with the
  // wire. Missing and null mean the same thing here: no count was given.
  const nDatasets = metric.n_datasets_scored ?? null;

  // Outside the `per_site` block on purpose. This is a property of the record,
  // not of the map: a count in a key space the record does not claim is wrong
  // whether or not a map arrived to be counted. Nesting it would repeat the
  // 0.6.0 mistake of guarding a record-level check on the presence of a map.
  if (nDatasets !== null && metric.per_site_basis !== 'dataset') {
    return { plot: false, by: 'page', cause: 'count_key_space_mismatch' };
  }

  if (metric.per_site !== null) {
    // The key space first, because every check below it is a comparison against
    // `n_sites_scored`, which counts SITES. Comparing the length of a map to a
    // count of sites means nothing unless the map is site-keyed, and this
    // module used to assume it was on the strength of a doc comment.
    //
    // That made the previous fix wrong in an instructive way. The gate tested
    // `length < n_sites_scored` and I extended it to catch `>` as well, on the
    // grounds that a gate testing one direction passes the other in silence.
    // The general point holds. It did not apply here: the comparison had no
    // meaning in either direction, so completing it made a wrong-space check
    // symmetric rather than making it right, and the new arm rejected the
    // pooled arm of the current federated layout, which is a correct record.
    //
    // Symmetry is not soundness. A check can be wrong in a way that testing its
    // mirror image will never surface, because both arms inherit the same bad
    // premise.
    if (metric.per_site_basis === null) {
      return { plot: false, by: 'unrenderable', cause: 'per_site_basis_unstated' };
    }
    if (metric.per_site_basis !== 'site' && nDatasets === null) {
      // A dataset-keyed map is well-formed and, with no count in its own key
      // space, this page still cannot check it: completeness is not assertable,
      // and an aggregate published beside an unverifiable map is exactly the
      // reconstruction hazard the site-keyed case withholds for.
      //
      // `unrenderable`, not `page`. Same withhold, different actor at fault, and
      // nobody is at fault here: the basis field exists so this value can be
      // declared, so declaring it cannot be a violation. Grouping it with the
      // format breaches put a correct record under a heading that calls it
      // broken, permanently, for every pooled arm ever run.
      //
      // The `n_datasets_scored === null` arm is what makes this narrow rather
      // than permanent. With the count present the map is checkable and falls
      // through to the cardinality gate below, in its own key space.
      return { plot: false, by: 'unrenderable', cause: 'per_site_not_site_keyed' };
    }
  }

  // Unconditional, and it used to sit inside the block above where it guarded
  // only a cardinality comparison. `n_sites_scored` is the denominator of
  // `aggregate` and therefore the operand of the floor, so a record without it
  // has no floor to check even when it publishes no per-site map at all. That
  // path was the wider half of the leak: with `per_site` null the whole block
  // was skipped, this field was never read, and the floor passed on the
  // then-present `eval_on` count instead.
  if (metric.n_sites_scored === null) {
    return { plot: false, by: 'page', cause: 'completeness_unknown' };
  }

  if (metric.per_site !== null) {
    // Both sides are in the same space by now, so both directions are
    // meaningful. A map really cannot have more entries than units recorded as
    // having scored. Split from the basis checks above rather than merged back
    // with them, because the two ask different questions: the basis is a
    // property of the map, the count is a property of the record, and only
    // their join is a cardinality claim.
    //
    // The denominator is chosen by the map's declared key space, which is the
    // whole reason 0.7.0 exists. Reading `n_sites_scored` here for a
    // dataset-keyed map would be the original wrong-space comparison restored,
    // just further down the function: six datasets against one site is not a
    // partial map, it is two different questions being subtracted.
    const mapped = Object.keys(metric.per_site).length;
    const scored =
      metric.per_site_basis === 'dataset' ? (nDatasets as number) : metric.n_sites_scored;
    if (mapped < scored) {
      return { plot: false, by: 'page', cause: 'partial_map' };
    }
    if (mapped > scored) {
      return { plot: false, by: 'page', cause: 'map_exceeds_count' };
    }
  }

  // The floor is checked even though the service is supposed to have checked
  // it, for the same reason the completeness gate is: the service refusing at
  // its boundary is its guarantee, not a mechanism on this side. A single
  // scoring site makes the pooled figure that site's own value under a pooled
  // label, and every leave-one-site-out fold has a singleton eval set.
  if (minScoringSites === null) {
    return { plot: false, by: 'page', cause: 'floor_unstated' };
  }
  if (metric.n_sites_scored < minScoringSites) {
    return { plot: false, by: 'page', cause: 'below_scoring_floor' };
  }

  return { plot: true, value: metric.aggregate };
}

export interface DispositionTally {
  plotted: number;
  service: Record<AggregateWithholdCause, number>;
  page: Record<PageRefusal, number>;
  unrenderable: Record<PanelLimit, number>;
  absent: number;
}

export function emptyTally(): DispositionTally {
  return {
    plotted: 0,
    service: {
      partial_map: 0,
      completeness_unknown: 0,
      below_scoring_floor: 0,
      floor_unknown: 0,
    },
    page: {
      contradictory_withhold: 0,
      partial_map: 0,
      map_exceeds_count: 0,
      completeness_unknown: 0,
      count_key_space_mismatch: 0,
      below_scoring_floor: 0,
      floor_unstated: 0,
      gate_metric_as_witness: 0,
      holdout_scope_with_per_site_map: 0,
    },
    unrenderable: {
      per_site_not_site_keyed: 0,
      per_site_basis_unstated: 0,
    },
    absent: 0,
  };
}

export function tally(tallied: DispositionTally, d: AggregateDisposition): void {
  if (d.plot) {
    tallied.plotted += 1;
    return;
  }
  if (d.by === 'service') tallied.service[d.cause] += 1;
  else if (d.by === 'page') tallied.page[d.cause] += 1;
  else if (d.by === 'unrenderable') tallied.unrenderable[d.cause] += 1;
  else tallied.absent += 1;
}
