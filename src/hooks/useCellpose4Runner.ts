import { useEffect, useState } from 'react';
import { hyphaWebsocketClient } from 'hypha-rpc';
import { HYPHA_SERVER_URL } from '../config/hypha';
import { BIOIMAGEIO_KTH_CELLPOSE4_RUNNER_SERVICE_ID } from '../utils/bioengineService';

export interface UseCellpose4RunnerResult {
  /** `true` once the supported-model list has been fetched successfully. */
  available: boolean;
  /** `true` until the first probe attempt has settled, successfully or not. */
  loading: boolean;
  /** The KTH-only cellpose4-runner service id. Always this value, no deNBI counterpart. */
  serviceId: string;
  /** Whether the given model id is in cellpose4-runner's supported list. `false` until the list is known. */
  isSupported: (modelId?: string | null) => boolean;
}

const RETRY_INTERVAL_MS = 30000;
// connectToServer hangs rather than rejecting when the websocket cannot be
// established, so without a deadline a probe started while the network is
// down would never settle and never schedule a retry.
const PROBE_TIMEOUT_MS = 15000;

// In-memory only, deliberately: the list lives for the life of the tab and a
// reload re-fetches it, so a newly supported model shows up without anyone
// having to clear a persisted cache.
let supportedModels: string[] | null = null;
// Distinct from `supportedModels !== null`: the first attempt can settle by
// failing, and consumers must not stay blocked on a runner that is down.
let firstAttemptSettled = false;
let probeStarted = false;
let retryTimer: ReturnType<typeof setTimeout> | null = null;
const listeners = new Set<() => void>();

const notify = () => listeners.forEach((fn) => fn());

const scheduleRetry = () => {
  if (retryTimer !== null) return;
  retryTimer = setTimeout(() => {
    retryTimer = null;
    void runProbe();
  }, RETRY_INTERVAL_MS);
};

async function fetchSupportedModels(): Promise<string[]> {
  // Anonymous on purpose. The supported-model list is public, and not waiting
  // for login means the answer is usually in hand before the model detail page
  // has finished rendering, so the Test Run button never has to show a wrong
  // status first.
  const server = await hyphaWebsocketClient.connectToServer({ server_url: HYPHA_SERVER_URL });
  try {
    const svc = await server.getService(BIOIMAGEIO_KTH_CELLPOSE4_RUNNER_SERVICE_ID, {
      mode: 'select:min:get_load',
    });
    const models = await svc.list_supported_models();
    return Array.isArray(models) ? models : [];
  } finally {
    try {
      await server.disconnect();
    } catch {
      // Best effort; the probe result is already in hand either way.
    }
  }
}

async function runProbe(): Promise<void> {
  try {
    supportedModels = await Promise.race([
      fetchSupportedModels(),
      new Promise<string[]>((_, reject) =>
        setTimeout(() => reject(new Error('cellpose4-runner probe timed out')), PROBE_TIMEOUT_MS)
      ),
    ]);
  } catch (err) {
    // Worker down, still starting, or offline. Keep retrying in the
    // background so a page opened before the cluster is reachable picks the
    // route up without a reload.
    console.warn(`[cellpose4-runner] probe failed, retrying in ${RETRY_INTERVAL_MS / 1000}s:`, err);
    scheduleRetry();
  } finally {
    firstAttemptSettled = true;
    notify();
  }
}

/**
 * Kick off the background probe. Safe to call any number of times; only the
 * first call starts it.
 */
export function startCellpose4Probe(): void {
  if (probeStarted) return;
  probeStarted = true;
  void runProbe();
}

// Start as soon as the bundle evaluates rather than on first mount, so the
// list is already in flight while the page is still loading.
startCellpose4Probe();

export function useCellpose4Runner(): UseCellpose4RunnerResult {
  const [, forceUpdate] = useState(0);

  useEffect(() => {
    startCellpose4Probe();
    const listener = () => forceUpdate((n) => n + 1);
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  }, []);

  const isSupported = (modelId?: string | null): boolean => {
    if (!supportedModels || !modelId) return false;
    return supportedModels.includes(modelId);
  };

  return {
    available: supportedModels !== null,
    loading: !firstAttemptSettled,
    serviceId: BIOIMAGEIO_KTH_CELLPOSE4_RUNNER_SERVICE_ID,
    isSupported,
  };
}
