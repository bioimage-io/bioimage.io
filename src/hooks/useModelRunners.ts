import { useCallback, useEffect, useMemo, useState } from 'react';
import { useHyphaStore } from '../store/hyphaStore';
import { RUNNER_SITES, RunnerSite } from '../utils/bioengineService';

interface RunnerState {
  runner: any | null;
  available: boolean;
  loading: boolean;
  error: string | null;
}

const initialRunnerState: RunnerState = {
  runner: null,
  available: false,
  loading: true,
  error: null,
};

export interface UseModelRunnersResult {
  /** Live state for the KTH backend. */
  kth: RunnerState;
  /** Live state for the deNBI backend. */
  denbi: RunnerState;
  /** Currently selected site. Defaults to KTH; falls back to the other site if KTH probe fails. */
  selected: RunnerSite;
  /** Caller-driven setter. Ignores attempts to select an unavailable site. */
  setSelected: (site: RunnerSite) => void;
  /** Resolved runner for `selected`. `null` while loading or when no site is available. */
  activeRunner: any | null;
  /**
   * Service id string for the active site. Useful for callers that construct
   * their own client (e.g. ModelRunnerEngine) and need a stable id rather
   * than a resolved service handle. Falls back to the other site's id if
   * `selected` becomes unavailable, mirroring `activeRunner`.
   */
  activeServiceId: string | null;
  /** `true` iff at least one site responded. Drives button-disabled state in callers. */
  hasAny: boolean;
  /** `true` while either probe is still in flight on the very first attempt. */
  loading: boolean;
  /** Re-probe both sites. Useful when login state changes or the user clicks "retry". */
  refresh: () => void;
}

export interface UseModelRunnersOptions {
  /**
   * Skip the probe entirely. Useful when a parent component already calls
   * the hook and will pass the result down, so children avoid redundant
   * `server.getService(...)` round trips on render.
   */
  skip?: boolean;
}

/**
 * Probe the KTH and deNBI model-runner services in parallel, exposing each
 * site's availability so the UI can offer a graceful toggle. The hook
 * intentionally:
 *   - uses `Promise.allSettled` so one site failing does not mask the other
 *   - keeps the user-chosen `selected` site stable across re-probes
 *   - auto-falls-back from an unavailable KTH to deNBI on first probe only,
 *     so an in-flight booth demo isn't yanked to a different replica mid-task
 */
export function useModelRunners({ skip = false }: UseModelRunnersOptions = {}): UseModelRunnersResult {
  const { server, isLoggedIn } = useHyphaStore();
  const [kth, setKth] = useState<RunnerState>(initialRunnerState);
  const [denbi, setDenbi] = useState<RunnerState>(initialRunnerState);
  const [selected, setSelectedState] = useState<RunnerSite>('kth');
  const [hasPerformedInitialFallback, setHasPerformedInitialFallback] = useState(false);
  const [probeNonce, setProbeNonce] = useState(0);

  const refresh = useCallback(() => {
    setKth(initialRunnerState);
    setDenbi(initialRunnerState);
    setHasPerformedInitialFallback(false);
    setProbeNonce(n => n + 1);
  }, []);

  useEffect(() => {
    if (skip) {
      // Parent owns probing; this instance should never produce loading state.
      setKth({ runner: null, available: false, loading: false, error: null });
      setDenbi({ runner: null, available: false, loading: false, error: null });
      return;
    }
    if (!server || !isLoggedIn) {
      // Not logged in -> services are unreachable; mark both unavailable
      // so the UI disables the action button rather than spinning forever.
      const offline: RunnerState = {
        runner: null,
        available: false,
        loading: false,
        error: 'Not logged in',
      };
      setKth(offline);
      setDenbi(offline);
      return;
    }

    let alive = true;
    (async () => {
      const probes = RUNNER_SITES.map(site =>
        server.getService(site.serviceId, { mode: 'select:min:get_load' })
      );
      const results = await Promise.allSettled(probes);
      if (!alive) return;

      const next: Record<RunnerSite, RunnerState> = {} as any;
      RUNNER_SITES.forEach((site, idx) => {
        const r = results[idx];
        next[site.id] = r.status === 'fulfilled'
          ? { runner: r.value, available: true, loading: false, error: null }
          : { runner: null, available: false, loading: false, error: String((r as PromiseRejectedResult).reason) };
      });

      setKth(next.kth);
      setDenbi(next.denbi);

      // One-shot fallback: if the user-chosen default (KTH) is unavailable
      // on the very first probe and deNBI works, switch silently. We do
      // this once so a transient KTH outage during a session doesn't
      // override the user's later manual choice.
      if (!hasPerformedInitialFallback && !next.kth.available && next.denbi.available) {
        setSelectedState('denbi');
      }
      setHasPerformedInitialFallback(true);
    })();

    return () => { alive = false; };
  }, [server, isLoggedIn, probeNonce, skip]); // eslint-disable-line react-hooks/exhaustive-deps

  const setSelected = useCallback((site: RunnerSite) => {
    const state = site === 'kth' ? kth : denbi;
    if (!state.available) return;
    setSelectedState(site);
  }, [kth, denbi]);

  const effectiveSite: RunnerSite = useMemo(() => {
    const state = selected === 'kth' ? kth : denbi;
    if (state.available) return selected;
    const otherSite: RunnerSite = selected === 'kth' ? 'denbi' : 'kth';
    const otherState = selected === 'kth' ? denbi : kth;
    return otherState.available ? otherSite : selected;
  }, [selected, kth, denbi]);

  const activeRunner = useMemo(() => {
    const state = effectiveSite === 'kth' ? kth : denbi;
    return state.available ? state.runner : null;
  }, [effectiveSite, kth, denbi]);

  const activeServiceId = useMemo(() => {
    const site = RUNNER_SITES.find(s => s.id === effectiveSite);
    return site?.serviceId ?? null;
  }, [effectiveSite]);

  const hasAny = kth.available || denbi.available;
  const loading = kth.loading || denbi.loading;

  return { kth, denbi, selected, setSelected, activeRunner, activeServiceId, hasAny, loading, refresh };
}
