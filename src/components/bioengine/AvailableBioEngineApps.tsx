import React, { useEffect, useState, useCallback } from 'react';
import ArtifactCard from './ArtifactCard';
import BioEngineAppManager from './BioEngineAppManager';
import { useObservedWorkspaces, DEFAULT_PUBLIC_WORKSPACE } from './hooks/useObservedWorkspaces';
import ObservedWorkspacesPanel from './ObservedWorkspacesPanel';
import RefreshButton from './RefreshButton';


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
    version?: string;
    description?: string;
    documentation?: string | { url?: string; text?: string };
    tutorial?: string | { url?: string; text?: string };
    links?: { url: string; icon?: string; label: string }[];
    deployment_config?: { modes?: { cpu?: any; gpu?: any } };
    deployment_class?: { exposed_methods?: Record<string, any> };
    ray_actor_options?: { num_gpus?: number };
  };
  supportedModes?: { cpu: boolean; gpu: boolean };
  defaultMode?: string;
  isLoading?: boolean;
  loadError?: string;
  version?: string;
  lastFileModified?: string;
};

interface AvailableBioEngineAppsProps {
  serviceId: string;
  server: any;
  isLoggedIn: boolean;
  adminUsers?: string[];
  currentUserEmail?: string;
  // Deployment state
  deployingArtifactId?: string | null;
  pendingDeploymentArtifactId?: string | null;
  artifactModes?: Record<string, string>;
  // Deployment errors are surfaced via the worker-level ErrorDialog.
  // Deployment handlers
  onDeployArtifact?: (artifactId: string, mode?: string | null) => void;
  onUndeployArtifact?: (artifactId: string) => void;
  onModeChange?: (artifactId: string, checked: boolean) => void;
  onSetArtifactMode?: (artifactId: string, mode: string) => void;
  isArtifactDeployed?: (artifactId: string) => boolean;
  getDeploymentStatus?: (artifactId: string) => string | null;
  isDeployButtonDisabled?: (artifactId: string) => boolean;
  getDeployButtonText?: (artifactId: string) => string;
  onArtifactUpdated?: (workspace?: string) => void;
}

