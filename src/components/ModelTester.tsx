import React, { useState, useRef, useEffect, useImperativeHandle, forwardRef } from 'react';
import { useHyphaStore } from '../store/hyphaStore';
import { useModelRunners, UseModelRunnersResult } from '../hooks/useModelRunners';
import RunnerSiteToggle from './RunnerSiteToggle';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { Menu } from '@headlessui/react';

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
  publishTestReport?: boolean;
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
  publishTestReport = false,
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
  const [isOpen, setIsOpen] = useState(false);
  const [loadingStep, setLoadingStep] = useState<string>('');
  const [isMobile, setIsMobile] = useState(false);

  const dropdownRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node) &&
          buttonRef.current && !buttonRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, []);

  // Position the popover so it stays inside the viewport regardless of
  // which side of the row the button lives on. Prefers opening leftward
  // (the tester usually sits near the right side of the actions row);
  // falls back to opening rightward, and finally nudges the popover with
  // a negative-`right` offset when neither side fully fits so it never
  // clips past the viewport edge.
  useEffect(() => {
    if (!isOpen) return;
    const position = () => {
      const dropdown = dropdownRef.current;
      const button = buttonRef.current;
      if (!dropdown || !button) return;
      const dropdownWidth = dropdown.offsetWidth;
      const buttonRect = button.getBoundingClientRect();
      const vw = window.innerWidth;
      const margin = 8;

      dropdown.style.right = '';
      dropdown.style.left = '';

      const spaceLeftOfButtonRight = buttonRect.right - margin;
      const spaceRightOfButtonLeft = vw - buttonRect.left - margin;

      if (spaceLeftOfButtonRight >= dropdownWidth) {
        dropdown.style.right = '0px';
      } else if (spaceRightOfButtonLeft >= dropdownWidth) {
        dropdown.style.left = '0px';
      } else {
        // Neither side alone fits; pin popover's right to viewport-right
        // minus margin. Parent's right edge ≈ buttonRect.right, so a
        // negative `right` shifts the popover further right.
        const offset = buttonRect.right - (vw - margin);
        dropdown.style.right = `${offset}px`;
      }
    };
    position();
    window.addEventListener('resize', position);
    return () => window.removeEventListener('resize', position);
  }, [isOpen, testResult, isLoading]);

  // Add resize listener
  useEffect(() => {
    const checkMobile = () => {
      setIsMobile(window.innerWidth < 1024); // 1024px matches Tailwind's lg breakpoint
    };
    
    checkMobile();
    window.addEventListener('resize', checkMobile);
    return () => window.removeEventListener('resize', checkMobile);
  }, []);

  const runTest = async () => {
    if (!artifactId || !server) return;

    setIsLoading(true);
    setLoadingStep('Initializing test runner...');
    setIsOpen(true);
    
    try {
      setLoadingStep('Connecting to model runner service...');
      const runner = activeRunner;
      if (!runner) {
        throw new Error('No model-runner service is currently available. Both KTH and deNBI failed to respond.');
      }
      const modelId = artifactId.split('/').pop();
      
      setLoadingStep('Downloading and preparing model for testing...');

      // v1.6.0+: publish_test_report=true requires a caller-owned token so
      // the runner writes under the user's identity, not the service account.
      let hyphaToken: string | undefined;
      if (publishTestReport && typeof server.generateToken === 'function') {
        setLoadingStep('Minting short-lived token for publish...');
        hyphaToken = await server.generateToken();
      }

      console.log(`Testing model ${modelId}, stage: ${isStaged}, skip_cache: ${skipCache}, publish_test_report: ${publishTestReport}`);
      const startTime = performance.now();
      const result = await runner.test({
        model_id: modelId,
        stage: isStaged,
        skip_cache: skipCache,
        publish_test_report: publishTestReport,
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

  const getMarkdownContent = () => {
    if (isLoading) {
      return `### Running Model Tests...

⏳ ${loadingStep}

This may take 30 seconds or more. The runner will:
1. Load the model from cache or download it
2. Load the weights onto GPU
3. Run inference with the model's bundled test inputs

Powered by BioEngine. Keep this window open while the test is running.`;
    }

    if (!testResult) return '';

    let content = `# ${testResult.status === 'passed' ? '✅ Test Passed' : '❌ Test Failed'}\n\n`;
    content += `## Details\n\n`;

    testResult.details.forEach(detail => {
      content += `### ${detail.name}\n`;
      content += `**Status**: ${detail.status === 'passed' ? '✅ Passed' : '❌ Failed' }\n\n`;

      if (detail.errors.length > 0) {
        content += '#### Errors\n';
        detail.errors.forEach(error => {
          content += `- **${error.loc.join(' > ')}**: ${error.msg}\n`;
        });
        content += '\n';
      }

      if (detail.warnings.length > 0) {
        content += '#### Warnings\n';
        detail.warnings.forEach(warning => {
          content += `- **${warning.loc.join(' > ')}**: ${warning.msg}\n`;
        });
        content += '\n';
      }
    });

    if (testResult.env && testResult.env.length > 0) {
      content += `## Environment\n\n`;
      content += `| Package | Version |\n|---|---|\n`;
      testResult.env.forEach(([pkg, ver]) => {
        content += `| ${pkg} | ${ver} |\n`;
      });
      content += '\n';
    }

    return content;
  };

  const renderContent = () => (
    <div className="p-6 relative">
      <button
        onClick={() => setIsOpen(false)}
        className="absolute top-2 right-2 text-gray-400 hover:text-gray-600"
        title="Close test results"
      >
        <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
        </svg>
      </button>
      {isLoading && (
        <div className="flex items-center justify-center mb-4">
          <img 
            src="/static/img/bioengine-logo-black.svg" 
            alt="BioEngine Logo" 
            className="h-28 animate-pulse"
          />
        </div>
      )}
      <ReactMarkdown
        className="prose prose-sm max-w-none"
        remarkPlugins={[remarkGfm]}
      >
        {getMarkdownContent()}
      </ReactMarkdown>
    </div>
  );

  // Button is disabled if the caller disabled it, if a test is already in
  // flight, if the user isn't logged in, or if neither runner answered the
  // probe. The last case is the new failure mode from this PR — both KTH
  // and deNBI being unreachable shouldn't surface as a generic "test"
  // error after the click; it should be visible up-front in the button.
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
        <div className="flex h-[40px]" ref={buttonRef}>
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

        <Menu as="div" className="relative h-full">
          <Menu.Button
            onClick={() => setIsOpen(!isOpen)}
            className={`inline-flex items-center px-2 h-full font-medium transition-colors
              ${hideTrigger ? 'rounded-md border border-gray-300' : 'rounded-r-md border-l border-white/20'}
              ${buttonDisabled
                ? 'bg-gray-100 text-gray-400 cursor-not-allowed'
                : testResult
                  ? testResult.status === 'passed'
                    ? 'bg-green-600 text-white hover:bg-green-700'
                    : 'bg-red-600 text-white hover:bg-red-700'
                  : 'bg-gray-200 text-gray-700 hover:bg-gray-300'
              }`}
            disabled={buttonDisabled}
          >
            {isLoading ? (
              <svg className="animate-spin w-4 h-4" viewBox="0 0 24 24">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" />
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
              </svg>
            ) : testResult ? (
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} 
                  d={testResult.status === 'passed'
                    ? "M5 13l4 4L19 7"
                    : "M6 18L18 6M6 6l12 12"} />
              </svg>
            ) : null}
            {testResult && (
              <svg className="w-5 h-5 ml-1" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
              </svg>
            )}
          </Menu.Button>

          {(testResult || isLoading) && isOpen && (
            isMobile ? (
              // Modal dialog for mobile
              <div className="fixed inset-0 bg-black bg-opacity-50 z-[100]">
                <div className="fixed inset-4 bg-white rounded-lg overflow-auto">
                  {renderContent()}
                </div>
              </div>
            ) : (
              // Dropdown for desktop
              <div 
                ref={dropdownRef}
                className="absolute mt-2 w-[calc(100vw-2rem)] sm:w-[600px] max-w-[600px] max-h-[80vh] overflow-y-auto origin-top-right bg-white rounded-md shadow-lg ring-1 ring-black ring-opacity-5 focus:outline-none z-50"
              >
                {renderContent()}
              </div>
            )
          )}
        </Menu>
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
    </div>
  );
});

ModelTester.displayName = 'ModelTester';

export default ModelTester;