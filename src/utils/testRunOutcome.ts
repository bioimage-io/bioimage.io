import { isRuntimeStartingError, RUNTIME_STARTING_MESSAGE } from './runnerErrors';

/**
 * How a model-test run is turned into something the dialog can render.
 *
 * Extracted from `ModelTester` so the three ways a run can end (the runner
 * reported an error, we lost contact with the runner, the run genuinely failed)
 * can be tested without standing up the component, a Hypha session, or a GPU.
 * The bug that prompted the extraction was a run that PASSED being rendered red,
 * so these are worth a regression test each.
 *
 * Structurally compatible with `ModelTester`'s `TestResult`, deliberately typed
 * loosely here so the util does not depend on the component.
 */
export interface RunOutcome {
  name: string;
  status: 'passed' | 'failed';
  details: Array<{
    name: string;
    status: 'passed' | 'failed';
    errors: Array<{ msg: string; loc: string[] }>;
    warnings: Array<{ msg: string; loc: string[] }>;
  }>;
}

/**
 * Did the runner report an actual error for this run?
 *
 * A VALUE check, not a key-presence one. The previous `'error' in result` was
 * true for `{error: null}` as well, which is how a passing run could be
 * rendered as a failure: any runner build that always includes the key would
 * trip it on every single run.
 */
export const isRunnerErrorResult = (result: unknown): boolean => {
  if (result == null || typeof result !== 'object') return false;
  return (result as { error?: unknown }).error != null;
};

/**
 * Build the failed-test result shown in the dialog. When the failure is the
 * transient "GPU runtime still starting" condition (same as the infer path),
 * surface the friendly message instead of the raw traceback.
 */
export const buildTestFailure = (error: unknown, fallbackMsg?: string): RunOutcome => {
  const runtimeStarting = isRuntimeStartingError(error);
  const rawMsg = error instanceof Error ? error.message : String(error);
  return {
    name: runtimeStarting ? 'BioEngine Starting' : 'Test Failed',
    status: 'failed',
    details: [{
      name: runtimeStarting ? 'BioEngine Starting' : 'Error',
      status: 'failed',
      errors: [{ msg: runtimeStarting ? RUNTIME_STARTING_MESSAGE : (fallbackMsg ?? rawMsg), loc: ['test'] }],
      warnings: [],
    }],
  };
};

/**
 * Build the result shown when the website loses contact with the runner while a
 * test is in flight.
 *
 * Deliberately NOT worded as a test failure. The run was accepted and carries on
 * server side; all that broke is our ability to watch it. Reporting "Test Failed"
 * here told users a model was broken when it went on to pass and write a passing
 * report. The run id stays persisted, so reloading the page resumes polling.
 */
export const buildLostContact = (error: unknown): RunOutcome => ({
  name: 'Lost Contact With The Runner',
  status: 'failed',
  details: [{
    name: 'Lost contact with the runner',
    status: 'failed',
    errors: [{
      msg:
        'The test was submitted and is probably still running, but the website stopped receiving '
        + 'status updates from the runner. This does not mean the model failed. Reload the page to '
        + 'pick the run back up, or check the test report in a few minutes. '
        + `Last error: ${error instanceof Error ? error.message : String(error)}`,
      loc: ['status'],
    }],
    warnings: [],
  }],
});
