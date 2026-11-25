import { epochProgressLabel, epochProgressOf, outcomeForStatus } from './trainingProgress';

// The whole point of this module is knowing when NOT to show a number, so most
// of these assert a refusal. The Cellpose case is the one the issue calls out
// explicitly: `floor_if_completed` is derived from the run having finished, not
// measured during it, so rendering it as progress would invent a number.

describe('epochProgressOf, when a claim is allowed', () => {
  it('reports a measured mid-run count against the requested total', () => {
    const p = epochProgressOf({ n_epochs: 10, n_epochs_completed: 3, n_epochs_completed_basis: 'measured' });
    expect(p).toEqual({ kind: 'measured', completed: 3, total: 10, fraction: 0.3 });
    expect(epochProgressLabel(p)).toBe('3 of 10 epochs completed');
  });

  // Early stopping is a legitimate reason for measured < total, so a finished
  // run sitting below its request must still report, not be treated as broken.
  it('reports a measured count that stopped below the total', () => {
    const p = epochProgressOf({ n_epochs: 10, n_epochs_completed: 7, n_epochs_completed_basis: 'measured' });
    expect(p).toEqual({ kind: 'measured', completed: 7, total: 10, fraction: 0.7 });
  });

  it('reports a count with no denominator when the total is missing', () => {
    const p = epochProgressOf({ n_epochs_completed: 4, n_epochs_completed_basis: 'measured' });
    expect(p).toEqual({ kind: 'measured', completed: 4, total: null, fraction: null });
    expect(epochProgressLabel(p)).toBe('4 epochs completed');
  });

  it('singularises a count of one', () => {
    const p = epochProgressOf({ n_epochs_completed: 1, n_epochs_completed_basis: 'measured' });
    expect(epochProgressLabel(p)).toBe('1 epoch completed');
  });

  it('reports zero completed rather than refusing, because zero is a real observation', () => {
    const p = epochProgressOf({ n_epochs: 5, n_epochs_completed: 0, n_epochs_completed_basis: 'measured' });
    expect(p).toEqual({ kind: 'measured', completed: 0, total: 5, fraction: 0 });
    expect(epochProgressLabel(p)).toBe('0 of 5 epochs completed');
  });

  // The bar is clamped, the count is not: a number above the request is a
  // backend fact worth seeing rather than something to hide behind a tidy 100%.
  it('clamps the bar but not the reported count when completed exceeds the total', () => {
    const p = epochProgressOf({ n_epochs: 5, n_epochs_completed: 8, n_epochs_completed_basis: 'measured' });
    expect(p).toEqual({ kind: 'measured', completed: 8, total: 5, fraction: 1 });
  });

  it('drops a zero or negative total rather than dividing by it', () => {
    expect(epochProgressOf({ n_epochs: 0, n_epochs_completed: 2, n_epochs_completed_basis: 'measured' }))
      .toEqual({ kind: 'measured', completed: 2, total: null, fraction: null });
    expect(epochProgressOf({ n_epochs: -4, n_epochs_completed: 2, n_epochs_completed_basis: 'measured' }))
      .toEqual({ kind: 'measured', completed: 2, total: null, fraction: null });
  });
});

describe('epochProgressOf, when no claim is allowed', () => {
  // THE case this module exists for.
  it('makes no per-epoch claim for a Cellpose floor_if_completed run', () => {
    const p = epochProgressOf({ n_epochs: 10, n_epochs_completed: 4, n_epochs_completed_basis: 'floor_if_completed' });
    expect(p).toEqual({ kind: 'none' });
    expect(epochProgressLabel(p)).toBeNull();
  });

  it('makes no claim for an unrecognised basis', () => {
    expect(epochProgressOf({ n_epochs: 10, n_epochs_completed: 4, n_epochs_completed_basis: 'something_new' }))
      .toEqual({ kind: 'none' });
  });

  it('makes no claim when the basis is missing, which is every worker before 0.18.0', () => {
    expect(epochProgressOf({ n_epochs: 10, n_epochs_completed: 4 })).toEqual({ kind: 'none' });
  });

  // The observed shape of the one post-writer micro-SAM run on production: the
  // KEY IS ABSENT rather than null, because the child's terminal write never ran.
  it('makes no claim when the count key is absent but the total is present', () => {
    expect(epochProgressOf({ n_epochs: 10, n_epochs_completed_basis: 'measured' })).toEqual({ kind: 'none' });
  });

  it('makes no claim for a null count, which is what the heartbeat writes before the first epoch', () => {
    expect(epochProgressOf({ n_epochs: 10, n_epochs_completed: null, n_epochs_completed_basis: 'measured' }))
      .toEqual({ kind: 'none' });
  });

  it('makes no claim for a nonsensical count', () => {
    expect(epochProgressOf({ n_epochs: 10, n_epochs_completed: -1, n_epochs_completed_basis: 'measured' }))
      .toEqual({ kind: 'none' });
    expect(epochProgressOf({ n_epochs: 10, n_epochs_completed: NaN, n_epochs_completed_basis: 'measured' }))
      .toEqual({ kind: 'none' });
    expect(epochProgressOf({ n_epochs: 10, n_epochs_completed: Infinity, n_epochs_completed_basis: 'measured' }))
      .toEqual({ kind: 'none' });
  });

  // A string where a number belongs: a backend that regressed its own type
  // should make the UI say nothing, not render a count from the string "3".
  it('makes no claim for a non-numeric count', () => {
    expect(epochProgressOf({ n_epochs: 10, n_epochs_completed: '3' as any, n_epochs_completed_basis: 'measured' }))
      .toEqual({ kind: 'none' });
  });

  it('makes no claim for an empty, null or undefined session', () => {
    expect(epochProgressOf({})).toEqual({ kind: 'none' });
    expect(epochProgressOf(null)).toEqual({ kind: 'none' });
    expect(epochProgressOf(undefined)).toEqual({ kind: 'none' });
  });
});

