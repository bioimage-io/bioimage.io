import React, { useState, useRef, useEffect, useCallback } from 'react';
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
  const [memory, setMemory] = useState(0);
  const [copied, setCopied] = useState(false);
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

  const getPlatform = () => platformOverride || '';

  const getContainerCacheDir = () => {
    if (containerRuntime !== 'apptainer' && containerRuntime !== 'singularity') return '';
    let baseWorkspace = workspaceDir;
    if (!baseWorkspace) {
      baseWorkspace = os === 'windows' ? (runAsRoot ? 'C:\\.bioengine' : '%USERPROFILE%\\.bioengine') : '$HOME/.bioengine';
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

    if (workspace) args.push(`--workspace ${workspace}`);
    if (serverUrl) args.push(`--server-url ${serverUrl}`);
    if (token) args.push(`--token ${token}`);
    if (adminUsers) {
      if (adminUsers === '*') {
        args.push(`--admin-users "*"`);
      } else {
        args.push(`--admin-users ${adminUsers.split(',').map(u => u.trim()).join(' ')}`);
      }
    }
    if (clientId) args.push(`--client-id ${clientId}`);
    if (customImage) args.push(`--image ${customImage}`);

    const argsString = args.length > 0 ? args.join(' ') : '';

    if (mode === 'slurm') {
      if (workspaceDir) args.push(`--workspace-dir ${workspaceDir}`);
      const slurmArgs = args.join(' ');
      return `bash <(curl -s https://raw.githubusercontent.com/aicell-lab/bioengine-worker/refs/heads/main/scripts/start_hpc_worker.sh)${slurmArgs ? ` ${slurmArgs}` : ''}`;
    }

    const platform = getPlatform();
    const userFlag = getUserFlag();
    const gpuFlag = getGpuFlag();
    const shmFlag = (containerRuntime === 'apptainer' || containerRuntime === 'singularity') ? '' : `--shm-size=${shmSize} `;
    const platformFlag = platform && containerRuntime !== 'apptainer' && containerRuntime !== 'singularity' ? `--platform ${platform} ` : '';
    const imageToUse = customImage || DEFAULT_IMAGE;
    const gpuEnvFlag = (gpuIndices && gpus > 0 && containerRuntime !== 'apptainer' && containerRuntime !== 'singularity')
      ? `-e CUDA_VISIBLE_DEVICES=${gpuIndices} ` : '';

    const mounts: string[] = [];
    if (workspaceDir) {
      mounts.push(containerRuntime === 'apptainer' || containerRuntime === 'singularity'
        ? `--bind ${workspaceDir}:/.bioengine` : `-v ${workspaceDir}:/.bioengine`);
    } else {
      const hostPath = os === 'windows'
        ? (runAsRoot ? 'C:\\.bioengine' : '%USERPROFILE%\\.bioengine')
        : '$HOME/.bioengine';
      mounts.push(containerRuntime === 'apptainer' || containerRuntime === 'singularity'
        ? `--bind ${hostPath}:/.bioengine` : `-v ${hostPath}:/.bioengine`);
    }
    const volumeMounts = mounts.join(' ');

    let createDirCmd = '';
    const wsPath = workspaceDir || (os === 'windows' ? (runAsRoot ? 'C:\\.bioengine' : '%USERPROFILE%\\.bioengine') : '$HOME/.bioengine');
    if (os === 'windows') {
      createDirCmd = `cmd /c "mkdir "${wsPath}" 2>nul || echo Directory already exists"`;
    } else {
      createDirCmd = `mkdir -p ${wsPath}`;
    }

    let dockerCmd = '';
    if (containerRuntime === 'apptainer' || containerRuntime === 'singularity') {
      const cacheEnv = getContainerCacheDir() ? `${containerRuntime.toUpperCase()}_CACHEDIR=${getContainerCacheDir()} ` : '';
      dockerCmd = `${cacheEnv}${containerRuntime} exec ${gpuFlag}${volumeMounts} docker://${imageToUse} python -m bioengine.worker ${argsString}`;
    } else if (os === 'windows') {
      dockerCmd = `cmd /c "${containerRuntime} run ${gpuFlag}${platformFlag}-it --rm ${shmFlag}${gpuEnvFlag}${volumeMounts} ${imageToUse} python -m bioengine.worker ${argsString}"`;
    } else {
      dockerCmd = `${containerRuntime} run ${gpuFlag}${platformFlag}-it --rm ${shmFlag}${userFlag}${gpuEnvFlag}${volumeMounts} ${imageToUse} python -m bioengine.worker ${argsString}`;
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
    const currentCommand = getCommand();
    const containerName = containerRuntime.charAt(0).toUpperCase() + containerRuntime.slice(1);
    let commandText = '';
    if (typeof currentCommand === 'string') {
      commandText = currentCommand;
    } else {
      commandText = `# Step 1: Create directories\n${currentCommand.createDirCmd}\n\n# Step 2: Run ${containerName} container\n${currentCommand.dockerCmd}`;
    }

    return `# BioEngine Worker Troubleshooting Assistant

## Context & Background

I'm trying to set up a **BioEngine Worker** (v0.7.1) for bioimage analysis. BioEngine is part of the AI4Life project and provides cloud-powered AI tools for bioimage analysis.

### My Current Setup
- **Operating System**: ${os === 'macos' ? 'macOS' : os === 'linux' ? 'Linux' : 'Windows'}
- **Container Runtime**: ${containerName}
- **Mode**: ${mode === 'single-machine' ? 'Single Machine (local)' : mode === 'slurm' ? 'SLURM (HPC cluster)' : 'Connect to existing Ray cluster'}
${mode === 'single-machine' ? `- **CPUs**: ${cpus}\n- **GPUs**: ${gpus}${gpus > 0 && gpuIndices ? ` (indices: ${gpuIndices})` : ''}\n- **Memory**: ${memory > 0 ? `${memory} GB` : 'auto-detect'}` : ''}
${mode === 'external-cluster' && rayAddress ? `- **Ray Address**: ${rayAddress}` : ''}

### Advanced Configuration
${workspace ? `- **Workspace**: ${workspace}` : ''}
${serverUrl ? `- **Server URL**: ${serverUrl}` : ''}
${token ? `- **Token**: [CONFIGURED]` : ''}
${adminUsers ? `- **Admin Users**: ${adminUsers}` : '- **Admin Users**: Default (logged-in user)'}
${workspaceDir ? `- **Workspace Directory**: ${workspaceDir}` : ''}
${customImage ? `- **Custom Image**: ${customImage}` : ''}

### Generated Command
\`\`\`bash
${commandText}
\`\`\`

## My Question

[Please describe your specific issue or error here]`;
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

  // Build kubernetes YAML based on current config
  const getKubernetesWorkerYaml = () => {
    const serverUrlVal = serverUrl || 'https://hypha.aicell.io';
    const workspaceVal = workspace || 'bioimage-io';
    const rayAddr = rayAddress || 'ray://raycluster-kuberay-head-svc.ray-cluster.svc.cluster.local:10001';
    let extraArgs = '';
    if (adminUsers) extraArgs += `\n        - "--admin-users"\n        - "${adminUsers}"`;
    if (clientId) extraArgs += `\n        - "--client-id"\n        - "${clientId}"`;

    return `# 1. Create Kubernetes secret for Hypha token
kubectl create secret generic bioengine-secrets \\
  --from-literal=HYPHA_TOKEN=<your-admin-token> \\
  -n <namespace>

---
# 2. Shared PVC (ReadWriteMany) for Ray head + workers
apiVersion: v1
kind: PersistentVolumeClaim
metadata:
  name: bioengine-pvc
  namespace: ray-cluster
spec:
  accessModes:
    - ReadWriteMany
  resources:
    requests:
      storage: 500Gi
  storageClassName: <your-rwx-storage-class>  # e.g. ontap-nas, nfs-client

---
# 3. Install KubeRay operator (version 1.1.1)
# helm repo add kuberay https://ray-project.github.io/kuberay-helm/
# helm install kuberay-operator kuberay/kuberay-operator \\
#   --version 1.1.1 -n ray-cluster \\
#   --set singleNamespaceInstall=true,rbacEnable=false

---
# 4. Ray cluster values.yaml (key additions over base chart)
# head:
#   image: { repository: rayproject/ray-ml, tag: 2.33.0-py311-cpu }
#   volumes:
#     - { name: bioengine, persistentVolumeClaim: { claimName: bioengine-pvc } }
#   volumeMounts:
#     - { name: bioengine, mountPath: /home/bioengine }
# worker:
#   image: { repository: rayproject/ray-ml, tag: 2.33.0-py311-cu118 }
#   tolerations:
#     - { key: nvidia.com/gpu, operator: Exists, effect: NoSchedule }
#   resources:
#     limits: { cpu: "10", memory: "32G", "nvidia.com/gpu": 1 }
#   volumes:
#     - { name: dshm, emptyDir: { medium: Memory } }   # shared memory for GPU
#     - { name: bioengine, persistentVolumeClaim: { claimName: bioengine-pvc } }
#   volumeMounts:
#     - { name: dshm, mountPath: /dev/shm }
#     - { name: bioengine, mountPath: /home/bioengine }
# helm install raycluster kuberay/ray-cluster --version 1.1.1 -n ray-cluster -f values.yaml

---
# 5. BioEngine Worker PVC (smaller, for worker pod logs/cache)
apiVersion: v1
kind: PersistentVolumeClaim
metadata:
  name: bioengine-pvc
  namespace: hypha
spec:
  accessModes:
    - ReadWriteMany
  resources:
    requests:
      storage: 10Gi
  storageClassName: <your-rwx-storage-class>

---
# 6. BioEngine Worker Deployment
apiVersion: apps/v1
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
      containers:
      - name: bioengine-worker
        image: ${customImage || DEFAULT_IMAGE}
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
        - "$(POD_NAME)"${extraArgs}
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
        resources:
          requests: { memory: "2Gi", cpu: "1" }
          limits:   { memory: "4Gi", cpu: "2" }
        livenessProbe:
          exec:
            command: ["/bin/sh", "-c",
              "curl -sf https://hypha.aicell.io/${workspaceVal}/services/$(POD_NAME):bioengine-worker/get_status"]
          initialDelaySeconds: 60
          periodSeconds: 30
          failureThreshold: 2
        volumeMounts:
        - name: bioengine
          mountPath: /home/bioengine
      volumes:
      - name: bioengine
        persistentVolumeClaim:
          claimName: bioengine-pvc`;
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
              Deployment configurator — BioEngine v0.7.1
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
                { value: 'single-machine', label: '💻 Desktop/Workstation', desc: 'Run locally on your computer or workstation using Docker. Perfect for development or small-scale analysis.', badge: 'Easy Setup', color: 'blue' },
                { value: 'slurm', label: '🖥️ HPC Cluster', desc: 'Deploy on a high-performance computing cluster with SLURM job scheduler. Ideal for large-scale workloads.', badge: 'High Performance', color: 'purple' },
                { value: 'external-cluster', label: '☸️ Kubernetes Cluster', desc: 'Deploy on Kubernetes with KubeRay. Connect BioEngine to an existing Ray cluster for cloud-native deployment.', badge: 'Cloud Native', color: 'orange' },
              ].map(({ value, label, desc, badge, color }) => (
                <div
                  key={value}
                  className={`p-4 rounded-lg border-2 cursor-pointer transition-all duration-200 ${mode === value
                      ? `border-${color}-500 bg-${color}-50 shadow-md`
                      : `border-gray-200 bg-white hover:border-${color}-300 hover:shadow-sm`
                    }`}
                  onClick={() => setMode(value as ModeType)}
                >
                  <div className="flex items-center mb-2">
                    <input type="radio" name="deployment-mode" value={value} checked={mode === value}
                      onChange={(e) => setMode(e.target.value as ModeType)}
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

          {/* ── Kubernetes setup instructions ── */}
          {mode === 'external-cluster' && (
            <div className="space-y-4">
              <div className="p-4 bg-orange-50 rounded-xl border border-orange-200">
                <h5 className="text-sm font-medium text-orange-800 mb-3 flex items-center">
                  <span className="w-5 h-5 bg-orange-600 text-white rounded-full flex items-center justify-center text-xs mr-2">1</span>
                  Create Kubernetes Secrets
                </h5>
                <div className="text-sm text-orange-700 space-y-1">
                  <p>Store your Hypha authentication token as a Kubernetes secret:</p>
                  <code className="block bg-orange-100 px-2 py-1 rounded text-xs mt-1">
                    kubectl create secret generic bioengine-secrets \<br/>
                    &nbsp;&nbsp;--from-literal=HYPHA_TOKEN=&lt;your-admin-token&gt; \<br/>
                    &nbsp;&nbsp;-n &lt;namespace&gt;
                  </code>
                </div>
              </div>

              <div className="p-4 bg-orange-50 rounded-xl border border-orange-200">
                <h5 className="text-sm font-medium text-orange-800 mb-3 flex items-center">
                  <span className="w-5 h-5 bg-orange-600 text-white rounded-full flex items-center justify-center text-xs mr-2">2</span>
                  Create Shared Volume (ReadWriteMany)
                </h5>
                <div className="text-sm text-orange-700 space-y-1">
                  <p>A shared <code className="bg-orange-100 px-1 rounded">ReadWriteMany</code> PVC is required so both the Ray head node and all GPU worker nodes can access the same workspace (model cache, logs). Use a storage class that supports RWX (e.g. <code className="bg-orange-100 px-1 rounded">ontap-nas</code>, <code className="bg-orange-100 px-1 rounded">nfs-client</code>):</p>
                  <ul className="list-disc list-inside text-xs ml-2 space-y-1 mt-1">
                    <li>Ray cluster namespace: 500Gi PVC mounted at <code className="bg-orange-100 px-1 rounded">/home/bioengine</code> on head and workers</li>
                    <li>BioEngine worker namespace: 10Gi PVC mounted at <code className="bg-orange-100 px-1 rounded">/home/bioengine</code></li>
                    <li>GPU worker pods also need a <code className="bg-orange-100 px-1 rounded">dshm</code> emptyDir at <code className="bg-orange-100 px-1 rounded">/dev/shm</code> for shared memory</li>
                  </ul>
                </div>
              </div>

              <div className="p-4 bg-orange-50 rounded-xl border border-orange-200">
                <h5 className="text-sm font-medium text-orange-800 mb-3 flex items-center">
                  <span className="w-5 h-5 bg-orange-600 text-white rounded-full flex items-center justify-center text-xs mr-2">3</span>
                  Install KubeRay Operator & Ray Cluster
                </h5>
                <div className="text-sm text-orange-700 space-y-2">
                  <code className="block bg-orange-100 px-2 py-1 rounded text-xs">
                    helm repo add kuberay https://ray-project.github.io/kuberay-helm/<br/>
                    helm install kuberay-operator kuberay/kuberay-operator \<br/>
                    &nbsp;&nbsp;--version 1.1.1 -n ray-cluster \<br/>
                    &nbsp;&nbsp;--set singleNamespaceInstall=true,rbacEnable=false<br/><br/>
                    helm install raycluster kuberay/ray-cluster \<br/>
                    &nbsp;&nbsp;--version 1.1.1 -n ray-cluster -f values.yaml
                  </code>
                  <p className="text-xs">The values.yaml must include the shared PVC mount (<code className="bg-orange-100 px-1 rounded">/home/bioengine</code>) and the <code className="bg-orange-100 px-1 rounded">dshm</code> emptyDir for GPU workers. See the generated YAML below for the full example.</p>
                </div>
              </div>

              <div className="p-4 bg-orange-50 rounded-xl border border-orange-200">
                <h5 className="text-sm font-medium text-orange-800 mb-3 flex items-center">
                  <span className="w-5 h-5 bg-orange-600 text-white rounded-full flex items-center justify-center text-xs mr-2">4</span>
                  Enter Ray Cluster Address
                </h5>
                <input
                  type="text"
                  value={rayAddress}
                  onChange={(e) => setRayAddress(e.target.value)}
                  placeholder="ray://raycluster-kuberay-head-svc.ray-cluster.svc.cluster.local:10001"
                  className="w-full px-3 py-2 border border-orange-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-orange-500"
                />
                <p className="text-xs text-orange-700 mt-1">
                  Internal Kubernetes service address of the Ray head node. Use <code className="bg-orange-100 px-1 rounded">kubectl get svc -n ray-cluster</code> to find the service name.
                </p>
              </div>

              {/* K8s field config */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">Admin Users</label>
                  <input type="text" value={adminUsers} onChange={(e) => setAdminUsers(e.target.value)}
                    placeholder="user1@example.com,user2@example.com or *"
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500" />
                  <p className="text-xs text-gray-500 mt-1">Users who can manage the worker (comma-separated, * for all)</p>
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">Client ID</label>
                  <input type="text" value={clientId} onChange={(e) => setClientId(e.target.value)}
                    placeholder="bioengine-worker"
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500" />
                  <p className="text-xs text-gray-500 mt-1">Custom client ID (auto-generated if empty; pod name is used in K8s)</p>
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">Server URL</label>
                  <input type="text" value={serverUrl} onChange={(e) => setServerUrl(e.target.value)}
                    placeholder="https://hypha.aicell.io"
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500" />
                  <p className="text-xs text-gray-500 mt-1">Hypha server URL (defaults to public server)</p>
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">Workspace</label>
                  <input type="text" value={workspace} onChange={(e) => setWorkspace(e.target.value)}
                    placeholder="my-workspace"
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500" />
                  <p className="text-xs text-gray-500 mt-1">Hypha workspace name (optional, uses token's workspace if not set)</p>
                </div>
              </div>
            </div>
          )}

          {/* ── Single-machine and SLURM settings ── */}
          {mode !== 'external-cluster' && (
            <div className="space-y-4">

              {/* Connection / Hypha settings */}
              <div className="p-4 bg-gray-50 rounded-xl border border-gray-200">
                <h5 className="text-sm font-semibold text-gray-700 mb-3">Hypha Connection</h5>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  {/* Authentication Token – required */}
                  <div className="md:col-span-2">
                    <div className="flex items-center justify-between mb-1">
                      <label className="block text-sm font-medium text-gray-700">
                        Authentication Token <span className="text-red-500">*</span>
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
                    <div className="relative">
                      <input
                        type="password"
                        value={token}
                        onChange={(e) => { setToken(e.target.value); setTokenIsManual(true); }}
                        placeholder={isLoggedIn ? (isGeneratingToken ? 'Generating…' : 'Auto-generated') : 'Paste your Hypha token'}
                        autoComplete="new-password"
                        className={`w-full px-3 py-2 border rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 ${!token ? 'border-red-300 bg-red-50' : 'border-gray-300'}`}
                      />
                    </div>
                    {tokenError && <p className="text-xs text-red-600 mt-1">{tokenError}</p>}
                    {!isLoggedIn && (
                      <p className="text-xs text-amber-600 mt-1">
                        Log in to auto-generate a token, or paste one manually.
                      </p>
                    )}
                    {isLoggedIn && !tokenIsManual && token && (
                      <p className="text-xs text-green-600 mt-1">Auto-generated 30-day admin token.</p>
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
                    <label className="block text-sm font-medium text-gray-700 mb-1">Workspace</label>
                    <input type="text" value={workspace} onChange={(e) => setWorkspace(e.target.value)}
                      placeholder="my-workspace" autoComplete="off"
                      className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500" />
                    <p className="text-xs text-gray-500 mt-1">Hypha workspace (uses token's workspace if not set)</p>
                  </div>
                </div>
              </div>

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
                      <p className="text-xs text-gray-500 mt-1">RAM for Ray head node (0 = auto-detect)</p>
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
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">Admin Users</label>
                    <input type="text" value={adminUsers} onChange={(e) => setAdminUsers(e.target.value)}
                      placeholder="user1@example.com,user2@example.com or *"
                      className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500" />
                    <p className="text-xs text-gray-500 mt-1">Users who can manage the worker. Leave empty to use the logged-in user</p>
                  </div>

                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">Workspace Directory</label>
                    <input type="text" value={workspaceDir}
                      onChange={(e) => setWorkspaceDir(e.target.value)}
                      placeholder={os === 'windows' ? '%USERPROFILE%\\.bioengine' : '~/.bioengine'}
                      className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500" />
                    <p className="text-xs text-gray-500 mt-1">Worker workspace for Ray data and logs. Defaults to ~/.bioengine</p>
                  </div>

                  {mode === 'single-machine' && gpus > 0 && (
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">GPU Indices</label>
                      <input type="text" value={gpuIndices} onChange={(e) => setGpuIndices(e.target.value)}
                        placeholder="0,1"
                        className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500" />
                      <p className="text-xs text-gray-500 mt-1">CUDA_VISIBLE_DEVICES — comma-separated GPU indices (e.g. 0,1). Leave empty to use all GPUs</p>
                    </div>
                  )}

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

                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">Client ID</label>
                    <input type="text" value={clientId} onChange={(e) => setClientId(e.target.value)}
                      placeholder="bioengine-worker-123"
                      className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500" />
                    <p className="text-xs text-gray-500 mt-1">Custom client ID (auto-generated if empty)</p>
                  </div>

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
                </div>
              )}
            </div>
          )}

          {/* ── Generated command ── */}
          {mode !== 'external-cluster' && (
            <div className="bg-gray-900 rounded-xl p-4 relative">
              <div className="flex justify-between items-start mb-2">
                <h4 className="text-sm font-medium text-gray-300">
                  {mode === 'slurm' ? 'SLURM Cluster Command:' : os === 'windows' ? 'PowerShell/Command Prompt Command:' : 'Terminal Command:'}
                </h4>
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
                {(() => {
                  const command = getCommand();
                  if (typeof command === 'string') return command;
                  const containerName = containerRuntime.charAt(0).toUpperCase() + containerRuntime.slice(1);
                  let text = `# Step 1: Create directories\n${command.createDirCmd}\n\n# Step 2: Run ${containerName} container\n${command.dockerCmd}`;
                  const hostPath = workspaceDir || (os === 'windows' ? (runAsRoot ? 'C:\\.bioengine' : '%USERPROFILE%\\.bioengine') : '$HOME/.bioengine');
                  text += `\n\n# Volume mounts:\n# - ${hostPath} → /.bioengine (workspace)`;
                  return text;
                })()}
              </code>
            </div>
          )}

          {/* ── Kubernetes deployment YAML ── */}
          {mode === 'external-cluster' && (
            <div className="p-4 bg-blue-50 rounded-xl border border-blue-200">
              <div className="flex items-center justify-between mb-3">
                <h5 className="text-sm font-medium text-blue-800 flex items-center">
                  <span className="w-5 h-5 bg-blue-600 text-white rounded-full flex items-center justify-center text-xs mr-2">5</span>
                  Deploy BioEngine Worker on Kubernetes
                </h5>
                <button
                  onClick={async () => {
                    try { await navigator.clipboard.writeText(getKubernetesWorkerYaml()); } catch (err) { console.error(err); }
                  }}
                  className="px-2 py-1 bg-blue-600 hover:bg-blue-700 text-white text-xs rounded"
                >Copy YAML</button>
              </div>
              <p className="text-sm text-blue-700 mb-3">
                Configure the options above then copy the full YAML (includes secrets, PVCs, Ray cluster notes, and BioEngine worker deployment):
              </p>
              <div className="bg-gray-900 rounded-lg p-3">
                <pre className="text-green-400 text-xs font-mono overflow-x-auto max-h-64 overflow-y-auto whitespace-pre">
                  {getKubernetesWorkerYaml()}
                </pre>
              </div>
              <p className="text-xs text-blue-700 mt-2">
                Save the deployment section as <code className="bg-blue-100 px-1 rounded">bioengine-worker.yaml</code> and apply with: <code className="bg-blue-100 px-1 rounded">kubectl apply -f bioengine-worker.yaml -n &lt;namespace&gt;</code>
              </p>
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

          {/* ── Prerequisites ── */}
          {mode !== 'external-cluster' && (
            <div className="p-4 bg-blue-50 rounded-xl border border-blue-200">
              <div className="flex items-start">
                <svg className="w-5 h-5 text-blue-600 mr-2 mt-0.5 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
                <div className="text-sm text-blue-800">
                  <p className="font-medium mb-1">Prerequisites:</p>
                  <ul className="list-disc list-inside space-y-1 text-blue-700">
                    {mode === 'slurm' ? (
                      <>
                        <li>SLURM cluster access with sbatch/squeue/scancel</li>
                        <li>Singularity/Apptainer on compute nodes</li>
                        <li>Network access from compute nodes to pull container images</li>
                        <li>Shared filesystem accessible from all nodes</li>
                      </>
                    ) : (
                      <>
                        <li>{containerRuntime.charAt(0).toUpperCase() + containerRuntime.slice(1)} installed and running</li>
                        {gpus > 0 && <li>NVIDIA {containerRuntime === 'docker' ? 'Docker runtime' : containerRuntime === 'podman' ? 'container toolkit' : 'drivers'} for GPU support</li>}
                      </>
                    )}
                    <li>A workspace directory will be created at <code className="bg-blue-100 px-1 rounded">~/.bioengine</code> (or custom path) and mounted into the container</li>
                    <li>After starting, connect using the service ID printed in the terminal</li>
                  </ul>
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
                  <p className="text-sm text-gray-600">Copy this prompt to ChatGPT, Claude, Gemini, or your favorite LLM</p>
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
