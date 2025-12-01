import React, { useEffect, useState, useCallback, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { useHyphaStore } from '../../store/hyphaStore';
import BioEngineGuide from './BioEngineGuide';

type BioEngineService = {
  id: string;
  name: string;
  description: string;
  service?: any;
};

// Helper function to compare arrays
const arraysEqual = (a: string[], b: string[]): boolean => {
  if (a.length !== b.length) return false;
  return a.every((val, index) => val === b[index]);
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
  const servicesRef = useRef<HTMLDivElement>(null);

  const [bioEngineServices, setBioEngineServices] = useState<BioEngineService[]>([]);
  const [servicesLoading, setServicesLoading] = useState(false);
  const [servicesError, setServicesError] = useState<string | null>(null);
  const [customServiceId, setCustomServiceId] = useState('');
  const [tokenDialogOpen, setTokenDialogOpen] = useState(false);
  const [customToken, setCustomToken] = useState('');
  const [connectionLoading, setConnectionLoading] = useState(false);
  const [connectionError, setConnectionError] = useState<string | null>(null);
  const [defaultServiceOnline, setDefaultServiceOnline] = useState<boolean | null>(null);
  const [manualRefreshLoading, setManualRefreshLoading] = useState(false);

  const fetchBioEngineServices = useCallback(async (isManualRefresh = false) => {
    if (!isLoggedIn) {
      setServicesLoading(!isManualRefresh);
      setServicesError('Please log in to view your BioEngine instances');
      return;
    }

    try {
      if (isManualRefresh) {
        setManualRefreshLoading(true);
      } else {
        // Only show loading if we don't have any services yet
        if (bioEngineServices.length === 0) {
          setServicesLoading(true);
        }
      }
      setServicesError(null);
      
      // Get the list of services from the workspace
      const services = await server.listServices({ "type": "bioengine-worker" });

      const defaultService: BioEngineService = {
        id: "bioimage-io/bioengine-worker",
        name: "BioImage.IO BioEngine Worker",
        description: "Default BioEngine worker instance for the BioImage.IO community"
      };

      const hasDefaultService = services.some((service: BioEngineService) => service.id === defaultService.id);

      let allServices = [...services];
      let isDefaultOnline = false;

      // If default service is not in the workspace list, try to access it directly
      if (!hasDefaultService) {
        try {
          await server.getService("bioimage-io/bioengine-worker", { mode: "first"});
          allServices = [defaultService, ...services];
          isDefaultOnline = true;
          console.log('Default BioEngine service is online and added to list');
        } catch (err) {
          // Default service is not accessible, don't add it
          console.log('Default BioEngine service is not accessible:', err instanceof Error ? err.message : String(err));
          isDefaultOnline = false;
        }
      } else {
        isDefaultOnline = true; // It's in the workspace list
      }

      // Compare with current services list to see if anything changed
      const servicesChanged = !arraysEqual(
        allServices.map(s => s.id).sort(),
        bioEngineServices.map(s => s.id).sort()
      );

      const defaultStatusChanged = isDefaultOnline !== defaultServiceOnline;

      // Only update state if something actually changed
      if (servicesChanged || defaultStatusChanged) {
        setDefaultServiceOnline(isDefaultOnline);
        setBioEngineServices(allServices);
        
        // Check if we found new services and scroll to them
        const foundNewServices = allServices.length > bioEngineServices.length;
        if (foundNewServices && allServices.length > 0 && servicesRef.current) {
          setTimeout(() => {
            servicesRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
          }, 100);
        }
      }

      if (isManualRefresh) {
        setManualRefreshLoading(false);
      } else {
        setServicesLoading(false);
      }
    } catch (err) {
      setServicesError(`Failed to fetch BioEngine instances: ${err instanceof Error ? err.message : String(err)}`);
      if (isManualRefresh) {
        setManualRefreshLoading(false);
      } else {
        setServicesLoading(false);
      }
    }
  }, [isLoggedIn, server, bioEngineServices, defaultServiceOnline, servicesRef]);

  // Initialize services on mount
  useEffect(() => {
    if (isLoggedIn) {
      fetchBioEngineServices();
    }
  }, [isLoggedIn, fetchBioEngineServices]);

  // Fetch services when login state changes (avoid duplicate with initial effect)
  useEffect(() => {
    if (!isLoggedIn) {
      // Reset services state when logged out
      setBioEngineServices([]);
      setServicesLoading(false);
      setServicesError('Please log in to view your BioEngine instances');
      setDefaultServiceOnline(null);
    }
  }, [isLoggedIn]);

  // Auto-refresh services every 5 seconds
  useEffect(() => {
    if (!isLoggedIn) return;

    const interval = setInterval(() => {
      fetchBioEngineServices();
    }, 5000); // 5 seconds

    return () => clearInterval(interval);
  }, [isLoggedIn, fetchBioEngineServices]);

  // Manual refresh handler
  const handleManualRefresh = () => {
    fetchBioEngineServices(true);
  };

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

  // Services List Component
  const ServicesList = () => {
    if (servicesLoading) {
      return (
        <div className="flex justify-center items-center h-64">
          <div className="flex flex-col items-center">
            <img
              src="/static/img/bioengine-logo-black.svg"
              alt="BioEngine Loading"
              className="w-32 h-auto opacity-60 animate-pulse"
            />
            <p className="text-gray-500 text-sm mt-4 animate-pulse">Loading BioEngine instances...</p>
          </div>
        </div>
      );
    }

    if (servicesError) {
      return (
        <div className="flex justify-center items-center h-64">
          <div className="text-center">
            <div className="w-16 h-16 bg-gradient-to-r from-blue-100 to-purple-100 rounded-xl flex items-center justify-center mx-auto mb-4">
              <svg className="w-8 h-8 text-blue-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
              </svg>
            </div>
            <p className="text-gray-600 font-medium mb-2">Authentication Required</p>
            <p className="text-gray-500 text-sm">{servicesError}</p>
          </div>
        </div>
      );
    }

    if (bioEngineServices.length === 0) {
      return (
        <div className="flex flex-col items-center justify-center h-64 text-gray-500">
          <div className="w-20 h-20 bg-gradient-to-r from-blue-100 to-purple-100 rounded-2xl flex items-center justify-center mb-6">
            <svg className="w-10 h-10 text-blue-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10" />
            </svg>
          </div>
          <p className="text-gray-600 font-medium mb-2 text-center">No BioEngine instances found</p>
          <p className="text-gray-500 text-sm text-center mb-4">No instances available in workspace <span className="font-mono bg-gray-100 px-2 py-1 rounded text-xs">{server.config.workspace || 'current'}</span></p>
          {defaultServiceOnline === false && (
            <p className="text-sm text-gray-400 text-center">
              Note: Default BioEngine service is currently offline
            </p>
          )}
          {defaultServiceOnline === null && (
            <p className="text-sm text-gray-400 text-center">
              Checking default BioEngine service status...
            </p>
          )}
        </div>
      );
    }

    return (
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
        {bioEngineServices.map((service) => (
          <ServiceCard key={service.id} service={service} onNavigate={navigateToDashboard} />
        ))}
      </div>
    );
  };

  return (
            <div className="max-w-[1400px] mx-auto px-4 py-8">
      {/* Fancy Header - Always visible */}
      <div className="text-center mb-12">
        <div className="flex items-end justify-center gap-4 mb-4">
          <img src="/bioengine-icon.svg" alt="BioEngine Logo" className="w-12 h-12 mb-3" />
          <h1 className="text-5xl font-bold bg-gradient-to-r from-blue-600 via-purple-600 to-cyan-600 bg-clip-text text-transparent leading-tight">
            BioEngine
          </h1>
        </div>
        <div className="w-24 h-1 bg-gradient-to-r from-blue-500 to-purple-500 mx-auto mt-4 rounded-full"></div>
        <p className="mt-4 text-xl text-gray-600 font-medium">
          Unveiling cloud-powered AI for simplified Bioimage Analysis
        </p>
        
      </div>

      {/* BioEngine Guide - Always visible */}
      <div className="max-w-6xl mx-auto mb-8">
        <div className="bg-white/80 backdrop-blur-sm rounded-2xl shadow-sm border border-white/20 p-6 hover:shadow-md transition-all duration-200">
          <BioEngineGuide />
        </div>
      </div>

      {/* Services List - Shows login warning when needed */}
      <div className="mb-8" ref={servicesRef}>
        <div className="flex items-center justify-center mb-6">
          <h2 className="text-2xl font-semibold text-gray-800 mr-4">Available BioEngine Instances</h2>
          <button
            onClick={handleManualRefresh}
            disabled={manualRefreshLoading || !isLoggedIn}
            className="px-4 py-2 bg-gradient-to-r from-green-600 to-green-700 text-white rounded-lg hover:from-green-700 hover:to-green-800 disabled:from-gray-400 disabled:to-gray-500 disabled:cursor-not-allowed flex items-center shadow-sm hover:shadow-md transition-all duration-200"
            title="Refresh services list"
          >
            {manualRefreshLoading ? (
              <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin"></div>
            ) : (
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
              </svg>
            )}
            <span className="ml-2 text-sm">Refresh</span>
          </button>
        </div>

        {/* Combined section with Connect and Services List */}
        <div className="max-w-6xl mx-auto">
          <div className={`bg-white/80 backdrop-blur-sm rounded-2xl shadow-sm border border-white/20 p-6 hover:shadow-md transition-all duration-200 ${!isLoggedIn ? 'opacity-60' : ''
            }`}>
            <div className="flex items-center mb-4">
              <div className="w-10 h-10 bg-white rounded-xl flex items-center justify-center mr-3 p-1">
                <img src="/bioengine-icon.svg" alt="BioEngine" className="w-8 h-8" />
              </div>
              <div>
                <h3 className="text-lg font-semibold text-gray-800">Connect to BioEngine Worker</h3>
                <p className="text-sm text-gray-600">Enter a service ID to connect to an existing BioEngine worker</p>
              </div>
            </div>

            {!isLoggedIn && (
              <div className="mb-4 p-3 bg-amber-50 border border-amber-200 rounded-lg">
                <p className="text-amber-600 text-sm flex items-center">
                  <svg className="w-4 h-4 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-2.5L13.732 4c-.77-.833-1.964-.833-2.732 0L3.732 16.5c-.77.833.192 2.5 1.732 2.5z" />
                  </svg>
                  Please log in to connect to BioEngine workers
                </p>
              </div>
            )}

            <form onSubmit={handleCustomServiceIdSubmit}>
              <div className="relative flex items-center">
                <input
                  type="text"
                  placeholder="Enter BioEngine Worker Service ID (e.g., workspace/service-name)"
                  value={customServiceId}
                  onChange={(e) => setCustomServiceId(e.target.value)}
                  disabled={connectionLoading || !isLoggedIn}
                  className={`w-full px-4 py-3 border-2 rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500 transition-all duration-200 ${connectionError ? 'border-red-300 bg-red-50' : 'border-gray-200 bg-white'
                    } ${connectionLoading || !isLoggedIn ? 'bg-gray-100' : ''}`}
                />
                <button
                  type="submit"
                  disabled={!customServiceId.trim() || connectionLoading || !isLoggedIn}
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

            {/* Services List inside the same frame */}
            <div className="mt-8 pt-6 border-t border-gray-200/50">
              <ServicesList />
            </div>
          </div>
        </div>
      </div>

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
                  className={`w-full px-3 py-2 border rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 ${connectionError ? 'border-red-500' : 'border-gray-300'
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