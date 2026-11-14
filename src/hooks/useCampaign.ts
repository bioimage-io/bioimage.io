import { useCallback, useEffect, useState } from 'react';
import { campaignService } from '../services/campaignService';
import { CampaignRecord, CampaignSummary } from '../types/campaign';

/**
 * Read hooks for the federation campaign registry.
 *
 * `error` is surfaced rather than swallowed, and `data` stays null when a read
 * fails. Nothing here substitutes a placeholder value, so a page that cannot
 * reach the campaign service shows an empty state and no numbers at all.
 */

export interface AsyncResult<T> {
  data: T | null;
  loading: boolean;
  error: Error | null;
  reload: () => void;
}

function useAsync<T>(load: () => Promise<T>, deps: unknown[]): AsyncResult<T> {
  const [data, setData] = useState<T | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);
  const [nonce, setNonce] = useState(0);

  const reload = useCallback(() => {
    campaignService.invalidate();
    setNonce((n) => n + 1);
  }, []);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    load()
      .then((result) => {
        if (cancelled) return;
        setData(result);
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        // Deliberately clears any previously loaded value: showing a stale
        // roster next to a failed refresh is worse than showing nothing.
        setData(null);
        setError(err instanceof Error ? err : new Error(String(err)));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...deps, nonce]);

  return { data, loading, error, reload };
}

export function useCampaigns(): AsyncResult<CampaignSummary[]> {
  return useAsync(() => campaignService.listCampaigns(), []);
}

export function useCampaign(campaignId: string | undefined): AsyncResult<CampaignRecord> {
  return useAsync(
    () =>
      campaignId
        ? campaignService.getCampaign(campaignId)
        : Promise.reject(new Error('No campaign id')),
    [campaignId]
  );
}
