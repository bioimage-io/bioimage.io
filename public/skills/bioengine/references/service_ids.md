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

**Service types.** These are the `type` values Hypha registers. `list_services({"type": ...})` is
fine for *interactive* exploration, where a hang costs you a Ctrl-C — **never in a script**, where it
hangs with no upper bound. Scripts resolve over HTTP (see below):

| Type | Registered by | Selects |
|---|---|---|
| `bioengine-worker` | the worker itself | one entry per worker |
| `bioengine-app` | the proxy deployment of each running app | one entry per running app (singular — `bioengine-apps` returns 0 results) |

> **Who needs discovery, and who doesn't.** Everything below is for **external callers** — the CLI, a Python client, another service. An app's own frontend page (`frontend_entry`, served from the artifact's `static_site_url`) does **not** discover anything: BioEngine injects the fully-resolved `ws_service_id` and `webrtc_service_id` into the page URL as query params, so the frontend reads them off `window.location.search` and connects. See [app_templates.md § Frontend UI template](app_templates.md#frontend-ui-template).

> **Do not pass `workspace` unless your token was minted for that workspace.** A token from
> `/#/bioengine/token` with no `&workspace=` is bound to your OWN workspace, and asking to connect
> as `bioimage-io` is refused outright, before anything else runs:
>
> ```
> ConnectionAbortedError: Failed to establish connection: Failed to authenticate user:
> Current workspace encoded in the token (ws-user-github|…) does not match the
> specified workspace (bioimage-io)
> ```
>
> Connect in your own workspace and address every `bioimage-io` service by its fully-qualified id,
> which works across workspaces. This is the first call this skill asks you to make, so getting it
> wrong costs a cycle before anything else can be tried.

**Discovery recipe** (one ready-to-paste block):
```python
from hypha_rpc import connect_to_server
# No "workspace" key: connect in YOUR workspace, then reach bioimage-io services by exact id.
s = await connect_to_server({"server_url": "https://hypha.aicell.io", "token": token})

# 1. Resolve a worker. Use the HTTP helper `worker_service_id()` defined in the next
#    section of this file -- NOT `list_services`, which hangs against a busy workspace
#    with no upper bound and makes a healthy worker look dead.
worker_sid = worker_service_id("bioimage-io", "bioengine-worker-kth")   # or "...-denbi"
#   → "bioimage-io/bioengine-worker-kth-<hash>:bioengine-worker"

# 2. For a chosen worker, ask which apps it has running AND get their concrete service IDs:
worker = await s.get_service(worker_sid)
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

## `Multiple services found`: what the short form actually asks for

If you pass `<workspace>/<name>` to `get_service`, this is what you get back:

```
AssertionError: Multiple services found for bioimage-io/*:bioengine-worker
```

Read the message literally. Hypha expands `<workspace>/X` into `<workspace>/*:X`, the `*` being the
CLIENT. So that form does not name one service, it asks for a service called `X` on **any** client
in the workspace. It works for exactly as long as there is one match, and stops working the moment
somebody registers a second. Measured on 2026-11-28 against `hypha.aicell.io`:

| id passed to `get_service` | result |
|---|---|
| `bioimage-io/bioengine-worker` | the assertion above, two matches (a KTH worker and a de.NBI one) |
| `bioimage-io/bioengine-worker-kth-<hash>:bioengine-worker` | OK |
| `bioimage-io/omezarr-view` | the same assertion: the app is registered twice |
| `bioimage-io/definitely-not-a-service` | `KeyError: Service not found`, which is the different error |

Two consequences worth keeping separate:

- **It is not a replica problem, and the fix is not "pick one".** Two matching workers are two
  different machines, with different GPUs and different apps deployed. Binding to an arbitrary one
  is not a smaller version of the right answer, it is a different worker, with nothing in your code
  or on your screen saying which. Among several replicas of one app, by contrast, any replica really
  is interchangeable, so a first-match helper is fine there and wrong here.
- **The failure arrives later than the mistake.** It appears when somebody else adds a worker, not
  when you write the call, so it will not show up in your own testing.

The fix is to name the client. Use `worker_service_id()` below, which resolves over HTTP and
**refuses an ambiguous match instead of guessing**, then ask the worker for the app's concrete
`websocket_service_id` as in Step 2 above.

## Step 1's helper: resolve the worker over HTTP, never by RPC listing

`list_services` has been observed to **hang** against a busy workspace. The fault is in the
platform's listing path, not in your token, your workspace or the worker: a worker whose calls appear
to "stop answering" is very often a caller stuck inside the listing while the worker is perfectly
healthy.

Two measurements, kept apart because they are **not** one simultaneous comparison — the second run
happened about 24 minutes after the first:

```
run A, one RPC connection, both arms in the same run:
  list_services                                TIMED OUT after 75 s
  get_service + get_status by exact id          OK in 0.7 s
  control: an id that cannot exist              refused in 0.0 s

run B, ~24 min later, four arms in one run on one connection:
  control  an id that cannot exist              REFUSED  in 0.01 s
  get_service + get_status by exact id          OK       in 0.02 s
  list_services                                 ANSWERED in 0.05 s,  25 entries
  GET /<workspace>/services                     HTTP 200 in 2.844 s, 25 entries
```

Read both before concluding anything:

- **It is intermittent, and run B is what "it works for me" looks like.** It has been seen to clear
  by itself after roughly 25 minutes. A run where the listing answers tells you nothing about the
  next one, so wire this fallback in *before* you need it.
- **The HTTP listing is not the faster route — it is the route that does not hang.** In run B it was
  57× *slower* than the RPC listing (2.844 s against 0.05 s), and it has also been measured at
  0.127 s. Switch to it because a 75 s hang has no upper bound and a few seconds does, not for speed.

```python
import json, os, urllib.request

def worker_service_id(workspace: str, match: str, server: str = "https://hypha.aicell.io") -> str:
    """Resolve a worker's fully-qualified service id without enumerating by RPC."""
    # TRAP 4 — send the header only if you actually have a token. A public workspace's
    # listing answers 200 with no header at all, and an invalid token answers 401,
    # so an absent token works where a bogus one does not.
    # os.environ['HYPHA_TOKEN'] would raise KeyError, and f"Bearer {None}" gets a 401.
    headers = {}
    token = os.environ.get("HYPHA_TOKEN") or os.environ.get("BIOIMAGE_IO_TOKEN")
    if token:
        headers["Authorization"] = f"Bearer {token}"
    req = urllib.request.Request(f"{server}/{workspace}/services", headers=headers)
    with urllib.request.urlopen(req, timeout=30) as resp:
        raw = resp.read()
    if not raw:                        # TRAP 1 — see below
        raise RuntimeError("empty body: follow redirects. This is NOT 'no services'.")
    ids = [s["id"] for s in json.loads(raw)]
    hits = [i for i in ids if i.endswith(":bioengine-worker") and match in i]
    if len(hits) != 1:                 # never pick one silently
        raise RuntimeError(f"{len(hits)} workers match {match!r}: {hits}")
    return f"{workspace}/{hits[0]}"    # TRAP 2 — see below
```

That block is **synchronous and self-contained** — no `await`, no open Hypha client — so it imports
and runs on its own. Then use it as step 1 and carry on with an exact-id lookup, which answers while
the listing does not:

```python
worker = await s.get_service(worker_service_id("bioimage-io", "bioengine-worker-kth"))
status = await worker.get_app_status(None)
```

Four things will bite you here, and each one fails silently:

1. **The URL answers `307` with a zero-byte body.** A caller that does not follow redirects sees an
   *empty listing*, not an error — so "this workspace has no services" and "I forgot to follow the
   redirect" are the same bytes. `urllib` and `requests` follow redirects by default; `curl` needs
   `-L`.
2. **HTTP ids are not workspace-prefixed.** The listing returns `<client_id>:<service_name>` while
   `get_service` wants `<workspace>/<client_id>:<service_name>`. Hand one to the other and you get a
   not-found that reads exactly like a service that is missing.
3. **Never hard-code the worker's hash.** A worker's `client_id` contains its pod name, so any
   snippet that pastes one works today and breaks at the next restart — which is how a copied
   example turns into a phantom "service not found". Match on the stable part
   (`bioengine-worker-kth`) and let the `:bioengine-worker` suffix do the rest, and refuse rather
   than guess when more than one matches.
4. **The token is optional, and a wrong one is worse than none.** Measured against `bioimage-io`:
   no token at all → `HTTP 200`, 25 entries; a bogus token → `HTTP 401`; a valid workspace token
   → `HTTP 200`, 25 entries. So `os.environ['HYPHA_TOKEN']` raises `KeyError` for a caller who
   holds none, and `f"Bearer {None}"` turns a route that would have answered 200 into a 401.
   Send the header only when a token is actually set.

> ⚠️ **A listing cannot tell you a service is ABSENT.** The RPC and HTTP listings have been seen to
> disagree — 25 entries against 28, naming different worker pods — and then to AGREE at 25 about
> 24 minutes later, so agreement on one run retires nothing. A service missing from a
> listing may simply be missing from *that* listing. Only an exact-id `get_service` settles whether
> something is really gone. Asserting an absence from a listing once produced a confident, wrong
> report that a production app was unreachable, when it resolved by exact id in 0.02 s.

> **`get_app_status(application_ids=[...])`** — pass a **list**, not a single string. The schema field is `application_ids: List[str] | None`. Single-element list and multi-element list both return a dict keyed by app id; only `None` is special (returns all apps).

> **Replica suffix in the service ID** — the worker mints a fresh Hypha sub-client for every Ray Serve replica (so each replica can register its own services). That's why the app's service ID is `<workspace>/<worker_client_id>-<replica_id>:<app_id>` (e.g. `…-v6qq1k45:model-runner`) instead of just `<workspace>/<worker_client_id>:<app_id>`. **Always re-resolve via `get_app_status` rather than caching the full service ID across deploys** — the suffix is only guaranteed for the lifetime of the replica, and a replacement replica, a worker restart, or a different worker gives you a different one.
>
> ⚠️ **Do not use the suffix as a "did my redeploy take effect?" signal.** It is *not* guaranteed to change on redeploy — across three consecutive redeploys of the same `--app-id`, the suffix stayed byte-identical (`…-875b97ef:<app_id>`) and so did the whole `websocket_service_id`. An unchanged service ID tells you nothing about whether new code is live.
>
> **`running_version` is the better signal and it is still not a verification.** It has been observed wrong in *both* directions. Late: `running_version` reporting a stale version for minutes after the replica had rolled forward. And early, which is the one that fools you — `running_version: 1.1.0` with `version_verified: true` was read **6 seconds before** the new code could answer a call, so a loop that polls the field and then proceeds hits the old replica having just been told the update landed. The only sound check is behavioural: call a method and look for the thing you changed. Return the version from a method if you need a cheap probe, and compare *that* rather than the status field.

A user who deployed their own worker in workspace `<ws>` has the same pattern: a `<ws>/bioengine-worker-*:bioengine-worker` for the worker and `<ws>/<worker_client_id>-<replica_id>:<app_id>` per app instance.
