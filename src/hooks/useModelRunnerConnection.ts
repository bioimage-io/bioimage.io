import { useCallback, useEffect, useMemo, useState } from 'react';
import { hyphaWebsocketClient } from 'hypha-rpc';
import { useHyphaStore } from '../store/hyphaStore';
import { useRunnerConnectionStore } from '../store/runnerConnectionStore';
import { useModelRunners, UseModelRunnersResult } from './useModelRunners';
import { RUNNER_SITES, RunnerSite } from '../utils/bioengineService';
import { HYPHA_SERVER_URL } from '../config/hypha';

/**
 * Shared runner-connection state behind the Advanced Options popover.
 *
 * Bundles the runner-site selection, the free-form Service ID / Server URL
 * override, the override probe, and the reconnect action that were previously
 * copy-pasted into Edit, Upload and Review. Consumers pass `modelRunners` to
 * ModelTester / ModelValidator (a resolved runner handle) and spread the rest
 * into the shared <AdvancedOptions> component so the popover looks and behaves
 * identically everywhere.
 */
export interface ModelRunnerConnection {
  /** Effective runner state — the override runner when a Service ID is typed,
   *  otherwise the plain per-site selection. Pass to ModelTester/ModelValidator. */
  modelRunners: UseModelRunnersResult;
  /** Underlying per-site probe (used for the toggle's availability dots). */
  baseRunners: UseModelRunnersResult;
  serviceIdOverride: string;
  setServiceIdOverride: (value: string) => void;
  serverUrl: string;
  setServerUrl: (value: string) => void;
  /** Highlighted toggle segment (null when the override is a custom id). */
  toggleSelected: RunnerSite | null;
  selectSite: (site: RunnerSite) => void;
  /** Reset the shared Hypha connection. */
  reset: () => Promise<void>;
  isReconnecting: boolean;
  isConnecting: boolean;
}

export function useModelRunnerConnection(): ModelRunnerConnection {
  const { server, isConnecting, reconnect } = useHyphaStore();
  const baseRunners = useModelRunners();

  // Server URL + Service ID override live in a shared store so the Advanced
  // Options popover is literally the same state on every page (Edit / Upload /
  // Review / ModelRunner) and persists across navigation.
  const { serverUrl, setServerUrl, serviceIdOverride, setServiceIdOverride } = useRunnerConnectionStore();

  const [isReconnecting, setIsReconnecting] = useState(false);
  const [overrideRunner, setOverrideRunner] = useState<{ runner: any; available: boolean } | null>(null);

  // Probe the override service id whenever it (or the Server URL) changes. A
  // custom Server URL opens a one-off connection so the global hyphaStore
  // connection (artifact-manager etc.) is left untouched.
  useEffect(() => {
    const target = serviceIdOverride.trim();
    if (!target) { setOverrideRunner(null); return; }
    const customServerUrl = serverUrl.trim();
    const usingCustomServer = customServerUrl && customServerUrl !== HYPHA_SERVER_URL;
    if (!server && !usingCustomServer) { setOverrideRunner(null); return; }

    let alive = true;
    (async () => {
      try {
        const probeServer = usingCustomServer
          ? await hyphaWebsocketClient.connectToServer({ server_url: customServerUrl })
          : server;
        if (!alive || !probeServer) return;
        const r = await probeServer.getService(target, { mode: 'select:min:get_load' });
        if (alive) setOverrideRunner({ runner: r, available: true });
      } catch {
        if (alive) setOverrideRunner({ runner: null, available: false });
      }
    })();
    return () => { alive = false; };
  }, [server, serviceIdOverride, serverUrl]);

  // When the override is set, swap activeRunner / activeServiceId so consumers
  // hit the overridden service; otherwise fall through to baseRunners.
  const modelRunners = useMemo<UseModelRunnersResult>(() => {
    const target = serviceIdOverride.trim();
    if (!target) return baseRunners;
    return {
      ...baseRunners,
      activeRunner: overrideRunner?.runner ?? null,
      activeServiceId: target,
      hasAny: !!overrideRunner?.available || baseRunners.hasAny,
    };
  }, [baseRunners, overrideRunner, serviceIdOverride]);

  const trimmedOverride = serviceIdOverride.trim();
  const toggleSelected: RunnerSite | null = !trimmedOverride
    ? baseRunners.selected
    : (RUNNER_SITES.find(s => s.serviceId === trimmedOverride)?.id ?? null);

  const selectSite = useCallback((site: RunnerSite) => {
    const target = RUNNER_SITES.find(s => s.id === site);
    if (target) setServiceIdOverride(target.serviceId);
    baseRunners.setSelected(site);
  }, [baseRunners]);

  const reset = useCallback(async () => {
    setIsReconnecting(true);
    try { await reconnect(); } finally { setIsReconnecting(false); }
  }, [reconnect]);

  return {
    modelRunners,
    baseRunners,
    serviceIdOverride,
    setServiceIdOverride,
    serverUrl,
    setServerUrl,
    toggleSelected,
    selectSite,
    reset,
    isReconnecting,
    isConnecting,
  };
}
