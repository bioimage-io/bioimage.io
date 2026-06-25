import React, { useState, useRef, useEffect, useCallback } from 'react';
import { hyphaWebsocketClient } from 'hypha-rpc';
import { useHyphaStore } from '../../store/hyphaStore';
import { HYPHA_SERVER_URL } from '../../config/hypha';

type OSType = 'macos' | 'linux' | 'windows';

// Tag-badge input: space/enter commits a tag, backspace on empty field focuses last tag,
// arrow keys navigate tags, delete/backspace removes focused tag.
const TagInput: React.FC<{
  tags: string[];
  onChange: (tags: string[]) => void;
  placeholder?: string;
  allowWildcard?: boolean;
}> = ({ tags, onChange, placeholder, allowWildcard = true }) => {
  const [inputValue, setInputValue] = useState('');
  const [focusedIdx, setFocusedIdx] = useState<number | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  const commit = (value: string) => {
    const v = value.trim();
    if (v && !tags.includes(v) && (allowWildcard || v !== '*')) onChange([...tags, v]);
    setInputValue('');
  };

  const remove = (idx: number) => {
    const next = tags.filter((_, i) => i !== idx);
    onChange(next);
    if (next.length === 0) { setFocusedIdx(null); inputRef.current?.focus(); }
    else if (idx >= next.length) setFocusedIdx(next.length - 1);
    else setFocusedIdx(idx);
  };

  useEffect(() => {
    if (focusedIdx === null) return;
    const els = containerRef.current?.querySelectorAll<HTMLElement>('[data-tag-badge]');
    els?.[focusedIdx]?.focus();
  }, [focusedIdx]);

  const handleInputKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if ((e.key === ' ' || e.key === 'Enter') && inputValue.trim()) {
      e.preventDefault(); commit(inputValue);
    } else if (e.key === 'Backspace' && !inputValue && tags.length > 0) {
      e.preventDefault(); setFocusedIdx(tags.length - 1);
    } else if (e.key === 'ArrowLeft' && !inputValue && tags.length > 0) {
      e.preventDefault(); setFocusedIdx(tags.length - 1);
    }
  };

  const handleTagKeyDown = (e: React.KeyboardEvent<HTMLSpanElement>, idx: number) => {
    if (e.key === 'Backspace' || e.key === 'Delete') {
      e.preventDefault(); remove(idx);
    } else if (e.key === 'ArrowLeft') {
      e.preventDefault();
      if (idx > 0) setFocusedIdx(idx - 1);
    } else if (e.key === 'ArrowRight') {
      e.preventDefault();
      if (idx < tags.length - 1) setFocusedIdx(idx + 1);
      else { setFocusedIdx(null); inputRef.current?.focus(); }
    } else if (e.key.length === 1) {
      setFocusedIdx(null); inputRef.current?.focus();
    }
  };

  return (
    <div
      ref={containerRef}
      onClick={() => { if (focusedIdx === null) inputRef.current?.focus(); }}
      className="flex flex-wrap gap-1.5 items-center min-h-[38px] px-2.5 py-1.5 border border-gray-300 rounded-lg focus-within:ring-2 focus-within:ring-blue-500 bg-white cursor-text"
    >
      {tags.map((tag, i) => (
        <span
          key={tag}
          data-tag-badge
          tabIndex={0}
          onFocus={() => setFocusedIdx(i)}
          onBlur={() => setFocusedIdx(null)}
          onKeyDown={(e) => handleTagKeyDown(e, i)}
          className="inline-flex items-center gap-1 px-2 py-0.5 text-xs font-medium rounded-full border outline-none select-none bg-blue-100 text-blue-700 border-blue-200 focus:ring-2 focus:ring-blue-400"
        >
          {tag}
          <button
            type="button"
            tabIndex={-1}
            onClick={(e) => { e.stopPropagation(); remove(i); }}
            className="opacity-50 hover:opacity-100 leading-none ml-0.5"
            aria-label={`Remove ${tag}`}
          >×</button>
        </span>
      ))}
      <input
        ref={inputRef}
        type="text"
        value={inputValue}
        placeholder={tags.length === 0 ? placeholder : ''}
        onChange={(e) => setInputValue(e.target.value)}
        onKeyDown={handleInputKeyDown}
        onFocus={() => setFocusedIdx(null)}
        onBlur={() => { if (inputValue.trim()) commit(inputValue); }}
        className="flex-1 min-w-[140px] outline-none text-sm bg-transparent py-0.5"
      />
    </div>
  );
};
type ModeType = 'single-machine' | 'slurm' | 'external-cluster';
type ContainerRuntimeType = 'docker' | 'podman' | 'apptainer' | 'singularity';

const DEFAULT_IMAGE_VERSION = '0.9.1';
const DEFAULT_IMAGE = `ghcr.io/aicell-lab/bioengine-worker:${DEFAULT_IMAGE_VERSION}`;
const DEFAULT_RAY_VERSION = '2.55.1';

