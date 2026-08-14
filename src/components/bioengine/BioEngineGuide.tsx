import React, { useState, useRef, useEffect, useCallback } from 'react';
import { hyphaWebsocketClient } from 'hypha-rpc';
import { useHyphaStore } from '../../store/hyphaStore';
import { HYPHA_SERVER_URL } from '../../config/hypha';
import DeploymentConfigModal from './DeploymentConfigModal';
import BioEngineGitHubLink from './BioEngineGitHubLink';
import InfoPopover from './InfoPopover';

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

const DEFAULT_IMAGE_VERSION = '0.16.1';
const DEFAULT_IMAGE = `ghcr.io/aicell-lab/bioengine-worker:${DEFAULT_IMAGE_VERSION}`;
const DEFAULT_RAY_VERSION = '2.55.1';

// One entry of --startup-applications. `config` is the payload the shared deploy
// dialog emits (the deploy_app kwargs), or null while the box is still unconfigured.
interface StartupApplication {
  uid: string;
  config: Record<string, any> | null;
}

// Keys the deploy dialog always emits at the worker's own default. Dropping them
// keeps the generated command readable without changing what gets deployed.
const STARTUP_APP_DEFAULTS: Record<string, any> = {
  disable_gpu: false,
  auto_redeploy: false,
  debug: false,
  max_ongoing_requests: 10,
};

const startupAppJson = (config: Record<string, any>): string => {
  const payload: Record<string, any> = {};
  Object.entries(config).forEach(([key, value]) => {
    if (value === null || value === undefined || value === '') return;
    if (STARTUP_APP_DEFAULTS[key] === value) return;
    if (Array.isArray(value) && value.length === 0) return;
    if (!Array.isArray(value) && typeof value === 'object' && Object.keys(value).length === 0) return;
    payload[key] = value;
  });
  return JSON.stringify(payload);
};

// Missing artifact_id => nothing to deploy, so the entry is left out of the command.
// A missing application_id is not a problem: the worker generates one.
const getStartupAppWarnings = (config: Record<string, any> | null): string[] => {
  const warnings: string[] = [];
  if (!config?.artifact_id) {
    warnings.push('No Artifact ID set. There is nothing to deploy, so this entry is left out of the generated command until you set one.');
  }
  return warnings;
};

// Slim one-line summary of a configured startup application: application ID,
// artifact ID and version only. Everything else stays behind the settings dialog.
const StartupApplicationRow: React.FC<{
  config: Record<string, any> | null;
  onOpenSettings: () => void;
  onRemove: () => void;
}> = ({ config, onOpenSettings, onRemove }) => {
  const applicationId = (config?.application_id || '').trim();
  const artifactId = (config?.artifact_id || '').trim();
  const version = (config?.version || '').trim();
  const warnings = getStartupAppWarnings(config);
  const hasWarning = warnings.length > 0;

  return (
    <div
      className={`flex items-center gap-2 px-3 py-2 rounded-lg border ${
        hasWarning ? 'border-amber-300 bg-amber-50' : 'border-gray-200 bg-white'
      }`}
    >
      {hasWarning && (
        <span className="relative group flex-shrink-0">
          <button
            type="button"
            aria-label="Incomplete startup application"
            className="flex items-center text-amber-600 focus:outline-none focus:ring-2 focus:ring-amber-400 rounded"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-2.5L13.732 4c-.77-.833-1.964-.833-2.732 0L4.082 16.5c-.77.833.192 2.5 1.732 2.5z" />
            </svg>
          </button>
          <span
            role="tooltip"
            className="pointer-events-none absolute left-0 top-6 z-20 hidden group-hover:block group-focus-within:block w-72 p-2 rounded-lg bg-gray-900 text-white text-xs shadow-lg"
          >
            {warnings.map((warning, i) => (
              <span key={i} className="block first:mt-0 mt-1.5">{warning}</span>
            ))}
          </span>
        </span>
      )}

      <div className="flex-1 min-w-0 flex flex-wrap items-center gap-x-2 gap-y-1">
        {applicationId
          ? <span className="text-sm font-medium text-gray-800 truncate">{applicationId}</span>
          : <span className="text-sm text-gray-500 italic">Auto-generated ID</span>}
        <span className="text-gray-300" aria-hidden="true">|</span>
        {artifactId
          ? <code className="text-xs bg-gray-100 text-gray-700 px-1.5 py-0.5 rounded truncate">{artifactId}</code>
          : <span className="text-sm text-amber-700 italic">No artifact ID</span>}
        <span className="text-gray-300" aria-hidden="true">|</span>
        <span className="text-xs text-gray-500">{version || 'latest version'}</span>
      </div>

      <button
        type="button"
        onClick={onOpenSettings}
        className="flex items-center flex-shrink-0 px-2 py-1 text-xs text-gray-600 bg-white border border-gray-200 rounded hover:bg-gray-100 transition-colors"
      >
        <svg className="w-3.5 h-3.5 mr-1" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
        </svg>
        Settings
      </button>

      <button
        type="button"
        onClick={onRemove}
        aria-label="Remove startup application"
        className="flex-shrink-0 p-1 text-gray-400 rounded hover:text-red-600 hover:bg-red-50 transition-colors"
      >
        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
        </svg>
      </button>
    </div>
  );
};

