import React, { useState, useImperativeHandle, forwardRef } from 'react';
import { useHyphaStore } from '../store/hyphaStore';
import { useModelRunners, UseModelRunnersResult } from '../hooks/useModelRunners';
import RunnerSiteToggle from './RunnerSiteToggle';
import TestDetailsDialog, { ProgressInfo } from './TestDetailsDialog';
import HintTooltip from './HintTooltip';

interface TestResult {
  name: string;
  status: 'passed' | 'failed';
  type?: string;
  env?: [string, string][];
  details: Array<{
    name: string;
    status: 'passed' | 'failed';
    errors: Array<{
      msg: string;
      loc: string[];
    }>;
    warnings: Array<{
      msg: string;
      loc: string[];
    }>;
  }>;
}

interface ModelTesterProps {
  artifactId?: string;
  isStaged?: boolean;
  isDisabled?: boolean;
  className?: string;
  skipCache?: boolean;
  customEnvironment?: boolean;
  onTestComplete?: (result?: TestResult) => void | Promise<void>;
  /**
   * When provided, use this caller-owned runner state instead of the
   * component's internal `useModelRunners()` instance. Lets a parent share
   * one runner selection across multiple sibling components (e.g. the
   * Edit page sharing one toggle with ModelValidator).
   */
  modelRunners?: UseModelRunnersResult;
  /** Hide the inline runner toggle. Use when a parent renders a shared toggle. */
  hideRunnerToggle?: boolean;
  /**
   * Hide the built-in trigger button. Use when the parent renders its own
   * trigger and drives the test via the imperative `runTest` ref method.
   */
  hideTrigger?: boolean;
  /**
   * When provided, clicking the trigger calls this instead of running the
   * test directly. Use to open a pre-run options dialog while keeping the
   * split-button visually connected.
   */
  onTriggerClick?: () => void;
  /**
   * Existing test report fetched from the test-report collection (model-runner
   * v1.13.2+). Shown in the result pill before the user runs a fresh test.
   */
  storedTestReport?: TestResult | null;
  /**
   * When true, the stored test report is considered outdated relative to the
   * current artifact state. The pill is rendered grey to signal this.
   */
  isStoredReportOutdated?: boolean;
}

export interface ModelTesterHandle {
  /** Fire the same test-run the built-in button would fire, honoring the current props. */
  runTest: () => Promise<void>;
}

export type { TestResult };

const sleep = (ms: number) => new Promise<void>(r => setTimeout(r, ms));

