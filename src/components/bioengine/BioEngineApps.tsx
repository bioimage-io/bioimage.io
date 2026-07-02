import React from 'react';
import { useHyphaStore } from '../../store/hyphaStore';
import AvailableBioEngineApps from './AvailableBioEngineApps';
import DeployedBioEngineApps from './DeployedBioEngineApps';

interface BioEngineAppsProps {
  serviceId: string;
  onArtifactUpdated?: (workspace?: string) => void;
  adminUsers?: string[];
  currentUserEmail?: string;
  // Deployment-related props
  deployingArtifactId?: string | null;
  undeployingArtifactId?: string | null;
  pendingDeploymentArtifactId?: string | null;
  artifactModes?: Record<string, string>;
  status?: any;
  onDeployArtifact?: (artifactId: string, mode?: string | null) => void;
  onUndeployArtifact?: (artifactId: string) => void;
  onModeChange?: (artifactId: string, checked: boolean) => void;
  isArtifactDeployed?: (artifactId: string) => boolean;
  getDeploymentStatus?: (artifactId: string) => string | null;
  isDeployButtonDisabled?: (artifactId: string) => boolean;
  getDeployButtonText?: (artifactId: string) => string;
  // Worker errors are surfaced in a top-level ErrorDialog rendered by
  // BioEngineWorker. Children no longer accept setDeploymentError /
  // setUndeploymentError; this comment exists so a future refactor
  // doesn't reintroduce them.
  formatTimeInfo?: (timestamp: number) => { formattedTime: string, uptime: string };
  server?: any;
  fetchApplicationStatus?: (params: {
    application_ids?: string[];
    logs_tail?: number;
    n_previous_replica?: number;
  }) => Promise<any>;
  updateAppScaling?: (params: {
    application_id: string;
    artifact_id: string;
    scaling: Record<string, any>;
  }) => Promise<void>;
  bioengineVersion?: string;
  workerClientId?: string;
}

const BioEngineApps: React.FC<BioEngineAppsProps> = ({
  serviceId,
  onArtifactUpdated,
  adminUsers,
  currentUserEmail,
  deployingArtifactId,
  undeployingArtifactId,
  pendingDeploymentArtifactId,
  artifactModes = {},
  status,
  onDeployArtifact,
  onUndeployArtifact,
  onModeChange,
  isArtifactDeployed,
  getDeploymentStatus,
  isDeployButtonDisabled,
  getDeployButtonText,
  formatTimeInfo,
  server,
  fetchApplicationStatus,
  updateAppScaling,
  bioengineVersion,
  workerClientId,
}) => {
  const { server: hyphaServer, isLoggedIn } = useHyphaStore();
  const activeServer = server || hyphaServer;

  return (
    <div className="space-y-6">
      {/* Deployed BioEngine Apps Section */}
      {status && (
        <DeployedBioEngineApps
          status={status}
          undeployingArtifactId={undeployingArtifactId}
          onUndeployArtifact={onUndeployArtifact!}
          formatTimeInfo={formatTimeInfo}
          fetchApplicationStatus={fetchApplicationStatus}
          updateAppScaling={updateAppScaling}
          bioengineVersion={bioengineVersion}
          workerClientId={workerClientId}
        />
      )}

      {/* Available BioEngine Apps Section */}
      <AvailableBioEngineApps
        serviceId={serviceId}
        server={activeServer}
        isLoggedIn={isLoggedIn}
        adminUsers={adminUsers}
        currentUserEmail={currentUserEmail}
        deployingArtifactId={deployingArtifactId}
        pendingDeploymentArtifactId={pendingDeploymentArtifactId}
        artifactModes={artifactModes}
        onDeployArtifact={onDeployArtifact}
        onUndeployArtifact={onUndeployArtifact}
        onModeChange={onModeChange}
        isArtifactDeployed={isArtifactDeployed}
        getDeploymentStatus={getDeploymentStatus}
        isDeployButtonDisabled={isDeployButtonDisabled}
        getDeployButtonText={getDeployButtonText}
        onArtifactUpdated={onArtifactUpdated}
      />
    </div>
  );
};

export default BioEngineApps;