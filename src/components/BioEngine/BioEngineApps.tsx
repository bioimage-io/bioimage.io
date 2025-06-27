import React from 'react';
import { useHyphaStore } from '../../store/hyphaStore';
import AvailableBioEngineApps from './AvailableBioEngineApps';
import DeployedBioEngineApps from './DeployedBioEngineApps';

interface BioEngineAppsProps {
  serviceId: string;
  onArtifactUpdated?: () => void;
  // Deployment-related props
  deployingArtifactId?: string | null;
  undeployingArtifactId?: string | null;
  artifactModes?: Record<string, string>;
  status?: any;
  onDeployArtifact?: (artifactId: string, mode?: string | null) => void;
  onUndeployArtifact?: (artifactId: string) => void;
  onModeChange?: (artifactId: string, checked: boolean) => void;
  isArtifactDeployed?: (artifactId: string) => boolean;
  getDeploymentStatus?: (artifactId: string) => string | null;
  isDeployButtonDisabled?: (artifactId: string) => boolean;
  getDeployButtonText?: (artifactId: string) => string;
  // Error states and utility functions
  deploymentError?: string | null;
  undeploymentError?: string | null;
  setDeploymentError?: (error: string | null) => void;
  setUndeploymentError?: (error: string | null) => void;
  formatTimeInfo?: (timestamp: number) => { formattedTime: string, uptime: string };
  server?: any;
}

const BioEngineApps: React.FC<BioEngineAppsProps> = ({
  serviceId,
  onArtifactUpdated,
  deployingArtifactId,
  undeployingArtifactId,
  artifactModes = {},
  status,
  onDeployArtifact,
  onUndeployArtifact,
  onModeChange,
  isArtifactDeployed,
  getDeploymentStatus,
  isDeployButtonDisabled,
  getDeployButtonText,
  deploymentError,
  undeploymentError,
  setDeploymentError,
  setUndeploymentError,
  formatTimeInfo,
  server
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
          undeploymentError={undeploymentError}
          setUndeploymentError={setUndeploymentError}
        />
      )}

      {/* Available BioEngine Apps Section */}
      <AvailableBioEngineApps
        serviceId={serviceId}
        server={activeServer}
        isLoggedIn={isLoggedIn}
        deployingArtifactId={deployingArtifactId}
        artifactModes={artifactModes}
        deploymentError={deploymentError}
        setDeploymentError={setDeploymentError}
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