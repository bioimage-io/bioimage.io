import React, { useState, useEffect, useCallback, useRef } from 'react';
import ReactDOM from 'react-dom';
import { useHyphaStore } from '../../store/hyphaStore';
import { HYPHA_SERVER_URL } from '../../config/hypha';

// The app most startup configurations want, kept at the top of the dropdown
// instead of buried in the alphabetical list.
const PINNED_ARTIFACT_ID = 'bioimage-io/model-runner';

// One selectable artifact in the Artifact ID dropdown.
interface ArtifactOption {
  id: string;
  name: string;
  description: string;
  group: string;
  pinned: boolean;
}

interface DeploymentConfigModalProps {
  isOpen: boolean;
  onClose: () => void;
  onDeploy: (config: any) => void;
  artifactId: string;
  initialMode: string | null; // 'cpu' or 'gpu'
  bioengineApps?: Record<string, any>; // All bioengine apps keyed by application ID
  initialApplicationId?: string;
  manifest?: any; // App manifest for hints (deployment names, etc.)
  // Let the user type the artifact ID instead of rendering it read-only. Used by the
  // BioEngine setup wizard, where no artifact card was clicked to pick one.
  editableArtifactId?: boolean;
  // Prefill every field from a previously emitted deploy config. Takes precedence over
  // the running-app lookup. Used by the wizard to reopen a configured startup application.
  initialConfig?: Record<string, any> | null;
  title?: string;
  submitLabel?: string;
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
  editableArtifactId = false,
  initialConfig = null,
  title,
  submitLabel,
}) => {
  const { server, isLoggedIn } = useHyphaStore();
  const [artifactIdValue, setArtifactIdValue] = useState<string>(artifactId);
  const [artifactOptions, setArtifactOptions] = useState<ArtifactOption[]>([]);
  const [isLoadingArtifacts, setIsLoadingArtifacts] = useState<boolean>(false);
  const [showArtifactList, setShowArtifactList] = useState<boolean>(false);
  const [highlightedOption, setHighlightedOption] = useState<number>(-1);
  const artifactPickerRef = useRef<HTMLDivElement>(null);
  const [tokenIsManual, setTokenIsManual] = useState<boolean>(false);
  const [isGeneratingToken, setIsGeneratingToken] = useState<boolean>(false);
  const [tokenError, setTokenError] = useState<string | null>(null);
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
  const [scaling, setScaling] = useState<string>('');
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

  const asJsonText = (value: any, emptyText: string) =>
    value && typeof value === 'object' && Object.keys(value).length > 0
      ? JSON.stringify(value, null, 2)
      : emptyText;

  // The app runs as the deploying user, so it gets that user's own token rather
  // than an admin one. Same 30-day lifetime as the worker setup wizard. Only ever
  // runs on an explicit click: the field stays empty unless the user asks for a
  // token, so nothing is put on the wire that the app did not need.
  const generateToken = useCallback(async () => {
    if (!isLoggedIn || !server) return;
    setIsGeneratingToken(true);
    setTokenError(null);
    try {
      const thirtyDays = 30 * 24 * 3600;
      const generatedToken = await server.generateToken({ permission: 'read_write', expires_in: thirtyDays });
      setHyphaToken(generatedToken);
      setTokenIsManual(false);
    } catch (err) {
      setTokenError(`Failed to generate token: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setIsGeneratingToken(false);
    }
  }, [isLoggedIn, server]);

  // Artifact picker options: BioImage.IO applications first, then the ones in
  // the user's own workspace. Only fetched for the wizard's editable field.
  useEffect(() => {
    if (!isOpen || !editableArtifactId) return;
    let cancelled = false;

    // Only ray-serve artifacts are deployable by a BioEngine worker, the same
    // filter the dashboard's app list uses.
    const toOptions = (items: any[], group: string): ArtifactOption[] => (items || [])
      .filter((item: any) => item?.manifest?.type === 'ray-serve')
      .map((item: any): ArtifactOption => ({
        id: item.id,
        name: item.manifest?.name || item.alias || item.id,
        description: item.manifest?.description || item.description || '',
        group,
        pinned: item.id === PINNED_ARTIFACT_ID,
      }))
      .sort((a, b) => Number(b.pinned) - Number(a.pinned) || a.id.localeCompare(b.id));

    const loadArtifacts = async () => {
      setIsLoadingArtifacts(true);
      const options: ArtifactOption[] = [];

      // The BioImage.IO applications are public, so they load over plain HTTP
      // and are listed even before the user logs in.
      try {
        const filters = encodeURIComponent(JSON.stringify({ type: 'application' }));
        const response = await fetch(`${HYPHA_SERVER_URL}/bioimage-io/artifacts/applications/children?limit=200&filters=${filters}`);
        if (response.ok) {
          options.push(...toOptions(await response.json(), 'BioImage.IO applications'));
        }
      } catch (err) {
        // The picker is a convenience over a free-text field, so a failed
        // listing just leaves the user typing the ID manually.
        console.error('Failed to list BioImage.IO applications:', err);
      }

      // The user's own applications need the authenticated connection.
      const userWorkspace: string | undefined = server?.config?.workspace;
      if (server && isLoggedIn && userWorkspace && userWorkspace !== 'bioimage-io') {
        try {
          const artifactManager = await server.getService('public/artifact-manager');
          const items = await artifactManager.list({
            parent_id: `${userWorkspace}/applications`,
            filters: { type: 'application' },
            _rkwargs: true,
          });
          options.push(...toOptions(items, 'My applications'));
        } catch {
          // Workspace has no applications collection — nothing to add.
        }
      }

      if (!cancelled) {
        setArtifactOptions(options);
        setIsLoadingArtifacts(false);
      }
    };

    loadArtifacts();
    return () => { cancelled = true; };
  }, [isOpen, editableArtifactId, server, isLoggedIn]);

  // Close the artifact dropdown on a click outside of it.
  useEffect(() => {
    if (!showArtifactList) return;
    const handlePointerDown = (event: MouseEvent) => {
      if (!artifactPickerRef.current?.contains(event.target as Node)) {
        setShowArtifactList(false);
      }
    };
    document.addEventListener('mousedown', handlePointerDown);
    return () => document.removeEventListener('mousedown', handlePointerDown);
  }, [showArtifactList]);

  useEffect(() => {
    if (isOpen) {
      setError(null);
      setHyphaToken('');
      setTokenIsManual(false);
      setTokenError(null);
      setHighlightedOption(-1);
      setArtifactIdValue(initialConfig?.artifact_id ?? artifactId ?? '');
      // The field is focused but the list stays closed: an open list would cover
      // the rest of the form before the user has asked to see it.
      setShowArtifactList(false);

      // Reopening an already-configured deployment (wizard startup applications):
      // every value comes from the config we emitted last time.
      if (initialConfig) {
        setApplicationId(initialConfig.application_id || '');
        setVersion(initialConfig.version || '');
        setKwargs(asJsonText(initialConfig.application_kwargs, '{}'));
        setEnvVars(asJsonText(initialConfig.application_env_vars, '{}'));
        setHyphaToken(initialConfig.hypha_token || '');
        setDisableGpu(Boolean(initialConfig.disable_gpu));
        setMaxOngoingRequests(initialConfig.max_ongoing_requests ?? 10);
        setAutoRedeploy(Boolean(initialConfig.auto_redeploy));
        setDebug(Boolean(initialConfig.debug));
        setAuthorizedUsers(asJsonText(initialConfig.authorized_users, ''));
        setIceServers(Array.isArray(initialConfig.ice_servers) && initialConfig.ice_servers.length > 0
          ? JSON.stringify(initialConfig.ice_servers, null, 2)
          : '');
        setScaling(asJsonText(initialConfig.scaling, ''));
        setShowAdvanced(false);
        return;
      }

      setApplicationId(initialApplicationId || '');

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

        // scaling (v0.10+): per-deployment Ray Serve replica map keyed
        // by @bioengine.app class name. Show the current value as
        // pretty-printed JSON so the user can edit it inline.
        const appScaling = runningApp.scaling ?? null;
        setScaling(appScaling && typeof appScaling === 'object' && Object.keys(appScaling).length > 0
          ? JSON.stringify(appScaling, null, 2)
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
        setScaling('');
        setShowAdvanced(false);
      }
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen, initialMode, initialApplicationId, initialConfig, artifactId]);

  if (!isOpen) return null;

  // Typing filters the list but never restricts what can be submitted: the field
  // stays free text so artifacts outside these two workspaces remain reachable.
  const artifactQuery = artifactIdValue.trim().toLowerCase();
  const filteredArtifactOptions = artifactQuery
    ? artifactOptions.filter(option =>
        option.id.toLowerCase().includes(artifactQuery) ||
        option.name.toLowerCase().includes(artifactQuery) ||
        option.description.toLowerCase().includes(artifactQuery))
    : artifactOptions;

  const selectArtifactOption = (option: ArtifactOption) => {
    setArtifactIdValue(option.id);
    setShowArtifactList(false);
    setHighlightedOption(-1);
  };

  const handleArtifactKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      if (!showArtifactList) { setShowArtifactList(true); return; }
      if (filteredArtifactOptions.length === 0) return;
      const step = e.key === 'ArrowDown' ? 1 : -1;
      const next = (highlightedOption + step + filteredArtifactOptions.length) % filteredArtifactOptions.length;
      setHighlightedOption(next);
    } else if (e.key === 'Enter' && showArtifactList && highlightedOption >= 0) {
      e.preventDefault();
      selectArtifactOption(filteredArtifactOptions[highlightedOption]);
    } else if (e.key === 'Escape' && showArtifactList) {
      e.preventDefault();
      setShowArtifactList(false);
      setHighlightedOption(-1);
    }
  };

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

        let parsedScaling = null;
        if (scaling && scaling.trim() !== '') {
            parsedScaling = JSON.parse(scaling);
        }

        onDeploy({
            artifact_id: editableArtifactId ? artifactIdValue.trim() : artifactId,
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
            scaling: parsedScaling && Object.keys(parsedScaling).length > 0 ? parsedScaling : null,
        });
        onClose();
    } catch (err) {
        setError('Invalid JSON in one or more fields. Please ensure valid JSON format.');
    }
  };

  const textareaSx = "w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-blue-500 focus:border-blue-500 text-gray-900 font-mono text-sm overflow-x-auto whitespace-pre";

  // Portalled to <body>: any ancestor with a transform or backdrop-filter (the
  // BioEngine page uses backdrop-blur cards) becomes the containing block for
  // position:fixed, which would centre the dialog inside that card instead of
  // the viewport.
  return ReactDOM.createPortal(
    <div className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-xl shadow-xl w-full max-w-2xl max-h-[90vh] overflow-y-auto flex flex-col">
        <div className="px-6 py-4 border-b border-gray-100 flex justify-between items-center sticky top-0 bg-white z-10">
          <h3 className="text-xl font-semibold text-gray-800">{title ?? (isUpdateTarget ? 'Update Application' : 'Deploy Application')}</h3>
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
              Parameters loaded from the running application. The stored Hypha token is never read back, so generate or paste a new one under Advanced Parameters if the app needs it.
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
                <li>The Hypha token must be generated or entered again under Advanced Parameters if needed</li>
                <li>Changing the Environment Variables (JSON) will overwrite all existing env vars</li>
              </ul>
            </div>
          )}

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="md:col-span-2">
              <label className="block text-sm font-medium text-gray-700 mb-1">Artifact ID</label>
              {editableArtifactId ? (
                <>
                  <div ref={artifactPickerRef} className="relative">
                    <input
                      type="text"
                      role="combobox"
                      aria-expanded={showArtifactList}
                      aria-controls="artifact-id-listbox"
                      aria-autocomplete="list"
                      autoComplete="off"
                      // A freshly added startup application opens straight into this
                      // field, which also brings up the application list.
                      autoFocus={!artifactIdValue}
                      value={artifactIdValue}
                      onChange={(e) => { setArtifactIdValue(e.target.value); setShowArtifactList(true); setHighlightedOption(-1); }}
                      onFocus={() => setShowArtifactList(true)}
                      onKeyDown={handleArtifactKeyDown}
                      placeholder="workspace/artifact-name"
                      className="w-full pl-3 pr-9 py-2 border border-gray-300 rounded-lg focus:ring-blue-500 focus:border-blue-500 text-gray-900"
                    />
                    <button
                      type="button"
                      aria-label={showArtifactList ? 'Hide application list' : 'Show application list'}
                      onClick={() => setShowArtifactList(open => !open)}
                      className="absolute inset-y-0 right-0 flex items-center px-2 text-gray-400 hover:text-gray-600"
                    >
                      <svg className={`w-4 h-4 transition-transform ${showArtifactList ? 'rotate-180' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                      </svg>
                    </button>

                    {showArtifactList && (
                      <ul
                        id="artifact-id-listbox"
                        role="listbox"
                        className="absolute z-10 mt-1 w-full max-h-72 overflow-y-auto bg-white border border-gray-200 rounded-lg shadow-lg"
                      >
                        {isLoadingArtifacts && (
                          <li className="px-3 py-2 text-sm text-gray-500">Loading applications...</li>
                        )}
                        {!isLoadingArtifacts && filteredArtifactOptions.length === 0 && (
                          <li className="px-3 py-2 text-sm text-gray-500">
                            {artifactOptions.length === 0 ? 'No applications found. Type an artifact ID instead.' : 'No match. Type an artifact ID instead.'}
                          </li>
                        )}
                        {filteredArtifactOptions.map((option, index) => (
                          <React.Fragment key={option.id}>
                            {(index === 0 || filteredArtifactOptions[index - 1].group !== option.group) && (
                              <li
                                role="presentation"
                                className="sticky top-0 px-3 py-1 bg-gray-50 border-b border-gray-100 text-xs font-semibold text-gray-500 uppercase tracking-wide"
                              >
                                {option.group}
                              </li>
                            )}
                            <li
                              role="option"
                              aria-selected={option.id === artifactIdValue.trim()}
                              onMouseEnter={() => setHighlightedOption(index)}
                              onClick={() => selectArtifactOption(option)}
                              className={`px-3 py-2 cursor-pointer border-b border-gray-50 last:border-b-0 ${
                                index === highlightedOption ? 'bg-blue-50' : 'hover:bg-gray-50'
                              }`}
                            >
                              <div className="flex items-center gap-1.5 min-w-0">
                                {option.pinned && (
                                  <svg className="w-3.5 h-3.5 flex-shrink-0 text-amber-500" fill="currentColor" viewBox="0 0 20 20" aria-label="Recommended">
                                    <path d="M9.049 2.927c.3-.921 1.603-.921 1.902 0l1.286 3.958a1 1 0 00.95.69h4.162c.969 0 1.371 1.24.588 1.81l-3.367 2.446a1 1 0 00-.363 1.118l1.286 3.958c.3.921-.755 1.688-1.539 1.118l-3.366-2.446a1 1 0 00-1.176 0l-3.366 2.446c-.784.57-1.838-.197-1.539-1.118l1.286-3.958a1 1 0 00-.363-1.118L2.063 9.385c-.783-.57-.38-1.81.588-1.81h4.163a1 1 0 00.951-.69l1.284-3.958z" />
                                  </svg>
                                )}
                                <code className="block text-sm text-gray-800 font-medium truncate">{option.id}</code>
                              </div>
                              {option.description && (
                                <span
                                  className="text-xs text-gray-500 mt-0.5 overflow-hidden"
                                  style={{ display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical' }}
                                >
                                  {option.description}
                                </span>
                              )}
                            </li>
                          </React.Fragment>
                        ))}
                      </ul>
                    )}
                  </div>
                  <p className="text-xs text-gray-500 mt-1">
                    Pick an application from the list, or type any artifact ID as <code className="bg-gray-100 px-0.5 rounded">workspace/artifact-name</code>.
                  </p>
                </>
              ) : (
                <input
                  type="text"
                  value={artifactId}
                  disabled
                  className="w-full px-3 py-2 bg-gray-50 border border-gray-300 rounded-lg text-gray-500 cursor-not-allowed"
                />
              )}
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
              {/* Whether this ID collides with a running app is only meaningful on the
                  dashboard. The wizard configures a worker that does not exist yet. */}
              {isApplicationIdValid && hasApplicationId && !editableArtifactId && (
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
                  <div className="flex items-center justify-between mb-1">
                    <label className="block text-sm font-medium text-gray-700">Hypha Token</label>
                    {isLoggedIn && (
                      <button
                        type="button"
                        onClick={() => { setTokenIsManual(false); generateToken(); }}
                        disabled={isGeneratingToken}
                        className="flex items-center px-2 py-1 text-xs text-blue-600 bg-blue-50 border border-blue-200 rounded hover:bg-blue-100 disabled:opacity-50 transition-colors"
                      >
                        {isGeneratingToken ? (
                          <div className="w-3 h-3 border border-blue-600 border-t-transparent rounded-full animate-spin mr-1" />
                        ) : (
                          <svg className="w-3 h-3 mr-1" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                          </svg>
                        )}
                        Generate Token (30 days)
                      </button>
                    )}
                  </div>
                  <input
                    type="password"
                    value={hyphaToken}
                    onChange={(e) => { setHyphaToken(e.target.value); setTokenIsManual(true); }}
                    autoComplete="new-password"
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-blue-500 focus:border-blue-500 text-gray-900"
                    placeholder={isGeneratingToken ? 'Generating...' : 'None'}
                  />
                  {tokenError && <p className="text-xs text-red-600 mt-1">{tokenError}</p>}
                  {isLoggedIn && !tokenIsManual && hyphaToken && (
                    <p className="text-xs text-green-600 mt-1">Generated 30-day read/write token for your own Hypha workspace. Generate a new one here when it expires.</p>
                  )}
                  <p className="text-xs text-gray-500 mt-1">
                    Sets <code className="bg-gray-100 px-0.5 rounded">HYPHA_TOKEN</code> for all deployments in this app, so the app can reach Hypha as you: read your private artifacts, stream BioEngine datasets, and register its own services. To use different tokens per deployment, set <code className="bg-gray-100 px-0.5 rounded">_HYPHA_TOKEN</code> in the Environment Variables field above instead. The leading underscore keeps the value secret.
                  </p>
                  {editableArtifactId && hyphaToken && (
                    <p className="text-xs text-amber-700 mt-1">
                      This token is written into the generated startup command, so treat that command as a secret. Clear the field to let the worker mint its own token for this application instead.
                    </p>
                  )}
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
                  <p className="text-xs text-gray-500 mt-1">Maximum number of requests the Hypha service wrapper handles concurrently. This does not change the concurrency settings of individual deployments inside the app. A deployment such as a training job may still only process one request at a time regardless of this value.</p>
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
                      <span className="text-xs text-gray-500">Enable verbose logging for all deployments in this app. Increases log output. Use only for troubleshooting.</span>
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

                <div className="md:col-span-2">
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    Replica Scaling (JSON)
                    <span className="text-gray-400 font-normal ml-2 text-xs">Per-deployment Ray Serve replica configuration</span>
                  </label>
                  <textarea
                    value={scaling}
                    onChange={(e) => setScaling(e.target.value)}
                    style={{ resize: 'vertical', minHeight: `${Math.max(5, (scaling.match(/\n/g) || []).length + 2) * 1.5}em` }}
                    className={textareaSx}
                    placeholder={'{\n  "DeploymentClass": { "num_replicas": 3 },\n  "AnotherDeployment": { "autoscaling_config": { "min_replicas": 1, "max_replicas": 8, "target_num_ongoing_requests_per_replica": 4 } }\n}'}
                    wrap="off"
                  />
                  <p className="text-xs text-gray-500 mt-1">
                    Dict keyed by the <code className="bg-gray-100 px-0.5 rounded">@bioengine.app</code> class name (as shown under "deployments" in app status). Each entry is either <code className="bg-gray-100 px-0.5 rounded">{'{ "num_replicas": N }'}</code> or <code className="bg-gray-100 px-0.5 rounded">{'{ "autoscaling_config": { ... } }'}</code>. The two are mutually exclusive. Classes left out run at Ray Serve's default of one fixed replica. ProxyDeployment is always one replica and not addressable.
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
              {submitLabel ?? (isUpdateTarget ? 'Update' : 'Deploy')}
            </button>
          </div>
        </form>
      </div>
    </div>,
    document.body
  );
};

export default DeploymentConfigModal;
