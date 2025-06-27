import React, { useEffect, useState } from 'react';
import ArtifactCard from './ArtifactCard';
import BioEngineAppManager from './BioEngineAppManager';

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
};

interface AvailableBioEngineAppsProps {
  serviceId: string;
  server: any;
  isLoggedIn: boolean;
  // Deployment state
  deployingArtifactId?: string | null;
  artifactModes?: Record<string, string>;
  deploymentError?: string | null;
  setDeploymentError?: (error: string | null) => void;
  // Deployment handlers
  onDeployArtifact?: (artifactId: string, mode?: string | null) => void;
  onUndeployArtifact?: (artifactId: string) => void;
  onModeChange?: (artifactId: string, checked: boolean) => void;
  onSetArtifactMode?: (artifactId: string, mode: string) => void;
  isArtifactDeployed?: (artifactId: string) => boolean;
  getDeploymentStatus?: (artifactId: string) => string | null;
  isDeployButtonDisabled?: (artifactId: string) => boolean;
  getDeployButtonText?: (artifactId: string) => string;
  onArtifactUpdated?: () => void;
}

const AvailableBioEngineApps: React.FC<AvailableBioEngineAppsProps> = ({
  serviceId,
  server,
  isLoggedIn,
  deployingArtifactId,
  artifactModes = {},
  deploymentError,
  setDeploymentError,
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
  const [availableArtifacts, setAvailableArtifacts] = useState<ArtifactType[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [artifactManager, setArtifactManager] = useState<any>(null);
  const [deletingArtifactId, setDeletingArtifactId] = useState<string | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  // Reference to the app manager
  const appManagerRef = React.useRef<{
    openCreateDialog: () => void;
    openEditDialog: (artifact: ArtifactType) => void;
  }>(null);

  // Initialize artifact manager
  useEffect(() => {
    if (!isLoggedIn) return;

    const initArtifactManager = async () => {
      try {
        const manager = await server.getService('public/artifact-manager');
        setArtifactManager(manager);
      } catch (err) {
        console.error('Failed to initialize artifact manager:', err);
        setError('Failed to initialize artifact manager');
      }
    };

    initArtifactManager();
  }, [server, isLoggedIn]);

  // Fetch artifacts when artifact manager is available
  useEffect(() => {
    if (isLoggedIn && artifactManager && serviceId) {
      fetchAvailableArtifacts();
    }
  }, [artifactManager, isLoggedIn, serviceId]);

  const determineArtifactSupportedModes = (artifact: any) => {
    const supportedModes = { cpu: false, gpu: false };
    let defaultMode = 'cpu'; // Always default to CPU

    if (artifact.manifest?.deployment_config?.modes) {
      const modes = artifact.manifest.deployment_config.modes;

      if (modes.cpu) supportedModes.cpu = true;
      if (modes.gpu) supportedModes.gpu = true;
    }
    else if (artifact.manifest?.deployment_config?.ray_actor_options) {
      const numGpus = artifact.manifest.deployment_config.ray_actor_options.num_gpus || 0;
      supportedModes.gpu = numGpus > 0;
      supportedModes.cpu = !supportedModes.gpu;
    }
    else if (artifact.manifest?.ray_actor_options) {
      const numGpus = artifact.manifest.ray_actor_options.num_gpus || 0;
      supportedModes.gpu = numGpus > 0;
      supportedModes.cpu = !supportedModes.gpu;
    }

    return { supportedModes, defaultMode };
  };

  const fetchAvailableArtifacts = async () => {
    if (!serviceId || !artifactManager) return;

    try {
      setLoading(true);
      setError(null);

      let allArtifacts: ArtifactType[] = [];

      try {
        const publicCollectionId = 'bioimage-io/bioengine-apps';
        let publicArtifacts: ArtifactType[] = [];

        try {
          publicArtifacts = await artifactManager.list({ parent_id: publicCollectionId, _rkwargs: true });
          console.log(`Public artifacts found in ${publicCollectionId}:`, publicArtifacts.map(a => a.id));
        } catch (err) {
          console.warn(`Could not fetch public artifacts: ${err}`);
        }

        let userArtifacts: ArtifactType[] = [];
        const userWorkspace = server.config.workspace;

        if (userWorkspace) {
          const userCollectionId = `${userWorkspace}/bioengine-apps`;
          try {
            userArtifacts = await artifactManager.list({ parent_id: userCollectionId, _rkwargs: true });
            console.log(`User artifacts found in ${userCollectionId}:`, userArtifacts.map(a => a.id));
          } catch (collectionErr) {
            console.log(`User collection ${userCollectionId} does not exist, skipping`);
          }
        }

        const combinedArtifacts = [...publicArtifacts, ...userArtifacts];

        // Lazily load manifests for each artifact
        for (const art of combinedArtifacts) {
          try {
            console.log(`Processing artifact: ${art.id}, alias: ${art.alias}, workspace: ${art.workspace}`);

            const artifactData = await artifactManager.read(art.id);

            if (artifactData) {
              art.manifest = artifactData.manifest;

              const { supportedModes, defaultMode } = determineArtifactSupportedModes(art);
              console.log(`${art.id} supported modes:`, supportedModes, `Default: ${defaultMode}`);

              art.supportedModes = supportedModes;
              art.defaultMode = defaultMode;
            } else {
              console.log(`No manifest found for ${art.id}`);
            }
          } catch (err) {
            console.warn(`Failed to fetch manifest for ${art.id}:`, err);
          }
        }

        allArtifacts = combinedArtifacts;
      } catch (err) {
        console.warn(`Error processing artifacts: ${err}`);
      }

      setAvailableArtifacts(allArtifacts);

      // After setting artifacts, initialize modes for artifacts that support both CPU and GPU
      if (onSetArtifactMode) {
        allArtifacts.forEach(artifact => {
          if (artifact.supportedModes?.cpu && artifact.supportedModes?.gpu && !artifactModes[artifact.id]) {
            onSetArtifactMode(artifact.id, 'cpu');
          }
        });
      }
    } catch (err) {
      console.error('Error fetching artifacts:', err);
      setError(`Failed to fetch artifacts: ${err}`);
    } finally {
      setLoading(false);
    }
  };

  const isUserOwnedArtifact = (artifactId: string): boolean => {
    const userWorkspace = server.config.workspace;
    return userWorkspace && artifactId.startsWith(userWorkspace);
  };

  const handleDeleteArtifact = async (artifactId: string) => {
    if (!artifactManager || !isLoggedIn) return;

    // Confirm deletion
    const artifactName = availableArtifacts.find(a => a.id === artifactId)?.manifest?.name || artifactId;
    if (!window.confirm(`Are you sure you want to delete "${artifactName}"? This action cannot be undone.`)) {
      return;
    }

    try {
      setDeleteError(null);
      setDeletingArtifactId(artifactId);

      await artifactManager.delete({
        artifact_id: artifactId,
        delete_files: true,
        recursive: true,
        _rkwargs: true
      });

      // Refresh the available artifacts list
      await fetchAvailableArtifacts();

      setDeletingArtifactId(null);

      console.log(`Successfully deleted ${artifactId}`);

      // Notify parent component if callback provided
      if (onArtifactUpdated) {
        onArtifactUpdated();
      }
    } catch (err) {
      console.error('Deletion failed:', err);
      const errorMessage = err instanceof Error ? err.message : String(err);
      setDeleteError(`Failed to delete ${artifactId}: ${errorMessage}`);
      setDeletingArtifactId(null);
    }
  };

  const handleOpenCreateApp = () => {
    appManagerRef.current?.openCreateDialog();
  };

  const handleOpenEditApp = (artifact: ArtifactType) => {
    appManagerRef.current?.openEditDialog(artifact);
  };

  const handleArtifactUpdated = () => {
    fetchAvailableArtifacts();
    if (onArtifactUpdated) {
      onArtifactUpdated();
    }
  };

  return (
    <div className="space-y-6">
      {/* Available Apps Header */}
      <div className="flex justify-between items-center">
        <div className="flex items-center">
          <div className="w-10 h-10 bg-white rounded-xl flex items-center justify-center mr-3 p-1">
            <img src="/bioengine-icon.svg" alt="BioEngine" className="w-8 h-8" />
          </div>
          <h3 className="text-lg font-semibold text-gray-800">Available BioEngine Apps</h3>
        </div>
        <div className="flex gap-3">
          <button
            onClick={handleOpenCreateApp}
            disabled={loading}
            className="px-6 py-3 bg-gradient-to-r from-blue-600 to-blue-700 text-white rounded-xl hover:from-blue-700 hover:to-blue-800 disabled:from-gray-400 disabled:to-gray-500 disabled:cursor-not-allowed flex items-center shadow-sm hover:shadow-md transition-all duration-200"
          >
            <svg className="w-4 h-4 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
            </svg>
            Create App
          </button>
          <button
            onClick={fetchAvailableArtifacts}
            disabled={loading}
            className="px-6 py-3 bg-white border-2 border-gray-200 text-gray-700 rounded-xl hover:bg-gray-50 hover:border-gray-300 disabled:bg-gray-100 disabled:cursor-not-allowed flex items-center shadow-sm hover:shadow-md transition-all duration-200"
          >
            {loading ? (
              <div className="w-4 h-4 border-2 border-gray-300 border-t-blue-600 rounded-full animate-spin mr-2"></div>
            ) : null}
            {availableArtifacts.length > 0 ? 'Refresh' : 'Load Artifacts'}
          </button>
        </div>
      </div>

      {/* Deployment Error Display */}
      {deploymentError && setDeploymentError && (
        <div className="p-4 bg-red-50 border border-red-200 rounded-lg">
          <div className="flex justify-between items-start">
            <div className="flex">
              <svg className="w-5 h-5 text-red-400 mr-2 mt-0.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
              <div>
                <h4 className="text-sm font-medium text-red-800">Deployment Error</h4>
                <p className="text-sm text-red-700 mt-1">{deploymentError}</p>
              </div>
            </div>
            <button
              onClick={() => setDeploymentError(null)}
              className="text-red-400 hover:text-red-600"
              aria-label="Dismiss error"
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>
        </div>
      )}

      {/* Error Display */}
      {error && (
        <div className="p-4 bg-red-50 border border-red-200 rounded-lg">
          <div className="flex justify-between items-start">
            <div className="flex">
              <svg className="w-5 h-5 text-red-400 mr-2 mt-0.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
              <div>
                <h4 className="text-sm font-medium text-red-800">Error</h4>
                <p className="text-sm text-red-700 mt-1">{error}</p>
              </div>
            </div>
            <button
              onClick={() => setError(null)}
              className="text-red-400 hover:text-red-600"
              aria-label="Dismiss error"
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>
        </div>
      )}

      {/* Delete Error Display */}
      {deleteError && (
        <div className="p-4 bg-red-50 border border-red-200 rounded-lg">
          <div className="flex justify-between items-start">
            <div className="flex">
              <svg className="w-5 h-5 text-red-400 mr-2 mt-0.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
              <div>
                <h4 className="text-sm font-medium text-red-800">Delete Error</h4>
                <p className="text-sm text-red-700 mt-1">{deleteError}</p>
              </div>
            </div>
            <button
              onClick={() => setDeleteError(null)}
              className="text-red-400 hover:text-red-600"
              aria-label="Dismiss error"
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>
        </div>
      )}

      {/* Loading State */}
      {loading && availableArtifacts.length === 0 && (
        <div className="flex justify-center p-8">
          <p className="text-gray-500">Loading artifacts...</p>
        </div>
      )}

      {/* Empty State */}
      {!loading && availableArtifacts.length === 0 && (
        <div className="flex justify-center p-8">
          <p className="text-gray-500">No deployable artifacts found. Click "Load Artifacts" to fetch available artifacts.</p>
        </div>
      )}

      {/* Artifacts List */}
      {availableArtifacts.length > 0 && (
        <div className="space-y-6">
          {availableArtifacts.map((artifact) => (
            <ArtifactCard
              key={artifact.id}
              artifact={artifact}
              artifactMode={artifactModes[artifact.id]}
              onEdit={() => handleOpenEditApp(artifact)}
              onDeploy={(artifactId, mode) => onDeployArtifact?.(artifactId, mode)}
              onModeChange={(checked) => onModeChange?.(artifact.id, checked)}
              server={server}
              onDeployFeedback={(message, type) => {
                // You can add feedback handling here if needed
                console.log(`Deploy feedback: ${message} (${type})`);
              }}
            />
          ))}
        </div>
      )}

      {/* App Manager Component */}
      <BioEngineAppManager
        ref={appManagerRef}
        serviceId={serviceId}
        server={server}
        isLoggedIn={isLoggedIn}
        onArtifactUpdated={handleArtifactUpdated}
      />
    </div>
  );
};

export default AvailableBioEngineApps;
