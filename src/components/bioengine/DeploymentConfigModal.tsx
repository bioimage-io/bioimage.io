import React, { useState, useEffect } from 'react';

interface DeploymentConfigModalProps {
  isOpen: boolean;
  onClose: () => void;
  onDeploy: (config: any) => void;
  artifactId: string;
  initialMode: string | null; // 'cpu' or 'gpu'
  bioengineApps?: Record<string, any>; // All bioengine apps keyed by application ID
  initialApplicationId?: string;
  manifest?: any; // App manifest for hints (deployment names, etc.)
}

/** Extract deployment class names from manifest.deployments ("module:ClassName" entries). */
function getDeploymentClassNames(manifest?: any): string[] {
  if (!Array.isArray(manifest?.deployments)) return [];
  return manifest.deployments
    .map((d: string) => (typeof d === 'string' ? d.split(':').pop() || d : ''))
    .filter(Boolean);
}

const DeploymentConfigModal: React.FC<DeploymentConfigModalProps> = ({
  isOpen,
  onClose,
  onDeploy,
  artifactId,
  initialMode,
  bioengineApps,
  initialApplicationId,
  manifest,
}) => {
  const [version, setVersion] = useState<string>('');
  const [applicationId, setApplicationId] = useState<string>('');
  const [kwargs, setKwargs] = useState<string>('{}');
  const [envVars, setEnvVars] = useState<string>('{}');
  const [hyphaToken, setHyphaToken] = useState<string>('');
  const [disableGpu, setDisableGpu] = useState<boolean>(false);
  const [maxOngoingRequests, setMaxOngoingRequests] = useState<number | ''>(10);
  const [autoRedeploy, setAutoRedeploy] = useState<boolean>(false);
  const [debug, setDebug] = useState<boolean>(false);
  const [authorizedUsers, setAuthorizedUsers] = useState<string>('');
  const [iceServers, setIceServers] = useState<string>('');
  const [error, setError] = useState<string | null>(null);
  const [showAdvanced, setShowAdvanced] = useState<boolean>(false);

  // Check if app is recovered and should show warning
  // For testing: either set REACT_APP_TEST_RECOVERED_APP=true in .env, or
  // set localStorage.setItem('test_recovered_app', 'true') in browser console
  const testMode = process.env.REACT_APP_TEST_RECOVERED_APP === 'true' ||
                   typeof window !== 'undefined' && localStorage.getItem('test_recovered_app') === 'true';

  // Look up the app by its applicationId to check if it's recovered
  const appData = applicationId && bioengineApps ? bioengineApps[applicationId] : null;
  const showRecoveredAppWarning = applicationId && (testMode || appData?.recovered_app === true);

  const applicationIdPattern = /^[a-zA-Z0-9][a-zA-Z0-9_-]*$/;
  const hasApplicationId = applicationId.trim().length > 0;
  const isApplicationIdValid = !hasApplicationId || applicationIdPattern.test(applicationId);
  const selectedApp = hasApplicationId && bioengineApps ? bioengineApps[applicationId.trim()] : null;
  const isUpdateTarget = Boolean(selectedApp && typeof selectedApp === 'object' && ['RUNNING', 'HEALTHY'].includes(selectedApp.status));

  // Deployment class names from manifest (for hints)
  const deploymentClassNames = getDeploymentClassNames(manifest);

  useEffect(() => {
    if (isOpen) {
      setApplicationId(initialApplicationId || '');
      setError(null);
      setHyphaToken('');

      // Pre-populate from running app metadata when updating
      const runningApp = initialApplicationId && bioengineApps
        ? bioengineApps[initialApplicationId]
        : null;
      const isRunning = Boolean(runningApp && ['RUNNING', 'HEALTHY'].includes(runningApp?.status));

      if (isRunning && runningApp) {
        setVersion(runningApp.version || '');

        const appKwargs = runningApp.application_kwargs ?? null;
        setKwargs(appKwargs && typeof appKwargs === 'object' && Object.keys(appKwargs).length > 0
          ? JSON.stringify(appKwargs, null, 2)
          : '{}');

        const appEnvVars = runningApp.application_env_vars ?? null;
        setEnvVars(appEnvVars && typeof appEnvVars === 'object' && Object.keys(appEnvVars).length > 0
          ? JSON.stringify(appEnvVars, null, 2)
          : '{}');

        // get_app_status returns gpu_enabled (= !disable_gpu); recovered apps also return disable_gpu directly
        const disableGpuVal = runningApp.disable_gpu !== undefined
          ? Boolean(runningApp.disable_gpu)
          : runningApp.gpu_enabled !== undefined ? !runningApp.gpu_enabled : false;
        setDisableGpu(disableGpuVal);

        setMaxOngoingRequests(runningApp.max_ongoing_requests ?? 10);
        setAutoRedeploy(runningApp.auto_redeploy ?? false);
        // debug is only returned for recovered apps; default false otherwise
        setDebug(runningApp.debug ?? false);

        // authorized_users (v0.8.0+): dict keyed by method name
        const appAuthorizedUsers = runningApp.authorized_users ?? null;
        setAuthorizedUsers(appAuthorizedUsers && typeof appAuthorizedUsers === 'object'
          ? JSON.stringify(appAuthorizedUsers, null, 2)
          : '');

        // ice_servers (v0.7.2+): list of STUN/TURN server configs
        const appIceServers = runningApp.ice_servers ?? null;
        setIceServers(Array.isArray(appIceServers) && appIceServers.length > 0
          ? JSON.stringify(appIceServers, null, 2)
          : '');

        setShowAdvanced(false);
      } else {
        setVersion('');
        setKwargs('{}');
        setEnvVars('{}');
        setDisableGpu(false);
        setMaxOngoingRequests(10);
        setAutoRedeploy(false);
        setDebug(false);
        setAuthorizedUsers('');
        setIceServers('');
        setShowAdvanced(false);
      }
    }
  }, [isOpen, initialMode, initialApplicationId]);

  if (!isOpen) return null;

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!isApplicationIdValid) {
      setError('Application ID contains invalid characters. Allowed: letters, numbers, underscore (_), and hyphen (-).');
      return;
    }

    try {
        let parsedKwargs = null;
        if (kwargs && kwargs.trim() !== '') {
            parsedKwargs = JSON.parse(kwargs);
        }

        let parsedEnvVars = null;
        if (envVars && envVars.trim() !== '') {
            parsedEnvVars = JSON.parse(envVars);
        }

        let parsedAuthorizedUsers = null;
        if (authorizedUsers && authorizedUsers.trim() !== '') {
            parsedAuthorizedUsers = JSON.parse(authorizedUsers);
        }

        let parsedIceServers = null;
        if (iceServers && iceServers.trim() !== '') {
            parsedIceServers = JSON.parse(iceServers);
        }

        onDeploy({
            artifact_id: artifactId,
            version: version || null,
            application_id: applicationId || null,
            application_kwargs: parsedKwargs && Object.keys(parsedKwargs).length > 0 ? parsedKwargs : null,
            application_env_vars: parsedEnvVars && Object.keys(parsedEnvVars).length > 0 ? parsedEnvVars : null,
            hypha_token: hyphaToken || null,
            disable_gpu: disableGpu,
            max_ongoing_requests: maxOngoingRequests !== '' ? maxOngoingRequests : null,
            auto_redeploy: autoRedeploy,
            debug: debug,
            authorized_users: parsedAuthorizedUsers,
            ice_servers: parsedIceServers,
        });
        onClose();
    } catch (err) {
        setError('Invalid JSON in one or more fields. Please ensure valid JSON format.');
    }
  };

  const textareaSx = "w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-blue-500 focus:border-blue-500 text-gray-900 font-mono text-sm overflow-x-auto whitespace-pre";

  return (
    <div className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-xl shadow-xl w-full max-w-2xl max-h-[90vh] overflow-y-auto flex flex-col">
        <div className="px-6 py-4 border-b border-gray-100 flex justify-between items-center sticky top-0 bg-white z-10">
          <h3 className="text-xl font-semibold text-gray-800">{isUpdateTarget ? 'Update Application' : 'Deploy Application'}</h3>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 transition-colors">
            <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-6 space-y-4">
          {error && (
            <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-lg text-sm mb-4">
              {error}
            </div>
          )}

          {isUpdateTarget && !showRecoveredAppWarning && (
            <div className="bg-blue-50 border border-blue-200 text-blue-800 px-4 py-3 rounded-lg text-sm mb-4">
              Parameters loaded from the running application. Hypha token is not shown and must be re-entered if needed.
            </div>
          )}

          {showRecoveredAppWarning && (
            <div className="bg-yellow-50 border border-yellow-200 text-yellow-800 px-4 py-3 rounded-lg text-sm mb-4">
              <div className="font-semibold mb-2">⚠️ Recovered Application Warning</div>
              <p className="mb-2">This application was recovered from the Ray cluster after the BioEngine worker restarted and lost its secret environment variables and Hypha token.</p>
              <ul className="list-disc list-inside mb-2 space-y-1">
                <li>Secret environment variables (starting with underscore) will be lost when updating</li>
                <li>The Hypha token stored for this app will be lost</li>
              </ul>
              <p className="mb-2"><strong>To ensure they are available in the updated application:</strong></p>
              <ul className="list-disc list-inside space-y-1">
                <li>All environment variables must be provided again in the JSON field below</li>
                <li>The Hypha token must be entered again if needed</li>
                <li>Changing the Environment Variables (JSON) will overwrite all existing env vars</li>
              </ul>
            </div>
          )}

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="md:col-span-2">
              <label className="block text-sm font-medium text-gray-700 mb-1">Artifact ID</label>
              <input
                type="text"
                value={artifactId}
                disabled
                className="w-full px-3 py-2 bg-gray-50 border border-gray-300 rounded-lg text-gray-500 cursor-not-allowed"
              />
            </div>

            <div className="md:col-span-2">
              <label className="block text-sm font-medium text-gray-700 mb-1">Application ID (Optional)</label>
              <input
                type="text"
                value={applicationId}
                onChange={(e) => setApplicationId(e.target.value)}
                placeholder="Auto-generated"
                className={`w-full px-3 py-2 border rounded-lg focus:ring-blue-500 focus:border-blue-500 text-gray-900 ${
                  isApplicationIdValid ? 'border-gray-300' : 'border-red-300 bg-red-50'
                }`}
              />
              {!isApplicationIdValid && (
                <p className="text-xs text-red-600 mt-1">
                  Invalid Application ID. Allowed characters: letters, numbers, underscore (_), and hyphen (-).
                </p>
              )}
              {isApplicationIdValid && hasApplicationId && (
                <p className="text-xs text-gray-600 mt-1">
                  {isUpdateTarget
                    ? 'This ID matches a currently running app. Submitting will update that deployment instance.'
                    : 'This ID is currently unused. Submitting will create a new deployment instance with this ID.'}
                </p>
              )}
            </div>

            <div className="md:col-span-2">
              <label className="block text-sm font-medium text-gray-700 mb-1">Version</label>
              <input
                type="text"
                value={version}
                onChange={(e) => setVersion(e.target.value)}
                placeholder="Latest"
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-blue-500 focus:border-blue-500 text-gray-900"
              />
            </div>

            <div className="md:col-span-2">
              <button
                type="button"
                onClick={() => setShowAdvanced(!showAdvanced)}
                className="flex items-center text-sm font-medium text-blue-600 hover:text-blue-800 focus:outline-none"
              >
                <svg
                  className={`w-4 h-4 mr-1 transition-transform ${showAdvanced ? 'rotate-180' : ''}`}
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                </svg>
                {showAdvanced ? 'Hide Advanced Parameters' : 'Show Advanced Parameters'}
              </button>
            </div>

            {showAdvanced && (
              <>
                <div className="md:col-span-2">
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    Application Kwargs (JSON)
                    <span className="text-gray-400 font-normal ml-2 text-xs">Keyword arguments passed to each deployment in the app at initialization</span>
                  </label>
                  <textarea
                    value={kwargs}
                    onChange={(e) => setKwargs(e.target.value)}
                    style={{ resize: 'vertical', minHeight: `${Math.max(3, (kwargs.match(/\n/g) || []).length + 2) * 1.5}em` }}
                    className={textareaSx}
                    placeholder="{}"
                    wrap="off"
                  />
                  {deploymentClassNames.length > 0 && (
                    <p className="text-xs text-gray-500 mt-1">
                      Deployments in this app: {deploymentClassNames.map(n => (
                        <code key={n} className="bg-gray-100 px-0.5 rounded mx-0.5">{n}</code>
                      ))}.
                    </p>
                  )}
                </div>

                <div className="md:col-span-2">
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    Environment Variables (JSON)
                    <span className="text-gray-400 font-normal ml-2 text-xs">Environment variables injected into each deployment in the app</span>
                  </label>
                  <textarea
                    value={envVars}
                    onChange={(e) => setEnvVars(e.target.value)}
                    style={{ resize: 'vertical', minHeight: `${Math.max(3, (envVars.match(/\n/g) || []).length + 2) * 1.5}em` }}
                    className={textareaSx}
                    placeholder="{}"
                    wrap="off"
                  />
                  {isUpdateTarget && (
                    <p className="text-xs text-gray-500 mt-1">
                      Variables prefixed with <code className="bg-gray-100 px-0.5 rounded">_</code> are secret: their value is shown as <code className="bg-gray-100 px-0.5 rounded">*****</code> here, but the app receives them without the prefix and with the original value (e.g. <code className="bg-gray-100 px-0.5 rounded">_HYPHA_TOKEN</code> → <code className="bg-gray-100 px-0.5 rounded">HYPHA_TOKEN</code>).
                    </p>
                  )}
                </div>

                <div className="md:col-span-2">
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    Authorized Users (JSON)
                    <span className="text-gray-400 font-normal ml-2 text-xs">Per-method access control</span>
                  </label>
                  <textarea
                    value={authorizedUsers}
                    onChange={(e) => setAuthorizedUsers(e.target.value)}
                    style={{ resize: 'vertical', minHeight: `${Math.max(3, (authorizedUsers.match(/\n/g) || []).length + 2) * 1.5}em` }}
                    className={textareaSx}
                    placeholder={'{\n  "*": ["*"]\n}'}
                    wrap="off"
                  />
                  <p className="text-xs text-gray-500 mt-1">
                    Dict mapping method names to allowed user lists. Use <code className="bg-gray-100 px-0.5 rounded">"*"</code> as key to apply a rule to all methods; <code className="bg-gray-100 px-0.5 rounded">["*"]</code> as value for public access.
                    Example: <code className="bg-gray-100 px-0.5 rounded">{"{"}"run_inference": ["*"], "train": ["admin@lab.edu"]{"}"}</code>.
                    Leave empty to use the app's default access control (public access).
                    Admin users are always added automatically.
                  </p>
                </div>

                <div className="md:col-span-2">
                  <label className="block text-sm font-medium text-gray-700 mb-1">Hypha Token</label>
                  <input
                    type="password"
                    value={hyphaToken}
                    onChange={(e) => setHyphaToken(e.target.value)}
                    autoComplete="off"
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-blue-500 focus:border-blue-500 text-gray-900"
                    placeholder="None"
                  />
                  <p className="text-xs text-gray-500 mt-1">
                    Sets <code className="bg-gray-100 px-0.5 rounded">HYPHA_TOKEN</code> for all deployments in this app. To use different tokens per deployment, set <code className="bg-gray-100 px-0.5 rounded">_HYPHA_TOKEN</code> in the Environment Variables field above instead — the leading underscore keeps the value secret.
                  </p>
                </div>

                <div className="md:col-span-2">
                  <label className="block text-sm font-medium text-gray-700 mb-1">Max Ongoing Requests</label>
                  <input
                    type="number"
                    min="1"
                    value={maxOngoingRequests}
                    onChange={(e) => setMaxOngoingRequests(e.target.value === '' ? '' : parseInt(e.target.value))}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-blue-500 focus:border-blue-500 text-gray-900"
                  />
                  <p className="text-xs text-gray-500 mt-1">Maximum number of requests the Hypha service wrapper handles concurrently. This does not change the concurrency settings of individual deployments inside the app — a deployment such as a training job may still only process one request at a time regardless of this value.</p>
                </div>

                <div className="md:col-span-2 space-y-3 pt-1">
                  <label className="flex items-start space-x-3 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={disableGpu}
                      onChange={(e) => setDisableGpu(e.target.checked)}
                      className="w-4 h-4 mt-0.5 text-blue-600 border-gray-300 rounded focus:ring-blue-500 flex-shrink-0"
                    />
                    <span>
                      <span className="text-sm font-medium text-gray-700 block">Disable GPU</span>
                      <span className="text-xs text-gray-500">Force CPU-only mode even if the app requests a GPU. Useful for testing or when no GPU is available.</span>
                    </span>
                  </label>

                  <label className="flex items-start space-x-3 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={autoRedeploy}
                      onChange={(e) => setAutoRedeploy(e.target.checked)}
                      className="w-4 h-4 mt-0.5 text-blue-600 border-gray-300 rounded focus:ring-blue-500 flex-shrink-0"
                    />
                    <span>
                      <span className="text-sm font-medium text-gray-700 block">Auto Redeploy</span>
                      <span className="text-xs text-gray-500">Automatically redeploy this app if it enters a failed or unhealthy state. Recommended for production apps that should recover without manual intervention.</span>
                    </span>
                  </label>

                  <label className="flex items-start space-x-3 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={debug}
                      onChange={(e) => setDebug(e.target.checked)}
                      className="w-4 h-4 mt-0.5 text-blue-600 border-gray-300 rounded focus:ring-blue-500 flex-shrink-0"
                    />
                    <span>
                      <span className="text-sm font-medium text-gray-700 block">Debug Mode</span>
                      <span className="text-xs text-gray-500">Enable verbose logging for all deployments in this app. Increases log output — use only for troubleshooting.</span>
                    </span>
                  </label>
                </div>

                <div className="md:col-span-2">
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    ICE Servers (JSON)
                    <span className="text-gray-400 font-normal ml-2 text-xs">Custom STUN/TURN servers for WebRTC</span>
                  </label>
                  <textarea
                    value={iceServers}
                    onChange={(e) => setIceServers(e.target.value)}
                    style={{ resize: 'vertical', minHeight: `${Math.max(5, (iceServers.match(/\n/g) || []).length + 2) * 1.5}em` }}
                    className={textareaSx}
                    placeholder={'[\n  { "urls": "stun:stun.example.com:3478" },\n  { "urls": "turn:turn.example.com:3478", "username": "user", "credential": "pass" }\n]'}
                    wrap="off"
                  />
                  <p className="text-xs text-gray-500 mt-1">
                    Inject custom STUN/TURN servers at deploy time. If left empty, the public ICE servers at hypha.aicell.io (located in Stockholm, Sweden) will be used.
                  </p>
                </div>
              </>
            )}
          </div>

          <div className="flex justify-end space-x-3 pt-6 border-t border-gray-100 mt-4">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 bg-white text-gray-700 border border-gray-300 rounded-lg text-sm font-medium hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={!isApplicationIdValid}
              className="px-4 py-2 bg-blue-600 text-white rounded-lg text-sm font-medium hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500"
            >
              {isUpdateTarget ? 'Update' : 'Deploy'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};

export default DeploymentConfigModal;
