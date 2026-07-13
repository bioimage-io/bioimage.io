import { create } from 'zustand';

/**
 * Shared model-runner connection override, used by the Advanced Options popover
 * on every page (Edit, Upload, Review, ModelRunner). Keeping it in one store
 * means a custom Server URL / Service ID set on any page applies everywhere and
 * survives navigation — the Advanced Options controls are literally the same
 * state no matter where they are rendered.
 *
 * Empty `serverUrl` means "use the default Hypha server". Empty
 * `serviceIdOverride` means "let the runner-site toggle decide".
 */
interface RunnerConnectionState {
  serverUrl: string;
  setServerUrl: (url: string) => void;
  serviceIdOverride: string;
  setServiceIdOverride: (id: string) => void;
}

export const useRunnerConnectionStore = create<RunnerConnectionState>((set) => ({
  serverUrl: '',
  setServerUrl: (serverUrl) => set({ serverUrl }),
  serviceIdOverride: '',
  setServiceIdOverride: (serviceIdOverride) => set({ serviceIdOverride }),
}));
