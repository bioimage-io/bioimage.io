import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useHyphaStore } from '../../store/hyphaStore';
import BioEnginePageHeader from './BioEnginePageHeader';
import AgentPromptBox from './AgentPromptBox';
import { useObservedWorkspaces, DEFAULT_PUBLIC_WORKSPACE } from './hooks/useObservedWorkspaces';
import {
  discoverWorkers, fetchWorkerApps,
  discoverWorkersHttp, fetchWorkerAppsHttp,
  DeployedApp,
} from './workerDiscovery';
import { useWorkspaceToken } from './hooks/useWorkspaceToken';

/**
 * `/bioengine/apps` — calling applications that are already deployed.
 *
 * For people who neither run nor administer a worker and only want to use what
 * is already running on one. Each observed workspace gets its own box, filled
 * in as its results arrive: discovery is two round trips deep (find the
 * workspace's workers, then ask each worker what it has deployed), so waiting
 * for all workspaces before showing any would leave the page blank for as long
 * as the slowest one takes.
 */

const SKILL_URL = 'https://bioimage.io/skills/bioengine/SKILL.md';

// Matches the worker-admin page: long enough to outlast a working session,
// and read_write rather than admin because calling an app never needs to
// change permissions.
const TOKEN_LIFETIME_SECONDS = 12 * 3600;
const TOKEN_LIFETIME_LABEL = '12 hours';

// `?apps=` names the selected apps, so a link can be handed to a colleague or
// produced by an agent and reopened with the same apps ticked. Short ids only,
// comma-separated:
//   /#/bioengine/apps?apps=bioimage-io/model-runner,bioimage-io/cellpose3-runner
//
// Individual deployments are deliberately NOT representable here. The URL names
// which APPS are of interest; where they happen to be deployed is a detail of
// the moment, and a deployment's client id changes on every pod roll, so a link
// carrying one would rot.
const APPS_PARAM = 'apps';

// The app this website itself runs on. Selected by default and badged, the same
// way the KTH worker is on the admin page, so the one most people want is
// already ticked and visibly the house app rather than an arbitrary first row.
const FEATURED_APP_SHORT_ID = 'bioimage-io/model-runner';

const parseAppsParam = (raw: string | null): string[] =>
  (raw || '')
    .split(',')
    .map(v => v.trim())
    .filter(Boolean);


type WorkspaceState = {
  status: 'loading' | 'loaded' | 'error';
  apps: DeployedApp[];
  error?: string;
};

const buildPrompt = (serviceIds: string[], token: string): string => {
  const parts = [
    `Read ${SKILL_URL} and follow it to call BioEngine applications that are already deployed. Ask me what I want to run, then inspect the app's available methods before calling them.`,
  ];
  if (serviceIds.length > 0) {
    const noun = serviceIds.length === 1 ? 'this app' : 'these apps';
    parts.push(`Use ${noun}:\n${serviceIds.map(id => `  - ${id}`).join('\n')}`);
  }
  if (token) {
    parts.push(
      `Use this Hypha token (valid for ${TOKEN_LIFETIME_LABEL}, ask me to generate a new one if it has expired):\nHYPHA_TOKEN=${token}`,
    );
  }
  return parts.join('\n\n');
};

