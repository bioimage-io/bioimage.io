import React, { useState, useRef, useEffect } from 'react';
import { useHyphaStore } from '../store/hyphaStore';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { Menu } from '@headlessui/react';

interface TestResult {
  name: string;
  status: 'passed' | 'failed';
  type?: string;
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
  modelUrl?: string;
  isStaged?: boolean;
  isDisabled?: boolean;
  className?: string;
  skipCache?: boolean;
}

const ModelTester: React.FC<ModelTesterProps> = ({ artifactId, modelUrl, isStaged, isDisabled, skipCache=false, className = '' }) => {
  const { server, isLoggedIn } = useHyphaStore();
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

  // Update the effect for dropdown positioning
  useEffect(() => {
    if (isOpen && dropdownRef.current && buttonRef.current) {
      const dropdown = dropdownRef.current;
      const button = buttonRef.current;
      const dropdownRect = dropdown.getBoundingClientRect();
      const buttonRect = button.getBoundingClientRect();
      
      // Check if dropdown would go outside the left edge of viewport
      const spaceOnLeft = buttonRect.left;
      
      // Reset any previous positioning
      dropdown.style.right = '';
      dropdown.style.left = '';
      
      if (spaceOnLeft < dropdownRect.width) {
        // Position to the right if there's not enough space on the left
        dropdown.style.left = '0px';
      } else {
        // Default position to the right edge of the button, appearing on the left side
        dropdown.style.right = '0px';
      }
    }
  }, [isOpen, testResult]);

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
      // const runner = await server.getService('bioimage-io/bioimageio-model-runner', {mode: "last"});
      const runner = await server.getService('bioimage-io/model-runner', {mode: "select:min:get_load"});
      const modelId = artifactId.split('/').pop();
      
      setLoadingStep('Downloading and preparing model for testing...');
      console.log(`Testing model ${modelId} at ${modelUrl}`);
      const startTime = performance.now();
      const result = await runner.test({model_id:modelId, stage: isStaged, skip_cache: skipCache, _rkwargs: true});
      const endTime = performance.now();
      const executionTime = (endTime - startTime) / 1000; // Convert to seconds
      console.log(`Test execution time: ${executionTime.toFixed(2)}s`);
      console.log("Test result:", result);
      setTestResult(result);
    } catch (err) {
      console.error('Test run failed:', err);
      setTestResult({
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
      });
    } finally {
      setLoadingStep('');
      setIsLoading(false);
    }
  };

  const getMarkdownContent = () => {
    if (isLoading) {
      return `### Running Model Tests...

⏳ ${loadingStep}

Please note that model testing may take 30s or more as we need to:
1. Download the model files
2. Initialize the testing environment
3. Run the model with test data

Testing infrastructure is provided by BioEngine.

Please keep this window open while the test is running.`;
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

  return (
    <div className={`relative ${className}`}>
      <div className="flex h-[40px]" ref={buttonRef}>
        <button
          onClick={runTest}
          disabled={isDisabled || isLoading || !isLoggedIn}
          className={`inline-flex items-center gap-2 px-4 h-full rounded-l-md font-medium transition-colors
            ${isDisabled || !isLoggedIn
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
          <span className="hidden sm:inline">{!isLoggedIn ? 'Login to Test' : 'Test Model'}</span>
        </button>

        <Menu as="div" className="relative h-full">
          <Menu.Button
            onClick={() => setIsOpen(!isOpen)}
            className={`inline-flex items-center px-2 h-full rounded-r-md font-medium transition-colors border-l
              ${isDisabled || !isLoggedIn
                ? 'bg-gray-100 text-gray-400 cursor-not-allowed'
                : isLoading
                  ? 'bg-blue-600 text-white'
                  : testResult
                    ? testResult.status === 'passed'
                      ? 'bg-green-600 text-white hover:bg-green-700'
                      : 'bg-red-600 text-white hover:bg-red-700'
                    : 'bg-gray-50 text-gray-700 hover:bg-gray-100 border border-gray-300'
              }`}
            disabled={isDisabled || !isLoggedIn}
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
            ) : (
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} 
                  d="M14.752 11.168l-3.197-2.132A1 1 0 0010 9.87v4.263a1 1 0 001.555.832l3.197-2.132a1 1 0 000-1.664z" />
              </svg>
            )}
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
    </div>
  );
};

export default ModelTester; 