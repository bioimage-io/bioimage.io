/**
 * How much of a training run has actually happened, and whether the backend's
 * number is the kind you are allowed to show as progress.
 *
 * `get_training_status` (and therefore the polled `list_training_sessions`,
 * which is a loop over the same `get_status`) reports three fields:
 * `n_epochs`, `n_epochs_completed` and `n_epochs_completed_basis`. The trap is
 * that the two backends put different KINDS of number under one name, and the
 * basis is the only thing that says which:
 *
 *  - `measured` (micro-SAM) is a live observation, read from torch_em's
 *    per-epoch `latest.pt`. It advances during the run, and it can sit legitimately
 *    BELOW `n_epochs` when early stopping fires. This is progress and may be shown.
 *  - `floor_if_completed` (Cellpose) is NOT a measurement. `train_seg` has no
 *    per-epoch counter and only checkpoints after the whole loop, so the value
 *    is derived from the run having finished. Rendering a mid-run Cellpose job
 *    as "epoch 7 of 10" would be inventing a number that nothing measured.
 *
 * So this module's job is to refuse as often as it reports. Anything other
 * than `measured` yields `none`, and the card then shows elapsed time only,
 * exactly as it did before.
 *
 * It also has to degrade silently on older workers. A replica before 0.18.0
 * never writes these fields at all, so they arrive absent rather than null,
 * and `none` is the correct answer there too.
 */

export type EpochProgress =
  | { kind: 'none' }
  | {
      kind: 'measured';
      completed: number;
      /** `null` when the backend did not report a requested total. */
      total: number | null;
      /** 0..1, or `null` when there is no usable denominator. */
      fraction: number | null;
    };

/** The one basis whose number is an observation rather than an inference. */
export const MEASURED_BASIS = 'measured';

export interface EpochFields {
  n_epochs?: number | null;
  n_epochs_completed?: number | null;
  n_epochs_completed_basis?: string | null;
}

const asCount = (v: unknown): number | null => {
  if (typeof v !== 'number' || !Number.isFinite(v) || v < 0) return null;
  return v;
};

/**
 * Decide what, if anything, may be claimed about a session's epoch progress.
 *
 * Returns `none` for every case where the honest answer is "no claim": a
 * non-measured basis, a missing basis, a missing or nonsensical count, or a
 * worker too old to report any of it.
 */
export function epochProgressOf(session: EpochFields | null | undefined): EpochProgress {
  if (!session) return { kind: 'none' };
  if (session.n_epochs_completed_basis !== MEASURED_BASIS) return { kind: 'none' };

  const completed = asCount(session.n_epochs_completed);
  if (completed === null) return { kind: 'none' };

  const total = asCount(session.n_epochs);
  // A zero or missing total is no denominator at all. Report the count on its
  // own rather than dividing by it.
  if (total === null || total <= 0) {
    return { kind: 'measured', completed, total: null, fraction: null };
  }

  // Clamped only for the BAR. The count itself is reported as the backend sent
  // it, because a number above the requested total is a backend fact worth
  // seeing rather than something to hide behind a tidy 100%.
  const fraction = Math.min(1, completed / total);
  return { kind: 'measured', completed, total, fraction };
}

/**
 * The sentence for a card. `null` when nothing may be claimed, which the
 * caller should render as nothing at all rather than as "unknown": a run on an
 * older worker is not a run with unknown progress, it is a run whose progress
 * this page has no information about, and saying so on every card would be
 * noise.
 */
export function epochProgressLabel(progress: EpochProgress): string | null {
  if (progress.kind !== 'measured') return null;
  if (progress.total === null) {
    return `${progress.completed} epoch${progress.completed === 1 ? '' : 's'} completed`;
  }
  return `Epoch ${progress.completed} of ${progress.total}`;
}
