import { create } from 'zustand';
import { hyphaWebsocketClient } from 'hypha-rpc';
// import { hRPC } from 'hypha';

interface Resource {
  id: string;
  name: string;
  description: string;
  thumbnail?: string;
  tags?: string[];
}

export interface HyphaState {
  client: typeof hyphaWebsocketClient | null;
  server: any;
  setClient: (client: typeof hyphaWebsocketClient) => void;
  setServer: (server: any) => void;
  user: any;
  setUser: (user: any) => void;
  isInitialized: boolean;
  setIsInitialized: (isInitialized: boolean) => void;
  initializeClient: () => Promise<typeof hyphaWebsocketClient>;
  resources: Resource[];
  setResources: (resources: Resource[]) => void;
  resourceType: string | null;
  setResourceType: (type: string | null) => void;
  hyphaClient: any; // TODO: Add proper type for hyphaClient
  fetchResources: () => Promise<void>;
  resourceTypes: string[];
  setResourceTypes: (types: string[]) => void;
  page: number;
}

// Track initialization status outside the store
let initializationPromise: Promise<typeof hyphaWebsocketClient> | null = null;
let isConnecting = false;

export const useHyphaStore = create<HyphaState>((set, get) => ({
  client: null,
  server: null,
  user: null,
  isInitialized: false,
  resources: [],
  resourceType: 'model',
  resourceTypes: [],
  page: 0,
  setClient: (client) => set({ client }),
  setServer: (server) => set({ server }),
  setUser: (user) => set({ user }),
  setIsInitialized: (isInitialized) => set({ isInitialized }),
  setResources: (resources) => set({ resources }),
  setResourceType: (type) => {
    set({ resourceType: type });
    // Automatically fetch resources when type changes
    get().fetchResources();
  },
  setResourceTypes: (types) => {
    set((state) => ({
      resourceTypes: types,
      page: 0  // Reset page when filter changes
    }));
  },
  initializeClient: async () => {
    const currentClient = get().client;
    if (currentClient && get().isInitialized) return currentClient;
    
    // Prevent multiple concurrent connection attempts
    if (isConnecting) {
      return initializationPromise;
    }
    
    if (!initializationPromise) {
      isConnecting = true;
      // Create the client first
      const client = hyphaWebsocketClient;
      set({ client });
      
      // Then connect to server without authentication
      initializationPromise = client.connectToServer({
        name: 'bioimage-model-zoo',
        server_url: 'https://hypha.aicell.io',
      }).then(server => {
        set({ server, isInitialized: true });
        console.log('Hypha client initialized');
        isConnecting = false;
        return client;
      }).catch(error => {
        console.error('Failed to initialize Hypha client:', error);
        set({ client: null, isInitialized: false });
        initializationPromise = null;
        isConnecting = false;
        throw error;
      });
    }

    return initializationPromise;
  },
  fetchResources: async () => {
    const { server, resourceType } = get();
    if (!server) return;

    try {
      // Add type filter to the query
      const filter = resourceType ? { type: resourceType } : {};
      const resources = await server.listChildren({
        filter: filter
      });
      
      set({ resources });
    } catch (error) {
      console.error('Failed to fetch resources:', error);
      set({ resources: [] });
    }
  }
}));

// Remove the separate initialization function since it's now part of the store 