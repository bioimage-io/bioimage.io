import React, { useEffect, useMemo, useRef, useState } from 'react';
import ErrorDialog from './ErrorDialog';

interface AppDeploymentsStatusDialogProps {
  isOpen: boolean;
  onClose: () => void;
  applicationId: string;
  initialStatus?: any;
  fetchApplicationStatus: (params: {
    application_ids?: string[];
    logs_tail?: number;
    n_previous_replica?: number;
  }) => Promise<any>;
  // {node_id -> "Head Node (short_hex)" | "Worker Node N (short_hex)"} +
  // {"__role__:<node_id>" -> "Head Node" | "Worker Node N"}.
  // Numbering matches the cluster-resources view's worker numbering.
  nodeLabels?: Record<string, string>;
  // When present + bioengine_version >= 0.11.6 the dialog renders an inline
  // scaling editor that calls deploy_app({application_id, artifact_id,
  // scaling}) to roll new replica counts. Omitted when the parent doesn't
  // know how to perform the update (read-only contexts).
  updateAppScaling?: (params: {
    application_id: string;
    artifact_id: string;
    scaling: Record<string, any>;
  }) => Promise<void>;
  bioengineVersion?: string;
  // Worker undeploy / cancel-deployment handler. When present the dialog
  // renders an Undeploy button in the header (with an inline confirm step
  // to avoid accidental deletion). When omitted, undeploy is disabled —
  // e.g. for read-only viewers.
  onUndeploy?: (applicationId: string) => void;
  // True while the parent has a stop_app call in flight for this app —
  // used to show a spinner on the undeploy button and prevent re-clicks.
  isUndeploying?: boolean;
}

// Per-deployment form state. Two mutually-exclusive modes mirror the
// worker's scaling validator (manager.py:2086-2097): either a fixed
// num_replicas, or an autoscaling_config bag with min/max + the (optional)
// Ray Serve tuning knobs we expose. Storing both inactive sides lets the
// user toggle the switch without losing partially-entered values.
type DeploymentScalingState = {
  mode: 'fixed' | 'autoscale';
  num_replicas: number;
  min_replicas: number;
  max_replicas: number;
  target: number;
  upscale_delay_s: number | null;
  downscale_delay_s: number | null;
};

const DEFAULT_AUTOSCALE: Pick<
  DeploymentScalingState,
  'min_replicas' | 'max_replicas' | 'target' | 'upscale_delay_s' | 'downscale_delay_s'
> = {
  min_replicas: 1,
  max_replicas: 2,
  target: 2,
  upscale_delay_s: null,
  downscale_delay_s: null,
};

// Translate a scaling-map entry into the form's state shape. Missing
// entries default to a fixed 1 replica (matches Ray Serve's default and
// the worker's "classes not in the map run at 1 fixed replica" contract).
const entryToState = (entry?: any): DeploymentScalingState => {
  if (entry && typeof entry === 'object') {
    const ascRaw = entry.autoscaling_config;
    if (ascRaw && typeof ascRaw === 'object') {
      return {
        mode: 'autoscale',
        num_replicas: 1,
        min_replicas: typeof ascRaw.min_replicas === 'number' ? ascRaw.min_replicas : DEFAULT_AUTOSCALE.min_replicas,
        max_replicas: typeof ascRaw.max_replicas === 'number' ? ascRaw.max_replicas : DEFAULT_AUTOSCALE.max_replicas,
        target: typeof ascRaw.target_num_ongoing_requests_per_replica === 'number'
          ? ascRaw.target_num_ongoing_requests_per_replica
          : DEFAULT_AUTOSCALE.target,
        upscale_delay_s: typeof ascRaw.upscale_delay_s === 'number' ? ascRaw.upscale_delay_s : null,
        downscale_delay_s: typeof ascRaw.downscale_delay_s === 'number' ? ascRaw.downscale_delay_s : null,
      };
    }
    if (typeof entry.num_replicas === 'number') {
      return {
        mode: 'fixed',
        num_replicas: entry.num_replicas,
        ...DEFAULT_AUTOSCALE,
      };
    }
  }
  return { mode: 'fixed', num_replicas: 1, ...DEFAULT_AUTOSCALE };
};

// Translate a form state back into the wire shape the worker validates.
const stateToEntry = (state: DeploymentScalingState): Record<string, any> => {
  if (state.mode === 'fixed') {
    return { num_replicas: state.num_replicas };
  }
  const asc: Record<string, any> = {
    min_replicas: state.min_replicas,
    max_replicas: state.max_replicas,
    target_num_ongoing_requests_per_replica: state.target,
  };
  if (state.upscale_delay_s !== null && state.upscale_delay_s !== undefined) {
    asc.upscale_delay_s = state.upscale_delay_s;
  }
  if (state.downscale_delay_s !== null && state.downscale_delay_s !== undefined) {
    asc.downscale_delay_s = state.downscale_delay_s;
  }
  return { autoscaling_config: asc };
};

const meetsVersion = (actual: string | undefined, required: string): boolean => {
  if (!actual) return false;
  const parse = (v: string): number[] =>
    v
      .split('.')
      .map(part => parseInt(part.replace(/[^0-9].*$/, ''), 10))
      .map(n => (Number.isFinite(n) ? n : 0));
  const a = parse(actual);
  const r = parse(required);
  const len = Math.max(a.length, r.length);
  for (let i = 0; i < len; i += 1) {
    const av = a[i] ?? 0;
    const rv = r[i] ?? 0;
    if (av > rv) return true;
    if (av < rv) return false;
  }
  return true;
};

