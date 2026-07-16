# Service IDs: how to discover them (read carefully)

BioEngine service IDs follow `<workspace>/<client_id>:<service_name>`. There are two layers, and **they look superficially similar but resolve to different things**. Read this before Task 3 (deploy) or Task 4 (call) — calling `<workspace>/<app-id>` alone does not reach the app methods.

- **Worker service** — addresses the worker's admin API (`get_status`, `deploy_app`, etc.). One per worker:
  ```
  <workspace>/<worker_client_id>:bioengine-worker
  ```
  Concrete examples in the `bioimage-io` workspace today: `bioimage-io/bioengine-worker-kth-<hash>:bioengine-worker`, `bioimage-io/bioengine-worker-denbi-<hash>:bioengine-worker`, `bioimage-io/bioengine-worker-berzelius:bioengine-worker`.

- **App service** — addresses a specific running app on a specific worker. One per (worker, app):
  ```
  <workspace>/<worker_client_id>-<replica_id>:<application_id>
  ```
  e.g. `bioimage-io/bioengine-worker-denbi-<hash>-<replica>:model-runner`. The `<replica_id>` is appended to the worker's `client_id` so each app replica is its own Hypha client.

> ⚠️ **`<workspace>/<app-id>` alone (e.g. `bioimage-io/model-runner`) is NOT the callable app service.** That short form exists as a WebRTC offer endpoint registered by the proxy, and calling it returns only `{offer}`, not the app methods. **Always use the per-worker per-replica form above when calling an app.**

**Service types** (use with `list_services({"type": ...})`):

| Type | Registered by | Selects |
|---|---|---|
| `bioengine-worker` | the worker itself | one entry per worker |
| `bioengine-app` | the proxy deployment of each running app | one entry per running app (singular — `bioengine-apps` returns 0 results) |

**Discovery recipe** (one ready-to-paste block):
```python
from hypha_rpc import connect_to_server
s = await connect_to_server({"server_url": "https://hypha.aicell.io", "token": token, "workspace": "bioimage-io"})

# 1. List workers in the workspace:
workers = [sv["id"] for sv in await s.list_services({"type": "bioengine-worker"})]
#   → ["bioimage-io/bioengine-worker-kth-<hash>:bioengine-worker", "...-denbi-...", ...]

# 2. For a chosen worker, ask which apps it has running AND get their concrete service IDs:
worker = await s.get_service(workers[0])
status = await worker.get_app_status(None)            # None / no args = all running apps
#   ALWAYS a dict keyed by app id, even when one app is queried (the
#   docstring's "single app returns directly" claim is stale — treat the
#   return as a dict in every case).
for app_id, info in status.items():
    if info.get("status") == "RUNNING":
        ws_sid  = info["service_ids"]["websocket_service_id"]   # concrete; this is what you call
        rtc_sid = info["service_ids"]["webrtc_service_id"]
        print(app_id, "→", ws_sid)

# 3. Call the app:
app = await s.get_service(ws_sid)                     # e.g. "...-denbi-<hash>-<replica>:model-runner"
# model-runner's infer() is async: returns a request_id, then poll get_infer_status
# (see apps/model-runner/model-runner.md § Async job API).
request_id = await app.infer(model_id="affable-shark", inputs="<url-or-tensor>")
```

> **`get_app_status(application_ids=[...])`** — pass a **list**, not a single string. The schema field is `application_ids: List[str] | None`. Single-element list and multi-element list both return a dict keyed by app id; only `None` is special (returns all apps).

> **Replica suffix in the service ID** — the worker mints a fresh Hypha sub-client for every Ray Serve replica (so each replica can register its own services). That's why the app's service ID is `<workspace>/<worker_client_id>-<replica_id>:<app_id>` (e.g. `…-v6qq1k45:model-runner`) instead of just `<workspace>/<worker_client_id>:<app_id>`. The suffix is stable for the lifetime of the replica and changes on every redeploy — always re-resolve via `get_app_status` rather than caching the full service ID across deploys.

A user who deployed their own worker in workspace `<ws>` has the same pattern: a `<ws>/bioengine-worker-*:bioengine-worker` for the worker and `<ws>/<worker_client_id>-<replica_id>:<app_id>` per app instance.
