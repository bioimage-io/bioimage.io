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

/**
 * The transport asymmetry, as "about N to 1".
 *
 * The parameter is named `declaredBytes` and not `heldBytes` because the
 * denominator has exactly one possible standing. Nothing in the driver measures
 * dataset sizes on disk, so the amount of data held is always a figure the
 * sites declared, and the schema offers no field that could hold a measured
 * version of it. Naming the basis in the signature means a caller cannot obtain
 * this string while believing both halves were measured.
 *
 * The numerator is a SINGLE ROUND's outbound bytes. See `latestWholeRound` for
 * why it is not a campaign total, and for the two ways of manufacturing one
 * that this page does not use.
 *
 * Returns null when either half is missing.
 */
export function formatRatio(
  declaredBytes: number | null | undefined,
  moved: number | null | undefined
): string | null {
  if (!declaredBytes || !moved || declaredBytes <= 0 || moved <= 0) return null;
  const ratio = declaredBytes / moved;
  if (!Number.isFinite(ratio) || ratio < 1) return null;
  const rounded =
    ratio >= 1000
      ? Math.round(ratio / 100) * 100
      : ratio >= 100
        ? Math.round(ratio / 10) * 10
        : Math.round(ratio);
  return `about ${rounded.toLocaleString('en-US')} to 1`;
}

/**
 * The most recent round whose transport every source logged, or null.
 *
 * This exists because the page's asymmetry claim is per-round rather than
 * per-campaign, and that is a deliberate narrowing, not a fallback.
 *
 * The campaign-wide observed total needs the per-source log windows to agree.
 * They do not, the reconciliation work is not scheduled, and the driver is
 * frozen, so "wait for the total" and "show nothing, ever" are the same
 * position. A single round needs only that every source covered that one round,
 * which recent rounds do. So a per-round ratio is observed over declared: one
 * soft half instead of two, available now instead of indefinitely.
 *
 * It is also the better claim. Per-round is what federated learning actually
 * asserts, and unlike a total it does not vary with how many rounds a campaign
 * happened to run, so two campaigns can be compared.
 *
 * There are two ways to manufacture a campaign total from this and the page
 * uses neither:
 *
 *  - Summing the rounds the log happens to cover gives a subset numerator. Put
 *    over the whole data held, that is not a ratio between comparable things.
 *    It is a different quantity wearing the total's clothes, and no caveat
 *    rescues it.
 *  - Multiplying one round by the round count is the computed figure again by
 *    another route, laundered through an observed-looking number.
 *
 * Which is why callers must render the round number in the same element as the
 * ratio. A reader who cannot see which round it is cannot tell the two apart.
 *
 * Gating on `sources_complete` and not on `bytes_out` being non-null is the
 * same rule as everywhere else here: a populated value cannot say whether it is
 * whole, so the flag is asked instead. Null fails closed.
 */
export function latestWholeRound<
  T extends { round: number; transport?: { bytes_out: number | null; sources_complete: boolean | null } | null },
>(rounds: T[] | null | undefined): T | null {
  if (!rounds || rounds.length === 0) return null;
  const whole = rounds.filter(
    (r) => r.transport?.sources_complete === true && (r.transport?.bytes_out ?? 0) > 0
  );
  if (whole.length === 0) return null;
  return whole.reduce((latest, r) => (r.round > latest.round ? r : latest));
}

/** Date only, in a form that reads the same in every locale. */
export function formatDate(iso: string | null | undefined): string | null {
  if (!iso) return null;
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return null;
  return date.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
}