const AppDeploymentsStatusDialog: React.FC<AppDeploymentsStatusDialogProps> = ({
  isOpen,
  onClose,
  applicationId,
  initialStatus,
  fetchApplicationStatus,
  nodeLabels,
  updateAppScaling,
  bioengineVersion,
  onUndeploy,
  isUndeploying,
}) => {
  // Format a replica's node placement using the cluster-view-consistent
  // role label, plus the replica's own node_instance_id when available
  // (e.g. "Worker Node 2 (raycluster-kuberay-worker-workergroup-d7rwg)"),
  // falling back to the short hex prefix label from nodeLabels.
  const formatReplicaNode = (replica: any): string | null => {
    const nodeId: string | undefined = replica?.node_id;
    if (!nodeId) return null;
    const role = nodeLabels?.[`__role__:${nodeId}`];
    const instanceId: string | undefined = replica?.node_instance_id;
    if (role && instanceId && instanceId.trim()) return `${role} (${instanceId})`;
    if (nodeLabels?.[nodeId]) return nodeLabels[nodeId];
    if (instanceId && instanceId.trim()) return instanceId;
    return nodeId.slice(0, 8);
  };

  // Tailwind classes for the replica-state badge tint. Diagnostics use:
  // healthy/RUNNING reads cool (indigo), in-flight states read warm (amber),
  // terminal failure reads red, otherwise neutral gray. Unknown / empty
  // states fall through to neutral so the badge still renders.
  const stateClasses = (state?: string): string => {
    switch (state) {
      case 'RUNNING':
        return 'bg-indigo-50 text-indigo-700 border-indigo-200';
      case 'STARTING':
      case 'UPDATING':
      case 'PENDING_ALLOCATION':
      case 'RECOVERING':
        return 'bg-amber-50 text-amber-700 border-amber-200';
      case 'DEPLOY_FAILED':
      case 'FAILED':
        return 'bg-red-50 text-red-700 border-red-200';
      case 'STOPPING':
      case 'STOPPED':
        return 'bg-gray-100 text-gray-600 border-gray-300';
      default:
        return 'bg-gray-50 text-gray-600 border-gray-200';
    }
  };

  // Top-level status state. The dialog seeds from `initialStatus` (the app
  // status snapshot the parent already loaded), then refreshes on demand.
  // Per-deployment log refetches mutate the `deployments` slice of this
  // object so other deployments retain their last-loaded log buffer.
  const [status, setStatus] = useState<any>(initialStatus || null);
  const [loading, setLoading] = useState(false);
  const [hasLoaded, setHasLoaded] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Per-deployment "Log Lines" / "Previous Replicas" form values + an
  // in-flight refresh marker, keyed by deployment name. The dialog seeds
  // each block with the default (30 lines, 0 previous) on open. Each
  // block has its own Refresh button so users can drill into one
  // deployment's logs without disturbing the others' last-loaded buffer.
  // See the feature request to bioengine session 96b34abe for the
  // native per-deployment API ask that would let us drop the interim
  // "fetch-all-then-merge-one" workaround.
  type LogControls = { logsTail: number; nPrevious: number };
  const DEFAULT_LOG_CONTROLS: LogControls = { logsTail: 30, nPrevious: 0 };
  const [logControls, setLogControls] = useState<Record<string, LogControls>>({});
  const [refreshingDeployment, setRefreshingDeployment] = useState<string | null>(null);

  // Scaling form state: keyed by user @bioengine.app class name (i.e. the
  // keys of get_app_status().deployments minus ProxyDeployment). Persists
  // across status refreshes; resets when the dialog opens or the live
  // scaling map changes due to a successful Save.
  const [scalingForm, setScalingForm] = useState<Record<string, DeploymentScalingState>>({});
  const [scalingInitial, setScalingInitial] = useState<string>('{}');
  const [savingScaling, setSavingScaling] = useState<boolean>(false);
  const [scalingSubmitError, setScalingSubmitError] = useState<string | null>(null);
  const [scalingSubmitOk, setScalingSubmitOk] = useState<boolean>(false);
  const [advancedOpen, setAdvancedOpen] = useState<Record<string, boolean>>({});

  // Two-step undeploy confirm state. First click flips the button into
  // "Confirm undeploy" + a Cancel; second click fires the callback. The
  // confirm state auto-resets after a few seconds so the destructive
  // affordance doesn't sit armed indefinitely.
  const [undeployConfirm, setUndeployConfirm] = useState<boolean>(false);
  const undeployConfirmTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    setStatus(initialStatus || null);
  }, [initialStatus]);

  useEffect(() => () => {
    if (undeployConfirmTimer.current) clearTimeout(undeployConfirmTimer.current);
  }, []);

  const loadStatus = async () => {
    if (!applicationId) return;

    setLoading(true);
    setError(null);

    try {
      // Top-level Refresh uses the lowest-cost defaults (30 lines, 0
      // previous replicas). Per-deployment Refresh buttons handle the
      // high-volume cases independently below.
      const result = await fetchApplicationStatus({
        application_ids: [applicationId],
        logs_tail: DEFAULT_LOG_CONTROLS.logsTail,
        n_previous_replica: DEFAULT_LOG_CONTROLS.nPrevious,
      });
      setStatus(result);
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : String(err);
      setError(`Failed to load deployment status: ${errorMessage}`);
    } finally {
      setLoading(false);
      setHasLoaded(true);
    }
  };

  useEffect(() => {
    if (isOpen) {
      setHasLoaded(false);
      setUndeployConfirm(false);
      loadStatus();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen]);

  const deployments = useMemo(() => {
    const deploymentMap = status?.deployments;
    if (!deploymentMap || typeof deploymentMap !== 'object') {
      return [] as Array<{ name: string; data: any }>;
    }

    return Object.entries(deploymentMap).map(([name, data]) => ({
      name,
      data,
    }));
  }, [status]);

  // User-facing deployments (excludes ProxyDeployment, which always runs at
  // one fixed replica per app and is intentionally not addressable by the
  // scaling map — see bioengine/apps/manager.py:749-754 + 2068).
  const userDeployments = useMemo(
    () => deployments.filter(d => d.name !== 'ProxyDeployment'),
    [deployments],
  );

  // Seed the log-controls form with defaults the first time we see each
  // deployment name; preserve any values the user already typed.
  useEffect(() => {
    setLogControls(prev => {
      const next = { ...prev };
      let changed = false;
      for (const { name } of deployments) {
        if (!next[name]) {
          next[name] = { ...DEFAULT_LOG_CONTROLS };
          changed = true;
        }
      }
      return changed ? next : prev;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [deployments]);

  // Pending-replica detector. Either deployment status DEPLOYING (Ray
  // Serve is still reconciling) or a replica stuck in PENDING_ALLOCATION
  // (resource queue) means the user just submitted a change that exceeds
  // free cluster capacity. Surfaced as a banner so the user understands
  // why the live counts haven't moved yet.
  const hasPendingReplicas = useMemo(() => {
    for (const { data } of deployments) {
      const dStatus = String(data?.status ?? '').toUpperCase();
      if (dStatus === 'DEPLOYING' || dStatus === 'UPDATING') return true;
      const replicas = Array.isArray(data?.replicas) ? data.replicas : [];
      for (const r of replicas) {
        const rs = String(r?.state ?? '').toUpperCase();
        if (rs === 'PENDING_ALLOCATION') return true;
      }
    }
    return false;
  }, [deployments]);

  // Live scaling map from the worker. Always treated as authoritative —
  // form deltas overlay this on Save so deployments the user didn't touch
  // keep their existing values (Replacement semantics: passing
  // scaling={...} replaces the previous map, so omitting an entry would
  // accidentally reset that deployment to default).
  const liveScaling = useMemo<Record<string, any>>(() => {
    const raw = status?.scaling;
    if (!raw || typeof raw !== 'object') return {};
    const out: Record<string, any> = {};
    for (const [k, v] of Object.entries(raw)) {
      out[k] = v;
    }
    return out;
  }, [status]);

  // Re-seed the form whenever the dialog opens or the live scaling map
  // changes after a successful Save. We snapshot the JSON shape so the
  // dirty check is a plain string equality.
  useEffect(() => {
    if (!isOpen) return;
    const seeded: Record<string, DeploymentScalingState> = {};
    for (const dep of userDeployments) {
      seeded[dep.name] = entryToState(liveScaling[dep.name]);
    }
    setScalingForm(seeded);
    setScalingInitial(JSON.stringify(seeded));
    setScalingSubmitError(null);
    setScalingSubmitOk(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen, JSON.stringify(liveScaling), JSON.stringify(userDeployments.map(d => d.name))]);

  const isScalingDirty = JSON.stringify(scalingForm) !== scalingInitial;
  const scalingEnabled =
    !!updateAppScaling && meetsVersion(bioengineVersion, '0.11.6') && userDeployments.length > 0;

  // Per-deployment validity check — the form's numeric inputs are unbounded,
  // so guard against the user typing nonsense before we enable Save.
  const scalingValidation = useMemo(() => {
    const errors: Record<string, string> = {};
    for (const [name, s] of Object.entries(scalingForm)) {
      if (s.mode === 'fixed') {
        if (!Number.isFinite(s.num_replicas) || s.num_replicas < 0) {
          errors[name] = 'Replicas must be 0 or more.';
        }
      } else {
        if (!Number.isFinite(s.min_replicas) || s.min_replicas < 0) {
          errors[name] = 'Min replicas must be 0 or more.';
        } else if (!Number.isFinite(s.max_replicas) || s.max_replicas < 1) {
          errors[name] = 'Max replicas must be at least 1.';
        } else if (s.max_replicas < s.min_replicas) {
          errors[name] = 'Max replicas must be greater than or equal to min replicas.';
        } else if (!Number.isFinite(s.target) || s.target < 1) {
          errors[name] = 'Target ongoing requests must be at least 1.';
        }
      }
    }
    return errors;
  }, [scalingForm]);

  const scalingHasErrors = Object.keys(scalingValidation).length > 0;

  const handleSaveScaling = async () => {
    if (!updateAppScaling) return;
    const artifactId = status?.artifact_id;
    if (!artifactId) {
      setScalingSubmitError('Cannot determine artifact_id for this app.');
      return;
    }

    // Replacement semantics: start from the full live map (covers any
    // deployments the dialog isn't editing — e.g. a future class added
    // by the artifact but not yet in our form), overlay form deltas.
    const fullScaling: Record<string, any> = { ...liveScaling };
    for (const [name, s] of Object.entries(scalingForm)) {
      fullScaling[name] = stateToEntry(s);
    }

    setScalingSubmitError(null);
    setScalingSubmitOk(false);
    setSavingScaling(true);
    try {
      await updateAppScaling({
        application_id: applicationId,
        artifact_id: artifactId,
        scaling: fullScaling,
      });
      setScalingSubmitOk(true);
      await loadStatus();
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setScalingSubmitError(`Save failed: ${msg}`);
    } finally {
      setSavingScaling(false);
    }
  };

  const updateForm = (name: string, patch: Partial<DeploymentScalingState>) => {
    setScalingForm(prev => ({ ...prev, [name]: { ...prev[name], ...patch } }));
    setScalingSubmitOk(false);
  };

  // Refresh logs for a single deployment. Until the worker accepts
  // per-deployment log params (see feature request to bioengine session
  // 96b34abe), we call get_app_status with this block's params and merge
  // only the matching deployment's data back into state — leaving other
  // deployments' last-loaded buffers untouched. Slightly wasteful at the
  // backend (full fan-out) but right at the UI level.
  const refreshDeploymentLogs = async (depName: string) => {
    const cfg = logControls[depName] ?? DEFAULT_LOG_CONTROLS;
    setRefreshingDeployment(depName);
    setError(null);
    try {
      const result = await fetchApplicationStatus({
        application_ids: [applicationId],
        logs_tail: cfg.logsTail,
        n_previous_replica: cfg.nPrevious,
      });
      const newDeployment = result?.deployments?.[depName];
      if (!newDeployment) {
        setError(`Deployment "${depName}" not present in refreshed status.`);
        return;
      }
      // Merge only the refreshed deployment back into state; leave the
      // rest of the dialog's snapshot untouched (the user might be
      // mid-edit on the scaling form etc).
      setStatus((prev: any) => {
        if (!prev || typeof prev !== 'object') return result;
        return {
          ...prev,
          deployments: { ...(prev.deployments ?? {}), [depName]: newDeployment },
        };
      });
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : String(err);
      setError(`Refresh failed for ${depName}: ${errorMessage}`);
    } finally {
      setRefreshingDeployment(null);
    }
  };

  const updateLogControl = (depName: string, patch: Partial<LogControls>) => {
    setLogControls(prev => ({
      ...prev,
      [depName]: { ...(prev[depName] ?? DEFAULT_LOG_CONTROLS), ...patch },
    }));
  };

  // Undeploy button label depends on the app's lifecycle phase: while
  // the worker is still bringing the app up, "stop" means "cancel the
  // deploy"; once it's running it's a proper undeploy.
  const undeployLabel = useMemo(() => {
    const appStatus = String(status?.status ?? '').toUpperCase();
    return appStatus === 'DEPLOYING' ? 'Cancel deployment' : 'Undeploy';
  }, [status]);

  const handleUndeployClick = () => {
    if (!onUndeploy) return;
    if (!undeployConfirm) {
      // First click: arm the confirm state. Auto-disarm after 6s so the
      // destructive affordance doesn't sit hot indefinitely.
      setUndeployConfirm(true);
      if (undeployConfirmTimer.current) clearTimeout(undeployConfirmTimer.current);
      undeployConfirmTimer.current = setTimeout(() => setUndeployConfirm(false), 6000);
      return;
    }
    // Second click: fire.
    if (undeployConfirmTimer.current) clearTimeout(undeployConfirmTimer.current);
    setUndeployConfirm(false);
    onUndeploy(applicationId);
  };

  const cancelUndeployConfirm = () => {
    if (undeployConfirmTimer.current) clearTimeout(undeployConfirmTimer.current);
    setUndeployConfirm(false);
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center z-50 p-4">
      <style>{`
        .mm-press { transition: transform 160ms cubic-bezier(0.23, 1, 0.32, 1); }
        .mm-press:active:not(:disabled) { transform: scale(0.97); }
      `}</style>
      <div className="bg-white rounded-xl shadow-xl w-full max-w-6xl max-h-[90vh] overflow-y-auto">
        <div className="px-6 py-4 border-b border-gray-100 flex justify-between items-center gap-4 sticky top-0 bg-white z-10">
          <div className="min-w-0">
            <h3 className="text-xl font-semibold text-gray-800">Monitor & Manage app</h3>
            <p className="text-sm text-gray-500 mt-1 break-all">Application ID: {applicationId}</p>
          </div>
          <div className="flex items-center gap-2 flex-shrink-0">
            <button
              type="button"
              onClick={loadStatus}
              disabled={loading}
              className="mm-press inline-flex items-center px-3 py-1.5 text-sm font-medium rounded-lg border border-gray-200 bg-white text-gray-700 hover:bg-gray-50 disabled:opacity-60 disabled:cursor-not-allowed"
              title="Reload app status from the worker"
            >
              <svg className={`w-4 h-4 mr-1.5 ${loading ? 'animate-spin' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v6h6M20 20v-6h-6M5.07 9A8 8 0 0119 9M19 15a8 8 0 01-13.93 0" />
              </svg>
              {loading ? 'Refreshing' : 'Refresh'}
            </button>
            {/* Destructive action sits at the right edge so it isn't
                adjacent to Refresh; two-step confirm guards against
                accidental clicks. */}
            {onUndeploy && (
              undeployConfirm ? (
                <div className="flex items-center gap-1">
                  <button
                    type="button"
                    onClick={cancelUndeployConfirm}
                    disabled={isUndeploying}
                    className="mm-press inline-flex items-center px-3 py-1.5 text-sm font-medium rounded-lg border border-gray-300 bg-white text-gray-700 hover:bg-gray-50"
                  >
                    Cancel
                  </button>
                  <button
                    type="button"
                    onClick={handleUndeployClick}
                    disabled={isUndeploying}
                    className="mm-press inline-flex items-center px-3 py-1.5 text-sm font-medium rounded-lg bg-red-600 text-white hover:bg-red-700 disabled:bg-red-400"
                    autoFocus
                  >
                    Confirm {undeployLabel.toLowerCase()}
                  </button>
                </div>
              ) : (
                <button
                  type="button"
                  onClick={handleUndeployClick}
                  disabled={isUndeploying}
                  className="mm-press inline-flex items-center px-3 py-1.5 text-sm font-medium rounded-lg border border-red-200 bg-white text-red-700 hover:bg-red-50 disabled:opacity-60 disabled:cursor-not-allowed"
                  title={undeployLabel === 'Cancel deployment'
                    ? 'Stop the in-progress deployment'
                    : 'Stop this app and free its replicas'}
                >
                  {isUndeploying ? (
                    <>
                      <svg className="w-4 h-4 mr-1.5 animate-spin" fill="none" viewBox="0 0 24 24">
                        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                        <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                      </svg>
                      {undeployLabel === 'Cancel deployment' ? 'Canceling' : 'Undeploying'}
                    </>
                  ) : (
                    <>
                      <svg className="w-4 h-4 mr-1.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6M1 7h22M8 7V5a2 2 0 012-2h4a2 2 0 012 2v2" />
                      </svg>
                      {undeployLabel}
                    </>
                  )}
                </button>
              )
            )}
            <button onClick={onClose} className="text-gray-400 hover:text-gray-600 transition-colors p-1" aria-label="Close dialog">
              <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>
        </div>

        <div className="p-6 space-y-6">
          {error && (
            <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-lg text-sm">
              {error}
            </div>
          )}

          {/* Pending-replica banner — Ray Serve queues replicas the cluster
              can't yet schedule (no free CPU/GPU). Without this, a Save
              that bumped max_replicas can look frozen because the new
              replicas sit in PENDING_ALLOCATION until resources free up. */}
          {hasPendingReplicas && (
            <div className="flex items-start gap-3 px-4 py-3 bg-amber-50 border border-amber-200 rounded-lg">
              <svg className="w-5 h-5 text-amber-500 mt-0.5 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01M5 19h14a2 2 0 001.84-2.75L13.74 4a2 2 0 00-3.48 0L3.16 16.25A2 2 0 005 19z" />
              </svg>
              <div className="text-sm text-amber-800">
                <p className="font-medium">Replica deployment pending</p>
                <p className="text-amber-700 mt-0.5">
                  Ray Serve queues replicas that exceed cluster capacity. Pending replicas will start as resources free up.
                </p>
              </div>
            </div>
          )}

          {(!hasLoaded || (loading && !hasLoaded)) ? (
            <div className="flex flex-col items-center justify-center py-16 text-gray-600">
              <div className="w-10 h-10 border-4 border-gray-200 border-t-blue-600 rounded-full animate-spin mb-4" />
              <p className="text-sm font-medium">Loading app status...</p>
              <p className="text-xs text-gray-500 mt-1">Fetching deployments, logs, and replica details</p>
            </div>
          ) : null}

          {hasLoaded && (
            <div className="p-4 rounded-lg border border-gray-200 bg-gray-50">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3 text-sm">
                <div><span className="font-medium text-gray-700">Status:</span> <span className="text-gray-900">{status?.status || 'UNKNOWN'}</span></div>
                <div><span className="font-medium text-gray-700">Version:</span> <span className="text-gray-900">{status?.version || 'N/A'}</span></div>
                <div><span className="font-medium text-gray-700">Message:</span> <span className="text-gray-900">{status?.message || '-'}</span></div>
                <div><span className="font-medium text-gray-700">Last Updated By:</span> <span className="text-gray-900">{status?.last_updated_by || '-'}</span></div>
              </div>
            </div>
          )}

          {loading && hasLoaded ? (
            <div className="flex items-center justify-center py-4 text-sm text-gray-600">
              <div className="w-5 h-5 border-2 border-gray-200 border-t-blue-600 rounded-full animate-spin mr-3" />
              Refreshing deployment status...
            </div>
          ) : null}

          {/* Replica scaling moves to the top of the editing surface
              (above per-deployment cards) — it's the main lever for
              operating an app at scale, and pushing it below a deck of
              log panes made it easy to miss. */}
          {scalingEnabled && hasLoaded && (
            <ScalingSection
              userDeployments={userDeployments}
              scalingForm={scalingForm}
              advancedOpen={advancedOpen}
              setAdvancedOpen={setAdvancedOpen}
              updateForm={updateForm}
              validation={scalingValidation}
              isDirty={isScalingDirty}
              hasErrors={scalingHasErrors}
              saving={savingScaling}
              submitError={scalingSubmitError}
              submitOk={scalingSubmitOk}
              onSave={handleSaveScaling}
              onReset={() => {
                try {
                  setScalingForm(JSON.parse(scalingInitial));
                  setScalingSubmitError(null);
                  setScalingSubmitOk(false);
                } catch {
                  /* shouldn't happen — scalingInitial is set from a stringify */
                }
              }}
            />
          )}

          {hasLoaded && !loading && deployments.length === 0 ? (
            <p className="text-sm text-gray-500">No deployment entries found for this application.</p>
          ) : hasLoaded ? (
            <div className="space-y-4">
              {deployments.map(({ name, data }) => {
                const logs = data?.logs && typeof data.logs === 'object' ? Object.entries(data.logs) : [];
                const cfg = logControls[name] ?? DEFAULT_LOG_CONTROLS;
                const isRefreshing = refreshingDeployment === name;

                return (
                  <div key={name} className="border border-gray-200 rounded-xl overflow-hidden">
                    <div className="px-4 py-3 bg-white border-b border-gray-100 flex flex-wrap items-center gap-3">
                      <h4 className="text-base font-semibold text-gray-800">{name}</h4>
                      <span className="inline-flex items-center px-2 py-1 rounded text-xs font-medium border bg-blue-50 text-blue-700 border-blue-200">
                        {data?.status || 'UNKNOWN'}
                      </span>
                      {data?.message ? (
                        <span className="text-xs text-gray-600">{data.message}</span>
                      ) : null}
                    </div>

                    <div className="p-4 space-y-3 bg-gray-50">
                      {data?.replica_states && (
                        <div>
                          <p className="text-sm font-medium text-gray-700 mb-1">Replica states</p>
                          <div className="flex flex-wrap gap-2">
                            {Object.entries(data.replica_states).map(([state, count]) => (
                              <span key={state} className="inline-flex items-center px-2 py-1 rounded text-xs font-medium border bg-white text-gray-700 border-gray-200">
                                {state}: {String(count)}
                              </span>
                            ))}
                          </div>
                        </div>
                      )}

                      {/* Per-deployment node placement. One badge per
                          distinct (node_id, state) pair across all replicas
                          that have a node_id — so STARTING and DEPLOY_FAILED
                          replicas show up too, not just RUNNING. The badge
                          tint encodes the replica state for diagnostics. */}
                      {Array.isArray(data?.replicas) && data.replicas.some((r: any) => r?.node_id) && (
                        <div>
                          <p className="text-sm font-medium text-gray-700 mb-1">Replica placement</p>
                          <div className="flex flex-wrap gap-2">
                            {(() => {
                              const seen = new Set<string>();
                              const rows: Array<{ key: string; label: string; state?: string; tooltip: string }> = [];
                              for (const r of data.replicas as any[]) {
                                if (!r?.node_id) continue;
                                const key = `${r.node_id}::${r.state ?? ''}`;
                                if (seen.has(key)) continue;
                                seen.add(key);
                                const label = formatReplicaNode(r) ?? r.node_id;
                                const tooltipState = r.state ? `${r.state} on ${r.node_id}` : r.node_id;
                                rows.push({ key, label, state: r.state, tooltip: tooltipState });
                              }
                              return rows.map(row => (
                                <span
                                  key={row.key}
                                  className={`inline-flex items-center gap-1.5 px-2 py-1 rounded text-xs font-medium border font-mono break-all ${stateClasses(row.state)}`}
                                  title={row.tooltip}
                                >
                                  <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 12H3l9-9 9 9h-2M5 12v7a2 2 0 002 2h10a2 2 0 002-2v-7M5 12l7-7 7 7" />
                                  </svg>
                                  {row.label}
                                  {row.state && (
                                    <span className="opacity-80 font-normal">{row.state}</span>
                                  )}
                                </span>
                              ));
                            })()}
                          </div>
                        </div>
                      )}

                      {/* Per-deployment log controls. Replaces the dialog-
                          level "Log Lines" / "Previous Replicas" inputs
                          so an operator can drill into one deployment
                          without bumping log fetches for the others.
                          Until the worker supports per-deployment params
                          natively (see bioengine feature request) we
                          fetch the full app status and merge only this
                          deployment's slice back into state. */}
                      <div className="rounded-lg border border-gray-200 bg-white px-3 py-2.5">
                        <div className="flex flex-wrap items-end gap-3">
                          <label className="flex flex-col gap-1 min-w-0">
                            <span className="text-xs font-medium text-gray-700">Log Lines</span>
                            <input
                              type="number"
                              value={cfg.logsTail}
                              onChange={(e) => updateLogControl(name, { logsTail: parseInt(e.target.value || '0', 10) })}
                              className="w-28 px-2.5 py-1.5 border border-gray-300 rounded-md text-sm tabular-nums"
                            />
                          </label>
                          <label className="flex flex-col gap-1 min-w-0">
                            <span className="text-xs font-medium text-gray-700">Previous Replicas</span>
                            <input
                              type="number"
                              value={cfg.nPrevious}
                              onChange={(e) => updateLogControl(name, { nPrevious: parseInt(e.target.value || '0', 10) })}
                              className="w-28 px-2.5 py-1.5 border border-gray-300 rounded-md text-sm tabular-nums"
                            />
                          </label>
                          <button
                            type="button"
                            onClick={() => refreshDeploymentLogs(name)}
                            disabled={isRefreshing || loading}
                            className="mm-press inline-flex items-center px-3 py-1.5 text-sm font-medium rounded-lg border border-gray-200 bg-white text-gray-700 hover:bg-gray-50 disabled:opacity-60 disabled:cursor-not-allowed h-[34px]"
                          >
                            {isRefreshing ? (
                              <>
                                <svg className="w-3.5 h-3.5 mr-1.5 animate-spin" fill="none" viewBox="0 0 24 24">
                                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                                </svg>
                                Refreshing
                              </>
                            ) : (
                              <>
                                <svg className="w-3.5 h-3.5 mr-1.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v6h6M20 20v-6h-6M5.07 9A8 8 0 0119 9M19 15a8 8 0 01-13.93 0" />
                                </svg>
                                Refresh logs
                              </>
                            )}
                          </button>
                          <span className="text-xs text-gray-500 ml-1">
                            Use -1 for all available logs or all previous replicas.
                          </span>
                        </div>
                      </div>

                      {logs.length > 0 ? (
                        <div className="space-y-3">
                          <p className="text-sm font-medium text-gray-700">Logs</p>
                          {logs.map(([replicaId, replicaData]: any) => (
                            <div key={replicaId} className="border border-gray-200 rounded-lg bg-white">
                              <div className="px-3 py-2 border-b border-gray-100 text-xs text-gray-600 flex justify-between">
                                <span>Replica: {replicaId}</span>
                                <span>{replicaData?.timezone || 'UTC'}</span>
                              </div>
                              <div className="p-3 grid grid-cols-1 xl:grid-cols-2 gap-3">
                                <div>
                                  <p className="text-xs font-semibold text-gray-600 mb-1">stdout</p>
                                  <pre className="text-xs bg-gray-900 text-green-200 rounded p-2 overflow-auto max-h-48 whitespace-pre-wrap break-words">{Array.isArray(replicaData?.stdout) ? replicaData.stdout.join('\n') : ''}</pre>
                                </div>
                                <div>
                                  <p className="text-xs font-semibold text-gray-600 mb-1">stderr</p>
                                  <pre className="text-xs bg-gray-900 text-red-200 rounded p-2 overflow-auto max-h-48 whitespace-pre-wrap break-words">{Array.isArray(replicaData?.stderr) ? replicaData.stderr.join('\n') : ''}</pre>
                                </div>
                              </div>
                            </div>
                          ))}
                        </div>
                      ) : (
                        <p className="text-xs text-gray-500">No logs returned for this deployment. Click Refresh logs to fetch.</p>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          ) : null}
        </div>
      </div>
      {/* Scaling save errors render in a top-layer ErrorDialog (z-60) on
          top of this dialog (z-50) so deploy_app stack traces stay readable.
          The inline status row above just acknowledges that the save failed
          and points at the dialog. */}
      <ErrorDialog
        open={!!scalingSubmitError}
        title="Scaling update failed"
        subtitle={applicationId}
        message={scalingSubmitError ?? ''}
        onClose={() => setScalingSubmitError(null)}
      />
    </div>
  );
};

// --- Scaling editor ---------------------------------------------------------

interface ScalingSectionProps {
  userDeployments: Array<{ name: string; data: any }>;
  scalingForm: Record<string, DeploymentScalingState>;
  advancedOpen: Record<string, boolean>;
  setAdvancedOpen: React.Dispatch<React.SetStateAction<Record<string, boolean>>>;
  updateForm: (name: string, patch: Partial<DeploymentScalingState>) => void;
  validation: Record<string, string>;
  isDirty: boolean;
  hasErrors: boolean;
  saving: boolean;
  submitError: string | null;
  submitOk: boolean;
  onSave: () => void;
  onReset: () => void;
}

const numericInputClass =
  'w-24 px-2.5 py-1.5 border border-gray-300 rounded-md text-sm tabular-nums focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500';

const ScalingSection: React.FC<ScalingSectionProps> = ({
  userDeployments,
  scalingForm,
  advancedOpen,
  setAdvancedOpen,
  updateForm,
  validation,
  isDirty,
  hasErrors,
  saving,
  submitError,
  submitOk,
  onSave,
  onReset,
}) => {
  return (
    <div className="border border-gray-200 rounded-xl bg-white">
      <style>{`
        .scale-press { transition: transform 160ms cubic-bezier(0.23, 1, 0.32, 1); }
        .scale-press:active:not(:disabled) { transform: scale(0.97); }
      `}</style>

      <div className="px-4 py-3 border-b border-gray-100 flex items-center gap-2">
        <svg className="w-4 h-4 text-gray-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 7h8m0 0v8m0-8l-8 8-4-4-6 6" />
        </svg>
        <h4 className="text-base font-semibold text-gray-800">Replica scaling</h4>
        <span className="text-xs text-gray-500 ml-2">
          ProxyDeployment runs at one fixed replica and is not editable.
        </span>
      </div>

      <div className="p-4 space-y-4">
        {userDeployments.map(({ name }) => {
          const state = scalingForm[name];
          if (!state) return null;
          const isAuto = state.mode === 'autoscale';
          const adv = !!advancedOpen[name];
          const err = validation[name];
          return (
            <div key={name} className="border border-gray-200 rounded-lg p-3 bg-gray-50">
              <div className="flex items-center justify-between gap-3 mb-3">
                <div className="font-semibold text-gray-800">{name}</div>
                <label className="inline-flex items-center gap-2 text-sm text-gray-700 cursor-pointer select-none">
                  <span>Enable autoscaling</span>
                  <ScaleToggle
                    checked={isAuto}
                    onChange={(next) =>
                      updateForm(name, next ? { mode: 'autoscale' } : { mode: 'fixed' })
                    }
                  />
                </label>
              </div>

              {!isAuto ? (
                <div>
                  <label className="flex items-center gap-3 text-sm text-gray-700">
                    <span className="w-32">Replicas</span>
                    <input
                      type="number"
                      min={0}
                      value={Number.isFinite(state.num_replicas) ? state.num_replicas : 0}
                      onChange={(e) =>
                        updateForm(name, { num_replicas: parseInt(e.target.value || '0', 10) })
                      }
                      className={numericInputClass}
                    />
                  </label>
                  {state.num_replicas === 0 && (
                    <p className="mt-1.5 text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded px-2 py-1 inline-block">
                      Setting 0 frees all replicas and pauses the app.
                    </p>
                  )}
                </div>
              ) : (
                <div className="space-y-3">
                  <div className="flex flex-wrap gap-4 items-end">
                    <label className="flex flex-col gap-1 text-sm text-gray-700">
                      <span>Min replicas</span>
                      <input
                        type="number"
                        min={0}
                        value={Number.isFinite(state.min_replicas) ? state.min_replicas : 0}
                        onChange={(e) =>
                          updateForm(name, { min_replicas: parseInt(e.target.value || '0', 10) })
                        }
                        className={numericInputClass}
                      />
                    </label>
                    <label className="flex flex-col gap-1 text-sm text-gray-700">
                      <span>Max replicas</span>
                      <input
                        type="number"
                        min={1}
                        value={Number.isFinite(state.max_replicas) ? state.max_replicas : 1}
                        onChange={(e) =>
                          updateForm(name, { max_replicas: parseInt(e.target.value || '1', 10) })
                        }
                        className={numericInputClass}
                      />
                    </label>
                  </div>

                  <button
                    type="button"
                    onClick={() =>
                      setAdvancedOpen(prev => ({ ...prev, [name]: !prev[name] }))
                    }
                    className="inline-flex items-center text-xs font-medium text-blue-600 hover:text-blue-800"
                  >
                    <svg
                      className={`w-3.5 h-3.5 mr-1 transition-transform ${adv ? 'rotate-180' : ''}`}
                      fill="none"
                      stroke="currentColor"
                      viewBox="0 0 24 24"
                      style={{ transitionDuration: '180ms', transitionTimingFunction: 'cubic-bezier(0.23, 1, 0.32, 1)' }}
                    >
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                    </svg>
                    {adv ? 'Hide advanced' : 'Show advanced'}
                  </button>

                  {adv && (
                    <div className="flex flex-wrap gap-4 items-end pt-1 pl-1 border-l-2 border-gray-200 ml-1">
                      <label className="flex flex-col gap-1 text-sm text-gray-700">
                        <span>Target ongoing requests / replica</span>
                        <input
                          type="number"
                          min={1}
                          value={Number.isFinite(state.target) ? state.target : 1}
                          onChange={(e) =>
                            updateForm(name, { target: parseInt(e.target.value || '1', 10) })
                          }
                          className={numericInputClass}
                        />
                      </label>
                      <label className="flex flex-col gap-1 text-sm text-gray-700">
                        <span>Upscale delay (s)</span>
                        <input
                          type="number"
                          min={0}
                          placeholder="auto"
                          value={state.upscale_delay_s ?? ''}
                          onChange={(e) =>
                            updateForm(name, {
                              upscale_delay_s: e.target.value === '' ? null : parseFloat(e.target.value),
                            })
                          }
                          className={numericInputClass}
                        />
                      </label>
                      <label className="flex flex-col gap-1 text-sm text-gray-700">
                        <span>Downscale delay (s)</span>
                        <input
                          type="number"
                          min={0}
                          placeholder="auto"
                          value={state.downscale_delay_s ?? ''}
                          onChange={(e) =>
                            updateForm(name, {
                              downscale_delay_s: e.target.value === '' ? null : parseFloat(e.target.value),
                            })
                          }
                          className={numericInputClass}
                        />
                      </label>
                    </div>
                  )}
                </div>
              )}

              {err && (
                <p className="mt-2 text-xs text-red-600">{err}</p>
              )}
            </div>
          );
        })}

        <div className="flex flex-wrap items-center justify-between gap-3 pt-1">
          <div className="text-xs text-gray-500 min-h-[1.25rem]">
            {submitError ? (
              <span className="text-red-600">Save failed. See the error dialog for details.</span>
            ) : submitOk ? (
              <span className="text-green-700">Scaling updated. Ray Serve is rolling the change.</span>
            ) : isDirty ? (
              <span>Unsaved changes</span>
            ) : (
              <span className="text-gray-400">No changes yet</span>
            )}
          </div>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={onReset}
              disabled={!isDirty || saving}
              className="scale-press px-3 py-1.5 text-sm font-medium rounded-lg border border-gray-300 bg-white text-gray-700 hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              Reset
            </button>
            <button
              type="button"
              onClick={onSave}
              disabled={!isDirty || saving || hasErrors}
              className="scale-press px-4 py-1.5 text-sm font-medium rounded-lg bg-blue-600 text-white hover:bg-blue-700 disabled:bg-gray-400 disabled:cursor-not-allowed inline-flex items-center"
            >
              {saving ? (
                <>
                  <svg className="w-4 h-4 mr-1.5 animate-spin" fill="none" viewBox="0 0 24 24">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                  </svg>
                  Saving...
                </>
              ) : (
                'Save settings'
              )}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

// Small controlled switch matching the dashboard's blue accent. Uses
// transform-only animation for the thumb so it stays smooth even when the
// dialog body is re-rendering.
const ScaleToggle: React.FC<{ checked: boolean; onChange: (next: boolean) => void }> = ({
  checked,
  onChange,
}) => (
  <button
    type="button"
    role="switch"
    aria-checked={checked}
    onClick={() => onChange(!checked)}
    className={`scale-press inline-flex items-center w-10 h-6 rounded-full p-0.5 ${
      checked ? 'bg-blue-600' : 'bg-gray-300'
    }`}
    style={{ transition: 'background-color 180ms cubic-bezier(0.23, 1, 0.32, 1), transform 160ms cubic-bezier(0.23, 1, 0.32, 1)' }}
  >
    <span
      aria-hidden
      className="w-5 h-5 bg-white rounded-full shadow"
      style={{
        transform: checked ? 'translateX(16px)' : 'translateX(0px)',
        transition: 'transform 180ms cubic-bezier(0.23, 1, 0.32, 1)',
      }}
    />
  </button>
);

export default AppDeploymentsStatusDialog;
