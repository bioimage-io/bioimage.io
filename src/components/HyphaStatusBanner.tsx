import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useHyphaStore } from '../store/hyphaStore';

// Wait 30s between recovery probes. KTH-K8s style outages we usually see
// resolve in under a minute, so a fixed 30s tick is fast enough to feel
// responsive without hammering the server during a real incident.
const PROBE_INTERVAL_SEC = 30;
const HEALTH_URL = 'https://hypha.aicell.io/bioimage-io/artifacts/bioimage.io';

/**
 * Single source of "Hypha is temporarily unreachable" UI. Sits sticky at the
 * top of the layout. While `isHyphaUnreachable` is true the banner runs a
 * tiny probe loop against the same artifact endpoint that partners and the
 * artifact-manager talk to; on the first 2xx the global flag clears and the
 * banner unmounts itself.
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
    try {
      const response = await fetch(effectiveHealthUrl, { method: 'GET', cache: 'no-store' });
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }
      markHyphaReachable();
    } catch {
      startCountdown();
    } finally {
      setIsProbing(false);
    }
  }, [simulateOnly, effectiveHealthUrl, stopTicking, startCountdown, markHyphaReachable]);

  // Keep the ref pointed at the latest probe so the tick interval doesn't
  // need to be rebuilt every time `probe`'s identity changes.
  useEffect(() => {
    probeRef.current = probe;
  }, [probe]);

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
          <strong className="font-semibold">BioImage.IO services are temporarily unreachable.</strong>{' '}
          <span className="text-amber-900/85">
            Models, datasets, and most interactive features pause while the backend restarts.{' '}
            {isProbing ? (
              <span className="font-medium text-amber-900">Reconnecting now...</span>
            ) : secondsUntilProbe !== null ? (
              <>
                Trying again in{' '}
                <span className="font-medium text-amber-900 tabular-nums">
                  {secondsUntilProbe}s
                </span>
                .
              </>
            ) : (
              'This usually resolves within a minute or two.'
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