const BioEngineGuide: React.FC<{ onScrollToWorkers?: () => void }> = ({ onScrollToWorkers }) => {
  const { server, isLoggedIn, user } = useHyphaStore();
  const [os, setOS] = useState<OSType>('macos');
  const [mode, setMode] = useState<ModeType>('single-machine');
  // Top-level audience toggle: humans get the full configurator below;
  // agents get a compact panel that hands off to the BioEngine SKILL.md.
  const [audience, setAudience] = useState<'human' | 'agent'>('human');
  const [agentPromptCopied, setAgentPromptCopied] = useState(false);
  const [includeAgentToken, setIncludeAgentToken] = useState(false);
  const [containerRuntime, setContainerRuntime] = useState<ContainerRuntimeType>('docker');
  const [cpus, setCpus] = useState(4);
  const [gpus, setGpus] = useState(1);
  const [memory, setMemory] = useState(24);
  const [copiedStep1, setCopiedStep1] = useState(false);
  const [copiedStep2, setCopiedStep2] = useState(false);
  const [showAdvanced, setShowAdvanced] = useState(false);

  // Main settings
  const [token, setToken] = useState('');
  const [tokenIsManual, setTokenIsManual] = useState(false);
  const [isGeneratingToken, setIsGeneratingToken] = useState(false);
  const [tokenError, setTokenError] = useState<string | null>(null);

  // Startup applications (--startup-applications)
  const [startupApps, setStartupApps] = useState<StartupApplication[]>([]);
  const [editingStartupUid, setEditingStartupUid] = useState<string | null>(null);
  const startupUidCounter = useRef(0);

  // Advanced options
  const [workspace, setWorkspace] = useState('');
  const [serverUrl, setServerUrl] = useState('');
  const [rayAddress, setRayAddress] = useState('');
  const [adminUsers, setAdminUsers] = useState<string[]>([]);
  const [workerName, setWorkerName] = useState('');
  const [workspaceDir, setWorkspaceDir] = useState('');
  const [shmSizeGb, setShmSizeGb] = useState(8);
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

  // Token lifetime follows how the token is stored. Container and SLURM commands
  // carry it on the command line, where it is only needed until the worker
  // connects and starts renewing its own token, so one hour is enough. The
  // Kubernetes manifest stores it in a long-lived Secret that has to survive pod
  // restarts, so that one keeps the 30-day lifetime. The agent prompt is also
  // short-lived: the agent only needs it while it walks through the setup.
  const wantsLongLivedToken = audience === 'human' && mode === 'external-cluster';
  const tokenLifetimeSeconds = wantsLongLivedToken ? 30 * 24 * 3600 : 3600;
  const tokenLifetimeLabel = wantsLongLivedToken ? '30 days' : '1 hour';
  const tokenLifetimeAdjective = wantsLongLivedToken ? '30-day' : '1-hour';
  const generatedTokenLifetime = useRef<number | null>(null);

  // Auto-generate token when user is logged in and no manual token is set
  const generateToken = useCallback(async () => {
    if (!isLoggedIn || !server) return;
    setIsGeneratingToken(true);
    setTokenError(null);
    try {
      const generatedToken = await server.generateToken({ permission: 'admin', expires_in: tokenLifetimeSeconds });
      setToken(generatedToken);
      setTokenIsManual(false);
      generatedTokenLifetime.current = tokenLifetimeSeconds;
    } catch (err) {
      setTokenError(`Failed to generate token: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setIsGeneratingToken(false);
    }
  }, [isLoggedIn, server, tokenLifetimeSeconds]);

  useEffect(() => {
    if (isLoggedIn && !tokenIsManual && !token) {
      generateToken();
    }
  }, [isLoggedIn, tokenIsManual, token, generateToken]);

  // Switching mode changes the lifetime the token should have, so reissue the
  // auto-generated one. A pasted token is left alone.
  useEffect(() => {
    if (!isLoggedIn || tokenIsManual || !token) return;
    if (generatedTokenLifetime.current !== null && generatedTokenLifetime.current !== tokenLifetimeSeconds) {
      generateToken();
    }
  }, [tokenLifetimeSeconds, isLoggedIn, tokenIsManual, token, generateToken]);

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

  const addStartupApp = () => {
    startupUidCounter.current += 1;
    const uid = `startup-app-${startupUidCounter.current}`;
    setStartupApps(prev => [...prev, { uid, config: null }]);
    // Open the settings dialog straight away: a new box is empty, and an empty
    // box is exactly the state the row warns about.
    setEditingStartupUid(uid);
  };

  const removeStartupApp = (uid: string) => {
    setStartupApps(prev => prev.filter(app => app.uid !== uid));
    setEditingStartupUid(current => (current === uid ? null : current));
  };

  const saveStartupApp = (uid: string, config: Record<string, any>) => {
    setStartupApps(prev => prev.map(app => (app.uid === uid ? { ...app, config } : app)));
  };

  const editingStartupApp = startupApps.find(app => app.uid === editingStartupUid) || null;

  // Entries without an artifact ID have nothing to deploy, so they never reach the
  // generated command. The row itself carries the warning that explains why.
  const deployableStartupApps = startupApps
    .map(app => app.config)
    .filter((config): config is Record<string, any> => Boolean(config?.artifact_id));

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

    // --startup-applications takes one JSON object per app (argparse nargs="+").
    // SLURM always runs through bash, so only the container command on Windows
    // needs the escaped double-quote form instead of single quotes.
    if (deployableStartupApps.length > 0) {
      const useWindowsQuoting = os === 'windows' && mode !== 'slurm';
      const quoted = deployableStartupApps.map(config => {
        const json = startupAppJson(config);
        return useWindowsQuoting
          ? `"${json.replace(/"/g, '\\"')}"`
          : `'${json.replace(/'/g, `'\\''`)}'`;
      });
      args.push(`--startup-applications ${quoted.join(' ')}`);
    }

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
      // No separate HYPHA_TOKEN export step: the token is already on the script's
      // command line, and start_hpc_worker.sh forwards it to the worker.
      return { createDirCmd, scriptCmd };
    }

    const platform = getPlatform();
    const userFlag = getUserFlag();
    const gpuFlag = getGpuFlag();
    const shmFlag = (containerRuntime === 'apptainer' || containerRuntime === 'singularity') ? '' : `--shm-size=${shmSizeGb}g `;
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

    // Startup-app configs are JSON, so they go in single-quoted YAML scalars
    // (a double-quoted scalar would need every inner quote escaped).
    if (deployableStartupApps.length > 0) {
      extraArgs += `\n        - "--startup-applications"`;
      extraArgs += deployableStartupApps
        .map(config => `\n        - '${startupAppJson(config).replace(/'/g, "''")}'`)
        .join('');
    }

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

  // Rendered between the standard configuration fields and the advanced options,
  // in both the Kubernetes and the container/SLURM branch of the configurator.
  const startupApplicationsSection = (
    <div className="p-4 bg-gray-50 rounded-xl border border-gray-200">
      <h5 className="text-sm font-semibold text-gray-700">Startup Applications</h5>
      <p className="text-xs text-gray-500 mt-1 mb-3">
        Applications the worker deploys automatically every time it starts. Each one is configured with the same dialog as the Deploy button on the BioEngine dashboard.
      </p>

      <div className="space-y-2">
        {startupApps.map(app => (
          <StartupApplicationRow
            key={app.uid}
            config={app.config}
            onOpenSettings={() => setEditingStartupUid(app.uid)}
            onRemove={() => removeStartupApp(app.uid)}
          />
        ))}

        <button
          type="button"
          onClick={addStartupApp}
          className="w-full flex items-center justify-center px-3 py-2 text-sm font-medium text-gray-600 bg-white border border-dashed border-gray-300 rounded-lg hover:border-blue-400 hover:text-blue-600 transition-colors"
        >
          <svg className="w-4 h-4 mr-1.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
          </svg>
          Add startup application
        </button>
      </div>
    </div>
  );

  return (
    <div>
      <form className="space-y-6" autoComplete="off" onSubmit={(e) => e.preventDefault()}>

          {/* ── Audience toggle: small segmented control, no explainer (the rest of the form explains itself) ── */}
          <div className="flex justify-center -mb-2">
            <div className="inline-flex items-center bg-gray-100 rounded-lg p-1" role="tablist" aria-label="Audience">
              {(['human', 'agent'] as const).map(value => {
                const selected = audience === value;
                const isAgent = value === 'agent';
                return (
                  <button
                    key={value}
                    type="button"
                    role="tab"
                    aria-selected={selected}
                    onClick={() => setAudience(value)}
                    // The agent tab keeps a light blue tint while unselected so the
                    // "let an agent do this" route is noticed rather than looking
                    // like the inactive half of a plain toggle.
                    className={`flex items-center justify-center gap-1.5 min-w-[7rem] px-4 py-1.5 text-sm font-medium rounded-md transition-colors ${
                      selected
                        ? 'bg-white shadow-sm ' + (isAgent ? 'text-blue-700' : 'text-gray-900')
                        : isAgent
                          ? 'text-blue-600 bg-blue-50 hover:bg-blue-100'
                          : 'text-gray-600 hover:text-gray-900'
                    }`}
                  >
                    {isAgent && (
                      <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 3v4M3 5h4M6 17v4m-2-2h4m5-16l2.286 6.857L21 12l-5.714 2.143L13 21l-2.286-6.857L5 12l5.714-2.143L13 3z" />
                      </svg>
                    )}
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
              ? `${basePrompt}\n\nUse this Hypha admin token for my workspace (valid for 1 hour, ask me to generate a new one if it has expired):\n${token}`
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
                      Include an admin Hypha token for my workspace in the prompt (valid for 1 hour)
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
              <div className="bg-gradient-to-r from-blue-50 to-purple-50 p-4 rounded-xl border border-blue-200">
                <p className="text-sm font-semibold text-gray-800 mb-1">Getting started on Kubernetes clusters</p>
                <p className="text-sm text-gray-700">
                  This mode connects the BioEngine worker to a Ray cluster already running on Kubernetes.
                  If you don't have one yet, follow the{' '}
                  <a
                    href="https://docs.ray.io/en/latest/cluster/kubernetes/getting-started/raycluster-quick-start.html"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="underline font-medium hover:text-blue-900"
                  >
                    KubeRay Quick Start Guide
                  </a>.
                </p>
                <p className="text-sm text-gray-700 mt-3">
                  <strong>Recommended:</strong> mount a shared <strong>ReadWriteMany</strong> PVC (e.g. NFS, <code className="bg-white/60 px-1 rounded">ontap-nas</code>) at the same path on all Ray head and worker nodes, and set that path as the <strong>Ray Workspace Directory</strong> below. BioEngine apps execute on Ray cluster nodes, not inside the worker pod. Some apps, like <code className="bg-white/60 px-1 rounded">bioimage-io/model-runner</code>, split work across multiple deployments that Ray Serve can place on different nodes, so without a shared volume they can't see each other's files and inference fails, even with a single running instance.
                </p>
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
                    <p className="text-xs text-gray-500 mt-1">Mounts the PVC into the <strong>BioEngine worker pod</strong> at <code className="bg-gray-100 px-1 rounded">/home/bioengine</code> to persist worker logs. This can be a different PVC than the one on the Ray cluster nodes, for example if the Ray cluster runs in a different namespace.</p>
                    {!hasPvc && (
                      <div className="mt-3 p-3 bg-blue-50 rounded-lg border border-blue-200">
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
                    )}
                  </div>
                </div>
              </div>

              {/* Startup applications */}
              {startupApplicationsSection}

              {/* Advanced options */}
              <div className="p-4 bg-gray-50 rounded-xl border border-gray-200">
                <button
                  type="button"
                  onClick={() => setShowAdvanced(!showAdvanced)}
                  className="w-full flex items-center justify-between text-left"
                  aria-expanded={showAdvanced}
                >
                  <h5 className="text-sm font-semibold text-gray-700">Advanced Options</h5>
                  <svg className={`w-4 h-4 text-gray-400 transition-transform duration-200 ${showAdvanced ? 'rotate-180' : ''}`}
                    fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                  </svg>
                </button>

                {showAdvanced && (
                  <div className="mt-3 grid grid-cols-1 md:grid-cols-2 gap-4">
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
                            Regenerate ({tokenLifetimeLabel})
                          </button>
                        )}
                      </div>
                      <input
                        type="password"
                        value={token}
                        onChange={(e) => { setToken(e.target.value); setTokenIsManual(true); }}
                        placeholder={isLoggedIn ? (isGeneratingToken ? 'Generating…' : 'Auto-generated, paste to override') : 'Paste your Hypha token'}
                        autoComplete="new-password"
                        className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                      />
                      {tokenError && <p className="text-xs text-red-600 mt-1">{tokenError}</p>}
                      {isLoggedIn && !tokenIsManual && token && (
                        <p className="text-xs text-green-600 mt-1">Auto-generated {tokenLifetimeAdjective} admin token. Regenerate when it expires using the button above.</p>
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
                              <li><strong>Log in</strong> to auto-generate a {tokenLifetimeAdjective} admin token, or</li>
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
                    <p className="text-xs text-gray-500 mt-1">Registry namespace for your custom image, filled into the build script, push command, and deployment YAML below.</p>
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

                {/* Step 4: view dashboard */}
                <div>
                  <p className="text-sm text-gray-700 font-medium">4. View your worker's dashboard</p>
                  <p className="text-xs text-gray-500 mt-1">
                    Once the worker pod is running, scroll up and click{' '}
                    <button type="button" onClick={() => onScrollToWorkers?.()} className="font-semibold text-blue-600 hover:text-blue-800 underline">View BioEngine Workers</button>{' '}
                    to open its dashboard.
                  </p>
                </div>
              </div>
            </div>
          )}

          {/* ── Single-machine and SLURM settings ── */}
          {mode !== 'external-cluster' && (
            <div className="space-y-4">

              {/* SLURM info */}
              {mode === 'slurm' && (
                <>
                  <div className="bg-gradient-to-r from-blue-50 to-purple-50 p-4 rounded-xl border border-blue-200">
                    <p className="text-sm font-semibold text-gray-800 mb-1">Getting started on HPC clusters</p>
                    <p className="text-sm text-gray-700">
                      Run BioEngine on an HPC cluster managed by SLURM. The head node runs on the login node inside an Apptainer/Singularity container and submits SLURM jobs to scale Ray workers up and down on demand. Please report issues and feedback on <a href="https://github.com/aicell-lab/bioengine/issues" target="_blank" rel="noopener noreferrer" className="underline font-medium hover:text-blue-900">GitHub</a>.
                    </p>
                    <p className="text-sm font-medium text-gray-800 mt-3 mb-1">Cluster requirements</p>
                    <ul className="text-sm text-gray-700 list-disc list-inside space-y-1">
                      <li>Run from a <strong>login node</strong> with <code className="bg-white/60 px-1 rounded">sbatch</code>, <code className="bg-white/60 px-1 rounded">squeue</code>, <code className="bg-white/60 px-1 rounded">scancel</code>, and <code className="bg-white/60 px-1 rounded">sinfo</code> available.</li>
                      <li><strong>Apptainer</strong> or <strong>Singularity</strong> available on both login and compute nodes.</li>
                      <li>The BioEngine workspace directory must live on a <strong>shared filesystem</strong> visible to every compute node (e.g. <code className="bg-white/60 px-1 rounded">/proj/...</code> or <code className="bg-white/60 px-1 rounded">/home/...</code> on most clusters).</li>
                      <li>Your SLURM account/project must have <strong>sufficient allocation</strong> for the requested GPUs and time.</li>
                      <li>The latest image is <strong>~1.1 GB</strong> and is pulled automatically on the first worker job.</li>
                    </ul>
                    <p className="text-sm font-medium text-gray-800 mt-3 mb-1">Tips</p>
                    <ul className="text-sm text-gray-700 list-disc list-inside space-y-1">
                      <li>Run the script inside <code className="bg-white/60 px-1 rounded">tmux</code> or <code className="bg-white/60 px-1 rounded">screen</code> so the head survives ssh disconnects.</li>
                      <li>Monitor active jobs: <code className="bg-white/60 px-1 rounded">squeue -u $USER -n ray_worker</code>.</li>
                      <li>Stop everything: <code className="bg-white/60 px-1 rounded">Ctrl+C</code> in the script window. Pending Ray workers are auto-cancelled on cleanup.</li>
                    </ul>
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
                      <div className="flex items-center gap-1 mb-1">
                        <label className="block text-sm font-medium text-gray-700">Container Runtime</label>
                        <InfoPopover label="Container runtime info">
                          BioEngine runs inside a container. Make sure the selected container runtime is installed on this machine. The latest image is ~1.1 GB and will be pulled automatically on first run.
                        </InfoPopover>
                      </div>
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
                      {(containerRuntime === 'apptainer' || containerRuntime === 'singularity') ? null : (
                        <>
                          <div className="flex items-center gap-1 mb-1">
                            <label className="block text-sm font-medium text-gray-700">Shared Memory Size (GB)</label>
                            <InfoPopover label="Shared memory size info">
                              Ray's object store lives in <code className="bg-gray-100 px-1 rounded">/dev/shm</code>, which Docker and Podman default to just 64 MB, too small for Ray. This sets that limit. Independent of the Workspace Directory mount below, which is for persistent files on the host.
                            </InfoPopover>
                          </div>
                          <input type="number" min="1" max="256" value={shmSizeGb}
                            onChange={(e) => setShmSizeGb(parseInt(e.target.value) || 1)}
                            className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500" />
                          <p className="text-xs text-gray-500 mt-1">
                            Size of /dev/shm for Ray's object store.
                          </p>
                        </>
                      )}
                    </div>

                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">CPU Cores</label>
                      <input type="number" min="1" max="64" value={cpus}
                        onChange={(e) => setCpus(parseInt(e.target.value) || 1)}
                        className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500" />
                      <p className="text-xs text-gray-500 mt-1">CPUs allocated to Ray head node</p>
                    </div>

                    <div>
                      <div className="flex items-center gap-1 mb-1">
                        <label className="block text-sm font-medium text-gray-700">GPUs</label>
                        <InfoPopover label="GPU info">
                          <strong>GPU support</strong> requires the <strong>NVIDIA Container Toolkit</strong> to be installed on the host. See the <a href="https://docs.nvidia.com/datacenter/cloud-native/container-toolkit/latest/install-guide.html" target="_blank" rel="noopener noreferrer" className="underline hover:text-blue-900">installation guide</a>.
                        </InfoPopover>
                      </div>
                      <input type="number" min="0" max="16" value={gpus}
                        onChange={(e) => setGpus(parseInt(e.target.value) || 0)}
                        className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500" />
                      <p className="text-xs text-gray-500 mt-1">
                        {gpus > 0 ? `Requires NVIDIA ${containerRuntime === 'docker' ? 'Docker runtime' : containerRuntime === 'podman' ? 'container toolkit' : `drivers (--nv flag)`}` : 'CPU-only mode, no GPU access'}
                      </p>
                    </div>

                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">Memory (GB)</label>
                      <input type="number" min="0" max="512" value={memory}
                        onChange={(e) => setMemory(parseInt(e.target.value) || 0)}
                        className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500" />
                      <p className="text-xs text-gray-500 mt-1">Total RAM available to Ray on this machine (0 = auto-detect).</p>
                    </div>
                  </div>
                </div>
              )}
            </div>
          )}

          {/* ── Startup applications ── */}
          {mode !== 'external-cluster' && startupApplicationsSection}

          {/* ── Advanced options ── */}
          {mode !== 'external-cluster' && (
            <div className="p-4 bg-gray-50 rounded-xl border border-gray-200">
              <button
                type="button"
                onClick={() => setShowAdvanced(!showAdvanced)}
                className="w-full flex items-center justify-between text-left"
                aria-expanded={showAdvanced}
              >
                <h5 className="text-sm font-semibold text-gray-700">Advanced Options</h5>
                <svg className={`w-4 h-4 text-gray-400 transition-transform duration-200 ${showAdvanced ? 'rotate-180' : ''}`}
                  fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                </svg>
              </button>

              {showAdvanced && (
                <div className="mt-3 grid grid-cols-1 md:grid-cols-2 gap-4">

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
                          Regenerate ({tokenLifetimeLabel})
                        </button>
                      )}
                    </div>
                    <input
                      type="password"
                      value={token}
                      onChange={(e) => { setToken(e.target.value); setTokenIsManual(true); }}
                      placeholder={isLoggedIn ? (isGeneratingToken ? 'Generating…' : 'Auto-generated, paste to override') : 'Paste your Hypha token'}
                      autoComplete="new-password"
                      className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                    />
                    {tokenError && <p className="text-xs text-red-600 mt-1">{tokenError}</p>}
                    {isLoggedIn && !tokenIsManual && token && (
                      <p className="text-xs text-green-600 mt-1">Auto-generated {tokenLifetimeAdjective} admin token. Regenerate when it expires using the button above.</p>
                    )}
                    <p className="text-xs text-gray-500 mt-1">
                      Required. Manually provided tokens must have <strong>Permission Level: Admin</strong>. The short lifetime only has to cover the initial connection: from then on the worker renews its own token. Generate a fresh one here if you start the worker again later.
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

          {/* ── Authentication Required warning when no token ── */}
          {mode !== 'external-cluster' && !token && (
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
                          <li><strong>Log in</strong> to auto-generate a {tokenLifetimeAdjective} admin token, or</li>
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
                <p className="text-xs text-gray-500 mt-1">
                  <code className="bg-gray-100 px-1 rounded">{workspaceDir || '$HOME/.bioengine'}</code> is created on the login node and mounted into the head and worker containers. Stores apps, logs, the Apptainer image cache, and Ray temporary files. Must be on a filesystem shared between login and compute nodes.
                </p>
              </div>

              {/* Step 2: Run the SLURM script */}
              <div>
                <div className="flex items-center justify-between mb-1">
                  <p className="text-sm text-gray-700 font-medium">2. Launch the BioEngine worker on SLURM</p>
                  <button
                    onClick={async () => {
                      const command = getCommand();
                      if (typeof command !== 'string' && 'scriptCmd' in command) {
                        try { await navigator.clipboard.writeText(command.scriptCmd); setCopiedSlurmStep2(true); setTimeout(() => setCopiedSlurmStep2(false), 2000); } catch (_) {}
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
                    {(() => { const command = getCommand(); return typeof command !== 'string' && 'scriptCmd' in command ? command.scriptCmd : ''; })()}
                  </pre>
                </div>
                <p className="text-xs text-gray-500 mt-1">
                  Run in a persistent shell (<code className="bg-gray-100 px-1 rounded">tmux</code> or <code className="bg-gray-100 px-1 rounded">screen</code>) so the head node survives ssh disconnects. Pressing <code className="bg-gray-100 px-1 rounded">Ctrl+C</code> stops the worker and cancels any pending Ray worker jobs.
                </p>
              </div>

              {/* Step 3: view dashboard */}
              <div>
                <p className="text-sm text-gray-700 font-medium">3. View your worker's dashboard</p>
                <p className="text-xs text-gray-500 mt-1">
                  Once the worker is running, scroll up and click{' '}
                  <button type="button" onClick={() => onScrollToWorkers?.()} className="font-semibold text-blue-600 hover:text-blue-800 underline">View BioEngine Workers</button>{' '}
                  to open its dashboard.
                </p>
              </div>
            </div>
          )}

          {mode === 'single-machine' && (
            <div className="space-y-3 border-t border-gray-200 pt-4">
              {/* Step 1: Create directories */}
              <div>
                <div className="flex items-center justify-between mb-1">
                  <p className="text-sm text-gray-700 font-medium">1. Create the BioEngine workspace directory</p>
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
                <p className="text-xs text-gray-500 mt-1">
                  <code className="bg-gray-100 px-1 rounded">{workspaceDir || (os === 'windows' ? '%USERPROFILE%\\.bioengine' : '$HOME/.bioengine')}</code> is mounted into the container. Stores apps, logs, and temporary files.
                </p>
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

              {/* Step 3: view dashboard */}
              <div>
                <p className="text-sm text-gray-700 font-medium">3. View your worker's dashboard</p>
                <p className="text-xs text-gray-500 mt-1">
                  Once the worker is running, scroll up and click{' '}
                  <button type="button" onClick={() => onScrollToWorkers?.()} className="font-semibold text-blue-600 hover:text-blue-800 underline">View BioEngine Workers</button>{' '}
                  to open its dashboard.
                </p>
              </div>
            </div>
          )}


          </>)}
          {/* end human mode */}

          {/* ── Need help (visible in both human and agent modes) ── */}
          <div className="pt-4 flex justify-center">
            <button
              type="button"
              onClick={() => { setAudience('agent'); window.scrollTo({ top: 0, behavior: 'smooth' }); }}
              className="text-sm text-blue-600 hover:text-blue-800 font-medium underline"
            >
              Need help? Let an AI agent set it up
            </button>
          </div>

          {/* ── Links (visible in both human and agent modes) ── */}
          <div className="mt-4 pt-4 border-t border-gray-200 flex items-center justify-center gap-6 flex-wrap">
            <BioEngineGitHubLink />
            <a
              href="https://github.com/aicell-lab/bioengine/issues"
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center gap-2 text-sm text-gray-600 hover:text-gray-900 transition-colors"
            >
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
              <span>Report an issue</span>
            </a>
          </div>
        </form>


      {/* Startup application settings: the dashboard's deploy dialog, with an
          editable artifact ID since no artifact card was clicked to pick one. */}
      {editingStartupApp && (
        <DeploymentConfigModal
          isOpen={true}
          onClose={() => setEditingStartupUid(null)}
          onDeploy={(config) => saveStartupApp(editingStartupApp.uid, config)}
          artifactId={editingStartupApp.config?.artifact_id || ''}
          initialMode={null}
          initialConfig={editingStartupApp.config}
          editableArtifactId
          title="Startup Application"
          submitLabel="Save"
        />
      )}
    </div>
  );
};

export default BioEngineGuide;
