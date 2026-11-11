/**
 * The training-sessions poll loop, extracted so its scheduling can be tested.
 *
 * It used to be an inline closure in Finetune.tsx that rescheduled itself only
 * on the success path:
 *
 *     try   { ...; if (hasRunning) setTimeout(tick, 5000); }
 *     catch { setSessionsError(...); }          // and nothing else
 *
 * so one throwing call ended polling permanently. Measured 2026-11-11: a
 * cellpose run the backend recorded COMPLETED 43 seconds in showed PREPARING
 * on the page for the next 19 minutes, across 60 reads. The stored record was
 * never stale (`updated_at` equalled `end_time`, no later write), so the page
 * had simply stopped asking.
 *
 * That failure is worse than it sounds because it is SILENT in the direction
 * that matters: the card keeps rendering its last value, so a finished run
 * looks like it is still preparing and a stuck run looks exactly like a
 * working one. Which is the very thing the fine-tuning page is supposed to
 * tell apart.
 *
 * Nothing here touches React. `schedule` is injected so tests can drive it
 * with fake timers, and so is the fetch.
 */

export interface PollerOptions<T> {
  /** One poll. Rejecting is expected and is what the retry exists for. */
  fetchSessions: () => Promise<T>;
  /** True while anything is non-terminal, i.e. while polling is worth doing. */
  hasRunning: (result: T) => boolean;
  /** Called after every successful poll. */
  onResult: (result: T) => void;
  /**
   * Called when a poll throws. `willRetry` is false on the attempt that gives
   * up, which is the only moment the user needs telling that the page has
   * stopped tracking.
   */
  onError: (error: unknown, info: { consecutiveFailures: number; willRetry: boolean }) => void;
  /** Deferred execution. Returns a handle the caller can cancel. */
  schedule: (fn: () => void, delayMs: number) => any;
  cancel: (handle: any) => void;
  /** Gap between successful polls. */
  intervalMs?: number;
  /**
   * Consecutive failures tolerated before giving up. Bounded on purpose: a
   * page left open against a dead worker should not retry until the tab
   * closes, and a loop that never gives up cannot report that it has.
   */
  maxConsecutiveFailures?: number;
  /** First retry delay. Doubles per consecutive failure, capped. */
  retryBaseMs?: number;
  retryMaxMs?: number;
}

export interface Poller {
  /** Begin, or resume after the loop has stopped. Idempotent while running. */
  start: () => void;
  /** Stop and cancel any pending wake-up. */
  stop: () => void;
  /** True while a wake-up is pending or a poll is in flight. */
  isRunning: () => boolean;
}

export function createSessionPoller<T>(options: PollerOptions<T>): Poller {
  const {
    fetchSessions,
    hasRunning,
    onResult,
    onError,
    schedule,
    cancel,
    intervalMs = 5000,
    maxConsecutiveFailures = 5,
    retryBaseMs = 5000,
    retryMaxMs = 60000,
  } = options;

  let handle: any = null;
  let active = false;
  let inFlight = false;
  let consecutiveFailures = 0;

  const clearPending = () => {
    if (handle !== null) {
      cancel(handle);
      // Always null it. The old code left a fired timer id in place, and the
      // manual Refresh button guarded on that id being falsy, so once polling
      // stopped Refresh could never start it again.
      handle = null;
    }
  };

  const queue = (delayMs: number) => {
    clearPending();
    handle = schedule(() => {
      handle = null;
      void tick();
    }, delayMs);
  };

  const tick = async (): Promise<void> => {
    if (!active) return;
    inFlight = true;
    try {
      const result = await fetchSessions();
      if (!active) return;
      consecutiveFailures = 0;
      onResult(result);
      if (hasRunning(result)) queue(intervalMs);
      else stop();
    } catch (error) {
      if (!active) return;
      consecutiveFailures += 1;
      const willRetry = consecutiveFailures < maxConsecutiveFailures;
      onError(error, { consecutiveFailures, willRetry });
      if (willRetry) {
        // Back off so a worker that is down is not hammered, but keep trying:
        // a transient websocket hiccup must not cost the user the rest of the
        // run's progress.
        const delay = Math.min(retryMaxMs, retryBaseMs * 2 ** (consecutiveFailures - 1));
        queue(delay);
      } else {
        stop();
      }
    } finally {
      inFlight = false;
    }
  };

  function stop() {
    active = false;
    clearPending();
  }

  return {
    start: () => {
      if (active) return;
      active = true;
      consecutiveFailures = 0;
      void tick();
    },
    stop,
    isRunning: () => active && (handle !== null || inFlight),
  };
}
