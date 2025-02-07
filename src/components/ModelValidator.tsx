import React, { useState } from 'react';
import { useHyphaStore } from '../store/hyphaStore';
import ReactMarkdown from 'react-markdown';
import { Menu } from '@headlessui/react';
import yaml from 'js-yaml';
interface ValidationResult {
  success: boolean;
  details: string;
}

interface ModelValidatorProps {
  rdfContent?: string;
  isDisabled?: boolean;
  className?: string;
  onValidationComplete?: (result: ValidationResult) => void;
}

const ModelValidator: React.FC<ModelValidatorProps> = ({ 
  rdfContent, 
  isDisabled, 
  className = '',
  onValidationComplete 
}) => {
  const { server, isLoggedIn } = useHyphaStore();
  const [validationResult, setValidationResult] = useState<ValidationResult | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [isMenuOpen, setIsMenuOpen] = useState(false);

  const handleValidate = async () => {
    if (!rdfContent || !server) return;

    setIsLoading(true);
    setIsMenuOpen(false);
    
    try {
      const runner = await server.getService('bioimage-io/bioimageio-model-runner', {mode: "last"});
      const rdfDict = yaml.load(rdfContent);
      const result = await runner.validate(rdfDict);
      
      setValidationResult(result);
      setIsMenuOpen(true);
      onValidationComplete?.(result);
    } catch (err) {
      const errorResult = {
        success: false,
        details: err instanceof Error ? err.message : 'Validation failed due to an unknown error'
      };
      setValidationResult(errorResult);
      setIsMenuOpen(true);
      onValidationComplete?.(errorResult);
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className={`relative ${className}`}>
      <div className="flex h-[40px]">
        <button
          onClick={handleValidate}
          disabled={isDisabled || isLoading || !isLoggedIn}
          className={`inline-flex items-center gap-2 px-4 h-full rounded-l-md font-medium transition-colors
            ${isDisabled || !isLoggedIn
              ? 'bg-gray-100 text-gray-400 cursor-not-allowed'
              : 'bg-blue-600 text-white hover:bg-blue-700'
            }`}
        >
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} 
              d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" />
          </svg>
          <span>{!isLoggedIn ? 'Login to Validate' : 'Validate'}</span>
        </button>

        <Menu as="div" className="relative h-full">
          <Menu.Button
            onClick={() => validationResult && setIsMenuOpen(!isMenuOpen)}
            className={`inline-flex items-center px-2 h-full rounded-r-md font-medium transition-colors border-l border-white/20
              ${isDisabled || !isLoggedIn
                ? 'bg-gray-100 text-gray-400 cursor-not-allowed'
                : isLoading
                  ? 'bg-blue-600 text-white'
                  : validationResult
                    ? validationResult.success
                      ? 'bg-green-600 text-white hover:bg-green-700'
                      : 'bg-red-600 text-white hover:bg-red-700'
                    : 'bg-blue-600 text-white hover:bg-blue-700'
              }`}
            disabled={isDisabled || !isLoggedIn}
          >
            {isLoading ? (
              <svg className="animate-spin w-4 h-4" viewBox="0 0 24 24">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" />
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
              </svg>
            ) : validationResult ? (
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} 
                  d={validationResult.success
                    ? "M5 13l4 4L19 7"
                    : "M6 18L18 6M6 6l12 12"} />
              </svg>
            ) : (
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} 
                  d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" />
              </svg>
            )}
            {validationResult && (
              <svg className="w-5 h-5 ml-1" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
              </svg>
            )}
          </Menu.Button>

          {validationResult && isMenuOpen && (
            <Menu.Items
              static
              className="absolute right-0 mt-2 w-[600px] max-h-[80vh] overflow-y-auto origin-top-right bg-white rounded-md shadow-lg ring-1 ring-black ring-opacity-5 focus:outline-none z-50"
            >
              <div className="p-6 relative">
                <button
                  onClick={() => setIsMenuOpen(false)}
                  className="absolute top-2 right-2 text-gray-400 hover:text-gray-600"
                >
                  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>
                <ReactMarkdown className="prose prose-sm max-w-none">
                  {`# Validation Results\n\n${validationResult.details}`}
                </ReactMarkdown>
              </div>
            </Menu.Items>
          )}
        </Menu>
      </div>
    </div>
  );
};

export default ModelValidator; 