const BioEngineAppsPage: React.FC = () => {
  const { server, isLoggedIn } = useHyphaStore();
  const userWorkspace = server?.config?.workspace as string | undefined;

  const defaultWorkspaces = useMemo(() => {
    const ws = [DEFAULT_PUBLIC_WORKSPACE];
    if (isLoggedIn && userWorkspace && userWorkspace !== DEFAULT_PUBLIC_WORKSPACE) ws.push(userWorkspace);
    return ws;
  }, [isLoggedIn, userWorkspace]);

  const { observedWorkspaces, addWorkspace, removeWorkspace } = useObservedWorkspaces(defaultWorkspaces);

  // A link may name apps in a workspace this browser has never observed, in
  // which case nothing would be discovered and the link would look broken.
  // Add those workspaces once, up front.
  const requestedWorkspacesApplied = useRef(false);
  useEffect(() => {
    if (requestedWorkspacesApplied.current) return;
    requestedWorkspacesApplied.current = true;
    const wanted = new Set(
      [...pendingRef.current].map(id => id.split('/')[0]).filter(Boolean),
    );
    wanted.forEach(ws => { if (!observedWorkspaces.includes(ws)) addWorkspace(ws); });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const [byWorkspace, setByWorkspace] = useState<Record<string, WorkspaceState>>({});
  const [showFullIds, setShowFullIds] = useState(false);
  // ONE source of truth: the set of selected full service ids. A short id is
  // not stored at all, it is derived — "selected" means every client of that
  // app is selected. That makes switching the checkbox lossless by
  // construction rather than by keeping two lists in step, and it is what lets
  // a parent row and its children disagree (partially selected) without the
  // two views contradicting each other.
  //
  // Held as id STRINGS, never as indices: workspaces resolve at different
  // speeds and reorder the list, so an index would come to mean another app.
  const [selectedFull, setSelectedFull] = useState<string[]>([]);

  // Optional here, unlike the admin page: public apps can be called without
  // credentials, so a token is only needed to reach private ones. Minted on
  // demand rather than up front so nobody carries a credential they did not
  // ask for.
  const [includeToken, setIncludeToken] = useState(false);
  const { token, isGenerating: isGeneratingToken, error: tokenError, generate: generateToken, clearToken } =
    useWorkspaceToken({ permission: 'read_write', expiresInSeconds: TOKEN_LIFETIME_SECONDS });

  // Guards against a slow response for a workspace the user has since removed
  // overwriting state, and against results from a previous login.
  const runIdRef = useRef(0);

  // Ids asked for in the URL, and the subset already acted on. Apps stream in
  // per workspace, so preselection cannot be a one-shot on the first batch:
  // each requested id is applied when its app actually turns up, and then
  // never again, so deselecting one does not make it spring back.
  //
  // The LIVE parameter is read, not a mount-time snapshot. Navigating inside
  // the app, or editing the address bar, changes the query without remounting
  // this component, and a snapshot taken at mount would silently ignore both.
  // Re-reading is safe against the write-back below: everything it writes is
  // already selected, so it is already in `appliedRef` and will not re-apply.
  const [searchParams, setSearchParams] = useSearchParams();
  const requestedParam = searchParams.get(APPS_PARAM);
  const appliedRef = useRef<Set<string>>(new Set());

  // Ids seen in the URL but not yet matched to a live app. Accumulated rather
  // than read straight off the parameter each time, because the write-back
  // below rewrites that parameter from the current selection — which is empty
  // until preselection lands. Reading the parameter directly therefore races
  // with its own clearing and the request is lost. Once an id is pending it
  // stays pending until the app appears, however the URL changes meanwhile.
  const pendingRef = useRef<Set<string>>(new Set());
  // Latched like the admin page's worker default: applied once, when the app
  // actually turns up, so the per-workspace arrival order cannot burn it and a
  // deselect is not undone by the next result batch.
  const featuredApplied = useRef(false);
  for (const id of parseAppsParam(requestedParam)) {
    if (!appliedRef.current.has(id)) pendingRef.current.add(id);
  }

  const loadWorkspace = useCallback(async (workspace: string, runId: number) => {
    setByWorkspace(prev => ({ ...prev, [workspace]: { status: 'loading', apps: prev[workspace]?.apps ?? [] } }));
    try {
      // Signed in: go over the existing websocket, which also sees workers in
      // the user's own private workspace. Signed out: plain HTTP, which needs
      // no session and still sees every public workspace.
      const workers = server
        ? await discoverWorkers(server, workspace, { isLoggedIn, userWorkspace })
        : await discoverWorkersHttp(workspace);
      // Ask every worker at once. One unreachable worker must not hide the apps
      // on its neighbours, so failures are dropped rather than propagated.
      const results = await Promise.allSettled(
        workers.map(w =>
          server ? fetchWorkerApps(server, w.id, workspace) : fetchWorkerAppsHttp(w.id, workspace),
        ),
      );
      const apps = results.flatMap(r => (r.status === 'fulfilled' ? r.value : []));
      if (runIdRef.current !== runId) return;
      setByWorkspace(prev => ({ ...prev, [workspace]: { status: 'loaded', apps } }));
    } catch (err) {
      if (runIdRef.current !== runId) return;
      setByWorkspace(prev => ({
        ...prev,
        [workspace]: { status: 'error', apps: [], error: err instanceof Error ? err.message : String(err) },
      }));
    }
  }, [server, isLoggedIn, userWorkspace]);

  /**
   * Workspaces to load, ordered so the ones a preselected id needs come first,
   * in the order those ids appear in the URL, then everything else.
   *
   * The set is deduplicated, so a workspace named by three preselected apps is
   * still searched once. Ordering matters because each workspace is two round
   * trips deep: putting the requested ones first means a shared link resolves
   * its own apps before it spends time on workspaces nobody asked about.
   */
  const loadOrder = useMemo(() => {
    const wanted = parseAppsParam(requestedParam)
      .map(id => id.split('/')[0])
      .filter(Boolean);
    return [...new Set([...wanted, ...observedWorkspaces])]
      .filter(ws => observedWorkspaces.includes(ws));
  }, [requestedParam, observedWorkspaces]);

  // Fan out over workspaces rather than awaiting them in sequence: each box
  // fills in on its own as soon as that workspace resolves. The order above
  // only decides who is asked first, not who is waited for.
  useEffect(() => {
    const runId = ++runIdRef.current;
    loadOrder.forEach(ws => { void loadWorkspace(ws, runId); });
  }, [server, loadOrder, loadWorkspace]);

  const allApps = useMemo(
    () => observedWorkspaces.flatMap(ws => byWorkspace[ws]?.apps ?? []),
    [observedWorkspaces, byWorkspace],
  );

  /** Short ids, deduplicated: the same app on two workers is one entry. */
  const shortIdsFor = (apps: DeployedApp[]): string[] =>
    [...new Set(apps.map(a => a.shortId))].sort();

  /** Every client (full id) currently serving a given short id. */
  const clientsOf = useCallback(
    (shortId: string) => allApps.filter(a => a.shortId === shortId).map(a => a.fullId),
    [allApps],
  );

  const toggleFull = (fullId: string) =>
    setSelectedFull(prev => (prev.includes(fullId) ? prev.filter(x => x !== fullId) : [...prev, fullId]));

  /** Selecting an app selects all of its clients; clearing it clears them all. */
  const toggleShort = (shortId: string) => {
    const clients = clientsOf(shortId);
    const allOn = clients.length > 0 && clients.every(f => selectedFull.includes(f));
    setSelectedFull(prev =>
      allOn ? prev.filter(f => !clients.includes(f)) : [...new Set([...prev, ...clients])],
    );
  };

  /** 'all' | 'some' | 'none' — drives the parent checkbox and its indeterminate state. */
  const coverageOf = (shortId: string): 'all' | 'some' | 'none' => {
    const clients = clientsOf(shortId);
    if (clients.length === 0) return 'none';
    const hits = clients.filter(f => selectedFull.includes(f)).length;
    return hits === 0 ? 'none' : hits === clients.length ? 'all' : 'some';
  };

  // Apply `?apps=` as the named apps appear. Each selects every client of that
  // app, matching what ticking it in the UI does. Ids that never turn up are
  // simply ignored: they may name an app that has since been undeployed.
  useEffect(() => {
    if (allApps.length === 0 || pendingRef.current.size === 0) return;
    const toAdd: string[] = [];
    for (const wanted of [...pendingRef.current]) {
      const matches = allApps.filter(a => a.shortId === wanted);
      if (matches.length === 0) continue;
      appliedRef.current.add(wanted);
      pendingRef.current.delete(wanted);
      toAdd.push(...matches.map(a => a.fullId));
    }
    if (toAdd.length > 0) setSelectedFull(prev => [...new Set([...prev, ...toAdd])]);
  }, [allApps, requestedParam]);

  // Preselect the house app, unless the URL already says what to select: a link
  // carrying `?apps=` expresses an explicit intent, and quietly adding another
  // app to it would be wrong.
  useEffect(() => {
    if (featuredApplied.current || allApps.length === 0) return;
    if (parseAppsParam(requestedParam).length > 0) {
      featuredApplied.current = true;   // URL wins; never apply the default later
      return;
    }
    const clients = allApps.filter(a => a.shortId === FEATURED_APP_SHORT_ID);
    if (clients.length === 0) return;   // not deployed yet; keep waiting
    featuredApplied.current = true;
    setSelectedFull(prev => [...new Set([...prev, ...clients.map(a => a.fullId)])]);
  }, [allApps, requestedParam]);

  // Late-arriving apps must not disturb what is already selected, but an app
  // that has gone away should stop appearing in the prompt.
  useEffect(() => {
    if (allApps.length === 0) return;
    const liveFull = new Set(allApps.map(a => a.fullId));
    setSelectedFull(prev => {
      const kept = prev.filter(id => liveFull.has(id));
      return kept.length === prev.length ? prev : kept;
    });
  }, [allApps]);

  /**
   * What the prompt names.
   *
   * Showing full ids: exactly the clients that are ticked.
   * Showing short ids: the short id for any app whose clients are ALL selected,
   * since that unqualified form is what an agent should use when any worker
   * will do. An app with only some clients selected keeps those explicit ids
   * instead, so a partial choice made in the expanded view is never silently
   * broadened back to "any worker".
   */
  const selectedIds = useMemo(() => {
    if (showFullIds) return [...selectedFull].sort();
    const shorts = [...new Set(allApps.map(a => a.shortId))];
    const out: string[] = [];
    for (const shortId of shorts) {
      const clients = allApps.filter(a => a.shortId === shortId).map(a => a.fullId);
      const picked = clients.filter(f => selectedFull.includes(f));
      if (picked.length === 0) continue;
      if (picked.length === clients.length) out.push(shortId);
      else out.push(...picked);
    }
    return out.sort();
  }, [showFullIds, selectedFull, allApps]);

  /**
   * Tick: mint a fresh token, every time, rather than reusing one from earlier
   * in the session. The lifetime is counted from issue, so a token minted an
   * hour ago hands the agent less time than the label promises, and a prompt
   * built twice should not carry the same credential twice.
   *
   * Untick: drop it, so a token never lingers in a prompt that no longer
   * advertises one.
   */
  const handleIncludeToken = useCallback((next: boolean) => {
    setIncludeToken(next);
    if (next) void generateToken();
    else clearToken();
  }, [generateToken, clearToken]);

  // Selection -> URL. An app is listed once any of its clients are selected,
  // so the link reopens with that app ticked. `replace` keeps ticking boxes out
  // of the back-button history.
  //
  // This cannot loop with the read above: the read consults `requestedRef`,
  // captured once at mount, and never re-reads the live parameter.
  const selectedShortIds = useMemo(() => {
    const picked = new Set(selectedFull);
    return [...new Set(allApps.filter(a => picked.has(a.fullId)).map(a => a.shortId))].sort();
  }, [allApps, selectedFull]);

  //
  // Held back until at least one workspace has finished loading. On mount the
  // selection is necessarily empty, so writing immediately would delete the
  // very `apps=` value this page was opened with — and under StrictMode's
  // double mount the second pass would then read an already-cleared URL and
  // preselect nothing. A shared link would wipe itself before being applied.
  // Every workspace has reported, and nothing named in the URL is still
  // waiting for its app to appear. Both halves matter: writing after only the
  // FIRST workspace loads would drop ids belonging to a workspace still in
  // flight, which is exactly how a shared link loses half its selection. Until
  // then the URL is left exactly as it arrived, so it also survives a reload
  // and a login round trip.
  const allWorkspacesSettled =
    observedWorkspaces.length > 0 &&
    observedWorkspaces.every(ws => {
      const st = byWorkspace[ws]?.status;
      return st === 'loaded' || st === 'error';
    });
  const readyToWriteUrl = allWorkspacesSettled && pendingRef.current.size === 0;

  useEffect(() => {
    if (!readyToWriteUrl) return;
    setSearchParams(prev => {
      const params = new URLSearchParams(prev);
      if (selectedShortIds.length > 0) params.set(APPS_PARAM, selectedShortIds.join(','));
      else params.delete(APPS_PARAM);
      return params;
    // `preventScrollReset` matters here: ticking a checkbox rewrites the query,
    // which React Router otherwise treats as a navigation and scrolls to the
    // top, throwing the user out of the list they were working through.
    }, { replace: true, preventScrollReset: true });
  }, [selectedShortIds, readyToWriteUrl, setSearchParams]);

  const prompt = useMemo(
    () => buildPrompt(selectedIds, includeToken ? token : ''),
    [selectedIds, includeToken, token],
  );

  const [wsInput, setWsInput] = useState('');

  return (
    <div className="max-w-[1400px] mx-auto px-4 py-8">
      <BioEnginePageHeader backTo="/bioengine" />

      <div className="max-w-6xl mx-auto space-y-6">
        <AgentPromptBox
          title="Use deployed BioEngine apps"
          intro="Browse the applications deployed across the workspaces you follow, select the ones you want, then copy this prompt into your AI agent (Claude Code, Codex, Gemini CLI, and so on). It loads the BioEngine skill and names the apps you selected, so the agent knows what it may call."
          prompt={prompt}
          disabled={selectedIds.length === 0}
          disabledHint="Select at least one app below to enable copying."
          selectionSummary={
            selectedIds.length === 0
              ? 'No app selected'
              : `${selectedIds.length} app${selectedIds.length === 1 ? '' : 's'} selected`
          }
        >
          <label className="flex items-center mt-3 cursor-pointer">
            <input
              type="checkbox"
              checked={showFullIds}
              // No selection migration needed: `selectedFull` is the single
              // source of truth and both views derive from it.
              onChange={e => setShowFullIds(e.target.checked)}
              className="w-4 h-4 text-blue-600 border-gray-300 rounded"
            />
            <span className="ml-2 text-sm text-gray-700">
              Show full service ids
              <span className="text-gray-500">
                {' '}(the exact deployment, including which worker serves it)
              </span>
            </span>
          </label>

          <label className={`flex items-start mt-2 ${isLoggedIn ? 'cursor-pointer' : 'cursor-not-allowed opacity-60'}`}>
            <input
              type="checkbox"
              disabled={!isLoggedIn}
              checked={includeToken && isLoggedIn}
              onChange={e => handleIncludeToken(e.target.checked)}
              className="mt-0.5 w-4 h-4 text-blue-600 border-gray-300 rounded"
            />
            <span className="ml-2 text-sm text-gray-700">
              Include a read-write Hypha token for my workspace (valid for {TOKEN_LIFETIME_LABEL})
              {!isLoggedIn && <span className="text-gray-500"> (log in to enable)</span>}
              {isLoggedIn && includeToken && isGeneratingToken && <span className="text-gray-500"> (generating...)</span>}
              <span className="block text-xs text-gray-500">
                Only needed for private apps. Treat the prompt as a secret once it carries a token.
              </span>
              {includeToken && tokenError && (
                <span className="block text-xs text-red-600">{tokenError}</span>
              )}
            </span>
          </label>
        </AgentPromptBox>

        {/* Workspace management, mirroring the worker list so the two screens
            share one set of observed workspaces. */}
        <div className="bg-white/80 backdrop-blur-sm rounded-2xl shadow-sm border border-white/20 p-6">
          <h3 className="text-base font-semibold text-gray-800 mb-3">Observed Workspaces</h3>
          <form
            onSubmit={e => { e.preventDefault(); addWorkspace(wsInput); setWsInput(''); }}
            className="flex gap-2 mb-3"
          >
            <input
              type="text"
              value={wsInput}
              onChange={e => setWsInput(e.target.value)}
              placeholder="Add workspace name..."
              className="flex-1 px-3 py-2 border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 text-sm"
            />
            <button
              type="submit"
              disabled={!wsInput.trim() || observedWorkspaces.includes(wsInput.trim())}
              className="w-28 h-10 flex items-center justify-center bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-40 disabled:cursor-not-allowed text-sm font-medium"
            >
              Add
            </button>
          </form>

          <div className="space-y-4">
            {observedWorkspaces.map(ws => {
              const state = byWorkspace[ws];
              const apps = state?.apps ?? [];
              const shortIds = shortIdsFor(apps);
              const removable = !defaultWorkspaces.includes(ws);

              return (
                <div key={ws} className="border border-gray-200 rounded-xl p-4">
                  <div className="flex items-center justify-between mb-3">
                    <div className="flex items-center gap-2">
                      <h4 className="text-sm font-semibold text-gray-800 font-mono">{ws}</h4>
                      {state?.status === 'loading' && (
                        <div className="w-3 h-3 border border-gray-400 border-t-transparent rounded-full animate-spin" />
                      )}
                      {state?.status === 'loaded' && (
                        <span className="text-xs text-gray-500">
                          {shortIds.length} app{shortIds.length === 1 ? '' : 's'}
                        </span>
                      )}
                    </div>
                    {removable && (
                      <button
                        type="button"
                        onClick={() => removeWorkspace(ws)}
                        className="text-xs text-gray-500 hover:text-red-600"
                      >
                        Remove
                      </button>
                    )}
                  </div>

                  {state?.status === 'error' ? (
                    <p className="text-xs text-red-600">{state.error}</p>
                  ) : shortIds.length === 0 ? (
                    <p className="text-xs text-gray-500">
                      {state?.status === 'loading' ? 'Looking for deployed apps...' : 'No deployed apps found.'}
                    </p>
                  ) : (
                    <div className="space-y-2">
                      {shortIds.map(shortId => {
                        const clients = apps.filter(a => a.shortId === shortId);
                        const coverage = coverageOf(shortId);
                        return (
                          <div
                            key={shortId}
                            className={`rounded-lg border transition-colors ${
                              coverage === 'none' ? 'bg-white border-gray-200' : 'bg-blue-50 border-blue-300'
                            }`}
                          >
                            {/* The app itself. Always shown, in both views — the
                                expanded view adds its clients underneath rather
                                than replacing it, so the app you are choosing
                                never disappears from the list. */}
                            <label className="flex items-start gap-2 p-2 cursor-pointer">
                              <input
                                type="checkbox"
                                checked={coverage === 'all'}
                                ref={el => { if (el) el.indeterminate = coverage === 'some'; }}
                                onChange={() => toggleShort(shortId)}
                                className="mt-0.5 w-4 h-4 text-blue-600 border-gray-300 rounded flex-shrink-0"
                              />
                              <span className="text-xs font-mono text-gray-800 break-all">{shortId}</span>
                              {shortId === FEATURED_APP_SHORT_ID && (
                                <span className="inline-flex items-center flex-shrink-0 px-2 py-0.5 bg-blue-100 text-blue-700 text-[11px] font-medium rounded-full">
                                  ⚡ Powers this website
                                </span>
                              )}
                              {showFullIds && (
                                <span className="ml-auto text-[11px] text-gray-500 flex-shrink-0 pl-2">
                                  {clients.length} client{clients.length === 1 ? '' : 's'}
                                </span>
                              )}
                            </label>

                            {showFullIds && (
                              <div className="pl-7 pr-2 pb-2 space-y-1">
                                {clients.map(client => (
                                  <label key={client.fullId} className="flex items-start gap-2 cursor-pointer">
                                    <input
                                      type="checkbox"
                                      checked={selectedFull.includes(client.fullId)}
                                      onChange={() => toggleFull(client.fullId)}
                                      className="mt-0.5 w-3.5 h-3.5 text-blue-600 border-gray-300 rounded flex-shrink-0"
                                    />
                                    <span className="text-[11px] font-mono text-gray-600 break-all">
                                      {client.fullId}
                                    </span>
                                  </label>
                                ))}
                              </div>
                            )}
                          </div>
                        );
                      })}
                    </div>
                                    )}
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
};

export default BioEngineAppsPage;
