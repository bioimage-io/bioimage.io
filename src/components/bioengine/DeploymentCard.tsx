import React from 'react';
import { HYPHA_SERVER_URL } from '../../config/hypha';

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
  // Undeploy is now driven from the Monitor & Manage dialog, so the card
  // doesn't need an undeploy handler or an "isUndeploying" flag any more.
  // The status banner still surfaces the DELETING / DEPLOYING phases.
  formatTimeInfo?: (timestamp: number) => { formattedTime: string; uptime: string };
  // Opens the Monitor & Manage dialog for this app. Always present — admins
  // and viewers both get the same monitoring surface; the dialog itself
  // gates write actions (scaling / undeploy) on admin membership upstream.
  onStatusClick?: (applicationId: string) => void;
}

const DeploymentCard: React.FC<DeploymentCardProps> = ({
  deployment,
  serviceId,
  formatTimeInfo,
  onStatusClick
}) => {
  const [mcpCopied, setMcpCopied] = React.useState(false);
  const [appIdCopied, setAppIdCopied] = React.useState(false);
  const [serviceIdCopied, setServiceIdCopied] = React.useState(false);
  const isAppRunning = deployment.status === "RUNNING";
  const hasAppUi = !!deployment.static_site_url;

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
      return `${HYPHA_SERVER_URL}/${workspace}/mcp/${serviceIdentifier}`;
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
      return `${HYPHA_SERVER_URL}/${workspace}/services/${serviceIdentifier}`;
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

  // Color tokens for the static (non-clickable) status banner. Mirrors the
  // resource-pill palette so the card reads as a row of status chips:
  // healthy reads green, deploying/updating amber, deleting muted, terminal
  // failure red. Same set of states the dialog's stateClasses() handles.
  const statusBannerClasses = (state: string): string => {
    switch (state) {
      case 'HEALTHY':
      case 'RUNNING':
        return 'bg-green-50 text-green-700 border-green-200';
      case 'DEPLOYING':
      case 'UPDATING':
        return 'bg-amber-50 text-amber-700 border-amber-200';
      case 'DELETING':
      case 'STOPPING':
      case 'STOPPED':
        return 'bg-gray-100 text-gray-600 border-gray-300';
      case 'DEPLOY_FAILED':
      case 'FAILED':
      case 'UNHEALTHY':
        return 'bg-red-50 text-red-700 border-red-200';
      default:
        return 'bg-gray-50 text-gray-700 border-gray-200';
    }
  };

  const openAppUi = () => {
    if (!deployment.static_site_url) return;
    window.open(deployment.static_site_url, '_blank', 'noopener,noreferrer');
  };

  return (
    <div className="p-6 bg-gradient-to-r from-white to-gray-50 border border-gray-200 rounded-2xl shadow-sm hover:shadow-md transition-shadow duration-200">
      <style>{`
        .card-press { transition: transform 160ms cubic-bezier(0.23, 1, 0.32, 1); }
        .card-press:active:not(:disabled) { transform: scale(0.97); }
      `}</style>

      {/* Title row: app name + version live on the same line as the
          action buttons. Description and Artifact ID render BELOW this
          row at full card width so the buttons' presence doesn't
          shorten them. Both buttons share the same outline-button
          styling so the visual weight stays even. */}
      <div className="mb-4">
        <div className="flex items-center justify-between gap-3 flex-wrap mb-2">
          <div className="flex items-center gap-2 flex-wrap min-w-0">
            <h4 className="text-lg font-semibold">
              {deployment.display_name || deployment.artifact_id.split('/').pop()}
            </h4>

            {deployment.version && (
              <span className="px-2 py-0.5 rounded text-xs font-medium bg-gray-100 text-gray-600 border border-gray-200">
                {deployment.version === 'latest' ? 'latest' : `v${deployment.version}`}
              </span>
            )}

            {deployment.status === "UPDATING" && (
              <div className="ml-1 w-4 h-4 border-2 border-gray-300 border-t-blue-600 rounded-full animate-spin"></div>
            )}
          </div>

          {/* Always-visible header actions. Open App appears to the
              LEFT of Monitor & Manage only when the app exposes a UI
              (static_site_url). Both buttons render identically — the
              Monitor & Manage one is the dependable entry, Open App
              just happens to deep-link out to the app's own UI. */}
          <div className="flex items-center gap-2 flex-shrink-0">
            {hasAppUi && (
              <button
                type="button"
                onClick={openAppUi}
                disabled={!isAppRunning}
                title={isAppRunning ? 'Open the application UI in a new tab' : 'App must be RUNNING to open'}
                className="card-press inline-flex items-center px-3 py-1.5 text-sm font-medium rounded-lg border border-gray-300 bg-white text-gray-700 hover:bg-gray-50 disabled:opacity-60 disabled:cursor-not-allowed"
              >
                {/* Lucide-style external-link: three discrete strokes
                    (arrow tip, diagonal, open-corner box) — no
                    overlapping segments that read as random lines. */}
                <svg className="w-4 h-4 mr-1.5" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" viewBox="0 0 24 24" aria-hidden="true">
                  <path d="M15 3h6v6" />
                  <path d="M10 14L21 3" />
                  <path d="M18 13v6a2 2 0 01-2 2H5a2 2 0 01-2-2V8a2 2 0 012-2h6" />
                </svg>
                Open App
              </button>
            )}
            <button
              type="button"
              onClick={() => onStatusClick?.(deployment.application_id || deployment.artifact_id)}
              title="Open the monitor and manage dialog: logs, replica scaling, undeploy"
              className="card-press inline-flex items-center px-3 py-1.5 text-sm font-medium rounded-lg border border-gray-300 bg-white text-gray-700 hover:bg-gray-50"
            >
              <svg className="w-4 h-4 mr-1.5" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
              </svg>
              Monitor & Manage
            </button>
          </div>
        </div>

        {deployment.description && (
          <p className="text-sm text-gray-600 mt-2">{deployment.description}</p>
        )}
        <p className="text-sm text-gray-500 mt-2 break-all">
          <span className="font-medium">Deployed from Artifact ID:</span> {deployment.artifact_id}
        </p>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <div>
          {/* Application Status: static banner mirroring the resource
              pills below. No longer clickable — the entry point for
              diagnostics now lives in the "Monitor & manage" button up
              top, which is always visible. */}
          <div className="mb-3">
            <p className="text-sm font-medium text-gray-700 mb-2">Application Status:</p>
            <span
              className={`inline-flex items-center px-2 py-1 rounded text-xs font-medium border ${statusBannerClasses(deployment.status)}`}
            >
              <svg className="w-3 h-3 mr-1" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
              {deployment.status}
            </span>
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
              {/* Cap the methods list at a sensible height. Apps with
                  dozens of methods (e.g. cellpose-finetuning) were
                  blowing the card vertical to a screenful; this gives
                  the list its own scroll area so the rest of the card
                  stays compact. ~10 rows of pills before scrolling. */}
              <div className="flex flex-wrap gap-1 max-h-44 overflow-y-auto pr-1">
                {deployment.available_methods.map((method: string) => {
                  // Use new service_ids structure, fallback to legacy serviceId
                  const wsServiceId = deployment.service_ids?.websocket_service_id || serviceId;
                  return wsServiceId ? (
                    <a
                      key={method}
                      href={`${HYPHA_SERVER_URL}/${wsServiceId.split('/')[0]}/services/${wsServiceId.split('/')[1]}/${method}`}
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
