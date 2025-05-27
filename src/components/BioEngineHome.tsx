import React, { useEffect, useState, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { useHyphaStore } from '../store/hyphaStore';
import BioEngineGuide from './BioEngineGuide';

type BioEngineService = {
  id: string;
  name: string;
  description: string;
  service?: any;
};

// ServiceCard component for fancy instance cards
const ServiceCard: React.FC<{
  service: BioEngineService;
  onNavigate: (serviceId: string) => void;
}> = ({ service, onNavigate }) => {
  const [copied, setCopied] = useState(false);

  const copyServiceId = async () => {
    try {
      await navigator.clipboard.writeText(service.id);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch (err) {
      console.error('Failed to copy:', err);
    }
  };

  return (
    <div className="bg-white/80 backdrop-blur-sm rounded-2xl shadow-sm border border-white/20 flex flex-col h-full hover:shadow-md transition-all duration-200 hover:border-blue-200">
      <div className="p-6 flex-grow">
        <div className="flex items-center mb-4">
          <div className="w-10 h-10 bg-white rounded-xl flex items-center justify-center mr-3 p-1">
            <img src="/bioengine-icon.svg" alt="BioEngine" className="w-8 h-8" />
          </div>
          <div className="flex-1">
            <h3 className="text-xl font-semibold text-gray-800">{service.name}</h3>
          </div>
        </div>
        
        <p className="text-gray-600 mb-4 leading-relaxed">{service.description || 'No description available'}</p>
        
        {/* Copyable Service ID */}
        <div className="mb-4">
          <label className="block text-sm font-medium text-gray-700 mb-2">Service ID</label>
          <div className="relative">
            <code className="block w-full px-3 py-2 bg-gray-900 text-green-400 text-sm font-mono rounded-lg border border-gray-300 pr-10 break-all">
              {service.id}
            </code>
            <button
              onClick={copyServiceId}
              className="absolute right-2 top-1/2 transform -translate-y-1/2 p-1 text-gray-400 hover:text-green-400 transition-colors duration-200"
              title="Copy service ID"
            >
              {copied ? (
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                </svg>
              ) : (
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
                </svg>
              )}
            </button>
          </div>
        </div>
      </div>
      
      <div className="p-6 pt-0">
        <button 
          onClick={() => onNavigate(service.id)}
          className="w-full px-6 py-3 bg-gradient-to-r from-blue-600 to-blue-700 text-white rounded-xl hover:from-blue-700 hover:to-blue-800 shadow-sm hover:shadow-md transition-all duration-200 font-medium"
        >
          View Dashboard
        </button>
      </div>
    </div>
  );
};

const BioEngineHome: React.FC = () => {
  const navigate = useNavigate();
  const { server, isLoggedIn } = useHyphaStore();
  
  const [bioEngineServices, setBioEngineServices] = useState<BioEngineService[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showContent, setShowContent] = useState(false);
  const [customServiceId, setCustomServiceId] = useState('');
  const [tokenDialogOpen, setTokenDialogOpen] = useState(false);
  const [customToken, setCustomToken] = useState('');
  const [connectionLoading, setConnectionLoading] = useState(false);
  const [connectionError, setConnectionError] = useState<string | null>(null);
  const [loginErrorTimeout, setLoginErrorTimeout] = useState<NodeJS.Timeout | null>(null);
  const [defaultServiceOnline, setDefaultServiceOnline] = useState<boolean | null>(null);
  const [initialized, setInitialized] = useState(false);

  // Function to check if default service is online
  const checkDefaultServiceStatus = async () => {
    try {
      const response = await fetch('https://hypha.aicell.io/bioimage-io/services/bioengine-worker/get_status?_mode=first');
      if (response.ok) {
        setDefaultServiceOnline(true);
      } else {
        setDefaultServiceOnline(false);
      }
    } catch (err) {
      console.warn('Default BioEngine service is offline:', err);
      setDefaultServiceOnline(false);
    }
  };

  const fetchBioEngineServices = useCallback(async () => {
    if (!isLoggedIn) return;

    try {
      setLoading(true);
      const services = await server.listServices({"type": "bioengine-worker"});
      
      const defaultService: BioEngineService = {
        id: "bioimage-io/bioengine-worker",
        name: "BioImage.IO BioEngine Worker",
        description: "Default BioEngine worker instance for the BioImage.IO community"
      };
      
      const hasDefaultService = services.some((service: BioEngineService) => service.id === defaultService.id);
      
      // Only include default service if it's online and not already in the list
      let allServices = [...services];
      if (!hasDefaultService && defaultServiceOnline === true) {
        allServices = [defaultService, ...services];
      }
      
      setBioEngineServices(allServices);
      setLoading(false);
      setError(null);
    } catch (err) {
      setError(`Failed to fetch BioEngine instances: ${err instanceof Error ? err.message : String(err)}`);
      setLoading(false);
    }
  }, [isLoggedIn, server, defaultServiceOnline]);

  // Single initialization effect
  useEffect(() => {
    let mounted = true;
    
    const initialize = async () => {
      // Small delay to prevent initial flash
      await new Promise(resolve => setTimeout(resolve, 100));
      
      if (!mounted) return;
      
      // Show content after brief delay
      setShowContent(true);
      
      // Check default service status first
      await checkDefaultServiceStatus();
      
      if (!mounted) return;
      
      // Clear any existing timeout
      if (loginErrorTimeout) {
        clearTimeout(loginErrorTimeout);
        setLoginErrorTimeout(null);
      }

      if (!isLoggedIn) {
        // Set a delay before showing the login error to allow time for login process
        const timeout = setTimeout(() => {
          if (mounted && !isLoggedIn) {  
            setError('Please log in to view BioEngine instances');
            setLoading(false);
            setInitialized(true);
          }
        }, 3000); // 3 second delay
        
        setLoginErrorTimeout(timeout);
      } else {
        // User is logged in - clear any existing error and fetch services
        setError(null);
        await fetchBioEngineServices();
        if (mounted) {
          setInitialized(true);
        }
      }
    };

    initialize();

    return () => {
      mounted = false;
      if (loginErrorTimeout) {
        clearTimeout(loginErrorTimeout);
      }
    };
  }, [fetchBioEngineServices]);

  // Handle login state changes after initialization
  useEffect(() => {
    if (!initialized) return;
    
    let mounted = true;
    
    const handleLoginChange = async () => {
      // Clear any existing timeout
      if (loginErrorTimeout) {
        clearTimeout(loginErrorTimeout);
        setLoginErrorTimeout(null);
      }

      if (!isLoggedIn) {
        // Set a delay before showing the login error
        const timeout = setTimeout(() => {
          if (mounted && !isLoggedIn) {  
            setError('Please log in to view BioEngine instances');
            setLoading(false);
          }
        }, 1000); // Shorter delay for subsequent changes
        
        setLoginErrorTimeout(timeout);
      } else {
        // User is logged in - clear any existing error and fetch services
        setError(null);
        setLoading(true);
        await fetchBioEngineServices();
      }
    };

    handleLoginChange();

    return () => {
      mounted = false;
      if (loginErrorTimeout) {
        clearTimeout(loginErrorTimeout);
      }
    };
  }, [isLoggedIn, initialized]);

  const navigateToDashboard = (serviceId: string) => {
    navigate(`/bioengine/worker?service_id=${serviceId}`);
  };
  
  const handleCustomServiceIdSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!customServiceId.trim()) return;

    console.log(`Connecting to custom BioEngine service: '${customServiceId}'`);
    
    setConnectionLoading(true);
    setConnectionError(null);
    
    try {
      await server.getService(customServiceId);
      navigateToDashboard(customServiceId);
    } catch (err) {
      const errorMessage = String(err);
      if (errorMessage.includes('denied') || errorMessage.includes('unauthorized') || errorMessage.includes('permission')) {
        setTokenDialogOpen(true);
      } else {
        setConnectionError(`Could not connect: ${errorMessage}`);
      }
    } finally {
      setConnectionLoading(false);
    }
  };
  
  const handleTokenSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!customToken.trim()) return;
    
    setConnectionLoading(true);
    
    try {
      await server.getService(customServiceId, { token: customToken });
      setTokenDialogOpen(false);
      navigateToDashboard(customServiceId);
    } catch (err) {
      setConnectionError(`Invalid token: ${String(err)}`);
    } finally {
      setConnectionLoading(false);
    }
  };
  
  const handleTokenDialogClose = () => {
    setTokenDialogOpen(false);
    setCustomToken('');
    setConnectionError(null);
  };

  if (!showContent || loading) {
    return (
      <div className="flex justify-center items-center h-96">
        <div className="flex flex-col items-center">
          <img 
            src="/img/bioengine-logo-black.svg" 
            alt="BioEngine Loading" 
            className="w-48 h-auto opacity-60 animate-pulse"
          />
          <p className="text-gray-500 text-sm mt-4 animate-pulse">Loading BioEngine...</p>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex justify-center items-center h-96">
        <div className="text-red-500 text-center">
          <p className="text-xl font-semibold mb-2">Error</p>
          <p>{error}</p>
        </div>
      </div>
    );
  }

  return (
    <div className="container mx-auto px-4 py-8">
      {/* Fancy Header */}
      <div className="text-center mb-12">
        <h1 className="text-5xl font-bold bg-gradient-to-r from-blue-600 via-purple-600 to-cyan-600 bg-clip-text text-transparent mb-4 leading-tight">
          BioEngine
        </h1>
        <p className="text-xl text-gray-600 font-medium">
          Unveiling cloud-powered AI for simplified Bioimage Analysis
        </p>
        <div className="w-24 h-1 bg-gradient-to-r from-blue-500 to-purple-500 mx-auto mt-4 rounded-full"></div>
      </div>
      
      {/* Custom Service ID Input */}
      <div className="max-w-6xl mx-auto mb-8">
        <div className="bg-white/80 backdrop-blur-sm rounded-2xl shadow-sm border border-white/20 p-6 hover:shadow-md transition-all duration-200">
          <div className="flex items-center mb-4">
            <div className="w-10 h-10 bg-white rounded-xl flex items-center justify-center mr-3 p-1">
              <img src="/bioengine-icon.svg" alt="BioEngine" className="w-8 h-8" />
            </div>
            <div>
              <h3 className="text-lg font-semibold text-gray-800">Connect to BioEngine Worker</h3>
              <p className="text-sm text-gray-600">Enter a service ID to connect to an existing BioEngine worker</p>
            </div>
          </div>
          
          <form onSubmit={handleCustomServiceIdSubmit}>
            <div className="relative flex items-center">
              <input
                type="text"
                placeholder="Enter BioEngine Worker Service ID (e.g., workspace/service-name)"
                value={customServiceId}
                onChange={(e) => setCustomServiceId(e.target.value)}
                disabled={connectionLoading}
                className={`w-full px-4 py-3 border-2 rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500 transition-all duration-200 ${
                  connectionError ? 'border-red-300 bg-red-50' : 'border-gray-200 bg-white'
                } ${connectionLoading ? 'bg-gray-100' : ''}`}
              />
              <button 
                type="submit" 
                disabled={!customServiceId.trim() || connectionLoading}
                className="absolute right-2 px-6 py-2 bg-gradient-to-r from-blue-600 to-blue-700 text-white rounded-lg hover:from-blue-700 hover:to-blue-800 disabled:from-gray-400 disabled:to-gray-500 disabled:cursor-not-allowed flex items-center justify-center min-w-[100px] shadow-sm hover:shadow-md transition-all duration-200"
              >
                {connectionLoading ? (
                  <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin"></div>
                ) : (
                  "Connect"
                )}
              </button>
            </div>
            {connectionError && (
              <div className="mt-3 p-3 bg-red-50 border border-red-200 rounded-lg">
                <p className="text-red-600 text-sm flex items-center">
                  <svg className="w-4 h-4 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                  </svg>
                  {connectionError}
                </p>
              </div>
            )}
          </form>
          
          {/* BioEngine Guide - Compact Version */}
          <BioEngineGuide />
        </div>
      </div>
      
      {bioEngineServices.length === 0 ? (
        <div className="flex flex-col items-center justify-center h-64 text-gray-500">
          <p className="mb-4">No BioEngine instances available in workspace '{server.config.workspace}'</p>
          {defaultServiceOnline === false && (
            <p className="text-sm text-gray-400">
              Note: Default BioEngine service is currently offline
            </p>
          )}
          {defaultServiceOnline === null && (
            <p className="text-sm text-gray-400">
              Checking default BioEngine service status...
            </p>
          )}
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {bioEngineServices.map((service) => (
            <ServiceCard key={service.id} service={service} onNavigate={navigateToDashboard} />
          ))}
        </div>
      )}
      
      {/* Token Dialog */}
      {tokenDialogOpen && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-50 animate-fadeIn">
          <div className="bg-white/95 backdrop-blur-md rounded-2xl shadow-lg max-w-md w-full mx-4 border border-white/20 animate-slideUp">
            <div className="p-6 border-b border-gray-200/50">
              <div className="flex items-center">
                <div className="w-10 h-10 bg-gradient-to-r from-amber-500 to-orange-500 rounded-xl flex items-center justify-center mr-3">
                  <svg className="w-5 h-5 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
                  </svg>
                </div>
                <h3 className="text-lg font-semibold text-gray-800">Authentication Required</h3>
              </div>
            </div>
            <form onSubmit={handleTokenSubmit}>
              <div className="p-6">
                <p className="text-gray-600 mb-4">
                  Access to this BioEngine service requires authentication. Please enter a token:
                </p>
                <input
                  type="password"
                  placeholder="Token"
                  value={customToken}
                  onChange={(e) => setCustomToken(e.target.value)}
                  disabled={connectionLoading}
                  autoFocus
                  className={`w-full px-3 py-2 border rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 ${
                    connectionError ? 'border-red-500' : 'border-gray-300'
                  } ${connectionLoading ? 'bg-gray-100' : 'bg-white'}`}
                />
                {connectionError && (
                  <p className="text-red-500 text-sm mt-2">{connectionError}</p>
                )}
              </div>
              <div className="p-6 pt-0 border-t border-gray-200/50 flex justify-end space-x-3">
                <button 
                  type="button"
                  onClick={handleTokenDialogClose} 
                  disabled={connectionLoading}
                  className="px-6 py-3 text-gray-600 bg-white border-2 border-gray-200 rounded-xl hover:bg-gray-50 hover:border-gray-300 disabled:opacity-50 shadow-sm hover:shadow-md transition-all duration-200"
                >
                  Cancel
                </button>
                <button 
                  type="submit" 
                  disabled={!customToken.trim() || connectionLoading}
                  className="px-6 py-3 bg-gradient-to-r from-blue-600 to-blue-700 text-white rounded-xl hover:from-blue-700 hover:to-blue-800 disabled:from-gray-400 disabled:to-gray-500 disabled:cursor-not-allowed flex items-center shadow-sm hover:shadow-md transition-all duration-200"
                >
                  {connectionLoading ? (
                    <div className="w-5 h-5 border-2 border-white border-t-transparent rounded-full animate-spin mr-2"></div>
                  ) : null}
                  Connect
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};

export default BioEngineHome; 