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
  fetchResources: (page: number, searchQuery?: string) => Promise<void>;
  resourceTypes: string[];
  setResourceTypes: (types: string[]) => void;
  page: number;
  itemsPerPage: number;
  totalItems: number;
  setTotalItems: (total: number) => void;
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
  itemsPerPage: 12,
  totalItems: 0,
  setClient: (client) => set({ client }),
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
      page: 0  // Reset page when filter changes
    }));
  },
  setTotalItems: (total) => set({ totalItems: total }),
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
  fetchResources: async (page: number, searchQuery?: string) => {
    try {
      const offset = (page - 1) * get().itemsPerPage;
      
      // Construct the base URL
      let url = `https://hypha.aicell.io/bioimage-io/artifacts/bioimage.io/children?pagination=true&offset=${offset}&limit=${get().itemsPerPage}`;
      
      // Add type filter if resourceType is specified
      if (get().resourceType) {
        const filters = JSON.stringify({ type: get().resourceType });
        url += `&filters=${encodeURIComponent(filters)}`;
      }
      
      // Add search keywords if there's a search query
      if (searchQuery) {
        const keywords = searchQuery.split(',').map(k => k.trim()).join(',');
        url += `&keywords=${encodeURIComponent(keywords)}`;
      }
      
      const response = await fetch(url);
      const data = await response.json();
      
      set({ 
        resources: data.items || [],
        totalItems: data.total || 0
      });
    } catch (error) {
      console.error('Error fetching resources:', error);
      set({ 
        resources: [],
        totalItems: 0
      });
    }
  }
}));

// Remove the separate initialization function since it's now part of the store 