import { readinessFor, TrainingUrlsOutcome } from './runReadiness';

const describeError = (err: unknown) => `(${String(err)})`;
const base = { label: 'cells', split: 'r30-accept', describeError };
const ok = (train: number, test: number): TrainingUrlsOutcome => ({
  ok: true,
  urls: { train: Array.from({ length: train }, (_, i) => i), test: Array.from({ length: test }, (_, i) => i) },
});

describe('readinessFor', () => {
  it('arms a run when the label exists and the split holds annotated images', () => {
    const r = readinessFor({ ...base, labelExists: true, outcome: ok(2, 1) });
    expect(r).toEqual({ state: 'ready', train: 2, test: 1 });
  });

  // THE BRANCH THREE REVIEWS ASKED ABOUT. A split can exist, be named
  // correctly, and hold nothing annotated. Inside the component this branch
  // was unreachable from any test, because a split that does not exist takes
  // the error path instead.
  it('refuses an existing split that holds no annotated training images', () => {
    const r = readinessFor({ ...base, labelExists: true, outcome: ok(0, 0) });
    expect(r.state).toBe('unusable');
    expect((r as { reason: string }).reason).toMatch(/no annotated training images/);
    // It must name the split, which is what the user has to go and fix.
    expect((r as { reason: string }).reason).toContain('r30-accept');
  });

  it('refuses when train is absent entirely, not just empty', () => {
    const r = readinessFor({ ...base, labelExists: true, outcome: { ok: true, urls: {} } });
    expect(r.state).toBe('unusable');
    expect((r as { reason: string }).reason).toMatch(/no annotated training images/);
  });

  it('names the LABEL when the label does not exist, not the split', () => {
    const r = readinessFor({ ...base, labelExists: false, outcome: ok(2, 1) });
    expect(r.state).toBe('unusable');
    const reason = (r as { reason: string }).reason;
    expect(reason).toMatch(/no label named "cells"/);
    // The defect this fixes: the broker's own message names the split even
    // when the label is what is missing, so the page must not say "split".
    expect(reason).not.toMatch(/split/i);
  });

  it('checks the label BEFORE the split error, so a missing label wins', () => {
    const r = readinessFor({ ...base, labelExists: false, outcome: { ok: false, err: new Error('boom') } });
    expect((r as { reason: string }).reason).toMatch(/no label named/);
  });

  it('reports a broker failure against the split, including the error text', () => {
    const r = readinessFor({
      ...base,
      labelExists: true,
      outcome: { ok: false, err: new Error('renamed') },
    });
    const reason = (r as { reason: string }).reason;
    expect(reason).toMatch(/Could not read split "r30-accept"/);
    expect(reason).toContain('renamed');
  });

  it('counts test images as zero rather than refusing when there are none', () => {
    // A run with no validation images is legitimate and must still arm.
    expect(readinessFor({ ...base, labelExists: true, outcome: ok(3, 0) }))
      .toEqual({ state: 'ready', train: 3, test: 0 });
  });

  // THE BRANCH THE LEAD REPLACED CLAUSE 3 WITH. The empty-train-list branch
  // above cannot occur in production, because a split cannot be created with
  // an empty train list. What DOES occur is annotations that exist and mark
  // nothing, which was 71 of 115 recorded production failures.
  it('refuses a split whose annotations mark no foreground', () => {
    const r = readinessFor({
      ...base,
      labelExists: true,
      outcome: ok(3, 1),
      foreground: { determined: true, anyForeground: false },
    });
    expect(r.state).toBe('unusable');
    expect((r as { reason: string }).reason).toMatch(/none of them mark any foreground/);
    // It must say HOW MANY were annotated, so the user can tell this refusal
    // from the no-annotations one.
    expect((r as { reason: string }).reason).toMatch(/3 annotated images/);
  });

  it('says "image" rather than "images" for a single annotation', () => {
    const r = readinessFor({
      ...base,
      labelExists: true,
      outcome: ok(1, 0),
      foreground: { determined: true, anyForeground: false },
    });
    expect((r as { reason: string }).reason).toMatch(/1 annotated image,/);
  });

  it('arms the run when at least one annotation marks foreground', () => {
    const r = readinessFor({
      ...base,
      labelExists: true,
      outcome: ok(2, 1),
      foreground: { determined: true, anyForeground: true },
    });
    expect(r).toEqual({ state: 'ready', train: 2, test: 1 });
  });

  // The fail-open half, and the one that would be easy to get backwards. An
  // annotation that could not be read is not evidence that it is empty, so an
  // undetermined probe must NOT refuse a run that is otherwise fine.
  it('does NOT refuse when the foreground answer is undetermined', () => {
    const r = readinessFor({
      ...base,
      labelExists: true,
      outcome: ok(2, 1),
      foreground: { determined: false, anyForeground: false },
    });
    expect(r).toEqual({ state: 'ready', train: 2, test: 1 });
  });

  it('does NOT refuse when the annotations were never probed', () => {
    const r = readinessFor({ ...base, labelExists: true, outcome: ok(2, 1), foreground: null });
    expect(r).toEqual({ state: 'ready', train: 2, test: 1 });
  });

  // Ordering: a missing label is a different fix from empty annotations, so the
  // label must win even when the probe also says there is no foreground.
  it('names the missing label even when foreground is also absent', () => {
    const r = readinessFor({
      ...base,
      labelExists: false,
      outcome: ok(2, 1),
      foreground: { determined: true, anyForeground: false },
    });
    expect((r as { reason: string }).reason).toMatch(/has no label named/);
  });

});