describe('epochProgressLabel text rules', () => {
  // The repo bans em dashes, en dashes and stray semicolons in user-visible
  // strings, and these strings reach a card.
  it('emits no em dash, en dash or semicolon', () => {
    const labels = [
      epochProgressLabel(epochProgressOf({ n_epochs: 10, n_epochs_completed: 3, n_epochs_completed_basis: 'measured' })),
      epochProgressLabel(epochProgressOf({ n_epochs_completed: 3, n_epochs_completed_basis: 'measured' })),
      epochProgressLabel(epochProgressOf({ n_epochs_completed: 1, n_epochs_completed_basis: 'measured' })),
    ];
    for (const label of labels) {
      expect(label).not.toBeNull();
      expect(label).not.toMatch(/[–—;]/);
    }
  });
});

// Added after a REFUSE in round 1. Each of these FAILED against the code as
// reviewed, which is the only thing that makes them worth keeping.
describe('the label says COMPLETED, and never names a running epoch', () => {
  const measured = (total: number | null, completed: number) =>
    epochProgressOf({
      n_epochs: total ?? undefined,
      n_epochs_completed: completed,
      n_epochs_completed_basis: 'measured',
    });

  it('names the finished count, not the epoch in flight', () => {
    // The defect: "Epoch 3 of 10" reads as "now in epoch 3" (the way Keras's
    // "Epoch 4/10" does), when in fact 3 are done and the 4th is running.
    expect(epochProgressLabel(measured(10, 3))).toBe('3 of 10 epochs completed');
    expect(epochProgressLabel(measured(10, 3))).not.toContain('Epoch 3 of');
  });

  it('does not name a zeroth epoch before the first one finishes', () => {
    // "Epoch 0 of 5" named an epoch that does not exist.
    expect(epochProgressLabel(measured(5, 0))).toBe('0 of 5 epochs completed');
    expect(epochProgressLabel(measured(5, 0))).not.toMatch(/Epoch 0/);
  });

  it('agrees with the no-total branch about what the number means', () => {
    // Both branches must describe the same quantity. They did not: one said
    // "Epoch N of M" and the other "N epochs completed".
    expect(epochProgressLabel(measured(10, 4))).toContain('epochs completed');
    expect(epochProgressLabel(measured(null, 4))).toContain('epochs completed');
  });

  it('refuses a fractional count instead of rendering 3.5 epochs', () => {
    expect(epochProgressLabel(measured(10, 3.5 as unknown as number))).toBeNull();
    expect(measured(10, 3.5 as unknown as number).kind).toBe('none');
  });
});


// Added after round 2. This mapping used to be an inline ternary in
// Finetune.tsx, where a reviewer hardcoded it to 'completed' and the ENTIRE
// 146-test suite stayed green, so the defect it fixes could return unnoticed.
describe('outcomeForStatus', () => {
  it('treats only COMPLETED as success', () => {
    expect(outcomeForStatus('COMPLETED')).toBe('completed');
  });

  it('treats every other terminal status as unsuccessful', () => {
    expect(outcomeForStatus('FAILED')).toBe('unsuccessful');
    expect(outcomeForStatus('STOPPED')).toBe('unsuccessful');
  });

  it('treats an unknown or absent status as unsuccessful, not as success', () => {
    // Direction matters: a status this build has never heard of is not
    // evidence that the run succeeded.
    expect(outcomeForStatus('SOMETHING_NEW')).toBe('unsuccessful');
    expect(outcomeForStatus(undefined)).toBe('unsuccessful');
    expect(outcomeForStatus(null)).toBe('unsuccessful');
  });
});

describe('the total-branch label pluralises', () => {
  it('says "1 epoch" rather than "1 epochs" when the total is 1', () => {
    const p = epochProgressOf({ n_epochs: 1, n_epochs_completed: 0, n_epochs_completed_basis: 'measured' });
    expect(epochProgressLabel(p)).toBe('0 of 1 epoch completed');
  });
});
