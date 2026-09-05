/**
 * React wrapper around `fetchTrainingCapabilities`. Mount it wherever a
 * base-model picker renders; the underlying fetch is cached per tab, so several
 * mounts cost one round-trip.
 *
 * Failure is not an error state the caller has to render. On failure the hook
 * returns `capabilities: null`, which the `isModelTrainable` helper reads as
 * "no verdict, leave everything enabled". `error` is exposed only so a caller
 * can log it or explain the missing greying, never to block the picker.
 */
import { useEffect, useState } from 'react';
import {
  fetchTrainingCapabilities,
  TrainingCapabilities,
} from '../utils/trainingCapabilities';
import { subscribeTrainingServiceOverride } from '../utils/trainingServicePin';

export interface UseTrainingCapabilitiesResult {
  capabilities: TrainingCapabilities | null;
  loading: boolean;
  error: string | null;
}

/**
 * @param server A connected hypha-rpc server proxy, or null while connecting.
 *               Passing null keeps the hook idle rather than erroring, so a
 *               picker can render before login completes.
 */
export function useTrainingCapabilities(server: any | null): UseTrainingCapabilitiesResult {
  const [capabilities, setCapabilities] = useState<TrainingCapabilities | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Capabilities describe whichever replica answered, so pointing the UI at a
  // different service invalidates them. Refetch instead of leaving the picker
  // greying models against a GPU that is no longer the one training.
  const [serviceNonce, setServiceNonce] = useState(0);

  useEffect(() => subscribeTrainingServiceOverride(() => setServiceNonce((n) => n + 1)), []);

  useEffect(() => {
    if (!server) return;
    let cancelled = false;
    setLoading(true);
    setError(null);
    fetchTrainingCapabilities(server)
      .then((caps) => {
        if (cancelled) return;
        setCapabilities(caps);
      })
      .catch((err) => {
        if (cancelled) return;
        // Deliberately non-fatal: the picker falls back to offering everything
        // and start_training rejects an unfit model with a readable error.
        console.warn('[useTrainingCapabilities] Could not read trainer capabilities:', err);
        setCapabilities(null);
        setError((err as Error)?.message || String(err));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [server, serviceNonce]);

  return { capabilities, loading, error };
}
