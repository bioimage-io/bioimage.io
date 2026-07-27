import React, { useCallback, useEffect, useRef, useState } from 'react';
import { hyphaWebsocketClient } from 'hypha-rpc';
import { useHyphaStore } from '../store/hyphaStore';
import { HYPHA_SERVER_URL } from '../config/hypha';

// Wait 30s between recovery probes. KTH-K8s style outages we usually see
// resolve in under a minute, so a fixed 30s tick is fast enough to feel
// responsive without hammering the server during a real incident.
const PROBE_INTERVAL_SEC = 30;
// Abort a probe that hasn't answered in this window. Without a timeout a
// request that hangs on a slow or throttled connection never resolves, so the
// countdown never restarts and the banner sticks forever. A timed-out probe
// also lets us tell "slow link" apart from "hard connection failure".
const PROBE_TIMEOUT_MS = 8000;
const HEALTH_URL = `${HYPHA_SERVER_URL}/bioimage-io/artifacts/bioimage.io`;

// Why the recovery probe last failed, used only to pick the wording. We can't
// prove whose fault an outage is from the browser, so the copy stays neutral;
// this only nudges it toward "slow link" vs "can't connect".
type FailureKind = 'timeout' | 'error';

// Marks a probe leg that exceeded PROBE_TIMEOUT_MS (vs. one that was refused).
class ProbeTimeoutError extends Error {}

/** Reject with ProbeTimeoutError if `promise` hasn't settled within `ms`. */
function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new ProbeTimeoutError('probe timed out')), ms);
    promise.then(
      value => { clearTimeout(timer); resolve(value); },
      err => { clearTimeout(timer); reject(err); }
    );
  });
}

/**
 * Single source of "Hypha is temporarily unreachable" UI. Sits sticky at the
 * top of the layout. While `isHyphaUnreachable` is true the banner runs a
 * tiny probe loop with two legs: a REST GET against the same artifact endpoint
 * partners and the artifact-manager talk to, and a throwaway anonymous
 * hypha-rpc websocket handshake. Both must succeed before the global flag
 * clears and the banner unmounts itself, because the flag is often raised by
 * the websocket dropping while REST stays up.
 *
 * Per-section components are expected to react to the same store flag —
 * usually by rendering a quiet placeholder instead of their own red error
 * boxes — so the explanation lives in exactly one place.
 *
 * Dev hooks:
 *   ?previewHyphaUnreachable=1   forces the banner visible without sending
 *                                real fetches; the countdown still ticks so
 *                                the visual can be inspected at any time.
 *   ?probeUrl=https://httpstat.us/503
 *                                overrides the recovery probe URL so the real
 *                                loop can be exercised against a known-bad
 *                                endpoint. Combine with the preview flag
 *                                above to see the failure/recovery flow.
 */
