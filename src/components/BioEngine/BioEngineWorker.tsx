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
  service_uptime?: number;
  worker_mode?: string;
  workspace?: string;
  client_id?: string;
  admin_users?: string[];
  is_ready?: boolean;
  ray_cluster: {
    head_address: string;
    start_time: number | "N/A";
    mode?: string;  // Legacy, now use worker_mode at top level
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
  bioengine_datasets?: {
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
  const [workerMcpCopied, setWorkerMcpCopied] = useState(false);

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

      const bioengineWorker = await server.getService(serviceId, {mode: "last"});
      let statusData = await bioengineWorker.get_status();

      // Fetch deployed applications using new get_application_status API
      try {
        const appStatus = await bioengineWorker.get_application_status({ _rkwargs: true });
        console.log('Application status:', appStatus);

        // Merge application status into statusData.bioengine_apps
        if (appStatus && typeof appStatus === 'object') {
          statusData.bioengine_apps = statusData.bioengine_apps || {};

          // appStatus is a dict of application_id -> status
          for (const [appId, appData] of Object.entries(appStatus)) {
            if (typeof appData === 'object' && appData !== null) {
              const app = appData as any;
              console.log(`App ${appId} service_ids:`, app.service_ids);

              // service_ids is an array, get the first element
              const serviceIds = Array.isArray(app.service_ids) && app.service_ids.length > 0
                ? app.service_ids[0]
                : app.service_ids || {};

              statusData.bioengine_apps[appId] = {
                ...app,
                application_id: appId,
                artifact_id: app.artifact_id || appId,
                deployment_name: app.deployment_name || appId,
                status: app.status || 'UNKNOWN',
                start_time: app.start_time,
                service_ids: serviceIds,
                available_methods: app.available_methods || app.methods,
                replica_states: app.replica_states,
                resources: app.resources
              };
            }
          }
        }
      } catch (appErr) {
        console.warn('Failed to fetch application status:', appErr);
      }

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
        const manifestPromises: Promise<{ key: string, manifest: any }>[] = [];
        // Use the ref to get the most current cache state
        const currentManifestCache = { ...manifestCacheRef.current };

        for (const [key, deployment] of Object.entries(statusData.bioengine_apps)) {
          if (key !== 'service_id' && key !== 'note' && typeof deployment === 'object' && deployment !== null) {
            const app = deployment as any;
            // Use artifact_id if available, otherwise use key
            const artifactId = app.artifact_id || key;
            app.artifact_id = artifactId;

            // First, try to use existing manifest if available
            if (existingManifests[key]) {
              app.manifest = existingManifests[key];
              console.log(`Using existing manifest for deployed artifact: ${key}`);
            } else if (currentManifestCache[artifactId]) {
              // Use cached manifest from available artifacts
              app.manifest = currentManifestCache[artifactId];
              console.log(`Using cached manifest for deployed artifact: ${key}`);
            } else if (artifactManager) {
              // Only fetch if not in cache and not in existing manifests
              const manifestPromise = (async (): Promise<{ key: string, manifest: any }> => {
                try {
                  console.log(`Fetching manifest for deployed artifact: ${artifactId}`);
                  const artifact = await artifactManager.read({ artifact_id: artifactId, _rkwargs: true });
                  if (artifact && artifact.manifest) {
                    console.log(`Successfully fetched manifest for ${artifactId}:`, artifact.manifest);
                    // Add to local cache immediately
                    currentManifestCache[artifactId] = artifact.manifest;
                    return { key, manifest: artifact.manifest };
                  } else {
                    console.warn(`No manifest found for deployed artifact ${artifactId}`);
                    return { key, manifest: null };
                  }
                } catch (err) {
                  console.error(`Failed to fetch manifest for deployed artifact ${artifactId}:`, err);
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
      const errorMessage = err instanceof Error ? err.message : String(err);
      
      // Check if the error indicates the service is not available
      const isServiceUnavailable = errorMessage.includes('Service not found') || 
                                   errorMessage.includes('not found') ||
                                   errorMessage.includes('does not exist') ||
                                   errorMessage.includes('No service found') ||
                                   errorMessage.includes('Service is not available');
      
      if (isServiceUnavailable) {
        console.warn(`BioEngine worker service ${serviceId} is no longer available, redirecting to home`);
        navigate('/bioengine');
        return;
      }
      
      setError(`Failed to fetch BioEngine status: ${errorMessage}`);
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

      // Use new run_application API
      // deployMode 'cpu' means disable_gpu=true, 'gpu' means disable_gpu=false
      const disable_gpu = deployMode === 'cpu';

      await bioengineWorker.run_application({
        artifact_id: artifactId,
        disable_gpu: disable_gpu,
        max_ongoing_requests: 10,
        _rkwargs: true
      });

      // Immediately fetch status to check for deployment
      await fetchStatus(false);

      setDeployingArtifactId(null);
      console.log(`Successfully submitted deployment for ${artifactId} in ${deployMode || 'default'} mode`);
    } catch (err) {
      console.error('Deployment failed:', err);
      const errorMessage = err instanceof Error ? err.message : String(err);

      // Check if the error indicates the service is not available
      const isServiceUnavailable = errorMessage.includes('Service not found') ||
                                   errorMessage.includes('not found') ||
                                   errorMessage.includes('does not exist') ||
                                   errorMessage.includes('No service found') ||
                                   errorMessage.includes('Service is not available');

      if (isServiceUnavailable) {
        console.warn(`BioEngine worker service ${serviceId} is no longer available, redirecting to home`);
        navigate('/bioengine');
        return;
      }

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

  const handleUndeployArtifact = async (applicationId: string) => {
    if (!serviceId || !isLoggedIn) return;

    try {
      setUndeploymentError(null); // Clear any previous errors
      setUndeployingArtifactId(applicationId);

      const bioengineWorker = await server.getService(serviceId);
      // Use new stop_application API
      await bioengineWorker.stop_application({
        application_id: applicationId,
        _rkwargs: true
      });

      await fetchStatus();

      setUndeployingArtifactId(null);

      console.log(`Successfully stopped application ${applicationId}`);
    } catch (err) {
      console.error('Stop application failed:', err);
      const errorMessage = err instanceof Error ? err.message : String(err);

      // Check if the error indicates the service is not available
      const isServiceUnavailable = errorMessage.includes('Service not found') ||
                                   errorMessage.includes('not found') ||
                                   errorMessage.includes('does not exist') ||
                                   errorMessage.includes('No service found') ||
                                   errorMessage.includes('Service is not available');

      if (isServiceUnavailable) {
        console.warn(`BioEngine worker service ${serviceId} is no longer available, redirecting to home`);
        navigate('/bioengine');
        return;
      }

      setUndeploymentError(`Failed to stop application ${applicationId}: ${errorMessage}`);
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
              className={`inline-flex items-center px-3 py-1.5 text-xs font-medium rounded-lg border transition-all duration-200 hover:shadow-sm hover:scale-105 ${link.type === 'documentation'
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

  // Helper function to get worker service info URL
  const getWorkerServiceInfoUrl = (): string | null => {
    if (!serviceId) return null;

    const baseUrl = server?.config?.server_url || 'https://hypha.aicell.io';

    // Parse the service ID to get workspace and service identifier
    // Format: "workspace/client_id:service_name"
    const slashIndex = serviceId.indexOf('/');
    if (slashIndex !== -1) {
      const workspace = serviceId.substring(0, slashIndex);
      const serviceIdentifier = serviceId.substring(slashIndex + 1); // client_id:service_name
      return `${baseUrl}/${workspace}/services/${serviceIdentifier}`;
    }

    return null;
  };

  // Helper function to get worker MCP URL
  const getWorkerMcpUrl = (): string | null => {
    if (!serviceId) return null;

    const baseUrl = server?.config?.server_url || 'https://hypha.aicell.io';

    // Parse the service ID to get workspace and service identifier
    // Format: "workspace/client_id:service_name"
    const slashIndex = serviceId.indexOf('/');
    if (slashIndex !== -1) {
      const workspace = serviceId.substring(0, slashIndex);
      const serviceIdentifier = serviceId.substring(slashIndex + 1); // client_id:service_name
      return `${baseUrl}/${workspace}/mcp/${serviceIdentifier}/mcp`;
    }

    return null;
  };

  const handleCopyWorkerMcpUrl = async () => {
    const mcpUrl = getWorkerMcpUrl();
    if (mcpUrl) {
      try {
        await navigator.clipboard.writeText(mcpUrl);
        setWorkerMcpCopied(true);
        setTimeout(() => setWorkerMcpCopied(false), 2000);
      } catch (err) {
        console.error('Failed to copy MCP URL:', err);
      }
    }
  };

  // Helper function to format uptime from seconds
  const formatUptime = (seconds: number): string => {
    if (seconds < 60) {
      return `${Math.floor(seconds)}s`;
    } else if (seconds < 3600) {
      const minutes = Math.floor(seconds / 60);
      const secs = Math.floor(seconds % 60);
      return `${minutes}m ${secs}s`;
    } else if (seconds < 86400) {
      const hours = Math.floor(seconds / 3600);
      const minutes = Math.floor((seconds % 3600) / 60);
      return `${hours}h ${minutes}m`;
    } else {
      const days = Math.floor(seconds / 86400);
      const hours = Math.floor((seconds % 86400) / 3600);
      return `${days}d ${hours}h`;
    }
  };

  // Loading overlay component
  const LoadingOverlay = () => (
    <div className="fixed inset-0 bg-black/10 backdrop-blur-sm flex items-center justify-center z-50">
      <div className="bg-white/80 backdrop-blur-lg rounded-xl p-8 flex flex-col items-center shadow-lg border border-white/50">
        <div className="animate-spin rounded-full h-12 w-12 border-2 border-gray-300 border-t-blue-600 mb-4"></div>
        <div className="text-lg font-medium text-gray-700">Loading BioEngine Dashboard...</div>
        <div className="text-sm text-gray-500 mt-1">Please wait while we fetch the latest status</div>
      </div>
    </div>
  );

  if (loading) {
    return <LoadingOverlay />;
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

  return (
    <div className="min-h-screen bg-gradient-to-br from-blue-50 via-white to-purple-50">
      <style>{styles}</style>
      <div className="max-w-[1400px] mx-auto px-4 py-8">
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
                BioEngine Worker Dashboard
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

        {/* Service Information */}
        <div className="mb-8">
          <div className="bg-white/80 backdrop-blur-sm rounded-2xl shadow-sm border border-white/20 hover:shadow-md transition-all duration-200">
            <div className="p-6">
              <div className="flex items-center justify-between mb-4">
                <div className="flex items-center">
                  <div className="w-10 h-10 bg-gradient-to-r from-blue-500 to-blue-600 rounded-xl flex items-center justify-center mr-3">
                    <svg className="w-5 h-5 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
                    </svg>
                  </div>
                  <h3 className="text-lg font-semibold text-gray-800">Service Information</h3>
                </div>
                {/* Status indicator */}
                {status?.is_ready !== undefined && (
                  <span className={`inline-flex items-center px-2.5 py-1 rounded-full text-xs font-medium ${
                    status.is_ready
                      ? 'bg-green-100 text-green-700 border border-green-200'
                      : 'bg-yellow-100 text-yellow-700 border border-yellow-200'
                  }`}>
                    <span className={`w-2 h-2 rounded-full mr-1.5 ${status.is_ready ? 'bg-green-500' : 'bg-yellow-500'}`}></span>
                    {status.is_ready ? 'Ready' : 'Initializing'}
                  </span>
                )}
              </div>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {/* Service ID from URL */}
                {serviceId && (
                  <div className="md:col-span-2">
                    <span className="text-xs font-medium text-gray-500 block">Service ID</span>
                    <span className="text-sm font-semibold text-gray-900 font-mono break-all">{serviceId}</span>
                  </div>
                )}
                {/* Use new workspace and client_id fields if available */}
                {status?.workspace && (
                  <div>
                    <span className="text-xs font-medium text-gray-500 block">Workspace</span>
                    <span className="text-sm font-semibold text-gray-900 font-mono break-all">{status.workspace}</span>
                  </div>
                )}
                {status?.client_id && (
                  <div>
                    <span className="text-xs font-medium text-gray-500 block">Client ID</span>
                    <span className="text-sm font-semibold text-gray-900 font-mono break-all">{status.client_id}</span>
                  </div>
                )}
                {/* Fallback to parsing service ID if new fields not available */}
                {!status?.workspace && serviceId && (() => {
                  const { workspace, clientId, serviceName } = getCompleteServiceInfo(serviceId, status?.bioengine_apps?.service_id);
                  return (
                    <>
                      <div>
                        <span className="text-xs font-medium text-gray-500 block">Workspace</span>
                        <span className="text-sm font-semibold text-gray-900 font-mono break-all">{workspace}</span>
                      </div>
                      <div>
                        <span className="text-xs font-medium text-gray-500 block">Client ID</span>
                        <span className="text-sm font-semibold text-gray-900 font-mono break-all">{clientId}</span>
                      </div>
                      <div>
                        <span className="text-xs font-medium text-gray-500 block">Service Name</span>
                        <span className="text-sm font-semibold text-gray-900 font-mono break-all">{serviceName}</span>
                      </div>
                    </>
                  );
                })()}
                {status?.service_start_time && (
                  <div>
                    <span className="text-xs font-medium text-gray-500 block">Start Time</span>
                    <span className="text-sm font-semibold text-gray-900">
                      {formatTimeInfo(status.service_start_time).formattedTime}
                    </span>
                  </div>
                )}
                {/* Use service_uptime if available, otherwise calculate from start_time */}
                {status?.service_uptime !== undefined ? (
                  <div>
                    <span className="text-xs font-medium text-gray-500 block">Uptime</span>
                    <span className="text-sm font-semibold text-gray-900">{formatUptime(status.service_uptime)}</span>
                  </div>
                ) : status?.service_start_time && (
                  <div>
                    <span className="text-xs font-medium text-gray-500 block">Uptime</span>
                    <span className="text-sm font-semibold text-gray-900">
                      {formatTimeInfo(status.service_start_time).uptime}
                    </span>
                  </div>
                )}
                {/* Admin users */}
                {status?.admin_users && status.admin_users.length > 0 && (
                  <div className="md:col-span-2">
                    <span className="text-xs font-medium text-gray-500 block mb-1">Admin Users</span>
                    <div className="flex flex-wrap gap-1">
                      {status.admin_users.map((user, index) => (
                        <span
                          key={index}
                          className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-gray-100 text-gray-700"
                        >
                          {user === '*' ? 'All Users' : user}
                        </span>
                      ))}
                    </div>
                  </div>
                )}
                {/* Service Info and Copy Worker MCP URL buttons */}
                {(getWorkerServiceInfoUrl() || getWorkerMcpUrl()) && (
                  <div className="md:col-span-2 pt-3 border-t border-gray-100 flex flex-wrap gap-2">
                    {getWorkerServiceInfoUrl() && (
                      <a
                        href={getWorkerServiceInfoUrl()!}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex items-center px-3 py-1.5 text-xs font-medium rounded-lg border transition-all duration-200 bg-blue-50 text-blue-700 border-blue-200 hover:bg-blue-100 hover:border-blue-300"
                        title="View service information"
                      >
                        <svg className="w-3.5 h-3.5 mr-1.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                        </svg>
                        Service Info
                        <svg className="w-3 h-3 ml-1 opacity-60" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
                        </svg>
                      </a>
                    )}
                    {getWorkerMcpUrl() && (
                      <button
                        onClick={handleCopyWorkerMcpUrl}
                        className={`inline-flex items-center px-3 py-1.5 text-xs font-medium rounded-lg border transition-all duration-200 ${
                          workerMcpCopied
                            ? 'bg-green-50 text-green-700 border-green-200'
                            : 'bg-purple-50 text-purple-700 border-purple-200 hover:bg-purple-100 hover:border-purple-300'
                        }`}
                        title="Copy MCP Server URL for this worker"
                      >
                        {workerMcpCopied ? (
                          <>
                            <svg className="w-3.5 h-3.5 mr-1.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                            </svg>
                            Copied!
                          </>
                        ) : (
                          <>
                            <svg className="w-3.5 h-3.5 mr-1.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
                            </svg>
                            Copy Worker MCP URL
                          </>
                        )}
                      </button>
                    )}
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>

        {/* Cluster Status - Use BioEngineClusterResources component */}
        {status?.ray_cluster && (
          <BioEngineClusterResources
            rayCluster={status.ray_cluster}
            workerMode={status.worker_mode}
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