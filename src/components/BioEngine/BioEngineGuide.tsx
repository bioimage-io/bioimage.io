import React, { useState, useRef, useEffect } from 'react';

type OSType = 'macos' | 'linux' | 'windows';
type ModeType = 'single-machine' | 'slurm' | 'external-cluster';
type ContainerRuntimeType = 'docker' | 'podman' | 'apptainer' | 'singularity';

const BioEngineGuide: React.FC = () => {
  const [os, setOS] = useState<OSType>('macos');
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
  const [adminUsers, setAdminUsers] = useState('');
  const [dataDir, setDataDir] = useState('');
  const [cacheDir, setCacheDir] = useState('');
  const [showTroubleshooting, setShowTroubleshooting] = useState(false);
  const [promptCopied, setPromptCopied] = useState(false);
  const [interactiveMode, setInteractiveMode] = useState(false);
  const [shmSize, setShmSize] = useState('8g');
  const [customImage, setCustomImage] = useState('');
  const [platformOverride, setPlatformOverride] = useState('');
  const [clientId, setClientId] = useState('');
  const [clientServerPort, setClientServerPort] = useState('10001');
  const [servePort, setServePort] = useState('8000');


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
    return platformOverride || '';
  };

  const getContainerCacheDir = () => {
    if (containerRuntime !== 'apptainer' && containerRuntime !== 'singularity') {
      return '';
    }

    // Get the base cache directory
    let baseCache = cacheDir;
    if (!baseCache) {
      if (os === 'windows') {
        baseCache = runAsRoot ? 'C:\\.bioengine' : '%USERPROFILE%\\.bioengine';
      } else {
        baseCache = '$HOME/.bioengine';
      }
    }

    // Remove trailing slash if present and append /images
    const normalizedCache = baseCache.endsWith('/') || baseCache.endsWith('\\')
      ? baseCache.slice(0, -1)
      : baseCache;

    return os === 'windows'
      ? `${normalizedCache}\\images`
      : `${normalizedCache}/images`;
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
    } else if (containerRuntime === 'apptainer' || containerRuntime === 'singularity') {
      // Both Apptainer and Singularity use --nv for NVIDIA GPU support
      return '--nv ';
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
    } else if (mode === 'external-cluster' && rayAddress) {
      args.push(`--connection_address ${rayAddress}`);
      // Add port configuration for external cluster
      if (clientServerPort && clientServerPort !== '10001') {
        args.push(`--client_server_port ${clientServerPort}`);
      }
      if (servePort && servePort !== '8000') {
        args.push(`--serve_port ${servePort}`);
      }
    }

    // Advanced arguments
    if (workspace) args.push(`--workspace ${workspace}`);
    if (serverUrl) args.push(`--server_url ${serverUrl}`);
    if (token) args.push(`--token ${token}`);

    // Handle admin users - only add flag if users are specified
    if (adminUsers) {
      if (adminUsers === '*') {
        args.push(`--admin_users "*"`);
      } else {
        const users = adminUsers.split(',').map(u => u.trim()).join(' ');
        args.push(`--admin_users ${users}`);
      }
    }

    if (clientId) args.push(`--client_id ${clientId}`);

    // Add custom image if specified
    if (customImage) args.push(`--image ${customImage}`);

    const argsString = args.length > 0 ? args.join(' ') : '';

    // SLURM mode uses the bash script instead of Docker
    if (mode === 'slurm') {
      // Add cache and data directories for SLURM mode only
      if (cacheDir) args.push(`--cache_dir ${cacheDir}`);
      if (dataDir) args.push(`--data_dir ${dataDir}`);

      const slurmArgsString = args.length > 0 ? args.join(' ') : '';

      if (interactiveMode) {
        return {
          dockerCmd: `# Download and inspect the script first (optional)`,
          pythonCmd: `bash <(curl -s https://raw.githubusercontent.com/aicell-lab/bioengine-worker/refs/heads/main/scripts/start_hpc_worker.sh)${slurmArgsString ? ` ${slurmArgsString}` : ''}`
        };
      } else {
        return `bash <(curl -s https://raw.githubusercontent.com/aicell-lab/bioengine-worker/refs/heads/main/scripts/start_hpc_worker.sh)${slurmArgsString ? ` ${slurmArgsString}` : ''}`;
      }
    }

    // For single-machine and external-cluster modes, use container runtime
    const platform = getPlatform();
    const userFlag = getUserFlag();
    const gpuFlag = getGpuFlag();
    const shmFlag = (containerRuntime === 'apptainer' || containerRuntime === 'singularity') ? '' : `--shm-size=${shmSize} `;
    const platformFlag = platform && containerRuntime !== 'apptainer' && containerRuntime !== 'singularity' ? `--platform ${platform} ` : '';
    const imageToUse = customImage || 'ghcr.io/aicell-lab/bioengine-worker:0.2.2';

    // Build volume mounts
    let volumeMounts = '';
    const mounts: string[] = [];

    // Handle cache directory mount
    if (cacheDir) {
      // User specified a custom cache directory - mount it directly to /tmp/bioengine
      if (containerRuntime === 'apptainer' || containerRuntime === 'singularity') {
        mounts.push(`--bind ${cacheDir}:/tmp/bioengine`);
      } else {
        mounts.push(`-v ${cacheDir}:/tmp/bioengine`);
      }
    } else {
      // No custom cache directory - mount default ~/.bioengine to /tmp/bioengine
      if (os === 'windows') {
        const hostCachePath = runAsRoot ? `C:\\.bioengine` : '%USERPROFILE%\\.bioengine';
        if (containerRuntime === 'apptainer' || containerRuntime === 'singularity') {
          mounts.push(`--bind ${hostCachePath}:/tmp/bioengine`);
        } else {
          mounts.push(`-v ${hostCachePath}:/tmp/bioengine`);
        }
      } else {
        if (containerRuntime === 'apptainer' || containerRuntime === 'singularity') {
          mounts.push(`--bind $HOME/.bioengine:/tmp/bioengine`);
        } else {
          mounts.push(`-v $HOME/.bioengine:/tmp/bioengine`);
        }
      }
    }

    // Handle data directory mount
    if (dataDir) {
      // User specified a data directory - mount it directly to /data
      if (containerRuntime === 'apptainer' || containerRuntime === 'singularity') {
        mounts.push(`--bind ${dataDir}:/data`);
      } else {
        mounts.push(`-v ${dataDir}:/data`);
      }
    }

    volumeMounts = mounts.join(' ');

    // Create directory creation commands - only for default directories
    let createDirCmd = '';
    if (os === 'windows') {
      const dirs: string[] = [];

      // Always create cache directory
      if (cacheDir) {
        dirs.push(`"${cacheDir}"`);
      } else {
        const cachePath = runAsRoot ? 'C:\\.bioengine' : '%USERPROFILE%\\.bioengine';
        dirs.push(`"${cachePath}"`);
      }

      if (dirs.length > 0) {
        createDirCmd = dirs.map(dir => `cmd /c "mkdir ${dir} 2>nul || echo Directory already exists"`).join(' && ');
      }
    } else {
      const dirs: string[] = [];

      // Always create cache directory
      if (cacheDir) {
        dirs.push(`"${cacheDir}"`);
      } else {
        dirs.push('$HOME/.bioengine');
      }

      if (dirs.length > 0) {
        createDirCmd = `mkdir -p ${dirs.join(' ')}`;
      }
    }

    if (interactiveMode) {
      // Interactive mode - separate container run and python command
      let containerCmd = '';
      if (containerRuntime === 'apptainer' || containerRuntime === 'singularity') {
        // Both Apptainer and Singularity use 'shell' command for interactive mode
        const cacheEnv = getContainerCacheDir() ? `${containerRuntime.toUpperCase()}_CACHEDIR=${getContainerCacheDir()} ` : '';
        if (os === 'windows') {
          containerCmd = `cmd /c "${cacheEnv}${containerRuntime} shell ${gpuFlag}${volumeMounts} docker://${imageToUse}"`;
        } else {
          containerCmd = `${cacheEnv}${containerRuntime} shell ${gpuFlag}${volumeMounts} docker://${imageToUse}`;
        }
      } else {
        // Docker/Podman use run with --entrypoint bash
        if (os === 'windows') {
          containerCmd = `cmd /c "${containerRuntime} run ${platformFlag}--rm -it ${shmFlag}--entrypoint bash ${gpuFlag}${volumeMounts} ${imageToUse}"`;
        } else {
          containerCmd = `${containerRuntime} run ${platformFlag}--rm -it ${shmFlag}${userFlag}--entrypoint bash ${gpuFlag}${volumeMounts} ${imageToUse}`;
        }
      }

      const pythonCmd = `python -m bioengine_worker ${argsString}`;

      return {
        createDirCmd,
        dockerCmd: containerCmd,
        pythonCmd
      };
    } else {
      // Single command mode
      let dockerCmd = '';
      if (containerRuntime === 'apptainer' || containerRuntime === 'singularity') {
        // Both Apptainer and Singularity use 'exec' command for single execution
        const cacheEnv = getContainerCacheDir() ? `${containerRuntime.toUpperCase()}_CACHEDIR=${getContainerCacheDir()} ` : '';
        if (os === 'windows') {
          dockerCmd = `cmd /c "${cacheEnv}${containerRuntime} exec ${gpuFlag}${volumeMounts} docker://${imageToUse} python -m bioengine_worker ${argsString}"`;
        } else {
          dockerCmd = `${cacheEnv}${containerRuntime} exec ${gpuFlag}${volumeMounts} docker://${imageToUse} python -m bioengine_worker ${argsString}`;
        }
      } else if (os === 'windows') {
        dockerCmd = `cmd /c "${containerRuntime} run ${gpuFlag}${platformFlag}-it --rm ${shmFlag}${volumeMounts} ${imageToUse} python -m bioengine_worker ${argsString}"`;
      } else {
        dockerCmd = `${containerRuntime} run ${gpuFlag}${platformFlag}-it --rm ${shmFlag}${userFlag}${volumeMounts} ${imageToUse} python -m bioengine_worker ${argsString}`;
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
- **Container Runtime**: ${containerName}${mode !== 'slurm' ? ` (${containerRuntime === 'docker' ? 'traditional container runtime' : containerRuntime === 'podman' ? 'daemonless, rootless alternative to Docker' : containerRuntime === 'apptainer' ? 'HPC-focused container runtime, often used on clusters' : 'HPC container runtime, predecessor to Apptainer'})` : ''}
- **Mode**: ${mode === 'single-machine' ? 'Single Machine (local)' : mode === 'slurm' ? 'SLURM (HPC cluster with bash script)' : 'Connect to existing Ray cluster'}
${mode === 'single-machine' ? `- **CPUs**: ${cpus}
- **GPUs**: ${hasGpu ? gpus : 'None'}` : ''}
${mode === 'external-cluster' && rayAddress ? `- **Ray Address**: ${rayAddress}` : ''}
${mode === 'external-cluster' && clientServerPort && clientServerPort !== '10001' ? `- **Client Server Port**: ${clientServerPort}` : ''}
${mode === 'external-cluster' && servePort && servePort !== '8000' ? `- **Serve Port**: ${servePort}` : ''}
${mode !== 'slurm' ? `- **Run as Root**: ${runAsRoot ? 'Yes' : 'No'}
- **Shared Memory Size**: ${shmSize}` : ''}
- **Interactive Mode**: ${interactiveMode ? (mode === 'slurm' ? 'Yes (can inspect script before running)' : `Yes (separate ${containerName} and Python commands${containerRuntime === 'apptainer' || containerRuntime === 'singularity' ? ` with ${containerRuntime} shell` : ' with --entrypoint bash'})`) : 'No (single command)'}

### Advanced Configuration
${workspace ? `- **Workspace**: ${workspace}` : ''}
${serverUrl ? `- **Server URL**: ${serverUrl}` : ''}
${token ? `- **Token**: [CONFIGURED]` : ''}
${adminUsers ? `- **Admin Users**: ${adminUsers}` : '- **Admin Users**: Default (logged-in user)'}
${dataDir ? `- **Data Directory**: ${dataDir}` : ''}
${cacheDir ? `- **Cache Directory**: ${cacheDir}` : ''}
${customImage ? `- **Custom Image**: ${customImage}` : ''}
${platformOverride ? `- **Platform Override**: ${platformOverride}` : ''}
${clientId ? `- **Client ID**: ${clientId}` : ''}

### Generated ${containerName} Command
\`\`\`bash
${commandText}
\`\`\`

## Complete BioEngine Worker Help Reference

\`\`\`
python -m bioengine_worker --help
usage: __main__.py [-h] [--mode {slurm,single-machine,external-cluster}] [--admin_users ADMIN_USERS [ADMIN_USERS ...]] [--cache_dir CACHE_DIR] [--data_dir DATA_DIR]
                   [--startup_deployments STARTUP_DEPLOYMENTS [STARTUP_DEPLOYMENTS ...]] [--server_url SERVER_URL] [--workspace WORKSPACE] [--token TOKEN] [--client_id CLIENT_ID]
                   [--head_node_address HEAD_NODE_ADDRESS] [--head_node_port HEAD_NODE_PORT] [--node_manager_port NODE_MANAGER_PORT] [--object_manager_port OBJECT_MANAGER_PORT]
                   [--redis_shard_port REDIS_SHARD_PORT] [--serve_port SERVE_PORT] [--dashboard_port DASHBOARD_PORT] [--client_server_port CLIENT_SERVER_PORT] [--redis_password REDIS_PASSWORD]
                   [--head_num_cpus HEAD_NUM_CPUS] [--head_num_gpus HEAD_NUM_GPUS] [--runtime_env_pip_cache_size_gb RUNTIME_ENV_PIP_CACHE_SIZE_GB] [--skip_cleanup]
                   [--status_interval_seconds STATUS_INTERVAL_SECONDS] [--max_status_history_length MAX_STATUS_HISTORY_LENGTH] [--image IMAGE] [--worker_cache_dir WORKER_CACHE_DIR]
                   [--worker_data_dir WORKER_DATA_DIR] [--default_num_gpus DEFAULT_NUM_GPUS] [--default_num_cpus DEFAULT_NUM_CPUS] [--default_mem_per_cpu DEFAULT_MEM_PER_CPU]
                   [--default_time_limit DEFAULT_TIME_LIMIT] [--further_slurm_args FURTHER_SLURM_ARGS [FURTHER_SLURM_ARGS ...]] [--min_workers MIN_WORKERS] [--max_workers MAX_WORKERS]
                   [--scale_up_cooldown_seconds SCALE_UP_COOLDOWN_SECONDS] [--scale_down_check_interval_seconds SCALE_DOWN_CHECK_INTERVAL_SECONDS] [--scale_down_threshold_seconds SCALE_DOWN_THRESHOLD_SECONDS]
                   [--dashboard_url DASHBOARD_URL] [--debug]

BioEngine Worker Registration

options:
  -h, --help            show this help message and exit
  --mode {slurm,single-machine,external-cluster}
                        Mode of operation: 'slurm' for managing a Ray cluster with SLURM jobs, 'single-machine' for local Ray cluster, 'external-cluster' for connecting to an existing Ray cluster.
  --admin_users ADMIN_USERS [ADMIN_USERS ...]
                        List of admin users for BioEngine apps and datasets. If not set, defaults to the logged-in user.
  --cache_dir CACHE_DIR
                        BioEngine cache directory. This should be a mounted directory if running in container.
  --data_dir DATA_DIR   Data directory served by the dataset manager. This should be a mounted directory if running in container.
  --startup_deployments STARTUP_DEPLOYMENTS [STARTUP_DEPLOYMENTS ...]
                        List of artifact IDs to deploy on worker startup
  --dashboard_url DASHBOARD_URL
                        URL of the BioEngine dashboard
  --debug               Set logger to debug level

Hypha Options:
  --server_url SERVER_URL
                        URL of the Hypha server
  --workspace WORKSPACE
                        Hypha workspace to connect to. If not set, the workspace associated with the token will be used.
  --token TOKEN         Authentication token for Hypha server. If not set, the environment variable 'HYPHA_TOKEN' will be used, otherwise the user will be prompted to log in.
  --client_id CLIENT_ID
                        Client ID for the worker. If not set, a client ID will be generated automatically.

Ray Cluster Manager Options:
  --head_node_address HEAD_NODE_ADDRESS
                        Address of head node. If not set, the first system IP will be used.
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
  --client_server_port CLIENT_SERVER_PORT
                        Port for Ray client server
  --redis_password REDIS_PASSWORD
                        Redis password for Ray cluster. If not set, a random password will be generated.
  --head_num_cpus HEAD_NUM_CPUS
                        Number of CPUs for head node if starting locally
  --head_num_gpus HEAD_NUM_GPUS
                        Number of GPUs for head node if starting locally
  --runtime_env_pip_cache_size_gb RUNTIME_ENV_PIP_CACHE_SIZE_GB
                        Size of the pip cache in GB for Ray runtime environment
  --skip_cleanup        Skip cleanup of previous Ray cluster
  --status_interval_seconds STATUS_INTERVAL_SECONDS
                        Interval in seconds to check the status of the Ray cluster
  --max_status_history_length MAX_STATUS_HISTORY_LENGTH
                        Maximum length of the status history for the Ray cluster

SLURM Job Options:
  --image IMAGE         Worker image for SLURM job
  --worker_cache_dir WORKER_CACHE_DIR
                        Cache directory mounted to the container when starting a worker. Required in SLURM mode.
  --worker_data_dir WORKER_DATA_DIR
                        Data directory mounted to the container when starting a worker. Required in SLURM mode.
  --default_num_gpus DEFAULT_NUM_GPUS
                        Default number of GPUs per worker
  --default_num_cpus DEFAULT_NUM_CPUS
                        Default number of CPUs per worker
  --default_mem_per_cpu DEFAULT_MEM_PER_CPU
                        Default memory per CPU in GB
  --default_time_limit DEFAULT_TIME_LIMIT
                        Default time limit for workers
  --further_slurm_args FURTHER_SLURM_ARGS [FURTHER_SLURM_ARGS ...]
                        Additional arguments for SLURM job script

Ray Autoscaler Options:
  --min_workers MIN_WORKERS
                        Minimum number of worker nodes
  --max_workers MAX_WORKERS
                        Maximum number of worker nodes
  --scale_up_cooldown_seconds SCALE_UP_COOLDOWN_SECONDS
                        Cooldown period between scaling up operations
  --scale_down_check_interval_seconds SCALE_DOWN_CHECK_INTERVAL_SECONDS
                        Interval in seconds to check for scale down
  --scale_down_threshold_seconds SCALE_DOWN_THRESHOLD_SECONDS
                        Time threshold before scaling down idle nodes
\`\`\`

## Troubleshooting Chain of Thought

When helping me troubleshoot, please consider:

1. **${containerName} Issues** (single-machine/external-cluster modes): Container startup, platform compatibility, volume mounting
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

### General:` : `- ${containerName} is installed and running (for single-machine/external-cluster modes)`}
- Sufficient system resources (CPU, memory, disk space)
- Network ports are available (especially for Ray cluster communication)
${mode !== 'slurm' ? '- A bioengine-workdir directory will be created in your home directory for data mounting' : ''}
${mode === 'single-machine' && hasGpu ? `- For GPU mode: NVIDIA ${containerRuntime === 'docker' ? 'Docker runtime' : containerRuntime === 'podman' ? 'container toolkit for Podman' : 'drivers for Apptainer (--nv flag)'}` : ''}
${mode === 'external-cluster' ? '- For external-cluster mode: Target Ray cluster is running and accessible' : ''}

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
    <div className="pt-4">
      <button
        onClick={() => setIsExpanded(!isExpanded)}
        className={`w-full flex items-center justify-between text-left rounded-xl p-4 transition-all duration-200 ${isExpanded
            ? 'bg-gray-50 hover:bg-gray-100 border border-gray-200'
            : 'bg-gradient-to-r from-blue-50 to-purple-50 hover:from-blue-100 hover:to-purple-100 border-2 border-blue-200 hover:shadow-md'
          }`}
      >
        <div className="flex items-center">
          <div className={`rounded-xl flex items-center justify-center mr-4 transition-all duration-200 ${isExpanded
              ? 'w-8 h-8 bg-gradient-to-r from-gray-400 to-gray-500'
              : 'w-12 h-12 bg-gradient-to-r from-cyan-500 to-blue-600 shadow-md'
            }`}>
            <svg className={`text-white transition-all duration-200 ${isExpanded ? 'w-4 h-4' : 'w-6 h-6'}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
          </div>
          <div>
            <h4 className={`font-semibold transition-all duration-200 ${isExpanded
                ? 'text-sm text-gray-700'
                : 'text-lg text-gray-800'
              }`}>Launch Your Own BioEngine Instance</h4>
            <p className={`text-gray-500 transition-all duration-200 ${isExpanded
                ? 'text-xs'
                : 'text-sm font-medium'
              }`}>Access our powerful deployment configurator</p>
          </div>
        </div>
        <div className="flex items-center">
          <span className={`text-gray-500 mr-3 transition-all duration-200 ${isExpanded
              ? 'text-xs'
              : 'text-sm font-medium'
            }`}>{isExpanded ? 'Hide' : 'Show'}</span>
          <svg
            className={`text-gray-400 transition-all duration-200 ${isExpanded
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
                className={`p-4 rounded-lg border-2 cursor-pointer transition-all duration-200 ${mode === 'single-machine'
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
                className={`p-4 rounded-lg border-2 cursor-pointer transition-all duration-200 ${mode === 'slurm'
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
                className={`p-4 rounded-lg border-2 cursor-pointer transition-all duration-200 ${mode === 'external-cluster'
                    ? 'border-orange-500 bg-orange-50 shadow-md'
                    : 'border-gray-200 bg-white hover:border-orange-300 hover:shadow-sm'
                  }`}
                onClick={() => setMode('external-cluster')}
              >
                <div className="flex items-center mb-2">
                  <input
                    type="radio"
                    name="deployment-mode"
                    value="external-cluster"
                    checked={mode === 'external-cluster'}
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

            {/* Ray Address Input for External-Cluster Mode */}
            {mode === 'external-cluster' && (
              <div className="mt-4 p-4 bg-orange-50 rounded-lg border border-orange-200">
                <label className="block text-sm font-medium text-orange-800 mb-2">
                  Ray Cluster Address (Required)
                </label>
                <input
                  type="text"
                  value={rayAddress}
                  onChange={(e) => setRayAddress(e.target.value)}
                  placeholder="ray://head-node-ip"
                  className="w-full px-3 py-2 border border-orange-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-orange-500 focus:border-orange-500"
                  aria-label="Ray cluster address"
                />
                <p className="text-xs text-orange-700 mt-1">
                  Enter the address of your existing Ray cluster. The cluster must be running and accessible from your network.
                </p>
              </div>
            )}
          </div>

          {/* System Configuration */}

          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {/* Operating System */}
            {(mode === 'single-machine' || mode === 'external-cluster') && (
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
                  {os === 'windows' ? 'PowerShell/Command Prompt commands' : 'Terminal commands'}
                </p>
              </div>
            )}

            {/* Container Runtime */}
            {(mode === 'single-machine' || mode === 'external-cluster') && (
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
                  <option value="apptainer">Apptainer</option>
                  <option value="singularity">Singularity</option>
                </select>
                <p className="text-xs text-gray-500 mt-1">
                  {containerRuntime === 'docker'
                    ? 'Docker - Most common container runtime'
                    : containerRuntime === 'podman'
                      ? 'Podman - Daemonless, rootless alternative to Docker'
                      : containerRuntime === 'apptainer'
                        ? 'Apptainer - Modern HPC-focused container runtime, successor to Singularity'
                        : 'Singularity - Original HPC container runtime, now superseded by Apptainer'}
                </p>
              </div>
            )}

            {/* Data Directory */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">Data Directory (Optional)</label>
              <input
                type="text"
                value={dataDir}
                onChange={(e) => {
                  let value = e.target.value;
                  // Validate path format based on OS
                  if (value) {
                    if (os === 'windows') {
                      // Windows: must start with C:\
                      if (!value.startsWith('C:\\')) {
                        if (value.startsWith('/')) {
                          // Convert Unix-style to Windows
                          value = 'C:' + value.replace(/\//g, '\\');
                        } else if (!value.startsWith('C:')) {
                          value = 'C:\\' + value;
                        }
                      }
                    } else {
                      // Unix: must start with /
                      if (!value.startsWith('/')) {
                        value = '/' + value;
                      }
                    }
                  }
                  setDataDir(value);
                }}
                placeholder={os === 'windows' ? 'C:\\path\\to\\data' : '/path/to/data'}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
              />
              <p className="text-xs text-gray-500 mt-1">
                Optional directory to mount as /data in the container. {os === 'windows' ? 'Windows path starting with C:\\' : 'Absolute path starting with /'}
              </p>
            </div>

            {/* Shared Memory Size */}
            {mode === 'single-machine' && (
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">Shared Memory Size</label>
                <select
                  value={shmSize}
                  onChange={(e) => setShmSize(e.target.value)}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                  aria-label="Select shared memory size"
                >
                  <option value="1g">1 GB</option>
                  <option value="2g">2 GB</option>
                  <option value="4g">4 GB</option>
                  <option value="6g">6 GB</option>
                  <option value="8g">8 GB</option>
                  <option value="10g">10 GB</option>
                  <option value="12g">12 GB</option>
                  <option value="14g">14 GB</option>
                  <option value="16g">16 GB</option>
                </select>
                <p className="text-xs text-gray-500 mt-1">
                  {containerRuntime} shared memory size for Ray operations and data processing, you will likely need to increase this for large models.
                  {(containerRuntime === 'apptainer' || containerRuntime === 'singularity') ? ` (Note: ${containerRuntime} uses system shared memory)` : ''}
                </p>
              </div>
            )}

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
                  {hasGpu ? `Requires NVIDIA ${containerRuntime === 'docker' ? 'Docker runtime' : containerRuntime === 'podman' ? 'container toolkit for Podman' : `drivers for ${containerRuntime} (--nv flag)`}` : 'CPU-only mode, no GPU acceleration'}
                </p>
              </div>
            )}

            {/* Run as Root */}
            {(mode === 'single-machine' || mode === 'external-cluster') && (containerRuntime === 'docker' || containerRuntime === 'podman') && (
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
            )}

            {/* Interactive Mode */}
            {(mode === 'single-machine' || mode === 'external-cluster') && (
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
                  {interactiveMode ? `Yes (separate ${containerRuntime.charAt(0).toUpperCase() + containerRuntime.slice(1)} and Python commands${containerRuntime === 'apptainer' || containerRuntime === 'singularity' ? ` with ${containerRuntime} shell` : ' with --entrypoint bash'})` : 'No (single command)'}
                </p>
              </div>
            )}
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
                <label className="block text-sm font-medium text-gray-700 mb-2">Admin Users</label>
                <input
                  type="text"
                  value={adminUsers}
                  onChange={(e) => setAdminUsers(e.target.value)}
                  placeholder="user1,user2,user3 or *"
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                />
                <p className="text-xs text-gray-500 mt-1">Users who can manage the BioEngine worker. Leave empty to use the logged-in user as admin, use * for all users, or provide comma-separated list</p>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">Cache Directory</label>
                <input
                  type="text"
                  value={cacheDir}
                  onChange={(e) => {
                    let value = e.target.value;
                    // Validate path format based on OS
                    if (value) {
                      if (os === 'windows') {
                        // Windows: must start with C:\
                        if (!value.startsWith('C:\\')) {
                          if (value.startsWith('/')) {
                            // Convert Unix-style to Windows
                            value = 'C:' + value.replace(/\//g, '\\');
                          } else if (!value.startsWith('C:')) {
                            value = 'C:\\' + value;
                          }
                        }
                      } else {
                        // Unix: must start with /
                        if (!value.startsWith('/')) {
                          value = '/' + value;
                        }
                      }
                    }
                    setCacheDir(value);
                  }}
                  placeholder={os === 'windows' ? 'C:\\path\\to\\cache' : '/path/to/cache'}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                />
                <p className="text-xs text-gray-500 mt-1">
                  {os === 'windows' ? 'Windows path starting with C:\\' : 'Absolute path starting with /'}
                </p>
              </div>

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
                <label className="block text-sm font-medium text-gray-700 mb-2">Client ID</label>
                <input
                  type="text"
                  value={clientId}
                  onChange={(e) => setClientId(e.target.value)}
                  placeholder="bioengine-worker-123"
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                />
                <p className="text-xs text-gray-500 mt-1">Custom client ID for the worker. If not set, one will be generated automatically</p>
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
                <label className="block text-sm font-medium text-gray-700 mb-2">Container Image</label>
                <input
                  type="text"
                  value={customImage}
                  onChange={(e) => setCustomImage(e.target.value)}
                  placeholder="ghcr.io/aicell-lab/bioengine-worker:0.2.2"
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                />
                <p className="text-xs text-gray-500 mt-1">Custom container image to use. Leave empty for default bioengine-worker image</p>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">Platform Override</label>
                <select
                  value={platformOverride}
                  onChange={(e) => setPlatformOverride(e.target.value)}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                  aria-label="Select platform override"
                >
                  <option value="">Auto-detect (default)</option>
                  <option value="linux/amd64">linux/amd64</option>
                  <option value="linux/arm64">linux/arm64</option>
                </select>
                <p className="text-xs text-gray-500 mt-1">Override platform detection. Docker usually auto-detects correctly, so leave as default unless needed</p>
              </div>

              {/* External Cluster Port Configuration */}
              {mode === 'external-cluster' && (
                <>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-2">Client Server Port</label>
                    <input
                      type="number"
                      min="1024"
                      max="65535"
                      value={clientServerPort}
                      onChange={(e) => setClientServerPort(e.target.value)}
                      placeholder="10001"
                      className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                    />
                    <p className="text-xs text-gray-500 mt-1">Port for Ray client server (default: 10001)</p>
                  </div>

                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-2">Serve Port</label>
                    <input
                      type="number"
                      min="1024"
                      max="65535"
                      value={servePort}
                      onChange={(e) => setServePort(e.target.value)}
                      placeholder="8000"
                      className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                    />
                    <p className="text-xs text-gray-500 mt-1">Port for Ray Serve (default: 8000)</p>
                  </div>
                </>
              )}
            </div>
          )}

          {/* Generated Command */}
          <div className="bg-gray-900 rounded-xl p-4 relative">
            <div className="flex justify-between items-start mb-2">
              <h4 className="text-sm font-medium text-gray-300">
                {mode === 'slurm'
                  ? 'SLURM Cluster Command:'
                  : os === 'windows'
                    ? 'PowerShell/Command Prompt Command:'
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

                // Add volume mount information
                if (mode !== 'slurm') {
                  let mountInfo = '\n\n# Volume mounts:';

                  if (cacheDir) {
                    mountInfo += `\n# - ${cacheDir} → /tmp/bioengine (cache)`;
                  } else {
                    const hostPath = os === 'windows'
                      ? (runAsRoot ? 'C:\\.bioengine' : '%USERPROFILE%\\.bioengine')
                      : '$HOME/.bioengine';
                    mountInfo += `\n# - ${hostPath} → /tmp/bioengine (cache)`;
                  }

                  if (dataDir) {
                    mountInfo += `\n# - ${dataDir} → /data (data)`;
                  }

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
                      <li>{containerRuntime.charAt(0).toUpperCase() + containerRuntime.slice(1)} must be installed and running{(containerRuntime === 'apptainer' || containerRuntime === 'singularity') ? ' (or available on your system)' : ''}</li>
                      {mode === 'single-machine' && hasGpu && <li>NVIDIA {containerRuntime === 'docker' ? 'Docker runtime' : containerRuntime === 'podman' ? 'container toolkit' : 'drivers'} required for GPU support</li>}
                      {mode === 'external-cluster' && <li>Existing Ray cluster must be running and accessible</li>}
                    </>
                  )}
                  {interactiveMode && mode !== 'slurm' && <li>Interactive mode: Run the {containerRuntime} command first, then execute the Python command inside the container</li>}
                  {interactiveMode && mode === 'slurm' && <li>Interactive mode: You can inspect the script before running it</li>}
                  <li>A directory will be created in your home directory for cache storage and mounted to /tmp/bioengine in the container</li>
                  {dataDir && mode !== 'slurm' && <li>
                    Your specified data directory ({dataDir}) will be mounted to /data in the container
                  </li>}
                  <li>You'll need to authenticate via browser when prompted (see authentication section above)</li>
                  <li>After running, the worker will be available at the service ID shown in the terminal</li>
                  <li>Use the service ID to connect to your BioEngine worker from this interface</li>
                  {mode === 'external-cluster' && <li>Make sure the Ray address is accessible from your network</li>}
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
        </div>
      )}
    </div>
  );
};

export default BioEngineGuide;