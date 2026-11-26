/**
 * Whether a pending fine-tuning run can actually start, decided as a pure
 * function of what the broker answered.
 *
 * Extracted from the effect in Finetune.tsx because one of its branches had
 * never executed. Three reviews in a row reported that clause 3 of its issue,
 * "zero annotations for the chosen label cannot arm a run", was unmeasured: a
 * split that does not EXIST takes the error path, so the empty-train-list
 * branch was unreachable from any test and from any browser session anyone had
 * run. Nothing mounts Finetune.tsx, so the only way to reach that branch in a
 * test was to stop it being inside a component.
 *
 * The three refusals are deliberately different sentences, because they are
 * different things for the user to fix and the page used to conflate two of
 * them.
 */

export type RunReadiness =
  | { state: 'idle' }
  | { state: 'checking' }
  | { state: 'ready'; train: number; test: number }
  | { state: 'unusable'; reason: string };

/** What `get_training_urls` answered: either the urls, or the error it threw. */
export type TrainingUrlsOutcome =
  | { ok: true; urls: { train?: unknown[] | null; test?: unknown[] | null } }
  | { ok: false; err: unknown };

export interface ReadinessInput {
  /** Whether the dataset's index lists the requested label. */
  labelExists: boolean;
  label: string;
  split: string;
  outcome: TrainingUrlsOutcome;
  /** How to render a broker error, injected so this stays free of imports. */
  describeError: (err: unknown) => string;
  /**
   * What reading the train annotations found, or null when they were not read.
   *
   * Typed structurally rather than by importing the prober's type, so the two
   * modules stay independent. `determined: false` and `null` mean the same
   * thing here: say nothing about foreground, because an annotation that could
   * not be read is not evidence that it is empty.
   */
  foreground?: { determined: boolean; anyForeground: boolean } | null;
}

export function readinessFor(input: ReadinessInput): RunReadiness {
  const { labelExists, label, split, outcome, describeError } = input;

  // Checked first, and checked against the index rather than inferred from the
  // error, because the broker answers a missing LABEL with a sentence that
  // names the SPLIT: "No split named '<split>' for label '<label>'". Passing
  // that through told the user to fix a split that was fine.
  if (!labelExists) {
    return {
      state: 'unusable',
      reason:
        `This dataset has no label named "${label}". `
        + 'Pick a label that exists in the finetune view for this dataset, then start the run again.',
    };
  }

  if (!outcome.ok) {
    return {
      state: 'unusable',
      reason:
        `Could not read split "${split}" of label "${label}". `
        + describeError(outcome.err)
        + ' Pick the split again in the finetune view for this dataset.',
    };
  }

  const train = outcome.urls.train ?? [];
  if (train.length === 0) {
    // The branch the reviews kept asking about. A split can exist, be named
    // correctly, and hold nothing annotated: the run would be accepted, the
    // data ingested, and only then fail with "No training pairs with
    // foreground labels after ingestion". The finetune lane measured that as
    // 71 of 115 production failures, and it is preventable only here.
    return {
      state: 'unusable',
      reason:
        `Split "${split}" of label "${label}" has no annotated training images yet. `
        + 'Annotate at least one image and assign it to this split, then start the run from the dataset page again.',
    };
  }

  // The annotations exist but mark nothing. This is the failure that actually
  // bites: the run is accepted, the images are ingested, and it dies minutes
  // later with "No training pairs with foreground labels after ingestion",
  // which was 71 of 115 recorded production failures. The empty-train-list
  // branch above cannot produce it, because a split cannot be created with an
  // empty train list in the first place.
  //
  // Only refused when the answer is DETERMINED. Unreadable annotations leave
  // the run armed rather than blocking it, matching how an unreadable dataset
  // index is handled: absence of evidence is not evidence of absence.
  const foreground = input.foreground;
  if (foreground && foreground.determined && !foreground.anyForeground) {
    return {
      state: 'unusable',
      reason:
        `Split "${split}" of label "${label}" has ${train.length} annotated `
        + `image${train.length === 1 ? '' : 's'}, but none of them mark any foreground. `
        + 'Fine-tuning needs at least one marked object. Open an image in the annotator, '
        + 'mark at least one object, save it, then start the run again.',
    };
  }

  return { state: 'ready', train: train.length, test: (outcome.urls.test ?? []).length };
}
