/**
 * Formatting helpers for campaign records.
 *
 * Every one of these returns `null` for a `null` input rather than a dash, a
 * zero or an empty string. Callers then render <MissingValue /> explicitly, so
 * "not reported" is always a deliberate decision at the call site and never a
 * side effect of a formatter picking a fallback.
 */

const BYTE_UNITS = ['bytes', 'KB', 'MB', 'GB', 'TB', 'PB'];

/** Human byte size, base 1000 to match how storage and transfer are quoted. */
export function formatBytes(bytes: number | null | undefined): string | null {
  if (bytes === null || bytes === undefined || !Number.isFinite(bytes)) return null;
  if (bytes === 0) return '0 bytes';
  const exponent = Math.min(
    BYTE_UNITS.length - 1,
    Math.floor(Math.log(Math.abs(bytes)) / Math.log(1000))
  );
  const value = bytes / 1000 ** exponent;
  const digits = exponent === 0 ? 0 : value < 10 ? 2 : value < 100 ? 1 : 0;
  return `${value.toFixed(digits)} ${BYTE_UNITS[exponent]}`;
}

/** Thousands-separated integer. */
export function formatCount(value: number | null | undefined): string | null {
  if (value === null || value === undefined || !Number.isFinite(value)) return null;
  return value.toLocaleString('en-US');
}

/** Metric value at a fixed precision, so a column of them lines up. */
export function formatMetric(value: number | null | undefined): string | null {
  if (value === null || value === undefined || !Number.isFinite(value)) return null;
  return value.toFixed(3);
}

/*
 * THERE IS NO RATIO FORMATTER HERE, AND THERE SHOULD NOT BE ONE.
 *
 * This file held a `formatRatio(declaredBytes, moved)` that rendered "about N
 * to 1". It is gone, and the note is longer than the function because the
 * function looked correct and was not.
 *
 * Two failures, and only the first is about federated learning:
 *
 *  1. The quotient has no fixed sign. Bytes moved accumulates with rounds,
 *     data held does not, so the answer depends on the window it is taken
 *     over, and far enough out every campaign crosses from a saving into a
 *     cost. A formatter takes two scalars and cannot carry a window, so any
 *     caller could obtain the flattering direction by accident.
 *
 *  2. It was one-directional by construction, which was worse. The guard
 *     `if (ratio < 1) return null` was written to reject nonsense, and what it
 *     actually did was suppress every answer unfavourable to federation while
 *     passing every favourable one. A campaign that moved more than it held
 *     would have rendered "Not computable from what was measured" on a page
 *     whose whole premise is that it does not hide figures. It was computable.
 *     The answer was just unflattering.
 *
 * The second one is the general lesson and it is not specific to ratios: a
 * plausibility guard on a derived number is a place where a bias can hide with
 * a good excuse. If a guard rejects some results, check whether the rejected
 * set is the set you would have wanted to reject, or the set you would have
 * wanted not to publish.
 *
 * A corollary, and the reason the rule above is stated without reference to
 * which way any particular campaign comes out: the campaigns on this platform
 * today have comfortably favourable quotients. That is exactly why the defect
 * would have shipped. The guard would have passed the number, a reviewer would
 * have read it and nodded, and an unwindowed scalar that cannot tell anyone a
 * crossing exists would have gone out unexamined, because nothing about a
 * flattering figure invites a check. A scalar that happens to come out
 * favourable is not a safer scalar. It is the same broken number with a luckier
 * campaign behind it.
 *
 * When a campaign can supply per-round coverage from round zero, the correct
 * rendering is a cumulative curve with the crossover round marked, not a
 * scalar. See the note at the top of TransportAudit.tsx.
 */

/** Date only, in a form that reads the same in every locale. */
export function formatDate(iso: string | null | undefined): string | null {
  if (!iso) return null;
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return null;
  return date.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
}
