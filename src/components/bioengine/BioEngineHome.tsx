import React, { useEffect, useState, useCallback, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { useHyphaStore } from '../../store/hyphaStore';
import BioEngineGuide from './BioEngineGuide';

const STORAGE_KEY = 'bioengine-observed-workspaces';
const DEFAULT_PUBLIC_WORKSPACE = 'bioimage-io';

type GeoLocation = {
  region?: string;
  country_name?: string;
  country_code?: string;
};

type BioEngineService = {
  id: string;
  name: string;
  description: string;
  geo_location?: GeoLocation;
};

type WorkspaceStatus = 'loading' | 'loaded' | 'error';

// Extract full service IDs from the "Multiple services found" error message
const parseMultipleServicesFromError = (errStr: string): string[] => {
  const regex = /services:public\|bioengine-worker:([^@']+)@\*/g;
  const ids: string[] = [];
  let match;
  while ((match = regex.exec(errStr)) !== null) {
    if (!ids.includes(match[1])) ids.push(match[1]);
  }
  return ids;
};

const FEATURED_SERVICE_NAME = 'BioImage.IO BioEngine Worker';

const ServiceCard: React.FC<{
  service: BioEngineService;
  onNavigate: (serviceId: string) => void;
  featured?: boolean;
}> = ({ service, onNavigate, featured }) => {
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
    <div className={`backdrop-blur-sm rounded-2xl flex flex-col h-full transition-all duration-200 ${
      featured
        ? 'bg-gradient-to-br from-blue-50 to-purple-50 border-2 border-blue-300 shadow-md hover:shadow-lg hover:border-blue-400'
        : 'bg-white/80 border border-white/20 shadow-sm hover:shadow-md hover:border-blue-200'
    }`}>
      <div className="p-6 flex-grow">
        <div className="flex items-center mb-4">
          <div className={`w-10 h-10 rounded-xl flex items-center justify-center mr-3 p-1 ${featured ? 'bg-white shadow-sm' : 'bg-white'}`}>
            <img src="/bioengine-icon.svg" alt="BioEngine" className="w-8 h-8" />
          </div>
          <div className="flex-1">
            <h3 className="text-xl font-semibold text-gray-800">{service.name}</h3>
            {featured && (
              <span className="inline-flex items-center mt-1 px-2 py-0.5 bg-blue-100 text-blue-700 text-xs font-medium rounded-full">
                ⚡ Powers this website
              </span>
            )}
          </div>
        </div>

        <p className="text-gray-600 mb-4 leading-relaxed">{service.description || 'No description available'}</p>

        {service.geo_location && (
          <div className="mb-3 flex items-center gap-1.5 text-sm text-gray-500">
            <svg className="w-4 h-4 flex-shrink-0 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17.657 16.657L13.414 20.9a1.998 1.998 0 01-2.827 0l-4.244-4.243a8 8 0 1111.314 0z" />
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 11a3 3 0 11-6 0 3 3 0 016 0z" />
            </svg>
            <span>
              {[service.geo_location.region, service.geo_location.country_name]
                .filter(Boolean).join(', ')}
            </span>
          </div>
        )}

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

  // Custom workspaces persisted in localStorage (default workspaces not stored here)
  const [customWorkspaces, setCustomWorkspaces] = useState<string[]>(() => {
    try {
      const stored = localStorage.getItem(STORAGE_KEY);
      return stored ? JSON.parse(stored) : [];
    } catch { return []; }
  });
  const [workspaceInput, setWorkspaceInput] = useState('');
  const [workspaceServices, setWorkspaceServices] = useState<Record<string, BioEngineService[]>>({});
  const [workspaceStatus, setWorkspaceStatus] = useState<Record<string, WorkspaceStatus>>({});
  const [manualRefreshLoading, setManualRefreshLoading] = useState(false);

  const userWorkspace = server?.config?.workspace as string | undefined;

  // Default workspaces: always bioimage-io, plus logged-in user's workspace
  const defaultWorkspaces = useMemo(() => {
    const ws = [DEFAULT_PUBLIC_WORKSPACE];
    if (isLoggedIn && userWorkspace && userWorkspace !== DEFAULT_PUBLIC_WORKSPACE) {
      ws.push(userWorkspace);
    }
    return ws;
  }, [isLoggedIn, userWorkspace]);

  // All observed workspaces = defaults + custom (deduped)
  const observedWorkspaces = useMemo(() => {
    const all = [...defaultWorkspaces];
    for (const ws of customWorkspaces) {
      if (!all.includes(ws)) all.push(ws);
    }
    return all;
  }, [defaultWorkspaces, customWorkspaces]);

  // Persist custom workspaces to localStorage on change
  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(customWorkspaces));
  }, [customWorkspaces]);

  const addWorkspace = () => {
    const trimmed = workspaceInput.trim();
    if (!trimmed || observedWorkspaces.includes(trimmed)) return;
    setCustomWorkspaces(prev => [...prev, trimmed]);
    setWorkspaceInput('');
  };

  const removeWorkspace = (ws: string) => {
    setCustomWorkspaces(prev => prev.filter(w => w !== ws));
    setWorkspaceServices(prev => { const next = { ...prev }; delete next[ws]; return next; });
    setWorkspaceStatus(prev => { const next = { ...prev }; delete next[ws]; return next; });
  };

  // Fetch services for a single workspace
  const fetchWorkspaceServices = useCallback(async (workspace: string) => {
    if (!server) return;

    setWorkspaceStatus(prev => ({ ...prev, [workspace]: 'loading' }));

    try {
      let services: BioEngineService[] = [];

      if (isLoggedIn && workspace === userWorkspace) {
        // Own workspace: enumerate all bioengine-worker services
        const list = await server.listServices({ type: 'bioengine-worker' });
        services = list.map((s: any) => ({
          id: s.id,
          name: s.name || s.id,
          description: s.description || '',
        }));
      } else {
        // External workspace: probe with short service ID
        try {
          const svc = await server.getService(`${workspace}/bioengine-worker`);
          services = [{ id: svc.id, name: svc.name || svc.id, description: svc.description || '' }];
        } catch (err) {
          const errStr = String(err);
          if (errStr.includes('Multiple services found')) {
            // Parse all service IDs from the error, then fetch each for details
            const ids = parseMultipleServicesFromError(errStr);
            const results = await Promise.allSettled(ids.map(id => server.getService(id)));
            services = results.map((result, i) => {
              if (result.status === 'fulfilled') {
                const s = result.value;
                return { id: s.id || ids[i], name: s.name || ids[i], description: s.description || '' };
              }
              return { id: ids[i], name: ids[i], description: '' };
            });
          }
          // Not found or other error → services remains empty
        }
      }

      // Enrich each service with geo_location from get_status()
      if (services.length > 0) {
        const geoResults = await Promise.allSettled(
          services.map(async (svc) => {
            try {
              const worker = await server.getService(svc.id, { mode: 'random' });
              const st = await worker.get_status();
              return st?.geo_location ?? null;
            } catch {
              return null;
            }
          })
        );
        services = services.map((svc, i) => ({
          ...svc,
          geo_location: geoResults[i].status === 'fulfilled' ? geoResults[i].value ?? undefined : undefined,
        }));
      }

      setWorkspaceServices(prev => ({ ...prev, [workspace]: services }));
      setWorkspaceStatus(prev => ({ ...prev, [workspace]: 'loaded' }));
    } catch (err) {
      console.error(`Failed to fetch services for workspace ${workspace}:`, err);
      setWorkspaceStatus(prev => ({ ...prev, [workspace]: 'error' }));
    }
  }, [server, isLoggedIn, userWorkspace]);

  // Fetch all observed workspaces
  const fetchAllWorkspaces = useCallback(async (isManual = false) => {
    if (isManual) setManualRefreshLoading(true);
    await Promise.allSettled(observedWorkspaces.map(ws => fetchWorkspaceServices(ws)));
    if (isManual) setManualRefreshLoading(false);
  }, [observedWorkspaces, fetchWorkspaceServices]);

  // Fetch on mount and whenever server connection or workspace list changes
  useEffect(() => {
    if (server) fetchAllWorkspaces();
  }, [server, observedWorkspaces]); // eslint-disable-line react-hooks/exhaustive-deps

  // Auto-refresh every 10 seconds
  useEffect(() => {
    if (!server) return;
    const interval = setInterval(() => {
      observedWorkspaces.forEach(ws => fetchWorkspaceServices(ws));
    }, 10000);
    return () => clearInterval(interval);
  }, [server, observedWorkspaces, fetchWorkspaceServices]);

  const navigateToDashboard = (serviceId: string) => {
    navigate(`/bioengine/worker?service_id=${serviceId}`);
  };

  const allServices = useMemo(() => {
    return observedWorkspaces.flatMap(ws => {
      const services = workspaceServices[ws] || [];
      if (ws === DEFAULT_PUBLIC_WORKSPACE) {
        // Put the featured worker first within bioimage-io
        const featured = services.filter(s => s.name === FEATURED_SERVICE_NAME);
        const rest = services.filter(s => s.name !== FEATURED_SERVICE_NAME);
        return [...featured, ...rest];
      }
      return services;
    });
  }, [observedWorkspaces, workspaceServices]);

  const isAnyLoading = observedWorkspaces.some(ws => workspaceStatus[ws] === 'loading');

  return (
    <div className="max-w-[1400px] mx-auto px-4 py-8">
      {/* Header */}
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

      {/* BioEngine Guide */}
      <div className="max-w-6xl mx-auto mb-8">
        <div className="bg-white/80 backdrop-blur-sm rounded-2xl shadow-sm border border-white/20 p-6 hover:shadow-md transition-all duration-200">
          <BioEngineGuide />
        </div>
      </div>

      {/* Available Instances */}
      <div className="mb-8">
        <div className="flex items-center justify-center mb-6">
          <h2 className="text-2xl font-semibold text-gray-800 mr-4">Available BioEngine Instances</h2>
          <button
            onClick={() => fetchAllWorkspaces(true)}
            disabled={manualRefreshLoading || !server}
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

        <div className="max-w-6xl mx-auto">
          <div className="bg-white/80 backdrop-blur-sm rounded-2xl shadow-sm border border-white/20 p-6 hover:shadow-md transition-all duration-200">

            {/* Workspace management */}
            <div className="mb-6">
              <h3 className="text-sm font-semibold text-gray-700 mb-3">Observed Workspaces</h3>

              {/* Add workspace input */}
              <form
                onSubmit={(e) => { e.preventDefault(); addWorkspace(); }}
                className="flex gap-2 mb-3"
              >
                <input
                  type="text"
                  value={workspaceInput}
                  onChange={(e) => setWorkspaceInput(e.target.value)}
                  placeholder="Add workspace name..."
                  className="flex-1 px-3 py-2 border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 text-sm"
                />
                <button
                  type="submit"
                  disabled={!workspaceInput.trim() || observedWorkspaces.includes(workspaceInput.trim())}
                  className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-40 disabled:cursor-not-allowed text-sm font-medium transition-colors"
                >
                  Add
                </button>
              </form>

              {/* Workspace chips */}
              <div className="flex flex-wrap gap-2">
                {observedWorkspaces.map(ws => {
                  const isDefault = defaultWorkspaces.includes(ws);
                  const isUserWs = isLoggedIn && ws === userWorkspace;
                  const isPublicDefault = ws === DEFAULT_PUBLIC_WORKSPACE;
                  const status = workspaceStatus[ws];
                  const count = workspaceServices[ws]?.length ?? null;

                  return (
                    <div
                      key={ws}
                      className="group relative flex items-center gap-1.5 px-3 py-1.5 bg-gray-100 rounded-full text-sm text-gray-700 hover:bg-gray-200 transition-colors"
                    >
                      {status === 'loading' && (
                        <div className="w-2.5 h-2.5 border border-gray-400 border-t-transparent rounded-full animate-spin flex-shrink-0" />
                      )}
                      {status === 'loaded' && (
                        <div className={`w-2.5 h-2.5 rounded-full flex-shrink-0 ${count && count > 0 ? 'bg-green-500' : 'bg-gray-400'}`} />
                      )}
                      {status === 'error' && (
                        <div className="w-2.5 h-2.5 rounded-full bg-red-400 flex-shrink-0" />
                      )}
                      {!status && (
                        <div className="w-2.5 h-2.5 rounded-full bg-gray-300 flex-shrink-0" />
                      )}
                      <span className="font-mono">{ws}</span>
                      {isPublicDefault && <span className="text-xs text-gray-400">(public)</span>}
                      {isUserWs && !isPublicDefault && <span className="text-xs text-blue-500">(you)</span>}
                      {count !== null && status === 'loaded' && (
                        <span className="text-xs text-gray-400">{count} worker{count !== 1 ? 's' : ''}</span>
                      )}
                      {!isDefault && (
                        <button
                          onClick={() => removeWorkspace(ws)}
                          className="ml-0.5 opacity-0 group-hover:opacity-100 text-gray-400 hover:text-red-500 transition-all flex-shrink-0"
                          title="Remove workspace"
                        >
                          <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                          </svg>
                        </button>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>

            {/* Services list */}
            <div className="border-t border-gray-200/50 pt-6">
              {!server ? (
                <div className="flex justify-center items-center h-40">
                  <div className="text-center">
                    <div className="w-16 h-16 bg-gradient-to-r from-blue-100 to-purple-100 rounded-xl flex items-center justify-center mx-auto mb-4">
                      <svg className="w-8 h-8 text-blue-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
                      </svg>
                    </div>
                    <p className="text-gray-600 font-medium mb-1">Not connected</p>
                    <p className="text-gray-500 text-sm">Please log in to view BioEngine instances</p>
                  </div>
                </div>
              ) : allServices.length === 0 && isAnyLoading ? (
                <div className="flex justify-center items-center h-40">
                  <div className="flex flex-col items-center">
                    <img
                      src="/static/img/bioengine-logo-black.svg"
                      alt="BioEngine Loading"
                      className="w-32 h-auto opacity-60 animate-pulse"
                    />
                    <p className="text-gray-500 text-sm mt-4 animate-pulse">Loading BioEngine instances...</p>
                  </div>
                </div>
              ) : allServices.length === 0 ? (
                <div className="flex flex-col items-center justify-center h-40 text-gray-500">
                  <div className="w-20 h-20 bg-gradient-to-r from-blue-100 to-purple-100 rounded-2xl flex items-center justify-center mb-4">
                    <svg className="w-10 h-10 text-blue-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10" />
                    </svg>
                  </div>
                  <p className="text-gray-600 font-medium mb-1">No BioEngine instances found</p>
                  <p className="text-gray-500 text-sm">No running workers found in any observed workspace</p>
                </div>
              ) : (
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                  {allServices.map(service => (
                    <ServiceCard
                      key={service.id}
                      service={service}
                      onNavigate={navigateToDashboard}
                      featured={service.name === FEATURED_SERVICE_NAME}
                    />
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default BioEngineHome;
