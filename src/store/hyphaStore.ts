import { create } from 'zustand';
// import { hRPC } from 'hypha';

// Add this to handle the window type for hypha client
declare global {
  interface Window {
    hyphaWebsocketClient: any;
  }
}

interface HyphaState {
  client: typeof import('hypha-rpc').hyphaRPCModule.hyphaWebsocketClient | null;
  server: any;
  setClient: (client: typeof import('hypha-rpc').hyphaRPCModule.hyphaWebsocketClient) => void;
  setServer: (server: any) => void;
  user: any;
  setUser: (user: any) => void;
  isInitialized: boolean;
  setIsInitialized: (isInitialized: boolean) => void;
}

export const useHyphaStore = create<HyphaState>((set) => ({
  client: null,
  server: null,
  user: {},
  isInitialized: false,
  setClient: (client) => set({ client }),
  setServer: (server) => set({ server }),
  setUser: (user) => set({ user }),
  setIsInitialized: (isInitialized) => set({ isInitialized })
}));

// Initialize hypha client when the script loads
export const initializeHyphaClient = async () => {
  const store = useHyphaStore.getState();
  if (!store.isInitialized) {
    try {
      const { hyphaWebsocketClient } = await import('hypha-rpc');
      store.setClient(hyphaWebsocketClient);
      store.setIsInitialized(true);
      console.log('Hypha client initialized');
    } catch (error) {
      console.error('Failed to initialize Hypha client:', error);
    }
  }
}; 