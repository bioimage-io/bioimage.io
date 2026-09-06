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
 * That matters because the two halves of this ratio fail differently and only
 * one of them can improve. The numerator is the observed outbound total, which
 * is unusable today only because the per-source transport windows disagree: a
 * defect, and one that a fix will clear. The denominator is declared and stays
 * declared. Repairing the log must not quietly promote a measured-over-declared
 * quotient into something that reads as fully audited, so every caller renders
 * the declared half unconditionally alongside the number.
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

/** Date only, in a form that reads the same in every locale. */
export function formatDate(iso: string | null | undefined): string | null {
  if (!iso) return null;
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return null;
  return date.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
}
