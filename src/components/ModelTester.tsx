import React, { useState, useImperativeHandle, forwardRef } from 'react';
import { useHyphaStore } from '../store/hyphaStore';
import { useModelRunners, UseModelRunnersResult } from '../hooks/useModelRunners';
import TestDetailsDialog, { ProgressInfo } from './TestDetailsDialog';
import TestOptionsDialog from './TestOptionsDialog';
import HintTooltip from './HintTooltip';
import { resolveTestReportUrl } from '../utils/urlHelpers';
import { isRuntimeStartingError, RUNTIME_STARTING_MESSAGE } from '../utils/runnerErrors';

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
  onTestComplete?: (result?: TestResult) => void | Promise<void>;
  /**
   * When provided, use this caller-owned runner state instead of the
   * component's internal `useModelRunners()` instance. Lets a parent share
   * one runner selection across multiple sibling components (e.g. the
   * Edit page sharing one selection with ModelValidator). Runner-site
   * selection lives in the shared Advanced Options popover, not here.
   */
  modelRunners?: UseModelRunnersResult;
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

/**
 * Build the failed-test result shown in the dialog. When the failure is the
 * transient "GPU runtime still starting" condition (same as the infer path),
 * surface the friendly message instead of the raw traceback.
 */
const buildTestFailure = (error: unknown, fallbackMsg?: string): TestResult => {
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

const ModelTester = forwardRef<ModelTesterHandle, ModelTesterProps>(({
  artifactId,
  isStaged,
  isDisabled,
  onTestComplete,
  className = '',
  modelRunners,
  storedTestReport,
  isStoredReportOutdated = false,
}, ref) => {
  const { server, isLoggedIn } = useHyphaStore();
  const internalRunners = useModelRunners({ skip: !!modelRunners });
  const { activeRunner, hasAny, loading: runnersLoading } = modelRunners ?? internalRunners;
  const [testResult, setTestResult] = useState<TestResult | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [loadingStep, setLoadingStep] = useState<string>('');
  const [progressInfo, setProgressInfo] = useState<ProgressInfo | null>(null);
  // After a run finishes we keep showing the step timeline; the user opens the
  // report explicitly. `showReport` flips to true on that click (and is true by
  // default so opening a stored report via the pill goes straight to it).
  const [showReport, setShowReport] = useState(true);
  // Options dialog (custom environment + skip cache) is owned here so every
  // Test Model button opens the same dialog with the same defaults.
  const [showOptionsDialog, setShowOptionsDialog] = useState(false);
  const [customEnvironment, setCustomEnvironment] = useState(false);
  const [skipCache, setSkipCache] = useState(false);

  const runTest = async () => {
    if (!artifactId || !server) return;

    setIsLoading(true);
    setTestResult(null);
    setShowReport(false);
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
      // Overall start time for the "Test started" display. We use the browser's
      // clock (when the run was kicked off) rather than the runner's
      // submitted_at so the shown time matches the user's own wall clock — the
      // runner's clock can be skewed by minutes, which would otherwise show a
      // start time several minutes off.
      const submittedAtClient = Date.now() / 1000;

      // Load the authoritative test report from the test-report artifact
      // collection rather than the inline `result` from get_test_status. The
      // runner commits the report to the collection before it exposes `result`,
      // so it's already there; we poll briefly (cache-busted) until the stored
      // copy reflects THIS run (matching tested_at) to avoid a stale prior
      // report. Returns null if the collection can't be reached.
      const loadStoredReport = async (expectedTestedAt?: number): Promise<TestResult | null> => {
        const base = resolveTestReportUrl(artifactId!, !!isStaged);
        for (let attempt = 0; attempt < 5; attempt++) {
          try {
            const res = await fetch(`${base}&t=${Date.now()}`);
            if (res.ok) {
              const report = await res.json();
              if (expectedTestedAt == null || Number(report?.tested_at) === Number(expectedTestedAt)) {
                return report as TestResult;
              }
            }
          } catch { /* transient — retry */ }
          await sleep(1500);
        }
        return null;
      };

      let finalResult: TestResult | null = null;
      const MAX_POLLS = 120; // 6 minutes at 3s inter-poll delay

      for (let i = 0; i < MAX_POLLS; i++) {
        const status = await runner.get_test_status({ test_run_id, _rkwargs: true });

        // v1.15 status shape: { queue_position, model_download, env_setup,
        // running, result }; v1.15.3 adds submitted_at + completed_at.
        const { queue_position, model_download, env_setup, running, result, completed_at } = status;

        setProgressInfo({
          version: 'v2',
          submittedAt: submittedAtClient,
          queuePosition: queue_position ?? 0,
          modelDownload: model_download ?? null,
          envSetup: env_setup ?? null,
          running: running ?? null,
          completedAt: completed_at ?? null,
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
            finalResult = buildTestFailure(result.error as string);
          } else {
            // Freeze the timeline on completion: prefer the server's
            // completed_at, else stamp the moment the result arrived.
            setProgressInfo(prev => prev?.version === 'v2'
              ? { ...prev, resultTime: Date.now() / 1000, completedAt: prev.completedAt ?? completed_at ?? Date.now() / 1000 }
              : prev);
            // Discard the inline `result` payload; load the report from the
            // artifact collection instead. `tested_at` is used only to confirm
            // the stored copy is from this run. Fall back to the inline result
            // if the collection is unreachable.
            const expectedTestedAt = (result as any)?.tested_at;
            finalResult = (await loadStoredReport(expectedTestedAt)) ?? (result as TestResult);
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
      const failureResult = buildTestFailure(err, `Failed to run model test: ${err}`);
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
      setIsLoading(false);
      // Keep the step timeline visible after completion so the user can review
      // it and open the report via the button. Freeze the active step if
      // nothing marked it done (e.g. an error before a result arrived).
      setProgressInfo(prev =>
        prev?.version === 'v2' && prev.completedAt == null && prev.resultTime == null
          ? { ...prev, completedAt: Date.now() / 1000 }
          : prev
      );
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
      rounded-r-md border-l border-white/20`;

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
          <HintTooltip
            hint={noRunner ? 'Both KTH and deNBI model-runner services failed to respond.' : undefined}
            className="h-full"
          >
            <button
              onClick={() => setShowOptionsDialog(true)}
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

          {/* Result pill: spinner while running, pass/fail when done, stored result when available */}
          <HintTooltip
            hint={isOutdated ? 'Test report is outdated. The model has changed since this report was generated.' : undefined}
            className="h-full"
          >
            <button
              onClick={() => {
                if (!pillClickable) return;
                // The pill represents the finished result → open the report
                // directly (the timeline+button flow is for a fresh run).
                if (!isLoading && displayResult) setShowReport(true);
                setIsDialogOpen(true);
              }}
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
      </div>

      <TestOptionsDialog
        open={showOptionsDialog}
        onClose={() => setShowOptionsDialog(false)}
        onRun={() => { void runTest(); }}
        customEnvironment={customEnvironment}
        onCustomEnvironmentChange={setCustomEnvironment}
        skipCache={skipCache}
        onSkipCacheChange={setSkipCache}
      />

      <TestDetailsDialog
        open={isDialogOpen}
        onClose={() => setIsDialogOpen(false)}
        data={displayResult}
        isLoading={isLoading}
        loadingMessage={loadingStep}
        progressInfo={progressInfo ?? undefined}
        type="test-report"
        showReport={showReport}
        onViewReport={() => setShowReport(true)}
      />
    </div>
  );
});

ModelTester.displayName = 'ModelTester';

export default ModelTester;
