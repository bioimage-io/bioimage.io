import { AggregateWithholdCause, RoundRecord } from '../../types/campaign';

/**
 * Whether a round's pooled score may be plotted, and if not, who decided so.
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
 */
export type PageRefusal =
  /** An aggregate arrived alongside a stated reason for there being none. */
  | 'contradictory_withhold'
  /** Some per-site values published; the aggregate reconstructs the rest. */
  | 'partial_map'
  /** A site-keyed map with more entries than sites recorded as having scored. */
  | 'map_exceeds_count'
  /** A per-unit map arrived without saying what it is keyed by. */
  | 'per_site_basis_unstated'
  /** The map is keyed by something the record carries no denominator for. */
  | 'per_site_not_site_keyed'
  /** No `n_sites_scored`, so neither completeness nor the floor can be checked. */
  | 'completeness_unknown'
  /** More sites recorded as scoring than were asked to evaluate. */
  | 'scoring_exceeds_eval_set'
  /** Fewer SCORING sites than the campaign's own floor. */
  | 'below_scoring_floor'
  /** No floor stated, so it cannot be shown to have been met. */
  | 'floor_unstated';

export type AggregateDisposition =
  | { plot: true; value: number }
  | { plot: false; by: 'service'; cause: AggregateWithholdCause }
  | { plot: false; by: 'page'; cause: PageRefusal }
  | { plot: false; by: 'absent' };

/**
 * Decides one round's aggregate.
 *
 * `minScoringSites` comes from `policy.aggregate_min_scoring_sites` and is never
 * defaulted. Supplying a value here would present one consortium's disclosure
 * threshold as a property of the platform, which is a worse error than a wrong
 * default: it misattributes whose judgement it is.
 *
 * It is checked against `n_sites_scored` and not against `eval_on.length`. The
 * distinction is the whole of the 0.6.0 change and it is not a nuance: the
 * value this function returns is a mean over the sites that scored, so a floor
 * read from the sites that were ASKED is a rule about a different number than
 * the one that gets published. `eval_on` appears below exactly once, in a
 * contradiction check, and restoring it to the floor would reopen the leak.
 *
 * When several refusals apply, the first in source order is reported and the
 * rest are not enumerated. One round produces one reason, because the note
 * under the chart counts rounds and a round counted twice overstates how much
 * is missing.
 */
export function aggregateDisposition(
  round: RoundRecord,
  minScoringSites: number | null
): AggregateDisposition {
  const metric = round.metric;
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
      return { plot: false, by: 'page', cause: 'per_site_basis_unstated' };
    }
    if (metric.per_site_basis !== 'site') {
      // A dataset-keyed map is well-formed and this page still cannot check it:
      // the record carries no count of datasets scored, so completeness is not
      // assertable, and an aggregate published beside an unverifiable map is
      // exactly the reconstruction hazard the site-keyed case withholds for.
      return { plot: false, by: 'page', cause: 'per_site_not_site_keyed' };
    }
  }

  // Unconditional, and it used to sit inside the block above where it guarded
  // only a cardinality comparison. `n_sites_scored` is the denominator of
  // `aggregate` and therefore the operand of the floor, so a record without it
  // has no floor to check even when it publishes no per-site map at all. That
  // path was the wider half of the leak: with `per_site` null the whole block
  // was skipped, this field was never read, and the floor passed on `eval_on`.
  if (metric.n_sites_scored === null) {
    return { plot: false, by: 'page', cause: 'completeness_unknown' };
  }

  if (metric.per_site !== null) {
    // Both sides are in the same space by now, so both directions are
    // meaningful. A site-keyed map really cannot have more entries than sites
    // scored. Split from the basis checks above rather than merged back with
    // them, because the two ask different questions: the basis is a property of
    // the map, the count is a property of the record, and only their join is a
    // cardinality claim.
    const mapped = Object.keys(metric.per_site).length;
    if (mapped < metric.n_sites_scored) {
      return { plot: false, by: 'page', cause: 'partial_map' };
    }
    if (mapped > metric.n_sites_scored) {
      return { plot: false, by: 'page', cause: 'map_exceeds_count' };
    }
  }

  // The only place `eval_on` is read, and it is a contradiction check rather
  // than a coverage one. A site cannot return a score it was not asked for, so
  // scoring more sites than were evaluated cannot come from the driver: it says
  // the record was assembled wrong, and an aggregate from a record that
  // contradicts itself about its own denominator is not publishable whatever
  // the floor says.
  //
  // Scoring FEWER than were asked is not checked here and must not be. That is
  // an ordinary partial round, and the floor below is the rule that decides
  // whether it stands.
  if (round.eval_on !== null && metric.n_sites_scored > round.eval_on.length) {
    return { plot: false, by: 'page', cause: 'scoring_exceeds_eval_set' };
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
      per_site_basis_unstated: 0,
      per_site_not_site_keyed: 0,
      completeness_unknown: 0,
      scoring_exceeds_eval_set: 0,
      below_scoring_floor: 0,
      floor_unstated: 0,
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
  else tallied.absent += 1;
}
