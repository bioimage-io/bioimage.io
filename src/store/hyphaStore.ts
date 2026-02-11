import { create } from 'zustand';
import { hyphaWebsocketClient } from 'hypha-rpc';
// import { hRPC } from 'hypha';
import { ArtifactInfo } from '../types/artifact';;


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
  logout: () => void;
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
    set({ isConnecting: true, error: null });
    try {
      const client = hyphaWebsocketClient;
      const server = await client.connectToServer(config);
      
      if (!server) {
        throw new Error('Failed to connect to server');
      }

      const artifactManager = await server.getService('public/artifact-manager');

      const isAuthenticated = !!config.token;
      
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

      return server;
    } catch (error) {
      console.error('Failed to connect to Hypha:', error);
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
      throw error;
    }
  },
  fetchResources: async (page: number, searchQuery?: string, filterOptions?: FilterOptions) => {
    set({ isLoading: true });
    try {
      console.log('Fetching resources for page:', page, searchQuery);
      const offset = (page - 1) * get().itemsPerPage;
      
      // Construct the base URL
      let url = `https://hypha.aicell.io/ri-scale/artifacts/ai-model-hub/children?pagination=true&offset=${offset}&limit=${get().itemsPerPage}&stage=false&order_by=manifest.score>`;
      
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
      
      // Combine search query with tags
      let keywords = [];
      if (searchQuery) {
        keywords.push(...searchQuery.split(' ').map(k => k.trim()));
      }
      if (filterOptions?.tags) {
        keywords.push(...filterOptions.tags);
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
        : ['ri-scale', id];

      const url = `https://hypha.aicell.io/${workspace}/artifacts/${artifactName}` + (version ? `?version=${version}` : '');
      
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
        server_url: 'https://hypha.aicell.io',
      };

      const token = await client.login(loginConfig);
      if (!token) {
        throw new Error('Login failed - no token received');
      }

      // Use the new connect function with the token
      await get().connect({
        server_url: 'https://hypha.aicell.io',
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
  logout: () => {
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