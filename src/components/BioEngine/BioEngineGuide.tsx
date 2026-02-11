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
  const [workspaceDir, setWorkspaceDir] = useState('');
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

    // Get the base workspace directory
    let baseWorkspace = workspaceDir;
    if (!baseWorkspace) {
      if (os === 'windows') {
        baseWorkspace = runAsRoot ? 'C:\\.bioengine' : '%USERPROFILE%\\.bioengine';
      } else {
        baseWorkspace = '$HOME/.bioengine';
      }
    }

    // Remove trailing slash if present and append /images
    const normalizedWorkspace = baseWorkspace.endsWith('/') || baseWorkspace.endsWith('\\')
      ? baseWorkspace.slice(0, -1)
      : baseWorkspace;

    return os === 'windows'
      ? `${normalizedWorkspace}\\images`
      : `${normalizedWorkspace}/images`;
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
      args.push(`--head-num-cpus ${cpus}`);
      if (hasGpu) {
        args.push(`--head-num-gpus ${gpus}`);
      }
    } else if (mode === 'external-cluster' && rayAddress) {
      args.push(`--connection-address ${rayAddress}`);
      // Add port configuration for external cluster
      if (clientServerPort && clientServerPort !== '10001') {
        args.push(`--client-server-port ${clientServerPort}`);
      }
      if (servePort && servePort !== '8000') {
        args.push(`--serve-port ${servePort}`);
      }
    }

    // Advanced arguments
    if (workspace) args.push(`--workspace ${workspace}`);
    if (serverUrl) args.push(`--server-url ${serverUrl}`);
    if (token) args.push(`--token ${token}`);

    // Handle admin users - only add flag if users are specified
    if (adminUsers) {
      if (adminUsers === '*') {
        args.push(`--admin-users "*"`);
      } else {
        const users = adminUsers.split(',').map(u => u.trim()).join(' ');
        args.push(`--admin-users ${users}`);
      }
    }

    if (clientId) args.push(`--client-id ${clientId}`);

    // Add custom image if specified
    if (customImage) args.push(`--image ${customImage}`);

    const argsString = args.length > 0 ? args.join(' ') : '';

    // SLURM mode uses the bash script instead of Docker
    if (mode === 'slurm') {
      // Add workspace directory for SLURM mode only
      if (workspaceDir) args.push(`--workspace-dir ${workspaceDir}`);

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
    const imageToUse = customImage || 'ghcr.io/aicell-lab/bioengine-worker:0.5.18';

    // Build volume mounts
    let volumeMounts = '';
    const mounts: string[] = [];

    // Handle workspace directory mount
    if (workspaceDir) {
      // User specified a custom workspace directory - mount it directly to /.bioengine
      if (containerRuntime === 'apptainer' || containerRuntime === 'singularity') {
        mounts.push(`--bind ${workspaceDir}:/.bioengine`);
      } else {
        mounts.push(`-v ${workspaceDir}:/.bioengine`);
      }
    } else {
      // No custom workspace directory - mount default ~/.bioengine to /.bioengine
      if (os === 'windows') {
        const hostWorkspacePath = runAsRoot ? `C:\\.bioengine` : '%USERPROFILE%\\.bioengine';
        if (containerRuntime === 'apptainer' || containerRuntime === 'singularity') {
          mounts.push(`--bind ${hostWorkspacePath}:/.bioengine`);
        } else {
          mounts.push(`-v ${hostWorkspacePath}:/.bioengine`);
        }
      } else {
        if (containerRuntime === 'apptainer' || containerRuntime === 'singularity') {
          mounts.push(`--bind $HOME/.bioengine:/.bioengine`);
        } else {
          mounts.push(`-v $HOME/.bioengine:/.bioengine`);
        }
      }
    }

    volumeMounts = mounts.join(' ');

    // Create directory creation commands - only for default directories
    let createDirCmd = '';
    if (os === 'windows') {
      const dirs: string[] = [];

      // Always create workspace directory
      if (workspaceDir) {
        dirs.push(`"${workspaceDir}"`);
      } else {
        const workspacePath = runAsRoot ? 'C:\\.bioengine' : '%USERPROFILE%\\.bioengine';
        dirs.push(`"${workspacePath}"`);
      }

      if (dirs.length > 0) {
        createDirCmd = dirs.map(dir => `cmd /c "mkdir ${dir} 2>nul || echo Directory already exists"`).join(' && ');
      }
    } else {
      const dirs: string[] = [];

      // Always create workspace directory
      if (workspaceDir) {
        dirs.push(`"${workspaceDir}"`);
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

      const pythonCmd = `python -m bioengine.worker ${argsString}`;

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
          dockerCmd = `cmd /c "${cacheEnv}${containerRuntime} exec ${gpuFlag}${volumeMounts} docker://${imageToUse} python -m bioengine.worker ${argsString}"`;
        } else {
          dockerCmd = `${cacheEnv}${containerRuntime} exec ${gpuFlag}${volumeMounts} docker://${imageToUse} python -m bioengine.worker ${argsString}`;
        }
      } else if (os === 'windows') {
        dockerCmd = `cmd /c "${containerRuntime} run ${gpuFlag}${platformFlag}-it --rm ${shmFlag}${volumeMounts} ${imageToUse} python -m bioengine.worker ${argsString}"`;
      } else {
        dockerCmd = `${containerRuntime} run ${gpuFlag}${platformFlag}-it --rm ${shmFlag}${userFlag}${volumeMounts} ${imageToUse} python -m bioengine.worker ${argsString}`;
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

I'm trying to set up a **BioEngine Worker** for bioimage analysis. BioEngine is part of the RI-SCALE project and provides cloud-powered AI tools for bioimage analysis. Here's what I need help with:

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
${workspaceDir ? `- **Workspace Directory**: ${workspaceDir}` : ''}
${customImage ? `- **Custom Image**: ${customImage}` : ''}
${platformOverride ? `- **Platform Override**: ${platformOverride}` : ''}
${clientId ? `- **Client ID**: ${clientId}` : ''}

### Generated ${containerName} Command
\`\`\`bash
${commandText}
\`\`\`

## Complete BioEngine Worker Help Reference

\`\`\`
python -m bioengine.worker --help
usage: __main__.py [-h] --mode MODE [--admin-users EMAIL [EMAIL ...]] [--workspace-dir PATH] [--ray-workspace-dir PATH] [--startup-applications JSON [JSON ...]]
                   [--monitoring-interval-seconds SECONDS] [--dashboard-url URL] [--log-file PATH] [--debug] [--graceful-shutdown-timeout SECONDS] [--server-url URL]
                   [--workspace NAME] [--token TOKEN] [--client-id ID] [--head-node-address ADDRESS] [--head-node-port PORT] [--node-manager-port PORT]
                   [--object-manager-port PORT] [--redis-shard-port PORT] [--serve-port PORT] [--dashboard-port PORT] [--client-server-port PORT] [--redis-password PASSWORD]
                   [--head-num-cpus COUNT] [--head-num-gpus COUNT] [--head-memory-in-gb GB] [--runtime-env-pip-cache-size-gb GB] [--no-ray-cleanup] [--image IMAGE]
                   [--worker-workspace-dir PATH] [--default-num-gpus COUNT] [--default-num-cpus COUNT] [--default-mem-in-gb-per-cpu GB] [--default-time-limit TIME]
                   [--further-slurm-args ARG [ARG ...]] [--min-workers COUNT] [--max-workers COUNT] [--scale-up-cooldown-seconds SECONDS]
                   [--scale-down-check-interval-seconds SECONDS] [--scale-down-threshold-seconds SECONDS]

BioEngine Worker - Enterprise AI Model Deployment Platform

options:
  -h, --help            show this help message and exit

Core Options:
  Basic worker configuration

  --mode MODE           Deployment mode: 'single-machine' for local Ray cluster, 'slurm' for HPC clusters with SLURM job scheduling, 'external-cluster' for connecting to an
                        existing Ray cluster
  --admin-users EMAIL [EMAIL ...]
                        List of user emails/IDs with administrative privileges for worker management. If not specified, defaults to the authenticated user from Hypha login.
  --workspace-dir PATH  Directory for worker workspace, temporary files, and Ray data storage. Also used to detect running data servers for dataset access. Should be
                        accessible across worker nodes in distributed deployments.
  --ray-workspace-dir PATH
                        Directory for Ray cluster workspace when connecting to an external Ray cluster. Only used in 'external-cluster' mode. This allows the remote Ray
                        cluster to use a different workspace directory than the local machine. If not specified, uses the same directory as --workspace-dir. Not applicable for
                        'single-machine' or 'slurm' modes.
  --startup-applications JSON [JSON ...]
                        List of applications to deploy automatically during worker startup. Each element should be a JSON string with deployment configuration. Example:
                        '{"artifact_id": "my_model", "application_id": "my_app"}'
  --monitoring-interval-seconds SECONDS
                        Interval in seconds for worker status monitoring and health checks. Lower values provide faster response but increase overhead.
  --dashboard-url URL   Base URL of the BioEngine dashboard for worker management interfaces.
  --log-file PATH       Path to the log file. If set to 'off', logging will only go to console. If not specified (None), a log file will be created in '<workspace_dir>/logs'.
  --debug               Enable debug-level logging for detailed troubleshooting and development. Increases log verbosity significantly.
  --graceful-shutdown-timeout SECONDS
                        Timeout in seconds for graceful shutdown operations.

Hypha Options:
  Server connection and authentication

  --server-url URL      URL of the Hypha server for service registration and remote access. Must be accessible from the deployment environment.
  --workspace NAME      Hypha workspace name for service isolation and organization. If not specified, uses the workspace associated with the authentication token.
  --token TOKEN         Authentication token for Hypha server access. If not provided, will use the HYPHA_TOKEN environment variable or prompt for interactive login. Recommend
                        using a long-lived token for production deployments.
  --client-id ID        Unique client identifier for Hypha connection. If not specified, an identifier will be generated automatically to ensure unique registration.

Ray Cluster Options:
  Cluster networking and resource configuration

  --head-node-address ADDRESS
                        IP address of the Ray head node. For external-cluster mode, this specifies the cluster to connect to. If not set in other modes, uses the first
                        available system IP address.
  --head-node-port PORT
                        Port for Ray head node and GCS (Global Control Service) server. Must be accessible from all worker nodes.
  --node-manager-port PORT
                        Port for Ray node manager services. Used for inter-node communication and coordination.
  --object-manager-port PORT
                        Port for Ray object manager service. Handles distributed object storage and transfer between nodes.
  --redis-shard-port PORT
                        Port for Redis sharding in Ray's internal metadata storage. Used for cluster state management.
  --serve-port PORT     Port for Ray Serve HTTP endpoint serving deployed models and applications. This is where model inference requests are handled.
  --dashboard-port PORT
                        Port for Ray dashboard web interface. Provides cluster monitoring and debugging capabilities.
  --client-server-port PORT
                        Port for Ray client server connections. Used by external Ray clients to connect to the cluster.
  --redis-password PASSWORD
                        Password for Ray cluster Redis authentication. If not specified, a secure random password will be generated automatically.
  --head-num-cpus COUNT
                        Number of CPU cores allocated to the head node for task execution. Set to 0 to reserve head node for coordination only.
  --head-num-gpus COUNT
                        Number of GPU devices allocated to the head node for task execution. Typically 0 to reserve GPUs for worker nodes.
  --head-memory-in-gb GB
                        Memory allocation in GB for head node task execution. If not specified, Ray will auto-detect available memory.
  --runtime-env-pip-cache-size-gb GB
                        Size limit in GB for Ray runtime environment pip package cache. Larger cache improves environment setup time.
  --no-ray-cleanup      Skip cleanup of previous Ray cluster processes and data. Use with caution as it may cause port conflicts or resource issues.

SLURM Job Options:
  HPC job scheduling and worker deployment

  --image IMAGE         Container image for SLURM worker jobs. Should include all required dependencies and be accessible on compute nodes.
  --worker-workspace-dir PATH
                        Workspace directory path mounted to worker containers in SLURM jobs. Must be accessible from compute nodes. Required for SLURM mode.
  --default-num-gpus COUNT
                        Default number of GPU devices to request per SLURM worker job. Can be overridden per deployment.
  --default-num-cpus COUNT
                        Default number of CPU cores to request per SLURM worker job. Should match typical model inference requirements.
  --default-mem-in-gb-per-cpu GB
                        Default memory allocation in GB per CPU core for SLURM workers. Total memory = num_cpus * mem_per_cpu.
  --default-time-limit TIME
                        Default time limit for SLURM worker jobs in "HH:MM:SS" format. Jobs will be terminated after this duration.
  --further-slurm-args ARG [ARG ...]
                        Additional SLURM sbatch arguments for specialized cluster configurations. Example: "--partition=gpu" "--qos=high-priority"

Ray Autoscaler Options:
  Automatic worker scaling behavior

  --min-workers COUNT   Minimum number of worker nodes to maintain in the cluster. Workers below this threshold will be started immediately.
  --max-workers COUNT   Maximum number of worker nodes allowed in the cluster. Prevents unlimited scaling and controls costs.
  --scale-up-cooldown-seconds SECONDS
                        Cooldown period in seconds between scaling up operations. Prevents rapid scaling oscillations.
  --scale-down-check-interval-seconds SECONDS
                        Interval in seconds between checks for scaling down idle workers. More frequent checks enable faster response to load changes.
  --scale-down-threshold-seconds SECONDS
                        Time threshold in seconds before scaling down idle worker nodes. Longer thresholds reduce churn but may waste resources.

Examples:
  # SLURM HPC deployment with autoscaling
  __main__.py --mode slurm --max-workers 10 --admin-users admin@institution.edu

  # Single-machine development deployment  
  __main__.py --mode single-machine --debug --workspace-dir ./workspace

  # Connect to existing Ray cluster
  __main__.py --mode external-cluster --head-node-address 10.0.0.100

For detailed documentation, visit: https://github.com/aicell-lab/bioengine-worker
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

              {/* Kubernetes Cluster Option */}
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
                    aria-label="Kubernetes cluster deployment mode"
                  />
                  <span className="ml-2 font-medium text-gray-800">☸️ Kubernetes Cluster</span>
                </div>
                <p className="text-sm text-gray-600 ml-6">
                  Deploy on Kubernetes with KubeRay. Creates a Ray cluster on K8s
                  and connects BioEngine to it for scalable, cloud-native deployment.
                </p>
                <div className="mt-2 ml-6">
                  <span className="inline-block px-2 py-1 text-xs bg-orange-100 text-orange-700 rounded">
                    Cloud Native
                  </span>
                </div>
              </div>
            </div>
          </div>

          {/* Kubernetes Cluster Setup Instructions - Outside the mode selection box */}
          {mode === 'external-cluster' && (
            <div className="space-y-4">
              {/* Step 1: Create Ray Cluster */}
              <div className="p-4 bg-orange-50 rounded-xl border border-orange-200">
                <h5 className="text-sm font-medium text-orange-800 mb-3 flex items-center">
                  <span className="w-5 h-5 bg-orange-600 text-white rounded-full flex items-center justify-center text-xs mr-2">1</span>
                  Create a Ray Cluster on Kubernetes
                </h5>
                <div className="text-sm text-orange-700 space-y-2">
                  <p>First, deploy a Ray cluster on your Kubernetes cluster using KubeRay:</p>
                  <ol className="list-decimal list-inside space-y-1 ml-2 text-xs">
                    <li>Install the KubeRay operator: <code className="bg-orange-100 px-1 rounded">helm install kuberay-operator kuberay/kuberay-operator</code></li>
                    <li>Deploy a RayCluster: <code className="bg-orange-100 px-1 rounded">kubectl apply -f raycluster.yaml</code></li>
                    <li>Get the Ray head service address: <code className="bg-orange-100 px-1 rounded">kubectl get svc</code></li>
                  </ol>
                  <a
                    href="https://docs.ray.io/en/master/cluster/kubernetes/getting-started/raycluster-quick-start.html"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center text-orange-600 hover:text-orange-800 font-medium mt-2"
                  >
                    📚 KubeRay Quick Start Guide
                    <svg className="w-3 h-3 ml-1" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
                    </svg>
                  </a>
                </div>
              </div>

              {/* Step 2: Ray Cluster Address */}
              <div className="p-4 bg-orange-50 rounded-xl border border-orange-200">
                <h5 className="text-sm font-medium text-orange-800 mb-3 flex items-center">
                  <span className="w-5 h-5 bg-orange-600 text-white rounded-full flex items-center justify-center text-xs mr-2">2</span>
                  Enter Ray Cluster Address
                </h5>
                <input
                  type="text"
                  value={rayAddress}
                  onChange={(e) => setRayAddress(e.target.value)}
                  placeholder="ray://raycluster-head-svc:10001"
                  className="w-full px-3 py-2 border border-orange-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-orange-500 focus:border-orange-500"
                  aria-label="Ray cluster address"
                />
                <p className="text-xs text-orange-700 mt-1">
                  Enter the Ray head service address from your Kubernetes cluster (e.g., <code className="bg-orange-100 px-1 rounded">ray://raycluster-head-svc:10001</code>)
                </p>
              </div>
            </div>
          )}

          {/* System Configuration */}
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {/* Kubernetes basic options */}
            {mode === 'external-cluster' && (
              <>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">Admin Users</label>
                  <input
                    type="text"
                    value={adminUsers}
                    onChange={(e) => setAdminUsers(e.target.value)}
                    placeholder="user1,user2 or *"
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                  />
                  <p className="text-xs text-gray-500 mt-1">Users who can manage the worker (use * for all)</p>
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
                  <p className="text-xs text-gray-500 mt-1">Custom client ID (auto-generated if empty)</p>
                </div>
              </>
            )}

            {/* Operating System */}
            {mode === 'single-machine' && (
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
            {mode === 'single-machine' && (
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
            {mode === 'single-machine' && (containerRuntime === 'docker' || containerRuntime === 'podman') && (
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
            {mode === 'single-machine' && (
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
                <label className="block text-sm font-medium text-gray-700 mb-2">Workspace Directory</label>
                <input
                  type="text"
                  value={workspaceDir}
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
                    setWorkspaceDir(value);
                  }}
                  placeholder={os === 'windows' ? 'C:\\path\\to\\workspace' : '/path/to/workspace'}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                />
                <p className="text-xs text-gray-500 mt-1">
                  Directory for worker workspace, temporary files, and Ray data storage. Defaults to ~/.bioengine if not specified. {os === 'windows' ? 'Windows path starting with C:\\' : 'Absolute path starting with /'}
                </p>
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
                <label className="block text-sm font-medium text-gray-700 mb-2">Workspace</label>
                <input
                  type="text"
                  value={workspace}
                  onChange={(e) => setWorkspace(e.target.value)}
                  placeholder="my-workspace"
                  autoComplete="off"
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                />
                <p className="text-xs text-gray-500 mt-1">Hypha workspace name (optional, uses token's workspace if not set)</p>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">Token</label>
                <input
                  type="password"
                  value={token}
                  onChange={(e) => setToken(e.target.value)}
                  placeholder="Enter token"
                  autoComplete="new-password"
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                />
                <p className="text-xs text-gray-500 mt-1">Hypha authentication token (optional, will prompt for login if not set)</p>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">Container Image</label>
                <input
                  type="text"
                  value={customImage}
                  onChange={(e) => setCustomImage(e.target.value)}
                  placeholder="ghcr.io/aicell-lab/bioengine-worker:0.5.18"
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

          {/* Kubernetes Deployment YAML - Only for Kubernetes mode */}
          {mode === 'external-cluster' && (
            <div className="p-4 bg-blue-50 rounded-xl border border-blue-200">
              <h5 className="text-sm font-medium text-blue-800 mb-3 flex items-center">
                <span className="w-5 h-5 bg-blue-600 text-white rounded-full flex items-center justify-center text-xs mr-2">3</span>
                Deploy BioEngine Worker on Kubernetes
              </h5>
              <p className="text-sm text-blue-700 mb-3">
                Deploy BioEngine as a Kubernetes Deployment alongside your Ray cluster. Configure options above then copy the generated YAML:
              </p>
              <div className="bg-gray-900 rounded-lg p-3 relative">
                <button
                  onClick={async () => {
                    // Build optional args
                    let optionalArgs = '';
                    if (serverUrl) {
                      optionalArgs += `        - "--server-url"\n        - "${serverUrl}"\n`;
                    }
                    if (workspace) {
                      optionalArgs += `        - "--workspace"\n        - "${workspace}"\n`;
                    }
                    if (token) {
                      optionalArgs += `        - "--token"\n        - "${token}"\n`;
                    }
                    if (adminUsers) {
                      optionalArgs += `        - "--admin-users"\n        - "${adminUsers}"\n`;
                    }
                    if (clientId) {
                      optionalArgs += `        - "--client-id"\n        - "${clientId}"\n`;
                    }

                    const yaml = `apiVersion: apps/v1
kind: Deployment
metadata:
  name: bioengine-worker
  labels:
    app: bioengine-worker
spec:
  replicas: 1
  selector:
    matchLabels:
      app: bioengine-worker
  template:
    metadata:
      labels:
        app: bioengine-worker
    spec:
      containers:
      - name: bioengine-worker
        image: ghcr.io/aicell-lab/bioengine-worker:0.5.18
        args:
        - "python"
        - "-m"
        - "bioengine.worker"
        - "--mode"
        - "external-cluster"
        - "--connection-address"
        - "${rayAddress || 'ray://raycluster-head-svc:10001'}"
${optionalArgs}        resources:
          requests:
            memory: "2Gi"
            cpu: "1"
          limits:
            memory: "4Gi"
            cpu: "2"
        volumeMounts:
        - name: bioengine-cache
          mountPath: /.bioengine
      volumes:
      - name: bioengine-cache
        persistentVolumeClaim:
          claimName: bioengine-cache-pvc
---
apiVersion: v1
kind: PersistentVolumeClaim
metadata:
  name: bioengine-cache-pvc
spec:
  accessModes:
    - ReadWriteOnce
  resources:
    requests:
      storage: 10Gi`;
                    try {
                      await navigator.clipboard.writeText(yaml);
                    } catch (err) {
                      console.error('Failed to copy:', err);
                    }
                  }}
                  className="absolute top-2 right-2 px-2 py-1 bg-blue-600 hover:bg-blue-700 text-white text-xs rounded transition-colors duration-200"
                >
                  Copy YAML
                </button>
                <pre className="text-green-400 text-xs font-mono overflow-x-auto max-h-48 overflow-y-auto">
{`apiVersion: apps/v1
kind: Deployment
metadata:
  name: bioengine-worker
spec:
  replicas: 1
  selector:
    matchLabels:
      app: bioengine-worker
  template:
    spec:
      containers:
      - name: bioengine-worker
        image: ghcr.io/aicell-lab/bioengine-worker:0.5.18
        args:
        - "python"
        - "-m"
        - "bioengine.worker"
        - "--mode"
        - "external-cluster"
        - "--connection-address"
        - "${rayAddress || 'ray://raycluster-head-svc:10001'}"${serverUrl ? `
        - "--server-url"
        - "${serverUrl}"` : ''}${workspace ? `
        - "--workspace"
        - "${workspace}"` : ''}${token ? `
        - "--token"
        - "${token}"` : ''}${adminUsers ? `
        - "--admin-users"
        - "${adminUsers}"` : ''}${clientId ? `
        - "--client-id"
        - "${clientId}"` : ''}
        volumeMounts:
        - name: bioengine-cache
          mountPath: /.bioengine
      volumes:
      - name: bioengine-cache
        persistentVolumeClaim:
          claimName: bioengine-cache-pvc`}
                </pre>
              </div>
              <p className="text-xs text-blue-700 mt-2">
                Save this as <code className="bg-blue-100 px-1 rounded">bioengine-deployment.yaml</code> and apply with: <code className="bg-blue-100 px-1 rounded">kubectl apply -f bioengine-deployment.yaml</code>
              </p>
            </div>
          )}

          {/* Generated Command - Hidden for Kubernetes mode */}
          {mode !== 'external-cluster' && (
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

                  if (workspaceDir) {
                    mountInfo += `\n# - ${workspaceDir} → /.bioengine (workspace)`;
                  } else {
                    const hostPath = os === 'windows'
                      ? (runAsRoot ? 'C:\\.bioengine' : '%USERPROFILE%\\.bioengine')
                      : '$HOME/.bioengine';
                    mountInfo += `\n# - ${hostPath} → /.bioengine (workspace)`;
                  }

                  commandText += mountInfo;
                }

                return commandText;
              })()}
            </code>
          </div>
          )}

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

          {/* Login Instructions - Hidden for Kubernetes mode */}
          {mode !== 'external-cluster' && (
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
          )}

          {/* Additional Info - Hidden for Kubernetes mode */}
          {mode !== 'external-cluster' && (
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
                    </>
                  )}
                  {interactiveMode && mode !== 'slurm' && <li>Interactive mode: Run the {containerRuntime} command first, then execute the Python command inside the container</li>}
                  {interactiveMode && mode === 'slurm' && <li>Interactive mode: You can inspect the script before running it</li>}
                  <li>A directory will be created in your home directory for workspace storage and mounted to /.bioengine in the container</li>
                  <li>You'll need to authenticate via browser when prompted (see authentication section above)</li>
                  <li>After running, the worker will be available at the service ID shown in the terminal</li>
                  <li>Use the service ID to connect to your BioEngine worker from this interface</li>
                  {mode === 'slurm' && <li>The script will automatically handle SLURM job submission and container management</li>}
                </ul>
              </div>
            </div>
          </div>
          )}

          {/* Troubleshooting Button - Hidden for Kubernetes mode */}
          {mode !== 'external-cluster' && (
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
          )}
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