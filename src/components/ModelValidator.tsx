import React, { useState, useEffect, useRef } from 'react';
import { useHyphaStore } from '../store/hyphaStore';
import ReactMarkdown from 'react-markdown';
import { Menu } from '@headlessui/react';
import yaml from 'js-yaml';

interface ValidationResult {
  success: boolean;
  details: string;
}

// Define an interface for the expected RDF structure
interface RdfWithUploader {
  uploader?: { [key: string]: any; email?: string };
  [key: string]: any; // Allow other properties
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
  const { server, isLoggedIn, user } = useHyphaStore();
  const [validationResult, setValidationResult] = useState<ValidationResult | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [isMenuOpen, setIsMenuOpen] = useState(false);
  const [isMobile, setIsMobile] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(event.target as Node)) {
        setIsMenuOpen(false);
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, []);

  useEffect(() => {
    const checkMobile = () => {
      setIsMobile(window.innerWidth < 1024);
    };
    
    checkMobile();
    window.addEventListener('resize', checkMobile);
    return () => window.removeEventListener('resize', checkMobile);
  }, []);

  const handleValidate = async () => {
    if (!rdfContent || !server || !user?.email) return;

    setIsLoading(true);
    setIsMenuOpen(false);
    
    try {
      // const runner = await server.getService('bioimage-io/bioimageio-model-runner', {mode: "last"});
      const bioengine = await server.getService('bioimage-io/bioengine-apps', {mode: "last"});
      const runner = bioengine.bioimage_io_model_runner;
      // Parse the RDF content and assert its type
      let rdfDict = yaml.load(rdfContent) as RdfWithUploader | null;
      
      // Ensure rdfDict is an object before modifying
      if (typeof rdfDict === 'object' && rdfDict !== null) {
        // Automatically set the uploader email
        rdfDict.uploader = {
          ...(rdfDict.uploader || {}), // Preserve existing uploader fields if any
          email: user.email 
        };
      } else {
        // Handle cases where rdfContent might not parse to an object
        console.warn("RDF content did not parse to an object or is null, cannot set uploader email.");
        // Set a default error or throw, depending on desired behavior
        const errorResult = {
          success: false,
          details: 'Invalid RDF format: Could not parse content.'
        };
        setValidationResult(errorResult);
        setIsMenuOpen(true);
        onValidationComplete?.(errorResult);
        setIsLoading(false);
        return; // Stop validation if RDF is invalid
      }

      const result = await runner.validate({rdf_dict: rdfDict, _rkwargs: true}); // Pass the modified dictionary
      console.log("Validation result:", result);
      
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

  const renderContent = () => (
    <div className="p-6 relative">
      <button
        onClick={() => setIsMenuOpen(false)}
        className="absolute top-2 right-2 text-gray-400 hover:text-gray-600"
        title="Close validation results"
      >
        <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
        </svg>
      </button>
      {validationResult && (
        <ReactMarkdown 
          className="prose prose-sm max-w-none"
        >
          {`# ${validationResult.success ? '✅ Validation Passed' : '❌ Validation Failed'}\n\n## Details\n\n${validationResult.details}`}
        </ReactMarkdown>
      )}
    </div>
  );

  return (
    <div className={`relative ${className}`}>
      <div className="flex h-[40px]">
        <button
          onClick={handleValidate}
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
          <span className="hidden sm:inline">{!isLoggedIn ? 'Login to Validate' : 'Validate'}</span>
        </button>

        <Menu as="div" className="relative h-full">
          <Menu.Button
            onClick={() => validationResult && setIsMenuOpen(!isMenuOpen)}
            className={`inline-flex items-center px-2 h-full rounded-r-md font-medium transition-colors border-l border-white/20
              ${isDisabled || !isLoggedIn
                ? 'bg-gray-100 text-gray-400 cursor-not-allowed'
                : validationResult
                  ? validationResult.success
                    ? 'bg-green-600 text-white hover:bg-green-700'
                    : 'bg-red-600 text-white hover:bg-red-700'
                  : 'bg-gray-200 text-gray-700 hover:bg-gray-300'
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
                  d="M14.752 11.168l-3.197-2.132A1 1 0 0010 9.87v4.263a1 1 0 001.555.832l3.197-2.132a1 1 0 000-1.664z" />
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                  d="M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
            )}
            {validationResult && (
              <svg className="w-5 h-5 ml-1" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
              </svg>
            )}
          </Menu.Button>

          {validationResult && isMenuOpen && (
            isMobile ? (
              <div className="fixed inset-0 bg-black bg-opacity-50 z-[100]">
                <div ref={menuRef} className="fixed inset-4 bg-white rounded-lg overflow-auto">
                  {renderContent()}
                </div>
              </div>
            ) : (
              <Menu.Items
                static
                ref={menuRef}
                className="absolute right-0 mt-2 w-[calc(100vw-2rem)] sm:w-[600px] max-w-[600px] max-h-[80vh] overflow-y-auto origin-top-right bg-white rounded-md shadow-lg ring-1 ring-black ring-opacity-5 focus:outline-none z-[100]"
              >
                {renderContent()}
              </Menu.Items>
            )
          )}
        </Menu>
      </div>
    </div>
  );
};

export default ModelValidator; 