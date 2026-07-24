"""Queue-pressure generator for the #N-pill Playwright spec.

Holds a STABLE, MODEST run-queue depth so a browser-launched job lands at
run.queue_position > 0 and the UI renders the amber "#N" pill for a capture
window. test+infer share the run queue.

IMPORTANT: this maintains a FIXED in-flight pool (POOL concurrent infers),
awaiting each completion and immediately resubmitting. It does NOT fire-and-
forget — a runaway backlog trips Ray Serve's request-admission rejection
(handle_request_with_rejection) and degrades the worker. affable-shark infer
holds a GPU slot ~12s; with 2 GPU slots, POOL=8 keeps ~2 running (pos0) and
~6 queued (#1..#6), well below the admission limit (even-clam's Experiment A
ran 8 concurrent cleanly).

Env:
  HYPHA_TOKEN     - hypha token
  FILL_SECONDS    - how long to hold pressure (default 180)
  FILL_POOL       - fixed concurrent in-flight infers (default 8)
  RUNNER_SERVICE  - service id (default: KTH 1.15.32 worker)
  FILL_MODEL      - model id (default affable-shark)
"""
import asyncio
import os
import time
import numpy as np
from hypha_rpc import connect_to_server

TOKEN = os.environ["HYPHA_TOKEN"]
SECONDS = float(os.environ.get("FILL_SECONDS", "180"))
POOL = int(os.environ.get("FILL_POOL", "8"))
MODEL = os.environ.get("FILL_MODEL", "affable-shark")
# Target the SAME KTH service the browser uses by default (RUNNER_SITES[0]) via
# its glob, so the filler's jobs and the browser job share one run queue and a
# real #N forms. Using the glob (not a pinned instance id) survives worker pod
# restarts — a helm upgrade rotates the instance id, so a pin goes stale.
RUNNER_SERVICE = os.environ.get(
    "RUNNER_SERVICE",
    "bioimage-io/bioengine-worker-kth-*:model-runner",
)


async def main():
    server = await connect_to_server({"server_url": "https://hypha.aicell.io", "token": TOKEN})
    runner = await server.get_service(RUNNER_SERVICE, {"mode": "select:min:get_load"})
    arr = np.random.rand(1, 1, 256, 256).astype("float32")
    print(f"[fill] runner service: {RUNNER_SERVICE}", flush=True)
    print(f"[fill] holding a fixed pool of {POOL} in-flight {MODEL} infers for {SECONDS}s", flush=True)

    start = time.monotonic()
    completed = 0
    errors = 0
    stop = False

    async def worker(wid):
        nonlocal completed, errors, stop
        while not stop and time.monotonic() - start < SECONDS:
            try:
                # infer() returns a request_id string IMMEDIATELY (async submit),
                # so we must poll THIS job to completion before resubmitting;
                # otherwise the slot resubmits instantly and the pool runs away
                # (that's what tripped Ray admission at ~122). Polling to
                # completion keeps exactly POOL jobs live in the GPU queue and
                # at most one outstanding RPC per worker (<= POOL <= 10).
                rid = await runner.infer(model_id=MODEL, inputs=arr, skip_cache=True)
                if isinstance(rid, str):
                    for _ in range(180):
                        if stop or time.monotonic() - start >= SECONDS:
                            break
                        st = await runner.get_infer_status(request_id=rid)
                        if st is not None and st.get("result") is not None:
                            break
                        await asyncio.sleep(1.0)
                completed += 1
            except Exception as e:
                errors += 1
                if errors <= 5:
                    print(f"[fill] worker {wid} error: {str(e)[:160]}", flush=True)
                # brief backoff so we don't hammer a rejecting worker
                await asyncio.sleep(3.0)

    async def reporter():
        while not stop and time.monotonic() - start < SECONDS:
            await asyncio.sleep(5)
            el = time.monotonic() - start
            print(f"[fill] +{el:4.0f}s  completed={completed} errors={errors} pool={POOL}", flush=True)

    tasks = [asyncio.create_task(worker(i)) for i in range(POOL)]
    rep = asyncio.create_task(reporter())
    await asyncio.gather(*tasks, return_exceptions=True)
    stop = True
    rep.cancel()
    print(f"[fill] done: completed={completed} errors={errors}", flush=True)
    await server.disconnect()


if __name__ == "__main__":
    asyncio.run(main())