const HyphaStatusBanner: React.FC = () => {
  const isHyphaUnreachable = useHyphaStore(s => s.isHyphaUnreachable);
  const markHyphaUnreachable = useHyphaStore(s => s.markHyphaUnreachable);
  const markHyphaReachable = useHyphaStore(s => s.markHyphaReachable);
  const [isProbing, setIsProbing] = useState(false);
  const [secondsUntilProbe, setSecondsUntilProbe] = useState<number | null>(null);
  // navigator.onLine is a weak signal: `true` doesn't guarantee real
  // connectivity, but `false` reliably means the device itself is offline. We
  // use that asymmetry to switch the copy to a definite "you are offline"
  // message and stay neutral otherwise.
  const [isOffline, setIsOffline] = useState<boolean>(
    typeof navigator !== 'undefined' ? navigator.onLine === false : false
  );
  const [lastFailureKind, setLastFailureKind] = useState<FailureKind | null>(null);
  const tickTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const params =
    typeof window !== 'undefined' ? new URLSearchParams(window.location.search) : null;
  const isPreview = params?.get('previewHyphaUnreachable') === '1';
  const probeUrlOverride = params?.get('probeUrl') || null;
  const effectiveHealthUrl = probeUrlOverride || HEALTH_URL;
  // Preview means "force visible" only when no real URL is supplied.
  // With probeUrl we want actual fetches so the developer can verify timers,
  // error handling, and recovery against a controlled URL.
  const simulateOnly = isPreview && !probeUrlOverride;

  useEffect(() => {
    if (isPreview && !isHyphaUnreachable) {
      markHyphaUnreachable('Preview: simulated outage');
    }
  }, [isPreview, isHyphaUnreachable, markHyphaUnreachable]);

  const stopTicking = useCallback(() => {
    if (tickTimerRef.current) {
      clearInterval(tickTimerRef.current);
      tickTimerRef.current = null;
    }
  }, []);

  // Use a ref so the tick callback always sees the latest probe function
  // without forcing the tick interval to be torn down and recreated each
  // time `probe`'s identity changes.
  const probeRef = useRef<() => Promise<void> | void>(() => {});

  const startCountdown = useCallback(() => {
    stopTicking();
    setSecondsUntilProbe(PROBE_INTERVAL_SEC);
    tickTimerRef.current = setInterval(() => {
      setSecondsUntilProbe(prev => {
        if (prev === null) return null;
        if (prev <= 1) {
          // Don't fire the probe synchronously inside the state setter —
          // schedule it on the next tick so React can finish committing.
          setTimeout(() => { void probeRef.current(); }, 0);
          return null;
        }
        return prev - 1;
      });
    }, 1000);
  }, [stopTicking]);

  const probe = useCallback(async () => {
    stopTicking();
    setSecondsUntilProbe(null);
    if (simulateOnly) {
      // No network call. Just count down and "fail" so the developer can
      // watch the visual loop.
      startCountdown();
      return;
    }
    setIsProbing(true);
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), PROBE_TIMEOUT_MS);
    try {
      // Leg 1 — REST: the artifact endpoint partners and the artifact-manager
      // talk to.
      const restCheck = (async () => {
        const response = await fetch(effectiveHealthUrl, {
          method: 'GET',
          cache: 'no-store',
          signal: controller.signal,
        });
        if (!response.ok) {
          throw new Error(`HTTP ${response.status}`);
        }
      })();

      // Leg 2 — RPC/WebSocket: the banner is also raised when the hypha-rpc
      // socket fails while REST is fine (see hyphaStore.connect and
      // partnerService), so a REST-only probe would clear the banner while the
      // socket is still down. Open a throwaway anonymous websocket to confirm
      // the real handshake works, then tear it straight back down. We connect
      // anonymously on purpose: this only tests reachability and must not
      // disturb the user's authenticated socket. Skipped when a probeUrl
      // override is present so the failure-injection dev hook still drives the
      // loop off the REST leg alone.
      const rpcCheck = probeUrlOverride
        ? Promise.resolve()
        : withTimeout(
            hyphaWebsocketClient
              .connectToServer({ server_url: HYPHA_SERVER_URL })
              .then(async (server: any) => {
                // Tear down whenever the connect resolves, even if the timeout
                // already declared this probe a failure, so no socket leaks.
                try {
                  await server.disconnect();
                } catch {
                  /* best-effort teardown */
                }
              }),
            PROBE_TIMEOUT_MS
          );

      // Both legs must succeed. If the socket is down but REST is up, we keep
      // the banner rather than falsely clearing it.
      await Promise.all([restCheck, rpcCheck]);
      setLastFailureKind(null);
      markHyphaReachable();
    } catch (err) {
      // A timed-out or aborted leg means the path was too slow rather than
      // outright refused. Everything else (network error, DNS, non-2xx, failed
      // handshake) is a plain connection failure.
      const kind: FailureKind =
        err instanceof ProbeTimeoutError ||
        (err instanceof DOMException && err.name === 'AbortError')
          ? 'timeout'
          : 'error';
      setLastFailureKind(kind);
      startCountdown();
    } finally {
      clearTimeout(timeoutId);
      setIsProbing(false);
    }
  }, [
    simulateOnly,
    effectiveHealthUrl,
    probeUrlOverride,
    stopTicking,
    startCountdown,
    markHyphaReachable,
  ]);

  // Keep the ref pointed at the latest probe so the tick interval doesn't
  // need to be rebuilt every time `probe`'s identity changes.
  useEffect(() => {
    probeRef.current = probe;
  }, [probe]);

  // Track the device's own connectivity. Going offline switches the copy to a
  // definite "you are offline" message; coming back online kicks an immediate
  // probe so the banner clears the moment the link returns instead of waiting
  // out the countdown.
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const handleOffline = () => setIsOffline(true);
    const handleOnline = () => {
      setIsOffline(false);
      void probeRef.current();
    };
    window.addEventListener('offline', handleOffline);
    window.addEventListener('online', handleOnline);
    return () => {
      window.removeEventListener('offline', handleOffline);
      window.removeEventListener('online', handleOnline);
    };
  }, []);

  useEffect(() => {
    if (!isHyphaUnreachable) {
      stopTicking();
      setSecondsUntilProbe(null);
      return;
    }
    // Kick the probe loop the first moment we flip into the unreachable
    // state. Subsequent probes self-schedule via the countdown tick.
    void probe();
    return stopTicking;
    // We deliberately only re-run on the unreachable flag changing — the
    // probe identity is stable enough via the ref and we don't want the
    // countdown to restart when query params change mid-session.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isHyphaUnreachable]);

  if (!isHyphaUnreachable) return null;

  // Pick wording from what we can actually observe in the browser. We never
  // claim the outage is on our side: from here we can't tell a real backend
  // incident apart from a slow link or a route that doesn't reach the service
  // from the user's network or region.
  let title: string;
  let lead: string;
  if (isOffline) {
    title = 'You appear to be offline.';
    lead = 'Models, datasets, and interactive features stay unavailable until your device reconnects.';
  } else if (lastFailureKind === 'timeout') {
    title = 'BioImage.IO is slow to respond.';
    lead = 'Your connection looks slow, or the service may be briefly unavailable.';
  } else {
    title = 'BioImage.IO services are currently unreachable.';
    lead = 'This can be caused by your network or region, or the service may be temporarily unavailable.';
  }

  return (
    <div
      role="status"
      aria-live="polite"
      // Sticky just below the top of the viewport so it overlays any
      // navbar without taking permanent layout space when healthy.
      className="sticky top-0 z-50 bg-amber-50/95 border-b border-amber-200/70 backdrop-blur-sm shadow-sm"
    >
      <div className="max-w-[1400px] mx-auto px-4 sm:px-6 py-2 flex items-center gap-3 text-sm">
        <span
          className="inline-flex w-2 h-2 rounded-full bg-amber-500 flex-shrink-0"
          aria-hidden="true"
        />
        <span className="text-amber-900 flex-1 min-w-0">
          <strong className="font-semibold">{title}</strong>{' '}
          <span className="text-amber-900/85">
            {lead}{' '}
            {isProbing ? (
              <span className="font-medium text-amber-900">Checking the connection now...</span>
            ) : secondsUntilProbe !== null ? (
              <>
                Trying again in{' '}
                <span className="font-medium text-amber-900 tabular-nums">
                  {secondsUntilProbe}s
                </span>
                .
              </>
            ) : isOffline ? (
              'Waiting for your connection to return.'
            ) : (
              'This often clears on its own shortly.'
            )}
          </span>
        </span>
        <button
          type="button"
          onClick={() => { void probe(); }}
          disabled={isProbing}
          className="inline-flex items-center gap-1.5 px-2.5 py-1 text-xs font-medium rounded-md border border-amber-300/80 bg-white/70 text-amber-900 hover:bg-white focus:outline-none focus-visible:ring-2 focus-visible:ring-amber-500/40 transition-transform duration-150 ease-out active:scale-[0.97] disabled:opacity-60 disabled:cursor-not-allowed"
        >
          {isProbing ? (
            <>
              <svg className="w-3.5 h-3.5 animate-spin" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
              </svg>
              Reconnecting...
            </>
          ) : (
            'Try now'
          )}
        </button>
      </div>
    </div>
  );
};

export default HyphaStatusBanner;
