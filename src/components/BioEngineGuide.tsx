import React, { useState, useRef, useEffect } from 'react';

type OSType = 'macos' | 'linux' | 'windows';
type ModeType = 'single-machine' | 'slurm' | 'connect';
type ArchType = 'amd64' | 'arm64';
type ContainerRuntimeType = 'docker' | 'podman';

const BioEngineGuide: React.FC = () => {
  const [os, setOS] = useState<OSType>('macos');
  const [arch, setArch] = useState<ArchType>('arm64');
  const [mode, setMode] = useState<ModeType>('single-machine');
  const [containerRuntime, setContainerRuntime] = useState<ContainerRuntimeType>('docker');
  const [cpus, setCpus] = useState(2);
  const [hasGpu, setHasGpu] = useState(false);
  const [gpus, setGpus] = useState(1);
  const [runAsRoot, setRunAsRoot] = useState(false);
  const [copied, setCopied] = useState(false);
  const [isExpanded, setIsExpanded] = useState(false);
  const [showAdvanced, setShowAdvanced] = useState(false);
  
  // Advanced options
  const [workspace, setWorkspace] = useState('');
  const [serverUrl, setServerUrl] = useState('');
  const [token, setToken] = useState('');
  const [rayAddress, setRayAddress] = useState('');
  const [adminUsers, setAdminUsers] = useState('*');
  const [logDir, setLogDir] = useState('');
  const [cacheDir, setCacheDir] = useState('');
  const [showTroubleshooting, setShowTroubleshooting] = useState(false);
  const [promptCopied, setPromptCopied] = useState(false);
  const [interactiveMode, setInteractiveMode] = useState(false);
  const [shmSize, setShmSize] = useState('2g');

  // Ref for the troubleshooting dialog
  const troubleshootingDialogRef = useRef<HTMLDivElement>(null);

  // Effect to scroll to dialog when troubleshooting opens
  useEffect(() => {
    if (showTroubleshooting && troubleshootingDialogRef.current) {
      // Small delay to ensure the dialog is rendered
      setTimeout(() => {
        troubleshootingDialogRef.current?.scrollIntoView({
          behavior: 'smooth',
          block: 'center',
          inline: 'center'
        });
      }, 100);
    }
  }, [showTroubleshooting]);

  const getPlatform = () => {
    return `linux/${arch}`;
  };

  const getUserFlag = () => {
    if (runAsRoot) return '';
    
    switch (os) {
      case 'windows':
        return ''; // Windows doesn't use the same user flag
      default:
        return '--user $(id -u):$(id -g) ';
    }
  };

  const getGpuFlag = () => {
    if (!hasGpu) return '';
    
    if (containerRuntime === 'podman') {
      // Podman uses --device for GPU access
      return '--device nvidia.com/gpu=all ';
    } else {
      // Docker uses --gpus
      return '--gpus=all ';
    }
  };

  const getCommand = () => {
    // Base arguments - exclude --mode for SLURM since the script handles it automatically
    let args: string[] = [];
    
    // Add mode argument only for non-SLURM modes
    if (mode !== 'slurm') {
      args.push(`--mode ${mode}`);
    }
    
    // Mode-specific arguments
    if (mode === 'single-machine') {
      args.push(`--head_num_cpus ${cpus}`);
      if (hasGpu) {
        args.push(`--head_num_gpus ${gpus}`);
      }
    } else if (mode === 'connect' && rayAddress) {
      args.push(`--ray_address ${rayAddress}`);
    }
    
    // Advanced arguments
    if (workspace) args.push(`--workspace ${workspace}`);
    if (serverUrl) args.push(`--server_url ${serverUrl}`);
    if (token) args.push(`--token ${token}`);
    
    // Handle admin users - space separated
    if (adminUsers && adminUsers !== '*') {
      const users = adminUsers.split(',').map(u => u.trim()).join(' ');
      args.push(`--admin_users ${users}`);
    } else if (adminUsers === '*') {
      args.push(`--admin_users "*"`);
    }
    
    if (logDir) args.push(`--log_dir ${logDir}`);
    if (cacheDir) args.push(`--cache_dir ${cacheDir}`);
    
    const argsString = args.length > 0 ? args.join(' ') : '';
    
    // SLURM mode uses the bash script instead of Docker
    if (mode === 'slurm') {
      if (interactiveMode) {
        return {
          dockerCmd: `# Download and inspect the script first (optional)`,
          pythonCmd: `bash <(curl -s https://raw.githubusercontent.com/aicell-lab/bioengine-worker/bioengine-worker/scripts/start_worker.sh)${argsString ? ` ${argsString}` : ''}`
        };
      } else {
        return `bash <(curl -s https://raw.githubusercontent.com/aicell-lab/bioengine-worker/bioengine-worker/scripts/start_worker.sh)${argsString ? ` ${argsString}` : ''}`;
      }
    }
    
    // For single-machine and connect modes, use Docker
    const platform = getPlatform();
    const userFlag = getUserFlag();
    const gpuFlag = getGpuFlag();
    const shmFlag = `--shm-size=${shmSize} `;
    
    // Determine mount directories and host paths
    let mountDir = '/tmp';
    let hostMountPath = '';
    let volumeMounts = '';
    
    if (os === 'windows') {
      hostMountPath = runAsRoot ? 'C:\\bioengine-workdir' : '%USERPROFILE%\\bioengine-workdir';
    } else if (os === 'macos') {
      hostMountPath = '$HOME/bioengine-workdir';
    } else {
      // Linux
      hostMountPath = '$HOME/bioengine-workdir';
    }
    
    // If user specified a custom cache directory, use it as the mount point
    if (cacheDir) {
      mountDir = cacheDir;
    }
    
    // Build volume mounts string
    volumeMounts = `-v ${hostMountPath}:${mountDir}`;
    
    // Add log directory mount if specified
    if (logDir) {
      if (os === 'windows') {
        const hostLogPath = runAsRoot ? 'C:\\bioengine-logs' : '%USERPROFILE%\\bioengine-logs';
        volumeMounts += ` -v ${hostLogPath}:${logDir}`;
      } else {
        volumeMounts += ` -v $HOME/bioengine-logs:${logDir}`;
      }
    }
    
    // Create directory creation commands
    let createDirCmd = '';
    if (os === 'windows') {
      const workdirPath = runAsRoot ? 'C:\\bioengine-workdir' : '%USERPROFILE%\\bioengine-workdir';
      createDirCmd = `mkdir "${workdirPath}" 2>nul || echo Directory already exists`;
      if (logDir) {
        const logPath = runAsRoot ? 'C:\\bioengine-logs' : '%USERPROFILE%\\bioengine-logs';
        createDirCmd += ` && mkdir "${logPath}" 2>nul || echo Log directory already exists`;
      }
    } else {
      createDirCmd = `mkdir -p $HOME/bioengine-workdir`;
      if (logDir) {
        createDirCmd += ` && mkdir -p $HOME/bioengine-logs`;
      }
    }
    
    if (interactiveMode) {
      // Interactive mode - separate container run and python command with --entrypoint bash
      const containerCmd = os === 'windows' 
        ? `${containerRuntime} run --platform ${platform} --rm -it ${shmFlag}--entrypoint bash ${gpuFlag}${volumeMounts} ghcr.io/aicell-lab/bioengine-worker:0.1.17`
        : `${containerRuntime} run --platform ${platform} --rm -it ${shmFlag}${userFlag}--entrypoint bash ${gpuFlag}${volumeMounts} ghcr.io/aicell-lab/bioengine-worker:0.1.17`;
      
      const pythonCmd = `python -m bioengine_worker ${argsString}`;
      
      return { 
        createDirCmd,
        dockerCmd: containerCmd, 
        pythonCmd 
      };
    } else {
      // Single command mode
      let dockerCmd = '';
      if (os === 'windows') {
        dockerCmd = `${containerRuntime} run ${gpuFlag}--platform ${platform} -it --rm ${shmFlag}${volumeMounts} ghcr.io/aicell-lab/bioengine-worker:0.1.17 python -m bioengine_worker ${argsString}`;
      } else {
        dockerCmd = `${containerRuntime} run ${gpuFlag}--platform ${platform} -it --rm ${shmFlag}${userFlag}${volumeMounts} ghcr.io/aicell-lab/bioengine-worker:0.1.17 python -m bioengine_worker ${argsString}`;
      }
      
      return {
        createDirCmd,
        dockerCmd
      };
    }
  };

  const copyToClipboard = async () => {
    try {
      const command = getCommand();
      const containerName = containerRuntime.charAt(0).toUpperCase() + containerRuntime.slice(1);
      
      let textToCopy = '';
      
      if (typeof command === 'string') {
        // SLURM mode - simple string
        textToCopy = command;
      } else if (command.pythonCmd) {
        // Interactive mode
        textToCopy = `# Step 1: Create directories\n${command.createDirCmd}\n\n# Step 2: Start ${containerName} container\n${command.dockerCmd}\n\n# Step 3: Inside the container, run:\n${command.pythonCmd}`;
      } else {
        // Single command mode
        textToCopy = `# Step 1: Create directories\n${command.createDirCmd}\n\n# Step 2: Run ${containerName} container\n${command.dockerCmd}`;
      }
      
      await navigator.clipboard.writeText(textToCopy);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch (err) {
      console.error('Failed to copy:', err);
    }
  };

  const getTroubleshootingPrompt = () => {
    const currentCommand = getCommand();
    const containerName = containerRuntime.charAt(0).toUpperCase() + containerRuntime.slice(1);
    
    let commandText = '';
    if (typeof currentCommand === 'string') {
      // SLURM mode - simple string
      commandText = currentCommand;
    } else if (currentCommand.pythonCmd) {
      // Interactive mode
      commandText = `# Step 1: Create directories\n${currentCommand.createDirCmd}\n\n# Step 2: Start ${containerName} container\n${currentCommand.dockerCmd}\n\n# Step 3: Inside the container, run:\n${currentCommand.pythonCmd}`;
    } else {
      // Single command mode
      commandText = `# Step 1: Create directories\n${currentCommand.createDirCmd}\n\n# Step 2: Run ${containerName} container\n${currentCommand.dockerCmd}`;
    }
    
    return `# BioEngine Worker Troubleshooting Assistant

## Context & Background

I'm trying to set up a **BioEngine Worker** for bioimage analysis. BioEngine is part of the AI4Life project and provides cloud-powered AI tools for bioimage analysis. Here's what I need help with:

### What is BioEngine?
- BioEngine is a distributed computing platform for running AI models on bioimage data
- It uses Ray (distributed computing framework) and Hypha (service orchestration) 
- Workers can run in different modes: single-machine (local), SLURM (HPC clusters), or connect to existing Ray clusters
- The system allows deploying and running AI models for bioimage analysis tasks

### My Current Setup
- **Operating System**: ${os === 'macos' ? 'macOS' : os === 'linux' ? 'Linux' : 'Windows'}
- **Architecture**: ${arch === 'arm64' ? 'ARM64 (Apple Silicon)' : 'AMD64 (x86_64)'}
- **Container Runtime**: ${containerName}${mode !== 'slurm' ? ` (${containerRuntime === 'docker' ? 'traditional container runtime' : 'daemonless, rootless alternative to Docker'})` : ''}
- **Mode**: ${mode === 'single-machine' ? 'Single Machine (local Ray cluster)' : mode === 'slurm' ? 'SLURM (HPC cluster with bash script)' : 'Connect to existing Ray cluster'}
${mode === 'single-machine' ? `- **CPUs**: ${cpus}
- **GPUs**: ${hasGpu ? gpus : 'None'}` : ''}
${mode === 'connect' && rayAddress ? `- **Ray Address**: ${rayAddress}` : ''}
${mode !== 'slurm' ? `- **Run as Root**: ${runAsRoot ? 'Yes' : 'No'}
- **Shared Memory Size**: ${shmSize}` : ''}
- **Interactive Mode**: ${interactiveMode ? (mode === 'slurm' ? 'Yes (can inspect script before running)' : `Yes (separate ${containerName} and Python commands with --entrypoint bash)`) : 'No (single command)'}

### Advanced Configuration
${workspace ? `- **Workspace**: ${workspace}` : ''}
${serverUrl ? `- **Server URL**: ${serverUrl}` : ''}
${token ? `- **Token**: [CONFIGURED]` : ''}
${adminUsers ? `- **Admin Users**: ${adminUsers}` : ''}
${logDir ? `- **Log Directory**: ${logDir}` : ''}
${cacheDir ? `- **Cache Directory**: ${cacheDir}` : ''}

### Generated ${containerName} Command
\`\`\`bash
${commandText}
\`\`\`

## Complete BioEngine Worker Help Reference

\`\`\`
python -m bioengine_worker --help
usage: __main__.py [-h] [--mode {slurm,single-machine,connect}] [--log_dir LOG_DIR]
                   [--cache_dir CACHE_DIR] [--debug] [--workspace WORKSPACE]
                   [--server_url SERVER_URL] [--token TOKEN]
                   [--worker_service_id WORKER_SERVICE_ID] [--client_id CLIENT_ID]
                   [--data_dir DATA_DIR] [--dataset_service_id DATASET_SERVICE_ID]
                   [--head_node_ip HEAD_NODE_IP] [--head_node_port HEAD_NODE_PORT]
                   [--node_manager_port NODE_MANAGER_PORT]
                   [--object_manager_port OBJECT_MANAGER_PORT]
                   [--redis_shard_port REDIS_SHARD_PORT] [--serve_port SERVE_PORT]
                   [--dashboard_port DASHBOARD_PORT]
                   [--ray_client_server_port RAY_CLIENT_SERVER_PORT]
                   [--redis_password REDIS_PASSWORD] [--ray_temp_dir RAY_TEMP_DIR]
                   [--head_num_cpus HEAD_NUM_CPUS] [--head_num_gpus HEAD_NUM_GPUS]
                   [--skip_cleanup] [--image IMAGE] [--worker_data_dir WORKER_DATA_DIR]
                   [--slurm_log_dir SLURM_LOG_DIR]
                   [--further_slurm_args FURTHER_SLURM_ARGS [FURTHER_SLURM_ARGS ...]]
                   [--default_num_gpus DEFAULT_NUM_GPUS]
                   [--default_num_cpus DEFAULT_NUM_CPUS]
                   [--default_mem_per_cpu DEFAULT_MEM_PER_CPU]
                   [--default_time_limit DEFAULT_TIME_LIMIT] [--min_workers MIN_WORKERS]
                   [--max_workers MAX_WORKERS]
                   [--metrics_interval_seconds METRICS_INTERVAL_SECONDS]
                   [--gpu_idle_threshold GPU_IDLE_THRESHOLD]
                   [--cpu_idle_threshold CPU_IDLE_THRESHOLD]
                   [--scale_down_threshold_seconds SCALE_DOWN_THRESHOLD_SECONDS]
                   [--scale_up_cooldown_seconds SCALE_UP_COOLDOWN_SECONDS]
                   [--scale_down_cooldown_seconds SCALE_DOWN_COOLDOWN_SECONDS]
                   [--node_grace_period_seconds NODE_GRACE_PERIOD_SECONDS]
                   [--deployment_service_id DEPLOYMENT_SERVICE_ID]
                   [--admin_users ADMIN_USERS [ADMIN_USERS ...]]
                   [--startup_deployments STARTUP_DEPLOYMENTS [STARTUP_DEPLOYMENTS ...]]
                   [--deployment_cache_dir DEPLOYMENT_CACHE_DIR]
                   [--ray_address RAY_ADDRESS] [--ray_namespace RAY_NAMESPACE]

BioEngine Worker Registration

options:
  -h, --help            show this help message and exit
  --mode {slurm,single-machine,connect}
                        Mode of operation: 'slurm' for managing a Ray cluster with SLURM
                        jobs, 'single-machine' for local Ray cluster, 'connect' for
                        connecting to an existing Ray cluster.
  --log_dir LOG_DIR     Directory for logs. This should be a mounted directory if running
                        in container.
  --cache_dir CACHE_DIR
                        Directory for caching data. This should be a mounted directory if
                        running in container.
  --debug               Set logger to debug level

Hypha Options:
  --workspace WORKSPACE
                        Hypha workspace to connect to
  --server_url SERVER_URL
                        URL of the Hypha server
  --token TOKEN         Authentication token for Hypha server
  --worker_service_id WORKER_SERVICE_ID
                        Service ID for the worker
  --client_id CLIENT_ID
                        Client ID for the worker. If not set, a client ID will be generated
                        automatically.

Dataset Manager Options:
  --data_dir DATA_DIR   Data directory served by the dataset manager. This should be a
                        mounted directory if running in container.
  --dataset_service_id DATASET_SERVICE_ID
                        Service ID for the dataset manager

Ray Cluster Manager Options:
  --head_node_ip HEAD_NODE_IP
                        IP address for head node. Uses first system IP if None
  --head_node_port HEAD_NODE_PORT
                        Port for Ray head node and GCS server
  --node_manager_port NODE_MANAGER_PORT
                        Port for Ray node manager services
  --object_manager_port OBJECT_MANAGER_PORT
                        Port for object manager service
  --redis_shard_port REDIS_SHARD_PORT
                        Port for Redis sharding
  --serve_port SERVE_PORT
                        Port for Ray Serve
  --dashboard_port DASHBOARD_PORT
                        Port for Ray dashboard
  --ray_client_server_port RAY_CLIENT_SERVER_PORT
                        Port for Ray client server
  --redis_password REDIS_PASSWORD
                        Redis password for Ray cluster
  --ray_temp_dir RAY_TEMP_DIR
                        Temporary directory for Ray. If not set, defaults to
                        '<cache_dir>/ray_sessions'. This should be a mounted directory if
                        running in container.
  --head_num_cpus HEAD_NUM_CPUS
                        Number of CPUs for head node if starting locally
  --head_num_gpus HEAD_NUM_GPUS
                        Number of GPUs for head node if starting locally
  --skip_cleanup        Skip cleanup of previous Ray cluster
  --image IMAGE         Worker image for SLURM job
  --worker_data_dir WORKER_DATA_DIR
                        Data directory mounted to the container when starting a worker. If
                        not set, the data_dir will be used.
  --slurm_log_dir SLURM_LOG_DIR
                        Directory for SLURM job logs. If not set, the log_dir will be used.
  --further_slurm_args FURTHER_SLURM_ARGS [FURTHER_SLURM_ARGS ...]
                        Additional arguments for SLURM job script

Ray Autoscaler Options:
  --default_num_gpus DEFAULT_NUM_GPUS
                        Default number of GPUs per worker
  --default_num_cpus DEFAULT_NUM_CPUS
                        Default number of CPUs per worker
  --default_mem_per_cpu DEFAULT_MEM_PER_CPU
                        Default memory per CPU in GB
  --default_time_limit DEFAULT_TIME_LIMIT
                        Default time limit for workers
  --min_workers MIN_WORKERS
                        Minimum number of worker nodes
  --max_workers MAX_WORKERS
                        Maximum number of worker nodes
  --metrics_interval_seconds METRICS_INTERVAL_SECONDS
                        Interval for collecting metrics
  --gpu_idle_threshold GPU_IDLE_THRESHOLD
                        GPU utilization threshold for idle nodes
  --cpu_idle_threshold CPU_IDLE_THRESHOLD
                        CPU utilization threshold for idle nodes
  --scale_down_threshold_seconds SCALE_DOWN_THRESHOLD_SECONDS
                        Time threshold before scaling down idle nodes
  --scale_up_cooldown_seconds SCALE_UP_COOLDOWN_SECONDS
                        Cooldown period before scaling up
  --scale_down_cooldown_seconds SCALE_DOWN_COOLDOWN_SECONDS
                        Cooldown period before scaling down
  --node_grace_period_seconds NODE_GRACE_PERIOD_SECONDS
                        Grace period before considering a node for scaling down

Ray Deployment Manager Options:
  --deployment_service_id DEPLOYMENT_SERVICE_ID
                        Service ID for deployed models
  --admin_users ADMIN_USERS [ADMIN_USERS ...]
                        List of admin users for the deployment
  --startup_deployments STARTUP_DEPLOYMENTS [STARTUP_DEPLOYMENTS ...]
                        List of artifact IDs to deploy on worker startup
  --deployment_cache_dir DEPLOYMENT_CACHE_DIR
                        Working directory for Ray Serve deployments. If not set, defaults
                        to cache_dir. This should be a mounted directory if running in
                        container.

Ray Connection Options:
  --ray_address RAY_ADDRESS
                        Address of existing Ray cluster to connect to
  --ray_namespace RAY_NAMESPACE
                        Ray namespace to use
\`\`\`

## Troubleshooting Chain of Thought

When helping me troubleshoot, please consider:

1. **${containerName} Issues** (single-machine/connect modes): Container startup, platform compatibility, volume mounting
2. **SLURM Issues** (SLURM mode): Job submission, resource allocation, container runtime, shared filesystem
3. **Network Issues**: Port conflicts, firewall settings, connectivity
4. **Resource Issues**: CPU/GPU allocation, memory constraints
5. **Permission Issues**: User permissions, file access, ${containerRuntime} daemon access, SLURM account permissions
6. **Ray Cluster Issues**: Ray startup, cluster connectivity, node communication
7. **Hypha Integration**: Workspace access, authentication, service registration
8. **Configuration Issues**: Invalid arguments, missing dependencies, environment setup

## Common Issues to Check

${mode === 'slurm' ? `### SLURM Mode Specific:
- SLURM commands (sbatch, squeue, scancel) are available and working
- Sufficient SLURM allocation and account permissions
- Singularity/Apptainer is installed on compute nodes
- Shared filesystem is accessible from all nodes
- Network connectivity from compute nodes to download container images
- Proper SLURM partition and QOS settings
- Container image can be pulled and cached successfully

### General:` : `- ${containerName} is installed and running (for single-machine/connect modes)`}
- Sufficient system resources (CPU, memory, disk space)
- Network ports are available (especially for Ray cluster communication)
${mode !== 'slurm' ? '- A bioengine-workdir directory will be created in your home directory for data mounting' : ''}
${mode === 'single-machine' && hasGpu ? `- For GPU mode: NVIDIA ${containerRuntime === 'docker' ? 'Docker runtime' : 'container toolkit'} is installed` : ''}
${mode === 'connect' ? '- For connect mode: Target Ray cluster is running and accessible' : ''}

## My Question

[Please describe your specific issue or question here. For example:
- Error messages you're seeing
- What you expected to happen vs what actually happened
- Steps you've already tried
- Any specific error logs or output]

Please help me troubleshoot this BioEngine Worker setup. Provide step-by-step guidance and explain the reasoning behind each suggestion.`;
  };

  const copyTroubleshootingPrompt = async () => {
    try {
      await navigator.clipboard.writeText(getTroubleshootingPrompt());
      setPromptCopied(true);
      setTimeout(() => setPromptCopied(false), 2000);
    } catch (err) {
      console.error('Failed to copy prompt:', err);
    }
  };

  return (
    <div className="mt-6 border-t border-gray-200 pt-4">
      <button
        onClick={() => setIsExpanded(!isExpanded)}
        className={`w-full flex items-center justify-between text-left rounded-xl p-4 transition-all duration-200 ${
          isExpanded 
            ? 'bg-gray-50 hover:bg-gray-100 border border-gray-200' 
            : 'bg-gradient-to-r from-blue-50 to-purple-50 hover:from-blue-100 hover:to-purple-100 border-2 border-blue-200 hover:border-blue-300 shadow-sm hover:shadow-md'
        }`}
      >
        <div className="flex items-center">
          <div className={`rounded-xl flex items-center justify-center mr-4 transition-all duration-200 ${
            isExpanded 
              ? 'w-8 h-8 bg-gradient-to-r from-gray-400 to-gray-500' 
              : 'w-12 h-12 bg-gradient-to-r from-cyan-500 to-blue-600 shadow-md'
          }`}>
            <svg className={`text-white transition-all duration-200 ${isExpanded ? 'w-4 h-4' : 'w-6 h-6'}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
          </div>
          <div>
            <h4 className={`font-semibold transition-all duration-200 ${
              isExpanded 
                ? 'text-sm text-gray-700' 
                : 'text-lg text-gray-800'
            }`}>Launch Your Own BioEngine Instance</h4>
            <p className={`text-gray-500 transition-all duration-200 ${
              isExpanded 
                ? 'text-xs' 
                : 'text-sm font-medium'
            }`}>Access our powerful deployment configurator</p>
          </div>
        </div>
        <div className="flex items-center">
          <span className={`text-gray-500 mr-3 transition-all duration-200 ${
            isExpanded 
              ? 'text-xs' 
              : 'text-sm font-medium'
          }`}>{isExpanded ? 'Hide' : 'Show'}</span>
          <svg 
            className={`text-gray-400 transition-all duration-200 ${
              isExpanded 
                ? 'w-4 h-4 rotate-180' 
                : 'w-5 h-5'
            }`} 
            fill="none" 
            stroke="currentColor" 
            viewBox="0 0 24 24"
          >
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
          </svg>
        </div>
      </button>

        {isExpanded && (
          <div className="mt-4 space-y-6">
            {/* Primary Mode Selection - More Prominent */}
            <div className="bg-gradient-to-r from-blue-50 to-purple-50 p-6 rounded-xl border border-blue-200">
              <h4 className="text-lg font-semibold text-gray-800 mb-4 flex items-center">
                <svg className="w-5 h-5 mr-2 text-blue-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10" />
                </svg>
                Where do you want to run BioEngine?
              </h4>
              
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                {/* Desktop/Workstation Option */}
                <div 
                  className={`p-4 rounded-lg border-2 cursor-pointer transition-all duration-200 ${
                    mode === 'single-machine' 
                      ? 'border-blue-500 bg-blue-50 shadow-md' 
                      : 'border-gray-200 bg-white hover:border-blue-300 hover:shadow-sm'
                  }`}
                  onClick={() => setMode('single-machine')}
                >
                  <div className="flex items-center mb-2">
                    <input
                      type="radio"
                      name="deployment-mode"
                      value="single-machine"
                      checked={mode === 'single-machine'}
                      onChange={(e) => setMode(e.target.value as ModeType)}
                      className="w-4 h-4 text-blue-600 bg-gray-100 border-gray-300 focus:ring-blue-500"
                      aria-label="Desktop/Workstation deployment mode"
                    />
                    <span className="ml-2 font-medium text-gray-800">💻 Desktop/Workstation</span>
                  </div>
                  <p className="text-sm text-gray-600 ml-6">
                    Run locally on your personal computer or workstation using Docker. 
                    Perfect for development, testing, or small-scale analysis.
                  </p>
                  <div className="mt-2 ml-6">
                    <span className="inline-block px-2 py-1 text-xs bg-green-100 text-green-700 rounded">
                      Easy Setup
                    </span>
                  </div>
                </div>

                {/* HPC Cluster Option */}
                <div 
                  className={`p-4 rounded-lg border-2 cursor-pointer transition-all duration-200 ${
                    mode === 'slurm' 
                      ? 'border-purple-500 bg-purple-50 shadow-md' 
                      : 'border-gray-200 bg-white hover:border-purple-300 hover:shadow-sm'
                  }`}
                  onClick={() => setMode('slurm')}
                >
                  <div className="flex items-center mb-2">
                    <input
                      type="radio"
                      name="deployment-mode"
                      value="slurm"
                      checked={mode === 'slurm'}
                      onChange={(e) => setMode(e.target.value as ModeType)}
                      className="w-4 h-4 text-purple-600 bg-gray-100 border-gray-300 focus:ring-purple-500"
                      aria-label="HPC Cluster deployment mode"
                    />
                    <span className="ml-2 font-medium text-gray-800">🖥️ HPC Cluster</span>
                  </div>
                  <p className="text-sm text-gray-600 ml-6">
                    Deploy on a high-performance computing cluster with SLURM job scheduler. 
                    Ideal for large-scale processing and production workloads.
                  </p>
                  <div className="mt-2 ml-6">
                    <span className="inline-block px-2 py-1 text-xs bg-purple-100 text-purple-700 rounded">
                      High Performance
                    </span>
                  </div>
                </div>

                {/* Connect to Existing Option */}
                <div 
                  className={`p-4 rounded-lg border-2 cursor-pointer transition-all duration-200 ${
                    mode === 'connect' 
                      ? 'border-orange-500 bg-orange-50 shadow-md' 
                      : 'border-gray-200 bg-white hover:border-orange-300 hover:shadow-sm'
                  }`}
                  onClick={() => setMode('connect')}
                >
                  <div className="flex items-center mb-2">
                    <input
                      type="radio"
                      name="deployment-mode"
                      value="connect"
                      checked={mode === 'connect'}
                      onChange={(e) => setMode(e.target.value as ModeType)}
                      className="w-4 h-4 text-orange-600 bg-gray-100 border-gray-300 focus:ring-orange-500"
                      aria-label="Connect to existing cluster deployment mode"
                    />
                    <span className="ml-2 font-medium text-gray-800">🔗 Connect to Ray Cluster</span>
                  </div>
                  <p className="text-sm text-gray-600 ml-6">
                    Connect to an existing Ray cluster that's already running. 
                    BioEngine won't manage the cluster - you provide the Ray address.
                  </p>
                  <div className="mt-2 ml-6">
                    <span className="inline-block px-2 py-1 text-xs bg-orange-100 text-orange-700 rounded">
                      External Cluster
                    </span>
                  </div>
                </div>
              </div>

              {/* Ray Address Input for Connect Mode */}
              {mode === 'connect' && (
                <div className="mt-4 p-4 bg-orange-50 rounded-lg border border-orange-200">
                  <label className="block text-sm font-medium text-orange-800 mb-2">
                    Ray Cluster Address (Required)
                  </label>
                  <input
                    type="text"
                    value={rayAddress}
                    onChange={(e) => setRayAddress(e.target.value)}
                    placeholder="ray://head-node-ip:10001"
                    className="w-full px-3 py-2 border border-orange-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-orange-500 focus:border-orange-500"
                    aria-label="Ray cluster address"
                  />
                  <p className="text-xs text-orange-700 mt-1">
                    Enter the address of your existing Ray cluster. The cluster must be running and accessible from your network.
                  </p>
                </div>
              )}
            </div>

            {/* System Configuration - only show for non-SLURM modes */}
            {mode !== 'slurm' && (
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                {/* Operating System */}
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">Operating System</label>
                  <select
                    value={os}
                    onChange={(e) => setOS(e.target.value as OSType)}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                    aria-label="Select operating system"
                  >
                    <option value="macos">macOS</option>
                    <option value="linux">Linux</option>
                    <option value="windows">Windows</option>
                  </select>
                  <p className="text-xs text-gray-500 mt-1">
                    {os === 'windows' ? 'PowerShell/Command Prompt commands' : 'Bash/Terminal commands'}
                  </p>
                </div>

                {/* Architecture */}
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">Architecture</label>
                  <select
                    value={arch}
                    onChange={(e) => setArch(e.target.value as ArchType)}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                    aria-label="Select architecture"
                  >
                    <option value="amd64">AMD64 (x86_64)</option>
                    <option value="arm64">ARM64 (Apple Silicon)</option>
                  </select>
                  <p className="text-xs text-gray-500 mt-1">
                    {arch === 'arm64' ? 'Apple M1/M2/M3 or ARM processors' : 'Intel/AMD x86_64 processors'}
                  </p>
                </div>

                {/* Container Runtime */}
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">Container Runtime</label>
                  <select
                    value={containerRuntime}
                    onChange={(e) => setContainerRuntime(e.target.value as ContainerRuntimeType)}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                    aria-label="Select container runtime"
                  >
                    <option value="docker">Docker</option>
                    <option value="podman">Podman</option>
                  </select>
                  <p className="text-xs text-gray-500 mt-1">
                    {containerRuntime === 'docker' 
                      ? 'Docker - Most common container runtime' 
                      : 'Podman - Daemonless, rootless alternative to Docker'}
                  </p>
                </div>

                {/* CPU Count - only for single-machine mode */}
                {mode === 'single-machine' && (
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-2">CPU Cores</label>
                    <input
                      type="number"
                      min="1"
                      max="32"
                      value={cpus}
                      onChange={(e) => setCpus(parseInt(e.target.value) || 1)}
                      className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                      aria-label="Number of CPU cores"
                    />
                    <p className="text-xs text-gray-500 mt-1">
                      Number of CPU cores for the Ray head node
                    </p>
                  </div>
                )}

                {/* GPU Options - only for single-machine mode */}
                {mode === 'single-machine' && (
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-2">GPU Support</label>
                    <div className="flex items-center space-x-4">
                      <label className="flex items-center">
                        <input
                          type="checkbox"
                          checked={hasGpu}
                          onChange={(e) => setHasGpu(e.target.checked)}
                          className="w-4 h-4 text-blue-600 bg-gray-100 border-gray-300 rounded focus:ring-blue-500"
                        />
                        <span className="ml-2 text-sm text-gray-700">Enable GPU</span>
                      </label>
                    </div>
                    {hasGpu && (
                      <input
                        type="number"
                        min="1"
                        max="8"
                        value={gpus}
                        onChange={(e) => setGpus(parseInt(e.target.value) || 1)}
                        placeholder="GPU count"
                        className="w-full mt-2 px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                      />
                    )}
                    <p className="text-xs text-gray-500 mt-1">
                      {hasGpu ? `Requires NVIDIA ${containerRuntime === 'docker' ? 'Docker runtime' : 'container toolkit for Podman'}` : 'CPU-only mode, no GPU acceleration'}
                    </p>
                  </div>
                )}

                {/* Run as Root */}
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">Permissions</label>
                  <label className="flex items-center">
                    <input
                      type="checkbox"
                      checked={runAsRoot}
                      onChange={(e) => setRunAsRoot(e.target.checked)}
                      className="w-4 h-4 text-blue-600 bg-gray-100 border-gray-300 rounded focus:ring-blue-500"
                    />
                    <span className="ml-2 text-sm text-gray-700">Run as root</span>
                  </label>
                  <p className="text-xs text-gray-500 mt-1">
                    {runAsRoot ? "Root privileges - may be needed for some Docker setups" : "User permissions - recommended for security"}
                  </p>
                </div>

                                 {/* Shared Memory Size */}
                 <div>
                   <label className="block text-sm font-medium text-gray-700 mb-2">Shared Memory Size</label>
                   <select
                     value={shmSize}
                     onChange={(e) => setShmSize(e.target.value)}
                     className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                     aria-label="Select shared memory size"
                   >
                     <option value="512m">512 MB</option>
                     <option value="1g">1 GB</option>
                     <option value="2g">2 GB</option>
                     <option value="4g">4 GB</option>
                     <option value="5g">5 GB</option>
                     <option value="8g">8 GB</option>
                     <option value="16g">16 GB</option>
                   </select>
                   <p className="text-xs text-gray-500 mt-1">
                     {containerRuntime} shared memory size for Ray operations and data processing, you will likely need to increase this for large models.
                   </p>
                 </div>

                {/* Interactive Mode */}
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">Execution Mode</label>
                  <label className="flex items-center">
                    <input
                      type="checkbox"
                      checked={interactiveMode}
                      onChange={(e) => setInteractiveMode(e.target.checked)}
                      className="w-4 h-4 text-blue-600 bg-gray-100 border-gray-300 rounded focus:ring-blue-500"
                    />
                    <span className="ml-2 text-sm text-gray-700">Interactive mode</span>
                  </label>
                  <p className="text-xs text-gray-500 mt-1">
                    {interactiveMode ? `Start ${containerRuntime} container first, then run BioEngine command inside` : "Run everything in a single command"}
                  </p>
                </div>
              </div>
            )}

            {/* Advanced Options Toggle */}
            <div className="border-t border-gray-200 pt-4">
              <button
                onClick={() => setShowAdvanced(!showAdvanced)}
                className="flex items-center text-sm text-gray-600 hover:text-gray-800 transition-colors duration-200"
              >
                <svg 
                  className={`w-4 h-4 mr-2 transition-transform duration-200 ${showAdvanced ? 'rotate-90' : ''}`} 
                  fill="none" 
                  stroke="currentColor" 
                  viewBox="0 0 24 24"
                >
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                </svg>
                Advanced Options
              </button>
            </div>

            {/* Advanced Options */}
            {showAdvanced && (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4 p-4 bg-gray-50 rounded-lg">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">Workspace</label>
                  <input
                    type="text"
                    value={workspace}
                    onChange={(e) => setWorkspace(e.target.value)}
                    placeholder="your-workspace"
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                  />
                  <p className="text-xs text-gray-500 mt-1">Hypha workspace to connect to (optional)</p>
                </div>
                
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">Server URL</label>
                  <input
                    type="text"
                    value={serverUrl}
                    onChange={(e) => setServerUrl(e.target.value)}
                    placeholder="https://hypha.aicell.io"
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                  />
                  <p className="text-xs text-gray-500 mt-1">Custom Hypha server URL (defaults to public server)</p>
                </div>
                
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">Token</label>
                  <input
                    type="password"
                    value={token}
                    onChange={(e) => setToken(e.target.value)}
                    placeholder="your-auth-token"
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                  />
                  <p className="text-xs text-gray-500 mt-1">Authentication token for private workspaces</p>
                </div>
                
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">Admin Users</label>
                  <input
                    type="text"
                    value={adminUsers}
                    onChange={(e) => setAdminUsers(e.target.value)}
                    placeholder="* or user1,user2,user3"
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                  />
                  <p className="text-xs text-gray-500 mt-1">Users who can deploy models. Use "*" for all users, or comma-separated list</p>
                </div>
                
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">Log Directory</label>
                  <input
                    type="text"
                    value={logDir}
                    onChange={(e) => {
                      let value = e.target.value;
                      if (value && !value.startsWith('/')) {
                        value = '/' + value;
                      }
                      setLogDir(value);
                    }}
                    placeholder="/logs"
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                  />
                  <p className="text-xs text-gray-500 mt-1">Container path for log files. Must start with /. Will auto-mount ~/bioengine-logs to this path</p>
                </div>
                
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">Cache Directory</label>
                  <input
                    type="text"
                    value={cacheDir}
                    onChange={(e) => {
                      let value = e.target.value;
                      if (value && !value.startsWith('/')) {
                        value = '/' + value;
                      }
                      setCacheDir(value);
                    }}
                    placeholder="/path/to/cache"
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                  />
                  <p className="text-xs text-gray-500 mt-1">Container path for cache data. Must start with /. Will update volume mount automatically</p>
                </div>
              </div>
            )}

            {/* Generated Command */}
            <div className="bg-gray-900 rounded-xl p-4 relative">
              <div className="flex justify-between items-start mb-2">
                <h4 className="text-sm font-medium text-gray-300">
                  {mode === 'slurm' 
                    ? 'SLURM Cluster Command:' 
                    : os === 'windows' 
                      ? 'PowerShell Command:' 
                      : 'Terminal Command:'
                  }
                </h4>
                <button
                  onClick={copyToClipboard}
                  className="px-3 py-1 bg-blue-600 hover:bg-blue-700 text-white text-xs rounded-lg transition-colors duration-200 flex items-center"
                >
                  {copied ? (
                    <>
                      <svg className="w-3 h-3 mr-1" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                      </svg>
                      Copied!
                    </>
                  ) : (
                    <>
                      <svg className="w-3 h-3 mr-1" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
                      </svg>
                      Copy
                    </>
                  )}
                </button>
              </div>
              <code className="text-green-400 text-sm font-mono break-all whitespace-pre-wrap">
                {(() => {
                  const command = getCommand();
                  let commandText = '';
                  
                  if (typeof command === 'string') {
                    // SLURM mode - simple string
                    commandText = command;
                  } else if (command.pythonCmd) {
                    // Interactive mode
                    const containerName = containerRuntime.charAt(0).toUpperCase() + containerRuntime.slice(1);
                    commandText = `# Step 1: Create directories\n${command.createDirCmd}\n\n# Step 2: Start ${containerName} container\n${command.dockerCmd}\n\n# Step 3: Inside the container, run:\n${command.pythonCmd}`;
                  } else {
                    // Single command mode
                    const containerName = containerRuntime.charAt(0).toUpperCase() + containerRuntime.slice(1);
                    commandText = `# Step 1: Create directories\n${command.createDirCmd}\n\n# Step 2: Run ${containerName} container\n${command.dockerCmd}`;
                  }
                  
                  // Add volume mount information if log directory is specified
                  if (logDir && mode !== 'slurm') {
                    const mountInfo = os === 'windows' 
                      ? `\n\n# Volume mounts:\n# - ${runAsRoot ? 'C:\\bioengine-workdir' : '%USERPROFILE%\\bioengine-workdir'} → ${cacheDir || '/tmp'} (cache/data)\n# - ${runAsRoot ? 'C:\\bioengine-logs' : '%USERPROFILE%\\bioengine-logs'} → ${logDir} (logs)`
                      : `\n\n# Volume mounts:\n# - $HOME/bioengine-workdir → ${cacheDir || '/tmp'} (cache/data)\n# - $HOME/bioengine-logs → ${logDir} (logs)`;
                    commandText += mountInfo;
                  } else if (mode !== 'slurm') {
                    const mountInfo = os === 'windows' 
                      ? `\n\n# Volume mounts:\n# - ${runAsRoot ? 'C:\\bioengine-workdir' : '%USERPROFILE%\\bioengine-workdir'} → ${cacheDir || '/tmp'} (cache/data)`
                      : `\n\n# Volume mounts:\n# - $HOME/bioengine-workdir → ${cacheDir || '/tmp'} (cache/data)`;
                    commandText += mountInfo;
                  }
                  
                  return commandText;
                })()}
              </code>
            </div>

            {/* SLURM-specific information */}
            {mode === 'slurm' && (
              <div className="p-4 bg-purple-50 rounded-xl border border-purple-200">
                <div className="flex items-start">
                  <svg className="w-5 h-5 text-purple-600 mr-2 mt-0.5 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10" />
                  </svg>
                  <div className="text-sm text-purple-800">
                    <p className="font-medium mb-2">🖥️ SLURM Cluster Mode</p>
                    <div className="text-purple-700 space-y-2">
                      <p>The start_worker.sh script will automatically:</p>
                      <ul className="list-disc list-inside space-y-1 ml-2">
                        <li>Download and set up the BioEngine worker container using Singularity/Apptainer</li>
                        <li>Submit SLURM jobs to manage Ray cluster nodes</li>
                        <li>Handle container image caching and shared filesystem setup</li>
                        <li>Configure network communication between cluster nodes</li>
                        <li>Monitor and manage worker node lifecycle</li>
                      </ul>
                      <div className="mt-3 p-3 bg-purple-100 rounded-lg">
                        <p className="font-medium text-purple-900 mb-1">💡 Pro Tips:</p>
                        <ul className="list-disc list-inside space-y-1 text-purple-800 text-xs">
                          <li>Run this command from a login node with SLURM access</li>
                          <li>Ensure your SLURM account has sufficient allocation</li>
                          <li>The script supports additional SLURM-specific arguments (check the script source for details)</li>
                          <li>Monitor your jobs with <code className="bg-purple-200 px-1 rounded">squeue -u $USER</code></li>
                        </ul>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            )}

            {/* Login Instructions */}
            <div className="p-4 bg-amber-50 rounded-xl border border-amber-200">
              <div className="flex items-start">
                <svg className="w-5 h-5 text-amber-600 mr-2 mt-0.5 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-2.5L13.732 4c-.77-.833-1.964-.833-2.732 0L4.082 16.5c-.77.833.192 2.5 1.732 2.5z" />
                </svg>
                <div className="text-sm text-amber-800">
                  <p className="font-medium mb-2">🔐 Important: Authentication Required</p>
                  <div className="text-amber-700 space-y-2">
                    <p>After running the command above, you'll see output in your terminal. Look for a line that says:</p>
                    <div className="bg-amber-100 border border-amber-300 rounded p-2 font-mono text-xs">
                      Please open your browser and login at https://hypha.aicell.io/public/apps/hypha-login/?key=...
                    </div>
                    <div className="space-y-1">
                      <p className="font-medium">Follow these steps:</p>
                      <ol className="list-decimal list-inside space-y-1 ml-2">
                        <li>Copy the complete URL from your terminal output</li>
                        <li>Open the URL in your web browser</li>
                        <li>Login using Google, GitHub, or another supported provider</li>
                        <li>Return to your terminal - the BioEngine worker will continue automatically</li>
                      </ol>
                    </div>
                    <p className="text-xs italic">
                      💡 This one-time login creates your workspace and authenticates your BioEngine worker.
                    </p>
                  </div>
                </div>
              </div>
            </div>

            {/* Additional Info */}
            <div className="p-4 bg-blue-50 rounded-xl border border-blue-200">
              <div className="flex items-start">
                <svg className="w-5 h-5 text-blue-600 mr-2 mt-0.5 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
                <div className="text-sm text-blue-800">
                  <p className="font-medium mb-1">Prerequisites & Notes:</p>
                  <ul className="list-disc list-inside space-y-1 text-blue-700">
                    {mode === 'slurm' ? (
                      <>
                        <li>Access to a SLURM cluster with proper permissions</li>
                        <li>SLURM commands (sbatch, squeue, scancel) available in your PATH</li>
                        <li>Singularity/Apptainer container runtime on the cluster</li>
                        <li>Network access from compute nodes to download the container image</li>
                        <li>Shared filesystem accessible from all compute nodes</li>
                      </>
                    ) : (
                      <>
                        <li>{containerRuntime.charAt(0).toUpperCase() + containerRuntime.slice(1)} must be installed and running</li>
                        {mode === 'single-machine' && hasGpu && <li>NVIDIA {containerRuntime === 'docker' ? 'Docker runtime' : 'container toolkit'} required for GPU support</li>}
                        {mode === 'connect' && <li>Existing Ray cluster must be running and accessible</li>}
                      </>
                    )}
                    {interactiveMode && mode !== 'slurm' && <li>Interactive mode: Run the {containerRuntime} command first, then execute the Python command inside the container</li>}
                    {interactiveMode && mode === 'slurm' && <li>Interactive mode: You can inspect the script before running it</li>}
                    <li>A 'bioengine-workdir' directory will be created in your home directory for data storage and caching</li>
                    {logDir && mode !== 'slurm' && <li>A 'bioengine-logs' directory will be created in your home directory and mounted to {logDir} in the container</li>}
                    <li>You'll need to authenticate via browser when prompted (see authentication section above)</li>
                    <li>After running, the worker will be available at the service ID shown in the terminal</li>
                    <li>Use the service ID to connect to your BioEngine worker from this interface</li>
                    {mode === 'connect' && <li>Make sure the Ray address is accessible from your network</li>}
                    {mode === 'slurm' && <li>The script will automatically handle SLURM job submission and container management</li>}
                  </ul>
                </div>
              </div>
            </div>

            {/* Troubleshooting Button */}
            <div className="flex justify-center pt-4 border-t border-gray-200">
              <button
                onClick={() => setShowTroubleshooting(true)}
                className="flex items-center px-4 py-2 text-sm text-orange-600 bg-orange-50 border border-orange-200 rounded-lg hover:bg-orange-100 hover:border-orange-300 transition-colors duration-200"
              >
                <svg className="w-4 h-4 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8.228 9c.549-1.165 2.03-2 3.772-2 2.21 0 4 1.343 4 3 0 1.4-1.278 2.575-3.006 2.907-.542.104-.994.54-.994 1.093m0 3h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
                Need Help? Get AI Troubleshooting Prompt
              </button>
            </div>
          </div>
        )}

        {/* Troubleshooting Dialog */}
        {showTroubleshooting && (
          <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-50 p-4">
            <div ref={troubleshootingDialogRef} className="bg-white rounded-2xl shadow-lg max-w-4xl w-full max-h-[90vh] flex flex-col">
              <div className="p-6 border-b border-gray-200 flex justify-between items-center">
                <div className="flex items-center">
                  <div className="w-10 h-10 bg-gradient-to-r from-orange-500 to-red-500 rounded-xl flex items-center justify-center mr-3">
                    <svg className="w-5 h-5 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8.228 9c.549-1.165 2.03-2 3.772-2 2.21 0 4 1.343 4 3 0 1.4-1.278 2.575-3.006 2.907-.542.104-.994.54-.994 1.093m0 3h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                    </svg>
                  </div>
                  <div>
                    <h3 className="text-lg font-semibold text-gray-800">AI Troubleshooting Assistant</h3>
                    <p className="text-sm text-gray-600">Copy this prompt to ChatGPT, Claude, Gemini, or your favorite LLM</p>
                  </div>
                </div>
                <button
                  onClick={() => setShowTroubleshooting(false)}
                  className="text-gray-400 hover:text-gray-600 p-2 rounded-xl hover:bg-gray-100 transition-all duration-200"
                  aria-label="Close dialog"
                >
                  <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>
              </div>
              
              <div className="flex-1 p-6 overflow-hidden flex flex-col">
                <div className="mb-4">
                  <div className="flex justify-between items-center mb-2">
                    <h4 className="text-sm font-medium text-gray-700">Comprehensive Troubleshooting Prompt</h4>
                    <button
                      onClick={copyTroubleshootingPrompt}
                      className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white text-sm rounded-lg transition-colors duration-200 flex items-center"
                    >
                      {promptCopied ? (
                        <>
                          <svg className="w-4 h-4 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                          </svg>
                          Copied!
                        </>
                      ) : (
                        <>
                          <svg className="w-4 h-4 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
                          </svg>
                          Copy Prompt
                        </>
                      )}
                    </button>
                  </div>
                  <p className="text-xs text-gray-500 mb-4">
                    This prompt includes your current configuration, the complete BioEngine help documentation, 
                    troubleshooting guidelines, and context about what you're trying to achieve. 
                    Just add your specific question or error message at the end.
                  </p>
                </div>
                
                <div className="flex-1 overflow-auto">
                  <pre className="text-xs text-gray-700 bg-gray-50 p-4 rounded-lg border whitespace-pre-wrap font-mono leading-relaxed">
                    {getTroubleshootingPrompt()}
                  </pre>
                </div>
              </div>
              
              <div className="p-6 border-t border-gray-200 bg-gray-50 flex justify-between items-center">
                <div className="text-sm text-gray-600">
                  <p className="font-medium mb-1">How to use:</p>
                  <ol className="list-decimal list-inside space-y-1 text-xs">
                    <li>Copy the prompt above</li>
                    <li>Paste it into ChatGPT, Claude, Gemini, or your preferred AI assistant</li>
                    <li>Add your specific question or error message at the end</li>
                    <li>Get detailed, context-aware troubleshooting help</li>
                  </ol>
                </div>
                <button 
                  onClick={() => setShowTroubleshooting(false)}
                  className="px-6 py-2 bg-gray-600 text-white rounded-lg hover:bg-gray-700 transition-colors duration-200"
                >
                  Close
                </button>
              </div>
            </div>
          </div>
        )}
    </div>
  );
};

export default BioEngineGuide; 