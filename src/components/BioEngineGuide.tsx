import React, { useState } from 'react';

type OSType = 'macos' | 'linux' | 'windows';
type ModeType = 'single-machine' | 'slurm' | 'connect';
type ArchType = 'amd64' | 'arm64';

const BioEngineGuide: React.FC = () => {
  const [os, setOS] = useState<OSType>('macos');
  const [arch, setArch] = useState<ArchType>('arm64');
  const [mode, setMode] = useState<ModeType>('single-machine');
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

  const getPlatform = () => {
    if (os === 'windows') {
      return `windows/${arch}`;
    }
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
    return hasGpu ? '--gpus=all ' : '';
  };

  const getCommand = () => {
    const platform = getPlatform();
    const userFlag = getUserFlag();
    const gpuFlag = getGpuFlag();
    
    // Determine mount directory and cache directory
    let mountDir = '/tmp';
    let hostMountPath = '';
    
    if (os === 'windows') {
      hostMountPath = runAsRoot ? 'C:\\temp' : '%TEMP%';
    } else {
      hostMountPath = '$(mktemp -d)';
    }
    
    // If user specified a custom cache directory, use it as the mount point
    if (cacheDir) {
      mountDir = cacheDir;
    }
    
    // Base arguments
    let args = [`--mode ${mode}`];
    
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
    
    const argsString = args.join(' ');
    
    if (interactiveMode) {
      // Interactive mode - separate docker run and python command
      const dockerCmd = os === 'windows' 
        ? `docker run ${gpuFlag}--platform ${platform} -it --rm -v ${hostMountPath}:${mountDir} ghcr.io/aicell-lab/bioengine-worker:0.1.17 bash`
        : `docker run ${gpuFlag}--platform ${platform} -it --rm ${userFlag}-v ${hostMountPath}:${mountDir} ghcr.io/aicell-lab/bioengine-worker:0.1.17 bash`;
      
      const pythonCmd = `python -m bioengine_worker ${argsString}`;
      
      return { dockerCmd, pythonCmd };
    } else {
      // Single command mode
      if (os === 'windows') {
        return `docker run ${gpuFlag}--platform ${platform} -it --rm -v ${hostMountPath}:${mountDir} ghcr.io/aicell-lab/bioengine-worker:0.1.17 python -m bioengine_worker ${argsString}`;
      }
      
      return `docker run ${gpuFlag}--platform ${platform} -it --rm ${userFlag}-v ${hostMountPath}:${mountDir} ghcr.io/aicell-lab/bioengine-worker:0.1.17 python -m bioengine_worker ${argsString}`;
    }
  };

  const copyToClipboard = async () => {
    try {
      const command = getCommand();
      const textToCopy = typeof command === 'string' 
        ? command 
        : `# Step 1: Start Docker container\n${command.dockerCmd}\n\n# Step 2: Inside the container, run:\n${command.pythonCmd}`;
      
      await navigator.clipboard.writeText(textToCopy);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch (err) {
      console.error('Failed to copy:', err);
    }
  };

  const getTroubleshootingPrompt = () => {
    const currentCommand = getCommand();
    const commandText = typeof currentCommand === 'string' 
      ? currentCommand 
      : `# Step 1: Start Docker container\n${currentCommand.dockerCmd}\n\n# Step 2: Inside the container, run:\n${currentCommand.pythonCmd}`;
    
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
- **Mode**: ${mode === 'single-machine' ? 'Single Machine (local Ray cluster)' : mode === 'slurm' ? 'SLURM (HPC cluster)' : 'Connect to existing Ray cluster'}
${mode === 'single-machine' ? `- **CPUs**: ${cpus}
- **GPUs**: ${hasGpu ? gpus : 'None'}` : ''}
${mode === 'connect' && rayAddress ? `- **Ray Address**: ${rayAddress}` : ''}
- **Run as Root**: ${runAsRoot ? 'Yes' : 'No'}
- **Interactive Mode**: ${interactiveMode ? 'Yes (separate Docker and Python commands)' : 'No (single command)'}

### Advanced Configuration
${workspace ? `- **Workspace**: ${workspace}` : ''}
${serverUrl ? `- **Server URL**: ${serverUrl}` : ''}
${token ? `- **Token**: [CONFIGURED]` : ''}
${adminUsers ? `- **Admin Users**: ${adminUsers}` : ''}
${logDir ? `- **Log Directory**: ${logDir}` : ''}
${cacheDir ? `- **Cache Directory**: ${cacheDir}` : ''}

### Generated Docker Command
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

1. **Docker Issues**: Container startup, platform compatibility, volume mounting
2. **Network Issues**: Port conflicts, firewall settings, connectivity
3. **Resource Issues**: CPU/GPU allocation, memory constraints
4. **Permission Issues**: User permissions, file access, Docker daemon access
5. **Ray Cluster Issues**: Ray startup, cluster connectivity, node communication
6. **Hypha Integration**: Workspace access, authentication, service registration
7. **Configuration Issues**: Invalid arguments, missing dependencies, environment setup

## Common Issues to Check

- Docker is installed and running
- Sufficient system resources (CPU, memory, disk space)
- Network ports are available (especially for Ray cluster communication)
- Volume mount paths exist and are accessible
- For GPU mode: NVIDIA Docker runtime is installed
- For SLURM mode: Proper SLURM cluster access and configuration
- For connect mode: Target Ray cluster is running and accessible

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
        className="w-full flex items-center justify-between text-left hover:bg-gray-50 rounded-lg p-3 transition-colors duration-200"
      >
        <div className="flex items-center">
          <div className="w-8 h-8 bg-gradient-to-r from-cyan-500 to-blue-600 rounded-lg flex items-center justify-center mr-3">
            <svg className="w-4 h-4 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
          </div>
          <div>
            <h4 className="text-sm font-medium text-gray-800">Need to start BioEngine locally?</h4>
            <p className="text-xs text-gray-500">Click to configure your local setup</p>
          </div>
        </div>
        <div className="flex items-center">
          <span className="text-xs text-gray-500 mr-2">{isExpanded ? 'Hide' : 'Show'}</span>
          <svg 
            className={`w-4 h-4 text-gray-400 transition-transform duration-200 ${isExpanded ? 'rotate-180' : ''}`} 
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
            {/* Basic Configuration */}
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
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

              {/* Mode */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">Mode</label>
                <select
                  value={mode}
                  onChange={(e) => setMode(e.target.value as ModeType)}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                  aria-label="Select mode"
                >
                  <option value="single-machine">Single Machine</option>
                  <option value="slurm">SLURM (HPC)</option>
                  <option value="connect">Connect to Existing</option>
                </select>
                <p className="text-xs text-gray-500 mt-1">
                  {mode === 'single-machine' && 'Local Ray cluster on this machine'}
                  {mode === 'slurm' && 'High-performance computing cluster'}
                  {mode === 'connect' && 'Connect to existing Ray cluster'}
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
                    {hasGpu ? 'Requires NVIDIA Docker runtime' : 'CPU-only mode, no GPU acceleration'}
                  </p>
                </div>
              )}

              {/* Ray Address - only for connect mode */}
              {mode === 'connect' && (
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">Ray Address</label>
                  <input
                    type="text"
                    value={rayAddress}
                    onChange={(e) => setRayAddress(e.target.value)}
                    placeholder="ray://head-node-ip:10001"
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                    aria-label="Ray cluster address"
                  />
                  <p className="text-xs text-gray-500 mt-1">
                    Address of existing Ray cluster to connect to
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
                  {interactiveMode ? "Start Docker container first, then run BioEngine command inside" : "Run everything in a single command"}
                </p>
              </div>
            </div>

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
                    onChange={(e) => setLogDir(e.target.value)}
                    placeholder="/path/to/logs"
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                  />
                  <p className="text-xs text-gray-500 mt-1">Container path for log files (should be mounted)</p>
                </div>
                
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">Cache Directory</label>
                  <input
                    type="text"
                    value={cacheDir}
                    onChange={(e) => setCacheDir(e.target.value)}
                    placeholder="/path/to/cache"
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                  />
                  <p className="text-xs text-gray-500 mt-1">Container path for cache data - will update volume mount automatically</p>
                </div>
              </div>
            )}

            {/* Generated Command */}
            <div className="bg-gray-900 rounded-xl p-4 relative">
              <div className="flex justify-between items-start mb-2">
                <h4 className="text-sm font-medium text-gray-300">
                  {os === 'windows' ? 'PowerShell Command:' : 'Terminal Command:'}
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
                  if (typeof command === 'string') {
                    return command;
                  } else {
                    return `# Step 1: Start Docker container\n${command.dockerCmd}\n\n# Step 2: Inside the container, run:\n${command.pythonCmd}`;
                  }
                })()}
              </code>
            </div>

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
                    <li>Docker must be installed and running</li>
                    {mode === 'single-machine' && hasGpu && <li>NVIDIA Docker runtime required for GPU support</li>}
                    {mode === 'slurm' && <li>SLURM cluster access and proper configuration required</li>}
                    {mode === 'connect' && <li>Existing Ray cluster must be running and accessible</li>}
                    {interactiveMode && <li>Interactive mode: Run the Docker command first, then execute the Python command inside the container</li>}
                    <li>You'll need to authenticate via browser when prompted (see authentication section above)</li>
                    <li>After running, the worker will be available at the service ID shown in the terminal</li>
                    <li>Use the service ID to connect to your BioEngine worker from this interface</li>
                    {mode === 'connect' && <li>Make sure the Ray address is accessible from your network</li>}
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
            <div className="bg-white rounded-2xl shadow-lg max-w-4xl w-full max-h-[90vh] flex flex-col">
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