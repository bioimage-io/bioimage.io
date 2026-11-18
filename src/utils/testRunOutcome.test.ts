import { isRunnerErrorResult, buildTestFailure, buildLostContact } from './testRunOutcome';

// Regression coverage for svamp #0050: a model test whose backend run succeeded
// was rendered in the dialog as a red failure with a single generic "Error"
// entry, while the collection recorded a passing report with all 17 checks.

describe('isRunnerErrorResult', () => {
  it('treats a result with no error key as a success', () => {
    expect(isRunnerErrorResult({ status: 'passed', details: [] })).toBe(false);
  });

  // The actual defect: the old `'error' in result` was key-presence, so a
  // runner build that always includes the key marked every run as failed.
  it('treats an explicitly null error as a success', () => {
    expect(isRunnerErrorResult({ error: null, status: 'passed' })).toBe(false);
  });

  it('treats an undefined error as a success', () => {
    expect(isRunnerErrorResult({ error: undefined, status: 'passed' })).toBe(false);
  });

  it('treats a populated error as a failure', () => {
    expect(isRunnerErrorResult({ error: 'boom' })).toBe(true);
  });

  // An empty string is a real (if unhelpful) error value, and the runner uses
  // `error: 'cancelled'` for cancellation, so falsiness is the wrong test too.
  it('treats an empty-string error as a failure', () => {
    expect(isRunnerErrorResult({ error: '' })).toBe(true);
  });

  it('is safe on null and non-objects', () => {
    expect(isRunnerErrorResult(null)).toBe(false);
    expect(isRunnerErrorResult(undefined)).toBe(false);
    expect(isRunnerErrorResult('passed')).toBe(false);
  });
});

describe('buildLostContact', () => {
  const outcome = buildLostContact(new Error('websocket closed'));

  it('does not claim the test failed', () => {
    expect(outcome.name).not.toMatch(/test failed/i);
    expect(outcome.details[0].errors[0].msg).toMatch(/does not mean the model failed/i);
  });

  it('tells the user the run is probably still going and how to pick it back up', () => {
    const msg = outcome.details[0].errors[0].msg;
    expect(msg).toMatch(/still running/i);
    expect(msg).toMatch(/reload/i);
  });

  it('keeps the underlying error for debugging', () => {
    expect(outcome.details[0].errors[0].msg).toContain('websocket closed');
  });

  // User-visible copy: CLAUDE.md bans em dashes in strings that reach a user.
  it('uses no em dash in user-visible copy', () => {
    expect(outcome.name).not.toContain('—');
    expect(outcome.details[0].errors[0].msg).not.toContain('—');
  });
});

describe('buildTestFailure', () => {
  it('reports a genuine failure as a test failure', () => {
    const outcome = buildTestFailure('validation exploded');
    expect(outcome.name).toBe('Test Failed');
    expect(outcome.status).toBe('failed');
    expect(outcome.details[0].errors[0].msg).toBe('validation exploded');
  });

  it('prefers the caller fallback message when given one', () => {
    expect(buildTestFailure(new Error('raw'), 'friendlier').details[0].errors[0].msg)
      .toBe('friendlier');
  });

  it('is distinguishable from a lost-contact outcome', () => {
    expect(buildTestFailure('x').name).not.toBe(buildLostContact('x').name);
  });
});
