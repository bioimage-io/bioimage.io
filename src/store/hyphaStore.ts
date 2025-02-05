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

interface HyphaState {
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
  resourceType: null,
  setClient: (client) => set({ client }),
  setServer: (server) => set({ server }),
  setUser: (user) => set({ user }),
  setIsInitialized: (isInitialized) => set({ isInitialized }),
  setResources: (resources) => set({ resources }),
  setResourceType: (type) => set({ resourceType: type }),
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
  }
}));

// Remove the separate initialization function since it's now part of the store 