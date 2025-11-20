import React from 'react';

interface DeploymentCardProps {
  deployment: {
    artifact_id: string;
    application_id?: string;  // New: unique deployment instance ID
    display_name?: string;
    description?: string;
    deployment_name: string;
    status: string;
    start_time?: number;
    available_methods?: string[];
    replica_states?: Record<string, number>;
    resources?: {
      num_cpus?: number;
      num_gpus?: number;
      memory?: number;
    };
    service_ids?: {  // New: independent service IDs
      websocket_service_id?: string;
      webrtc_service_id?: string;
    };
  };
  serviceId?: string;
  isUndeploying?: boolean;
  onUndeploy: (applicationId: string) => void;  // Changed: uses application_id
  formatTimeInfo?: (timestamp: number) => { formattedTime: string; uptime: string };
}

const DeploymentCard: React.FC<DeploymentCardProps> = ({
  deployment,
  serviceId,
  isUndeploying = false,
  onUndeploy,
  formatTimeInfo
}) => {
  const [mcpCopied, setMcpCopied] = React.useState(false);
  const [isHovered, setIsHovered] = React.useState(false);

  // Helper function to format bytes to GB
  const formatMemoryToGB = (bytes: number): string => {
    const gb = bytes / (1024 * 1024 * 1024);
    return gb < 1 ? `${Math.round(gb * 1024)} MB` : `${gb.toFixed(1)} GB`;
  };

  // Get MCP URL from websocket service ID
  const getMcpUrl = (): string | null => {
    const wsServiceId = deployment.service_ids?.websocket_service_id || serviceId;
    if (!wsServiceId) return null;

    const parts = wsServiceId.split('/');
    if (parts.length >= 2) {
      const workspace = parts[0];
      const serviceIdentifier = parts.slice(1).join('/');
      return `https://hypha.aicell.io/${workspace}/mcp/${serviceIdentifier}`;
    }
    return null;
  };

  // Get Service Info URL from websocket service ID
  const getServiceInfoUrl = (): string | null => {
    const wsServiceId = deployment.service_ids?.websocket_service_id || serviceId;
    if (!wsServiceId) return null;

    const parts = wsServiceId.split('/');
    if (parts.length >= 2) {
      const workspace = parts[0];
      const serviceIdentifier = parts.slice(1).join('/');
      return `https://hypha.aicell.io/${workspace}/services/${serviceIdentifier}`;
    }
    return null;
  };

  const handleCopyMcpUrl = async () => {
    const mcpUrl = getMcpUrl();
    if (!mcpUrl) return;

    try {
      await navigator.clipboard.writeText(mcpUrl);
      setMcpCopied(true);
      setTimeout(() => setMcpCopied(false), 2000);
    } catch (err) {
      console.error('Failed to copy MCP URL:', err);
    }
  };

  return (
    <div
      className="p-6 bg-gradient-to-r from-white to-gray-50 border border-gray-200 rounded-2xl shadow-sm hover:shadow-md transition-all duration-200"
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
    >
      <div className="flex justify-between items-start mb-4">
        <div>
          <div className="flex items-center mb-2">
            <h4 className="text-lg font-semibold">
              {deployment.display_name || deployment.artifact_id.split('/').pop()}
            </h4>

            <div className="flex items-center ml-3">
              <span className={`inline-flex items-center px-2 py-1 rounded text-xs font-medium ${deployment.status === "HEALTHY" || deployment.status === "RUNNING"
                ? "bg-green-100 text-green-700 border border-green-200"
                : "bg-gray-100 text-gray-700 border border-gray-200"
                }`}>
                {deployment.status}
              </span>
              {deployment.status === "UPDATING" && (
                <div className="ml-2 w-4 h-4 border-2 border-gray-300 border-t-blue-600 rounded-full animate-spin"></div>
              )}
            </div>
          </div>

          <p className="text-sm text-gray-500">{deployment.artifact_id}</p>
          {deployment.description && (
            <p className="text-sm text-gray-600 mt-2">{deployment.description}</p>
          )}
        </div>

        <div className={`transition-opacity duration-200 ${isHovered || isUndeploying || deployment.status === "DELETING" ? 'opacity-100' : 'opacity-0'}`}>
          {isUndeploying ? (
            <button
              disabled={true}
              className="px-4 py-2 text-sm bg-gradient-to-r from-red-400 to-red-500 text-white rounded-xl opacity-50 cursor-not-allowed flex items-center shadow-sm"
            >
              <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin mr-2"></div>
              {deployment.status === "DEPLOYING" ? "Canceling..." : "Undeploying..."}
            </button>
          ) : deployment.status === "DELETING" ? (
            <button
              disabled={true}
              className="px-4 py-2 text-sm bg-gradient-to-r from-gray-400 to-gray-500 text-white rounded-xl opacity-50 cursor-not-allowed flex items-center shadow-sm"
            >
              <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin mr-2"></div>
              Deleting...
            </button>
          ) : (
            <button
              onClick={() => onUndeploy(deployment.application_id || deployment.artifact_id)}
              className="px-4 py-2 text-sm bg-gradient-to-r from-red-500 to-red-600 text-white rounded-xl hover:from-red-600 hover:to-red-700 shadow-sm hover:shadow-md transition-all duration-200"
            >
              {deployment.status === "DEPLOYING" ? "Cancel Deployment" : "Undeploy"}
            </button>
          )}
        </div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <div>
          {deployment.start_time && formatTimeInfo && (
            <div className="mb-3">
              <p className="text-sm text-gray-600">
                <span className="font-medium">Start Time:</span> {formatTimeInfo(deployment.start_time).formattedTime}
              </p>
              <p className="text-sm text-gray-600">
                <span className="font-medium">Uptime:</span> {formatTimeInfo(deployment.start_time).uptime}
              </p>
            </div>
          )}

          {deployment.replica_states && Object.keys(deployment.replica_states).length > 0 && (
            <div>
              <p className="text-sm font-medium text-gray-700 mb-2">Replica States:</p>
              <div className="flex flex-wrap gap-2">
                {Object.entries(deployment.replica_states).map(([state, count]) => (
                  <span
                    key={state}
                    className={`inline-flex items-center px-2 py-1 rounded text-xs font-medium border ${state === "RUNNING"
                      ? "bg-green-50 text-green-700 border-green-200"
                      : "bg-gray-50 text-gray-700 border-gray-200"
                      }`}
                  >
                    {state}: {count}
                  </span>
                ))}
              </div>
            </div>
          )}
        </div>

        <div>
          <p className="text-sm text-gray-600 mb-3">
            <span className="font-medium">Deployment name:</span> {deployment.deployment_name}
          </p>

          {deployment.resources && (
            (deployment.resources.num_cpus != null && deployment.resources.num_cpus > 0) ||
            (deployment.resources.num_gpus != null && deployment.resources.num_gpus > 0) ||
            (deployment.resources.memory != null && deployment.resources.memory > 0)
          ) && (
              <div className="mb-3">
                <p className="text-sm font-medium text-gray-700 mb-2">Resources:</p>
                <div className="flex flex-wrap gap-2">
                  {deployment.resources.num_cpus != null && deployment.resources.num_cpus > 0 && (
                    <span className="inline-flex items-center px-2 py-1 rounded text-xs font-medium bg-blue-50 text-blue-700 border border-blue-200">
                      <svg className="w-3 h-3 mr-1" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 3v2m6-2v2M9 19v2m6-2v2M5 9H3m2 6H3m18-6h-2m2 6h-2M7 19h10a2 2 0 002-2V7a2 2 0 00-2-2H7a2 2 0 00-2 2v10a2 2 0 002 2z" />
                      </svg>
                      {deployment.resources.num_cpus} CPU{deployment.resources.num_cpus > 1 ? 's' : ''}
                    </span>
                  )}
                  {deployment.resources.num_gpus != null && deployment.resources.num_gpus > 0 && (
                    <span className="inline-flex items-center px-2 py-1 rounded text-xs font-medium bg-purple-50 text-purple-700 border border-purple-200">
                      <svg className="w-3 h-3 mr-1" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
                      </svg>
                      {deployment.resources.num_gpus} GPU{deployment.resources.num_gpus > 1 ? 's' : ''}
                    </span>
                  )}
                  {deployment.resources.memory != null && deployment.resources.memory > 0 && (
                    <span className="inline-flex items-center px-2 py-1 rounded text-xs font-medium bg-green-50 text-green-700 border border-green-200">
                      <svg className="w-3 h-3 mr-1" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 7v10c0 2.21 3.582 4 8 4s8-1.79 8-4V7M4 7c0 2.21 3.582 4 8 4s8-1.79 8-4M4 7c0-2.21 3.582-4 8-4s8 1.79 8 4" />
                      </svg>
                      {formatMemoryToGB(deployment.resources.memory)}
                    </span>
                  )}
                </div>
              </div>
            )}

          {/* Service Info and Copy MCP Server Buttons */}
          {(getServiceInfoUrl() || getMcpUrl()) && deployment.status !== "DEPLOYING" && (
            <div className="mb-3 flex flex-wrap gap-2">
              {getServiceInfoUrl() && (
                <a
                  href={getServiceInfoUrl()!}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center px-3 py-1.5 rounded text-xs font-medium bg-blue-50 text-blue-700 border border-blue-200 hover:bg-blue-100 hover:text-blue-800 transition-colors cursor-pointer"
                >
                  <svg className="w-3 h-3 mr-1.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                  </svg>
                  Service Info
                </a>
              )}
              {getMcpUrl() && (
                <button
                  onClick={handleCopyMcpUrl}
                  className="inline-flex items-center px-3 py-1.5 rounded text-xs font-medium bg-purple-50 text-purple-700 border border-purple-200 hover:bg-purple-100 hover:text-purple-800 transition-colors cursor-pointer"
                >
                  <svg className="w-3 h-3 mr-1.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
                  </svg>
                  {mcpCopied ? 'Copied!' : 'Copy MCP Server URL'}
                </button>
              )}
            </div>
          )}

          {deployment.available_methods && deployment.available_methods.length > 0 && deployment.status !== "DEPLOYING" && (
            <div>
              <p className="text-sm font-medium text-gray-700 mb-2">Available Methods:</p>
              <div className="flex flex-wrap gap-1">
                {deployment.available_methods.map((method: string) => {
                  // Use new service_ids structure, fallback to legacy serviceId
                  const wsServiceId = deployment.service_ids?.websocket_service_id || serviceId;
                  return wsServiceId ? (
                    <a
                      key={method}
                      href={`https://hypha.aicell.io/${wsServiceId.split('/')[0]}/services/${wsServiceId.split('/')[1]}/${method}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center px-2 py-1 rounded text-xs font-medium bg-blue-50 text-blue-700 border border-blue-200 hover:bg-blue-100 hover:text-blue-800 transition-colors cursor-pointer"
                    >
                      {method}
                    </a>
                  ) : (
                    <span
                      key={method}
                      className="inline-flex items-center px-2 py-1 rounded text-xs font-medium bg-gray-50 text-gray-400 border border-gray-200 cursor-not-allowed opacity-60"
                      title="Service ID not available yet"
                    >
                      {method}
                    </span>
                  );
                })}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default DeploymentCard;
