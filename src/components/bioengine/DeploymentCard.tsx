import React from 'react';

interface DeploymentCardProps {
  deployment: {
    artifact_id: string;
    application_id?: string;  // New: unique deployment instance ID
    display_name?: string;
    description?: string;
    deployment_name: string;
    version?: string;
    status: string;
    start_time?: number;
    last_updated_at?: number;
    static_site_url?: string | null;
    available_methods?: string[];
    replica_states?: Record<string, number>;
    // Flat union of `deployments[*].replicas[]` from worker.get_app_status
    // (aggregated by BioEngineWorker). Each replica carries node placement
    // info as of bioengine 0.10.12+. May be missing on older workers.
    replicas?: Array<{
      replica_id?: string;
      node_id?: string;
      node_ip?: string;
      node_instance_id?: string;
      state?: string;
      pid?: number;
      start_time_s?: number;
    }>;
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
  onStatusClick?: (applicationId: string) => void;
}

const DeploymentCard: React.FC<DeploymentCardProps> = ({
  deployment,
  serviceId,
  isUndeploying = false,
  onUndeploy,
  formatTimeInfo,
  onStatusClick
}) => {
  const [mcpCopied, setMcpCopied] = React.useState(false);
  const [appIdCopied, setAppIdCopied] = React.useState(false);
  const [serviceIdCopied, setServiceIdCopied] = React.useState(false);
  const [isHovered, setIsHovered] = React.useState(false);
  const isAppRunning = deployment.status === "RUNNING";

  // Helper function to format bytes to GB
  const formatMemoryToGB = (bytes: number): string => {
    const gb = bytes / (1024 * 1024 * 1024);
    return gb < 1 ? `${Math.round(gb * 1024)} MB` : `${gb.toFixed(1)} GB`;
  };

  const resources = deployment.resources ?? null;

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

  const handleCopyAppId = async () => {
    try {
      await navigator.clipboard.writeText(deployment.deployment_name);
      setAppIdCopied(true);
      setTimeout(() => setAppIdCopied(false), 2000);
    } catch { /* ignore */ }
  };

  const handleCopyServiceId = async () => {
    const wsServiceId = deployment.service_ids?.websocket_service_id || serviceId;
    if (!wsServiceId) return;
    try {
      await navigator.clipboard.writeText(wsServiceId);
      setServiceIdCopied(true);
      setTimeout(() => setServiceIdCopied(false), 2000);
    } catch { /* ignore */ }
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

            {deployment.version && (
              <span className="ml-2 px-2 py-0.5 rounded text-xs font-medium bg-gray-100 text-gray-600 border border-gray-200">
                {deployment.version === 'latest' ? 'latest' : `v${deployment.version}`}
              </span>
            )}

            {deployment.status === "UPDATING" && (
              <div className="ml-3 w-4 h-4 border-2 border-gray-300 border-t-blue-600 rounded-full animate-spin"></div>
            )}
          </div>

          {deployment.description && (
            <p className="text-sm text-gray-600 mt-2">{deployment.description}</p>
          )}
          <p className="text-sm text-gray-500 mt-2">
            <span className="font-medium">Deployed from Artifact ID:</span> {deployment.artifact_id}
          </p>
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
          {/* Application Status: clickable badge opens the deployment status dialog */}
          <div className="mb-3 flex items-center gap-2">
            <span className="text-sm font-medium text-gray-700">Application Status:</span>
            <button
              type="button"
              onClick={() => onStatusClick?.(deployment.application_id || deployment.artifact_id)}
              className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold border shadow-sm transition-all duration-200 cursor-pointer focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 ${deployment.status === "HEALTHY" || deployment.status === "RUNNING"
                ? "bg-green-100 text-green-800 border-green-300 hover:bg-green-200 hover:border-green-400"
                : "bg-gray-100 text-gray-800 border-gray-300 hover:bg-gray-200 hover:border-gray-400"
                }`}
              title="Click to view deployment status, logs, and replica details"
            >
              {deployment.status}
              <svg className="w-3 h-3 opacity-80" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
              </svg>
            </button>
          </div>

          {deployment.start_time && formatTimeInfo && (
            <div className="mb-3">
              <p className="text-sm text-gray-600">
                <span className="font-medium">Start Time:</span> {formatTimeInfo(deployment.start_time).formattedTime}
              </p>
              <p className="text-sm text-gray-600">
                <span className="font-medium">Uptime:</span> {formatTimeInfo(deployment.start_time).uptime}
              </p>
              {deployment.last_updated_at && (
                <p className="text-sm text-gray-600">
                  <span className="font-medium">Last Update:</span> {formatTimeInfo(deployment.last_updated_at).formattedTime}
                </p>
              )}
            </div>
          )}

          {resources && (
            (resources.num_cpus != null && resources.num_cpus > 0) ||
            (resources.num_gpus != null && resources.num_gpus > 0) ||
            (resources.memory != null && resources.memory > 0)
          ) && (
            <div>
              <p className="text-sm font-medium text-gray-700 mb-2">Resources:</p>
              <div className="flex flex-wrap gap-2">
                {resources.num_cpus != null && resources.num_cpus > 0 && (
                  <span className="inline-flex items-center px-2 py-1 rounded text-xs font-medium bg-blue-50 text-blue-700 border border-blue-200">
                    <svg className="w-3 h-3 mr-1" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 3v2m6-2v2M9 19v2m6-2v2M5 9H3m2 6H3m18-6h-2m2 6h-2M7 19h10a2 2 0 002-2V7a2 2 0 00-2-2H7a2 2 0 00-2 2v10a2 2 0 002 2z" />
                    </svg>
                    {resources.num_cpus} CPU{resources.num_cpus !== 1 ? 's' : ''}
                  </span>
                )}
                {resources.num_gpus != null && resources.num_gpus > 0 && (
                  <span className="inline-flex items-center px-2 py-1 rounded text-xs font-medium bg-purple-50 text-purple-700 border border-purple-200">
                    <svg className="w-3 h-3 mr-1" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
                    </svg>
                    {resources.num_gpus} GPU{resources.num_gpus !== 1 ? 's' : ''}
                  </span>
                )}
                {resources.memory != null && resources.memory > 0 && (
                  <span className="inline-flex items-center px-2 py-1 rounded text-xs font-medium bg-green-50 text-green-700 border border-green-200">
                    <svg className="w-3 h-3 mr-1" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 7v10c0 2.21 3.582 4 8 4s8-1.79 8-4V7M4 7c0 2.21 3.582 4 8 4s8-1.79 8-4M4 7c0-2.21 3.582-4 8-4s8 1.79 8 4" />
                    </svg>
                    {formatMemoryToGB(resources.memory)}
                  </span>
                )}
              </div>
            </div>
          )}

          {deployment.static_site_url && (
            <div className="mt-3">
              <p className="text-sm font-medium text-gray-700 mb-2">App UI:</p>
              <button
                type="button"
                onClick={() => window.open(deployment.static_site_url!, "_blank", "noopener,noreferrer")}
                disabled={!isAppRunning}
                className={`inline-flex items-center px-3 py-1.5 rounded text-xs font-medium border transition-colors ${isAppRunning
                  ? "bg-emerald-50 text-emerald-700 border-emerald-200 hover:bg-emerald-100 hover:text-emerald-800 cursor-pointer"
                  : "bg-gray-100 text-gray-400 border-gray-200 cursor-not-allowed"
                  }`}
                title={isAppRunning ? "Open app in a new tab" : "App must be RUNNING to open"}
              >
                <svg className="w-3 h-3 mr-1.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13.5 6H10a2 2 0 00-2 2v8a2 2 0 002 2h8a2 2 0 002-2v-3.5m-9-4.5L21 3m0 0v6m0-6h-6" />
                </svg>
                Open App
              </button>
            </div>
          )}
        </div>

        <div>
          {/* Application ID with copy button */}
          <div className="flex items-center gap-2 mb-2">
            <p className="text-sm text-gray-600">
              <span className="font-medium">Application ID:</span> {deployment.deployment_name}
            </p>
            <button
              onClick={handleCopyAppId}
              title="Copy Application ID"
              className="flex-shrink-0 p-1 rounded text-gray-400 hover:text-gray-600 hover:bg-gray-100 transition-colors"
            >
              {appIdCopied
                ? <svg className="w-3.5 h-3.5 text-green-600" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" /></svg>
                : <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" /></svg>
              }
            </button>
          </div>

          {/* Service ID with copy button */}
          {(deployment.service_ids?.websocket_service_id || serviceId) && (
            <div className="flex items-center gap-2 mb-3">
              <p className="text-sm text-gray-600 truncate">
                <span className="font-medium">Service ID:</span>{' '}
                <span className="font-mono text-xs">{deployment.service_ids?.websocket_service_id || serviceId}</span>
              </p>
              <button
                onClick={handleCopyServiceId}
                title="Copy Service ID"
                className="flex-shrink-0 p-1 rounded text-gray-400 hover:text-gray-600 hover:bg-gray-100 transition-colors"
              >
                {serviceIdCopied
                  ? <svg className="w-3.5 h-3.5 text-green-600" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" /></svg>
                  : <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" /></svg>
                }
              </button>
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