const AvailableBioEngineApps: React.FC<AvailableBioEngineAppsProps> = ({
  serviceId,
  server,
  isLoggedIn,
  adminUsers = [],
  currentUserEmail,
  deployingArtifactId,
  pendingDeploymentArtifactId,
  artifactModes = {},
  onDeployArtifact,
  onUndeployArtifact,
  onModeChange,
  onSetArtifactMode,
  isArtifactDeployed,
  getDeploymentStatus,
  isDeployButtonDisabled,
  getDeployButtonText,
  onArtifactUpdated
}) => {
  const userWorkspace: string = server?.config?.workspace || '';
  const workerWorkspace: string = serviceId ? serviceId.split('/')[0] : '';

  // Pinned workspaces can never be removed by the user: the worker's own, the
  // logged-in user's, and the public one that hosts the curated apps.
  const pinnedWorkspaces = React.useMemo(() => {
    const pinned: string[] = [];
    if (workerWorkspace) pinned.push(workerWorkspace);
    if (userWorkspace && userWorkspace !== workerWorkspace) pinned.push(userWorkspace);
    if (!pinned.includes(DEFAULT_PUBLIC_WORKSPACE)) pinned.push(DEFAULT_PUBLIC_WORKSPACE);
    return pinned;
  }, [workerWorkspace, userWorkspace]);

  // Manually added workspaces are shared with the worker discovery list.
  const { observedWorkspaces: selectedWorkspaces, addWorkspace, removeWorkspace } =
    useObservedWorkspaces(pinnedWorkspaces);

  // Which workspace's apps are on screen. The observed list stays, but the
  // grid shows ONE workspace at a time: the merged view made it impossible to
  // tell which workspace an app came from, and a name collision across two
  // workspaces looked like a duplicate.

  const [availableArtifacts, setAvailableArtifacts] = useState<ArtifactType[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [artifactManager, setArtifactManager] = useState<any>(null);

  const appManagerRef = React.useRef<{
    openCreateDialog: () => void;
    openEditDialog: (artifact: ArtifactType) => void;
  }>(null);

  // Counter used to cancel stale concurrent fetches.
  const fetchIdRef = React.useRef(0);

  // Initialize artifact manager
  useEffect(() => {
    if (!isLoggedIn) return;
    server.getService('public/artifact-manager')
      .then(setArtifactManager)
      .catch((err: any) => setError(`Failed to initialize artifact manager: ${err}`));
  }, [server, isLoggedIn]);

  // Full reload only on initial connect — workspace add/remove is handled separately.
  useEffect(() => {
    if (isLoggedIn && artifactManager && serviceId) fetchAvailableArtifacts();
  }, [artifactManager, isLoggedIn, serviceId]);

  const determineArtifactSupportedModes = (artifact: any) => {
    const supportedModes = { cpu: false, gpu: false };
    const defaultMode = 'cpu';
    if (artifact.manifest?.deployment_config?.modes) {
      const modes = artifact.manifest.deployment_config.modes;
      if (modes.cpu) supportedModes.cpu = true;
      if (modes.gpu) supportedModes.gpu = true;
    } else if (artifact.manifest?.deployment_config?.ray_actor_options) {
      const n = artifact.manifest.deployment_config.ray_actor_options.num_gpus || 0;
      supportedModes.gpu = n > 0; supportedModes.cpu = !supportedModes.gpu;
    } else if (artifact.manifest?.ray_actor_options) {
      const n = artifact.manifest.ray_actor_options.num_gpus || 0;
      supportedModes.gpu = n > 0; supportedModes.cpu = !supportedModes.gpu;
    }
    return { supportedModes, defaultMode };
  };

  /** Enrich a single artifact in-place (manifest, last-modified, modes). */
  const enrichArtifact = useCallback(async (art: ArtifactType): Promise<ArtifactType> => {
    try {
      const data = await artifactManager.read(art.id);
      if (data) {
        art.manifest = data.manifest;
        art.version = data.manifest?.version || 'N/A';
        try {
          const fileList = await artifactManager.list_files({ artifact_id: art.id, _rkwargs: true });
          const timestamps = (fileList || [])
            .filter((f: any) => f?.type === 'file' && f.last_modified != null)
            .map((f: any) => {
              const v = typeof f.last_modified === 'number' ? f.last_modified * 1000 : Date.parse(f.last_modified);
              return Number.isFinite(v) ? v : null;
            })
            .filter((v: number | null): v is number => v !== null);
          if (timestamps.length > 0) art.lastFileModified = new Date(Math.max(...timestamps)).toLocaleString();
        } catch { /* ignore */ }
        const { supportedModes, defaultMode } = determineArtifactSupportedModes(art);
        art.supportedModes = supportedModes;
        art.defaultMode = defaultMode;
      }
    } catch { /* skip bad artifact */ }
    return art;
  }, [artifactManager]);

  const fetchAvailableArtifacts = useCallback(async () => {
    if (!serviceId || !artifactManager) return;
    const fetchId = ++fetchIdRef.current;
    setLoading(true);
    setError(null);
    setAvailableArtifacts([]);

    // Process workspaces in a stable order: worker's workspace first, then the
    // user's personal workspace, then any additional workspaces.
    const orderedWorkspaces = [
      ...(workerWorkspace && selectedWorkspaces.includes(workerWorkspace) ? [workerWorkspace] : []),
      ...(userWorkspace && selectedWorkspaces.includes(userWorkspace) && userWorkspace !== workerWorkspace ? [userWorkspace] : []),
      ...selectedWorkspaces.filter(w => w !== workerWorkspace && w !== userWorkspace),
    ];

    const seen = new Set<string>();

    try {
      for (const ws of orderedWorkspaces) {
        let wsArtifacts: ArtifactType[] = [];
        try {
          wsArtifacts = await artifactManager.list({
            parent_id: `${ws}/applications`,
            filters: { type: 'application', manifest: { type: 'ray-serve' } },
            _rkwargs: true,
          });
        } catch {
          continue; // workspace may not have an applications collection
        }

        // Deduplicate across workspaces
        const fresh = wsArtifacts.filter(a => { if (seen.has(a.id)) return false; seen.add(a.id); return true; });
        if (fresh.length === 0) continue;

        // Enrich each artifact and append it to the list as soon as it's ready
        for (const art of fresh) {
          const enriched = await enrichArtifact(art);

          // Discard if a newer fetch has started in the meantime
          if (fetchId !== fetchIdRef.current) return;

          // Append immediately so the card appears as soon as it's enriched
          setAvailableArtifacts(prev => [...prev, enriched]);
          if (onSetArtifactMode && enriched.supportedModes?.cpu && enriched.supportedModes?.gpu && !artifactModes[enriched.id]) {
            onSetArtifactMode(enriched.id, 'cpu');
          }
        }
      }
    } catch (err) {
      if (fetchId === fetchIdRef.current) setError(`Failed to fetch artifacts: ${err}`);
    } finally {
      if (fetchId === fetchIdRef.current) setLoading(false);
    }
  }, [artifactManager, serviceId, selectedWorkspaces, workerWorkspace, userWorkspace, enrichArtifact, onSetArtifactMode, artifactModes]);

  /** Fetch and append artifacts for a single workspace without touching others. */
  const fetchWorkspaceArtifacts = useCallback(async (ws: string) => {
    if (!artifactManager) return;
    const fetchId = ++fetchIdRef.current;
    try {
      const wsArtifacts: ArtifactType[] = await artifactManager.list({
        parent_id: `${ws}/applications`,
        filters: { type: 'application', manifest: { type: 'ray-serve' } },
        _rkwargs: true,
      });

      for (const art of wsArtifacts) {
        if (fetchId !== fetchIdRef.current) return;
        // Skip if already in the list
        const isDupe = await new Promise<boolean>(resolve =>
          setAvailableArtifacts(prev => {
            const dup = prev.some(a => a.id === art.id);
            resolve(dup);
            return prev; // no state change — just reading
          })
        );
        if (isDupe || fetchId !== fetchIdRef.current) continue;

        const enriched = await enrichArtifact(art);
        if (fetchId !== fetchIdRef.current) return;
        setAvailableArtifacts(prev => prev.some(a => a.id === enriched.id) ? prev : [...prev, enriched]);
        if (onSetArtifactMode && enriched.supportedModes?.cpu && enriched.supportedModes?.gpu && !artifactModes[enriched.id]) {
          onSetArtifactMode(enriched.id, 'cpu');
        }
      }
    } catch {
      // workspace may not have an applications collection — ignore silently
    }
  }, [artifactManager, enrichArtifact, onSetArtifactMode, artifactModes]);

  // Takes the name from the shared panel. Still fetches immediately so the new
  // workspace's section fills in without waiting for the next refresh.
  const handleAddWorkspace = (name: string) => {
    const ws = name.trim();
    if (ws && !selectedWorkspaces.includes(ws)) {
      addWorkspace(ws);
      fetchWorkspaceArtifacts(ws);
    }
  };

  const handleRemoveWorkspace = (ws: string) => {
    if (pinnedWorkspaces.includes(ws)) return; // pinned — cannot be removed
    removeWorkspace(ws);
    // Drop all artifacts that belong to this workspace
    setAvailableArtifacts(prev => prev.filter(a => !a.id.startsWith(`${ws}/`)));
  };


  const allWorkspaces = [...new Set([...pinnedWorkspaces, ...selectedWorkspaces])].filter(Boolean);

  // Grouped per workspace rather than filtered to one. Every observed
  // workspace gets a section even when empty, so "nothing here" is visible
  // rather than inferred from the workspace's absence.
  const artifactsByWorkspace = React.useMemo(
    () => allWorkspaces.map(workspace => ({
      workspace,
      artifacts: availableArtifacts.filter(a => a.id.startsWith(`${workspace}/`)),
    })),
    [availableArtifacts, allWorkspaces],
  );

  // Kept for the empty / loading states below, which ask about the page as a
  // whole rather than any one workspace.
  const shownArtifacts = availableArtifacts;

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex flex-wrap justify-between items-start gap-3">
        <div className="flex items-center">
          <div className="w-10 h-10 bg-white rounded-xl flex items-center justify-center mr-3 p-1">
            <img src="/static/img/bioengine-icon.svg" alt="BioEngine" className="w-8 h-8" />
          </div>
          <h3 className="text-lg font-semibold text-gray-800">Available BioEngine Apps</h3>
        </div>
        <div className="flex flex-wrap gap-2 items-center">

          <button
            onClick={() => appManagerRef.current?.openCreateDialog()}
            disabled={loading}
            className="px-5 py-2 bg-gradient-to-r from-blue-600 to-blue-700 text-white text-sm font-medium rounded-xl hover:from-blue-700 hover:to-blue-800 disabled:opacity-50 flex items-center gap-2 shadow-sm hover:shadow-md transition-all duration-200"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
            </svg>
            Create App
          </button>
          <RefreshButton
            onClick={fetchAvailableArtifacts}
            busy={loading}
            label={availableArtifacts.length > 0 ? 'Refresh' : 'Load Artifacts'}
            title="Re-read deployable artifacts from every observed workspace"
          />
        </div>
      </div>

      <ObservedWorkspacesPanel
        className="p-3 bg-gray-50 border border-gray-200 rounded-xl"
        workspaces={selectedWorkspaces}
        pinned={pinnedWorkspaces}
        countOf={ws => availableArtifacts.filter(a => a.id.startsWith(`${ws}/`)).length}
        statusOf={() => (loading ? 'loading' : 'loaded')}
        noun="app"
        onAdd={handleAddWorkspace}
        onRemove={handleRemoveWorkspace}
        onRefresh={fetchAvailableArtifacts}
        refreshing={loading}
      />

      {/* Deployment errors are now rendered by the worker-level
          ErrorDialog (BioEngineWorker.tsx) so multi-line stack traces
          stay readable. The internal "error" state below is for the
          artifact-list fetch itself, which is a different code path. */}

      {/* Error */}
      {error && (
        <div className="p-4 bg-red-50 border border-red-200 rounded-lg flex justify-between items-start">
          <div className="flex gap-2">
            <svg className="w-5 h-5 text-red-400 mt-0.5 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
            <div>
              <h4 className="text-sm font-medium text-red-800">Error</h4>
              <p className="text-sm text-red-700 mt-1">{error}</p>
            </div>
          </div>
          <button onClick={() => setError(null)} className="text-red-400 hover:text-red-600">
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
          </button>
        </div>
      )}

      {loading && shownArtifacts.length === 0 && (
        <div className="flex justify-center p-8 text-gray-500 text-sm gap-2">
          <div className="w-4 h-4 border-2 border-gray-300 border-t-blue-600 rounded-full animate-spin" />
          Loading artifacts…
        </div>
      )}

      {!loading && shownArtifacts.length === 0 && (
        <div className="flex justify-center p-8 text-gray-500 text-sm">
          No deployable artifacts found. Click "Load Artifacts" or add a workspace.
        </div>
      )}

      {/* One section per workspace, so an app's origin is visible without
          selecting a workspace first, and a name that appears in two
          workspaces no longer reads as a duplicate. */}
      {artifactsByWorkspace.some(g => g.artifacts.length > 0) && (
        <div className="space-y-6">
          {artifactsByWorkspace.map(({ workspace, artifacts }) => (
            <div key={workspace}>
              <h4 className="text-sm font-semibold text-gray-700 font-mono mb-3">
                {workspace}
                <span className="ml-2 text-xs font-sans font-normal text-gray-400">
                  {artifacts.length} app{artifacts.length === 1 ? '' : 's'}
                </span>
              </h4>
              {artifacts.length === 0 ? (
                <p className="text-xs text-gray-500">No deployable artifacts here.</p>
              ) : (
                <div className="grid grid-cols-1 xl:grid-cols-2 gap-6">
                  {artifacts.map(artifact => (
                    <ArtifactCard
                      key={artifact.id}
                      artifact={artifact}
                      artifactMode={artifactModes[artifact.id]}
                      onViewFiles={() => appManagerRef.current?.openEditDialog(artifact)}
                      onDeploy={(artifactId, mode) => onDeployArtifact?.(artifactId, mode)}
                      onModeChange={checked => onModeChange?.(artifact.id, checked)}
                      isDeploying={deployingArtifactId === artifact.id || pendingDeploymentArtifactId === artifact.id}
                      server={server}
                    />
                  ))}
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      <BioEngineAppManager
        ref={appManagerRef}
        serviceId={serviceId}
        server={server}
        isLoggedIn={isLoggedIn}
        adminUsers={adminUsers}
        currentUserEmail={currentUserEmail}
        availableWorkspaces={allWorkspaces}
        onArtifactUpdated={(workspace?: string) => {
          if (workspace && selectedWorkspaces.includes(workspace)) {
            // Remove existing entries for this workspace and re-fetch only it
            setAvailableArtifacts(prev => prev.filter(a => !a.id.startsWith(`${workspace}/`)));
            fetchWorkspaceArtifacts(workspace);
          } else if (workspace && !selectedWorkspaces.includes(workspace)) {
            // Newly created in a workspace not yet observed — add it
            addWorkspace(workspace);
            fetchWorkspaceArtifacts(workspace);
          } else {
            fetchAvailableArtifacts();
          }
          onArtifactUpdated?.(workspace);
        }}
      />
    </div>
  );
};

export default AvailableBioEngineApps;
