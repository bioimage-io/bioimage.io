import React, { useEffect, useMemo, useState } from 'react';

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
}

const AppDeploymentsStatusDialog: React.FC<AppDeploymentsStatusDialogProps> = ({
  isOpen,
  onClose,
  applicationId,
  initialStatus,
  fetchApplicationStatus,
}) => {
  const [logsTail, setLogsTail] = useState<number>(30);
  const [nPreviousReplica, setNPreviousReplica] = useState<number>(0);
  const [status, setStatus] = useState<any>(initialStatus || null);
  const [loading, setLoading] = useState(false);
  const [hasLoaded, setHasLoaded] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setStatus(initialStatus || null);
  }, [initialStatus]);

  const loadStatus = async () => {
    if (!applicationId) return;

    setLoading(true);
    setError(null);

    try {
      const result = await fetchApplicationStatus({
        application_ids: [applicationId],
        logs_tail: logsTail,
        n_previous_replica: nPreviousReplica,
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
      loadStatus();
    }
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

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-xl shadow-xl w-full max-w-6xl max-h-[90vh] overflow-y-auto">
        <div className="px-6 py-4 border-b border-gray-100 flex justify-between items-center sticky top-0 bg-white z-10">
          <div>
            <h3 className="text-xl font-semibold text-gray-800">Application Deployment Status</h3>
            <p className="text-sm text-gray-500 mt-1">Application ID: {applicationId}</p>
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 transition-colors" aria-label="Close dialog">
            <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        <div className="p-6 space-y-6">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4 p-4 bg-gray-50 border border-gray-200 rounded-lg items-end">
            <label className="flex flex-col gap-1">
              <span className="text-sm font-medium text-gray-700">Log Lines</span>
              <input
                type="number"
                value={logsTail}
                onChange={(e) => setLogsTail(parseInt(e.target.value || '0', 10))}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm"
              />
              <span className="text-xs text-gray-500">-1 to retrieve all available logs</span>
            </label>

            <label className="flex flex-col gap-1">
              <span className="text-sm font-medium text-gray-700">Previous Replicas</span>
              <input
                type="number"
                value={nPreviousReplica}
                onChange={(e) => setNPreviousReplica(parseInt(e.target.value || '0', 10))}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm"
              />
              <span className="text-xs text-gray-500">-1 to include all previous replicas</span>
            </label>

            <div className="flex items-end h-full">
              <button
                type="button"
                onClick={loadStatus}
                disabled={loading}
                className="w-full px-4 py-2 bg-blue-600 text-white rounded-lg text-sm font-medium hover:bg-blue-700 disabled:bg-gray-400 h-10"
              >
                {loading ? 'Refreshing...' : 'Refresh Status'}
              </button>
            </div>
          </div>

          {error && (
            <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-lg text-sm">
              {error}
            </div>
          )}

          {(!hasLoaded || loading) ? (
            <div className="flex flex-col items-center justify-center py-16 text-gray-600">
              <div className="w-10 h-10 border-4 border-gray-200 border-t-blue-600 rounded-full animate-spin mb-4" />
              <p className="text-sm font-medium">Loading app status...</p>
              <p className="text-xs text-gray-500 mt-1">Fetching deployments, logs, and replica details</p>
            </div>
          ) : null}

          <div className="p-4 rounded-lg border border-gray-200 bg-gray-50">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3 text-sm">
              <div><span className="font-medium text-gray-700">Status:</span> <span className="text-gray-900">{status?.status || 'UNKNOWN'}</span></div>
              <div><span className="font-medium text-gray-700">Version:</span> <span className="text-gray-900">{status?.version || 'N/A'}</span></div>
              <div><span className="font-medium text-gray-700">Message:</span> <span className="text-gray-900">{status?.message || '-'}</span></div>
              <div><span className="font-medium text-gray-700">Last Updated By:</span> <span className="text-gray-900">{status?.last_updated_by || '-'}</span></div>
            </div>
          </div>

          {loading && hasLoaded ? (
            <div className="flex items-center justify-center py-4 text-sm text-gray-600">
              <div className="w-5 h-5 border-2 border-gray-200 border-t-blue-600 rounded-full animate-spin mr-3" />
              Refreshing deployment status...
            </div>
          ) : null}

          {hasLoaded && !loading && deployments.length === 0 ? (
            <p className="text-sm text-gray-500">No deployment entries found for this application.</p>
          ) : (
            <div className="space-y-4">
              {deployments.map(({ name, data }) => {
                const logs = data?.logs && typeof data.logs === 'object' ? Object.entries(data.logs) : [];

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
                        <p className="text-xs text-gray-500">No logs returned for this deployment.</p>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default AppDeploymentsStatusDialog;
