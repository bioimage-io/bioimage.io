import React, { useState, useImperativeHandle, forwardRef } from 'react';
import { useHyphaStore } from '../store/hyphaStore';
import { useModelRunners, UseModelRunnersResult } from '../hooks/useModelRunners';
import RunnerSiteToggle from './RunnerSiteToggle';
import TestDetailsDialog from './TestDetailsDialog';

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
  attachTestReport?: boolean;
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
}

export interface ModelTesterHandle {
  /** Fire the same test-run the built-in button would fire, honoring the current props. */
  runTest: () => Promise<void>;
}

export type { TestResult };

const ModelTester = forwardRef<ModelTesterHandle, ModelTesterProps>(({
  artifactId,
  isStaged,
  isDisabled,
  skipCache = false,
  attachTestReport = false,
  customEnvironment = false,
  onTestComplete,
  className = '',
  modelRunners,
  hideRunnerToggle = false,
  hideTrigger = false,
  onTriggerClick,
}, ref) => {
  const { server, isLoggedIn } = useHyphaStore();
  const internalRunners = useModelRunners({ skip: !!modelRunners });
  const { kth, denbi, selected, setSelected, activeRunner, hasAny, loading: runnersLoading } = modelRunners ?? internalRunners;
  const [testResult, setTestResult] = useState<TestResult | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [loadingStep, setLoadingStep] = useState<string>('');

  const runTest = async () => {
    if (!artifactId || !server) return;

    setIsLoading(true);
    setTestResult(null);
    setLoadingStep('Initializing test runner...');
    setIsDialogOpen(true);
    
    try {
      setLoadingStep('Connecting to model runner service...');
      const runner = activeRunner;
      if (!runner) {
        throw new Error('No model-runner service is currently available. Both KTH and deNBI failed to respond.');
      }
      const modelId = artifactId.split('/').pop();
      
      setLoadingStep('Downloading and preparing model for testing...');

      // ``attach_test_report=true`` requires a caller-owned token so the
      // runner writes under the user's identity, not the service account.
      let hyphaToken: string | undefined;
      if (attachTestReport && typeof server.generateToken === 'function') {
        hyphaToken = await server.generateToken();
      }

      console.log(`Testing model ${modelId}, stage: ${isStaged}, skip_cache: ${skipCache}, attach_test_report: ${attachTestReport}, custom_environment: ${customEnvironment}`);
      const startTime = performance.now();
      const result = await runner.test({
        model_id: modelId,
        stage: isStaged,
        skip_cache: skipCache,
        attach_test_report: attachTestReport,
        custom_environment: customEnvironment,
        ...(hyphaToken ? { hypha_token: hyphaToken } : {}),
        _rkwargs: true,
      });
      const endTime = performance.now();
      const executionTime = (endTime - startTime) / 1000; // Convert to seconds
      console.log(`Test execution time: ${executionTime.toFixed(2)}s`);
      console.log("Test result:", result);
      setTestResult(result);

      if (onTestComplete) {
        try {
          await onTestComplete(result);
        } catch (refreshErr) {
          console.error('Post-test refresh failed:', refreshErr);
        }
      }
    } catch (err) {
      console.error('Test run failed:', err);
      const failureResult: TestResult = {
        name: 'Test Failed',
        status: "failed",
        details: [{
          name: 'Error',
          status: 'failed',
          errors: [{
            msg: `Failed to run model test: ${err}`,
            loc: ['test']
          }],
          warnings: []
        }]
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
      setIsLoading(false);
    }
  };

  // Expose runTest so a parent can wrap the tester in its own trigger UI
  // (e.g. a dropdown that gathers per-run options before firing) while
  // still letting this component own the result / spinner dialog.
  useImperativeHandle(ref, () => ({ runTest }), [runTest]);

  // Button is disabled if the caller disabled it, if a test is already in
  // flight, if the user isn't logged in, or if neither runner answered the
  // probe.
  const noRunner = !runnersLoading && !hasAny;
  const buttonDisabled = isDisabled || isLoading || !isLoggedIn || noRunner;

  const buttonLabel = !isLoggedIn
    ? 'Login to Test'
    : noRunner
      ? 'Runners unavailable'
      : 'Test Model';

  return (
    <div className={`relative ${className}`}>
      <div className="flex items-center gap-2">
        <div className="flex h-[40px]">
          {!hideTrigger && (
            <button
              onClick={onTriggerClick ?? runTest}
              disabled={buttonDisabled}
              title={noRunner
                ? 'Both KTH and deNBI model-runner services failed to respond.'
                : undefined}
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
          )}

          {/* Result pill: shows spinner while running, pass/fail icon when done */}
          <button
            onClick={() => (testResult || isLoading) && setIsDialogOpen(true)}
            className={`inline-flex items-center px-2 h-full font-medium transition-colors
              ${hideTrigger ? 'rounded-md border border-gray-300' : 'rounded-r-md border-l border-white/20'}
              ${buttonDisabled && !testResult
                ? 'bg-gray-100 text-gray-400 cursor-not-allowed'
                : testResult
                  ? testResult.status === 'passed'
                    ? 'bg-green-600 text-white hover:bg-green-700 cursor-pointer'
                    : 'bg-red-600 text-white hover:bg-red-700 cursor-pointer'
                  : isLoading
                    ? 'bg-gray-200 text-gray-700 cursor-pointer'
                    : 'bg-gray-200 text-gray-400 cursor-not-allowed'
              }`}
          >
            {isLoading ? (
              <svg className="animate-spin w-4 h-4" viewBox="0 0 24 24">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" />
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
              </svg>
            ) : testResult ? (
              <>
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                    d={testResult.status === 'passed' ? "M5 13l4 4L19 7" : "M6 18L18 6M6 6l12 12"} />
                </svg>
                <svg className="w-4 h-4 ml-1" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
                </svg>
              </>
            ) : null}
          </button>
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
        data={testResult}
        isLoading={isLoading}
        loadingMessage={loadingStep}
        type="test-report"
      />
    </div>
  );
});

ModelTester.displayName = 'ModelTester';

export default ModelTester;