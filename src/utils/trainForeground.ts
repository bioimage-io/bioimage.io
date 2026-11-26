/**
 * Whether a split's training annotations mark any foreground at all.
 *
 * A split can exist, be named correctly, and hold annotation files that are
 * every one of them empty: the annotator saves a GeoJSON FeatureCollection
 * even when the user drew nothing. Such a run is accepted, the images are
 * ingested, and it fails minutes later with "No training pairs with foreground
 * labels after ingestion". That late failure is the single largest cause of
 * wasted runs, and the only place it can be prevented cheaply is before the
 * run is armed.
 *
 * The service that lists training inputs reports presigned URLs and nothing
 * about their contents, so emptiness cannot be established without reading
 * them. It is read here rather than server-side because the URLs are already
 * minted by the time the page decides whether to arm the button.
 *
 * The network part is injected, so every decision in this module is testable
 * without a server.
 */

/** Result of probing the train annotations. */
export interface ForegroundProbe {
  /**
   * Whether the answer is known at all. False when nothing could be read, in
   * which case the caller must NOT refuse on foreground grounds: an unreadable
   * annotation is not evidence that it is empty.
   */
  determined: boolean;
  /** True when at least one train annotation marks at least one object. */
  anyForeground: boolean;
  /** How many annotations were read successfully. */
  checked: number;
  /** How many could not be read or parsed. */
  failed: number;
}

/**
 * Does one parsed annotation mark any foreground?
 *
 * Anything that is not a FeatureCollection with a non-empty `features` array
 * counts as no foreground, which is deliberate: the annotator only ever writes
 * that shape, so a different shape is not an annotation this pipeline can
 * train on either way.
 */
export function hasForegroundFeatures(parsed: unknown): boolean {
  if (!parsed || typeof parsed !== 'object') return false;
  const fc = parsed as { type?: unknown; features?: unknown };
  if (fc.type !== 'FeatureCollection') return false;
  return Array.isArray(fc.features) && fc.features.length > 0;
}

/**
 * Read train annotations until one of them marks foreground.
 *
 * Stops at the first non-empty annotation, so the common case (a split that is
 * fine) costs one request rather than one per image. Requests go out in
 * batches of *concurrency* so a large split does not open hundreds at once.
 *
 * A single unreadable annotation is counted and skipped. Only if NOTHING could
 * be read is the result undetermined, because refusing a run because one
 * presigned URL hiccuped would be worse than the late failure this prevents.
 */
export async function probeTrainForeground(
  geojsonUrls: string[],
  fetchJson: (url: string) => Promise<unknown>,
  opts: { concurrency?: number } = {},
): Promise<ForegroundProbe> {
  const concurrency = Math.max(1, opts.concurrency ?? 6);
  let checked = 0;
  let failed = 0;

  if (geojsonUrls.length === 0) {
    // No annotations at all is a different refusal, decided by the caller from
    // the train list itself. Saying "undetermined" here keeps the two reasons
    // from being conflated in one sentence.
    return { determined: false, anyForeground: false, checked: 0, failed: 0 };
  }

  for (let i = 0; i < geojsonUrls.length; i += concurrency) {
    const batch = geojsonUrls.slice(i, i + concurrency);
    const results = await Promise.all(
      batch.map((url) =>
        fetchJson(url).then(
          (parsed) => ({ ok: true as const, parsed }),
          () => ({ ok: false as const, parsed: undefined }),
        ),
      ),
    );
    for (const r of results) {
      if (!r.ok) {
        failed += 1;
        continue;
      }
      checked += 1;
      if (hasForegroundFeatures(r.parsed)) {
        return { determined: true, anyForeground: true, checked, failed };
      }
    }
  }

  // "No foreground" is claimed only when EVERY annotation was read and none of
  // them marked any.
  //
  // `checked > 0` was the wrong test, and the way it was wrong is the failure
  // this probe exists to prevent. One annotation that reads empty, plus any
  // number that could not be read at all, counted as a determined "no
  // foreground": the run was refused and the banner told the user that none of
  // their annotations mark any foreground. Measured in a browser on a split
  // whose two annotations hold 53 and 65 features, with the first request
  // failing and the second returning an empty collection: Start was disabled
  // and the page asserted emptiness about an annotation it had never read.
  //
  // A failed read is not evidence of emptiness, so any failure leaves the
  // answer undetermined and the caller arms the run. The cost of that
  // direction is a run that starts and then fails in the trainer, which is
  // visible and recoverable. The cost of the other direction is a user told
  // their work is empty when it is not.
  return { determined: checked > 0 && failed === 0, anyForeground: false, checked, failed };
}
