import { RoundRecord } from '../../types/campaign';

/**
 * The transport multiplier, per round.
 *
 * One payload crosses the network per transfer, and a round's transfers are:
 *
 *     2 * |participants|                    push and pull, per training site
 *   + 1                                     the aggregate write
 *   + |participants union eval_on|          the store read, per site that pulls
 *
 * The last term is a union rather than either set alone because a site that
 * only evaluates still reads the aggregate, and a site that only trains still
 * reads it back. A leave-one-site-out fold at six sites trains five and
 * evaluates six: 2*5 + 1 + 6 = 17.
 *
 * This is 3N+1 only when eval_on is a subset of participants and both have size
 * N, which is full participation. 3N+1 is a value the expression takes, not the
 * expression. Applying it flat across an uneven schedule overstates transport
 * for exactly the rounds that had fewer sites.
 *
 * There is no correction factor that recovers the right answer from a
 * campaign-level N, which is why every function here takes round records and
 * none of them takes a site count.
 */

/**
 * Why a round's multiplier could not be computed.
 *
 * Two reasons, not one, because they send a reader to different places. An
 * empty participant list is a round that reported its shape and had nobody in
 * it. A null `eval_on` is a round that did not report its shape at all, which
 * is currently every round, since the field is proposed and not yet served.
 */
export type MultiplierGap = 'no_participants' | 'eval_set_unreported';

export type RoundMultiplier =
  | { known: true; value: number; nTraining: number; nReading: number }
  | { known: false; gap: MultiplierGap };

/**
 * Computes one round's multiplier, or says why it cannot.
 *
 * Never falls back to `|participants|` for the union term. That fallback is
 * available, looks reasonable, and is wrong in the one direction that matters:
 * it silently assumes nobody evaluated who did not also train, which understates
 * the multiplier and so puts the crossover later, making the campaign look more
 * frugal than it was. An unreported eval set is not evidence that it equalled
 * the participant set.
 */
export function roundMultiplier(round: RoundRecord): RoundMultiplier {
  const participants = round.participants ?? [];
  if (participants.length === 0) return { known: false, gap: 'no_participants' };
  if (!round.eval_on) return { known: false, gap: 'eval_set_unreported' };

  const readers = new Set<string>([...participants, ...round.eval_on]);
  return {
    known: true,
    value: 2 * participants.length + 1 + readers.size,
    nTraining: participants.length,
    nReading: readers.size,
  };
}

export interface CumulativePoint {
  round: number;
  /** Bytes crossing the network from round zero through this round inclusive. */
  bytesMoved: number;
  multiplier: number;
}

/**
 * Why a round is not on the curve.
 *
 * A superset of MultiplierGap, because a round can have a perfectly computable
 * multiplier and still contribute no byte figure when the campaign never
 * reported a payload size. Kept distinct rather than folded into one
 * "unavailable" count: the multiplier gaps are answered by the campaign service
 * reporting round shape, and this one is answered by it reporting a payload
 * size. Different actors, so a reader must not be sent to the wrong one.
 */
export type CurveGap = MultiplierGap | 'payload_size_unreported';

export interface CumulativeTransport {
  points: CumulativePoint[];
  /**
   * Rounds that could not be included, by reason. A round missing from the
   * curve is not a round with nothing to say.
   */
  gaps: Record<CurveGap, number>;
  /**
   * The first round at which cumulative bytes moved exceed the corpus, or null
   * if the series does not reach it. Null also when `corpusBytes` is null,
   * because a crossing needs something to cross.
   */
  crossoverRound: number | null;
  /**
   * True when at least one round was dropped BEFORE the last included point, so
   * the running total is short by an unknown amount and every later point
   * understates. The curve is not publishable in that state: a cumulative total
   * with a hole in it is not a smaller total, it is a wrong one.
   */
  holed: boolean;
}

/**
 * The cumulative-to-date transport curve.
 *
 * Accumulates in reported round order and refuses to interpolate. A round whose
 * multiplier is unknown contributes nothing and is counted in `gaps`, and if
 * such a round falls before a point that IS plotted, `holed` is set, because
 * from that round on the running total is missing an unknown quantity while
 * still looking like a total.
 *
 * That distinction is the whole reason this returns a struct rather than an
 * array. Dropping rounds off the END of a series shortens it, which is visible.
 * Dropping one from the MIDDLE understates every point after it, which is not.
 */
export function cumulativeTransport(
  rounds: RoundRecord[],
  payloadBytes: number | null,
  corpusBytes: number | null
): CumulativeTransport {
  const gaps: Record<CurveGap, number> = {
    no_participants: 0,
    eval_set_unreported: 0,
    payload_size_unreported: 0,
  };
  const points: CumulativePoint[] = [];
  let running = 0;
  let crossoverRound: number | null = null;
  let holed = false;
  let droppedSinceLastPoint = false;

  if (payloadBytes === null) {
    // Without a measured payload size there is no byte figure for any round, so
    // every round is accounted for under that reason. Returning bare empty
    // arrays would leave the caller unable to tell "no rounds" from "no payload
    // size", and an empty curve reads as "nothing was transferred".
    //
    // The multiplier is still evaluated, so a round that ALSO cannot report its
    // shape is counted under that gap instead. Reporting a payload size would
    // not put such a round on the curve, and saying it would sends a reader to
    // fix the wrong thing.
    rounds.forEach((round) => {
      const m = roundMultiplier(round);
      gaps[m.known ? 'payload_size_unreported' : m.gap] += 1;
    });
    return { points: [], gaps, crossoverRound: null, holed: false };
  }

  const ordered = [...rounds].sort((a, b) => a.round - b.round);
  ordered.forEach((round) => {
    const m = roundMultiplier(round);
    if (!m.known) {
      gaps[m.gap] += 1;
      droppedSinceLastPoint = true;
      return;
    }
    if (droppedSinceLastPoint && points.length > 0) holed = true;
    droppedSinceLastPoint = false;
    running += payloadBytes * m.value;
    points.push({ round: round.round, bytesMoved: running, multiplier: m.value });
    if (crossoverRound === null && corpusBytes !== null && running > corpusBytes) {
      crossoverRound = round.round;
    }
  });

  return { points, gaps, crossoverRound, holed };
}
