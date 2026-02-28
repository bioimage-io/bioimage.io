import { create } from 'zustand';
import { hyphaWebsocketClient } from 'hypha-rpc';
// import { hRPC } from 'hypha';
import { ArtifactInfo } from '../types/artifact';
import { HYPHA_SERVER_URL } from '../config/hypha';

let pendingConnectPromise: Promise<any> | null = null;
let activeConnectKey: string | null = null;


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
  myArtifactsPage: 1,
  myArtifactsTotalItems: 0,
  reviewArtifactsPage: 1,
  reviewArtifactsTotalItems: 0,
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

      // Construct the base URL
      let url = `${HYPHA_SERVER_URL}/bioimage-io/artifacts/bioimage.io/children?pagination=true&offset=${offset}&limit=${get().itemsPerPage}&stage=false&order_by=manifest.score>`;

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

      set({
        resources: data.items || [],
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