const ModelTester = forwardRef<ModelTesterHandle, ModelTesterProps>(({
  artifactId,
  isStaged,
  isDisabled,
  skipCache = false,
  customEnvironment = false,
  onTestComplete,
  className = '',
  modelRunners,
  hideRunnerToggle = false,
  hideTrigger = false,
  onTriggerClick,
  storedTestReport,
  isStoredReportOutdated = false,
}, ref) => {
  const { server, isLoggedIn } = useHyphaStore();
  const internalRunners = useModelRunners({ skip: !!modelRunners });
  const { kth, denbi, selected, setSelected, activeRunner, hasAny, loading: runnersLoading } = modelRunners ?? internalRunners;
  const [testResult, setTestResult] = useState<TestResult | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [loadingStep, setLoadingStep] = useState<string>('');
  const [progressInfo, setProgressInfo] = useState<ProgressInfo | null>(null);

  const runTest = async () => {
    if (!artifactId || !server) return;

    setIsLoading(true);
    setTestResult(null);
    setLoadingStep('Connecting to model runner...');
    setProgressInfo(null);
    setIsDialogOpen(true);

    try {
      const runner = activeRunner;
      if (!runner) {
        throw new Error('No model-runner service is currently available. Both KTH and deNBI failed to respond.');
      }
      const modelId = artifactId.split('/').pop();

      setLoadingStep('Starting test run...');
      setProgressInfo(null);
      console.log(`Testing model ${modelId}, stage: ${isStaged}, skip_cache: ${skipCache}, custom_environment: ${customEnvironment}`);

      const testResponse = await runner.test({
        model_id: modelId,
        stage: isStaged,
        skip_cache: skipCache,
        custom_environment: customEnvironment,
        _rkwargs: true,
      });

      // Only the v1.15+ async API is supported: runner.test() returns a bare
      // string test_run_id, and get_test_status returns the 5-key status dict.
      // A runner that returns a result dict directly is an older API and is
      // rejected, so the new async path is always the one being exercised.
      if (typeof testResponse !== 'string') {
        throw new Error(
          'This model-runner uses an unsupported API. Select a runner on v1.15 ' +
          'or newer (e.g. the deNBI site via Advanced Options).'
        );
      }

      const test_run_id = testResponse;
      console.log(`Async test run started, id: ${test_run_id}`);

      let finalResult: TestResult | null = null;
      const MAX_POLLS = 120; // 6 minutes at 3s inter-poll delay

      for (let i = 0; i < MAX_POLLS; i++) {
        const status = await runner.get_test_status({ test_run_id, _rkwargs: true });

        // v1.15 status shape: { queue_position, model_download, env_setup, running, result }.
        const { queue_position, model_download, env_setup, running, result } = status;

        setProgressInfo({
          version: 'v2',
          queuePosition: queue_position ?? 0,
          modelDownload: model_download ?? null,
          envSetup: env_setup ?? null,
          running: running ?? null,
        });

        // Text label for aria / fallback.
        if ((queue_position ?? 0) > 0) {
          setLoadingStep(`In queue (position ${queue_position})...`);
        } else if (running != null) {
          setLoadingStep('Running tests...');
        } else if (env_setup != null) {
          setLoadingStep('Setting up environment...');
        } else if (model_download != null) {
          setLoadingStep('Downloading model...');
        } else {
          setLoadingStep('Starting...');
        }

        if (result != null) {
          console.log('Test completed. Result:', result);
          if ('error' in result) {
            finalResult = {
              name: 'Test Failed',
              status: 'failed',
              details: [{
                name: 'Error',
                status: 'failed',
                errors: [{ msg: result.error as string, loc: ['test'] }],
                warnings: [],
              }],
            };
          } else {
            // Stamp the result time so the dialog can show a final running duration
            setProgressInfo(prev => prev?.version === 'v2'
              ? { ...prev, resultTime: Date.now() / 1000 }
              : prev);
            finalResult = result as TestResult;
          }
          break;
        }

        await sleep(3000);
      }

      if (!finalResult) {
        finalResult = {
          name: 'Test Timed Out',
          status: 'failed',
          details: [{
            name: 'Timeout',
            status: 'failed',
            errors: [{ msg: 'Test did not complete within the expected time. Check the runner logs.', loc: ['test'] }],
            warnings: [],
          }],
        };
      }

      setTestResult(finalResult);

      if (onTestComplete) {
        try {
          await onTestComplete(finalResult);
        } catch (refreshErr) {
          console.error('Post-test refresh failed:', refreshErr);
        }
      }
    } catch (err) {
      console.error('Test run failed:', err);
      const failureResult: TestResult = {
        name: 'Test Failed',
        status: 'failed',
        details: [{
          name: 'Error',
          status: 'failed',
          errors: [{ msg: `Failed to run model test: ${err}`, loc: ['test'] }],
          warnings: [],
        }],
      };
      setTestResult(failureResult);
      if (onTestComplete) {
        try {
          await onTestComplete(failureResult);
        } catch (refreshErr) {
          console.error('Post-test refresh failed:', refreshErr);
        }
      }
    } finally {
      setLoadingStep('');
      setProgressInfo(null);
      setIsLoading(false);
    }
  };

  useImperativeHandle(ref, () => ({ runTest }), [runTest]);

  const noRunner = !runnersLoading && !hasAny;
  const buttonDisabled = isDisabled || isLoading || !isLoggedIn || noRunner;

  const buttonLabel = !isLoggedIn
    ? 'Login to Test'
    : noRunner
      ? 'Runners unavailable'
      : 'Test Model';

  // The "display result" is either a fresh test result or the stored one.
  // A fresh result (just run) always takes precedence.
  const displayResult = testResult ?? storedTestReport ?? null;
  const showingStoredResult = testResult === null && !isLoading && storedTestReport != null;
  const isOutdated = showingStoredResult && isStoredReportOutdated;

  const getPillClass = () => {
    const base = `inline-flex items-center px-2 h-full font-medium transition-colors
      ${hideTrigger ? 'rounded-md border border-gray-300' : 'rounded-r-md border-l border-white/20'}`;

    if (isLoading) return `${base} bg-gray-200 text-gray-700 cursor-pointer`;

    if (!displayResult) {
      return `${base} ${buttonDisabled
        ? 'bg-gray-100 text-gray-400 cursor-not-allowed'
        : 'bg-gray-200 text-gray-400 cursor-not-allowed'}`;
    }

    if (isOutdated) {
      return `${base} bg-gray-300 text-gray-600 hover:bg-gray-400 cursor-pointer`;
    }

    return `${base} ${displayResult.status === 'passed'
      ? 'bg-green-600 text-white hover:bg-green-700 cursor-pointer'
      : 'bg-red-600 text-white hover:bg-red-700 cursor-pointer'}`;
  };

  const pillClickable = isLoading || displayResult != null;

  return (
    <div className={`relative ${className}`}>
      <div className="flex items-center gap-2">
        <div className="flex h-[40px]">
          {!hideTrigger && (
            <HintTooltip
              hint={noRunner ? 'Both KTH and deNBI model-runner services failed to respond.' : undefined}
              className="h-full"
            >
              <button
                onClick={onTriggerClick ?? runTest}
                disabled={buttonDisabled}
                className={`inline-flex items-center gap-2 px-4 h-full rounded-l-md font-medium transition-colors
                  ${buttonDisabled
                    ? 'bg-gray-100 text-gray-400 cursor-not-allowed'
                    : 'bg-gray-50 text-gray-700 hover:bg-gray-100 border border-gray-300'
                  }`}
              >
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                    d="M14.752 11.168l-3.197-2.132A1 1 0 0010 9.87v4.263a1 1 0 001.555.832l3.197-2.132a1 1 0 000-1.664z" />
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                    d="M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
                <span className="hidden sm:inline">{buttonLabel}</span>
              </button>
            </HintTooltip>
          )}

          {/* Result pill: spinner while running, pass/fail when done, stored result when available */}
          <HintTooltip
            hint={isOutdated ? 'Test report is outdated. The model has changed since this report was generated.' : undefined}
            className="h-full"
          >
            <button
              onClick={() => pillClickable && setIsDialogOpen(true)}
              className={getPillClass()}
            >
              {isLoading ? (
                <svg className="animate-spin w-4 h-4" viewBox="0 0 24 24">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" />
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                </svg>
              ) : displayResult ? (
                <>
                  {isOutdated ? (
                    /* Clock icon for outdated report */
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
                    </svg>
                  ) : (
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                        d={displayResult.status === 'passed' ? "M5 13l4 4L19 7" : "M6 18L18 6M6 6l12 12"} />
                    </svg>
                  )}
                  <svg className="w-4 h-4 ml-1" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
                  </svg>
                </>
              ) : null}
            </button>
          </HintTooltip>
        </div>

        {isLoggedIn && !hideRunnerToggle && (
          <RunnerSiteToggle
            selected={selected}
            onSelect={setSelected}
            available={{ kth: kth.available, denbi: denbi.available }}
            loading={runnersLoading}
          />
        )}
      </div>

      <TestDetailsDialog
        open={isDialogOpen}
        onClose={() => setIsDialogOpen(false)}
        data={displayResult}
        isLoading={isLoading}
        loadingMessage={loadingStep}
        progressInfo={progressInfo ?? undefined}
        type="test-report"
      />
    </div>
  );
});

ModelTester.displayName = 'ModelTester';

export default ModelTester;
