/**
 * The training-sessions poll loop, extracted so its scheduling can be tested.
 *
 * It used to be an inline closure in Finetune.tsx that rescheduled itself only
 * on the success path:
 *
 *     try   { ...; if (hasRunning) setTimeout(tick, 5000); }
 *     catch { setSessionsError(...); }          // and nothing else
 *
 * so one throwing call ended polling permanently. That defect is MEASURED, by
 * reading the code above and by the tests beside this file: nine of them, four
 * of which go red against the old stop-on-error behaviour.
 *
 * What prompted the fix was an incident on 2026-11-11, and its attribution is
 * INFERRED rather than measured, so do not read this file as having closed it.
 * Measured there: a cellpose run the backend recorded COMPLETED 43 seconds in
 * read PREPARING for the next 19 minutes across 60 samples, and the stored
 * record was never stale (`updated_at` equalled `end_time`, no later write).
 * Not measured: whether those 60 samples read the rendered card or the
 * service. Only the first reading is this defect. The second would mean the
 * service returned PREPARING while its own record said COMPLETED, which is a
 * backend matter and would survive this fix untouched.
 *
 * The arithmetic is the part worth keeping, because it says the samples were
 * not this loop's output either way. The window 17:02:13Z to 17:26:53Z is
 * 1480 s, and 60 samples across it are about 25 s apart (24.7 s per sample,
 * 25.1 s per interval). The old loop's only cadence was 5 s, which would have
 * put roughly 296 polls in that window. So whatever took those 60 samples was
 * something other than the page's poll loop, and nothing that survived the
 * incident says what. See issue #0081.
 *
 * There is also a third mechanism neither reading covers: per
 * `trainingServicePin.ts`, a training session's store lives on one replica's
 * local disk, so a call landing on another replica legitimately reports a
 * different view. That is why the pin exists. Nothing recorded whether the
 * pin held for the whole of this incident, so it is not ruled out either.
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
