import React from 'react';
import DeploymentCard from './DeploymentCard';

interface DeployedBioEngineAppsProps {
  status?: any;
  undeployingArtifactId?: string | null;
  onUndeployArtifact: (artifactId: string) => void;
  formatTimeInfo?: (timestamp: number) => { formattedTime: string; uptime: string };
  undeploymentError?: string | null;
  setUndeploymentError?: (error: string | null) => void;
}

const DeployedBioEngineApps: React.FC<DeployedBioEngineAppsProps> = ({
  status,
  undeployingArtifactId,
  onUndeployArtifact,
  formatTimeInfo,
  undeploymentError,
  setUndeploymentError
}) => {
  const [copySuccess, setCopySuccess] = React.useState(false);

  const deployments = Object.entries(status?.bioengine_apps || {})
    .filter(([key, value]) => key !== 'service_id' && key !== 'note' && typeof value === 'object' && value !== null)
    .map(([key, value]) => ({
      artifact_id: key,
      ...(value as any)
    }));

  const hasDeployments = deployments.length > 0;
  const deploymentNote = status?.bioengine_apps?.note;
  const deploymentServiceId = status?.bioengine_apps?.service_id;

  const handleCopyServiceId = async () => {
    if (!deploymentServiceId) return;

    try {
      await navigator.clipboard.writeText(deploymentServiceId);
      setCopySuccess(true);
      setTimeout(() => setCopySuccess(false), 2000); // Reset after 2 seconds
    } catch (err) {
      console.error('Failed to copy service ID:', err);
      // Fallback for browsers that don't support clipboard API
      const textArea = document.createElement('textarea');
      textArea.value = deploymentServiceId;
      document.body.appendChild(textArea);
      textArea.select();
      try {
        document.execCommand('copy');
        setCopySuccess(true);
        setTimeout(() => setCopySuccess(false), 2000);
      } catch (fallbackErr) {
        console.error('Fallback copy failed:', fallbackErr);
      }
      document.body.removeChild(textArea);
    }
  };

  return (
    <div className="mb-8">
      <div className="flex justify-between items-center mb-6">
        <div className="flex items-center">
          <div className="w-10 h-10 bg-gradient-to-r from-indigo-500 to-indigo-600 rounded-xl flex items-center justify-center mr-3">
            <svg className="w-5 h-5 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19.428 15.428a2 2 0 00-1.022-.547l-2.387-.477a6 6 0 00-3.86.517l-.318.158a6 6 0 01-3.86.517L6.05 15.21a2 2 0 00-1.806.547M8 4h8l-1 1v5.172a2 2 0 00.586 1.414l5 5c1.26 1.26.367 3.414-1.415 3.414H4.828c-1.782 0-2.674-2.154-1.414-3.414l5-5A2 2 0 009 10.172V5L8 4z" />
            </svg>
          </div>
          <h3 className="text-lg font-semibold text-gray-800">Deployed BioEngine Apps</h3>
        </div>
      </div>

      {/* Undeployment Error Display */}
      {undeploymentError && setUndeploymentError && (
        <div className="mb-4 p-4 bg-red-50 border border-red-200 rounded-lg">
          <div className="flex justify-between items-start">
            <div className="flex">
              <svg className="w-5 h-5 text-red-400 mr-2 mt-0.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
              <div>
                <h4 className="text-sm font-medium text-red-800">Undeployment Error</h4>
                <p className="text-sm text-red-700 mt-1">{undeploymentError}</p>
              </div>
            </div>
            <button
              onClick={() => setUndeploymentError(null)}
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

      {deploymentServiceId && (
        <div className="mb-6">
          <button
            onClick={handleCopyServiceId}
            className={`px-4 py-2 text-sm font-medium rounded-lg border transition-all duration-200 flex items-center ${copySuccess
                ? 'bg-green-50 text-green-700 border-green-200'
                : 'bg-gray-50 text-gray-700 border-gray-200 hover:bg-gray-100 hover:border-gray-300'
              }`}
            title="Copy service ID to clipboard"
          >
            {copySuccess ? (
              <>
                <svg className="w-4 h-4 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                </svg>
                Copied Service ID!
              </>
            ) : (
              <>
                <svg className="w-4 h-4 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-2a2 2 0 00-2 2v8a2 2 0 01-2 2z" />
                </svg>
                Copy Service ID
              </>
            )}
          </button>
        </div>
      )}

      {!hasDeployments && deploymentNote ? (
        <div className="text-center py-8">
          <p className="text-gray-500">{deploymentNote}</p>
        </div>
      ) : hasDeployments ? (
        <div className="space-y-6">
          {deployments.map((deployment, index) => (
            <DeploymentCard
              key={index}
              deployment={deployment}
              serviceId={deploymentServiceId}
              isUndeploying={undeployingArtifactId === deployment.artifact_id}
              onUndeploy={onUndeployArtifact}
              formatTimeInfo={formatTimeInfo}
            />
          ))}
        </div>
      ) : null}

      <div className="border-t border-gray-200 my-6"></div>
    </div>
  );
};

export default DeployedBioEngineApps;
