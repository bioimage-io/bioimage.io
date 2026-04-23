import React, { useState, useRef, useEffect, useCallback } from 'react';
import { hyphaWebsocketClient } from 'hypha-rpc';
import { useHyphaStore } from '../../store/hyphaStore';

type OSType = 'macos' | 'linux' | 'windows';
type ModeType = 'single-machine' | 'slurm' | 'external-cluster';
type ContainerRuntimeType = 'docker' | 'podman' | 'apptainer' | 'singularity';

const DEFAULT_IMAGE = 'ghcr.io/aicell-lab/bioengine-worker:0.7.1';

const BioEngineGuide: React.FC = () => {
  const { server, isLoggedIn } = useHyphaStore();
  const [os, setOS] = useState<OSType>('macos');
  const [mode, setMode] = useState<ModeType>('single-machine');
  const [containerRuntime, setContainerRuntime] = useState<ContainerRuntimeType>('docker');
  const [cpus, setCpus] = useState(2);
  const [gpus, setGpus] = useState(0);
  const [memory, setMemory] = useState(10);
  const [copied, setCopied] = useState(false);
  const [copiedStep1, setCopiedStep1] = useState(false);
  const [copiedStep2, setCopiedStep2] = useState(false);
  const [isExpanded, setIsExpanded] = useState(false);
  const [showAdvanced, setShowAdvanced] = useState(false);

  // Main settings
  const [token, setToken] = useState('');
  const [tokenIsManual, setTokenIsManual] = useState(false);
  const [isGeneratingToken, setIsGeneratingToken] = useState(false);
  const [tokenError, setTokenError] = useState<string | null>(null);

  // Advanced options
  const [workspace, setWorkspace] = useState('');
  const [serverUrl, setServerUrl] = useState('');
  const [rayAddress, setRayAddress] = useState('');
  const [adminUsers, setAdminUsers] = useState('');
  const [workerName, setWorkerName] = useState('');
  const [workspaceDir, setWorkspaceDir] = useState('');
  const [showTroubleshooting, setShowTroubleshooting] = useState(false);
  const [promptCopied, setPromptCopied] = useState(false);
  const [shmSize, setShmSize] = useState('8g');
  const [customImage, setCustomImage] = useState('');
  const [platformOverride, setPlatformOverride] = useState('');
  const [clientId, setClientId] = useState('');
  const [clientServerPort, setClientServerPort] = useState('10001');
  const [servePort, setServePort] = useState('8000');
  const [runAsRoot, setRunAsRoot] = useState(false);
  const [gpuIndices, setGpuIndices] = useState('');

  // Kubernetes-specific options
  const [hasPvc, setHasPvc] = useState(false);
  const [rayWorkspaceDir, setRayWorkspaceDir] = useState('');
  const [k8sNamespace, setK8sNamespace] = useState('');
  const [showRayWorkspaceDirDialog, setShowRayWorkspaceDirDialog] = useState(false);
  const [k8sSecretCopied, setK8sSecretCopied] = useState(false);
  const [k8sYamlCopied, setK8sYamlCopied] = useState(false);
  const [k8sApplyCopied, setK8sApplyCopied] = useState(false);

  const troubleshootingDialogRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (showTroubleshooting && troubleshootingDialogRef.current) {
      setTimeout(() => {
        troubleshootingDialogRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center', inline: 'center' });
      }, 100);
    }
  }, [showTroubleshooting]);

  // Auto-generate token when user is logged in and no manual token is set
  const generateToken = useCallback(async () => {
    if (!isLoggedIn || !server) return;
    setIsGeneratingToken(true);
    setTokenError(null);
    try {
      const thirtyDays = 30 * 24 * 3600;
      const generatedToken = await server.generateToken({ permission: 'admin', expires_in: thirtyDays });
      setToken(generatedToken);
      setTokenIsManual(false);
    } catch (err) {
      setTokenError(`Failed to generate token: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setIsGeneratingToken(false);
    }
  }, [isLoggedIn, server]);

  useEffect(() => {
    if (isLoggedIn && !tokenIsManual && !token) {
      generateToken();
    }
  }, [isLoggedIn, tokenIsManual, token, generateToken]);

  // When the token changes, briefly connect to Hypha to resolve the workspace
  const [workspaceResolved, setWorkspaceResolved] = useState(false);
  useEffect(() => {
    if (!token) return;
    let cancelled = false;
    const resolveWorkspace = async () => {
      try {
        const url = serverUrl || 'https://hypha.aicell.io';
        const tmpServer = await hyphaWebsocketClient.connectToServer({ server_url: url, token });
        if (!cancelled) {
          const ws = tmpServer?.config?.workspace as string | undefined;
          if (ws) {
            setWorkspace(ws);
            setWorkspaceResolved(true);
          }
        }
        try { await tmpServer?.disconnect?.(); } catch (_) { /* ignore */ }
      } catch (_) {
        // Token may be invalid or network unavailable — silently ignore
      }
    };
    setWorkspaceResolved(false);
    resolveWorkspace();
    return () => { cancelled = true; };
  // Only re-run when the token itself changes (not serverUrl/workspace to avoid loops)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token]);

  const getPlatform = () => platformOverride || '';

  const getContainerCacheDir = () => {
    if (containerRuntime !== 'apptainer' && containerRuntime !== 'singularity') return '';
    let baseWorkspace = workspaceDir;
    if (!baseWorkspace) {
      baseWorkspace = os === 'windows' ? '%USERPROFILE%\\.bioengine' : '$HOME/.bioengine';
    }
    const normalized = baseWorkspace.endsWith('/') || baseWorkspace.endsWith('\\')
      ? baseWorkspace.slice(0, -1) : baseWorkspace;
    return os === 'windows' ? `${normalized}\\images` : `${normalized}/images`;
  };

  const getUserFlag = () => {
    if (runAsRoot) return '';
    return os === 'windows' ? '' : '--user $(id -u):$(id -g) ';
  };

  const getGpuFlag = () => {
    if (gpus <= 0) return '';
    if (containerRuntime === 'podman') return '--device nvidia.com/gpu=all ';
    if (containerRuntime === 'apptainer' || containerRuntime === 'singularity') return '--nv ';
    return '--gpus=all ';
  };

  const getCommand = () => {
    let args: string[] = [];

    if (mode !== 'slurm') {
      args.push(`--mode ${mode}`);
    }

    if (mode === 'single-machine') {
      args.push(`--head-num-cpus ${cpus}`);
      if (gpus > 0) args.push(`--head-num-gpus ${gpus}`);
      if (memory > 0) args.push(`--head-memory-in-gb ${memory}`);
    } else if (mode === 'external-cluster' && rayAddress) {
      args.push(`--head-node-address ${rayAddress}`);
      if (clientServerPort && clientServerPort !== '10001') args.push(`--client-server-port ${clientServerPort}`);
      if (servePort && servePort !== '8000') args.push(`--serve-port ${servePort}`);
    }

    if (workspace) args.push(`--workspace "${workspace}"`);
    if (serverUrl) args.push(`--server-url ${serverUrl}`);
    if (token) args.push(`--token ${token}`);
    if (adminUsers) {
      if (adminUsers === '*') {
        args.push(`--admin-users "*"`);
      } else {
        args.push(`--admin-users ${adminUsers.split(',').map(u => u.trim()).join(' ')}`);
      }
    }
    if (workerName) args.push(`--worker-name "${workerName}"`);
    if (clientId) args.push(`--client-id ${clientId}`);
    if (customImage) args.push(`--image ${customImage}`);

    const argsString = args.length > 0 ? args.join(' ') : '';

    if (mode === 'slurm') {
      if (workspaceDir) args.push(`--workspace-dir ${workspaceDir}`);
      const nl = ' \\\n  ';
      const parts = [
        'bash <(curl -s https://raw.githubusercontent.com/aicell-lab/bioengine-worker/refs/heads/main/scripts/start_hpc_worker.sh)',
        ...args,
      ];
      return parts.join(nl);
    }

    const platform = getPlatform();
    const userFlag = getUserFlag();
    const gpuFlag = getGpuFlag();
    const shmFlag = (containerRuntime === 'apptainer' || containerRuntime === 'singularity') ? '' : `--shm-size=${shmSize} `;
    const platformFlag = platform && containerRuntime !== 'apptainer' && containerRuntime !== 'singularity' ? `--platform ${platform} ` : '';
    const imageToUse = customImage || DEFAULT_IMAGE;
    const gpuEnvFlag = (gpuIndices && gpus > 0 && containerRuntime !== 'apptainer' && containerRuntime !== 'singularity')
      ? `-e CUDA_VISIBLE_DEVICES=${gpuIndices} ` : '';

    // Linux/macOS: $HOME is safe inside -v flags (unlike ~ which doesn't expand in quoted strings)
    const hostPath = workspaceDir || '$HOME/.bioengine';

    const mounts: string[] = [];
    if (containerRuntime === 'apptainer' || containerRuntime === 'singularity') {
      mounts.push(`--bind ${hostPath}:/.bioengine`);
    } else if (os === 'windows') {
      const winPath = workspaceDir || '%USERPROFILE%\\.bioengine';
      mounts.push(`-v ${winPath}:/.bioengine`);
    } else {
      mounts.push(`-v ${hostPath}:/.bioengine`);
    }
    const volumeMounts = mounts.join(' ');

    let createDirCmd = '';
    if (os === 'windows') {
      const winPath = workspaceDir || '%USERPROFILE%\\.bioengine';
      createDirCmd = `cmd /c "mkdir "${winPath}" 2>nul || echo Directory already exists"`;
    } else {
      createDirCmd = `mkdir -p ${hostPath}`;
    }

    const nl = ' \\\n  ';
    let dockerCmd = '';
    if (containerRuntime === 'apptainer' || containerRuntime === 'singularity') {
      const cacheEnv = getContainerCacheDir() ? `${containerRuntime.toUpperCase()}_CACHEDIR=${getContainerCacheDir()} ` : '';
      const parts = [
        `${cacheEnv}${containerRuntime} exec`,
        ...(gpuFlag ? [gpuFlag.trim()] : []),
        volumeMounts,
        `docker://${imageToUse}`,
        'python -m bioengine.worker',
        ...args.map(a => a.trim()),
      ].filter(Boolean);
      dockerCmd = parts.join(nl);
    } else if (os === 'windows') {
      dockerCmd = `cmd /c "${containerRuntime} run ${gpuFlag}${platformFlag}--rm ${shmFlag}${gpuEnvFlag}${volumeMounts} ${imageToUse} python -m bioengine.worker ${argsString}"`;
    } else {
      const parts = [
        `${containerRuntime} run`,
        ...(gpuFlag ? [gpuFlag.trim()] : []),
        ...(platformFlag ? [platformFlag.trim()] : []),
        '--rm',
        ...(shmFlag ? [shmFlag.trim()] : []),
        ...(userFlag ? [userFlag.trim()] : []),
        ...(gpuEnvFlag ? [gpuEnvFlag.trim()] : []),
        volumeMounts,
        imageToUse,
        'python -m bioengine.worker',
        ...args.map(a => a.trim()),
      ].filter(Boolean);
      dockerCmd = parts.join(nl);
    }

    return { createDirCmd, dockerCmd };
  };

  const copyToClipboard = async () => {
    try {
      const command = getCommand();
      const containerName = containerRuntime.charAt(0).toUpperCase() + containerRuntime.slice(1);
      let textToCopy = '';
      if (typeof command === 'string') {
        textToCopy = command;
      } else {
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
    const isK8s = mode === 'external-cluster';
    const currentCommand = isK8s ? null : getCommand();
    const containerName = containerRuntime.charAt(0).toUpperCase() + containerRuntime.slice(1);

    let commandText = '';
    if (currentCommand) {
      if (typeof currentCommand === 'string') {
        commandText = currentCommand;
      } else {
        commandText = `# Step 1: Create directories\n${currentCommand.createDirCmd}\n\n# Step 2: Run ${containerName} container\n${currentCommand.dockerCmd}`;
      }
      // Redact token from command
      if (token) commandText = commandText.replace(token, '<my-token>');
    }

    let setupSection: string;
    if (isK8s) {
      const k8sLines = [
        `- **Ray Cluster Address**: ${rayAddress || '<not set>'}`,
        `- **Kubernetes Namespace**: ${k8sNamespace || 'bioengine'}`,
        `- **Ray Workspace Directory**: ${rayWorkspaceDir || '<not set>'}`,
        `- **PVC available**: ${hasPvc ? 'yes (bioengine-pvc)' : 'no'}`,
        workspace && `- **Hypha Workspace**: ${workspace}`,
        serverUrl && `- **Hypha Server URL**: ${serverUrl}`,
        adminUsers && `- **Admin Users**: ${adminUsers}`,
        customImage && `- **Custom Image**: ${customImage}`,
      ].filter(Boolean).join('\n');
      const yaml = getKubernetesWorkerYaml().replace(token, '<my-token>');
      setupSection = `### My Kubernetes Setup\n${k8sLines}\n\n### Deployment YAML\n\`\`\`yaml\n${yaml}\n\`\`\``;
    } else {
      const lines = [
        `- **Operating System**: ${os === 'macos' ? 'macOS' : os === 'linux' ? 'Linux' : 'Windows'}`,
        `- **Container Runtime**: ${containerName}`,
        `- **Mode**: ${mode === 'single-machine' ? 'Single Machine (local)' : 'SLURM (HPC cluster)'}`,
        mode === 'single-machine' && `- **CPUs**: ${cpus}`,
        mode === 'single-machine' && `- **GPUs**: ${gpus}${gpus > 0 && gpuIndices ? ` (indices: ${gpuIndices})` : ''}`,
        mode === 'single-machine' && `- **Memory**: ${memory > 0 ? `${memory} GB` : 'auto-detect'}`,
        workspace && `- **Hypha Workspace**: ${workspace}`,
        serverUrl && `- **Hypha Server URL**: ${serverUrl}`,
        adminUsers && `- **Admin Users**: ${adminUsers}`,
        workspaceDir && `- **BioEngine Workspace Directory**: ${workspaceDir}`,
        customImage && `- **Custom Image**: ${customImage}`,
      ].filter(Boolean).join('\n');
      setupSection = `### My Setup\n${lines}\n\n### Generated Command\n\`\`\`bash\n${commandText}\n\`\`\``;
    }

    return `# BioEngine Worker Troubleshooting

I'm trying to set up a **BioEngine Worker**. BioEngine is part of the AI4Life project and provides cloud-powered AI tools for bioimage analysis.

The source code and documentation are available at: https://github.com/aicell-lab/bioengine-worker
${isK8s ? `Deployment is on **Kubernetes** using KubeRay (external-cluster mode). The worker connects to an existing Ray cluster and registers itself as a Hypha service.` : `Deployment mode: **${mode === 'single-machine' ? 'Single Machine' : 'SLURM HPC cluster'}**.`}
${setupSection}

## My Issue

[Paste your error message or describe your problem here]`;
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

  const getK8sSecretCommand = () => {
    const ns = k8sNamespace || 'bioengine';
    const tokenValue = token || '<your-admin-token>';
    return `kubectl create secret generic bioengine-secrets \\\n  --from-literal=HYPHA_TOKEN=${tokenValue} \\\n  --dry-run=client -o yaml \\\n  | kubectl apply -f - -n ${ns}`;
  };

  const getK8sApplyCommand = () => {
    const ns = k8sNamespace || 'bioengine';
    return `kubectl apply -f bioengine-deployment.yaml -n ${ns}`;
  };

  const getKubernetesWorkerYaml = () => {
    const serverUrlVal = serverUrl || 'https://hypha.aicell.io';
    const workspaceVal = workspace || '<your-hypha-workspace>';
    const rayAddr = rayAddress || 'ray://raycluster-kuberay-head-svc.ray-cluster.svc.cluster.local';
    const ns = k8sNamespace || 'bioengine';

    const arg = (flag: string, value: string) => `\n        - "${flag}"\n        - "${value}"`;

    let extraArgs = '';
    if (workspaceDir) extraArgs += arg('--workspace-dir', workspaceDir);
    if (rayWorkspaceDir) extraArgs += arg('--ray-workspace-dir', rayWorkspaceDir);
    if (clientServerPort && clientServerPort !== '10001') extraArgs += arg('--client-server-port', clientServerPort);

    if (adminUsers) {
      if (adminUsers === '*') {
        extraArgs += arg('--admin-users', '*');
      } else {
        adminUsers.split(',').map(u => u.trim()).filter(Boolean).forEach(u => {
          extraArgs += arg('--admin-users', u);
        });
      }
    }
    if (workerName) extraArgs += arg('--worker-name', workerName);

    return `apiVersion: apps/v1
kind: Deployment
metadata:
  name: bioengine-worker
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
      securityContext:
        runAsNonRoot: true
        runAsUser: 65534
        runAsGroup: 65534
        seccompProfile:
          type: RuntimeDefault
      containers:
      - name: bioengine-worker
        image: ${customImage || DEFAULT_IMAGE}
        securityContext:
          allowPrivilegeEscalation: false
          capabilities:
            drop:
            - ALL
        args:
        - "python"
        - "-m"
        - "bioengine.worker"
        - "--mode"
        - "external-cluster"
        - "--head-node-address"
        - "${rayAddr}"
        - "--server-url"
        - "${serverUrlVal}"
        - "--workspace"
        - "${workspaceVal}"
        - "--token"
        - "$(HYPHA_TOKEN)"
        - "--client-id"
        - "$(BIOENGINE_CLIENT_ID)"${extraArgs}
        env:
        - name: HYPHA_TOKEN
          valueFrom:
            secretKeyRef:
              name: bioengine-secrets
              key: HYPHA_TOKEN
        - name: POD_NAME
          valueFrom:
            fieldRef:
              fieldPath: metadata.name
        - name: BIOENGINE_CLIENT_ID
          valueFrom:
            fieldRef:
              fieldPath: metadata.name
        startupProbe:
          exec:
            command:
            - /bin/sh
            - -c
            - 'curl -sf "${serverUrlVal}/${workspaceVal}/services/$POD_NAME:bioengine-worker/get_status"
              | grep -E "\"is_ready\":\\s*true"'
          initialDelaySeconds: 60
          periodSeconds: 20
          timeoutSeconds: 10
          failureThreshold: 18
        livenessProbe:
          exec:
            command:
            - /bin/sh
            - -c
            - 'curl -sf "${serverUrlVal}/${workspaceVal}/services/$POD_NAME:bioengine-worker/get_status"
              | grep -E "\"is_ready\":\\s*true"'
          initialDelaySeconds: 10
          periodSeconds: 30
          timeoutSeconds: 10
          failureThreshold: 2${hasPvc ? `
        volumeMounts:
        - name: bioengine
          mountPath: /home/bioengine
      volumes:
      - name: bioengine
        persistentVolumeClaim:
          claimName: bioengine-pvc` : ''}`;
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
            <h4 className={`font-semibold transition-all duration-200 ${isExpanded ? 'text-sm text-gray-700' : 'text-lg text-gray-800'}`}>
              Launch Your Own BioEngine Instance
            </h4>
            <p className={`text-gray-500 transition-all duration-200 ${isExpanded ? 'text-xs' : 'text-sm font-medium'}`}>
              Deployment configurator
            </p>
          </div>
        </div>
        <div className="flex items-center">
          <span className={`text-gray-500 mr-3 transition-all duration-200 ${isExpanded ? 'text-xs' : 'text-sm font-medium'}`}>{isExpanded ? 'Hide' : 'Show'}</span>
          <svg className={`text-gray-400 transition-all duration-200 ${isExpanded ? 'w-4 h-4 rotate-180' : 'w-5 h-5'}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
          </svg>
        </div>
      </button>

      {isExpanded && (
        <div className="mt-4 space-y-6">

          {/* ── Mode selection ── */}
          <div className="bg-gradient-to-r from-blue-50 to-purple-50 p-6 rounded-xl border border-blue-200">
            <h4 className="text-lg font-semibold text-gray-800 mb-4 flex items-center">
              <svg className="w-5 h-5 mr-2 text-blue-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10" />
              </svg>
              Where do you want to run BioEngine?
            </h4>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              {[
                { value: 'single-machine', label: '💻 Desktop/Workstation', desc: 'Run locally on your computer or workstation using Docker. Perfect for development or small-scale analysis.', badge: 'Easy Setup', color: 'blue', disabled: false },
                { value: 'slurm', label: '🖥️ HPC Cluster', desc: 'Deploy on a high-performance computing cluster with SLURM job scheduler. Ideal for large-scale workloads.', badge: 'SLURM', color: 'purple', disabled: false },
                { value: 'external-cluster', label: '☸️ Kubernetes Cluster', desc: 'Deploy on Kubernetes with KubeRay. Connect BioEngine to an existing Ray cluster for cloud-native deployment.', badge: 'Cloud Native', color: 'orange', disabled: false },
              ].map(({ value, label, desc, badge, color, disabled }) => (
                <div
                  key={value}
                  className={`p-4 rounded-lg border-2 transition-all duration-200 ${disabled
                      ? 'cursor-not-allowed opacity-50 border-gray-200 bg-gray-50'
                      : mode === value
                        ? `cursor-pointer border-${color}-500 bg-${color}-50 shadow-md`
                        : `cursor-pointer border-gray-200 bg-white hover:border-${color}-300 hover:shadow-sm`
                    }`}
                  onClick={() => !disabled && setMode(value as ModeType)}
                >
                  <div className="flex items-center mb-2">
                    <input type="radio" name="deployment-mode" value={value} checked={mode === value}
                      disabled={disabled}
                      onChange={(e) => !disabled && setMode(e.target.value as ModeType)}
                      className={`w-4 h-4 text-${color}-600`} />
                    <span className="ml-2 font-medium text-gray-800">{label}</span>
                  </div>
                  <p className="text-sm text-gray-600 ml-6">{desc}</p>
                  <div className="mt-2 ml-6">
                    <span className={`inline-block px-2 py-1 text-xs bg-${color}-100 text-${color}-700 rounded`}>{badge}</span>
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* ── Kubernetes setup ── */}
          {mode === 'external-cluster' && (
            <div className="space-y-4">

              {/* Intro */}
              <div className="p-4 bg-orange-50 rounded-xl border border-orange-200">
                <p className="text-sm font-semibold text-orange-800 mb-1">Starting from an existing Ray cluster</p>
                <p className="text-sm text-orange-700">
                  This mode connects the BioEngine worker to a Ray cluster already running on Kubernetes.
                  If you don't have one yet, follow the{' '}
                  <a
                    href="https://docs.ray.io/en/latest/cluster/kubernetes/getting-started/raycluster-quick-start.html"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="underline font-medium hover:text-orange-900"
                  >
                    KubeRay Quick Start Guide
                  </a>.
                </p>
              </div>

              {/* Note 1: Ray workspace directory */}
              <div className="p-4 bg-blue-50 rounded-xl border border-blue-200">
                <div className="flex items-start justify-between">
                  <div className="flex items-start flex-1 mr-3">
                    <svg className="w-4 h-4 text-blue-500 mr-2 mt-0.5 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                    </svg>
                    <div className="text-sm text-blue-800">
                      <p className="font-medium">Recommended: mount a shared PVC on your Ray cluster nodes</p>
                      <p className="text-blue-700 text-xs mt-1">
                        BioEngine apps run on Ray nodes and write to the Ray Workspace Directory. For apps that communicate through the filesystem (e.g. <code className="bg-blue-100 px-1 rounded">bioimage-io/model-runner</code>), scaling to multiple replicas requires a shared volume across all Ray nodes — otherwise only reduced functionality is available.
                      </p>
                    </div>
                  </div>
                  <button
                    onClick={() => setShowRayWorkspaceDirDialog(true)}
                    className="flex-shrink-0 px-2 py-1 text-xs text-blue-600 border border-blue-300 rounded-lg hover:bg-blue-100 transition-colors"
                  >
                    Learn more
                  </button>
                </div>
              </div>

              {/* Note 2: PVC for BioEngine workspace dir */}
              <div className="p-4 bg-blue-50 rounded-xl border border-blue-200">
                <div className="flex items-start">
                  <svg className="w-4 h-4 text-blue-500 mr-2 mt-0.5 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                  </svg>
                  <p className="text-sm text-blue-800">
                    <span className="font-medium">Recommended: mount a PVC at the BioEngine Workspace Directory</span>
                    <span className="text-blue-700"> — worker logs will otherwise be lost when the pod restarts.</span>
                  </p>
                </div>
              </div>

              {/* Standard configuration fields */}
              <div className="p-4 bg-gray-50 rounded-xl border border-gray-200">
                <h5 className="text-sm font-semibold text-gray-700 mb-3">Configuration</h5>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div className="md:col-span-2">
                    <label className="block text-sm font-medium text-gray-700 mb-1">Ray Cluster Address</label>
                    <input
                      type="text"
                      value={rayAddress}
                      onChange={(e) => setRayAddress(e.target.value)}
                      placeholder="ray://raycluster-kuberay-head-svc.ray-cluster.svc.cluster.local"
                      className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                    />
                    <p className="text-xs text-gray-500 mt-1">
                      Internal Kubernetes service address of the Ray head node. Use <code className="bg-gray-100 px-1 rounded">kubectl get svc -n &lt;ray-namespace&gt;</code> to find the service name.
                    </p>
                  </div>

                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">Ray Workspace Directory</label>
                    <input
                      type="text"
                      value={rayWorkspaceDir}
                      onChange={(e) => setRayWorkspaceDir(e.target.value)}
                      placeholder="/home/bioengine"
                      className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                    />
                    <p className="text-xs text-gray-500 mt-1">Writable path on Ray cluster nodes. Mount a shared ReadWriteMany PVC here for full app functionality.</p>
                  </div>

                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">Kubernetes Namespace</label>
                    <input
                      type="text"
                      value={k8sNamespace}
                      onChange={(e) => setK8sNamespace(e.target.value)}
                      placeholder="bioengine"
                      className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                    />
                    <p className="text-xs text-gray-500 mt-1">Namespace to deploy the BioEngine worker pod into</p>
                  </div>

                  <div className="md:col-span-2">
                    <label className="flex items-center gap-2 cursor-pointer select-none">
                      <input
                        type="checkbox"
                        checked={hasPvc}
                        onChange={(e) => setHasPvc(e.target.checked)}
                        className="w-4 h-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                      />
                      <span className="text-sm font-medium text-gray-700">I have a PVC named <code className="bg-gray-100 px-1 rounded">bioengine-pvc</code> available in this namespace</span>
                    </label>
                    <p className="text-xs text-gray-500 mt-1">Mounts the PVC into the <strong>BioEngine worker pod</strong> at <code className="bg-gray-100 px-1 rounded">/home/bioengine</code> to persist worker logs. This is separate from the Ray cluster PVC.</p>
                  </div>
                </div>
              </div>

              {/* Auth warning */}
              {!token && (
                <div className="p-4 bg-amber-50 rounded-xl border border-amber-200">
                  <div className="flex items-start">
                    <svg className="w-5 h-5 text-amber-600 mr-2 mt-0.5 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-2.5L13.732 4c-.77-.833-1.964-.833-2.732 0L4.082 16.5c-.77.833.192 2.5 1.732 2.5z" />
                    </svg>
                    <div className="text-sm text-amber-800">
                      <p className="font-medium mb-1">🔐 Important: Authentication Required</p>
                      <div className="text-amber-700 space-y-1">
                        {isLoggedIn ? (
                          <p>Generating your authentication token… or set one manually in <strong>Advanced Options → Authentication Token</strong>.</p>
                        ) : (
                          <>
                            <p>An authentication token is required. Either:</p>
                            <ol className="list-decimal list-inside space-y-1 ml-2 text-xs">
                              <li><strong>Log in</strong> to auto-generate a 30-day admin token, or</li>
                              <li>Set a token manually in <strong>Advanced Options → Authentication Token</strong></li>
                            </ol>
                            <p className="text-xs italic mt-1">Manually provided tokens must have <strong>Permission Level: Admin</strong>.</p>
                          </>
                        )}
                      </div>
                    </div>
                  </div>
                </div>
              )}

              {/* Advanced options */}
              <div className="border-t border-gray-200 pt-4">
                <button
                  onClick={() => setShowAdvanced(!showAdvanced)}
                  className="flex items-center text-sm text-gray-600 hover:text-gray-800 transition-colors"
                >
                  <svg className={`w-4 h-4 mr-2 transition-transform ${showAdvanced ? 'rotate-90' : ''}`}
                    fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                  </svg>
                  Advanced Options
                </button>

                {showAdvanced && (
                  <div className="mt-4 grid grid-cols-1 md:grid-cols-2 gap-4 p-4 bg-gray-50 rounded-lg">
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">Admin Users</label>
                      <input type="text" value={adminUsers} onChange={(e) => setAdminUsers(e.target.value)}
                        placeholder="user1@example.com,user2@example.com or *"
                        className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500" />
                      <p className="text-xs text-gray-500 mt-1">Users who can manage the worker (comma-separated, * for all)</p>
                    </div>

                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">Worker Name</label>
                      <input type="text" value={workerName} onChange={(e) => setWorkerName(e.target.value)}
                        placeholder="BioEngine Worker"
                        className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500" />
                      <p className="text-xs text-gray-500 mt-1">Display name for this worker in the Hypha service registry</p>
                    </div>

                    <div className="md:col-span-2">
                      <div className="flex items-center justify-between mb-1">
                        <label className="block text-sm font-medium text-gray-700">Authentication Token</label>
                        {isLoggedIn && (
                          <button
                            type="button"
                            onClick={() => { setTokenIsManual(false); generateToken(); }}
                            disabled={isGeneratingToken}
                            className="flex items-center px-2 py-1 text-xs text-blue-600 bg-blue-50 border border-blue-200 rounded hover:bg-blue-100 disabled:opacity-50 transition-colors"
                          >
                            {isGeneratingToken ? (
                              <div className="w-3 h-3 border border-blue-600 border-t-transparent rounded-full animate-spin mr-1" />
                            ) : (
                              <svg className="w-3 h-3 mr-1" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                              </svg>
                            )}
                            Regenerate (30 days)
                          </button>
                        )}
                      </div>
                      <input
                        type="password"
                        value={token}
                        onChange={(e) => { setToken(e.target.value); setTokenIsManual(true); }}
                        placeholder={isLoggedIn ? (isGeneratingToken ? 'Generating…' : 'Auto-generated — paste to override') : 'Paste your Hypha token'}
                        autoComplete="new-password"
                        className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                      />
                      {tokenError && <p className="text-xs text-red-600 mt-1">{tokenError}</p>}
                      {isLoggedIn && !tokenIsManual && token && (
                        <p className="text-xs text-green-600 mt-1">Auto-generated 30-day admin token — regenerate when it expires using the button above.</p>
                      )}
                      <p className="text-xs text-gray-500 mt-1">Used to resolve workspace and populate the deployment YAML. Store in a Kubernetes secret for production.</p>
                    </div>

                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">Server URL</label>
                      <input type="text" value={serverUrl} onChange={(e) => setServerUrl(e.target.value)}
                        placeholder="https://hypha.aicell.io"
                        className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500" />
                      <p className="text-xs text-gray-500 mt-1">Hypha server URL (defaults to public server)</p>
                    </div>

                    <div>
                      <div className="flex items-center justify-between mb-1">
                        <label className="block text-sm font-medium text-gray-700">Hypha Workspace</label>
                        {workspaceResolved && workspace && (
                          <span className="flex items-center text-xs text-green-600">
                            <svg className="w-3 h-3 mr-1" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                            </svg>
                            Resolved from token
                          </span>
                        )}
                      </div>
                      <input type="text" value={workspace} onChange={(e) => { setWorkspace(e.target.value); setWorkspaceResolved(false); }}
                        placeholder="my-workspace" autoComplete="off"
                        className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500" />
                      <p className="text-xs text-gray-500 mt-1">Hypha workspace for service registration (resolved from token if not set)</p>
                    </div>

                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">Container Image</label>
                      <input type="text" value={customImage} onChange={(e) => setCustomImage(e.target.value)}
                        placeholder={DEFAULT_IMAGE}
                        className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500" />
                      <p className="text-xs text-gray-500 mt-1">Custom image. Leave empty for default ({DEFAULT_IMAGE})</p>
                    </div>

                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">Ray Client Server Port</label>
                      <input type="number" value={clientServerPort} onChange={(e) => setClientServerPort(e.target.value)}
                        placeholder="10001"
                        className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500" />
                      <p className="text-xs text-gray-500 mt-1">Port exposed by the Ray head service</p>
                    </div>
                  </div>
                )}
              </div>

              {/* Commands */}
              <div className="space-y-4 border-t border-gray-200 pt-4">
                <h5 className="text-sm font-semibold text-gray-700">Deploy to Kubernetes</h5>

                {/* Step 1: Create secret */}
                <div>
                  <div className="flex items-center justify-between mb-1">
                    <p className="text-sm text-gray-700 font-medium">1. Create Kubernetes secret</p>
                    <button
                      onClick={async () => {
                        try { await navigator.clipboard.writeText(getK8sSecretCommand()); setK8sSecretCopied(true); setTimeout(() => setK8sSecretCopied(false), 2000); } catch (_) {}
                      }}
                      className="flex items-center px-2 py-1 text-xs text-gray-600 bg-gray-100 border border-gray-200 rounded hover:bg-gray-200 transition-colors"
                    >
                      {k8sSecretCopied ? (
                        <><svg className="w-3 h-3 mr-1" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" /></svg>Copied!</>
                      ) : (
                        <><svg className="w-3 h-3 mr-1" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" /></svg>Copy</>
                      )}
                    </button>
                  </div>
                  <div className="bg-gray-900 rounded-lg p-3 overflow-x-auto">
                    <pre className="text-green-400 text-xs font-mono whitespace-pre">{getK8sSecretCommand()}</pre>
                  </div>
                  <p className="text-xs text-gray-500 mt-1">
                    Creates or updates the secret. To list secrets: <code className="bg-gray-100 px-1 rounded">kubectl get secrets -n {k8sNamespace || 'bioengine'}</code>. To delete: <code className="bg-gray-100 px-1 rounded">kubectl delete secret bioengine-secrets -n {k8sNamespace || 'bioengine'}</code>.
                  </p>
                </div>

                {/* Step 2: deployment YAML */}
                <div>
                  <div className="flex items-center justify-between mb-1">
                    <p className="text-sm text-gray-700 font-medium">2. Save as <code className="bg-gray-100 px-1 rounded text-xs">bioengine-deployment.yaml</code></p>
                    <button
                      onClick={async () => {
                        try { await navigator.clipboard.writeText(getKubernetesWorkerYaml()); setK8sYamlCopied(true); setTimeout(() => setK8sYamlCopied(false), 2000); } catch (_) {}
                      }}
                      className="flex items-center px-2 py-1 text-xs text-gray-600 bg-gray-100 border border-gray-200 rounded hover:bg-gray-200 transition-colors"
                    >
                      {k8sYamlCopied ? (
                        <><svg className="w-3 h-3 mr-1" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" /></svg>Copied!</>
                      ) : (
                        <><svg className="w-3 h-3 mr-1" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" /></svg>Copy YAML</>
                      )}
                    </button>
                  </div>
                  <div className="bg-gray-900 rounded-lg p-3">
                    <pre className="text-green-400 text-xs font-mono overflow-x-auto max-h-72 overflow-y-auto whitespace-pre">{getKubernetesWorkerYaml()}</pre>
                  </div>
                </div>

                {/* Step 3: apply */}
                <div>
                  <div className="flex items-center justify-between mb-1">
                    <p className="text-sm text-gray-700 font-medium">3. Apply the deployment</p>
                    <button
                      onClick={async () => {
                        try { await navigator.clipboard.writeText(getK8sApplyCommand()); setK8sApplyCopied(true); setTimeout(() => setK8sApplyCopied(false), 2000); } catch (_) {}
                      }}
                      className="flex items-center px-2 py-1 text-xs text-gray-600 bg-gray-100 border border-gray-200 rounded hover:bg-gray-200 transition-colors"
                    >
                      {k8sApplyCopied ? (
                        <><svg className="w-3 h-3 mr-1" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" /></svg>Copied!</>
                      ) : (
                        <><svg className="w-3 h-3 mr-1" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" /></svg>Copy</>
                      )}
                    </button>
                  </div>
                  <div className="bg-gray-900 rounded-lg p-3">
                    <pre className="text-green-400 text-xs font-mono whitespace-pre">{getK8sApplyCommand()}</pre>
                  </div>
                  <p className="text-xs text-gray-500 mt-1">
                    List deployments and status: <code className="bg-gray-100 px-1 rounded">kubectl get deployments -n {k8sNamespace || 'bioengine'}</code>. Check pod logs: <code className="bg-gray-100 px-1 rounded">kubectl logs -l app=bioengine-worker -n {k8sNamespace || 'bioengine'}</code>. Delete deployment: <code className="bg-gray-100 px-1 rounded">kubectl delete deployment bioengine-worker -n {k8sNamespace || 'bioengine'}</code>.
                  </p>
                </div>
              </div>

              {/* K8s troubleshooting */}
              <div className="flex justify-center pt-2 border-t border-gray-200">
                <button onClick={() => setShowTroubleshooting(true)}
                  className="flex items-center px-4 py-2 text-sm text-orange-600 bg-orange-50 border border-orange-200 rounded-lg hover:bg-orange-100 transition-colors">
                  <svg className="w-4 h-4 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8.228 9c.549-1.165 2.03-2 3.772-2 2.21 0 4 1.343 4 3 0 1.4-1.278 2.575-3.006 2.907-.542.104-.994.54-.994 1.093m0 3h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                  </svg>
                  Need Help? Get AI Troubleshooting Prompt
                </button>
              </div>
            </div>
          )}

          {/* ── Single-machine and SLURM settings ── */}
          {mode !== 'external-cluster' && (
            <div className="space-y-4">

              {/* Container runtime requirement */}
              {mode === 'single-machine' && (
                <div className="p-4 bg-orange-50 rounded-xl border border-orange-200">
                  <p className="text-sm font-semibold text-orange-800 mb-1">Container runtime required</p>
                  <p className="text-sm text-orange-700">
                    BioEngine runs inside a container. Install one of the supported runtimes: <strong>Docker</strong> (most common), <strong>Podman</strong> (rootless alternative), <strong>Apptainer</strong> (HPC, Singularity successor), or <strong>Singularity</strong>. The latest image is ~1.1 GB and will be pulled automatically on first run.
                  </p>
                  {gpus > 0 && (
                    <p className="text-sm text-orange-700 mt-2">
                      <strong>GPU support</strong> requires the <strong>NVIDIA Container Toolkit</strong> to be installed on the host. See the <a href="https://docs.nvidia.com/datacenter/cloud-native/container-toolkit/latest/install-guide.html" target="_blank" rel="noopener noreferrer" className="underline hover:text-orange-900">installation guide</a>.
                    </p>
                  )}
                </div>
              )}

              {/* Workspace directory info */}
              {mode === 'single-machine' && (
                <div className="p-4 bg-blue-50 rounded-xl border border-blue-200">
                  <div className="flex items-start">
                    <svg className="w-4 h-4 text-blue-500 mr-2 mt-0.5 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                    </svg>
                    <p className="text-sm text-blue-800">
                      <span className="font-medium">BioEngine Workspace Directory: </span>
                      <code className="bg-blue-100 px-1 rounded">{workspaceDir || (os === 'windows' ? '%USERPROFILE%\\.bioengine' : '$HOME/.bioengine')}</code>
                      <span className="text-blue-700 text-xs block mt-1">This directory is created on the host and mounted into the container. It stores apps, logs, and temporary files. Change it in Advanced Options below.</span>
                    </p>
                  </div>
                </div>
              )}

              {/* Authentication Required warning when no token */}
              {!token && (
                <div className="p-4 bg-amber-50 rounded-xl border border-amber-200">
                  <div className="flex items-start">
                    <svg className="w-5 h-5 text-amber-600 mr-2 mt-0.5 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-2.5L13.732 4c-.77-.833-1.964-.833-2.732 0L4.082 16.5c-.77.833.192 2.5 1.732 2.5z" />
                    </svg>
                    <div className="text-sm text-amber-800">
                      <p className="font-medium mb-1">🔐 Important: Authentication Required</p>
                      <div className="text-amber-700 space-y-1">
                        {isLoggedIn ? (
                          <p>Generating your authentication token… or set one manually in <strong>Advanced Options → Authentication Token</strong>.</p>
                        ) : (
                          <>
                            <p>An authentication token is required. Either:</p>
                            <ol className="list-decimal list-inside space-y-1 ml-2 text-xs">
                              <li><strong>Log in</strong> to auto-generate a 30-day admin token, or</li>
                              <li>Set a token manually in <strong>Advanced Options → Authentication Token</strong></li>
                            </ol>
                            <p className="text-xs italic mt-1">Manually provided tokens must have <strong>Permission Level: Admin</strong>.</p>
                          </>
                        )}
                      </div>
                    </div>
                  </div>
                </div>
              )}

              {/* SLURM info */}
              {mode === 'slurm' && (
                <div className="p-4 bg-purple-50 rounded-xl border border-purple-200">
                  <div className="flex items-start">
                    <svg className="w-5 h-5 text-purple-600 mr-2 mt-0.5 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                    </svg>
                    <div className="text-sm text-purple-800">
                      <p className="font-semibold mb-1">HPC Cluster Setup</p>
                      <p className="text-purple-700">The startup script runs BioEngine via SLURM and may require manual adjustments for your cluster environment. Please report issues and feedback on <a href="https://github.com/aicell-lab/bioengine-worker/issues" target="_blank" rel="noopener noreferrer" className="underline font-medium hover:text-purple-900">GitHub</a>.</p>
                    </div>
                  </div>
                </div>
              )}

              {/* Runtime / compute settings */}
              {mode === 'single-machine' && (
                <div className="p-4 bg-gray-50 rounded-xl border border-gray-200">
                  <h5 className="text-sm font-semibold text-gray-700 mb-3">Container & Compute</h5>
                  <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">Operating System</label>
                      <select value={os} onChange={(e) => setOS(e.target.value as OSType)}
                        className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500">
                        <option value="macos">macOS</option>
                        <option value="linux">Linux</option>
                        <option value="windows">Windows</option>
                      </select>
                    </div>

                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">Container Runtime</label>
                      <select value={containerRuntime} onChange={(e) => setContainerRuntime(e.target.value as ContainerRuntimeType)}
                        className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500">
                        <option value="docker">Docker</option>
                        <option value="podman">Podman</option>
                        <option value="apptainer">Apptainer</option>
                        <option value="singularity">Singularity</option>
                      </select>
                      <p className="text-xs text-gray-500 mt-1">
                        {containerRuntime === 'docker' ? 'Most common runtime'
                          : containerRuntime === 'podman' ? 'Rootless Docker alternative'
                          : containerRuntime === 'apptainer' ? 'HPC runtime (Singularity successor)'
                          : 'Original HPC runtime'}
                      </p>
                    </div>

                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">Shared Memory Size</label>
                      <select value={shmSize} onChange={(e) => setShmSize(e.target.value)}
                        className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500">
                        {['1g','2g','4g','6g','8g','10g','12g','16g'].map(v => (
                          <option key={v} value={v}>{v.replace('g', ' GB')}</option>
                        ))}
                      </select>
                      <p className="text-xs text-gray-500 mt-1">Increase for large models{(containerRuntime === 'apptainer' || containerRuntime === 'singularity') ? ' (uses system shm)' : ''}</p>
                    </div>

                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">CPU Cores</label>
                      <input type="number" min="1" max="64" value={cpus}
                        onChange={(e) => setCpus(parseInt(e.target.value) || 1)}
                        className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500" />
                      <p className="text-xs text-gray-500 mt-1">CPUs allocated to Ray head node</p>
                    </div>

                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">GPUs</label>
                      <input type="number" min="0" max="16" value={gpus}
                        onChange={(e) => setGpus(parseInt(e.target.value) || 0)}
                        className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500" />
                      <p className="text-xs text-gray-500 mt-1">
                        {gpus > 0 ? `Requires NVIDIA ${containerRuntime === 'docker' ? 'Docker runtime' : containerRuntime === 'podman' ? 'container toolkit' : `drivers (--nv flag)`}` : 'Set to 0 for CPU-only mode'}
                      </p>
                    </div>

                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">Memory (GB)</label>
                      <input type="number" min="0" max="512" value={memory}
                        onChange={(e) => setMemory(parseInt(e.target.value) || 0)}
                        className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500" />
                      <p className="text-xs text-gray-500 mt-1">RAM for Ray head node in GB (0 = auto-detect)</p>
                    </div>
                  </div>
                </div>
              )}
            </div>
          )}

          {/* ── Advanced options ── */}
          {mode !== 'external-cluster' && (
            <div className="border-t border-gray-200 pt-4">
              <button
                onClick={() => setShowAdvanced(!showAdvanced)}
                className="flex items-center text-sm text-gray-600 hover:text-gray-800 transition-colors"
              >
                <svg className={`w-4 h-4 mr-2 transition-transform ${showAdvanced ? 'rotate-90' : ''}`}
                  fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                </svg>
                Advanced Options
              </button>

              {showAdvanced && (
                <div className="mt-4 grid grid-cols-1 md:grid-cols-2 gap-4 p-4 bg-gray-50 rounded-lg">

                  {/* ── Worker identity ── */}
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">Admin Users</label>
                    <input type="text" value={adminUsers} onChange={(e) => setAdminUsers(e.target.value)}
                      placeholder="user1@example.com,user2@example.com or *"
                      className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500" />
                    <p className="text-xs text-gray-500 mt-1">Users who can manage the worker. Leave empty to use the logged-in user</p>
                  </div>

                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">Worker Name</label>
                    <input type="text" value={workerName} onChange={(e) => setWorkerName(e.target.value)}
                      placeholder="BioEngine Worker"
                      className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500" />
                    <p className="text-xs text-gray-500 mt-1">Display name for this worker in the Hypha service registry</p>
                  </div>

                  {/* ── BioEngine data directory ── */}
                  <div className="md:col-span-2">
                    <label className="block text-sm font-medium text-gray-700 mb-1">BioEngine Workspace Directory</label>
                    <input type="text" value={workspaceDir}
                      onChange={(e) => setWorkspaceDir(e.target.value)}
                      placeholder={os === 'windows' ? '%USERPROFILE%\\.bioengine' : '$HOME/.bioengine'}
                      className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500" />
                    <p className="text-xs text-gray-500 mt-1">
                      Directory for BioEngine apps, logs and ray cluster temporary files. Defaults to {os === 'windows' ? '%USERPROFILE%\\.bioengine' : '$HOME/.bioengine'}.
                    </p>
                  </div>

                  {/* ── Hypha connection ── */}
                  <div className="md:col-span-2">
                    <div className="flex items-center justify-between mb-1">
                      <label className="block text-sm font-medium text-gray-700">
                        Authentication Token
                      </label>
                      {isLoggedIn && (
                        <button
                          type="button"
                          onClick={() => { setTokenIsManual(false); generateToken(); }}
                          disabled={isGeneratingToken}
                          className="flex items-center px-2 py-1 text-xs text-blue-600 bg-blue-50 border border-blue-200 rounded hover:bg-blue-100 disabled:opacity-50 transition-colors"
                        >
                          {isGeneratingToken ? (
                            <div className="w-3 h-3 border border-blue-600 border-t-transparent rounded-full animate-spin mr-1" />
                          ) : (
                            <svg className="w-3 h-3 mr-1" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                            </svg>
                          )}
                          Regenerate (30 days)
                        </button>
                      )}
                    </div>
                    <input
                      type="password"
                      value={token}
                      onChange={(e) => { setToken(e.target.value); setTokenIsManual(true); }}
                      placeholder={isLoggedIn ? (isGeneratingToken ? 'Generating…' : 'Auto-generated — paste to override') : 'Paste your Hypha token'}
                      autoComplete="new-password"
                      className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                    />
                    {tokenError && <p className="text-xs text-red-600 mt-1">{tokenError}</p>}
                    {isLoggedIn && !tokenIsManual && token && (
                      <p className="text-xs text-green-600 mt-1">Auto-generated 30-day admin token — regenerate when it expires using the button above.</p>
                    )}
                    <p className="text-xs text-gray-500 mt-1">
                      Required. Manually provided tokens must have <strong>Permission Level: Admin</strong>.
                    </p>
                  </div>

                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">Server URL</label>
                    <input type="text" value={serverUrl} onChange={(e) => setServerUrl(e.target.value)}
                      placeholder="https://hypha.aicell.io"
                      className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500" />
                    <p className="text-xs text-gray-500 mt-1">Hypha server URL (defaults to public server)</p>
                  </div>

                  <div>
                    <div className="flex items-center justify-between mb-1">
                      <label className="block text-sm font-medium text-gray-700">Hypha Workspace</label>
                      {workspaceResolved && workspace && (
                        <span className="flex items-center text-xs text-green-600">
                          <svg className="w-3 h-3 mr-1" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                          </svg>
                          Resolved from token
                        </span>
                      )}
                    </div>
                    <input type="text" value={workspace} onChange={(e) => { setWorkspace(e.target.value); setWorkspaceResolved(false); }}
                      placeholder="my-workspace" autoComplete="off"
                      className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500" />
                    <p className="text-xs text-gray-500 mt-1">Hypha workspace name for service registration (uses token's workspace if not set)</p>
                  </div>

                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">Client ID</label>
                    <input type="text" value={clientId} onChange={(e) => setClientId(e.target.value)}
                      className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500" />
                    <p className="text-xs text-gray-500 mt-1">Custom client ID (auto-generated if empty)</p>
                  </div>

                  {/* ── GPU indices ── */}
                  {mode === 'single-machine' && gpus > 0 && (
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">GPU Indices</label>
                      <input type="text" value={gpuIndices} onChange={(e) => setGpuIndices(e.target.value)}
                        className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500" />
                      <p className="text-xs text-gray-500 mt-1">CUDA_VISIBLE_DEVICES — comma-separated GPU indices (e.g. 0,1). Leave empty to use all GPUs</p>
                    </div>
                  )}

                  {/* ── Container / runtime ── */}
                  {mode === 'single-machine' && (
                    <>
                      <div>
                        <label className="block text-sm font-medium text-gray-700 mb-1">Container Image</label>
                        <input type="text" value={customImage} onChange={(e) => setCustomImage(e.target.value)}
                          placeholder={DEFAULT_IMAGE}
                          className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500" />
                        <p className="text-xs text-gray-500 mt-1">Custom image. Leave empty for default ({DEFAULT_IMAGE})</p>
                      </div>

                      <div>
                        <label className="block text-sm font-medium text-gray-700 mb-1">Platform Override</label>
                        <select value={platformOverride} onChange={(e) => setPlatformOverride(e.target.value)}
                          className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500">
                          <option value="">Auto-detect (default)</option>
                          <option value="linux/amd64">linux/amd64</option>
                          <option value="linux/arm64">linux/arm64</option>
                        </select>
                        <p className="text-xs text-gray-500 mt-1">Override platform only if auto-detection is wrong</p>
                      </div>
                    </>
                  )}

                  {mode === 'external-cluster' && (
                    <>
                      <div>
                        <label className="block text-sm font-medium text-gray-700 mb-1">Client Server Port</label>
                        <input type="number" min="1024" max="65535" value={clientServerPort}
                          onChange={(e) => setClientServerPort(e.target.value)} placeholder="10001"
                          className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500" />
                        <p className="text-xs text-gray-500 mt-1">Port for Ray client server (default: 10001)</p>
                      </div>
                      <div>
                        <label className="block text-sm font-medium text-gray-700 mb-1">Serve Port</label>
                        <input type="number" min="1024" max="65535" value={servePort}
                          onChange={(e) => setServePort(e.target.value)} placeholder="8000"
                          className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500" />
                        <p className="text-xs text-gray-500 mt-1">Port for Ray Serve (default: 8000)</p>
                      </div>
                    </>
                  )}

                  {/* ── Permissions — last ── */}
                  {mode === 'single-machine' && (containerRuntime === 'docker' || containerRuntime === 'podman') && (
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">Permissions</label>
                      <label className="flex items-center mt-2">
                        <input type="checkbox" checked={runAsRoot} onChange={(e) => setRunAsRoot(e.target.checked)}
                          className="w-4 h-4 text-blue-600 border-gray-300 rounded" />
                        <span className="ml-2 text-sm text-gray-700">Run as root</span>
                      </label>
                      <p className="text-xs text-gray-500 mt-1">
                        {runAsRoot ? 'Root – may be required for some Docker setups' : 'User permissions – recommended for security'}
                      </p>
                    </div>
                  )}

                </div>
              )}
            </div>
          )}

          {/* ── Generated command ── */}
          {mode === 'slurm' && (
            <div className="bg-gray-900 rounded-xl p-4 relative">
              <div className="flex justify-between items-start mb-2">
                <h4 className="text-sm font-medium text-gray-300">SLURM Cluster Command:</h4>
                <button onClick={copyToClipboard}
                  className="px-3 py-1 bg-blue-600 hover:bg-blue-700 text-white text-xs rounded-lg flex items-center">
                  {copied ? (
                    <><svg className="w-3 h-3 mr-1" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" /></svg>Copied!</>
                  ) : (
                    <><svg className="w-3 h-3 mr-1" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" /></svg>Copy</>
                  )}
                </button>
              </div>
              <code className="text-green-400 text-sm font-mono break-all whitespace-pre-wrap">
                {(() => { const command = getCommand(); return typeof command === 'string' ? command : ''; })()}
              </code>
            </div>
          )}

          {mode === 'single-machine' && (
            <div className="space-y-3">
              {/* Step 1: Create directories */}
              <div>
                <div className="flex items-center justify-between mb-1">
                  <p className="text-sm text-gray-700 font-medium">1. Create directories</p>
                  <button
                    onClick={async () => {
                      const command = getCommand();
                      if (typeof command !== 'string') {
                        try { await navigator.clipboard.writeText(command.createDirCmd); setCopiedStep1(true); setTimeout(() => setCopiedStep1(false), 2000); } catch (_) {}
                      }
                    }}
                    className="flex items-center px-2 py-1 text-xs text-gray-600 bg-gray-100 border border-gray-200 rounded hover:bg-gray-200 transition-colors"
                  >
                    {copiedStep1 ? (
                      <><svg className="w-3 h-3 mr-1" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" /></svg>Copied!</>
                    ) : (
                      <><svg className="w-3 h-3 mr-1" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" /></svg>Copy</>
                    )}
                  </button>
                </div>
                <div className="bg-gray-900 rounded-lg p-3 overflow-x-auto">
                  <pre className="text-green-400 text-xs font-mono whitespace-pre">
                    {(() => { const command = getCommand(); return typeof command !== 'string' ? command.createDirCmd : ''; })()}
                  </pre>
                </div>
              </div>

              {/* Step 2: Run container */}
              <div>
                <div className="flex items-center justify-between mb-1">
                  <p className="text-sm text-gray-700 font-medium">2. Run {containerRuntime.charAt(0).toUpperCase() + containerRuntime.slice(1)} container</p>
                  <button
                    onClick={async () => {
                      const command = getCommand();
                      if (typeof command !== 'string') {
                        try { await navigator.clipboard.writeText(command.dockerCmd); setCopiedStep2(true); setTimeout(() => setCopiedStep2(false), 2000); } catch (_) {}
                      }
                    }}
                    className="flex items-center px-2 py-1 text-xs text-gray-600 bg-gray-100 border border-gray-200 rounded hover:bg-gray-200 transition-colors"
                  >
                    {copiedStep2 ? (
                      <><svg className="w-3 h-3 mr-1" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" /></svg>Copied!</>
                    ) : (
                      <><svg className="w-3 h-3 mr-1" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" /></svg>Copy</>
                    )}
                  </button>
                </div>
                <div className="bg-gray-900 rounded-lg p-3 overflow-x-auto">
                  <pre className="text-green-400 text-xs font-mono whitespace-pre">
                    {(() => { const command = getCommand(); return typeof command !== 'string' ? command.dockerCmd : ''; })()}
                  </pre>
                </div>
                {(containerRuntime === 'docker' || containerRuntime === 'podman') && os !== 'windows' && (
                  <p className="text-xs text-gray-500 mt-1">
                    Detach without stopping: <code className="bg-gray-100 px-1 rounded">Ctrl+P, Ctrl+Q</code>. List running containers: <code className="bg-gray-100 px-1 rounded">{containerRuntime} ps</code>. Stop the worker: <code className="bg-gray-100 px-1 rounded">{containerRuntime} stop $(${containerRuntime} ps -q --filter ancestor={DEFAULT_IMAGE})</code>.
                  </p>
                )}
                {(containerRuntime === 'apptainer' || containerRuntime === 'singularity') && (
                  <p className="text-xs text-gray-500 mt-1">
                    Run in background by prepending <code className="bg-gray-100 px-1 rounded">nohup ... &</code> or using a <code className="bg-gray-100 px-1 rounded">screen</code>/<code className="bg-gray-100 px-1 rounded">tmux</code> session. Stop the worker by sending <code className="bg-gray-100 px-1 rounded">Ctrl+C</code> or killing the process.
                  </p>
                )}
              </div>
            </div>
          )}


          {/* ── SLURM info ── */}
          {mode === 'slurm' && (
            <div className="p-4 bg-purple-50 rounded-xl border border-purple-200">
              <div className="flex items-start">
                <svg className="w-5 h-5 text-purple-600 mr-2 mt-0.5 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10" />
                </svg>
                <div className="text-sm text-purple-800">
                  <p className="font-medium mb-2">🖥️ SLURM Cluster Mode</p>
                  <div className="text-purple-700 space-y-1">
                    <p>The script automatically downloads the BioEngine worker, submits SLURM jobs for Ray nodes, handles container caching, and manages the worker lifecycle.</p>
                    <div className="mt-2 p-3 bg-purple-100 rounded-lg">
                      <p className="font-medium text-purple-900 mb-1">💡 Tips:</p>
                      <ul className="list-disc list-inside space-y-1 text-purple-800 text-xs">
                        <li>Run from a login node with SLURM access</li>
                        <li>Ensure your account has sufficient allocation</li>
                        <li>Monitor jobs: <code className="bg-purple-200 px-1 rounded">squeue -u $USER</code></li>
                        <li>Singularity/Apptainer must be available on compute nodes</li>
                      </ul>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          )}


          {/* ── Troubleshooting ── */}
          {mode !== 'external-cluster' && (
            <div className="flex justify-center pt-4 border-t border-gray-200">
              <button onClick={() => setShowTroubleshooting(true)}
                className="flex items-center px-4 py-2 text-sm text-orange-600 bg-orange-50 border border-orange-200 rounded-lg hover:bg-orange-100 transition-colors">
                <svg className="w-4 h-4 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8.228 9c.549-1.165 2.03-2 3.772-2 2.21 0 4 1.343 4 3 0 1.4-1.278 2.575-3.006 2.907-.542.104-.994.54-.994 1.093m0 3h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
                Need Help? Get AI Troubleshooting Prompt
              </button>
            </div>
          )}
        </div>
      )}

      {/* ── Ray workspace dir explanation dialog ── */}
      {showRayWorkspaceDirDialog && (
        <>
          {/* Click-away backdrop */}
          <div
            onClick={() => setShowRayWorkspaceDirDialog(false)}
            style={{ position: 'fixed', inset: 0, zIndex: 998 }}
          />
          {/* Dialog centered in viewport */}
          <div style={{
            position: 'fixed',
            top: '50vh',
            left: '50vw',
            transform: 'translate(-50%, -50%)',
            zIndex: 999,
            width: 'min(640px, 90vw)',
            maxHeight: '80vh',
            overflowY: 'auto',
          }} className="bg-white rounded-2xl shadow-2xl border border-gray-200">
            <div className="p-5 border-b border-gray-200 flex justify-between items-center">
              <h3 className="text-base font-semibold text-gray-800">Ray Workspace Directory — Why It Matters</h3>
              <button onClick={() => setShowRayWorkspaceDirDialog(false)}
                className="text-gray-400 hover:text-gray-600 p-1.5 rounded-lg hover:bg-gray-100">
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>
            <div className="p-5 space-y-4 text-sm text-gray-700">
              <p>
                The BioEngine worker runs in its own pod and writes to the <strong>BioEngine Workspace Directory</strong> (e.g. <code className="bg-gray-100 px-1 rounded">/home/bioengine</code>). This is the same directory configured with <code className="bg-gray-100 px-1 rounded">--workspace-dir</code> in single-machine mode.
              </p>
              <p>
                In Kubernetes mode the actual BioEngine apps execute on <strong>Ray cluster nodes</strong>, not inside the worker pod. Those nodes need their own writable directory, set with <code className="bg-gray-100 px-1 rounded">--ray-workspace-dir</code>. If this flag is not set, the worker falls back to the same path as <code className="bg-gray-100 px-1 rounded">--workspace-dir</code> — which only works if the Ray nodes can also reach that path.
              </p>
              <div className="p-3 bg-amber-50 border border-amber-200 rounded-lg">
                <p className="font-medium text-amber-800 mb-1">Impact on scaling</p>
                <p className="text-amber-700">
                  Some apps, like <code className="bg-amber-100 px-1 rounded">bioimage-io/model-runner</code>, communicate between the worker and Ray nodes through the filesystem. Without a shared <strong>ReadWriteMany</strong> PVC mounted at the same path on all Ray nodes, running more than one app replica will result in reduced functionality — only the replica on the node that holds the file will work correctly.
                </p>
              </div>
              <p>
                <strong>Recommended setup:</strong> mount a ReadWriteMany PVC (e.g. NFS, <code className="bg-gray-100 px-1 rounded">ontap-nas</code>) at <code className="bg-gray-100 px-1 rounded">/home/bioengine</code> on all Ray head and worker nodes, and set <code className="bg-gray-100 px-1 rounded">--ray-workspace-dir /home/bioengine</code>.
              </p>
            </div>
            <div className="p-4 border-t border-gray-200 flex justify-end">
              <button onClick={() => setShowRayWorkspaceDirDialog(false)}
                className="px-5 py-2 bg-gray-600 text-white text-sm rounded-lg hover:bg-gray-700">Close</button>
            </div>
          </div>
        </>
      )}

      {/* ── Troubleshooting dialog ── */}
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
                  <p className="text-sm text-gray-600">Copy this prompt to Claude, Gemini, or ChatGPT</p>
                </div>
              </div>
              <button onClick={() => setShowTroubleshooting(false)}
                className="text-gray-400 hover:text-gray-600 p-2 rounded-xl hover:bg-gray-100">
                <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>
            <div className="flex-1 p-6 overflow-hidden flex flex-col">
              <div className="mb-4 flex justify-between items-center">
                <h4 className="text-sm font-medium text-gray-700">Troubleshooting Prompt</h4>
                <button onClick={copyTroubleshootingPrompt}
                  className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white text-sm rounded-lg flex items-center">
                  {promptCopied ? (
                    <><svg className="w-4 h-4 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" /></svg>Copied!</>
                  ) : (
                    <><svg className="w-4 h-4 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" /></svg>Copy Prompt</>
                  )}
                </button>
              </div>
              <div className="flex-1 overflow-auto">
                <pre className="text-xs text-gray-700 bg-gray-50 p-4 rounded-lg border whitespace-pre-wrap font-mono leading-relaxed">
                  {getTroubleshootingPrompt()}
                </pre>
              </div>
            </div>
            <div className="p-4 border-t border-gray-200 flex justify-end">
              <button onClick={() => setShowTroubleshooting(false)}
                className="px-6 py-2 bg-gray-600 text-white rounded-lg hover:bg-gray-700">Close</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default BioEngineGuide;
