import { create } from 'zustand';
import { hyphaWebsocketClient } from 'hypha-rpc';
// import { hRPC } from 'hypha';
import { ArtifactInfo } from '../types/artifact';
import { HYPHA_SERVER_URL } from '../config/hypha';

let pendingConnectPromise: Promise<any> | null = null;
let activeConnectKey: string | null = null;

// Guards for attemptReconnect(): one shared in-flight promise so concurrent
// callers (My Artifacts, Review, etc.) don't each fire their own reconnect,
// plus a cooldown timestamp so a burst of failures doesn't hammer the server.
let reconnectPromise: Promise<boolean> | null = null;
let lastReconnectAt = 0;
const RECONNECT_MAX_ATTEMPTS = 2;      // "once or twice" before logging out
const RECONNECT_RETRY_DELAY_MS = 1500; // brief backoff between the two attempts
const RECONNECT_COOLDOWN_MS = 8000;    // ignore repeat triggers within this window

// Read the cached login token, honoring its stored expiry. Mirrors
// LoginButton.getSavedToken so reconnection uses the same credential the
// initial auto-login used.
const getSavedToken = (): string | null => {
  const token = localStorage.getItem('token');
  if (token) {
    const expiry = localStorage.getItem('tokenExpiry');
    if (expiry && new Date(expiry) > new Date()) return token;
  }
  return null;
};


// Add a type for connection config
interface ConnectionConfig {
  server_url: string;
  token?: string;
  method_timeout?: number;
}

interface LoginConfig {
  server_url: string;
  login_callback?: (context: any) => void;
}

interface FilterOptions {
  type?: string;
  tags?: string[];
  manifest?: Record<string, string>;
  partnerLink?: string; // For keyword search by partner links (e.g., "stardist/stardist")
}

export interface HyphaState {
  client: typeof hyphaWebsocketClient | null;
  server: any;
  setServer: (server: any) => void;
  user: any;
  setUser: (user: any) => void;
  isInitialized: boolean;
  setIsInitialized: (isInitialized: boolean) => void;
  resources: ArtifactInfo[];
  setResources: (resources: ArtifactInfo[]) => void;
  resourceType: string | null;
  setResourceType: (type: string | null) => void;
  fetchResources: (page: number, searchQuery?: string, filterOptions?: FilterOptions) => Promise<void>;
  resourceTypes: string[];
  setResourceTypes: (types: string[]) => void;
  page: number;
  itemsPerPage: number;
  totalItems: number;
  setTotalItems: (total: number) => void;
  artifactManager: any;
  isConnected: boolean;
  isConnecting: boolean;
  connect: (config: ConnectionConfig) => Promise<any>;
  isLoggingIn: boolean;
  isAuthenticated: boolean;
  login: (username: string, password: string) => Promise<void>;
  isLoggedIn: boolean;
  setLoggedIn: (status: boolean) => void;
  selectedResource: ArtifactInfo | null;
  setSelectedResource: (artifact: ArtifactInfo | null) => void;
  fetchResource: (id: string, version?: string) => Promise<void>;
  isLoading: boolean;
  error: string | null;
  myArtifactsPage: number;
  myArtifactsTotalItems: number;
  reviewArtifactsPage: number;
  reviewArtifactsTotalItems: number;
  // Count of models awaiting review (status 'in-review', excluding 'in-revision').
  // Shared so the dropdown badge and the review page stay in sync.
  pendingReviewCount: number;
  refreshPendingReviewCount: () => Promise<void>;
  setPendingReviewCount: (n: number) => void;
  setMyArtifactsPage: (page: number) => void;
  setMyArtifactsTotalItems: (total: number) => void;
  setReviewArtifactsPage: (page: number) => void;
  setReviewArtifactsTotalItems: (total: number) => void;
  logout: () => Promise<void>;

  // Hypha-reachability signal. Any service that observes a fetch failure
  // calls `markHyphaUnreachable`; the global <HyphaStatusBanner /> polls
  // for recovery and calls `markHyphaReachable` when the server is back.
  // Per-section components defer their own error UI to the banner.
  isHyphaUnreachable: boolean;
  hyphaUnreachableSince: number | null;
  hyphaUnreachableMessage: string | null;
  markHyphaUnreachable: (errorMessage?: string | null) => void;
  markHyphaReachable: () => void;
  // Reconnect using the last-used token (reads from localStorage like LoginButton).
  reconnect: () => Promise<void>;
  // Resilient reconnection for when a live RPC call fails on a stale socket.
  // Retries the cached-token connect up to twice (deduped + rate-limited); if
  // it still fails, logs the user out so the UI shows the not-logged-in state.
  // Resolves true when a live connection is available afterwards.
  attemptReconnect: () => Promise<boolean>;
}

