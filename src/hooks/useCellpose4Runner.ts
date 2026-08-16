import { useEffect, useState } from 'react';
import { useHyphaStore } from '../store/hyphaStore';
import { BIOIMAGEIO_KTH_CELLPOSE4_RUNNER_SERVICE_ID } from '../utils/bioengineService';

export interface UseCellpose4RunnerResult {
  /** `true` once the KTH cellpose4-runner service has been resolved. */
  available: boolean;
  /** `true` while the initial probe (service resolve + list_supported_models) is in flight. */
  loading: boolean;
  /** Resolved service handle, or `null` while loading / unavailable. */
  runner: any | null;
  /** The KTH-only cellpose4-runner service id. Always this value, no deNBI counterpart. */
  serviceId: string;
  /** Whether the given model id is in cellpose4-runner's supported list. `false` while loading/unavailable. */
  isSupported: (modelId?: string | null) => boolean;
}

// Cellpose-4 support rarely changes and every model-detail page mount would
// otherwise re-probe the service and re-list its supported models. Cache the
// list at module scope for the life of the tab; a full reload re-fetches.
let cachedSupportedModels: string[] | null = null;

export function useCellpose4Runner(): UseCellpose4RunnerResult {
  const { server, isLoggedIn } = useHyphaStore();
  const [available, setAvailable] = useState(false);
  const [loading, setLoading] = useState(true);
  const [runner, setRunner] = useState<any | null>(null);
  const [supportedModels, setSupportedModels] = useState<string[]>(cachedSupportedModels ?? []);

  useEffect(() => {
    if (!server || !isLoggedIn) {
      setAvailable(false);
      setLoading(false);
      setRunner(null);
      return;
    }

    if (cachedSupportedModels !== null) {
      // Already known from a prior mount this session — still resolve the
      // service handle (cheap, needed for inference) but skip the list call.
      setLoading(true);
      let alive = true;
      (async () => {
        try {
          const svc = await server.getService(BIOIMAGEIO_KTH_CELLPOSE4_RUNNER_SERVICE_ID, { mode: 'select:min:get_load' });
          if (!alive) return;
          setRunner(svc);
          setAvailable(true);
          setSupportedModels(cachedSupportedModels!);
        } catch {
          if (!alive) return;
          setRunner(null);
          setAvailable(false);
        } finally {
          if (alive) setLoading(false);
        }
      })();
      return () => { alive = false; };
    }

    let alive = true;
    (async () => {
      try {
        const svc = await server.getService(BIOIMAGEIO_KTH_CELLPOSE4_RUNNER_SERVICE_ID, { mode: 'select:min:get_load' });
        const models: string[] = await svc.list_supported_models();
        if (!alive) return;
        cachedSupportedModels = models;
        setRunner(svc);
        setAvailable(true);
        setSupportedModels(models);
      } catch {
        if (!alive) return;
        setRunner(null);
        setAvailable(false);
      } finally {
        if (alive) setLoading(false);
      }
    })();

    return () => { alive = false; };
  }, [server, isLoggedIn]);

  const isSupported = (modelId?: string | null): boolean => {
    if (loading || !available || !modelId) return false;
    return supportedModels.includes(modelId);
  };

  return {
    available,
    loading,
    runner,
    serviceId: BIOIMAGEIO_KTH_CELLPOSE4_RUNNER_SERVICE_ID,
    isSupported,
  };
}
