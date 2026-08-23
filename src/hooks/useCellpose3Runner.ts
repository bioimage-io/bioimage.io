import { useEffect, useState } from 'react';
import { HYPHA_SERVER_URL } from '../config/hypha';
import { BIOIMAGEIO_CELLPOSE3_RUNNER_SERVICE_ID } from '../utils/bioengineService';

export interface UseCellpose3RunnerResult {
  /** `true` once the supported-model list has been fetched successfully. */
  available: boolean;
  /** `true` until the first probe attempt has settled, successfully or not. */
  loading: boolean;
  /** The cellpose3-runner service id. */
  serviceId: string;
  /** Whether the given model id is in cellpose3-runner's supported list. `false` until the list is known. */
  isSupported: (modelId?: string | null) => boolean;
}

const RETRY_INTERVAL_MS = 30000;
const PROBE_TIMEOUT_MS = 15000;

// Hypha exposes every service method over plain HTTP as well, so the list can
// be read with a single unauthenticated GET instead of opening an RPC
// websocket. That is both faster and independent of the login state.
//
// `_mode` is required, not optional: the service id is unqualified, and once
// more than one worker registers cellpose3-runner an unmoded GET answers 400
// ("Multiple services found") instead of picking one. `first` rather than the
// `select:min:get_load` the inference calls use, because every replica returns
// the same static list and skipping the load query keeps the probe cheap.
const SUPPORTED_MODELS_URL =
  `${HYPHA_SERVER_URL}/${BIOIMAGEIO_CELLPOSE3_RUNNER_SERVICE_ID.replace('/', '/services/')}`
  + '/list_supported_models?_mode=first';

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

async function fetchSupportedModels(signal: AbortSignal): Promise<string[]> {
  // Unauthenticated on purpose. The supported-model list is public, and not
  // waiting for login means the answer is usually in hand before the model
  // detail page has finished rendering, so the Test Run button never has to
  // show a wrong status first.
  const res = await fetch(SUPPORTED_MODELS_URL, { signal });
  if (!res.ok) throw new Error(`cellpose3-runner responded ${res.status}`);
  const models = await res.json();
  return Array.isArray(models) ? models : [];
}

async function runProbe(): Promise<void> {
  const controller = new AbortController();
  const deadline = setTimeout(() => controller.abort(), PROBE_TIMEOUT_MS);
  try {
    supportedModels = await fetchSupportedModels(controller.signal);
  } catch (err) {
    // Worker down, still starting, or offline. Keep retrying in the
    // background so a page opened before the cluster is reachable picks the
    // route up without a reload.
    console.warn(`[cellpose3-runner] probe failed, retrying in ${RETRY_INTERVAL_MS / 1000}s:`, err);
    scheduleRetry();
  } finally {
    clearTimeout(deadline);
    firstAttemptSettled = true;
    notify();
  }
}

/**
 * Kick off the background probe. Safe to call any number of times; only the
 * first call starts it.
 */
export function startCellpose3Probe(): void {
  if (probeStarted) return;
  probeStarted = true;
  void runProbe();
}

// Start as soon as the bundle evaluates rather than on first mount, so the
// list is already in flight while the page is still loading.
startCellpose3Probe();

export function useCellpose3Runner(): UseCellpose3RunnerResult {
  const [, forceUpdate] = useState(0);

  useEffect(() => {
    startCellpose3Probe();
    const listener = () => forceUpdate((n) => n + 1);
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  }, []);

  // cellpose3-runner's allow-list accepts both the bare alias and the
  // fully-qualified `bioimage-io/<name>` form, and answers with bare aliases.
  // Callers pass the bare alias, so compare on that.
  const isSupported = (modelId?: string | null): boolean => {
    if (!supportedModels || !modelId) return false;
    return supportedModels.includes(modelId);
  };

  return {
    available: supportedModels !== null,
    loading: !firstAttemptSettled,
    serviceId: BIOIMAGEIO_CELLPOSE3_RUNNER_SERVICE_ID,
    isSupported,
  };
}
