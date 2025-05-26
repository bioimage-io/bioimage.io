import React, { useEffect, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { useHyphaStore } from '../store/hyphaStore';
import Editor from '@monaco-editor/react';
import yaml from 'js-yaml';

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
  service?: any;
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

  const [bioEngineServices, setBioEngineServices] = useState<BioEngineService[]>([]);
  const [availableArtifacts, setAvailableArtifacts] = useState<ArtifactType[]>([]);
  const [deploymentLoading, setDeploymentLoading] = useState(false);
  const [deployingArtifactId, setDeployingArtifactId] = useState<string | null>(null);
  const [undeployingArtifactId, setUndeployingArtifactId] = useState<string | null>(null);
  const [deploymentError, setDeploymentError] = useState<string | null>(null);
  const [undeploymentError, setUndeploymentError] = useState<string | null>(null);
  const [artifactModes, setArtifactModes] = useState<Record<string, string>>({});
  const [autoRefreshEnabled, setAutoRefreshEnabled] = useState(true);
  const [refreshInterval, setRefreshInterval] = useState<NodeJS.Timeout | null>(null);
  const [artifactManager, setArtifactManager] = useState<any>(null);
  const [customServiceId, setCustomServiceId] = useState('');
  const [tokenDialogOpen, setTokenDialogOpen] = useState(false);
  const [customToken, setCustomToken] = useState('');
  const [connectionLoading, setConnectionLoading] = useState(false);
  const [connectionError, setConnectionError] = useState<string | null>(null);
  
  // Create/Edit App Dialog state
  const [createAppDialogOpen, setCreateAppDialogOpen] = useState(false);
  const [editingArtifact, setEditingArtifact] = useState<ArtifactType | null>(null);
  const [activeEditorTab, setActiveEditorTab] = useState(0);
  const [createAppLoading, setCreateAppLoading] = useState(false);
  const [createAppError, setCreateAppError] = useState<string | null>(null);
  
  // File management state
  const [files, setFiles] = useState<Array<{name: string, content: string, language: string}>>([]);
  const [editingFileName, setEditingFileName] = useState<string | null>(null);
  const [newFileName, setNewFileName] = useState('');
  const [loginErrorTimeout, setLoginErrorTimeout] = useState<NodeJS.Timeout | null>(null);
  
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
      fetchAvailableArtifacts();
      
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
      fetchBioEngineServices();
    }
  }, [serviceId, server, isLoggedIn, autoRefreshEnabled]);

  // Separate effect to handle artifact manager initialization and fetch artifacts when it becomes available
  useEffect(() => {
    if (isLoggedIn && artifactManager && serviceId) {
      fetchAvailableArtifacts();
    }
  }, [artifactManager, isLoggedIn, serviceId]);

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
    const now = new Date();
    const startTime = new Date(timestamp * 1000);
    
    const formattedTime = startTime.toLocaleString();
    
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

  const fetchBioEngineServices = async () => {
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
      const allServices = hasDefaultService ? services : [defaultService, ...services];
      
      setBioEngineServices(allServices);
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
      
      if (statusData && statusData.deployments && artifactManager) {
        for (const [key, deployment] of Object.entries(statusData.deployments)) {
          if (key !== 'service_id' && typeof deployment === 'object' && deployment !== null) {
            (deployment as any).artifact_id = key;
            
            const artifactId = key;
            if (artifactId) {
              try {
                const artifact = await artifactManager.read({artifact_id: artifactId, _rkwargs: true});
                if (artifact) {
                  (deployment as any).manifest = artifact.manifest;
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
    let defaultMode = 'cpu'; // Always default to CPU
    
    if (artifact.manifest?.deployment_config?.modes) {
      const modes = artifact.manifest.deployment_config.modes;
      
      if (modes.cpu) supportedModes.cpu = true;
      if (modes.gpu) supportedModes.gpu = true;
    } 
    else if (artifact.manifest?.deployment_config?.ray_actor_options) {
      const numGpus = artifact.manifest.deployment_config.ray_actor_options.num_gpus || 0;
      supportedModes.gpu = numGpus > 0;
      supportedModes.cpu = !supportedModes.gpu;
    }
    else if (artifact.manifest?.ray_actor_options) {
      const numGpus = artifact.manifest.ray_actor_options.num_gpus || 0;
      supportedModes.gpu = numGpus > 0;
      supportedModes.cpu = !supportedModes.gpu;
    }

    return { supportedModes, defaultMode };
  };

  const fetchAvailableArtifacts = async () => {
    if (!serviceId || !artifactManager) return;
    
    try {
      setDeploymentLoading(true);
      
      let allArtifacts: ArtifactType[] = [];
      const modeSettings: Record<string, string> = {};
      
      try {
        const publicCollectionId = 'bioimage-io/bioengine-apps';
        let publicArtifacts: ArtifactType[] = [];
        
        try {
          publicArtifacts = await artifactManager.list({parent_id: publicCollectionId, _rkwargs: true});
          console.log(`Public artifacts found in ${publicCollectionId}:`, publicArtifacts.map(a => a.id));
        } catch (err) {
          console.warn(`Could not fetch public artifacts: ${err}`);
        }
        
        let userArtifacts: ArtifactType[] = [];
        const userWorkspace = server.config.workspace;
        
        if (userWorkspace) {
          const userCollectionId = `${userWorkspace}/bioengine-apps`;
          try {
            userArtifacts = await artifactManager.list({parent_id: userCollectionId, _rkwargs: true});
            console.log(`User artifacts found in ${userCollectionId}:`, userArtifacts.map(a => a.id));
          } catch (collectionErr) {
            console.log(`User collection ${userCollectionId} does not exist, skipping`);
          }
        }
        
        const combinedArtifacts = [...publicArtifacts, ...userArtifacts];
        
        for (const art of combinedArtifacts) {
          try {
            console.log(`Processing artifact: ${art.id}, alias: ${art.alias}, workspace: ${art.workspace}`);
            
            const artifactData = await artifactManager.read(art.id);
            
            if (artifactData) {
              art.manifest = artifactData.manifest;
              
              if (art.manifest?.deployment_config?.modes) {
                console.log(`${art.id} has modes:`, 
                  JSON.stringify(art.manifest.deployment_config.modes));
              } else {
                console.log(`${art.id} does not have deployment_config.modes`);
              }
              
              const { supportedModes, defaultMode } = determineArtifactSupportedModes(art);
              console.log(`${art.id} supported modes:`, supportedModes, `Default: ${defaultMode}`);
              
              art.supportedModes = supportedModes;
              art.defaultMode = defaultMode;
              modeSettings[art.id] = defaultMode;
            } else {
              console.log(`No manifest found for ${art.id}`);
            }
          } catch (err) {
            console.warn(`Failed to fetch manifest for ${art.id}:`, err);
          }
        }
        
        allArtifacts = combinedArtifacts;
      } catch (err) {
        console.warn(`Error processing artifacts: ${err}`);
      }
      
      setAvailableArtifacts(allArtifacts);
      setArtifactModes(modeSettings);
      setDeploymentLoading(false);
    } catch (err) {
      console.error('Error fetching artifacts:', err);
      setDeploymentLoading(false);
    }
  };


  
  const handleDeployArtifact = async (artifactId: string, mode: string | null = null) => {
    if (!serviceId || !isLoggedIn) return;
    
    const deployMode = mode || artifactModes[artifactId] || null;
    
    try {
      setDeploymentError(null); // Clear any previous errors
      
      setDeployingArtifactId(artifactId);
      setDeploymentLoading(true);
      
      fetchStatus(false);
      
      const bioengineWorker = await server.getService(serviceId);
      
      let deploymentName;
      if (deployMode) {
        deploymentName = await bioengineWorker.deploy_artifact(artifactId, deployMode);
      } else {
        deploymentName = await bioengineWorker.deploy_artifact(artifactId);
      }
      
      await fetchStatus();
      
      setDeploymentLoading(false);
      setDeployingArtifactId(null);
      
      console.log(`Successfully deployed ${artifactId} as ${deploymentName} in ${deployMode || 'default'} mode`);
    } catch (err) {
      console.error('Deployment failed:', err);
      const errorMessage = err instanceof Error ? err.message : String(err);
      setDeploymentError(`Failed to deploy ${artifactId}: ${errorMessage}`);
      setDeploymentLoading(false);
      setDeployingArtifactId(null);
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

  // Default templates for new apps
  const getDefaultManifest = () => `id: my-new-app
name: My New App
description: A new BioEngine application
id_emoji: 🚀
type: application
deployment_config:
  name: MyNewApp
  num_replicas: 1
  ray_actor_options:
    num_cpus: 1
    num_gpus: 0
  modes:
    cpu:
      ray_actor_options:
        num_cpus: 1
        num_gpus: 0
    gpu:
      ray_actor_options:
        num_cpus: 1
        num_gpus: 1
deployment_class:
  class_name: MyNewApp
  python_file: main.py
  exposed_methods:
    ping:
      authorized_users: "*"
    process:
      authorized_users: "*"
  kwargs: {}
`;

  const getDefaultMainPy = () => `import time
from datetime import datetime

class MyNewApp:
    """A simple BioEngine application example."""
    
    def __init__(self):
        """Initialize the application."""
        self.start_time = time.time()
        print("MyNewApp initialized successfully!")
    
    def ping(self):
        """Simple ping method to test connectivity."""
        return {
            "status": "ok",
            "message": "Hello from MyNewApp!",
            "timestamp": datetime.now().isoformat(),
            "uptime": time.time() - self.start_time
        }
    
    def process(self, data=None):
        """Process some data - customize this for your use case."""
        if data is None:
            data = "No data provided"
        
        return {
            "status": "processed",
            "input": data,
            "output": f"Processed: {data}",
            "timestamp": datetime.now().isoformat()
        }
`;

  // Helper functions for file management
  const getFileLanguage = (fileName: string): string => {
    const extension = fileName.toLowerCase().split('.').pop() || '';
    const languageMap: Record<string, string> = {
      'yaml': 'yaml',
      'yml': 'yaml',
      'py': 'python',
      'js': 'javascript',
      'ts': 'typescript',
      'json': 'json',
      'md': 'markdown',
      'txt': 'plaintext',
      'sh': 'shell',
      'dockerfile': 'dockerfile'
    };
    return languageMap[extension] || 'plaintext';
  };

  const updateFileContent = (fileName: string, content: string) => {
    setFiles(prevFiles => 
      prevFiles.map(file => 
        file.name === fileName ? { ...file, content } : file
      )
    );
  };

  const addNewFile = (fileName: string, content: string = '') => {
    const language = getFileLanguage(fileName);
    setFiles(prevFiles => [...prevFiles, { name: fileName, content, language }]);
  };

  const removeFile = (fileName: string) => {
    setFiles(prevFiles => prevFiles.filter(file => file.name !== fileName));
    const fileIndex = files.findIndex(file => file.name === fileName);
    if (fileIndex === activeEditorTab && files.length > 1) {
      setActiveEditorTab(0);
    }
  };

  const renameFile = (oldName: string, newName: string) => {
    if (oldName === newName || files.some(file => file.name === newName)) return;
    
    setFiles(prevFiles => 
      prevFiles.map(file => 
        file.name === oldName 
          ? { ...file, name: newName, language: getFileLanguage(newName) }
          : file
      )
    );
  };

  // Create App Dialog handlers
  const handleOpenCreateAppDialog = () => {
    setEditingArtifact(null);
    setFiles([
      { name: 'manifest.yaml', content: getDefaultManifest(), language: 'yaml' },
      { name: 'main.py', content: getDefaultMainPy(), language: 'python' }
    ]);
    setActiveEditorTab(0);
    setCreateAppError(null);
    setCreateAppDialogOpen(true);
  };

  const handleOpenEditAppDialog = async (artifact: ArtifactType) => {
    setEditingArtifact(artifact);
    setActiveEditorTab(0);
    setCreateAppError(null);
    setCreateAppLoading(true);
    
    try {
      let manifestText = '';
      let mainPyText = '';
      
      try {
        // Always generate manifest.yaml from artifact.manifest metadata
        if (artifact.manifest) {
          let manifestObj: any = artifact.manifest;
          
          // Check if the manifest is URL-encoded string data
          if (typeof manifestObj === 'string' && manifestObj.includes('%')) {
            console.log('Detected URL-encoded manifest, decoding...');
            try {
              // Decode URL-encoded string and parse as query parameters
              const decoded = decodeURIComponent(manifestObj);
              console.log('Decoded manifest string:', decoded);
              
              // Parse query string format into object
              const params = new URLSearchParams(decoded);
              const parsedObj: any = {};
              params.forEach((value, key) => {
                try {
                  // Try to parse values that look like JSON objects/arrays
                  if (value.startsWith('{') || value.startsWith('[')) {
                    parsedObj[key] = JSON.parse(value.replace(/'/g, '"'));
                  } else {
                    parsedObj[key] = value;
                  }
                } catch {
                  parsedObj[key] = value;
                }
              });
              manifestObj = parsedObj;
              console.log('Parsed manifest object from URL params:', manifestObj);
            } catch (parseErr) {
              console.warn('Failed to parse URL-encoded manifest:', parseErr);
              manifestObj = artifact.manifest;
            }
          }
          
          // Clean the manifest object to remove any non-serializable properties
          const cleanManifest = JSON.parse(JSON.stringify(manifestObj));
          console.log('Original manifest object:', artifact.manifest);
          console.log('Cleaned manifest object:', cleanManifest);
          
          manifestText = yaml.dump(cleanManifest, {
            indent: 2,
            lineWidth: 120,
            noRefs: true,
            skipInvalid: true,
            flowLevel: -1
          });
          console.log('Generated YAML from manifest:', manifestText);
        } else {
          manifestText = getDefaultManifest();
        }
        
        // Try to fetch main.py file
        const mainPyUrl = await artifactManager.get_file({artifact_id: artifact.id, file_path: 'main.py', _rkwargs: true});
        const mainPyResponse = await fetch(mainPyUrl);
        mainPyText = await mainPyResponse.text();
        
        console.log('Successfully fetched main.py:', mainPyText.substring(0, 200) + '...');
      } catch (fileErr) {
        console.warn('Could not fetch main.py file, using default:', fileErr);
        mainPyText = getDefaultMainPy();
      }
      
      setFiles([
        { name: 'manifest.yaml', content: manifestText, language: 'yaml' },
        { name: 'main.py', content: mainPyText, language: 'python' }
      ]);
      setCreateAppDialogOpen(true);
    } catch (err) {
      console.error('Failed to load artifact files for editing:', err);
      setCreateAppError(`Failed to load artifact files: ${err}`);
    } finally {
      setCreateAppLoading(false);
    }
  };

  const handleCloseCreateAppDialog = () => {
    setCreateAppDialogOpen(false);
    setEditingArtifact(null);
    setFiles([]);
    setCreateAppError(null);
    setEditingFileName(null);
    setNewFileName('');
  };

  const handleCreateOrUpdateApp = async () => {
    if (!serviceId || !isLoggedIn || !artifactManager) return;
    
    setCreateAppLoading(true);
    setCreateAppError(null);
    
    try {
      const bioengineWorker = await server.getService(serviceId);
      
      // Find the manifest.yaml file
      const manifestFile = files.find(file => file.name === 'manifest.yaml');
      if (!manifestFile) {
        setCreateAppError('manifest.yaml file is required');
        return;
      }
      
      // Parse the manifest YAML to get the manifest object
      let manifestObj;
      try {
        manifestObj = yaml.load(manifestFile.content);
        console.log('Parsed manifest object:', manifestObj);
      } catch (yamlErr) {
        setCreateAppError(`Invalid YAML in manifest.yaml: ${yamlErr}`);
        return;
      }
      
      const filesToUpload = files.map(file => ({
        name: file.name,
        content: file.content,
        type: 'text'
      }));
      
      if (editingArtifact) {
        // For editing existing artifacts:
        // 1. Update the artifact's manifest metadata using artifactManager.edit
        // 2. Upload all files including the manifest.yaml
        
        console.log('Updating existing artifact:', editingArtifact.id);
        
        // Update the manifest metadata
        await artifactManager.edit({artifact_id: editingArtifact.id, manifest: manifestObj, _rkwargs: true});
        console.log('Updated artifact manifest metadata');
        
        // Upload all files including manifest.yaml
        await bioengineWorker.create_artifact({files: filesToUpload, artifact_id: editingArtifact.id, _rkwargs: true});
        console.log('Uploaded files to artifact');
        
      } else {
        // For creating new artifacts, just use create_artifact with files
        console.log('Creating new artifact');
        await bioengineWorker.create_artifact({files: filesToUpload, _rkwargs: true});
      }
      
      handleCloseCreateAppDialog();
      await fetchAvailableArtifacts();
      
      console.log(`Successfully ${editingArtifact ? 'updated' : 'created'} artifact`);
    } catch (err) {
      console.error('Failed to create/update artifact:', err);
      setCreateAppError(`Failed to ${editingArtifact ? 'update' : 'create'} artifact: ${err}`);
    } finally {
      setCreateAppLoading(false);
    }
  };

  // File management handlers
  const handleAddNewFile = () => {
    if (!newFileName.trim()) return;
    
    if (files.some(file => file.name === newFileName.trim())) {
      setCreateAppError(`File "${newFileName.trim()}" already exists`);
      return;
    }
    
    addNewFile(newFileName.trim());
    setActiveEditorTab(files.length);
    setNewFileName('');
    setCreateAppError(null);
  };

  const handleFileNameEdit = (fileName: string) => {
    setEditingFileName(fileName);
    setNewFileName(fileName);
  };

  const handleFileNameSave = () => {
    if (!editingFileName || !newFileName.trim()) return;
    
    if (newFileName.trim() !== editingFileName && files.some(file => file.name === newFileName.trim())) {
      setCreateAppError(`File "${newFileName.trim()}" already exists`);
      return;
    }
    
    renameFile(editingFileName, newFileName.trim());
    setEditingFileName(null);
    setNewFileName('');
    setCreateAppError(null);
  };

  const handleFileNameCancel = () => {
    setEditingFileName(null);
    setNewFileName('');
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

  // If no service_id is provided, show the list of BioEngine instances
  if (!serviceId) {
    return (
      <div className="container mx-auto px-4 py-8">
        <h1 className="text-3xl font-bold mb-6">BioEngine Instances</h1>
        
        {/* Custom Service ID Input */}
        <div className="max-w-2xl mx-auto mb-6">
          <form onSubmit={handleCustomServiceIdSubmit}>
            <div className="relative flex items-center">
              <svg className="absolute left-3 w-5 h-5 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13.828 10.172a4 4 0 00-5.656 0l-4 4a4 4 0 105.656 5.656l1.102-1.101m-.758-4.899a4 4 0 005.656 0l4-4a4 4 0 00-5.656-5.656l-1.1 1.1" />
              </svg>
              <input
                type="text"
                placeholder="Connect to a BioEngine Worker by ID"
                value={customServiceId}
                onChange={(e) => setCustomServiceId(e.target.value)}
                disabled={connectionLoading}
                className={`w-full pl-10 pr-4 py-3 border rounded-l-lg focus:outline-none focus:ring-2 focus:ring-blue-500 ${
                  connectionError ? 'border-red-500' : 'border-gray-300'
                } ${connectionLoading ? 'bg-gray-100' : 'bg-white'}`}
              />
              <button 
                type="submit" 
                disabled={!customServiceId.trim() || connectionLoading}
                className="px-8 py-3 bg-blue-600 text-white rounded-r-lg hover:bg-blue-700 disabled:bg-gray-400 disabled:cursor-not-allowed flex items-center justify-center min-w-[120px]"
              >
                {connectionLoading ? (
                  <div className="w-5 h-5 border-2 border-white border-t-transparent rounded-full animate-spin"></div>
                ) : (
                  "Connect"
                )}
              </button>
            </div>
            {connectionError && (
              <p className="text-red-500 text-sm mt-2 ml-2">{connectionError}</p>
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
              <div key={service.id} className="bg-white rounded-lg shadow-md border border-gray-200 flex flex-col h-full">
                <div className="p-6 flex-grow">
                  <h3 className="text-xl font-semibold mb-2">{service.name}</h3>
                  <p className="text-gray-600 mb-4">{service.description || 'No description available'}</p>
                  <p className="text-sm text-gray-500">ID: {service.id}</p>
                </div>
                <div className="p-6 pt-0">
                  <button 
                    onClick={() => navigateToDashboard(service.id)}
                    className="w-full px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors"
                  >
                    View Dashboard
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
        
        {/* Token Dialog */}
        {tokenDialogOpen && (
          <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
            <div className="bg-white rounded-lg shadow-xl max-w-md w-full mx-4">
              <div className="p-6 border-b border-gray-200">
                <h3 className="text-lg font-semibold">Authentication Required</h3>
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
                <div className="p-6 pt-0 border-t border-gray-200 flex justify-end space-x-3">
                  <button 
                    type="button"
                    onClick={handleTokenDialogClose} 
                    disabled={connectionLoading}
                    className="px-4 py-2 text-gray-600 border border-gray-300 rounded-lg hover:bg-gray-50 disabled:opacity-50"
                  >
                    Cancel
                  </button>
                  <button 
                    type="submit" 
                    disabled={!customToken.trim() || connectionLoading}
                    className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:bg-gray-400 disabled:cursor-not-allowed flex items-center"
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
  }

  if (!status) {
    return (
      <div className="flex justify-center items-center h-96">
        <p className="text-gray-500">No status data available</p>
      </div>
    );
  }

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
      <div className="flex justify-between items-center mb-6">
        <h1 className="text-3xl font-bold">BioEngine Dashboard</h1>
        
        {serviceId && (
          <label className="flex items-center space-x-2">
            <input
              type="checkbox"
              checked={autoRefreshEnabled}
              onChange={(e) => setAutoRefreshEnabled(e.target.checked)}
              className="w-4 h-4 text-blue-600 bg-gray-100 border-gray-300 rounded focus:ring-blue-500"
            />
            <span className="text-sm font-medium text-gray-700">Auto-refresh</span>
          </label>
        )}
      </div>
      
      {/* Service Status */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mb-6">
        <div className="bg-white rounded-lg shadow-md border border-gray-200">
          <div className="p-6">
            <h3 className="text-lg font-semibold mb-4">Service Information</h3>
            <div className="space-y-3">
              <div className="flex justify-between">
                <span className="font-medium text-gray-700">Service ID:</span>
                <span className="text-gray-900">{serviceId}</span>
              </div>
              {status?.service?.start_time_s && (
                <>
                  <div className="flex justify-between">
                    <span className="font-medium text-gray-700">Start Time:</span>
                    <span className="text-gray-900">
                      {formatTimeInfo(status.service.start_time_s).formattedTime}
                    </span>
                  </div>
                  <div className="flex justify-between">
                    <span className="font-medium text-gray-700">Uptime:</span>
                    <span className="text-gray-900">
                      {formatTimeInfo(status.service.start_time_s).uptime}
                    </span>
                  </div>
                </>
              )}
            </div>
          </div>
        </div>
        
        <div className="bg-white rounded-lg shadow-md border border-gray-200">
          <div className="p-6">
            <h3 className="text-lg font-semibold mb-4">Cluster Information</h3>
            <div className="space-y-3">
              <div className="flex justify-between">
                <span className="font-medium text-gray-700">Head Address:</span>
                <span className="text-gray-900">{status?.cluster?.head_address}</span>
              </div>
              {status?.cluster?.start_time_s && (
                <>
                  <div className="flex justify-between">
                    <span className="font-medium text-gray-700">Start Time:</span>
                    <span className="text-gray-900">
                      {formatTimeInfo(status.cluster.start_time_s).formattedTime}
                    </span>
                  </div>
                  <div className="flex justify-between">
                    <span className="font-medium text-gray-700">Uptime:</span>
                    <span className="text-gray-900">
                      {formatTimeInfo(status.cluster.start_time_s).uptime}
                    </span>
                  </div>
                </>
              )}
              {status?.cluster?.note && (
                <div className="mt-4">
                  <p className="text-sm text-gray-600">Note: {status.cluster.note}</p>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
      
      {/* Worker Nodes */}
      {status.cluster.worker_nodes !== "N/A" && (
        <div className="bg-white rounded-lg shadow-md border border-gray-200 mb-6">
          <div className="p-6">
            <div className="flex justify-between items-center mb-4">
              <h3 className="text-lg font-semibold">Worker Nodes</h3>
            </div>
            
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
                        <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-green-100 text-green-800">
                          Alive
                        </span>
                      </td>
                    </tr>
                  ))}
                  {status.cluster.worker_nodes.Dead.map((node, index) => (
                    <tr key={`dead-${index}`} className="border-b">
                      <td className="px-4 py-2" colSpan={5}>
                        {JSON.stringify(node)}
                      </td>
                      <td className="px-4 py-2">
                        <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-red-100 text-red-800">
                          Dead
                        </span>
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
          </div>
        </div>
      )}
      
      {/* Deployments */}
      <div className="bg-white rounded-lg shadow-md border border-gray-200 mb-6">
        <div className="p-6">
          <div className="flex justify-between items-center mb-4">
            <h3 className="text-lg font-semibold">Deployed BioEngine Apps</h3>
          </div>
          
          {/* Undeployment Error Display */}
          {undeploymentError && (
            <div className="mb-4 p-4 bg-red-50 border border-red-200 rounded-lg">
              <div className="flex justify-between items-start">
                <div className="flex">
                  <svg className="w-5 h-5 text-red-400 mr-2 mt-0.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                  </svg>
                  <div>
                    <h4 className="text-sm font-medium text-red-800">Undeployment Error</h4>
                    <p className="text-sm text-red-700 mt-1">{undeploymentError}</p>
                  </div>
                </div>
                <button
                  onClick={() => setUndeploymentError(null)}
                  className="text-red-400 hover:text-red-600"
                  aria-label="Dismiss error"
                >
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>
              </div>
            </div>
          )}
          
          {deploymentServiceId && (
            <div className="mb-6">
              <p className="font-medium text-gray-700 mb-1">Deployments Service ID:</p>
              <a 
                href={deploymentServiceId ? `https://hypha.aicell.io/${deploymentServiceId.split('/')[0]}/services/${deploymentServiceId.split('/')[1]}` : '#'}
                target="_blank"
                rel="noopener noreferrer"
                className="text-sm text-blue-600 hover:text-blue-800 underline break-all"
              >
                {deploymentServiceId}
              </a>
            </div>
          )}
          
          {!hasDeployments && deploymentNote && (
            <div className="text-center py-8">
              <p className="text-gray-500">{deploymentNote}</p>
            </div>
          )}
          
          {hasDeployments && (
            <div className="space-y-4">
              {deployments.map((deployment, index) => (
                <div key={index} className="p-4 border border-gray-200 rounded-lg">
                  <div className="flex justify-between items-start mb-4">
                    <div>
                      <div className="flex items-center mb-2">
                        {deployment.manifest?.id_emoji && (
                          <span className="mr-2">{deployment.manifest.id_emoji}</span>
                        )}
                        <h4 className="text-lg font-semibold">
                          {deployment.manifest?.name || deployment.artifact_id.split('/').pop()}
                        </h4>
                        
                        <div className="flex items-center ml-3">
                          <span className={`inline-flex items-center px-2 py-1 rounded text-xs font-medium ${
                            deployment.status === "HEALTHY" || deployment.status === "RUNNING" 
                              ? "bg-green-100 text-green-700 border border-green-200" 
                              : "bg-gray-100 text-gray-700 border border-gray-200"
                          }`}>
                            {deployment.status}
                          </span>
                          {deployment.status === "UPDATING" && (
                            <div className="ml-2 w-4 h-4 border-2 border-gray-300 border-t-blue-600 rounded-full animate-spin"></div>
                          )}
                        </div>
                      </div>
                      
                      <p className="text-sm text-gray-500">{deployment.artifact_id}</p>
                    </div>
                    
                    <div>
                      {undeployingArtifactId === deployment.artifact_id ? (
                        <button
                          disabled={true}
                          className="px-3 py-1 text-sm border border-red-300 text-red-600 rounded opacity-50 cursor-not-allowed flex items-center"
                        >
                          <div className="w-4 h-4 border-2 border-red-300 border-t-red-600 rounded-full animate-spin mr-2"></div>
                          {deployment.status === "DEPLOYING" ? "Cancel Deployment" : "Undeploy"}
                        </button>
                      ) : (
                        <button
                          onClick={() => handleUndeployArtifact(deployment.artifact_id)}
                          disabled={false}
                          className="px-3 py-1 text-sm border border-red-300 text-red-600 rounded hover:bg-red-50"
                        >
                          {deployment.status === "DEPLOYING" ? "Cancel Deployment" : "Undeploy"}
                        </button>
                      )}
                    </div>
                  </div>
                  
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    <div>
                      {deployment.start_time_s && (
                        <div className="mb-3">
                          <p className="text-sm text-gray-600">
                            <span className="font-medium">Start Time:</span> {formatTimeInfo(deployment.start_time_s).formattedTime}
                          </p>
                          <p className="text-sm text-gray-600">
                            <span className="font-medium">Uptime:</span> {formatTimeInfo(deployment.start_time_s).uptime}
                          </p>
                        </div>
                      )}
                      
                      {deployment.replica_states && Object.keys(deployment.replica_states).length > 0 && (
                        <div>
                          <p className="text-sm font-medium text-gray-700 mb-2">Replica States:</p>
                          <div className="flex flex-wrap gap-2">
                            {Object.entries(deployment.replica_states).map(([state, count]) => (
                              <span
                                key={state}
                                className={`inline-flex items-center px-2 py-1 rounded text-xs font-medium border ${
                                  state === "RUNNING" 
                                    ? "bg-green-50 text-green-700 border-green-200" 
                                    : "bg-gray-50 text-gray-700 border-gray-200"
                                }`}
                              >
                                {state}: {count}
                              </span>
                            ))}
                          </div>
                        </div>
                      )}
                    </div>
                    
                    <div>
                      <p className="text-sm text-gray-600 mb-3">
                        <span className="font-medium">Deployment name:</span> {deployment.deployment_name}
                      </p>
                      
                      {deployment.resources && (
                        <div className="mb-3">
                          <p className="text-sm font-medium text-gray-700 mb-2">Resources:</p>
                          <div className="flex flex-wrap gap-2">
                            {deployment.resources.num_cpus && deployment.resources.num_cpus > 0 && (
                              <span className="inline-flex items-center px-2 py-1 rounded text-xs font-medium bg-blue-50 text-blue-700 border border-blue-200">
                                CPUs: {deployment.resources.num_cpus}
                              </span>
                            )}
                            {deployment.resources.num_gpus !== undefined && 
                             deployment.resources.num_gpus !== null && 
                             deployment.resources.num_gpus > 0 && (
                              <span className="inline-flex items-center px-2 py-1 rounded text-xs font-medium bg-purple-50 text-purple-700 border border-purple-200">
                                GPUs: {deployment.resources.num_gpus}
                              </span>
                            )}
                          </div>
                        </div>
                      )}
                      
                      {deployment.available_methods && deployment.available_methods.length > 0 && deployment.status !== "DEPLOYING" && (
                        <div>
                          <p className="text-sm font-medium text-gray-700 mb-2">Available Methods:</p>
                          <div className="flex flex-wrap gap-1">
                            {deployment.available_methods.map((method) => (
                              <a
                                key={method}
                                href={deploymentServiceId ? `https://hypha.aicell.io/${deploymentServiceId.split('/')[0]}/services/${deploymentServiceId.split('/')[1]}/${deployment.deployment_name}.${method}` : '#'}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="inline-flex items-center px-2 py-1 rounded text-xs font-medium bg-blue-50 text-blue-700 border border-blue-200 hover:bg-blue-100 hover:text-blue-800 transition-colors"
                              >
                                {method}
                              </a>
                            ))}
                          </div>
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      <div className="border-t border-gray-200 my-6"></div>

      {/* Available Apps Section */}
      <div className="bg-white rounded-lg shadow-md border border-gray-200 mb-6">
        <div className="p-6">
          <div className="flex justify-between items-center mb-4">
            <h3 className="text-lg font-semibold">Available Apps</h3>
            <div className="flex gap-2">
              <button 
                onClick={handleOpenCreateAppDialog}
                disabled={deploymentLoading}
                className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:bg-gray-400 disabled:cursor-not-allowed flex items-center"
              >
                <svg className="w-4 h-4 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
                </svg>
                Create App
              </button>
              <button 
                onClick={fetchAvailableArtifacts}
                disabled={deploymentLoading}
                className="px-4 py-2 border border-gray-300 text-gray-700 rounded-lg hover:bg-gray-50 disabled:bg-gray-100 disabled:cursor-not-allowed flex items-center"
              >
                {deploymentLoading ? (
                  <div className="w-4 h-4 border-2 border-gray-300 border-t-blue-600 rounded-full animate-spin mr-2"></div>
                ) : null}
                {availableArtifacts.length > 0 ? 'Refresh' : 'Load Artifacts'}
              </button>
            </div>
          </div>
          
          {/* Deployment Error Display */}
          {deploymentError && (
            <div className="mb-4 p-4 bg-red-50 border border-red-200 rounded-lg">
              <div className="flex justify-between items-start">
                <div className="flex">
                  <svg className="w-5 h-5 text-red-400 mr-2 mt-0.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                  </svg>
                  <div>
                    <h4 className="text-sm font-medium text-red-800">Deployment Error</h4>
                    <p className="text-sm text-red-700 mt-1">{deploymentError}</p>
                  </div>
                </div>
                <button
                  onClick={() => setDeploymentError(null)}
                  className="text-red-400 hover:text-red-600"
                  aria-label="Dismiss error"
                >
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>
              </div>
            </div>
          )}
          
          {deploymentLoading && availableArtifacts.length === 0 && (
            <div className="flex justify-center p-8">
              <p className="text-gray-500">Loading artifacts...</p>
            </div>
          )}
          
          {!deploymentLoading && availableArtifacts.length === 0 && (
            <div className="flex justify-center p-8">
              <p className="text-gray-500">No deployable artifacts found. Click "Load Artifacts" to fetch available artifacts.</p>
            </div>
          )}
          
          {availableArtifacts.length > 0 && (
            <div className="space-y-4">
              {availableArtifacts.map((artifact) => (
                <div 
                  key={artifact.id} 
                  className="p-4 border border-gray-200 rounded-lg bg-gray-50"
                >
                  <div className="flex justify-between items-start">
                    <div className="flex-1 mr-4">
                      <h4 className="text-lg font-semibold mb-1">
                        {artifact.manifest?.id_emoji || ""} {artifact.manifest?.name || artifact.name || artifact.alias}
                      </h4>
                      <p className="text-sm text-gray-500 mb-2">{artifact.id}</p>
                      <p className="text-gray-600">{artifact.manifest?.description || artifact.description || "No description available"}</p>
                    </div>
                    
                    <div className="flex flex-col items-end">
                      {artifact.supportedModes && (artifact.supportedModes.cpu && artifact.supportedModes.gpu) ? (
                        <label className="flex items-center space-x-2 mb-2">
                          <input
                            type="checkbox"
                            checked={artifactModes[artifact.id] === 'gpu'}
                            onChange={(e) => handleModeChange(artifact.id, e.target.checked)}
                            className="w-4 h-4 text-purple-600 bg-gray-100 border-gray-300 rounded focus:ring-purple-500"
                          />
                          <span className="text-sm font-medium text-gray-700">
                            {artifactModes[artifact.id] === 'gpu' ? "GPU" : "CPU"}
                          </span>
                        </label>
                      ) : null}
                      
                      <div className="flex gap-2">
                        <button
                          onClick={() => handleOpenEditAppDialog(artifact)}
                          disabled={deploymentLoading || createAppLoading}
                          className="px-3 py-1 text-sm border border-gray-300 text-gray-700 rounded hover:bg-gray-50 disabled:opacity-50 flex items-center"
                        >
                          <svg className="w-4 h-4 mr-1" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
                          </svg>
                          Edit
                        </button>
                        
                        {deployingArtifactId === artifact.id ? (
                          <button
                            disabled={true}
                            className="px-4 py-2 bg-gray-400 text-white rounded cursor-not-allowed flex items-center"
                          >
                            <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin mr-2"></div>
                            Deploy
                          </button>
                        ) : (
                          <button
                            onClick={() => handleDeployArtifact(artifact.id, artifactModes[artifact.id])}
                            disabled={deployingArtifactId !== null && deployingArtifactId !== artifact.id}
                            className="px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700 disabled:bg-gray-400"
                          >
                            Deploy
                          </button>
                        )}
                      </div>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Create/Edit App Dialog */}
      {createAppDialogOpen && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <div className="bg-white rounded-lg shadow-xl w-full max-w-6xl mx-4 h-5/6 flex flex-col">
            <div className="p-6 border-b border-gray-200 flex justify-between items-center">
              <h3 className="text-lg font-semibold">
                {editingArtifact ? `Edit app: ${editingArtifact.manifest?.name || editingArtifact.alias}` : 'Create new app'}
              </h3>
              <button
                onClick={handleCloseCreateAppDialog}
                className="text-gray-400 hover:text-gray-600"
                aria-label="Close dialog"
                title="Close dialog"
              >
                <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>
            
            <div className="flex-1 flex flex-col min-h-0">
              {/* Tab Navigation with Add Button */}
              <div className="border-b border-gray-200 bg-gray-50 flex items-center">
                <div className="flex-1 flex overflow-x-auto">
                  {files.map((file, index) => (
                    <button
                      key={file.name}
                      onClick={() => setActiveEditorTab(index)}
                      className={`px-4 py-2 text-sm font-medium border-b-2 whitespace-nowrap ${
                        activeEditorTab === index
                          ? 'border-blue-500 text-blue-600 bg-white'
                          : 'border-transparent text-gray-500 hover:text-gray-700'
                      }`}
                    >
                      <div className="flex items-center gap-2">
                        {editingFileName === file.name ? (
                          <input
                            type="text"
                            value={newFileName}
                            onChange={(e) => setNewFileName(e.target.value)}
                            onKeyDown={(e) => {
                              if (e.key === 'Enter') handleFileNameSave();
                              if (e.key === 'Escape') handleFileNameCancel();
                            }}
                            onBlur={handleFileNameSave}
                            autoFocus
                            className="px-2 py-1 text-xs border border-gray-300 rounded"
                            aria-label="Edit filename"
                          />
                        ) : (
                          <span 
                            onDoubleClick={() => handleFileNameEdit(file.name)}
                            className="cursor-pointer"
                          >
                            {file.name}
                          </span>
                        )}
                        {files.length > 2 && (
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              removeFile(file.name);
                            }}
                            className="ml-1 text-gray-400 hover:text-red-500"
                            aria-label={`Remove file ${file.name}`}
                            title={`Remove file ${file.name}`}
                          >
                            <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                            </svg>
                          </button>
                        )}
                      </div>
                    </button>
                  ))}
                </div>
                
                {/* Add New File */}
                <div className="p-2 flex items-center gap-2 border-l border-gray-200">
                  <input
                    type="text"
                    placeholder="filename.ext"
                    value={newFileName}
                    onChange={(e) => setNewFileName(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') handleAddNewFile();
                    }}
                    className="px-2 py-1 text-xs border border-gray-300 rounded w-24"
                    aria-label="New filename"
                  />
                  <button
                    onClick={handleAddNewFile}
                    disabled={!newFileName.trim()}
                    className="p-1 text-blue-600 hover:text-blue-800 disabled:text-gray-400"
                    aria-label="Add new file"
                    title="Add new file"
                  >
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
                    </svg>
                  </button>
                </div>
              </div>
              
              {/* Error Display */}
              {createAppError && (
                <div className="p-3 bg-red-50 border-b border-red-200">
                  <p className="text-sm text-red-600">{createAppError}</p>
                </div>
              )}
              
              {/* Editor Content */}
              <div className="flex-1 min-h-0">
                {files.length > 0 && files[activeEditorTab] && (
                  <Editor
                    height="100%"
                    language={files[activeEditorTab].language}
                    value={files[activeEditorTab].content}
                    onChange={(value) => updateFileContent(files[activeEditorTab].name, value || '')}
                    options={{
                      minimap: { enabled: false },
                      scrollBeyondLastLine: false,
                      fontSize: 14,
                      lineNumbers: 'on',
                      wordWrap: 'on',
                      automaticLayout: true,
                      tabSize: 2,
                      insertSpaces: true,
                    }}
                    theme="light"
                  />
                )}
              </div>
            </div>
            
            <div className="p-6 border-t border-gray-200 bg-gray-50 flex justify-end space-x-3">
              <button 
                onClick={handleCloseCreateAppDialog} 
                disabled={createAppLoading}
                className="px-4 py-2 text-gray-600 border border-gray-300 rounded-lg hover:bg-gray-50 disabled:opacity-50"
              >
                Cancel
              </button>
              <button 
                onClick={handleCreateOrUpdateApp}
                disabled={createAppLoading || files.length === 0 || !files.some(f => f.name === 'manifest.yaml')}
                className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:bg-gray-400 disabled:cursor-not-allowed flex items-center"
              >
                {createAppLoading ? (
                  <>
                    <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin mr-2"></div>
                    {editingArtifact ? 'Updating...' : 'Creating...'}
                  </>
                ) : (
                  editingArtifact ? 'Update app' : 'Create app'
                )}
              </button>
            </div>
          </div>
        </div>
      )}


    </div>
  );
};

export default BioEngine;