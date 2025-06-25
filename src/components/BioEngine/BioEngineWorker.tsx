import React, { useEffect, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { useHyphaStore } from '../../store/hyphaStore';
import BioEngineClusterResources from './BioEngineClusterResources';
import BioEngineApps from './BioEngineApps';


// Add custom animations
const styles = `
  @keyframes fadeIn {
    from { opacity: 0; }
    to { opacity: 1; }
  }
  
  @keyframes slideUp {
    from { 
      opacity: 0;
      transform: translateY(20px) scale(0.95);
    }
    to { 
      opacity: 1;
      transform: translateY(0) scale(1);
    }
  }
  
  .animate-fadeIn {
    animation: fadeIn 0.2s ease-out;
  }
  
  .animate-slideUp {
    animation: slideUp 0.3s ease-out;
  }
`;

type ServiceStatus = {
  service_start_time: number;
  ray_cluster: {
    head_address: string;
    start_time: number | "N/A";
    mode: string;
    cluster: {
      total_gpu: number;
      available_gpu: number;
      total_cpu: number;
      available_cpu: number;
      total_memory: number;
      available_memory: number;
      total_object_store_memory: number;
      available_object_store_memory: number;
      pending_resources: {
        actors: any[];
        jobs: any[];
        tasks: any[];
        total: number;
      };
    };
    nodes: Record<string, {
      node_ip: string;
      total_cpu: number;
      available_cpu: number;
      total_gpu: number;
      available_gpu: number;
      total_memory: number;
      available_memory: number;
      total_object_store_memory: number;
      available_object_store_memory: number;
      accelerator_type?: string;
      slurm_job_id?: string;
    }>;
  };
  bioengine_apps: {
    service_id: string | null;
    [key: string]: any;
  };
  bioengine_datasets: {
    available_datasets: Record<string, any>;
    loaded_datasets: Record<string, any>;
  };
};

type DeploymentType = {
  deployment_name: string;
  artifact_id: string;
  start_time: number;
  status: string;
  available_methods?: string[];
  replica_states?: Record<string, number>;
  manifest?: {
    id_emoji?: string;
    name?: string;
    description?: string;
    documentation?: string | {
      url?: string;
      text?: string;
    };
    tutorial?: string | {
      url?: string;
      text?: string;
    };
    links?: {
      url: string;
      icon?: string;
      label: string;
    }[];
  };
  resources?: {
    num_cpus?: number;
    num_gpus?: number;
  };
  [key: string]: any;
};

const BioEngineWorker: React.FC = () => {
  const location = useLocation();
  const navigate = useNavigate();
  const searchParams = new URLSearchParams(location.search);
  const serviceId = searchParams.get('service_id');
  
  const { server, isLoggedIn } = useHyphaStore();
  const [status, setStatus] = useState<ServiceStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Deployment state
  const [deployingArtifactId, setDeployingArtifactId] = useState<string | null>(null);
  const [undeployingArtifactId, setUndeployingArtifactId] = useState<string | null>(null);
  const [deploymentError, setDeploymentError] = useState<string | null>(null);
  const [undeploymentError, setUndeploymentError] = useState<string | null>(null);
  const [artifactModes, setArtifactModes] = useState<Record<string, string>>({});
  const [autoRefreshEnabled, setAutoRefreshEnabled] = useState(true);
  const [refreshInterval, setRefreshInterval] = useState<NodeJS.Timeout | null>(null);
  const [artifactManager, setArtifactManager] = useState<any>(null);
  const [manifestCache, setManifestCache] = useState<Record<string, any>>({});
  
  const [loginErrorTimeout, setLoginErrorTimeout] = useState<NodeJS.Timeout | null>(null);
  const [currentTime, setCurrentTime] = useState(Date.now());
  
  // Update current time every second for live uptime calculation
  useEffect(() => {
    const timer = setInterval(() => {
      setCurrentTime(Date.now());
    }, 1000);
    
    return () => clearInterval(timer);
  }, []);

  useEffect(() => {
    // Clear any existing timeout first
    if (loginErrorTimeout) {
      clearTimeout(loginErrorTimeout);
      setLoginErrorTimeout(null);
    }

    if (!isLoggedIn) {
      // Set a delay before showing the login error to allow time for login process
      const timeout = setTimeout(() => {
        // Double-check login status when timeout fires
        if (!isLoggedIn) {  
          setError('Please log in to view BioEngine instances');
          setLoading(false);
        }
      }, 3000); // 3 second delay
      
      setLoginErrorTimeout(timeout);
      return () => {
        clearTimeout(timeout);
      };
    }
    
    // User is logged in - clear any existing error
    setError(null);

    const initArtifactManager = async () => {
      try {
        const manager = await server.getService('public/artifact-manager');
        setArtifactManager(manager);
      } catch (err) {
        console.error('Failed to initialize artifact manager:', err);
      }
    };
    
    initArtifactManager();

    if (serviceId) {
      fetchStatus();
      
      if (autoRefreshEnabled) {
        const interval = setInterval(() => {
          fetchStatus(false);
        }, 5000);
        
        setRefreshInterval(interval);
        
        return () => {
          clearInterval(interval);
        };
      }
    } else {
      // If no service ID, redirect to home
      navigate('/bioengine');
    }
  }, [serviceId, server, isLoggedIn, autoRefreshEnabled]);

  // Separate cleanup effect for component unmount
  useEffect(() => {
    return () => {
      if (refreshInterval) {
        clearInterval(refreshInterval);
      }
      if (loginErrorTimeout) {
        clearTimeout(loginErrorTimeout);
      }
    };
  }, []);

  const formatTimeInfo = (timestamp: number): { formattedTime: string, uptime: string } => {
    // Handle UTC timestamp in seconds
    const startTime = new Date(timestamp * 1000);
    
    const formattedTime = startTime.toLocaleString();
    
    const diffMs = currentTime - startTime.getTime();
    const diffSec = Math.floor(diffMs / 1000);
    
    let uptime = '';
    if (diffSec < 60) {
      uptime = `${diffSec}s`;
    } else if (diffSec < 3600) {
      const minutes = Math.floor(diffSec / 60);
      const seconds = diffSec % 60;
      uptime = `${minutes}m ${seconds}s`;
    } else if (diffSec < 86400) {
      const hours = Math.floor(diffSec / 3600);
      const minutes = Math.floor((diffSec % 3600) / 60);
      uptime = `${hours}h ${minutes}m`;
    } else {
      const days = Math.floor(diffSec / 86400);
      const hours = Math.floor((diffSec % 86400) / 3600);
      uptime = `${days}d ${hours}h`;
    }
    
    return { formattedTime, uptime };
  };

  // Use a ref to store the current manifest cache to avoid stale closures
  const manifestCacheRef = React.useRef<Record<string, any>>({});
  
  // Update ref whenever manifestCache state changes
  React.useEffect(() => {
    manifestCacheRef.current = manifestCache;
  }, [manifestCache]);

  const fetchStatus = async (showLoading = true) => {
    if (!serviceId || !isLoggedIn) {
      setError(serviceId ? 'Please log in to view BioEngine status' : 'No service ID provided');
      setLoading(false);
      return;
    }

    try {
      if (showLoading) {
        setLoading(true);
      }
      
      const bioengineWorker = await server.getService(serviceId);
      let statusData = await bioengineWorker.get_status();
      
      // Preserve existing manifests before processing new status data
      const existingManifests: Record<string, any> = {};
      if (status?.bioengine_apps) {
        for (const [key, deployment] of Object.entries(status.bioengine_apps)) {
          if (key !== 'service_id' && key !== 'note' && typeof deployment === 'object' && deployment !== null) {
            const existingManifest = (deployment as any).manifest;
            if (existingManifest) {
              existingManifests[key] = existingManifest;
            }
          }
        }
      }
      
      // Process deployments and fetch manifests
      if (statusData && statusData.bioengine_apps) {
        const manifestPromises: Promise<{key: string, manifest: any}>[] = [];
        // Use the ref to get the most current cache state
        const currentManifestCache = { ...manifestCacheRef.current };
        
        for (const [key, deployment] of Object.entries(statusData.bioengine_apps)) {
          if (key !== 'service_id' && key !== 'note' && typeof deployment === 'object' && deployment !== null) {
            (deployment as any).artifact_id = key;
            
            // First, try to use existing manifest if available
            if (existingManifests[key]) {
              (deployment as any).manifest = existingManifests[key];
              console.log(`Using existing manifest for deployed artifact: ${key}`);
            } else if (currentManifestCache[key]) {
              // Use cached manifest from available artifacts
              (deployment as any).manifest = currentManifestCache[key];
              console.log(`Using cached manifest for deployed artifact: ${key}`);
            } else if (artifactManager) {
              // Only fetch if not in cache and not in existing manifests
              const manifestPromise = (async (): Promise<{key: string, manifest: any}> => {
                try {
                  console.log(`Fetching manifest for deployed artifact: ${key}`);
                  const artifact = await artifactManager.read({artifact_id: key, _rkwargs: true});
                  if (artifact && artifact.manifest) {
                    console.log(`Successfully fetched manifest for ${key}:`, artifact.manifest);
                    // Add to local cache immediately
                    currentManifestCache[key] = artifact.manifest;
                    return { key, manifest: artifact.manifest };
                  } else {
                    console.warn(`No manifest found for deployed artifact ${key}`);
                    return { key, manifest: null };
                  }
                } catch (err) {
                  console.error(`Failed to fetch manifest for deployed artifact ${key}:`, err);
                  return { key, manifest: null };
                }
              })();
              manifestPromises.push(manifestPromise);
            }
          }
        }
        
        // Wait for all manifest fetches to complete and update the status data
        if (manifestPromises.length > 0) {
          console.log(`Waiting for ${manifestPromises.length} manifest fetches to complete...`);
          const manifestResults = await Promise.all(manifestPromises);
          
          // Create a deep copy of statusData to ensure React detects the change
          const updatedStatusData = JSON.parse(JSON.stringify(statusData));
          
          // Apply the fetched manifests and update cache
          manifestResults.forEach(({ key, manifest }) => {
            if (manifest && updatedStatusData.bioengine_apps[key]) {
              updatedStatusData.bioengine_apps[key].manifest = manifest;
            }
          });
          
          // Update the cache state with all the new manifests
          setManifestCache(currentManifestCache);
          
          // Use the updated status data
          statusData = updatedStatusData;
          console.log('All manifest fetches completed and applied to status data');
        }
      }
      
      setError(null);
      setStatus(statusData);
      if (showLoading) {
        setLoading(false);
      }
    } catch (err) {
      setError(`Failed to fetch BioEngine status: ${err instanceof Error ? err.message : String(err)}`);
      if (showLoading) {
        setLoading(false);
      }
    }
  };

  const handleDeployArtifact = async (artifactId: string, mode: string | null = null) => {
    if (!serviceId || !isLoggedIn) return;
    
    const deployMode = mode || artifactModes[artifactId] || null;
    
    try {
      setDeploymentError(null); // Clear any previous errors
      
      setDeployingArtifactId(artifactId);
      
      const bioengineWorker = await server.getService(serviceId);
      
      let deploymentName;
      if (deployMode) {
        deploymentName = await bioengineWorker.deploy_artifact(artifactId, deployMode);
      } else {
        deploymentName = await bioengineWorker.deploy_artifact(artifactId);
      }
      
      // Immediately fetch status to check for deployment
      await fetchStatus(false);
      
      setDeployingArtifactId(null);
      
      console.log(`Successfully submitted deployment for ${artifactId} as ${deploymentName} in ${deployMode || 'default'} mode`);
    } catch (err) {
      console.error('Deployment failed:', err);
      const errorMessage = err instanceof Error ? err.message : String(err);
      setDeploymentError(`Failed to deploy ${artifactId}: ${errorMessage}`);
      setDeployingArtifactId(null);
    }
  };
  
  const handleModeChange = (artifactId: string, checked: boolean) => {
    setArtifactModes({
      ...artifactModes,
      [artifactId]: checked ? 'gpu' : 'cpu'
    });
  };

  // Helper functions for deployment state
  const isArtifactDeployed = (artifactId: string): boolean => {
    return !!(status?.bioengine_apps && artifactId in status.bioengine_apps);
  };

  const getDeploymentStatus = (artifactId: string): string | null => {
    if (!status?.bioengine_apps || !(artifactId in status.bioengine_apps)) return null;
    const deployment = status.bioengine_apps[artifactId];
    return typeof deployment === 'object' && deployment !== null ? deployment.status : null;
  };

  const isDeployButtonDisabled = (artifactId: string): boolean => {
    // Disable if currently deploying this artifact
    if (deployingArtifactId === artifactId) return true;
    
    // Disable if another artifact is being deployed
    if (deployingArtifactId !== null && deployingArtifactId !== artifactId) return true;
    
    // Disable if artifact is in DELETING state
    if (isArtifactDeployed(artifactId)) {
      const status = getDeploymentStatus(artifactId);
      if (status === 'DELETING') return true;
      return status !== 'DEPLOYING';
    }
    
    return false;
  };

  const getDeployButtonText = (artifactId: string): string => {
    if (deployingArtifactId === artifactId) return 'Deploy';
    
    return 'Deploy';
  };

  const handleUndeployArtifact = async (artifactId: string) => {
    if (!serviceId || !isLoggedIn) return;
    
    try {
      setUndeploymentError(null); // Clear any previous errors
      setUndeployingArtifactId(artifactId);
      
      const bioengineWorker = await server.getService(serviceId);
      await bioengineWorker.undeploy_artifact(artifactId);
      
      await fetchStatus();
      
      setUndeployingArtifactId(null);
      
      console.log(`Successfully undeployed ${artifactId}`);
    } catch (err) {
      console.error('Undeployment failed:', err);
      const errorMessage = err instanceof Error ? err.message : String(err);
      setUndeploymentError(`Failed to undeploy ${artifactId}: ${errorMessage}`);
      setUndeployingArtifactId(null);
    }
  };

  // Helper function to transform documentation URLs
  const transformDocumentationUrl = (docPath: string, artifactId: string) => {
    // If it's already a full URL, return as is
    if (docPath.startsWith('http://') || docPath.startsWith('https://')) {
      return docPath;
    }
    
    // Extract workspace and alias from artifact ID
    const parts = artifactId.split('/');
    if (parts.length >= 2) {
      const workspace = parts[0];
      const alias = parts[1];
      const baseUrl = server?.config?.server_url || 'https://hypha.aicell.io';
      return `${baseUrl}/${workspace}/artifacts/${alias}/files/${docPath}`;
    }
    
    return docPath;
  };

  // Helper function to extract documentation and tutorial links from manifest
  const getDocumentationLinks = (manifest?: any, artifactId?: string) => {
    const links: Array<{ url: string; label: string; icon?: string; type: 'documentation' | 'tutorial' | 'link' }> = [];
    
    // Add documentation link
    if (manifest?.documentation) {
      let docUrl = '';
      if (typeof manifest.documentation === 'string') {
        docUrl = artifactId ? transformDocumentationUrl(manifest.documentation, artifactId) : manifest.documentation;
      } else if (manifest.documentation.url) {
        docUrl = artifactId ? transformDocumentationUrl(manifest.documentation.url, artifactId) : manifest.documentation.url;
      }
      
      if (docUrl) {
        links.push({
          url: docUrl,
          label: 'Documentation',
          icon: '📚',
          type: 'documentation'
        });
      }
    }
    
    // Add tutorial link if it exists
    if (manifest?.tutorial) {
      let tutorialUrl = '';
      if (typeof manifest.tutorial === 'string') {
        tutorialUrl = artifactId ? transformDocumentationUrl(manifest.tutorial, artifactId) : manifest.tutorial;
      } else if (manifest.tutorial.url) {
        tutorialUrl = artifactId ? transformDocumentationUrl(manifest.tutorial.url, artifactId) : manifest.tutorial.url;
      }
      
      if (tutorialUrl) {
        links.push({
          url: tutorialUrl,
          label: 'Tutorial',
          icon: '🎓',
          type: 'tutorial'
        });
      }
    }
    
    // Add links from the links array
    if (manifest?.links && Array.isArray(manifest.links)) {
      manifest.links.forEach((link: any) => {
        if (link.url && link.label) {
          // Check if it's a tutorial link
          const isTutorial = link.label.toLowerCase().includes('tutorial') || 
                           link.label.toLowerCase().includes('guide') ||
                           link.label.toLowerCase().includes('example');
          
          links.push({
            url: link.url,
            label: link.label,
            icon: link.icon || (isTutorial ? '🎓' : '🔗'),
            type: isTutorial ? 'tutorial' : 'link'
          });
        }
      });
    }
    
    return links;
  };

  // Component to render documentation and tutorial links
  const DocumentationLinks: React.FC<{ manifest?: any; artifactId?: string; className?: string }> = ({ manifest, artifactId, className = "" }) => {
    const links = getDocumentationLinks(manifest, artifactId);
    
    if (links.length === 0) return null;
    
    return (
      <div className={className}>
        <div className="flex items-center mb-2">
          <svg className="w-4 h-4 text-gray-500 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13.828 10.172a4 4 0 00-5.656 0l-4 4a4 4 0 105.656 5.656l1.102-1.101m-.758-4.899a4 4 0 005.656 0l4-4a4 4 0 00-5.656-5.656l-1.1 1.1" />
          </svg>
          <span className="text-sm font-medium text-gray-700">Resources</span>
        </div>
        <div className="flex flex-wrap gap-2">
          {links.map((link, index) => (
            <a
              key={index}
              href={link.url}
              target="_blank"
              rel="noopener noreferrer"
              className={`inline-flex items-center px-3 py-1.5 text-xs font-medium rounded-lg border transition-all duration-200 hover:shadow-sm hover:scale-105 ${
                link.type === 'documentation' 
                  ? 'bg-blue-50 text-blue-700 border-blue-200 hover:bg-blue-100 hover:border-blue-300'
                  : link.type === 'tutorial'
                  ? 'bg-green-50 text-green-700 border-green-200 hover:bg-green-100 hover:border-green-300'
                  : 'bg-gray-50 text-gray-700 border-gray-200 hover:bg-gray-100 hover:border-gray-300'
              }`}
              title={`Open ${link.label}`}
            >
              <span className="mr-1.5">{link.icon}</span>
              {link.label}
              <svg className="w-3 h-3 ml-1.5 opacity-60" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
              </svg>
            </a>
          ))}
        </div>
      </div>
    );
  };

  // Helper function to parse service ID
  const parseServiceId = (serviceId: string) => {
    // Handle format: "workspace/client_id:service_name"
    const colonIndex = serviceId.indexOf(':');
    if (colonIndex !== -1) {
      const [workspaceAndClient, serviceName] = serviceId.split(':');
      const workspaceClientParts = workspaceAndClient.split('/');
      if (workspaceClientParts.length === 2) {
        const [workspace, clientId] = workspaceClientParts;
        return { workspace, clientId, serviceName };
      }
    }
    
    // Handle format: "workspace/service_name"
    const parts = serviceId.split('/');
    if (parts.length === 2) {
      const [workspace, serviceName] = parts;
      return { workspace, clientId: null, serviceName };
    }
    
    return { workspace: 'Unknown', clientId: null, serviceName: 'Unknown' };
  };

  // Enhanced helper function to get complete service info including client ID from deployment service
  const getCompleteServiceInfo = (currentServiceId: string, deploymentServiceId?: string | null) => {
    const currentParsed = parseServiceId(currentServiceId);
    
    // If current service already has client ID, use it
    if (currentParsed.clientId) {
      return currentParsed;
    }
    
    // If no deployment service ID available, return what we have
    if (!deploymentServiceId) {
      return { ...currentParsed, clientId: 'N/A' };
    }
    
    // Extract client ID from deployment service ID
    const deploymentParsed = parseServiceId(deploymentServiceId);
    
    // Use client ID from deployment service if available and workspace matches
    if (deploymentParsed.clientId && deploymentParsed.workspace === currentParsed.workspace) {
      return { ...currentParsed, clientId: deploymentParsed.clientId };
    }
    
    return { ...currentParsed, clientId: 'N/A' };
  };

  const handleArtifactUpdated = () => {
    // Refresh status when artifacts are updated to sync manifest cache
    fetchStatus(false);
  };

  // Helper function to format cluster mode
  const formatClusterMode = (mode: string): string => {
    switch (mode) {
      case 'slurm':
        return 'SLURM';
      case 'single-machine':
        return 'Single Machine';
      case 'external-cluster':
        return 'External Cluster';
      default:
        return mode;
    }
  };

  if (loading) {
    return (
      <div className="flex justify-center items-center h-96">
        <div className="animate-spin rounded-full h-32 w-32 border-b-2 border-blue-600"></div>
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

  // If no service_id is provided, redirect to home
  if (!serviceId) {
    return null; // This will be handled by the useEffect redirect
  }

  if (!status) {
    return (
      <div className="flex justify-center items-center h-96">
        <p className="text-gray-500">No status data available</p>
      </div>
    );
  }

  const deployments = Object.entries(status?.bioengine_apps || {})
    .filter(([key, value]) => key !== 'service_id' && key !== 'note' && typeof value === 'object' && value !== null)
    .map(([key, value]) => ({ 
      artifact_id: key,
      ...(value as any)
    } as DeploymentType));
  
  const hasDeployments = deployments.length > 0;
  const deploymentServiceId = status?.bioengine_apps?.service_id;
  const deploymentNote = status?.bioengine_apps?.note;

  return (
    <div className="min-h-screen bg-gradient-to-br from-blue-50 via-white to-purple-50">
      <style>{styles}</style>
      <div className="container mx-auto px-4 py-8">
        <div className="flex justify-between items-center mb-8">
          <div>
            <div className="flex items-center mb-2">
              <button
                onClick={() => navigate('/bioengine')}
                className="flex items-center text-blue-600 hover:text-blue-800 transition-colors duration-200 mr-4"
                title="Back to BioEngine Home"
              >
                <svg className="w-5 h-5 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
                </svg>
                <span className="text-sm font-medium">Back</span>
              </button>
              <h1 className="text-4xl font-bold bg-gradient-to-r from-blue-600 to-purple-600 bg-clip-text text-transparent cursor-pointer" onClick={() => navigate('/bioengine')}>
              BioEngine Dashboard
            </h1>
            </div>
            <p className="text-gray-600 mt-2">Manage and deploy your bioimage analysis applications</p>
          </div>
          
          {serviceId && (
            <div className="bg-white/80 backdrop-blur-sm rounded-xl px-4 py-2 shadow-sm border border-white/20">
              <label className="flex items-center space-x-3">
                <input
                  type="checkbox"
                  checked={autoRefreshEnabled}
                  onChange={(e) => setAutoRefreshEnabled(e.target.checked)}
                  className="w-4 h-4 text-blue-600 bg-gray-100 border-gray-300 rounded focus:ring-blue-500 focus:ring-2"
                />
                <span className="text-sm font-medium text-gray-700">Auto-refresh</span>
              </label>
            </div>
          )}
        </div>
      
      {/* Service Status */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mb-8">
        <div className="bg-white/80 backdrop-blur-sm rounded-2xl shadow-sm border border-white/20 hover:shadow-md transition-all duration-200">
          <div className="p-6">
            <div className="flex items-center mb-4">
              <div className="w-10 h-10 bg-gradient-to-r from-blue-500 to-blue-600 rounded-xl flex items-center justify-center mr-3">
                <svg className="w-5 h-5 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
              </div>
              <h3 className="text-lg font-semibold text-gray-800">Service Information</h3>
            </div>
            <div className="space-y-3">
              {status?.service_start_time && (
                <>
                  <div className="flex justify-between">
                    <span className="font-medium text-gray-700">Start Time:</span>
                    <span className="text-gray-900">
                      {formatTimeInfo(status.service_start_time).formattedTime}
                    </span>
                  </div>
                  <div className="flex justify-between">
                    <span className="font-medium text-gray-700">Uptime:</span>
                    <span className="text-gray-900">
                      {formatTimeInfo(status.service_start_time).uptime}
                    </span>
                  </div>
                </>
              )}
              {serviceId && (() => {
                const { workspace, clientId, serviceName } = getCompleteServiceInfo(serviceId, status?.bioengine_apps?.service_id);
                return (
                  <>
                    <div className="flex justify-between">
                      <span className="font-medium text-gray-700">Workspace:</span>
                      <span className="text-gray-900 font-mono">{workspace}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="font-medium text-gray-700">Client ID:</span>
                      <span className="text-gray-900 font-mono">{clientId}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="font-medium text-gray-700">Service Name:</span>
                      <span className="text-gray-900 font-mono">{serviceName}</span>
                    </div>
                  </>
                );
              })()}
            </div>
          </div>
        </div>
        
        <div className="bg-white/80 backdrop-blur-sm rounded-2xl shadow-sm border border-white/20 hover:shadow-md transition-all duration-200">
          <div className="p-6">
            <div className="flex items-center mb-4">
              <div className="w-10 h-10 bg-gradient-to-r from-purple-500 to-purple-600 rounded-xl flex items-center justify-center mr-3">
                <svg className="w-5 h-5 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2H5a2 2 0 00-2 2v2M7 7h10" />
                </svg>
              </div>
              <h3 className="text-lg font-semibold text-gray-800">Cluster Information</h3>
            </div>
            <div className="space-y-3">
              {status?.ray_cluster?.mode && (
                <div className="flex justify-between">
                  <span className="font-medium text-gray-700">Mode:</span>
                  <span className="text-gray-900">{formatClusterMode(status.ray_cluster.mode)}</span>
                </div>
              )}
              {status?.ray_cluster?.start_time && status.ray_cluster.start_time !== "N/A" && (
                <>
                  <div className="flex justify-between">
                    <span className="font-medium text-gray-700">Start Time:</span>
                    <span className="text-gray-900">
                      {formatTimeInfo(status.ray_cluster.start_time as number).formattedTime}
                    </span>
                  </div>
                  <div className="flex justify-between">
                    <span className="font-medium text-gray-700">Uptime:</span>
                    <span className="text-gray-900">
                      {formatTimeInfo(status.ray_cluster.start_time as number).uptime}
                    </span>
                  </div>
                </>
              )}
              {status?.ray_cluster?.start_time === "N/A" && (
                <>
                  <div className="flex justify-between">
                    <span className="font-medium text-gray-700">Start Time:</span>
                    <span className="text-gray-500">N/A</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="font-medium text-gray-700">Uptime:</span>
                    <span className="text-gray-500">N/A</span>
                  </div>
                </>
              )}
              <div className="flex justify-between">
                <span className="font-medium text-gray-700">Head Address:</span>
                <span className="text-gray-900 font-mono">{status?.ray_cluster?.head_address}</span>
              </div>
            </div>
          </div>
        </div>
      </div>
      
      {/* Cluster Resources - Use BioEngineClusterResources component */}
      {status?.ray_cluster && (
        <BioEngineClusterResources 
          rayCluster={status.ray_cluster}
          currentTime={currentTime}
          formatTimeInfo={formatTimeInfo}
        />
      )}
      
      {/* BioEngine Apps Section - handles both deployed and available apps */}
      <BioEngineApps 
        serviceId={serviceId}
        onArtifactUpdated={handleArtifactUpdated}
        // Pass deployment-related props and handlers
        deployingArtifactId={deployingArtifactId}
        undeployingArtifactId={undeployingArtifactId}
        artifactModes={artifactModes}
        status={status}
        onDeployArtifact={handleDeployArtifact}
        onUndeployArtifact={handleUndeployArtifact}
        onModeChange={handleModeChange}
        isArtifactDeployed={isArtifactDeployed}
        getDeploymentStatus={getDeploymentStatus}
        isDeployButtonDisabled={isDeployButtonDisabled}
        getDeployButtonText={getDeployButtonText}
        // Pass error states and utility functions
        deploymentError={deploymentError}
        undeploymentError={undeploymentError}
        setDeploymentError={setDeploymentError}
        setUndeploymentError={setUndeploymentError}
        formatTimeInfo={formatTimeInfo}
        server={server}
      />
      </div>
    </div>
  );
};

export default BioEngineWorker;