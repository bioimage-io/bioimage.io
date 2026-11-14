import { createSessionPoller } from './sessionPoller';

// The defect these exist for: the old loop rescheduled itself only on the
// success path, so one throwing call ended polling permanently and the card
// froze on its last value. That is measured by reading the old code, and it is
// what every case below exercises.
//
// The 2026-11-11 incident that prompted it (60 samples reading PREPARING for a
// session the backend had recorded COMPLETED 43 seconds in) is a separate
// claim, and pinning it on this defect is INFERRED, not measured: nothing
// recorded whether those samples read the page or the service. See issue #0081
// and the header of sessionPoller.ts. A green run here does not retire that
// question.
//
// So the central test is "throws once, then succeeds, and the loop recovers
// on its own". Everything else guards the edges of that.
//
// The split is measured, not asserted. Replacing the retry branch in
// sessionPoller.ts with the pre-fix `stop()` turns exactly the four cases in
// "the poll loop survives a failure" red and leaves the five in "the poll loop
// stops when it should" green: 4 failed, 5 passed, 9 total. Re-run that
// negative control before trusting a green suite here, because every case
// below passes against a poller that never retries at all if the four retry
// cases are removed.

type Result = { running: boolean; tag?: string };

const flush = async () => {
  // Let the promise queue drain between timer advances: the poll body is
  // async, so a bare jest.advanceTimersByTime leaves its continuation pending.
  for (let i = 0; i < 6; i++) await Promise.resolve();
};

function harness(fetchImpl: () => Promise<Result>, opts: Partial<Parameters<typeof createSessionPoller>[0]> = {}) {
  const results: Result[] = [];
  const errors: Array<{ consecutiveFailures: number; willRetry: boolean }> = [];
  const poller = createSessionPoller<Result>({
    fetchSessions: fetchImpl,
    hasRunning: (r) => r.running,
    onResult: (r) => results.push(r),
    onError: (_e, info) => errors.push(info),
    schedule: (fn, ms) => setTimeout(fn, ms),
    cancel: (h) => clearTimeout(h),
    ...(opts as any),
  });
  return { poller, results, errors };
}

beforeEach(() => jest.useFakeTimers());
afterEach(() => jest.useRealTimers());

describe('the poll loop survives a failure', () => {
  it('retries after a throwing poll and catches up once the call succeeds', async () => {
    let calls = 0;
    const { poller, results, errors } = harness(async () => {
      calls += 1;
      if (calls === 2) throw new Error('WebSocket opening handshake timed out');
      return { running: true, tag: `call-${calls}` };
    });

    poller.start();
    await flush();
    expect(calls).toBe(1);
    expect(results).toHaveLength(1);

    jest.advanceTimersByTime(5000);
    await flush();
    expect(calls).toBe(2);
    expect(errors).toEqual([{ consecutiveFailures: 1, willRetry: true }]);
    // THE regression: the loop must still be alive after the throw.
    expect(poller.isRunning()).toBe(true);

    jest.advanceTimersByTime(5000);
    await flush();
    expect(calls).toBe(3);
    expect(results.map((r) => r.tag)).toEqual(['call-1', 'call-3']);
    expect(poller.isRunning()).toBe(true);
  });

  it('backs off on consecutive failures instead of hammering a dead worker', async () => {
    const { poller, errors } = harness(async () => {
      throw new Error('down');
    });

    poller.start();
    await flush();
    expect(errors).toHaveLength(1);

    // First retry at 5s, second at 10s, third at 20s.
    jest.advanceTimersByTime(4999);
    await flush();
    expect(errors).toHaveLength(1);
    jest.advanceTimersByTime(1);
    await flush();
    expect(errors).toHaveLength(2);

    jest.advanceTimersByTime(9999);
    await flush();
    expect(errors).toHaveLength(2);
    jest.advanceTimersByTime(1);
    await flush();
    expect(errors).toHaveLength(3);
  });

  it('gives up after a bounded number of failures, and says it is giving up', async () => {
    const { poller, errors } = harness(
      async () => {
        throw new Error('down');
      },
      { maxConsecutiveFailures: 3 } as any,
    );

    poller.start();
    await flush();
    for (let i = 0; i < 6; i++) {
      jest.advanceTimersByTime(60000);
      await flush();
    }

    expect(errors).toHaveLength(3);
    expect(errors.map((e) => e.willRetry)).toEqual([true, true, false]);
    // The last call is the only one that tells the user tracking has stopped,
    // which is what stops a dead page looking like a live one.
    expect(poller.isRunning()).toBe(false);
  });

  it('resets the failure count after a success, so a flaky link never exhausts the budget', async () => {
    let calls = 0;
    const { poller, errors } = harness(
      async () => {
        calls += 1;
        if (calls % 2 === 0) throw new Error('flaky');
        return { running: true };
      },
      { maxConsecutiveFailures: 2 } as any,
    );

    poller.start();
    await flush();
    for (let i = 0; i < 8; i++) {
      jest.advanceTimersByTime(60000);
      await flush();
    }

    // Every failure is the first in its streak, so none is ever the giving-up one.
    expect(errors.every((e) => e.consecutiveFailures === 1 && e.willRetry)).toBe(true);
    expect(poller.isRunning()).toBe(true);
  });
});

describe('the poll loop stops when it should', () => {
  it('stops once nothing is running any more', async () => {
    const { poller, results } = harness(async () => ({ running: false }));
    poller.start();
    await flush();
    expect(results).toHaveLength(1);
    expect(poller.isRunning()).toBe(false);
  });

  it('can be restarted after stopping, which the old timer guard made impossible', async () => {
    let running = false;
    const { poller, results } = harness(async () => ({ running }));

    poller.start();
    await flush();
    expect(poller.isRunning()).toBe(false);

    // A new run begins. Refresh must be able to bring the loop back.
    running = true;
    poller.start();
    await flush();
    expect(results).toHaveLength(2);
    expect(poller.isRunning()).toBe(true);
  });

  it('ignores a second start while already running', async () => {
    let calls = 0;
    const { poller } = harness(async () => {
      calls += 1;
      return { running: true };
    });

    poller.start();
    await flush();
    poller.start();
    poller.start();
    await flush();
    expect(calls).toBe(1);
  });

  it('delivers nothing after stop, so an unmounted page cannot set state', async () => {
    let resolve: (r: Result) => void = () => {};
    const { poller, results } = harness(() => new Promise<Result>((r) => { resolve = r; }));

    poller.start();
    await flush();
    poller.stop();
    resolve({ running: true });
    await flush();

    expect(results).toHaveLength(0);
    expect(poller.isRunning()).toBe(false);
  });

  it('cancels a pending wake-up on stop', async () => {
    let calls = 0;
    const { poller } = harness(async () => {
      calls += 1;
      return { running: true };
    });

    poller.start();
    await flush();
    expect(calls).toBe(1);

    poller.stop();
    jest.advanceTimersByTime(60000);
    await flush();
    expect(calls).toBe(1);
  });
});
