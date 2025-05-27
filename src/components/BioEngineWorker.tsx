import React, { useEffect, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { useHyphaStore } from '../store/hyphaStore';
import Editor from '@monaco-editor/react';
import yaml from 'js-yaml';


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
  const [deletingArtifactId, setDeletingArtifactId] = useState<string | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  
  // Create/Edit App Dialog state
  const [createAppDialogOpen, setCreateAppDialogOpen] = useState(false);
  const [editingArtifact, setEditingArtifact] = useState<ArtifactType | null>(null);
  const [activeEditorTab, setActiveEditorTab] = useState(0);
  const [createAppLoading, setCreateAppLoading] = useState(false);
  const [createAppError, setCreateAppError] = useState<string | null>(null);
  
  // File management state
  const [files, setFiles] = useState<Array<{name: string, content: string, language: string, lastModified?: string, size?: number, isEditable?: boolean}>>([]);
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
      // If no service ID, redirect to home
      navigate('/bioengine');
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

  const isUserOwnedArtifact = (artifactId: string): boolean => {
    const userWorkspace = server.config.workspace;
    return userWorkspace && artifactId.startsWith(userWorkspace);
  };

  const handleDeleteArtifact = async (artifactId: string) => {
    if (!artifactManager || !isLoggedIn) return;
    
    // Confirm deletion
    const artifactName = availableArtifacts.find(a => a.id === artifactId)?.manifest?.name || artifactId;
    if (!window.confirm(`Are you sure you want to delete "${artifactName}"? This action cannot be undone.`)) {
      return;
    }
    
    try {
      setDeleteError(null);
      setDeletingArtifactId(artifactId);
      
      await artifactManager.delete({
        artifact_id: artifactId, 
        delete_files: true, 
        recursive: true, 
        _rkwargs: true
      });
      
      // Refresh the available artifacts list
      await fetchAvailableArtifacts();
      
      setDeletingArtifactId(null);
      
      console.log(`Successfully deleted ${artifactId}`);
    } catch (err) {
      console.error('Deletion failed:', err);
      const errorMessage = err instanceof Error ? err.message : String(err);
      setDeleteError(`Failed to delete ${artifactId}: ${errorMessage}`);
      setDeletingArtifactId(null);
    }
  };



  // Default templates for new apps
  const getDefaultManifest = () => `id: my-new-app
name: My New App
description: A new BioEngine application
id_emoji: 🚀
type: application
# Optional: Add documentation and tutorial links
# documentation: https://example.com/docs
# tutorial: https://example.com/tutorial
# links:
#   - url: https://github.com/example/repo
#     label: Source Code
#     icon: 📦
#   - url: https://example.com/guide
#     label: User Guide
#     icon: 📖
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
      'dockerfile': 'dockerfile',
      'ijm': 'plaintext',
      'cfg': 'plaintext',
      'conf': 'plaintext',
      'ini': 'plaintext'
    };
    return languageMap[extension] || 'plaintext';
  };

  const isEditableFile = (fileName: string): boolean => {
    const extension = fileName.toLowerCase().split('.').pop() || '';
    const editableExtensions = [
      'yaml', 'yml', 'py', 'js', 'ts', 'json', 'md', 'txt', 'sh', 'ijm',
      'cfg', 'conf', 'ini', 'dockerfile', 'requirements', 'gitignore'
    ];
    return editableExtensions.includes(extension) || fileName === 'Dockerfile' || fileName === 'requirements.txt';
  };

  const formatFileSize = (bytes: number): string => {
    if (bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
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
    const isEditable = isEditableFile(fileName);
    setFiles(prevFiles => [...prevFiles, { name: fileName, content, language, isEditable }]);
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
          ? { ...file, name: newName, language: getFileLanguage(newName), isEditable: isEditableFile(newName) }
          : file
      )
    );
  };

  // Create App Dialog handlers
  const handleOpenCreateAppDialog = () => {
    setEditingArtifact(null);
    setFiles([
      { name: 'manifest.yaml', content: getDefaultManifest(), language: 'yaml', isEditable: true },
      { name: 'main.py', content: getDefaultMainPy(), language: 'python', isEditable: true }
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
      const loadedFiles: Array<{name: string, content: string, language: string, lastModified?: string, size?: number, isEditable?: boolean}> = [];
      
        // Always generate manifest.yaml from artifact.manifest metadata
      let manifestText = '';
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
        
      // Add manifest.yaml as the first file
      loadedFiles.push({
        name: 'manifest.yaml',
        content: manifestText,
        language: 'yaml',
        isEditable: true
      });
      
      // Get list of all files in the artifact
      try {
        const fileList = await artifactManager.list_files({artifact_id: artifact.id, _rkwargs: true});
        console.log('Files found in artifact:', fileList);
        
        // Filter out manifest.yaml since we already have it, and load other files
        const filesToLoad = fileList.filter((file: any) => 
          file.name !== 'manifest.yaml' && 
          !file.name.endsWith('/') && // Skip directories
          file.name.length > 0
        );
        
        // Load content for each file
        for (const fileInfo of filesToLoad) {
          try {
            const isEditable = isEditableFile(fileInfo.name);
            const lastModified = fileInfo.last_modified ? new Date(fileInfo.last_modified).toLocaleString() : undefined;
            const size = fileInfo.size || 0;

            if (isEditable) {
              console.log(`Loading editable file: ${fileInfo.name}`);
              const fileUrl = await artifactManager.get_file({
                artifact_id: artifact.id, 
                file_path: fileInfo.name, 
                _rkwargs: true
              });
              const response = await fetch(fileUrl);
              
              if (response.ok) {
                const content = await response.text();
                loadedFiles.push({
                  name: fileInfo.name,
                  content: content,
                  language: getFileLanguage(fileInfo.name),
                  lastModified,
                  size,
                  isEditable: true
                });
                console.log(`Successfully loaded ${fileInfo.name} (${content.length} chars)`);
              } else {
                console.warn(`Failed to fetch ${fileInfo.name}: ${response.status} ${response.statusText}`);
                // Add as non-editable if fetch failed
                loadedFiles.push({
                  name: fileInfo.name,
                  content: `// Failed to load file: ${response.status} ${response.statusText}`,
                  language: 'plaintext',
                  lastModified,
                  size,
                  isEditable: false
                });
              }
            } else {
              // Add binary/non-editable files to the list but don't load content
              console.log(`Adding non-editable file to list: ${fileInfo.name}`);
              loadedFiles.push({
                name: fileInfo.name,
                content: `// Binary file - not editable\n// Size: ${formatFileSize(size)}\n// Last modified: ${lastModified || 'Unknown'}`,
                language: 'plaintext',
                lastModified,
                size,
                isEditable: false
              });
            }
          } catch (fileErr) {
            console.warn(`Error processing file ${fileInfo.name}:`, fileErr);
            // Add as error file
            loadedFiles.push({
              name: fileInfo.name,
              content: `// Error loading file: ${fileErr}`,
              language: 'plaintext',
              lastModified: fileInfo.last_modified ? new Date(fileInfo.last_modified).toLocaleString() : undefined,
              size: fileInfo.size || 0,
              isEditable: false
            });
          }
        }
        
        // If no main.py was found in the files, add a default one
        if (!loadedFiles.some(f => f.name === 'main.py')) {
          console.log('No main.py found, adding default');
          loadedFiles.push({
            name: 'main.py',
            content: getDefaultMainPy(),
            language: 'python',
            isEditable: true
          });
        }
        
      } catch (listErr) {
        console.warn('Could not list files, falling back to default files:', listErr);
        // Fallback: try to load main.py individually
        try {
        const mainPyUrl = await artifactManager.get_file({artifact_id: artifact.id, file_path: 'main.py', _rkwargs: true});
        const mainPyResponse = await fetch(mainPyUrl);
          const mainPyText = await mainPyResponse.text();
          
          loadedFiles.push({
            name: 'main.py',
            content: mainPyText,
            language: 'python',
            isEditable: true
          });
          console.log('Successfully fetched main.py via fallback');
      } catch (fileErr) {
        console.warn('Could not fetch main.py file, using default:', fileErr);
          loadedFiles.push({
            name: 'main.py',
            content: getDefaultMainPy(),
            language: 'python',
            isEditable: true
          });
        }
      }
      
      setFiles(loadedFiles);
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
        
        <div className="bg-white/80 backdrop-blur-sm rounded-2xl shadow-sm border border-white/20 hover:shadow-md transition-all duration-200">
          <div className="p-6">
            <div className="flex items-center mb-4">
              <div className="w-10 h-10 bg-gradient-to-r from-purple-500 to-purple-600 rounded-xl flex items-center justify-center mr-3">
                <svg className="w-5 h-5 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10" />
                </svg>
              </div>
              <h3 className="text-lg font-semibold text-gray-800">Cluster Information</h3>
            </div>
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
        <div className="bg-white/80 backdrop-blur-sm rounded-2xl shadow-sm border border-white/20 mb-8 hover:shadow-md transition-all duration-200">
          <div className="p-6">
            <div className="flex justify-between items-center mb-6">
              <div className="flex items-center">
                <div className="w-10 h-10 bg-gradient-to-r from-green-500 to-green-600 rounded-xl flex items-center justify-center mr-3">
                  <svg className="w-5 h-5 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 12h14M5 12a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v4a2 2 0 01-2 2M5 12a2 2 0 00-2 2v4a2 2 0 002 2h14a2 2 0 002-2v-4a2 2 0 00-2-2m-2-4h.01M17 16h.01" />
                  </svg>
                </div>
                <h3 className="text-lg font-semibold text-gray-800">Worker Nodes</h3>
              </div>
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
      <div className="bg-white/80 backdrop-blur-sm rounded-2xl shadow-sm border border-white/20 mb-8 hover:shadow-md transition-all duration-200">
        <div className="p-6">
          <div className="flex justify-between items-center mb-6">
            <div className="flex items-center">
              <div className="w-10 h-10 bg-gradient-to-r from-indigo-500 to-indigo-600 rounded-xl flex items-center justify-center mr-3">
                <svg className="w-5 h-5 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19.428 15.428a2 2 0 00-1.022-.547l-2.387-.477a6 6 0 00-3.86.517l-.318.158a6 6 0 01-3.86.517L6.05 15.21a2 2 0 00-1.806.547M8 4h8l-1 1v5.172a2 2 0 00.586 1.414l5 5c1.26 1.26.367 3.414-1.415 3.414H4.828c-1.782 0-2.674-2.154-1.414-3.414l5-5A2 2 0 009 10.172V5L8 4z" />
                </svg>
              </div>
              <h3 className="text-lg font-semibold text-gray-800">Deployed BioEngine Apps</h3>
            </div>
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
            <div className="space-y-6">
              {deployments.map((deployment, index) => (
                <div key={index} className="p-6 bg-gradient-to-r from-white to-gray-50 border border-gray-200 rounded-2xl shadow-sm hover:shadow-md transition-all duration-200">
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
                      {deployment.manifest?.description && (
                        <p className="text-sm text-gray-600 mt-2">{deployment.manifest.description}</p>
                      )}
                      <DocumentationLinks manifest={deployment.manifest} artifactId={deployment.artifact_id} className="mt-3" />
                    </div>
                    
                    <div>
                      {undeployingArtifactId === deployment.artifact_id ? (
                        <button
                          disabled={true}
                          className="px-4 py-2 text-sm bg-gradient-to-r from-red-400 to-red-500 text-white rounded-xl opacity-50 cursor-not-allowed flex items-center shadow-sm"
                        >
                          <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin mr-2"></div>
                          {deployment.status === "DEPLOYING" ? "Cancel Deployment" : "Undeploy"}
                        </button>
                      ) : (
                        <button
                          onClick={() => handleUndeployArtifact(deployment.artifact_id)}
                          disabled={false}
                          className="px-4 py-2 text-sm bg-gradient-to-r from-red-500 to-red-600 text-white rounded-xl hover:from-red-600 hover:to-red-700 shadow-sm hover:shadow-md transition-all duration-200"
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
      <div className="bg-white/80 backdrop-blur-sm rounded-2xl shadow-sm border border-white/20 mb-8 hover:shadow-md transition-all duration-200">
        <div className="p-6">
          <div className="flex justify-between items-center mb-6">
            <div className="flex items-center">
              <div className="w-10 h-10 bg-white rounded-xl flex items-center justify-center mr-3 p-1">
                <img src="/bioengine-icon.svg" alt="BioEngine" className="w-8 h-8" />
              </div>
              <h3 className="text-lg font-semibold text-gray-800">Available Apps</h3>
            </div>
            <div className="flex gap-3">
              <button 
                onClick={handleOpenCreateAppDialog}
                disabled={deploymentLoading}
                className="px-6 py-3 bg-gradient-to-r from-blue-600 to-blue-700 text-white rounded-xl hover:from-blue-700 hover:to-blue-800 disabled:from-gray-400 disabled:to-gray-500 disabled:cursor-not-allowed flex items-center shadow-sm hover:shadow-md transition-all duration-200"
              >
                <svg className="w-4 h-4 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
                </svg>
                Create App
              </button>
              <button 
                onClick={fetchAvailableArtifacts}
                disabled={deploymentLoading}
                className="px-6 py-3 bg-white border-2 border-gray-200 text-gray-700 rounded-xl hover:bg-gray-50 hover:border-gray-300 disabled:bg-gray-100 disabled:cursor-not-allowed flex items-center shadow-sm hover:shadow-md transition-all duration-200"
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

          {/* Delete Error Display */}
          {deleteError && (
            <div className="mb-4 p-4 bg-red-50 border border-red-200 rounded-lg">
              <div className="flex justify-between items-start">
                <div className="flex">
                  <svg className="w-5 h-5 text-red-400 mr-2 mt-0.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                  </svg>
                  <div>
                    <h4 className="text-sm font-medium text-red-800">Delete Error</h4>
                    <p className="text-sm text-red-700 mt-1">{deleteError}</p>
                  </div>
                </div>
                <button
                  onClick={() => setDeleteError(null)}
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
            <div className="space-y-6">
              {availableArtifacts.map((artifact) => (
                <div 
                  key={artifact.id} 
                  className="p-6 bg-gradient-to-r from-white to-blue-50 border border-blue-100 rounded-2xl shadow-sm hover:shadow-md transition-all duration-200 hover:border-blue-200"
                >
                  <div className="flex justify-between items-start">
                    <div className="flex-1 mr-4">
                      <h4 className="text-lg font-semibold mb-1">
                        {artifact.manifest?.id_emoji || ""} {artifact.manifest?.name || artifact.name || artifact.alias}
                      </h4>
                      <p className="text-sm text-gray-500 mb-2">{artifact.id}</p>
                      <p className="text-gray-600 mb-3">{artifact.manifest?.description || artifact.description || "No description available"}</p>
                      <DocumentationLinks manifest={artifact.manifest} artifactId={artifact.id} className="mb-3" />
                    </div>
                    
                    <div className="flex flex-col items-end">
                      {artifact.supportedModes && (artifact.supportedModes.cpu && artifact.supportedModes.gpu) ? (
                        <div className="mb-2">
                          <div className="flex items-center bg-gray-100 rounded-lg p-1">
                            <button
                              onClick={() => handleModeChange(artifact.id, false)}
                              className={`px-3 py-1 text-xs font-medium rounded-md transition-colors ${
                                artifactModes[artifact.id] === 'cpu'
                                  ? 'bg-white text-blue-600 shadow-sm'
                                  : 'text-gray-600 hover:text-gray-800'
                              }`}
                            >
                              CPU
                            </button>
                            <button
                              onClick={() => handleModeChange(artifact.id, true)}
                              className={`px-3 py-1 text-xs font-medium rounded-md transition-colors ${
                                artifactModes[artifact.id] === 'gpu'
                                  ? 'bg-white text-purple-600 shadow-sm'
                                  : 'text-gray-600 hover:text-gray-800'
                              }`}
                            >
                              GPU
                            </button>
                          </div>
                        </div>
                      ) : null}
                      
                      <div className="flex gap-2">
                        <button
                          onClick={() => handleOpenEditAppDialog(artifact)}
                          disabled={deploymentLoading || createAppLoading}
                          className="px-4 py-2 text-sm bg-white border-2 border-gray-200 text-gray-700 rounded-xl hover:bg-gray-50 hover:border-gray-300 disabled:opacity-50 flex items-center shadow-sm hover:shadow-md transition-all duration-200"
                        >
                          <svg className="w-4 h-4 mr-1" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
                          </svg>
                          Edit
                        </button>
                        
                        {isUserOwnedArtifact(artifact.id) && (
                          deletingArtifactId === artifact.id ? (
                            <button
                              disabled={true}
                              className="px-4 py-2 text-sm bg-red-50 border-2 border-red-300 text-red-600 rounded-xl opacity-50 cursor-not-allowed flex items-center shadow-sm"
                            >
                              <div className="w-4 h-4 border-2 border-red-300 border-t-red-600 rounded-full animate-spin mr-1"></div>
                              Delete
                            </button>
                          ) : (
                            <button
                              onClick={() => handleDeleteArtifact(artifact.id)}
                              disabled={deletingArtifactId !== null || deploymentLoading || createAppLoading}
                              className="px-4 py-2 text-sm bg-red-50 border-2 border-red-300 text-red-600 rounded-xl hover:bg-red-100 hover:border-red-400 disabled:opacity-50 flex items-center shadow-sm hover:shadow-md transition-all duration-200"
                            >
                              <svg className="w-4 h-4 mr-1" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                              </svg>
                              Delete
                            </button>
                          )
                        )}
                        
                        {deployingArtifactId === artifact.id ? (
                          <button
                            disabled={true}
                            className="px-6 py-3 bg-gradient-to-r from-gray-400 to-gray-500 text-white rounded-xl cursor-not-allowed flex items-center shadow-sm"
                          >
                            <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin mr-2"></div>
                            Deploy
                          </button>
                        ) : (
                          <button
                            onClick={() => handleDeployArtifact(artifact.id, artifactModes[artifact.id])}
                            disabled={deployingArtifactId !== null && deployingArtifactId !== artifact.id}
                            className="px-6 py-3 bg-gradient-to-r from-blue-600 to-blue-700 text-white rounded-xl hover:from-blue-700 hover:to-blue-800 disabled:from-gray-400 disabled:to-gray-500 shadow-sm hover:shadow-md transition-all duration-200"
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
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-50 animate-fadeIn">
          <div className="bg-white/95 backdrop-blur-md rounded-2xl shadow-lg w-full max-w-6xl mx-4 h-5/6 flex flex-col border border-white/20 animate-slideUp">
            <div className="p-6 border-b border-gray-200/50 flex justify-between items-center">
              <div className="flex items-center">
                <div className="w-10 h-10 bg-gradient-to-r from-violet-500 to-purple-600 rounded-xl flex items-center justify-center mr-3">
                  <svg className="w-5 h-5 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 20l4-16m4 4l4 4-4 4M6 16l-4-4 4-4" />
                  </svg>
                </div>
                <h3 className="text-lg font-semibold text-gray-800">
                  {editingArtifact ? `Edit app: ${editingArtifact.manifest?.name || editingArtifact.alias}` : 'Create new app'}
                </h3>
              </div>
              <button
                onClick={handleCloseCreateAppDialog}
                className="text-gray-400 hover:text-gray-600 p-2 rounded-xl hover:bg-gray-100 transition-all duration-200"
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
                      } ${!file.isEditable ? 'opacity-60' : ''}`}
                      title={file.isEditable ? 
                        `${file.name}${file.size ? ` (${formatFileSize(file.size)})` : ''}${file.lastModified ? ` - Modified: ${file.lastModified}` : ''}` :
                        `${file.name} - Read-only${file.size ? ` (${formatFileSize(file.size)})` : ''}`
                      }
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
                          <div className="flex items-center gap-1">
                            {!file.isEditable && (
                              <svg className="w-3 h-3 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
                              </svg>
                            )}
                          <span 
                              onDoubleClick={() => file.isEditable && handleFileNameEdit(file.name)}
                              className={file.isEditable ? "cursor-pointer" : "cursor-default"}
                          >
                            {file.name}
                          </span>
                          </div>
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
                  <div className="h-full flex flex-col">
                    {/* File info bar for non-editable files */}
                    {!files[activeEditorTab].isEditable && (
                      <div className="bg-amber-50 border-b border-amber-200 px-4 py-2 text-sm text-amber-800">
                        <div className="flex items-center gap-2">
                          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-2.5L13.732 4c-.77-.833-1.732-.833-2.5 0L4.314 16.5c-.77.833.192 2.5 1.732 2.5z" />
                          </svg>
                          <span className="font-medium">Read-only file</span>
                          {files[activeEditorTab].size && (
                            <span>• Size: {formatFileSize(files[activeEditorTab].size!)}</span>
                          )}
                          {files[activeEditorTab].lastModified && (
                            <span>• Modified: {files[activeEditorTab].lastModified}</span>
                          )}
                        </div>
                      </div>
                    )}
                    
                    <div className="flex-1">
                  <Editor
                    height="100%"
                    language={files[activeEditorTab].language}
                    value={files[activeEditorTab].content}
                        onChange={(value) => {
                          if (files[activeEditorTab].isEditable) {
                            updateFileContent(files[activeEditorTab].name, value || '');
                          }
                        }}
                    options={{
                      minimap: { enabled: false },
                      scrollBeyondLastLine: false,
                      fontSize: 14,
                      lineNumbers: 'on',
                      wordWrap: 'on',
                      automaticLayout: true,
                      tabSize: 2,
                      insertSpaces: true,
                          readOnly: !files[activeEditorTab].isEditable,
                    }}
                    theme="light"
                  />
                    </div>
                  </div>
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
    </div>
  );
};

export default BioEngineWorker;