export const useHyphaStore = create<HyphaState>((set, get) => ({
  client: hyphaWebsocketClient,
  server: null,
  user: null,
  isInitialized: false,
  resources: [],
  resourceType: 'model',
  resourceTypes: [],
  page: 1,
  itemsPerPage: 12,
  totalItems: 0,
  artifactManager: null,
  isConnected: false,
  isConnecting: false,
  isLoggingIn: false,
  isAuthenticated: false,
  isLoggedIn: false,
  selectedResource: null,
  isLoading: false,
  error: null,
  isHyphaUnreachable: false,
  hyphaUnreachableSince: null,
  hyphaUnreachableMessage: null,
  markHyphaUnreachable: (errorMessage?: string | null) => set(state =>
    state.isHyphaUnreachable
      ? (errorMessage && errorMessage !== state.hyphaUnreachableMessage
          ? { hyphaUnreachableMessage: errorMessage }
          : state)
      : {
          isHyphaUnreachable: true,
          hyphaUnreachableSince: Date.now(),
          hyphaUnreachableMessage: errorMessage ?? null,
        }
  ),
  markHyphaReachable: () => set(state =>
    state.isHyphaUnreachable
      ? { isHyphaUnreachable: false, hyphaUnreachableSince: null, hyphaUnreachableMessage: null }
      : state
  ),
  reconnect: async () => {
    const savedToken = getSavedToken();
    // Reset dedup keys so connect() doesn't short-circuit when the WS
    // dropped but the config looks identical to the last successful run.
    activeConnectKey = null;
    pendingConnectPromise = null;
    await get().connect({
      server_url: HYPHA_SERVER_URL,
      token: savedToken ?? undefined,
      method_timeout: 300,
    });
  },
  attemptReconnect: async (): Promise<boolean> => {
    // Dedup concurrent callers onto one in-flight reconnect.
    if (reconnectPromise) return reconnectPromise;
    // Rate-limit: after a recent attempt, don't fire again; report the
    // current connection state instead so a burst of failing RPC calls
    // doesn't trigger a storm of reconnects.
    if (Date.now() - lastReconnectAt < RECONNECT_COOLDOWN_MS) {
      return get().isConnected;
    }

    reconnectPromise = (async () => {
      try {
        for (let attempt = 1; attempt <= RECONNECT_MAX_ATTEMPTS; attempt++) {
          const savedToken = getSavedToken();
          // No valid cached token -> nothing to reconnect with; fall through
          // to the logout below so the UI clearly shows "not logged in".
          if (!savedToken) break;
          try {
            // Reset dedup keys so connect() actually rebuilds the socket even
            // though the config looks identical to the last successful run.
            activeConnectKey = null;
            pendingConnectPromise = null;
            await get().connect({
              server_url: HYPHA_SERVER_URL,
              token: savedToken,
              method_timeout: 300,
            });
            return true; // reconnected; connect() refreshed server + artifactManager
          } catch (err) {
            console.warn(`Hypha reconnect attempt ${attempt} failed:`, err);
            if (attempt < RECONNECT_MAX_ATTEMPTS) {
              await new Promise(resolve => setTimeout(resolve, RECONNECT_RETRY_DELAY_MS));
            }
          }
        }
        // Reconnection failed (or no valid token). Log the user out and drop
        // the stale token so the app presents a clean not-logged-in state
        // instead of a stuck error.
        localStorage.removeItem('token');
        localStorage.removeItem('tokenExpiry');
        await get().logout();
        return false;
      } finally {
        lastReconnectAt = Date.now();
        reconnectPromise = null;
      }
    })();
    return reconnectPromise;
  },
  myArtifactsPage: 1,
  myArtifactsTotalItems: 0,
  reviewArtifactsPage: 1,
  reviewArtifactsTotalItems: 0,
  pendingReviewCount: 0,
  setServer: (server) => set({ server }),
  setUser: (user) => set({ user }),
  setIsInitialized: (isInitialized) => set({ isInitialized }),
  setResources: (resources) => set({ resources }),
  setResourceType: (type) => {
    set({ resourceType: type });
    // Automatically fetch resources when type changes
    get().fetchResources(get().page);
  },
  setResourceTypes: (types) => {
    set((state) => ({
      resourceTypes: types,
      page: 1  // Reset page to 1 when filter changes
    }));
  },
  setTotalItems: (total) => set({ totalItems: total }),
  setLoggedIn: (status: boolean) => set({ isLoggedIn: status }),
  setSelectedResource: (artifact) => set({ selectedResource: artifact }),
  connect: async (config: ConnectionConfig) => {
    const connectKey = `${config.server_url}|${config.token || ''}`;
    const currentState = get();

    if (currentState.server && currentState.isConnected && activeConnectKey === connectKey) {
      return currentState.server;
    }

    if (pendingConnectPromise) {
      return pendingConnectPromise;
    }

    set({ isConnecting: true, error: null });

    pendingConnectPromise = (async () => {
      try {
        const latestState = get();
        if (latestState.server && typeof latestState.server.disconnect === 'function') {
          try {
            await latestState.server.disconnect();
          } catch (disconnectError) {
            console.warn('Failed to disconnect stale Hypha connection:', disconnectError);
          }
        }

        const client = hyphaWebsocketClient;
        const server = await client.connectToServer(config);

        if (!server) {
          throw new Error('Failed to connect to server');
        }

        const artifactManager = await server.getService('public/artifact-manager');

        const isAuthenticated = !!config.token;

        activeConnectKey = connectKey;
        set({
          client,
          server,
          artifactManager,
          isConnected: true,
          isAuthenticated,
          isLoggedIn: isAuthenticated,
          user: server.config.user,
          isInitialized: true,
          isConnecting: false
        });
        // A successful websocket connect is the strongest signal that
        // Hypha is back; clear any stale unreachable flag the partner
        // fetch (or another caller) may have set.
        get().markHyphaReachable();

        return server;
      } catch (error) {
        console.error('Failed to connect to Hypha:', error);
        activeConnectKey = null;
        set({
          client: null,
          server: null,
          artifactManager: null,
          isConnected: false,
          isAuthenticated: false,
          isLoggedIn: false,
          user: null,
          isInitialized: false,
          isConnecting: false,
          error: (error instanceof Error) ? error.message : 'Connection failed'
        });
        // Websocket connect failures look the same to the user as a REST
        // outage; flip the global flag so the banner appears on pages that
        // don't otherwise call a hard-coded Hypha endpoint.
        get().markHyphaUnreachable(
          error instanceof Error ? error.message : 'Failed to connect to Hypha'
        );
        throw error;
      } finally {
        pendingConnectPromise = null;
      }
    })();

    return pendingConnectPromise;
  },
  fetchResources: async (page: number, searchQuery?: string, filterOptions?: FilterOptions) => {
    set({ isLoading: true });
    try {
      console.log('Fetching resources for page:', page, searchQuery);
      const offset = (page - 1) * get().itemsPerPage;

      const resourceType = get().resourceType;
      const hasQuery = !!(searchQuery && searchQuery.trim());
      const hasFilters = !!(
        (filterOptions?.tags && filterOptions.tags.length) ||
        filterOptions?.partnerLink ||
        filterOptions?.manifest
      );

      // BROWSE MODE — the public models grid is sourced from the test-reports
      // collection: only tested models appear, ordered by the report's `score`
      // (with `metadata_completeness` as a deterministic tiebreaker). Each card
      // resolves its cover from the MODEL collection by id
      // (resolveCoverThumbnailUrl), identical to search and detail.
      //
      // Only reports for PUBLISHED models carry artifact `type: "published-model"`
      // (set by the model-runner when it writes the report, and flipped
      // immediately on accept — see ReviewArtifacts.handleAccept). Filtering on
      // that top-level `type` lets the server return the exact set with a correct
      // total and pagination — no client-side heuristics. (manifest.* fields are
      // NOT filterable on the backend, but `type` is.) Staged-model reports
      // (`type: "staged-model"`) and the consolidated `inference-report`
      // (`generic`) are naturally excluded.
      if (resourceType === 'model' && !hasQuery && !hasFilters) {
        const reportUrl = `${HYPHA_SERVER_URL}/bioimage-io/artifacts/test-reports/children?pagination=true&offset=${offset}&limit=${get().itemsPerPage}&filters=${encodeURIComponent(JSON.stringify({ type: 'published-model' }))}&order_by=${encodeURIComponent('manifest.score>,manifest.metadata_completeness>')}`;
        const reportResp = await fetch(reportUrl);
        const reportData = await reportResp.json();
        const resources = (reportData.items || []).map((report: any) => {
          const m = report.manifest || {};
          // The model's COLLECTION alias is the report alias minus the
          // `test-report-` prefix (e.g. test-report-ambitious-ant -> ambitious-ant).
          // Do NOT use manifest.id: for Zenodo-deposited models that is the DOI
          // (e.g. 10.5281/zenodo.../...), which is not the collection alias and
          // would break cover/detail resolution. The alias is what covers, links
          // and the detail page resolve against in bioimage-io/bioimage.io.
          const modelId = (report.id?.split('/').pop() || '').replace(/^test-report-/, '');
          return { id: `bioimage-io/${modelId}`, type: 'model', manifest: m };
        });
        set({ resources, totalItems: reportData.total || 0, isLoading: false });
        return;
      }

      // SEARCH MODE for models — fetch committed models and filter client-side by
      // name / description / tags AND the alias (nickname), so a model is findable
      // by its memorable id, which the server keyword index does not cover. This
      // sources from the model collection (rich data) and surfaces any published
      // model. partnerLink searches fall through to the keyword path below.
      if (resourceType === 'model' && hasQuery && !filterOptions?.partnerLink) {
        const q = (searchQuery || '').trim().toLowerCase();
        const tagFilters = (filterOptions?.tags || []).map(t => String(t).toLowerCase());
        const searchUrl = `${HYPHA_SERVER_URL}/bioimage-io/artifacts/bioimage.io/children?pagination=true&limit=2000&stage=false&filters=${encodeURIComponent(JSON.stringify({ type: 'model' }))}&order_by=created_at>`;
        const searchResp = await fetch(searchUrl);
        const searchData = await searchResp.json();
        const HIDDEN = ['draft', 'in-review', 'in-revision'];
        const matches = (searchData.items || []).filter((it: any) => {
          const m = it.manifest || {};
          if (HIDDEN.includes(m.status)) return false;
          const tags = (m.tags || []).map((t: any) => String(t).toLowerCase());
          if (tagFilters.length && !tagFilters.every(t => tags.includes(t))) return false;
          const alias = (it.id || '').split('/').pop().toLowerCase();
          return (
            alias.includes(q) ||
            m.name?.toLowerCase().includes(q) ||
            m.description?.toLowerCase().includes(q) ||
            tags.some((t: string) => t.includes(q))
          );
        });
        set({
          resources: matches.slice(offset, offset + get().itemsPerPage),
          totalItems: matches.length,
          isLoading: false
        });
        return;
      }

      // Construct the base URL. Order by newest first; `manifest.score` was a
      // remnant of when test results lived in the artifact and is unset on
      // ~every model, so it produced an effectively-random order — dropped.
      let url = `${HYPHA_SERVER_URL}/bioimage-io/artifacts/bioimage.io/children?pagination=true&offset=${offset}&limit=${get().itemsPerPage}&stage=false&order_by=created_at>`;

      // Prepare filters object
      const filters: any = {};

      // Add type filter if resourceType is specified
      if (get().resourceType) {
        filters.type = get().resourceType;
      }

      // Add any additional manifest filters
      if (filterOptions?.manifest) {
        filters.manifest = {
          ...filters.manifest,
          ...filterOptions.manifest
        };
      }

      // Add filters to URL if any exist
      if (Object.keys(filters).length > 0) {
        url += `&filters=${encodeURIComponent(JSON.stringify(filters))}`;
      }

      // Combine search query with tags and partner links as keywords
      let keywords = [];
      if (searchQuery) {
        keywords.push(...searchQuery.split(' ').map(k => k.trim()));
      }
      if (filterOptions?.tags) {
        keywords.push(...filterOptions.tags);
      }
      // Add partner link filter as a keyword search
      // This searches for models where the links array contains the partner link (e.g., "ilastik/ilastik")
      if (filterOptions?.partnerLink) {
        keywords.push(filterOptions.partnerLink);
      }

      // Add combined keywords to URL if any exist
      if (keywords.length > 0) {
        url += `&keywords=${encodeURIComponent(keywords.join(','))}`;
      }

      const response = await fetch(url);
      const data = await response.json();

      // Hide models that aren't approved for the public zoo: drafts, those under
      // review, or sent back for revision. Everything else stays visible —
      // `published` and legacy no-status models. Deletion is a separate
      // request_deletion field (a deletion-requested model keeps its published
      // status and stays visible until an admin removes it). Hypha filters have
      // no negation operator, so this is done client-side (a handful of items).
      const HIDDEN_GRID_STATUSES = ['draft', 'in-review', 'in-revision'];
      const visibleItems = (data.items || []).filter(
        (it: any) => !HIDDEN_GRID_STATUSES.includes(it?.manifest?.status)
      );

      set({
        resources: visibleItems,
        totalItems: data.total || 0,
        isLoading: false
      });
    } catch (error) {
      console.error('Error fetching resources:', error);
      set({
        isLoading: false,
        error: (error instanceof Error) ? error.message : 'Failed to fetch resources'
      });
    }
  },
  fetchResource: async (id: string, version?: string) => {
    set({ isLoading: true, selectedResource: null, error: null });
    try {
      const [workspace, artifactName] = id.includes('/')
        ? id.split('/')
        : ['bioimage-io', id];

      const url = `${HYPHA_SERVER_URL}/${workspace}/artifacts/${artifactName}` + (version ? `?version=${version}` : '');

      const response = await fetch(url);
      if (!response.ok) {
        throw new Error(`Failed to fetch artifact: ${artifactName} ${version ? `version: ${version}` : ''}`);
      }

      const data = await response.json();
      set({ selectedResource: data, isLoading: false });
    } catch (error) {
      console.error('Error fetching artifact:', error);
      set({
        isLoading: false,
        error: error instanceof Error ? error.message : 'An unknown error occurred',
        selectedResource: null
      });
    }
  },
  login: async (username: string, password: string) => {
    const state = get();

    if (state.isLoggingIn || state.isAuthenticated) {
      return;
    }

    set({ isLoggingIn: true });

    try {
      const client = hyphaWebsocketClient;

      // First step: Get the token through login
      const loginConfig: LoginConfig = {
        server_url: HYPHA_SERVER_URL,
      };

      const token = await client.login(loginConfig);
      if (!token) {
        throw new Error('Login failed - no token received');
      }

      // Use the new connect function with the token
      await get().connect({
        server_url: HYPHA_SERVER_URL,
        token: token,
        method_timeout: 300
      });

      // Set both isAuthenticated and isLoggedIn to true after successful login
      set({
        isAuthenticated: true,
        isLoggedIn: true
      });

    } catch (error) {
      console.error('Login failed:', error);
      set({
        isAuthenticated: false,
        isConnected: false,
        isLoggedIn: false,
        user: null
      });
      throw error;
    } finally {
      set({ isLoggingIn: false });
    }
  },
  setMyArtifactsPage: (page) => set({ myArtifactsPage: page }),
  setMyArtifactsTotalItems: (total) => set({ myArtifactsTotalItems: total }),
  setReviewArtifactsPage: (page) => set({ reviewArtifactsPage: page }),
  setReviewArtifactsTotalItems: (total) => set({ reviewArtifactsTotalItems: total }),

  // Recount models awaiting review (status 'in-review', NOT 'in-revision').
  // Staged manifests aren't keyword-indexed, so list the staged children and read
  // each staged manifest individually (same approach the review page uses).
  refreshPendingReviewCount: async () => {
    const am = get().artifactManager;
    if (!am) return;
    try {
      const resp = await am.list({
        parent_id: 'bioimage-io/bioimage.io',
        stage: true,
        limit: 1000,
        pagination: true,
        _rkwargs: true,
      });
      const items: any[] = resp?.items ?? [];
      const reads = await Promise.all(
        items.map(async (a: any) => {
          try {
            return await am.read({ artifact_id: a.id, stage: true, _rkwargs: true });
          } catch {
            return null;
          }
        })
      );
      set({ pendingReviewCount: reads.filter((a: any) => a?.manifest?.status === 'in-review').length });
    } catch (err) {
      console.error('Error refreshing pending-review count:', err);
    }
  },
  setPendingReviewCount: (n) => set({ pendingReviewCount: n }),
  logout: async () => {
    const currentServer = get().server;
    if (currentServer && typeof currentServer.disconnect === 'function') {
      try {
        await currentServer.disconnect();
      } catch (disconnectError) {
        console.warn('Failed to disconnect from Hypha during logout:', disconnectError);
      }
    }

    pendingConnectPromise = null;
    activeConnectKey = null;
    set({
      client: hyphaWebsocketClient,
      server: null,
      artifactManager: null,
      isConnected: false,
      isAuthenticated: false,
      isLoggedIn: false,
      user: null,
      isInitialized: false,
      isConnecting: false,
      error: null
    });
  },
}));