const BioEngineGuide: React.FC = () => {
  const { server, isLoggedIn, user } = useHyphaStore();
  const [os, setOS] = useState<OSType>('macos');
  const [mode, setMode] = useState<ModeType>('single-machine');
  // Top-level audience toggle: humans get the full configurator below;
  // agents get a compact panel that hands off to the BioEngine SKILL.md.
  const [audience, setAudience] = useState<'human' | 'agent'>('human');
  const [agentPromptCopied, setAgentPromptCopied] = useState(false);
  const [includeAgentToken, setIncludeAgentToken] = useState(false);
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
  const [adminUsers, setAdminUsers] = useState<string[]>([]);
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
  const [gpuIndices, setGpuIndices] = useState('');

  // Kubernetes-specific options
  const [hasPvc, setHasPvc] = useState(false);
  const [rayWorkspaceDir, setRayWorkspaceDir] = useState('');
  const [k8sNamespace, setK8sNamespace] = useState('');
  // Optional Bearer token for token-protected Ray clusters. Same value is
  // used both as RAY_AUTH_TOKEN env (gRPC metadata for Ray Client, Bearer
  // header for dashboard requests from the proxy actor) and stored alongside
  // HYPHA_TOKEN in the bioengine-secrets Kubernetes Secret.
  const [rayAuthToken, setRayAuthToken] = useState('');
  const [showRayWorkspaceDirDialog, setShowRayWorkspaceDirDialog] = useState(false);
  const [k8sSecretCopied, setK8sSecretCopied] = useState(false);
  const [k8sYamlCopied, setK8sYamlCopied] = useState(false);
  const [k8sApplyCopied, setK8sApplyCopied] = useState(false);
  const [rayVersion, setRayVersion] = useState('');
  const [dockerHubUsername, setDockerHubUsername] = useState('');
  const [k8sLoginCopied, setK8sLoginCopied] = useState(false);
  const [k8sBuildCopied, setK8sBuildCopied] = useState(false);
  const [k8sPushCopied, setK8sPushCopied] = useState(false);

  // SLURM-specific options (HPC mode)
  const [slurmDefaultNumCpus, setSlurmDefaultNumCpus] = useState(8);
  const [slurmDefaultNumGpus, setSlurmDefaultNumGpus] = useState(1);
  const [slurmDefaultMemPerCpu, setSlurmDefaultMemPerCpu] = useState(16);
  const [slurmDefaultTimeLimit, setSlurmDefaultTimeLimit] = useState('4:00:00');
  const [slurmMaxWorkers, setSlurmMaxWorkers] = useState<number | ''>('');
  const [slurmGpuFlag, setSlurmGpuFlag] = useState('--gpus={n}');
  const [slurmFurtherArgs, setSlurmFurtherArgs] = useState('');
  const [slurmApptainerArgs, setSlurmApptainerArgs] = useState('');
  const [slurmWorkerWorkspaceDir, setSlurmWorkerWorkspaceDir] = useState('');
  const [copiedSlurmStep1, setCopiedSlurmStep1] = useState(false);
  const [copiedSlurmStep2, setCopiedSlurmStep2] = useState(false);
  const [copiedSlurmStep3, setCopiedSlurmStep3] = useState(false);

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

  // Pre-populate Admin Users with the logged-in user's email — only when the
  // list is currently empty, so manual edits aren't overwritten on re-renders.
  useEffect(() => {
    if (isLoggedIn && user?.email && adminUsers.length === 0) {
      setAdminUsers([user.email]);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isLoggedIn, user?.email]);

  // When the token changes, briefly connect to Hypha to resolve the workspace
  const [workspaceResolved, setWorkspaceResolved] = useState(false);
  useEffect(() => {
    if (!token) return;
    let cancelled = false;
    const resolveWorkspace = async () => {
      try {
        const url = serverUrl || HYPHA_SERVER_URL;
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
    if (adminUsers.length > 0) {
      args.push(`--admin-users ${adminUsers.map(u => `"${u}"`).join(' ')}`);
    }
    if (workerName) args.push(`--worker-name "${workerName}"`);
    if (clientId) args.push(`--client-id ${clientId}`);
    // --image is a SLURM-only flag (apptainer image for worker jobs). Don't
    // emit it for single-machine / external-cluster — the image is selected
    // at container-runtime via the docker/podman command, not here.
    if (mode === 'slurm' && customImage) args.push(`--image ${customImage}`);

    const argsString = args.length > 0 ? args.join(' ') : '';

    if (mode === 'slurm') {
      if (workspaceDir) args.push(`--workspace-dir ${workspaceDir}`);
      if (slurmWorkerWorkspaceDir) args.push(`--worker-workspace-dir ${slurmWorkerWorkspaceDir}`);
      if (slurmDefaultNumCpus !== 8) args.push(`--default-num-cpus ${slurmDefaultNumCpus}`);
      if (slurmDefaultNumGpus !== 1) args.push(`--default-num-gpus ${slurmDefaultNumGpus}`);
      if (slurmDefaultMemPerCpu !== 16) args.push(`--default-mem-in-gb-per-cpu ${slurmDefaultMemPerCpu}`);
      if (slurmDefaultTimeLimit && slurmDefaultTimeLimit !== '4:00:00') args.push(`--default-time-limit ${slurmDefaultTimeLimit}`);
      if (slurmMaxWorkers !== '' && Number(slurmMaxWorkers) > 0) args.push(`--max-workers ${slurmMaxWorkers}`);
      if (slurmGpuFlag !== '--gpus={n}') {
        // Empty string is a valid value meaning "omit the GPU directive entirely".
        args.push(slurmGpuFlag === '' ? `--gpu-slurm-flag ""` : `--gpu-slurm-flag "${slurmGpuFlag}"`);
      }
      if (slurmFurtherArgs.trim()) {
        args.push(`--further-slurm-args "${slurmFurtherArgs.trim()}"`);
      }
      if (slurmApptainerArgs.trim()) {
        args.push(`--further-apptainer-args "${slurmApptainerArgs.trim()}"`);
      }
      const nl = ' \\\n  ';
      const scriptCmd = [
        'bash <(curl -s https://raw.githubusercontent.com/aicell-lab/bioengine/refs/heads/main/scripts/start_hpc_worker.sh)',
        ...args,
      ].join(nl);

      const hostPath = workspaceDir || '$HOME/.bioengine';
      const createDirCmd = `mkdir -p ${hostPath}`;
      const tokenExportCmd = token
        ? `export HYPHA_TOKEN=${token}`
        : `export HYPHA_TOKEN=<your-hypha-token>`;
      return { createDirCmd, tokenExportCmd, scriptCmd };
    }

    const platform = getPlatform();
    const userFlag = getUserFlag();
    const gpuFlag = getGpuFlag();
    const shmFlag = (containerRuntime === 'apptainer' || containerRuntime === 'singularity') ? '' : `--shm-size=${shmSize} `;
    const platformFlag = platform && containerRuntime !== 'apptainer' && containerRuntime !== 'singularity' ? `--platform ${platform} ` : '';
    const imageToUse = customImage || DEFAULT_IMAGE;
    const gpuEnvFlag = (gpuIndices && gpus > 0 && containerRuntime !== 'apptainer' && containerRuntime !== 'singularity')
      ? `-e CUDA_VISIBLE_DEVICES=${gpuIndices} ` : '';
    // The worker's default --workspace-dir is $HOME/.bioengine. Pin HOME=/
    // so that resolves to /.bioengine, which matches the mount point below.
    const homeEnvFlag = (containerRuntime !== 'apptainer' && containerRuntime !== 'singularity')
      ? '-e HOME=/ ' : '';

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
      dockerCmd = `cmd /c "${containerRuntime} run ${gpuFlag}${platformFlag}--rm ${shmFlag}${homeEnvFlag}${gpuEnvFlag}${volumeMounts} ${imageToUse} python -m bioengine.worker ${argsString}"`;
    } else {
      const parts = [
        `${containerRuntime} run`,
        ...(gpuFlag ? [gpuFlag.trim()] : []),
        ...(platformFlag ? [platformFlag.trim()] : []),
        '--rm',
        ...(shmFlag ? [shmFlag.trim()] : []),
        ...(userFlag ? [userFlag.trim()] : []),
        ...(homeEnvFlag ? [homeEnvFlag.trim()] : []),
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
      } else if ('scriptCmd' in command) {
        textToCopy = `# Step 1: Create the BioEngine workspace directory\n${command.createDirCmd}\n\n# Step 2: Set your Hypha authentication token\n${command.tokenExportCmd}\n\n# Step 3: Launch the BioEngine worker on SLURM\n${command.scriptCmd}`;
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
      } else if ('scriptCmd' in currentCommand) {
        commandText = `# Step 1: Create the BioEngine workspace directory\n${currentCommand.createDirCmd}\n\n# Step 2: Set your Hypha authentication token\n${currentCommand.tokenExportCmd}\n\n# Step 3: Launch the BioEngine worker on SLURM\n${currentCommand.scriptCmd}`;
      } else {
        commandText = `# Step 1: Create directories\n${currentCommand.createDirCmd}\n\n# Step 2: Run ${containerName} container\n${currentCommand.dockerCmd}`;
      }
      // Redact token from command
      if (token) commandText = commandText.replace(new RegExp(token.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g'), '<my-token>');
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
        adminUsers.length > 0 && `- **Admin Users**: ${adminUsers.join(', ')}`,
        customImage && `- **Custom Image**: ${customImage}`,
      ].filter(Boolean).join('\n');
      const yaml = getKubernetesWorkerYaml().replace(token, '<my-token>');
      setupSection = `### My Kubernetes Setup\n${k8sLines}\n\n### Deployment YAML\n\`\`\`yaml\n${yaml}\n\`\`\``;
    } else {
      const isSlurm = mode === 'slurm';
      const lines = [
        !isSlurm && `- **Operating System**: ${os === 'macos' ? 'macOS' : os === 'linux' ? 'Linux' : 'Windows'}`,
        !isSlurm && `- **Container Runtime**: ${containerName}`,
        `- **Mode**: ${mode === 'single-machine' ? 'Single Machine (local)' : 'SLURM (HPC cluster)'}`,
        mode === 'single-machine' && `- **CPUs**: ${cpus}`,
        mode === 'single-machine' && `- **GPUs**: ${gpus}${gpus > 0 && gpuIndices ? ` (indices: ${gpuIndices})` : ''}`,
        mode === 'single-machine' && `- **Memory**: ${memory > 0 ? `${memory} GB` : 'auto-detect'}`,
        isSlurm && `- **Worker CPUs (default)**: ${slurmDefaultNumCpus}`,
        isSlurm && `- **Worker GPUs (default)**: ${slurmDefaultNumGpus}`,
        isSlurm && `- **Memory per CPU (default)**: ${slurmDefaultMemPerCpu} GB`,
        isSlurm && `- **Worker time limit (default)**: ${slurmDefaultTimeLimit}`,
        isSlurm && slurmMaxWorkers !== '' && `- **Max workers**: ${slurmMaxWorkers}`,
        isSlurm && slurmGpuFlag !== '--gpus={n}' && `- **GPU sbatch flag**: ${slurmGpuFlag || '(omitted)'}`,
        isSlurm && slurmFurtherArgs.trim() && `- **Further SLURM args**: ${slurmFurtherArgs.trim()}`,
        isSlurm && slurmApptainerArgs.trim() && `- **Further apptainer args**: ${slurmApptainerArgs.trim()}`,
        isSlurm && slurmWorkerWorkspaceDir && `- **Worker Workspace Directory**: ${slurmWorkerWorkspaceDir}`,
        workspace && `- **Hypha Workspace**: ${workspace}`,
        serverUrl && `- **Hypha Server URL**: ${serverUrl}`,
        adminUsers.length > 0 && `- **Admin Users**: ${adminUsers.join(', ')}`,
        workspaceDir && `- **BioEngine Workspace Directory**: ${workspaceDir}`,
        customImage && `- **Custom Image**: ${customImage}`,
      ].filter(Boolean).join('\n');
      setupSection = `### My Setup\n${lines}\n\n### Generated Command\n\`\`\`bash\n${commandText}\n\`\`\``;
    }

    return `# BioEngine Worker Troubleshooting

I'm trying to set up a **BioEngine Worker**. BioEngine is part of the AI4Life project and provides cloud-powered AI tools for bioimage analysis.

The source code and documentation are available at: https://github.com/aicell-lab/bioengine
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
    const rayAuthLine = rayAuthToken
      ? ` \\\n  --from-literal=RAY_AUTH_TOKEN=${rayAuthToken}`
      : '';
    return `kubectl create secret generic bioengine-secrets \\\n  --from-literal=HYPHA_TOKEN=${tokenValue}${rayAuthLine} \\\n  --dry-run=client -o yaml \\\n  | kubectl apply -f - -n ${ns}`;
  };

  const getK8sApplyCommand = () => {
    const ns = k8sNamespace || 'bioengine';
    return `kubectl apply -f bioengine-deployment.yaml -n ${ns}`;
  };

  const getDockerLoginCommand = () => 'docker login';

  const getDockerBuildCommand = () => {
    const rv = rayVersion || '<ray-version>';
    const user = dockerHubUsername || '<your-dockerhub-username>';
    return `BIOENGINE_VERSION=${DEFAULT_IMAGE_VERSION}
RAY_VERSION=${rv}
DOCKERHUB_USERNAME=${user}

docker build \\
  --build-arg BIOENGINE_IMAGE=ghcr.io/aicell-lab/bioengine-worker:\${BIOENGINE_VERSION} \\
  --build-arg RAY_VERSION=\${RAY_VERSION} \\
  -t \${DOCKERHUB_USERNAME}/bioengine-worker:\${BIOENGINE_VERSION}-ray\${RAY_VERSION} \\
  - <<'DOCKERFILE'
ARG BIOENGINE_IMAGE
FROM \${BIOENGINE_IMAGE}
ARG RAY_VERSION
RUN pip install --no-cache-dir "ray[client,serve]==\${RAY_VERSION}"
ENV BIOENGINE_RAY_VERSION=\${RAY_VERSION}
DOCKERFILE`;
  };

  const getDockerPushCommand = () => {
    const rv = rayVersion || '<ray-version>';
    return `docker push \${DOCKERHUB_USERNAME}/bioengine-worker:${DEFAULT_IMAGE_VERSION}-ray${rv}`;
  };

  const getKubernetesWorkerYaml = () => {
    const serverUrlVal = serverUrl || HYPHA_SERVER_URL;
    const workspaceVal = workspace || '<your-hypha-workspace>';
    const rayAddr = rayAddress || 'ray://raycluster-kuberay-head-svc.ray-cluster.svc.cluster.local';
    const ns = k8sNamespace || 'bioengine';

    const arg = (flag: string, value: string) => `\n        - "${flag}"\n        - "${value}"`;
    // For nargs="+" CLI flags like --admin-users: emit the flag once followed
    // by each value as its own YAML list item. Repeating the flag instead
    // would only keep the last value (argparse behavior).
    const multiValueArg = (flag: string, values: string[]) =>
      `\n        - "${flag}"` +
      values.map(v => `\n        - "${v}"`).join('');

    let extraArgs = '';
    if (workspaceDir) extraArgs += arg('--workspace-dir', workspaceDir);
    if (rayWorkspaceDir) extraArgs += arg('--ray-workspace-dir', rayWorkspaceDir);
    if (clientServerPort && clientServerPort !== '10001') extraArgs += arg('--client-server-port', clientServerPort);

    if (adminUsers.length > 0) {
      extraArgs += multiValueArg('--admin-users', adminUsers);
    }
    if (workerName) extraArgs += arg('--worker-name', workerName);

    // RAY_AUTH_TOKEN + RAY_AUTH_MODE — only emit when the user provided a
    // Ray Cluster Auth Token. Otherwise the env vars stay unset and Ray
    // Client / proxy actor make unauthenticated requests, which is the
    // correct default for KubeRay clusters without Bearer-auth on the
    // dashboard/client port.
    const rayAuthEnv = rayAuthToken
      ? `
        - name: RAY_AUTH_TOKEN
          valueFrom:
            secretKeyRef:
              name: bioengine-secrets
              key: RAY_AUTH_TOKEN
        - name: RAY_AUTH_MODE
          value: token`
      : '';

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
        image: ${customImage || (rayVersion ? `${dockerHubUsername || '<your-dockerhub-username>'}/bioengine-worker:${DEFAULT_IMAGE_VERSION}-ray${rayVersion}` : DEFAULT_IMAGE)}
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
              key: HYPHA_TOKEN${rayAuthEnv}
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
        <form className="mt-4 space-y-6" autoComplete="off" onSubmit={(e) => e.preventDefault()}>

          {/* ── Audience toggle: small segmented control, no explainer (the rest of the form explains itself) ── */}
          <div className="flex justify-center -mb-2">
            <div className="inline-flex items-center bg-gray-100 rounded-lg p-1" role="tablist" aria-label="Audience">
              {(['human', 'agent'] as const).map(value => {
                const selected = audience === value;
                return (
                  <button
                    key={value}
                    type="button"
                    role="tab"
                    aria-selected={selected}
                    onClick={() => setAudience(value)}
                    className={`px-4 py-1.5 text-sm font-medium rounded-md transition-colors ${
                      selected
                        ? 'bg-white text-gray-900 shadow-sm'
                        : 'text-gray-600 hover:text-gray-900'
                    }`}
                  >
                    {value === 'human' ? 'Human' : 'AI Agent'}
                  </button>
                );
              })}
            </div>
          </div>

          {/* ── AI Agent mode: blue intro + grey copy-able prompt with optional admin-token injection ── */}
          {audience === 'agent' && (() => {
            const skillUrl = 'https://bioimage.io/skills/bioengine/SKILL.md';
            const basePrompt = `Read ${skillUrl} and follow the instructions to set up a BioEngine worker. Ask me about my environment and any required information as we go.`;
            const promptText = (includeAgentToken && token)
              ? `${basePrompt}\n\nUse this Hypha admin token for my workspace:\n${token}`
              : basePrompt;
            return (
              <div className="space-y-4">
                <div className="p-5 bg-blue-50 rounded-xl border border-blue-200">
                  <h4 className="text-base font-semibold text-blue-900 mb-2">Set up your worker with an AI agent</h4>
                  <p className="text-sm text-blue-800">
                    Copy the prompt below into your AI agent (Claude Code, Codex, Gemini CLI, and so on). It will load the BioEngine skill, ask you about your environment, then guide you through the deployment and a readiness test.
                  </p>
                </div>

                <div className="p-4 bg-gray-50 rounded-xl border border-gray-200">
                  <div className="flex items-center justify-between mb-2">
                    <h5 className="text-sm font-semibold text-gray-800">Setup BioEngine Worker</h5>
                    <button
                      type="button"
                      onClick={async () => {
                        try {
                          await navigator.clipboard.writeText(promptText);
                          setAgentPromptCopied(true);
                          setTimeout(() => setAgentPromptCopied(false), 2000);
                        } catch (_) { /* ignore */ }
                      }}
                      className="flex items-center px-2 py-1 text-xs text-gray-600 bg-white border border-gray-200 rounded hover:bg-gray-100 transition-colors"
                    >
                      {agentPromptCopied ? (
                        <><svg className="w-3 h-3 mr-1" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" /></svg>Copied!</>
                      ) : (
                        <><svg className="w-3 h-3 mr-1" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" /></svg>Copy</>
                      )}
                    </button>
                  </div>
                  <p className="text-xs text-gray-700 mb-3">Paste this into your AI agent.</p>
                  <pre className="bg-white border border-gray-200 rounded p-3 text-xs font-mono text-gray-800 whitespace-pre-wrap break-words">{promptText}</pre>
                  <label className={`flex items-start mt-3 ${isLoggedIn ? 'cursor-pointer' : 'cursor-not-allowed opacity-60'}`}>
                    <input
                      type="checkbox"
                      disabled={!isLoggedIn}
                      checked={includeAgentToken && isLoggedIn}
                      onChange={(e) => setIncludeAgentToken(e.target.checked)}
                      className="mt-0.5 w-4 h-4 text-blue-600 border-gray-300 rounded"
                    />
                    <span className="ml-2 text-sm text-gray-700">
                      Include an admin Hypha token for my workspace in the prompt
                      {!isLoggedIn && <span className="text-gray-500"> (log in to enable)</span>}
                      {isLoggedIn && isGeneratingToken && <span className="text-gray-500"> (generating token...)</span>}
                    </span>
                  </label>
                </div>
              </div>
            );
          })()}

          {/* ── Human mode: full configurator ── */}
          {audience === 'human' && (<>

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
                { value: 'single-machine', label: '💻 Desktop/Workstation', desc: 'Run locally on your computer or workstation using Docker. Perfect for development or small-scale analysis.', badge: 'Easy Setup', color: 'purple', disabled: false },
                { value: 'slurm', label: '🖥️ HPC Cluster', desc: 'Deploy on a high-performance computing cluster with SLURM job scheduler. Ideal for large-scale workloads.', badge: 'SLURM', color: 'purple', disabled: false },
                { value: 'external-cluster', label: '☸️ Kubernetes Cluster', desc: 'Deploy on Kubernetes with KubeRay. Connect BioEngine to an existing Ray cluster for cloud-native deployment.', badge: 'Cloud Native', color: 'purple', disabled: false },
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
                    <span className="inline-block px-2 py-1 text-xs bg-purple-100 text-purple-700 rounded">{badge}</span>
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* ── Kubernetes setup ── */}
          {mode === 'external-cluster' && (
            <div className="space-y-4 border-t border-gray-200 pt-4">

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
                        BioEngine apps run on Ray nodes and write to the Ray Workspace Directory. For apps that communicate through the filesystem (e.g. <code className="bg-blue-100 px-1 rounded">bioimage-io/model-runner</code>), scaling to multiple replicas requires a shared volume across all Ray nodes. Otherwise only reduced functionality is available.
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
                    <span className="text-blue-700">. Worker logs will otherwise be lost when the pod restarts.</span>
                  </p>
                </div>
              </div>

              {/* Standard configuration fields */}
              <div className="p-4 bg-gray-50 rounded-xl border border-gray-200">
                <h5 className="text-sm font-semibold text-gray-700 mb-3">Configuration</h5>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div className="md:col-span-2">
                    <label className="block text-sm font-medium text-gray-700 mb-1">Worker Name</label>
                    <input type="text" value={workerName} onChange={(e) => setWorkerName(e.target.value)}
                      placeholder="BioEngine Worker"
                      className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500" />
                    <p className="text-xs text-gray-500 mt-1">Display name for this worker in the Hypha service registry.</p>
                  </div>

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
              <div className="pt-2 pb-2">  
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
                      <TagInput
                        tags={adminUsers}
                        onChange={setAdminUsers}
                        placeholder="user@example.com"
                        allowWildcard={false}
                      />
                      <p className="text-xs text-gray-500 mt-1">Users who can deploy and manage apps on this worker. Press Space or Enter to add.</p>
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
                        placeholder={isLoggedIn ? (isGeneratingToken ? 'Generating…' : 'Auto-generated; paste to override') : 'Paste your Hypha token'}
                        autoComplete="new-password"
                        className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                      />
                      {tokenError && <p className="text-xs text-red-600 mt-1">{tokenError}</p>}
                      {isLoggedIn && !tokenIsManual && token && (
                        <p className="text-xs text-green-600 mt-1">Auto-generated 30-day admin token. Regenerate when it expires using the button above.</p>
                      )}
                      <p className="text-xs text-gray-500 mt-1">Used to resolve workspace and populate the deployment YAML. Store in a Kubernetes secret for production.</p>
                    </div>

                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">Server URL</label>
                      <input type="text" value={serverUrl} onChange={(e) => setServerUrl(e.target.value)}
                        placeholder={HYPHA_SERVER_URL}
                        className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500" />
                      <p className="text-xs text-gray-500 mt-1">Hypha server URL. Leave empty to use {HYPHA_SERVER_URL}.</p>
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
                        autoComplete="off"
                        className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500" />
                      <p className="text-xs text-gray-500 mt-1">Hypha workspace for service registration. Resolved from the token if left empty.</p>
                    </div>

                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">Container Image</label>
                      <input type="text" value={customImage} onChange={(e) => setCustomImage(e.target.value)}
                        placeholder={DEFAULT_IMAGE}
                        className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500" />
                      <p className="text-xs text-gray-500 mt-1">Container image used to run the BioEngine worker. Leave empty to use {DEFAULT_IMAGE}.</p>
                    </div>

                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">Ray Version</label>
                      <input type="text" value={rayVersion} onChange={(e) => setRayVersion(e.target.value)}
                        placeholder={DEFAULT_RAY_VERSION}
                        className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500" />
                      <p className="text-xs text-gray-500 mt-1">
                        Override the Ray version baked into the BioEngine image. Must satisfy <code className="bg-gray-100 px-1 rounded">&ge;2.33.0, &lt;3.0.0</code>.
                      </p>
                    </div>

                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">Ray Client Server Port</label>
                      <input type="number" value={clientServerPort} onChange={(e) => setClientServerPort(e.target.value)}
                        placeholder="10001"
                        className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500" />
                      <p className="text-xs text-gray-500 mt-1">Port exposed by the Ray head service</p>
                    </div>

                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">Ray Cluster Auth Token</label>
                      <input
                        type="password"
                        value={rayAuthToken}
                        onChange={(e) => setRayAuthToken(e.target.value)}
                        placeholder="Only for Bearer-auth Ray clusters"
                        autoComplete="new-password"
                        className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                      />
                      <p className="text-xs text-gray-500 mt-1">
                        Required when the Ray cluster is protected by a Bearer-auth proxy. Stored in the
                        <code className="bg-gray-100 px-1 rounded mx-1">bioengine-secrets</code> Secret as
                        <code className="bg-gray-100 px-1 rounded mx-1">RAY_AUTH_TOKEN</code>.
                      </p>
                    </div>
                  </div>
                )}
              </div>

              {/* Build & push a custom image (only when a non-default Ray version is requested) */}
              {rayVersion && (
                <div className="space-y-4 border-t border-gray-200 pt-4">
                  <h5 className="text-sm font-semibold text-gray-700">Build & push a custom BioEngine image (Ray {rayVersion})</h5>
                  <p className="text-xs text-gray-600">
                    The public image bundles Ray {DEFAULT_RAY_VERSION}. To use a different Ray release, build a thin overlay image and push it to your Docker Hub account. <strong>You do not need to clone the BioEngine repo</strong>; the entire Dockerfile is embedded inline below via a heredoc. Fill in <strong>Docker Hub Username</strong> below to auto-populate every step and the deployment YAML; otherwise replace <code className="bg-gray-100 px-1 rounded">&lt;your-dockerhub-username&gt;</code> manually. Once pushed, continue with "Deploy to Kubernetes".
                  </p>

                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">Docker Hub Username</label>
                    <input type="text" value={dockerHubUsername} onChange={(e) => setDockerHubUsername(e.target.value)}
                      placeholder="<your-dockerhub-username>"
                      className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500" />
                    <p className="text-xs text-gray-500 mt-1">Registry namespace for your custom image; filled into the build script, push command, and deployment YAML below.</p>
                  </div>

                  {/* Step 1: docker login */}
                  <div>
                    <div className="flex items-center justify-between mb-1">
                      <p className="text-sm text-gray-700 font-medium">1. Log in to Docker Hub</p>
                      <button
                        onClick={async () => {
                          try { await navigator.clipboard.writeText(getDockerLoginCommand()); setK8sLoginCopied(true); setTimeout(() => setK8sLoginCopied(false), 2000); } catch (_) {}
                        }}
                        className="flex items-center px-2 py-1 text-xs text-gray-600 bg-gray-100 border border-gray-200 rounded hover:bg-gray-200 transition-colors"
                      >
                        {k8sLoginCopied ? (
                          <><svg className="w-3 h-3 mr-1" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" /></svg>Copied!</>
                        ) : (
                          <><svg className="w-3 h-3 mr-1" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" /></svg>Copy</>
                        )}
                      </button>
                    </div>
                    <div className="bg-gray-900 rounded-lg p-3 overflow-x-auto">
                      <pre className="text-green-400 text-xs font-mono whitespace-pre">{getDockerLoginCommand()}</pre>
                    </div>
                    <p className="text-xs text-gray-500 mt-1">
                      You'll be prompted for your Docker Hub username and a personal access token. Create a token at <a href="https://hub.docker.com/settings/security" target="_blank" rel="noopener noreferrer" className="text-blue-600 underline">hub.docker.com/settings/security</a>.
                    </p>
                  </div>

                  {/* Step 2: docker build */}
                  <div>
                    <div className="flex items-center justify-between mb-1">
                      <p className="text-sm text-gray-700 font-medium">2. Build the overlay image</p>
                      <button
                        onClick={async () => {
                          try { await navigator.clipboard.writeText(getDockerBuildCommand()); setK8sBuildCopied(true); setTimeout(() => setK8sBuildCopied(false), 2000); } catch (_) {}
                        }}
                        className="flex items-center px-2 py-1 text-xs text-gray-600 bg-gray-100 border border-gray-200 rounded hover:bg-gray-200 transition-colors"
                      >
                        {k8sBuildCopied ? (
                          <><svg className="w-3 h-3 mr-1" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" /></svg>Copied!</>
                        ) : (
                          <><svg className="w-3 h-3 mr-1" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" /></svg>Copy</>
                        )}
                      </button>
                    </div>
                    <div className="bg-gray-900 rounded-lg p-3">
                      <pre className="text-green-400 text-xs font-mono overflow-x-auto max-h-72 overflow-y-auto whitespace-pre">{getDockerBuildCommand()}</pre>
                    </div>
                    <p className="text-xs text-gray-500 mt-1">
                      Builds <code className="bg-gray-100 px-1 rounded">{dockerHubUsername || '<your-dockerhub-username>'}/bioengine-worker:{DEFAULT_IMAGE_VERSION}-ray{rayVersion}</code> on top of the published BioEngine image, swapping only the Ray pin. Edit <code className="bg-gray-100 px-1 rounded">BIOENGINE_VERSION</code> at the top to use a different BioEngine release as the base.
                    </p>
                  </div>

                  {/* Step 3: docker push */}
                  <div>
                    <div className="flex items-center justify-between mb-1">
                      <p className="text-sm text-gray-700 font-medium">3. Push to Docker Hub</p>
                      <button
                        onClick={async () => {
                          try { await navigator.clipboard.writeText(getDockerPushCommand()); setK8sPushCopied(true); setTimeout(() => setK8sPushCopied(false), 2000); } catch (_) {}
                        }}
                        className="flex items-center px-2 py-1 text-xs text-gray-600 bg-gray-100 border border-gray-200 rounded hover:bg-gray-200 transition-colors"
                      >
                        {k8sPushCopied ? (
                          <><svg className="w-3 h-3 mr-1" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" /></svg>Copied!</>
                        ) : (
                          <><svg className="w-3 h-3 mr-1" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" /></svg>Copy</>
                        )}
                      </button>
                    </div>
                    <div className="bg-gray-900 rounded-lg p-3 overflow-x-auto">
                      <pre className="text-green-400 text-xs font-mono whitespace-pre">{getDockerPushCommand()}</pre>
                    </div>
                    <p className="text-xs text-gray-500 mt-1">
                      {dockerHubUsername
                        ? <>The deployment YAML below already references this image.</>
                        : <>Uses <code className="bg-gray-100 px-1 rounded">$&#123;DOCKERHUB_USERNAME&#125;</code> from step 2; make sure you set it there. Fill in <strong>Docker Hub Username</strong> above to auto-populate both step 2 and the YAML below.</>}
                    </p>
                  </div>
                </div>
              )}

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
                <>
                  <div className="p-4 bg-blue-50 rounded-xl border border-blue-200">
                    <p className="text-sm font-semibold text-blue-800 mb-1">HPC Cluster Setup</p>
                    <p className="text-sm text-blue-700">
                      Run BioEngine on an HPC cluster managed by SLURM. The head node runs on the login node inside an Apptainer/Singularity container and submits SLURM jobs to scale Ray workers up and down on demand. Please report issues and feedback on <a href="https://github.com/aicell-lab/bioengine/issues" target="_blank" rel="noopener noreferrer" className="underline font-medium hover:text-blue-900">GitHub</a>.
                    </p>
                  </div>

                  {/* Cluster requirements */}
                  <div className="p-4 bg-orange-50 rounded-xl border border-orange-200">
                    <p className="text-sm font-semibold text-orange-800 mb-1">Cluster requirements</p>
                    <ul className="text-sm text-orange-700 list-disc list-inside space-y-1">
                      <li>Run from a <strong>login node</strong> with <code className="bg-orange-100 px-1 rounded">sbatch</code>, <code className="bg-orange-100 px-1 rounded">squeue</code>, <code className="bg-orange-100 px-1 rounded">scancel</code>, and <code className="bg-orange-100 px-1 rounded">sinfo</code> available.</li>
                      <li><strong>Apptainer</strong> or <strong>Singularity</strong> available on both login and compute nodes.</li>
                      <li>The BioEngine workspace directory must live on a <strong>shared filesystem</strong> visible to every compute node (e.g. <code className="bg-orange-100 px-1 rounded">/proj/...</code> or <code className="bg-orange-100 px-1 rounded">/home/...</code> on most clusters).</li>
                      <li>Your SLURM account/project must have <strong>sufficient allocation</strong> for the requested GPUs and time.</li>
                    </ul>
                  </div>

                  {/* Workspace directory info */}
                  <div className="p-4 bg-blue-50 rounded-xl border border-blue-200">
                    <div className="flex items-start">
                      <svg className="w-4 h-4 text-blue-500 mr-2 mt-0.5 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                      </svg>
                      <p className="text-sm text-blue-800">
                        <span className="font-medium">BioEngine Workspace Directory: </span>
                        <code className="bg-blue-100 px-1 rounded">{workspaceDir || '$HOME/.bioengine'}</code>
                        <span className="text-blue-700 text-xs block mt-1">Created on the login node, mounted into the head and worker containers. Stores apps, logs, the Apptainer image cache, and Ray temporary files. Must be on a filesystem shared between login and compute nodes. Change it in Advanced Options below.</span>
                      </p>
                    </div>
                  </div>
                </>
              )}

              {/* SLURM compute defaults & cluster knobs */}
              {mode === 'slurm' && (
                <div className="p-4 bg-gray-50 rounded-xl border border-gray-200">
                  <h5 className="text-sm font-semibold text-gray-700 mb-3">Worker Defaults & Cluster Configuration</h5>
                  <p className="text-xs text-gray-500 mb-3">Defaults used when BioEngine submits a SLURM job to start a new Ray worker. Individual deployments can override these per-app.</p>
                  <div className="mb-4">
                    <label className="block text-sm font-medium text-gray-700 mb-1">Worker Name</label>
                    <input type="text" value={workerName} onChange={(e) => setWorkerName(e.target.value)}
                      placeholder="BioEngine Worker"
                      className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500" />
                    <p className="text-xs text-gray-500 mt-1">Display name for this worker in the Hypha service registry.</p>
                  </div>
                  <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">CPU Cores per Worker</label>
                      <input type="number" min="1" max="128" value={slurmDefaultNumCpus}
                        onChange={(e) => setSlurmDefaultNumCpus(parseInt(e.target.value) || 1)}
                        className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500" />
                      <p className="text-xs text-gray-500 mt-1">Requested with <code className="bg-gray-100 px-1 rounded">--cpus-per-task</code> per worker</p>
                    </div>

                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">GPUs per Worker</label>
                      <input type="number" min="0" max="16" value={slurmDefaultNumGpus}
                        onChange={(e) => setSlurmDefaultNumGpus(parseInt(e.target.value) || 0)}
                        className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500" />
                      <p className="text-xs text-gray-500 mt-1">Set to 0 for CPU-only worker jobs</p>
                    </div>

                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">Memory per CPU (GB)</label>
                      <input type="number" min="1" max="128" value={slurmDefaultMemPerCpu}
                        onChange={(e) => setSlurmDefaultMemPerCpu(parseInt(e.target.value) || 1)}
                        className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500" />
                      <p className="text-xs text-gray-500 mt-1">Total RAM = CPUs × this value</p>
                    </div>

                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">Worker Time Limit</label>
                      <input type="text" value={slurmDefaultTimeLimit}
                        onChange={(e) => setSlurmDefaultTimeLimit(e.target.value)}
                        placeholder="4:00:00"
                        className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500" />
                      <p className="text-xs text-gray-500 mt-1">SLURM <code className="bg-gray-100 px-1 rounded">--time</code> format <code className="bg-gray-100 px-1 rounded">HH:MM:SS</code></p>
                    </div>

                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">Max Workers</label>
                      <input type="number" min="1" max="64"
                        value={slurmMaxWorkers}
                        onChange={(e) => setSlurmMaxWorkers(e.target.value === '' ? '' : Math.max(1, parseInt(e.target.value) || 1))}
                        placeholder="10"
                        className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500" />
                      <p className="text-xs text-gray-500 mt-1">Upper bound on concurrent Ray worker jobs.</p>
                    </div>

                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">GPU sbatch directive</label>
                      <select value={slurmGpuFlag} onChange={(e) => setSlurmGpuFlag(e.target.value)}
                        className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500">
                        <option value="--gpus={n}">--gpus=&#123;n&#125;</option>
                        <option value="--gres=gpu:{n}">--gres=gpu:&#123;n&#125;</option>
                        <option value="">(omit; use a custom flag in Further SLURM Args)</option>
                      </select>
                      <p className="text-xs text-gray-500 mt-1">How GPUs are requested in <code className="bg-gray-100 px-1 rounded">sbatch</code>. Use gres if your cluster requires it.</p>
                    </div>
                  </div>

                </div>
              )}

              {/* Runtime / compute settings */}
              {mode === 'single-machine' && (
                <div className="p-4 bg-gray-50 rounded-xl border border-gray-200">
                  <h5 className="text-sm font-semibold text-gray-700 mb-3">Container & Compute</h5>
                  <div className="mb-4">
                    <label className="block text-sm font-medium text-gray-700 mb-1">Worker Name</label>
                    <input type="text" value={workerName} onChange={(e) => setWorkerName(e.target.value)}
                      placeholder="BioEngine Worker"
                      className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500" />
                    <p className="text-xs text-gray-500 mt-1">Display name for this worker in the Hypha service registry.</p>
                  </div>
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
            <div>
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
                    <TagInput
                      tags={adminUsers}
                      onChange={setAdminUsers}
                      placeholder="user@example.com"
                      allowWildcard={false}
                    />
                    <p className="text-xs text-gray-500 mt-1">Users who can deploy and manage apps on this worker. Press Space or Enter to add.</p>
                  </div>

                  {/* ── BioEngine data directory ── */}
                  <div>
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
                      placeholder={isLoggedIn ? (isGeneratingToken ? 'Generating…' : 'Auto-generated; paste to override') : 'Paste your Hypha token'}
                      autoComplete="new-password"
                      className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                    />
                    {tokenError && <p className="text-xs text-red-600 mt-1">{tokenError}</p>}
                    {isLoggedIn && !tokenIsManual && token && (
                      <p className="text-xs text-green-600 mt-1">Auto-generated 30-day admin token. Regenerate when it expires using the button above.</p>
                    )}
                    <p className="text-xs text-gray-500 mt-1">
                      Required. Manually provided tokens must have <strong>Permission Level: Admin</strong>.
                    </p>
                  </div>

                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">Server URL</label>
                    <input type="text" value={serverUrl} onChange={(e) => setServerUrl(e.target.value)}
                      placeholder={HYPHA_SERVER_URL}
                      className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500" />
                    <p className="text-xs text-gray-500 mt-1">Hypha server URL. Leave empty to use {HYPHA_SERVER_URL}.</p>
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
                      autoComplete="off"
                      className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500" />
                    <p className="text-xs text-gray-500 mt-1">Hypha workspace name for service registration. Resolved from the token if left empty.</p>
                  </div>

                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">Client ID</label>
                    <input type="text" value={clientId} onChange={(e) => setClientId(e.target.value)}
                      className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500" />
                    <p className="text-xs text-gray-500 mt-1">Auto-generated by BioEngine if left empty.</p>
                  </div>

                  {/* ── GPU indices ── */}
                  {mode === 'single-machine' && gpus > 0 && (
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">GPU Indices</label>
                      <input type="text" value={gpuIndices} onChange={(e) => setGpuIndices(e.target.value)}
                        className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500" />
                      <p className="text-xs text-gray-500 mt-1">CUDA_VISIBLE_DEVICES: comma-separated GPU indices (e.g. 0,1). Leave empty to use all GPUs.</p>
                    </div>
                  )}

                  {/* ── Container / runtime ── */}
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">Container Image</label>
                    <input type="text" value={customImage} onChange={(e) => setCustomImage(e.target.value)}
                      placeholder={DEFAULT_IMAGE}
                      className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500" />
                    <p className="text-xs text-gray-500 mt-1">Container image used to run the BioEngine worker. Leave empty to use {DEFAULT_IMAGE}.</p>
                  </div>

                  {mode === 'single-machine' && (
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">Platform Override</label>
                      <select value={platformOverride} onChange={(e) => setPlatformOverride(e.target.value)}
                        className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500">
                        <option value="">Auto-detect</option>
                        <option value="linux/amd64">linux/amd64</option>
                        <option value="linux/arm64">linux/arm64</option>
                      </select>
                      <p className="text-xs text-gray-500 mt-1">Override platform only if auto-detection is wrong.</p>
                    </div>
                  )}

                  {/* ── SLURM-specific advanced fields ── */}
                  {mode === 'slurm' && (
                    <>
                      <div className="md:col-span-2">
                        <label className="block text-sm font-medium text-gray-700 mb-1">Worker Workspace Directory</label>
                        <input type="text" value={slurmWorkerWorkspaceDir}
                          onChange={(e) => setSlurmWorkerWorkspaceDir(e.target.value)}
                          placeholder={workspaceDir || '$HOME/.bioengine'}
                          className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500" />
                        <p className="text-xs text-gray-500 mt-1">Path used inside worker containers. Override only when compute nodes see the workspace under a different path.</p>
                      </div>

                      <div className="md:col-span-2">
                        <label className="block text-sm font-medium text-gray-700 mb-1">Further SLURM Args</label>
                        <input type="text" value={slurmFurtherArgs}
                          onChange={(e) => setSlurmFurtherArgs(e.target.value)}
                          placeholder='--account=<your-project> --partition=gpu'
                          className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 font-mono text-sm" />
                        <p className="text-xs text-gray-500 mt-1">Extra <code className="bg-gray-100 px-1 rounded">sbatch</code> directives appended to every worker job, as a single shell-style string (e.g. <code className="bg-gray-100 px-1 rounded">--account=...</code>, <code className="bg-gray-100 px-1 rounded">--partition=...</code>, <code className="bg-gray-100 px-1 rounded">-C thin</code>, <code className="bg-gray-100 px-1 rounded">--qos=...</code>).</p>
                      </div>

                      <div className="md:col-span-2">
                        <label className="block text-sm font-medium text-gray-700 mb-1">Further Apptainer Args</label>
                        <input type="text" value={slurmApptainerArgs}
                          onChange={(e) => setSlurmApptainerArgs(e.target.value)}
                          placeholder="--bind /path/on/host:/path/in/container"
                          className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 font-mono text-sm" />
                        <p className="text-xs text-gray-500 mt-1">Extra flags forwarded to <code className="bg-gray-100 px-1 rounded">apptainer exec</code> inside each worker job, as a single shell-style string. Common use: extra <code className="bg-gray-100 px-1 rounded">--bind</code> mounts.</p>
                      </div>
                    </>
                  )}

                </div>
              )}
            </div>
          )}

          {/* ── Generated command (SLURM step-by-step) ── */}
          {mode === 'slurm' && (
            <div className="space-y-3 border-t border-gray-200 pt-4">
              {/* Step 1: Create workspace directory */}
              <div>
                <div className="flex items-center justify-between mb-1">
                  <p className="text-sm text-gray-700 font-medium">1. Create the BioEngine workspace directory (shared filesystem)</p>
                  <button
                    onClick={async () => {
                      const command = getCommand();
                      if (typeof command !== 'string' && 'scriptCmd' in command) {
                        try { await navigator.clipboard.writeText(command.createDirCmd); setCopiedSlurmStep1(true); setTimeout(() => setCopiedSlurmStep1(false), 2000); } catch (_) {}
                      }
                    }}
                    className="flex items-center px-2 py-1 text-xs text-gray-600 bg-gray-100 border border-gray-200 rounded hover:bg-gray-200 transition-colors"
                  >
                    {copiedSlurmStep1 ? (
                      <><svg className="w-3 h-3 mr-1" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" /></svg>Copied!</>
                    ) : (
                      <><svg className="w-3 h-3 mr-1" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" /></svg>Copy</>
                    )}
                  </button>
                </div>
                <div className="bg-gray-900 rounded-lg p-3 overflow-x-auto">
                  <pre className="text-green-400 text-xs font-mono whitespace-pre">
                    {(() => { const command = getCommand(); return typeof command !== 'string' && 'scriptCmd' in command ? command.createDirCmd : ''; })()}
                  </pre>
                </div>
              </div>

              {/* Step 2: Export Hypha token */}
              <div>
                <div className="flex items-center justify-between mb-1">
                  <p className="text-sm text-gray-700 font-medium">2. Set your Hypha authentication token</p>
                  <button
                    onClick={async () => {
                      const command = getCommand();
                      if (typeof command !== 'string' && 'scriptCmd' in command) {
                        try { await navigator.clipboard.writeText(command.tokenExportCmd); setCopiedSlurmStep2(true); setTimeout(() => setCopiedSlurmStep2(false), 2000); } catch (_) {}
                      }
                    }}
                    className="flex items-center px-2 py-1 text-xs text-gray-600 bg-gray-100 border border-gray-200 rounded hover:bg-gray-200 transition-colors"
                  >
                    {copiedSlurmStep2 ? (
                      <><svg className="w-3 h-3 mr-1" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" /></svg>Copied!</>
                    ) : (
                      <><svg className="w-3 h-3 mr-1" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" /></svg>Copy</>
                    )}
                  </button>
                </div>
                <div className="bg-gray-900 rounded-lg p-3 overflow-x-auto">
                  <pre className="text-green-400 text-xs font-mono whitespace-pre">
                    {(() => { const command = getCommand(); return typeof command !== 'string' && 'scriptCmd' in command ? command.tokenExportCmd : ''; })()}
                  </pre>
                </div>
                <p className="text-xs text-gray-500 mt-1">
                  The startup script picks up <code className="bg-gray-100 px-1 rounded">HYPHA_TOKEN</code> from the environment (or from a <code className="bg-gray-100 px-1 rounded">.env</code> file in the current directory). Prefer this over baking the token into the command itself so it doesn't end up in your shell history.
                </p>
              </div>

              {/* Step 3: Run the SLURM script */}
              <div>
                <div className="flex items-center justify-between mb-1">
                  <p className="text-sm text-gray-700 font-medium">3. Launch the BioEngine worker on SLURM</p>
                  <button
                    onClick={async () => {
                      const command = getCommand();
                      if (typeof command !== 'string' && 'scriptCmd' in command) {
                        try { await navigator.clipboard.writeText(command.scriptCmd); setCopiedSlurmStep3(true); setTimeout(() => setCopiedSlurmStep3(false), 2000); } catch (_) {}
                      }
                    }}
                    className="flex items-center px-2 py-1 text-xs text-gray-600 bg-gray-100 border border-gray-200 rounded hover:bg-gray-200 transition-colors"
                  >
                    {copiedSlurmStep3 ? (
                      <><svg className="w-3 h-3 mr-1" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" /></svg>Copied!</>
                    ) : (
                      <><svg className="w-3 h-3 mr-1" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" /></svg>Copy</>
                    )}
                  </button>
                </div>
                <div className="bg-gray-900 rounded-lg p-3 overflow-x-auto">
                  <pre className="text-green-400 text-xs font-mono whitespace-pre">
                    {(() => { const command = getCommand(); return typeof command !== 'string' && 'scriptCmd' in command ? command.scriptCmd : ''; })()}
                  </pre>
                </div>
                <p className="text-xs text-gray-500 mt-1">
                  Run in a persistent shell (<code className="bg-gray-100 px-1 rounded">tmux</code> or <code className="bg-gray-100 px-1 rounded">screen</code>) so the head node survives ssh disconnects. Pressing <code className="bg-gray-100 px-1 rounded">Ctrl+C</code> stops the worker and cancels any pending Ray worker jobs.
                </p>
              </div>

              <div className="flex justify-end">
                <button onClick={copyToClipboard}
                  className="px-3 py-1 bg-blue-600 hover:bg-blue-700 text-white text-xs rounded-lg flex items-center">
                  {copied ? (
                    <><svg className="w-3 h-3 mr-1" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" /></svg>Copied all steps!</>
                  ) : (
                    <><svg className="w-3 h-3 mr-1" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" /></svg>Copy all three steps</>
                  )}
                </button>
              </div>
            </div>
          )}

          {mode === 'single-machine' && (
            <div className="space-y-3 border-t border-gray-200 pt-4">
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
                      if (typeof command !== 'string' && 'dockerCmd' in command) {
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
                    {(() => { const command = getCommand(); return typeof command !== 'string' && 'dockerCmd' in command ? command.dockerCmd : ''; })()}
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
            <div className="p-4 bg-blue-50 rounded-xl border border-blue-200">
              <div className="flex items-start">
                <svg className="w-5 h-5 text-blue-600 mr-2 mt-0.5 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10" />
                </svg>
                <div className="text-sm text-blue-800">
                  <p className="font-medium mb-2">🖥️ SLURM Cluster Mode</p>
                  <div className="text-blue-700 space-y-1">
                    <p>The startup script downloads the BioEngine container, starts the Ray head inside <code className="bg-blue-100 px-1 rounded">apptainer</code> on the login node, and submits SLURM jobs for Ray workers on demand. Workers idle out automatically when nothing is deployed.</p>
                    <div className="mt-2 p-3 bg-blue-100 rounded-lg">
                      <p className="font-medium text-blue-900 mb-1">💡 Tips:</p>
                      <ul className="list-disc list-inside space-y-1 text-blue-800 text-xs">
                        <li>Run the script inside <code className="bg-blue-200 px-1 rounded">tmux</code> or <code className="bg-blue-200 px-1 rounded">screen</code> so the head survives ssh disconnects.</li>
                        <li>Monitor active jobs: <code className="bg-blue-200 px-1 rounded">squeue -u $USER -n ray_worker</code>.</li>
                        <li>Stop everything: <code className="bg-blue-200 px-1 rounded">Ctrl+C</code> in the script window. Pending Ray workers are auto-cancelled on cleanup.</li>
                        <li>The first launch will pull the Apptainer image (~1 GB) into <code className="bg-blue-200 px-1 rounded">$WORKSPACE_DIR/images</code>. Subsequent runs are fast.</li>
                        <li>After the script reports the worker is registered, open the dashboard at <a href="https://bioimage.io/#/bioengine" target="_blank" rel="noopener noreferrer" className="underline font-medium hover:text-blue-900">bioimage.io/#/bioengine</a>.</li>
                      </ul>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          )}


          </>)}
          {/* end human mode */}

          {/* ── GitHub link (visible in both human and agent modes) ── */}
          <div className="flex justify-center pt-4 border-t border-gray-200">
            <a
              href="https://github.com/aicell-lab/bioengine"
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center gap-2 text-sm text-gray-600 hover:text-gray-900 transition-colors"
            >
              <svg className="w-5 h-5" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
                <path d="M12 .297c-6.63 0-12 5.373-12 12 0 5.303 3.438 9.8 8.205 11.385.6.113.82-.258.82-.577 0-.285-.01-1.04-.015-2.04-3.338.724-4.042-1.61-4.042-1.61C4.422 18.07 3.633 17.7 3.633 17.7c-1.087-.744.084-.729.084-.729 1.205.084 1.838 1.236 1.838 1.236 1.07 1.835 2.809 1.305 3.495.998.108-.776.417-1.305.76-1.605-2.665-.3-5.466-1.332-5.466-5.93 0-1.31.465-2.38 1.235-3.22-.135-.303-.54-1.523.105-3.176 0 0 1.005-.322 3.3 1.23.96-.267 1.98-.4 3-.405 1.02.005 2.04.138 3 .405 2.28-1.552 3.285-1.23 3.285-1.23.645 1.653.24 2.873.12 3.176.765.84 1.23 1.91 1.23 3.22 0 4.61-2.805 5.625-5.475 5.92.42.36.81 1.096.81 2.22 0 1.606-.015 2.896-.015 3.286 0 .315.21.69.825.57C20.565 22.092 24 17.592 24 12.297c0-6.627-5.373-12-12-12" />
              </svg>
              <span>aicell-lab/bioengine on GitHub</span>
            </a>
          </div>
        </form>
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
              <h3 className="text-base font-semibold text-gray-800">Ray Workspace Directory: Why It Matters</h3>
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
                In Kubernetes mode the actual BioEngine apps execute on <strong>Ray cluster nodes</strong>, not inside the worker pod. Those nodes need their own writable directory, set with <code className="bg-gray-100 px-1 rounded">--ray-workspace-dir</code>. If this flag is not set, the worker falls back to the same path as <code className="bg-gray-100 px-1 rounded">--workspace-dir</code>, which only works if the Ray nodes can also reach that path.
              </p>
              <div className="p-3 bg-amber-50 border border-amber-200 rounded-lg">
                <p className="font-medium text-amber-800 mb-1">Impact on scaling</p>
                <p className="text-amber-700">
                  Some apps, like <code className="bg-amber-100 px-1 rounded">bioimage-io/model-runner</code>, communicate between the worker and Ray nodes through the filesystem. Without a shared <strong>ReadWriteMany</strong> PVC mounted at the same path on all Ray nodes, running more than one app replica will result in reduced functionality: only the replica on the node that holds the file will work correctly.
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
