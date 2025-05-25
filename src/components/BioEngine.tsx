import React, { useEffect, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { useHyphaStore } from '../store/hyphaStore';
import { Card, CardContent, CardMedia, Button, IconButton, Box, Typography, Chip, Grid, Dialog, DialogTitle, DialogContent, DialogActions, CircularProgress, Switch, FormControlLabel, List, ListItem, ListItemText, Divider, TextField } from '@mui/material';
import CloseIcon from '@mui/icons-material/Close';
import SearchIcon from '@mui/icons-material/Search';

type ServiceStatus = {
  service: {
    start_time_s: number;
    start_time: string;
    uptime: string;
  };
  cluster: {
    head_address: string;
    worker_nodes: {
      Alive: Array<{
        WorkerID: string | null;
        NodeID: string;
        NodeIP: string;
        "Total GPU": number;
        "Available GPU": number;
        "GPU Utilization": number;
        "Total CPU": number;
        "Available CPU": number;
        "CPU Utilization": number;
        "Total Memory": number;
        "Available Memory": number;
        "Memory Utilization": number;
      }>;
      Dead: Array<any>;
    } | "N/A";
    start_time_s: number;
    start_time: string;
    uptime: string;
    autoscaler: any;
    note: string;
  };
  deployments: {
    service_id: string | null;
    [key: string]: any;
  };
  datasets?: {
    available_datasets: Record<string, any>;
    loaded_datasets: Record<string, any>;
  };
};

type BioEngineService = {
  id: string;
  name: string;
  description: string;
  service?: any; // The actual service object
};

type ArtifactType = {
  id: string;
  name: string;
  type: string;
  workspace: string;
  parent_id: string;
  alias: string;
  description?: string;
  manifest?: {
    id_emoji?: string;
    name?: string;
    description?: string;
    deployment_config?: {
      modes?: {
        cpu?: any;
        gpu?: any;
      };
    };
    deployment_class?: {
      exposed_methods?: Record<string, any>;
    };
    ray_actor_options?: {
      num_gpus?: number;
    };
  };
  supportedModes?: {
    cpu: boolean;
    gpu: boolean;
  };
  defaultMode?: string;
};

// Update the DeploymentType to include the new fields
type DeploymentType = {
  deployment_name: string;
  artifact_id: string;
  start_time_s: number;
  start_time: string;
  uptime: string;
  status: string;
  available_methods?: string[];
  replica_states?: Record<string, number>;
  manifest?: {
    id_emoji?: string;
    name?: string;
    description?: string;
  };
  resources?: {
    num_cpus?: number;
    num_gpus?: number;
  };
  [key: string]: any;
};

const BioEngine: React.FC = () => {
  const location = useLocation();
  const navigate = useNavigate();
  const searchParams = new URLSearchParams(location.search);
  const serviceId = searchParams.get('service_id');
  
  const { server, isLoggedIn } = useHyphaStore();
  const [status, setStatus] = useState<ServiceStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [bioEngineServices, setBioEngineServices] = useState<BioEngineService[]>([]);
  const [availableArtifacts, setAvailableArtifacts] = useState<ArtifactType[]>([]);
  const [deploymentLoading, setDeploymentLoading] = useState(false);
  const [deployingArtifactId, setDeployingArtifactId] = useState<string | null>(null);
  const [deploymentMode, setDeploymentMode] = useState<string | null>(null);
  const [undeployingArtifactId, setUndeployingArtifactId] = useState<string | null>(null);
  const [artifactModes, setArtifactModes] = useState<Record<string, string>>({});
  const [autoRefreshEnabled, setAutoRefreshEnabled] = useState(true);
  const [refreshInterval, setRefreshInterval] = useState<NodeJS.Timeout | null>(null);
  const [timeUpdater, setTimeUpdater] = useState<number>(0);
  const [artifactManager, setArtifactManager] = useState<any>(null);
  const [customServiceId, setCustomServiceId] = useState('');
  const [tokenDialogOpen, setTokenDialogOpen] = useState(false);
  const [customToken, setCustomToken] = useState('');
  const [connectionLoading, setConnectionLoading] = useState(false);
  const [connectionError, setConnectionError] = useState<string | null>(null);
  
  useEffect(() => {
    if (!isLoggedIn) {
      setError('Please log in to view BioEngine instances');
      setLoading(false);
      return;
    }

    // Get the artifact manager when the component mounts
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
      
      // Set up auto-refresh if enabled
      if (autoRefreshEnabled) {
        const interval = setInterval(() => {
          fetchStatus(false); // Pass false to avoid showing loading state during refresh
        }, 5000);
        
        setRefreshInterval(interval);
      }
    } else {
      fetchBioEngineServices();
    }

    // Clean up interval on unmount or when dependencies change
    return () => {
      if (refreshInterval) {
        clearInterval(refreshInterval);
      }
    };
  }, [serviceId, server, isLoggedIn, autoRefreshEnabled]);

  // Add this function to format timestamps and calculate uptime
  const formatTimeInfo = (timestamp: number): { formattedTime: string, uptime: string } => {
    const now = new Date();
    const startTime = new Date(timestamp * 1000);
    
    // Format the start time in local timezone
    const formattedTime = startTime.toLocaleString();
    
    // Calculate uptime
    const diffMs = now.getTime() - startTime.getTime();
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
  
  // Add a useEffect for real-time uptime updates
  useEffect(() => {
    const interval = setInterval(() => {
      setTimeUpdater(prev => prev + 1);
    }, 1000);
    
    return () => clearInterval(interval);
  }, []);

  const fetchBioEngineServices = async () => {
    if (!isLoggedIn) return;

    try {
      setLoading(true);
      const services = await server.listServices({"type": "bioengine-worker"});
      setBioEngineServices(services);
      setLoading(false);
      setError(null);
    } catch (err) {
      setError(`Failed to fetch BioEngine instances: ${err instanceof Error ? err.message : String(err)}`);
      setLoading(false);
    }
  };

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
      const statusData = await bioengineWorker.get_status();
      
      // Fetch artifact manifests for deployed artifacts to get name and icon
      if (statusData && statusData.deployments && artifactManager) {
        for (const [key, deployment] of Object.entries(statusData.deployments)) {
          if (key !== 'service_id' && typeof deployment === 'object' && deployment !== null) {
            // Set the artifact_id since it's now the key
            (deployment as any).artifact_id = key;
            
            const artifactId = key;
            if (artifactId) {
              try {
                // Always use the full artifact ID (workspace/alias format)
                const manifest = await artifactManager.read(artifactId);
                if (manifest) {
                  (deployment as any).manifest = manifest.manifest;
                }
              } catch (err) {
                console.warn(`Failed to fetch manifest for deployed artifact ${artifactId}:`, err);
              }
            }
          }
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

  const determineArtifactSupportedModes = (artifact: any) => {
    const supportedModes = { cpu: false, gpu: false };
    let defaultMode = 'cpu';
    
    // First check deployment_config.modes
    if (artifact.manifest?.deployment_config?.modes) {
      const modes = artifact.manifest.deployment_config.modes;
      
      // Check specifically for modes.cpu and modes.gpu
      if (modes.cpu) supportedModes.cpu = true;
      if (modes.gpu) supportedModes.gpu = true;
      
      // Set default mode preference to GPU if available
      if (supportedModes.gpu) {
        defaultMode = 'gpu';
      }
    } 
    // Then check direct ray_actor_options in deployment_config
    else if (artifact.manifest?.deployment_config?.ray_actor_options) {
      const numGpus = artifact.manifest.deployment_config.ray_actor_options.num_gpus || 0;
      supportedModes.gpu = numGpus > 0;
      supportedModes.cpu = !supportedModes.gpu; // Only allow CPU if GPU is not required
      defaultMode = supportedModes.gpu ? 'gpu' : 'cpu';
    }
    // Fallback to root level ray_actor_options
    else if (artifact.manifest?.ray_actor_options) {
      const numGpus = artifact.manifest.ray_actor_options.num_gpus || 0;
      supportedModes.gpu = numGpus > 0;
      supportedModes.cpu = !supportedModes.gpu;
      defaultMode = supportedModes.gpu ? 'gpu' : 'cpu';
    }

    return { supportedModes, defaultMode };
  };

  const fetchAvailableArtifacts = async () => {
    if (!isLoggedIn || !serviceId || !artifactManager) return;
    
    try {
      setDeploymentLoading(true);
      
      let allArtifacts: ArtifactType[] = [];
      const modeSettings: Record<string, string> = {};
      
      // Get artifacts from both public and user collections
      try {
        // Collect artifacts from public collection
        const publicCollectionId = 'bioimage-io/bioengine-apps';
        let publicArtifacts: ArtifactType[] = [];
        
        try {
          publicArtifacts = await artifactManager.list(publicCollectionId);
          console.log(`Public artifacts found in ${publicCollectionId}:`, publicArtifacts.map(a => a.id));
        } catch (err) {
          console.warn(`Could not fetch public artifacts: ${err}`);
        }
        
        // Collect artifacts from user collection if it exists
        let userArtifacts: ArtifactType[] = [];
        const userWorkspace = server.config.workspace;
        
        if (userWorkspace) {
          const userCollectionId = `${userWorkspace}/bioengine-apps`;
          try {
            userArtifacts = await artifactManager.list(userCollectionId);
            console.log(`User artifacts found in ${userCollectionId}:`, userArtifacts.map(a => a.id));
          } catch (collectionErr) {
            console.log(`User collection ${userCollectionId} does not exist, skipping`);
          }
        }
        
        // Combine artifacts from both sources
        const combinedArtifacts = [...publicArtifacts, ...userArtifacts];
        
        // Process all artifacts in a single loop
        for (const artifact of combinedArtifacts) {
          try {
            console.log(`Processing artifact: ${artifact.id}, alias: ${artifact.alias}, workspace: ${artifact.workspace}`);
            
            // Use the full artifact ID to fetch the manifest
            const manifest = await artifactManager.read(artifact.id);
            
            if (manifest) {
              artifact.manifest = manifest.manifest;
              
              // Debug the deployment_config.modes structure
              if (artifact.manifest?.deployment_config?.modes) {
                console.log(`${artifact.id} has modes:`, 
                  JSON.stringify(artifact.manifest.deployment_config.modes));
              } else {
                console.log(`${artifact.id} does not have deployment_config.modes`);
              }
              
              const { supportedModes, defaultMode } = determineArtifactSupportedModes(artifact);
              console.log(`${artifact.id} supported modes:`, supportedModes, `Default: ${defaultMode}`);
              
              artifact.supportedModes = supportedModes;
              artifact.defaultMode = defaultMode;
              modeSettings[artifact.id] = defaultMode;
            } else {
              console.log(`No manifest found for ${artifact.id}`);
            }
          } catch (err) {
            console.warn(`Failed to fetch manifest for ${artifact.id}:`, err);
          }
        }
        
        allArtifacts = combinedArtifacts;
      } catch (err) {
        console.warn(`Error processing artifacts: ${err}`);
      }
      
      // Set the state with all artifacts found
      setAvailableArtifacts(allArtifacts);
      setArtifactModes(modeSettings);
      setDeploymentLoading(false);
    } catch (err) {
      console.error('Error fetching artifacts:', err);
      setDeploymentLoading(false);
    }
  };

  const handleOpenDeployDialog = async () => {
    setIsDialogOpen(true);
    await fetchAvailableArtifacts();
  };
  
  const handleDeployArtifact = async (artifactId: string, mode: string | null = null) => {
    if (!serviceId || !isLoggedIn) return;
    
    // Use the selected mode from state if none provided
    const deployMode = mode || artifactModes[artifactId] || null;
    
    try {
      // Close dialog immediately when deploy button is clicked
      setIsDialogOpen(false);
      
      setDeployingArtifactId(artifactId);
      setDeploymentLoading(true);
      
      // Start refreshing status immediately to show the deployment in progress
      fetchStatus(false);
      
      const bioengineWorker = await server.getService(serviceId);
      
      // Only pass mode if it's not null
      let deploymentName;
      if (deployMode) {
        deploymentName = await bioengineWorker.deploy_artifact(artifactId, deployMode);
      } else {
        deploymentName = await bioengineWorker.deploy_artifact(artifactId);
      }
      
      // Refresh status after deployment is complete
      await fetchStatus();
      
      setDeploymentLoading(false);
      setDeployingArtifactId(null);
      
      // Success notification could be added here
      console.log(`Successfully deployed ${artifactId} as ${deploymentName} in ${deployMode || 'default'} mode`);
    } catch (err) {
      console.error('Deployment failed:', err);
      setDeploymentLoading(false);
      setDeployingArtifactId(null);
      // Error notification could be added here
    }
  };
  
  const handleModeChange = (artifactId: string, checked: boolean) => {
    setArtifactModes({
      ...artifactModes,
      [artifactId]: checked ? 'gpu' : 'cpu'
    });
  };

  const handleUndeployArtifact = async (artifactId: string) => {
    if (!serviceId || !isLoggedIn) return;
    
    try {
      setUndeployingArtifactId(artifactId);
      
      const bioengineWorker = await server.getService(serviceId);
      await bioengineWorker.undeploy_artifact(artifactId);
      
      // Refresh status
      await fetchStatus();
      
      setUndeployingArtifactId(null);
      
      // Success notification could be added here
      console.log(`Successfully undeployed ${artifactId}`);
    } catch (err) {
      console.error('Undeployment failed:', err);
      setUndeployingArtifactId(null);
      // Error notification could be added here
    }
  };

  const navigateToDashboard = (serviceId: string) => {
    navigate(`/bioengine?service_id=${serviceId}`);
  };
  
  const handleCustomServiceIdSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!customServiceId.trim()) return;

    console.log(`Connecting to custom BioEngine service: '${customServiceId}'`);
    
    setConnectionLoading(true);
    setConnectionError(null);
    
    try {
      // Try to connect to the service
      const service = await server.getService(customServiceId);
      
      // If successful, navigate to the dashboard
      navigateToDashboard(customServiceId);
    } catch (err) {
      // Check if it's an access denied error
      const errorMessage = String(err);
      if (errorMessage.includes('denied') || errorMessage.includes('unauthorized') || errorMessage.includes('permission')) {
        // Open token dialog
        setTokenDialogOpen(true);
      } else {
        // Show other errors
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
      // Try to connect with token
      const service = await server.getService(customServiceId, { token: customToken });
      
      // If successful, navigate to the dashboard
      setTokenDialogOpen(false);
      navigateToDashboard(customServiceId);
    } catch (err) {
      // Show token error
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

  if (loading) {
    return <div className="flex justify-center items-center h-96">Loading...</div>;
  }

  if (error) {
    return <div className="flex justify-center items-center h-96 text-red-500">{error}</div>;
  }

  // If no service_id is provided, show the list of BioEngine instances
  if (!serviceId) {
    return (
      <div className="container mx-auto px-4 py-8">
        <h1 className="text-3xl font-bold mb-6">BioEngine Instances</h1>
        
        {/* Custom Service ID Input - Redesigned to be more compact */}
        <div className="max-w-2xl mx-auto mb-6">
          <form onSubmit={handleCustomServiceIdSubmit}>
            <div className="relative flex items-center">
              <SearchIcon className="absolute left-3 text-gray-400" />
              <TextField
                fullWidth
                placeholder="Connect to a BioEngine Worker by ID"
                variant="outlined"
                value={customServiceId}
                onChange={(e) => setCustomServiceId(e.target.value)}
                disabled={connectionLoading}
                error={!!connectionError}
                InputProps={{
                  sx: { 
                    paddingLeft: '2.5rem',
                    borderTopRightRadius: 0,
                    borderBottomRightRadius: 0
                  }
                }}
              />
              <Button 
                type="submit" 
                variant="contained" 
                disabled={!customServiceId.trim() || connectionLoading}
                sx={{ 
                  height: '56px',
                  borderTopLeftRadius: 0,
                  borderBottomLeftRadius: 0,
                  boxShadow: 'none'
                }}
              >
                {connectionLoading ? <CircularProgress size={24} /> : "Connect"}
              </Button>
            </div>
            {connectionError && (
              <Typography variant="caption" color="error" sx={{ ml: 2, mt: 0.5 }}>
                {connectionError}
              </Typography>
            )}
          </form>
        </div>
        
        {bioEngineServices.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-64 text-gray-500">
            <p className="mb-4">No BioEngine instances available in workspace '{server.config.workspace}'</p>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {bioEngineServices.map((service) => (
              <Card key={service.id} sx={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
                <CardContent sx={{ flexGrow: 1 }}>
                  <Typography variant="h5" component="div" gutterBottom>
                    {service.name}
                  </Typography>
                  <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
                    {service.description || 'No description available'}
                  </Typography>
                  <Typography variant="caption" display="block" color="text.secondary" sx={{ mb: 1 }}>
                    ID: {service.id}
                  </Typography>
                </CardContent>
                <Box sx={{ p: 2, pt: 0 }}>
                  <Button 
                    variant="contained" 
                    fullWidth
                    onClick={() => navigateToDashboard(service.id)}
                  >
                    View Dashboard
                  </Button>
                </Box>
              </Card>
            ))}
          </div>
        )}
        
        {/* Token Dialog */}
        <Dialog open={tokenDialogOpen} onClose={handleTokenDialogClose}>
          <DialogTitle>Authentication Required</DialogTitle>
          <form onSubmit={handleTokenSubmit}>
            <DialogContent>
              <Typography variant="body2" paragraph>
                Access to this BioEngine service requires authentication. Please enter a token:
              </Typography>
              <TextField
                autoFocus
                margin="dense"
                label="Token"
                type="password"
                fullWidth
                variant="outlined"
                value={customToken}
                onChange={(e) => setCustomToken(e.target.value)}
                error={!!connectionError}
                helperText={connectionError}
                disabled={connectionLoading}
              />
            </DialogContent>
            <DialogActions>
              <Button onClick={handleTokenDialogClose} disabled={connectionLoading}>
                Cancel
              </Button>
              <Button 
                type="submit" 
                variant="contained" 
                disabled={!customToken.trim() || connectionLoading}
              >
                {connectionLoading ? <CircularProgress size={20} /> : "Connect"}
              </Button>
            </DialogActions>
          </form>
        </Dialog>
      </div>
    );
  }

  if (!status) {
    return <div className="flex justify-center items-center h-96">No status data available</div>;
  }

  // Modified code to extract deployments with the new structure
  const deployments = Object.entries(status?.deployments || {})
    .filter(([key]) => key !== 'service_id' && key !== 'note')
    .map(([key, value]) => ({ 
      artifact_id: key,
      ...value 
    } as DeploymentType));
  
  const hasDeployments = deployments.length > 0;
  const deploymentServiceId = status?.deployments?.service_id;
  const deploymentNote = status?.deployments?.note;

  return (
    <div className="container mx-auto px-4 py-8">
      <Box display="flex" justifyContent="space-between" alignItems="center" mb={4}>
        <h1 className="text-3xl font-bold">BioEngine Dashboard</h1>
        
        {serviceId && (
          <FormControlLabel
            control={
              <Switch 
                checked={autoRefreshEnabled}
                onChange={(e) => setAutoRefreshEnabled(e.target.checked)}
              />
            }
            label="Auto-refresh"
          />
        )}
      </Box>
      
      {/* Service Status */}
      <Grid container spacing={3} className="mb-6">
        <Grid item xs={12} md={6}>
          <Card>
            <CardContent>
              <Typography variant="h6" gutterBottom>Service Information</Typography>
              <Box sx={{ mt: 2 }}>
                <Box display="flex" justifyContent="space-between" mb={1}>
                  <Typography variant="body1" fontWeight="medium">Service ID:</Typography>
                  <Typography variant="body1">{serviceId}</Typography>
                </Box>
                {status?.service?.start_time_s && (
                  <>
                    <Box display="flex" justifyContent="space-between" mb={1}>
                      <Typography variant="body1" fontWeight="medium">Start Time:</Typography>
                      <Typography variant="body1">
                        {formatTimeInfo(status.service.start_time_s).formattedTime}
                      </Typography>
                    </Box>
                    <Box display="flex" justifyContent="space-between">
                      <Typography variant="body1" fontWeight="medium">Uptime:</Typography>
                      <Typography variant="body1">
                        {formatTimeInfo(status.service.start_time_s).uptime}
                      </Typography>
                    </Box>
                  </>
                )}
              </Box>
            </CardContent>
          </Card>
        </Grid>
        
        <Grid item xs={12} md={6}>
          <Card>
            <CardContent>
              <Typography variant="h6" gutterBottom>Cluster Information</Typography>
              <Box sx={{ mt: 2 }}>
                <Box display="flex" justifyContent="space-between" mb={1}>
                  <Typography variant="body1" fontWeight="medium">Head Address:</Typography>
                  <Typography variant="body1">{status?.cluster?.head_address}</Typography>
                </Box>
                {status?.cluster?.start_time_s && (
                  <>
                    <Box display="flex" justifyContent="space-between" mb={1}>
                      <Typography variant="body1" fontWeight="medium">Start Time:</Typography>
                      <Typography variant="body1">
                        {formatTimeInfo(status.cluster.start_time_s).formattedTime}
                      </Typography>
                    </Box>
                    <Box display="flex" justifyContent="space-between">
                      <Typography variant="body1" fontWeight="medium">Uptime:</Typography>
                      <Typography variant="body1">
                        {formatTimeInfo(status.cluster.start_time_s).uptime}
                      </Typography>
                    </Box>
                  </>
                )}
                {status?.cluster?.note && (
                  <Box mt={2}>
                    <Typography variant="body2" color="text.secondary">Note: {status.cluster.note}</Typography>
                  </Box>
                )}
              </Box>
            </CardContent>
          </Card>
        </Grid>
      </Grid>
      
      {/* Worker Nodes - Only display if worker nodes information is available */}
      {status.cluster.worker_nodes !== "N/A" && (
        <Card className="mb-6">
          <CardContent>
            <Box display="flex" justifyContent="space-between" alignItems="center" mb={2}>
              <Typography variant="h6">Worker Nodes</Typography>
            </Box>
            
            <div className="overflow-x-auto">
              <table className="w-full table-auto">
                <thead>
                  <tr className="border-b">
                    <th className="px-4 py-2 text-left">Node IP</th>
                    <th className="px-4 py-2 text-left">Node ID</th>
                    <th className="px-4 py-2 text-left">CPU</th>
                    <th className="px-4 py-2 text-left">GPU</th>
                    <th className="px-4 py-2 text-left">Memory</th>
                    <th className="px-4 py-2 text-left">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {status.cluster.worker_nodes.Alive.map((node, index) => (
                    <tr key={index} className="border-b">
                      <td className="px-4 py-2">{node.NodeIP}</td>
                      <td className="px-4 py-2 truncate max-w-[150px]" title={node.NodeID}>
                        {node.NodeID.substring(0, 8)}...
                      </td>
                      <td className="px-4 py-2">
                        {node["Available CPU"]}/{node["Total CPU"]} ({Math.round((node["Available CPU"] / node["Total CPU"]) * 100)}% available)
                      </td>
                      <td className="px-4 py-2">
                        {node["Available GPU"]}/{node["Total GPU"]} ({Math.round((node["Available GPU"] / node["Total GPU"]) * 100)}% available)
                      </td>
                      <td className="px-4 py-2">
                        {(node["Available Memory"] / 1024 / 1024 / 1024).toFixed(2)}GB/
                        {(node["Total Memory"] / 1024 / 1024 / 1024).toFixed(2)}GB
                        ({Math.round((node["Available Memory"] / node["Total Memory"]) * 100)}% available)
                      </td>
                      <td className="px-4 py-2">
                        <Chip label="Alive" color="success" size="small" />
                      </td>
                    </tr>
                  ))}
                  {status.cluster.worker_nodes.Dead.map((node, index) => (
                    <tr key={`dead-${index}`} className="border-b">
                      <td className="px-4 py-2" colSpan={5}>
                        {JSON.stringify(node)}
                      </td>
                      <td className="px-4 py-2">
                        <Chip label="Dead" color="error" size="small" />
                      </td>
                    </tr>
                  ))}
                  {status.cluster.worker_nodes.Alive.length === 0 && 
                   status.cluster.worker_nodes.Dead.length === 0 && (
                    <tr>
                      <td colSpan={6} className="px-4 py-2 text-center">No worker nodes available</td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>
      )}
      
      {/* Deployments */}
      <Card>
        <CardContent>
          <Box display="flex" justifyContent="space-between" alignItems="center" mb={2}>
            <Typography variant="h6">Deployed Artifacts</Typography>
            <Button 
              variant="outlined"
              onClick={handleOpenDeployDialog}
            >
              Add Deployment
            </Button>
          </Box>
          
          {/* Display Deployments Service ID if it exists */}
          {deploymentServiceId && (
            <Box mb={3}>
              <Typography variant="body2" fontWeight="medium" gutterBottom>
                Deployments Service ID:
              </Typography>
              <Typography variant="body2" sx={{ wordBreak: 'break-all' }}>
                {deploymentServiceId}
              </Typography>
            </Box>
          )}
          
          {/* Show deployment note when no deployments exist */}
          {!hasDeployments && deploymentNote && (
            <Box textAlign="center" py={4}>
              <Typography variant="body1" color="text.secondary">
                {deploymentNote}
              </Typography>
            </Box>
          )}
          
          {/* List all deployed artifacts */}
          {hasDeployments && (
            <div className="space-y-4">
              {deployments.map((deployment, index) => (
                <Box key={index} p={2} border={1} borderRadius={1} borderColor="divider">
                  {/* First row: artifact name, status, and undeploy button */}
                  <Box display="flex" justifyContent="space-between" alignItems="flex-start" mb={2}>
                    <Box>
                      <Typography variant="h6" display="flex" alignItems="center" gutterBottom>
                        {deployment.manifest?.id_emoji && (
                          <span style={{ marginRight: '8px' }}>{deployment.manifest.id_emoji}</span>
                        )}
                        {deployment.manifest?.name || deployment.artifact_id.split('/').pop()}
                        
                        <Box display="flex" alignItems="center" ml={1}>
                          <Chip
                            label={deployment.status}
                            color={deployment.status === "HEALTHY" || deployment.status === "RUNNING" ? "success" : "default"}
                            size="small"
                          />
                          {deployment.status === "UPDATING" && (
                            <CircularProgress size={16} sx={{ ml: 1 }} />
                          )}
                        </Box>
                      </Typography>
                      
                      <Typography variant="caption" color="text.secondary" display="block">
                        {deployment.artifact_id}
                      </Typography>
                    </Box>
                    
                    {/* Undeploy button */}
                    <Box>
                      {undeployingArtifactId === deployment.artifact_id ? (
                        <CircularProgress size={24} />
                      ) : (
                        <Button
                          variant="outlined"
                          color="error"
                          size="small"
                          onClick={() => handleUndeployArtifact(deployment.artifact_id)}
                          disabled={!!undeployingArtifactId}
                        >
                          Undeploy
                        </Button>
                      )}
                    </Box>
                  </Box>
                  
                  {/* Second row: split into two columns */}
                  <Grid container spacing={2}>
                    {/* Left column: Start time, uptime, and replica states */}
                    <Grid item xs={12} sm={6}>
                      {deployment.start_time_s && (
                        <Box mb={1}>
                          <Typography variant="body2" gutterBottom>
                            <span style={{ fontWeight: 500 }}>Start Time:</span> {formatTimeInfo(deployment.start_time_s).formattedTime}
                          </Typography>
                          <Typography variant="body2" gutterBottom>
                            <span style={{ fontWeight: 500 }}>Uptime:</span> {formatTimeInfo(deployment.start_time_s).uptime}
                          </Typography>
                        </Box>
                      )}
                      
                      {/* Replica states */}
                      {deployment.replica_states && Object.keys(deployment.replica_states).length > 0 && (
                        <Box>
                          <Typography variant="body2" fontWeight="medium" gutterBottom>
                            Replica States:
                          </Typography>
                          <Box display="flex" flexWrap="wrap" gap={1}>
                            {Object.entries(deployment.replica_states).map(([state, count]) => (
                              <Chip
                                key={state}
                                label={`${state}: ${count}`}
                                color={state === "RUNNING" ? "success" : "default"}
                                size="small"
                                variant="outlined"
                              />
                            ))}
                          </Box>
                        </Box>
                      )}
                    </Grid>
                    
                    {/* Right column: Deployment name and available methods */}
                    <Grid item xs={12} sm={6}>
                      <Typography variant="body2" gutterBottom>
                        <span style={{ fontWeight: 500 }}>Deployment name:</span> {deployment.deployment_name}
                      </Typography>
                      
                      {/* Resources information */}
                      {deployment.resources && (
                        <Box mt={1} mb={1}>
                          <Typography variant="body2" fontWeight="medium" gutterBottom>
                            Resources:
                          </Typography>
                          <Box display="flex" flexWrap="wrap" gap={2}>
                            {deployment.resources.num_cpus && deployment.resources.num_cpus > 0 && (
                              <Chip 
                                label={`CPUs: ${deployment.resources.num_cpus}`} 
                                size="small" 
                                variant="outlined" 
                                color="primary"
                              />
                            )}
                            {/* Only show GPUs if they exist AND are greater than 0 */}
                            {deployment.resources.num_gpus !== undefined && 
                             deployment.resources.num_gpus !== null && 
                             deployment.resources.num_gpus > 0 && (
                              <Chip 
                                label={`GPUs: ${deployment.resources.num_gpus}`} 
                                size="small" 
                                variant="outlined" 
                                color="secondary"
                              />
                            )}
                          </Box>
                        </Box>
                      )}
                      
                      {/* Available methods */}
                      {deployment.available_methods && deployment.available_methods.length > 0 && (
                        <Box mt={1}>
                          <Typography variant="body2" fontWeight="medium" gutterBottom>
                            Available Methods:
                          </Typography>
                          <Box display="flex" flexWrap="wrap" gap={1}>
                            {deployment.available_methods.map((method) => (
                              <Chip key={method} label={method} size="small" variant="outlined" />
                            ))}
                          </Box>
                        </Box>
                      )}
                    </Grid>
                  </Grid>
                </Box>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Dialog for available artifacts */}
      <Dialog
        open={isDialogOpen}
        onClose={() => setIsDialogOpen(false)}
        aria-labelledby="artifacts-dialog-title"
        maxWidth="md"
        fullWidth
      >
        <DialogTitle id="artifacts-dialog-title">
          Available Artifacts
          <IconButton
            aria-label="close"
            onClick={() => setIsDialogOpen(false)}
            sx={{
              position: 'absolute',
              right: 8,
              top: 8,
              color: (theme) => theme.palette.grey[500],
            }}
          >
            <CloseIcon />
          </IconButton>
        </DialogTitle>
        <DialogContent>
          <Box sx={{ pt: 1, pb: 2 }}>
            {deploymentLoading && !deployingArtifactId && (
              <Box display="flex" justifyContent="center" p={3}>
                <Typography>Loading artifacts...</Typography>
              </Box>
            )}
            {!deploymentLoading && availableArtifacts.length === 0 && (
              <Box display="flex" justifyContent="center" p={3}>
                <Typography>No deployable artifacts found</Typography>
              </Box>
            )}
            {availableArtifacts.map((artifact) => (
              <Box 
                key={artifact.id} 
                p={2}
                mb={2}
                border={1}
                borderRadius={1}
                borderColor="divider"
              >
                <Box display="flex" justifyContent="space-between" alignItems="flex-start" mb={1}>
                  <Box>
                    <Typography variant="h6">
                      {artifact.manifest?.id_emoji || ""} {artifact.manifest?.name || artifact.name || artifact.alias}
                    </Typography>
                    <Typography variant="caption" color="text.secondary" display="block">
                      {artifact.id}
                    </Typography>
                    <Typography variant="body2" sx={{ mt: 1 }}>
                      {artifact.manifest?.description || artifact.description || "No description available"}
                    </Typography>
                  </Box>
                  
                  <Box display="flex" flexDirection="column" alignItems="flex-end">
                    {artifact.supportedModes && (artifact.supportedModes.cpu && artifact.supportedModes.gpu) ? (
                      <FormControlLabel
                        control={
                          <Switch 
                            checked={artifactModes[artifact.id] === 'gpu'}
                            onChange={(e) => handleModeChange(artifact.id, e.target.checked)}
                          />
                        }
                        label={artifactModes[artifact.id] === 'gpu' ? "GPU" : "CPU"}
                        sx={{ mb: 1 }}
                      />
                    ) : (
                      <Chip 
                        label={artifact.defaultMode === 'gpu' ? "GPU Only" : "CPU Only"} 
                        variant="outlined" 
                        size="small" 
                        color={artifact.defaultMode === 'gpu' ? "secondary" : "primary"}
                        sx={{ mb: 1 }}
                      />
                    )}
                    
                    {deployingArtifactId === artifact.id ? (
                      <CircularProgress size={24} />
                    ) : (
                      <Button
                        variant="contained"
                        size="small"
                        onClick={() => handleDeployArtifact(artifact.id, artifactModes[artifact.id])}
                        disabled={deploymentLoading}
                      >
                        Deploy
                      </Button>
                    )}
                  </Box>
                </Box>
              </Box>
            ))}
          </Box>
        </DialogContent>
      </Dialog>
    </div>
  );
};

export default BioEngine;