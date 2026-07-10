---
name: bioengine
description: Single entry point for any BioEngine task — setting up a worker, developing a new app, deploying an existing app from a Hypha artifact, or calling a deployed app's methods. Load app subskills in apps/ when working with a specific deployed service. After finishing a non-trivial task, leave a structured feedback report at the public Hypha collection `bioimage-io/bioengine-skill-issues` (see the "Leave a feedback report" section at the end of this file) so the bioengine team can patch the skill.
license: MIT
metadata:
  cli-package: bioengine[cli] (pip install "bioengine[cli] @ git+https://github.com/aicell-lab/bioengine.git")
  app-skills:
    - apps/model-runner/model-runner.md
    - apps/cellpose-finetuning.md
---

# BioEngine

BioEngine runs AI models and analysis applications on Ray Serve, registers them as Hypha RPC services, and lets you stream large scientific datasets through them. It scales from a laptop to a multi-node GPU cluster. **Applications are Ray Serve classes packaged as Hypha artifacts.**

> **How to load the linked reference files.** Every `references/...` and `apps/...` link below resolves to a raw Markdown file served from this same site (e.g. `https://bioimage.io/skills/bioengine/references/custom_dashboard.md`). **Always fetch them with raw HTTP** — `curl -sSL <url>` for AI agents, or read directly if available locally. **Do not use WebFetch / WebSearch** for these links: those tools return an AI-summarised digest of the file, which strips the code templates, exact CLI commands, and worked examples you actually need. Treat each reference file as canonical source code, not as a webpage.

## Pick your task

Four high-level tasks. Pick the one that matches what the user is trying to do, then jump to that section — the rest of this file backs it up with references.

| # | Task | Start here |
|---|---|---|
| **1** | **Set up a BioEngine worker** — install a worker on a machine / SLURM cluster / Kubernetes, optionally with a branded dashboard | [§ Set up a worker](#1-set-up-a-bioengine-worker) |
| **2** | **Develop a new BioEngine app** — write the deployment code, package as artifact, live-test on a worker, iterate | [§ Develop an app](#2-develop-an-app) |
| **3** | **Deploy an existing app** — take someone else's artifact (e.g. `bioimage-io/model-runner`) and run it on a worker you have access to | [§ Deploy an existing app](#3-deploy-an-existing-app) |
| **4** | **Call an app's methods** from code or CLI to actually do science with it | [§ Call an app](#4-call-an-app) |

Tasks 2 and 3 use the **same `deploy_app` mechanism** — the difference is whether you're authoring the artifact (Task 2) or pointing at an existing one (Task 3). Tasks 2 and 4 both touch **dataset access** because new apps and existing apps both consume image data; see [references/data_sources.md](references/data_sources.md) either way.

---

## Server, install, and conventions (read once)

**Hypha server**: `https://hypha.aicell.io` is the default — use it unless the user specifies another.

**Install the CLI** (requires Python ≥3.11):
```bash
pip install "bioengine[cli] @ git+https://github.com/aicell-lab/bioengine.git"
```
If your shell has a global `git config --global url."git@github.com:".insteadOf "https://github.com/"` rewrite (common dotfiles setup) and your SSH key isn't loaded, pip will fail with a `Permission denied (publickey)` error — temporarily unset the rewrite or load the SSH agent first.

**Environment**:
```bash
export HYPHA_TOKEN=<your-token>                             # see references/hypha_setup.md if you don't have one
export BIOENGINE_WORKER_SERVICE_ID=<workspace>/bioengine-worker   # which worker to use
```

**Getting a token, workspace, and scoped credentials.** If you don't already have a `HYPHA_TOKEN`, or you need to create a dedicated workspace or mint worker/app tokens, **load [references/hypha_setup.md](references/hypha_setup.md)** — the browser login flow, `create_workspace`, the `generate_token` scheme, and the permission ladder. Most task runs only need this once.

### Service IDs — how to discover them (read carefully)

Calling an app requires the concrete per-worker per-replica service ID, and `<workspace>/<app-id>` alone (e.g. `bioimage-io/model-runner`) does **not** reach the app methods — it returns only `{offer}`. Before any Task 3 (deploy) or Task 4 (call) work, **load [references/service_ids.md](references/service_ids.md)** for the worker-vs-app ID layers, the `list_services` type table, and the ready-to-paste discovery recipe that resolves a callable `websocket_service_id` via `worker.get_app_status(None)`.

---

## 1. Set up a BioEngine worker

A BioEngine worker is a long-running process that connects to a Ray cluster and registers itself on Hypha as `<workspace>/bioengine-worker`. It serves apps via Ray Serve and answers admin calls (`deploy_app`, `get_status`, etc.) over Hypha RPC.

There are three deployment modes:

| Mode | When |
|---|---|
| `single-machine` | A workstation or single VM with one or more GPUs. Docker. |
| `slurm` | An HPC cluster scheduled by SLURM. Apptainer. Auto-scales Ray workers as SLURM jobs. |
| `external-cluster` | Connect to a pre-existing Ray cluster (typically KubeRay on Kubernetes). |

**Load [references/worker_onboarding.md](references/worker_onboarding.md)** for the full end-to-end flow: mode selection, Hypha token, exact deployment command per mode, and a 7-check readiness test that you MUST run after the worker registers (it catches dead GPUs, missing network egress, broken artifact creation, etc., before the user starts deploying apps).

### Optional: custom dashboard

If the user runs a **core facility, lab, or institutional deployment** that wants its own branded UI alongside (or instead of) https://bioimage.io/#/bioengine, **load [references/custom_dashboard.md](references/custom_dashboard.md)**. It publishes a static HTML+CSS dashboard as a Hypha artifact in the user's workspace, with worker discovery and the per-worker dashboard (status, deployed apps, cluster resources).

> **What a custom dashboard is for, and what it isn't.** It is **read/render** — list workers, show cluster stats, list deployed apps, link to app frontends. It is **not** the BioEngine setup wizard (https://bioimage.io/#/bioengine has an interactive Docker/SLURM/K8s installer; do **not** rebuild that into a custom dashboard — facility admins use the canonical setup tool or the worker_onboarding flow above).

> **After the worker is ready: leave a feedback report.** Worker setup is the single richest source of gaps in this skill — cluster-specific gotchas, undocumented flags, broken paths. If bringing your worker up required reading source, working around a bug, or more than ~3 trial-and-error cycles, file a report — see [§ Leave a feedback report](#leave-a-feedback-report) at the end of this file.

---

## 2. Develop an app

A BioEngine app is a directory with at minimum a `manifest.yaml` and one Python deployment class. You build the directory, upload it as a Hypha artifact, deploy that artifact on a worker for live testing, and iterate.

### App layout

```
my-app/
├── manifest.yaml          # identity, deployments, auth
├── my_deployment.py       # Ray Serve class
└── frontend/index.html    # optional static UI
```

### Minimal `manifest.yaml`

```yaml
name: My App
id: my-app
id_emoji: "🔬"
description: "..."
type: ray-serve
version: 1.0.0
format_version: 0.6.0
license: MIT
entry: my_deployment:MyDeployment   # python_filename_without_py:ClassName
authorized_users:
  - "*"
```

Full field reference: [references/manifest_reference.md](references/manifest_reference.md). (The `deployments:` list and `format_version: 0.5.0` from earlier releases are no longer supported — bump to 0.6.0 and use the single `entry:` field instead. Multi-deployment composition is now wired via Python type hints on `__init__`; see [references/app_templates.md](references/app_templates.md).)

> **Version bumps are now strictly enforced.** As of bioengine 0.11.7, `upload_app` rejects any artifact whose manifest `version` is not strictly greater than every existing version of the artifact (PEP 440 ordering). Re-uploading the same version raises with a clear "must be strictly greater" message. Bump `manifest.yaml` `version` on every change.

### Minimal deployment class

```python
import time
from typing import Dict, Union

import bioengine

logger = bioengine.logger  # never use print()


@bioengine.app(
    num_cpus=1,
    num_gpus=1,                  # 1 for GPU, 0 for CPU-only; never fractional
    memory_mb=4096,
    pip=["numpy==1.26.4"],       # pin exact versions — any change = full rebuild
    max_ongoing_requests=10,
)
class MyDeployment:
    def __init__(self) -> None:
        self.start_time = time.time()

    @bioengine.async_init
    async def load(self) -> None:
        """Optional — runs once before traffic is admitted. Load models here."""
        import numpy as np  # third-party: always import inside methods

    @bioengine.smoke_test
    async def smoke(self) -> None:
        """Optional startup smoke test — raise to fail the replica."""
        assert (await self.ping())["status"] == "ok"

    @bioengine.method
    async def ping(self) -> Dict[str, Union[str, float]]:
        """Return service status."""
        return {"status": "ok", "uptime": time.time() - self.start_time}

    @bioengine.method(context=True)
    async def whoami(self, context) -> str:
        """Receive the Hypha caller's context as a plain dict.

        The `context` parameter is auto-injected by Hypha and hidden from
        the public schema — clients can't supply or spoof it.
        """
        return context["user"]["id"]
```

### Key rules

- Use `@bioengine.app(num_cpus=..., num_gpus=..., memory_mb=..., pip=[...], max_ongoing_requests=...)` — the framework wraps this into the underlying `@serve.deployment` for you. Authoring with raw `@serve.deployment` is deprecated and will fail introspection.
- **Extract the `pip=[...]` list to a `requirements-<module>.txt` file** next to the module (e.g. `requirements-runtime.txt` next to `runtime.py`) and load it via a small helper. Same pin values ship, but the deps look like a real requirements file — Dependabot / pip-audit can point at the file, PR diffs isolate dep bumps, and the decorator stays readable:
  ```python
  from pathlib import Path

  def _read_pip(name: str) -> list[str]:
      text = (Path(__file__).parent / name).read_text()
      return [
          l.strip() for l in text.splitlines()
          if l.strip() and not l.lstrip().startswith("#")
      ]

  @bioengine.app(pip=_read_pip("requirements-runtime.txt"), ...)
  class RuntimeApp: ...
  ```
  Applies to every app regardless of pin count. When a file has multiple `@bioengine.app` sites (e.g. an entry + runtime pair), give each its own `requirements-<module>.txt` and duplicate the helper — apps ship as self-contained packages, so per-file duplication beats cross-module imports.
- Lifecycle hooks are decorators with **free method names**: `@bioengine.async_init`, `@bioengine.smoke_test`, `@bioengine.health_check`, `@bioengine.cached(max_models=N)`. The reserved names `async_init` / `test_deployment` / `check_health` no longer work as plain methods.
- `@bioengine.cached`: per-replica LRU model cache. First non-self positional arg is the cache key; the method body is the loader (called on miss). Multiple decorated methods per class are allowed — each gets its own independent cache under its method name. Manual cache control from any method: `await bioengine.cache.evict_lru_model(self)`, `await bioengine.cache.evict_all_models(self)`, `await bioengine.cache.evict_model(self, id)`, `bioengine.cache.cached_model_ids(self)`. Every eviction path runs `gc.collect()` + `torch.cuda.empty_cache()` in the same critical section — GPU memory is returned to the CUDA driver immediately, so `pynvml` reflects the freed VRAM without lag. Useful before running a foundation-model call that needs the full GPU. (Renamed from `@bioengine.multiplexed` / `bioengine.multiplex.*` in bioengine 0.11.22 — no shim; apps on older bioengine versions must migrate.)
- API methods: `@bioengine.method` (basic) or `@bioengine.method(context=True)` (opt-in caller-context injection — the user method must declare a `context` parameter; arrives as a plain dict, never a Hypha proxy).
- Import third-party packages **inside methods** — top-level imports break Ray serialization.
- `num_gpus: 1` for GPU, `num_gpus: 0` for CPU-only; never use fractional values.
- Entry/orchestrator deployments in composition apps: `num_cpus: 0, num_gpus: 0`.
- `Field(None)` not `Field([...])` for mutable defaults — mutable defaults crash at startup.
- Never return raw numpy arrays over RPC — call `.tolist()` first.
- **Don't pin `pydantic` yourself unless you have to.** BioEngine auto-injects the driver's pydantic into your `runtime_env.pip` so the deployment unpickles cleanly on the Ray Serve replica. If you *do* pin pydantic explicitly, it must resolve to the same `pydantic-core` as the driver — otherwise the pre-flight check refuses to deploy. See [Pydantic compatibility](references/manifest_reference.md#pydantic-compatibility-important).
- **If your app imports `torch` (>=2.5), set `USER`/`LOGNAME` defaults at the very top of the module.** `torch._dynamo` calls `getpass.getuser()` at import time, which raises `KeyError: getpwuid(): uid not found` when the actor runs as a host uid that has no `/etc/passwd` entry (the default for slim Docker images launched with `--user $(id -u):$(id -g)`). `setdefault` preserves the real identity wherever it's already set (HPC apptainer, K8s pods with a populated passwd) and only injects a placeholder when nothing else exists:
  ```python
  import os
  os.environ.setdefault("USER", "bioengine")
  os.environ.setdefault("LOGNAME", "bioengine")
  import torch  # or anything that transitively imports torch
  ```

### Composition apps and frontends

For apps with multiple deployments (e.g. one entry deployment routing to several runtimes) or a frontend HTML UI, **load [references/app_templates.md](references/app_templates.md)** — full working templates for simple, composition, and frontend cases.

### Advanced serving patterns

Multiplexing, HuggingFace integration, BioImage.IO model loading, auto-scaling: **load [references/model_serving.md](references/model_serving.md)**.

### Streaming datasets into your app

If your app reads image data, stream it from a public repository or from the BioEngine local data server instead of bundling it. **Load [references/data_sources.md](references/data_sources.md)** for the BioImage Archive workflow and the choice between `zarr.open(uri)` (vanilla) vs `BioEngineDatasets.open_remote_zarr(uri)` (shared cache).

### Live test cycle

Live testing on a real worker is **required** before bumping version. There is no useful local emulation of Ray Serve + Hypha registration — deploy to a worker the user has access to.

```bash
# 1. Upload + deploy in one step (creates a new instance if --app-id is new, OR updates if it matches a running one)
bioengine apps deploy ./my-app/ --app-id my-app --hypha-token $HYPHA_TOKEN

# 2. Monitor (wait for all deployments to reach HEALTHY)
bioengine apps status my-app --logs 50

# 3. Call — resolve the concrete per-replica service ID first (see "Service IDs" above),
#    then call it. Calling <workspace>/my-app directly returns only {offer}, not the methods.
bioengine apps status my-app --json
#   → find result["my-app"]["service_ids"]["websocket_service_id"]
bioengine call <ws>/<worker_client_id>-<replica>:my-app ping --json
```

> **HYPHA_TOKEN inside deployments.** Apps that connect back to Hypha internally need `HYPHA_TOKEN` set in the Ray actor environment. Always pass `--hypha-token $HYPHA_TOKEN` (CLI) or `hypha_token=token` (Python API). Do **NOT** use `--env HYPHA_TOKEN=...` — it is silently ignored by the app builder.

After verifying behaviour: bump `version` in `manifest.yaml` and commit.

> **After your first live deploy of a new app: leave a feedback report.** If `runtime_env`, RPC schema, composition wiring, or anything in `app_templates.md` / `model_serving.md` tripped you up, see [§ Leave a feedback report](#leave-a-feedback-report) at the end of this file. The first agent to write a fresh app for a domain almost always has the most valuable feedback.

---

## 3. Deploy an existing app

You have an artifact ID (e.g. `bioimage-io/model-runner`) and a worker you have access to. You don't need the app's source — just deploy the artifact.

### CLI

```bash
# First check what's already running:
bioengine apps status

# Deploy a fresh instance with a stable, addressable ID.
# Pass --hypha-token if the app talks back to Hypha internally (most do):
bioengine apps run bioimage-io/cellpose-finetuning \
    --app-id cellpose-finetuning \
    --hypha-token $HYPHA_TOKEN

# To update an already-running instance to the latest artifact version,
# pass the SAME --app-id as the running instance:
bioengine apps run bioimage-io/cellpose-finetuning \
    --app-id cellpose-finetuning \
    --hypha-token $HYPHA_TOKEN
```

### Python — `worker.deploy_app(...)`

Equivalent path when you already have a Hypha client open (no separate CLI process). Use this from agents that resolve the worker via `list_services` rather than via the `BIOENGINE_WORKER_SERVICE_ID` env var:

```python
worker = await server.get_service(f"{workspace}/bioengine-worker")
app_id = await worker.deploy_app(
    artifact_id="bioimage-io/cellpose-finetuning",
    application_id="cellpose-finetuning",   # stable id ⇒ stable, addressable service
    hypha_token=token,                      # apps that register back to Hypha need this
    # version="0.0.28",                     # optional pin; default = latest version of the artifact
)
```

`deploy_app` returns the resolved `application_id`. The artifact path is the **default deployment route for any agent that doesn't have a local clone of the app's source** — the CLI's `bioengine apps deploy ./my-app/` form is for app *authors* uploading a new version.

### Per-deployment scaling

Pass `scaling={class_name: {num_replicas | autoscaling_config}}` to fix or autoscale each user `@bioengine.app` deployment independently. The map key is the **class name** as shown under `deployments` in `get_app_status`; the ProxyDeployment (WebSocket/WebRTC bridge) is always one replica and not addressable:

```python
await worker.deploy_app(
    artifact_id="bioimage-io/my-app",
    application_id="my-app",
    scaling={
        "EntryDeployment": {
            "autoscaling_config": {
                "min_replicas": 1, "max_replicas": 8,
                "target_num_ongoing_requests_per_replica": 4,
            },
        },
        "RuntimeDeployment": {"num_replicas": 1},
    },
)
```

Each entry sets exactly one of `num_replicas` or `autoscaling_config` (Ray Serve's own constraint). Classes not in the map run at one fixed replica. On update with a matching `application_id`, the full scaling map replaces the previous one — pass the previous value back unmodified for any deployment you don't want to change. Omitting `scaling` on an update preserves the prior map; passing `scaling={}` resets every deployment to defaults. The map round-trips through worker restarts via `app_data["scaling"]`.

### App-cache inspection (`list_app_directories`, `clear_app_directory`)

For dashboards and disk-cleanup automation. The worker exposes two on-demand admin methods that walk the Ray actor pods' `apps_workdir` (where v0.11.4+ replica caches actually live — the worker pod itself is FS-thin):

```python
dirs = await worker.list_app_directories()
# → [{name, application_id, path, is_running, size_bytes, last_used_unix, node_id}, ...]
# `last_used_unix` is the latest mtime in the cache tree (proxy for "last used");
# `node_id` identifies which Ray node holds each entry (per-node FS topologies show
# the same application once per node that cached it).

# Refuses if the app is still RUNNING; stop_app first.
await worker.clear_app_directory(application_id="model-runner")
# → {mode: "shared"|"per_node", deleted_on: [node_ids], not_found_on: [node_ids]}
```

The first call probes whether `apps_workdir` is shared across Ray nodes (writes a marker, reads from every node, deletes); the result is cached for the worker's lifetime. **The worker never triggers these calls automatically — they are dashboard-only.**

> **`--hypha-token` is required for any app that calls back into Hypha** — model-runner, cellpose-finetuning, anything that registers services or reads datasets via Hypha RPC. Without it the deployment fails inside the actor with `RuntimeError: HYPHA_TOKEN environment variable is not set.` (you'll find this in `deployments[<name>].message`, not the top-level error). If you don't know whether an app needs it: pass it anyway, it's harmless.
>
> **Subtle trap: the "previous-token" fallback.** When `application_id` matches an already-running instance, `deploy_app` silently reuses the previously stored token if `--hypha-token` is omitted. So a redeploy on a worker that *already has the app running* will "succeed" without it — while the same redeploy on a worker *without a prior instance* fails. **Always pass it.** Don't rely on the fallback; agents that test on one worker and then deploy to another get bitten by exactly this.

> **CRITICAL — artifact ≠ app, `--app-id` is required to update.** One artifact can be deployed many times with different `--app-id`s. Running `bioengine apps run <artifact>` **without `--app-id` always creates a new instance with a random ID** — it never updates an existing running one. To update a running app, you MUST pass `--app-id <running-app-id>` (which you find via `bioengine apps status`).
>
> ```bash
> # WRONG — spawns a brand-new random instance, does NOT update cellpose-finetuning:
> bioengine apps run bioimage-io/cellpose-finetuning
>
> # CORRECT — updates the running 'cellpose-finetuning' instance to the latest version:
> bioengine apps run bioimage-io/cellpose-finetuning --app-id cellpose-finetuning
> ```

### App lifecycle

```bash
bioengine apps list                            # what artifacts are available to deploy
bioengine apps status [APP_ID]                 # what's actually running on the worker
bioengine apps logs <app-id> --tail 200        # actor logs
bioengine apps stop <app-id> -y                # stop a running instance (-y skips the confirmation prompt)
```

App states: `NOT_STARTED` → `DEPLOYING` → `RUNNING` / `DEPLOY_FAILED`. Deployments are ready when all reach `HEALTHY`.

> **`bioengine apps status --json` response shape.** The top-level dict is keyed by **app id** (not flat):
> ```json
> {
>   "my-app-id": {
>     "status": "RUNNING",
>     "deployments": {
>       "MyDeployment":    {"status": "HEALTHY", "message": "...", "logs": "..."},
>       "ProxyDeployment": {"status": "HEALTHY", ...}
>     },
>     "service_ids": {"websocket_service_id": "...", "webrtc_service_id": "..."}
>   }
> }
> ```
> So `result[app_id]["deployments"][deployment_name]["message"]` is where the actionable detail lives. The bare `bioengine apps status` output only prints per-deployment *status*, not the message — always pass `--json` when debugging.

> **Debugging `DEPLOY_FAILED` / `UNHEALTHY`.** The top-level `message` is generic ("The deployments ['X'] are UNHEALTHY."). The **actionable** error — failed pip install, `RuntimeEnvSetupError`, import errors, etc. — is in `deployments[<name>].message` and `deployments[<name>].logs`. Check these before guessing.

### Cleaning up a test deployment

`bioengine apps stop` halts the running app but leaves its Hypha artifact in place. To fully remove a test deployment (so it doesn't clutter the artifact list), stop AND delete the artifact:

```bash
# 1. Stop the running instance:
bioengine apps stop my-test-app -y

# 2. Delete the artifact (no CLI command yet — call the Hypha artifact-manager directly):
python - <<'PY'
import asyncio, os
from hypha_rpc import connect_to_server
async def main():
    s = await connect_to_server({"server_url": os.environ["BIOENGINE_SERVER_URL"],
                                 "token": os.environ["HYPHA_TOKEN"],
                                 "workspace": os.environ["HYPHA_WORKSPACE"]})
    am = await s.get_service("public/artifact-manager")
    await am.delete(artifact_id=f"{os.environ['HYPHA_WORKSPACE']}/my-test-app")
asyncio.run(main())
PY
```

Always clean up test deployments on shared production workers — they consume shared cluster resources and clutter the artifact list.

For the full CLI flag reference: [references/cli_reference.md](references/cli_reference.md).

> **After deploying an existing app: leave a feedback report.** Especially if the app's subskill (e.g. `apps/model-runner/`) was missing a flag, a service-ID quirk, or a required `--hypha-token`. See [§ Leave a feedback report](#leave-a-feedback-report) at the end of this file.

---

## 4. Call an app

Once an app is running you call its methods over Hypha RPC. Two equally good ways. **First read [§ Service IDs — how to discover them](#service-ids--how-to-discover-them-read-carefully) above** — calling `<workspace>/<app-id>` alone (e.g. `bioimage-io/model-runner`) does **not** reach the app methods. You always need the per-worker per-replica form like `<workspace>/<worker_client_id>-<replica_id>:<app-id>`, which you get from `worker.get_app_status(None)`.

### CLI

```bash
# Discover methods on the concrete service ID (resolved via get_app_status):
bioengine call '<workspace>/<worker_client_id>-<replica_id>:<app-id>' --list-methods

# Call with JSON arguments (recommended for agents):
bioengine call '<workspace>/<worker_client_id>-<replica_id>:<app-id>' <method> \
    --args '{"key": "value"}' --json

# Or with individual --arg flags (auto-typed):
bioengine call '<workspace>/<worker_client_id>-<replica_id>:<app-id>' <method> \
    --arg key=value --json
```

(Quote the service ID — it contains characters like `:` and `|` that some shells interpret.)

### Python

```python
from hypha_rpc import connect_to_server

server = await connect_to_server({"server_url": "https://hypha.aicell.io", "token": token,
                                  "workspace": "bioimage-io"})

# Resolve the concrete service ID via the worker:
worker  = await server.get_service("bioimage-io/bioengine-worker-kth-<hash>:bioengine-worker")
status  = await worker.get_app_status(None)
ws_sid  = status["model-runner"]["service_ids"]["websocket_service_id"]

# Now call the app:
app     = await server.get_service(ws_sid)
result  = await app.infer(model_id="affable-shark", inputs="<url>")
```

### Apps that take dataset URIs

Some apps (e.g. cellpose-finetuning) take HTTPS URIs of OME-Zarr datasets as input rather than streaming through the worker. Discover candidate datasets via the BioImage Archive search API, the IDR OME-NGFF samples catalogue, or any other public source — see [references/data_sources.md](references/data_sources.md) for the BIA, IDR / OMERO query patterns and how to extract `.ome.zarr` URIs from the response.

### App-specific subskills

When working with a specific deployed app, load its dedicated subskill for the method signatures, conventions, and known quirks:

| Service | Subskill | Load when |
|---|---|---|
| Model Runner | [apps/model-runner/model-runner.md](apps/model-runner/model-runner.md) | Searching, running inference on, or comparing BioImage.IO Model Zoo models |
| Cellpose Fine-Tuning | [apps/cellpose-finetuning.md](apps/cellpose-finetuning.md) | Fine-tuning Cellpose on custom annotated microscopy data |

> **After completing an inference / analysis run: leave a feedback report** if the call surface, tensor format, model-ID nicknames, or RDF output keys did not match what the subskill described. See [§ Leave a feedback report](#leave-a-feedback-report) at the end of this file.

---

## Common pitfalls (across all four tasks)

| Problem | Fix |
|---|---|
| `ModuleNotFoundError` at import | Add to `runtime_env.pip`; import inside method |
| numpy array over RPC error | Call `.tolist()` before returning |
| Long cold start on first request | `min_replicas: 1`; preload model in `async_init()` |
| Blocking inference stalls event loop | `await asyncio.get_event_loop().run_in_executor(None, fn)` |
| `Multiple services found` error | Use `connect_service()` from `bioengine.cli.utils` |
| App UNHEALTHY — `HYPHA_TOKEN` missing | Use `--hypha-token $HYPHA_TOKEN`, not `--env HYPHA_TOKEN=...` |
| Composition param name mismatch | `runtime_a:RuntimeA` must match `__init__` param name `runtime_a` |
| `Field()` mutable default crash | Use `Field(None)`, assign default inside method |
| Omitting `--app-id` creates new random instance | Always pass `--app-id <running-id>` to update; check `bioengine apps status` first |
| `DEPLOY_FAILED` with generic top-level message | Read `deployments[<name>].message` via `apps status --json` or SDK — it carries the real pip/runtime_env/import error |
| Deploy fails with `RuntimeError: pydantic-core version mismatch` | Pin `pydantic==2.11.0` (or whatever the driver runs) in `runtime_env.pip`. See [Pydantic compatibility](references/manifest_reference.md#pydantic-compatibility-important) |
| Ray Serve replica crashes with `'FieldInfo' object has no attribute 'exclude_if'` | Same root cause — driver/runtime_env pydantic-core mismatch. Pin `pydantic` in the app's `runtime_env.pip` |
| `am.get_file(path=...)` raises `unexpected keyword argument 'path'` | The artifact-manager API is `await am.get_file(artifact_id=..., file_path=...)` — kwarg is `file_path`, not `path` |
| `list_services({"type": "bioengine-apps"})` returns nothing | Service type for apps is singular: `bioengine-app`. Workers use `bioengine-worker` |
| `get_app_status` returns a dict when you expected a single object | It always returns a dict keyed by app id, regardless of how many IDs you passed. Index it: `status[app_id]` |
| App vanishes after a worker restart | Hypha artifacts persist, Ray Serve deployments do not. Either re-deploy with the same `application_id`, or boot the worker with `--startup-applications '{"artifact_id": "...", "application_id": "..."}'` so it auto-deploys on startup |

---

## References

| File | Covers |
|---|---|
| [references/hypha_setup.md](references/hypha_setup.md) | Hypha login, create workspace, mint scoped tokens, permission ladder (read once) |
| [references/service_ids.md](references/service_ids.md) | Worker-vs-app service ID layers + discovery recipe (Tasks 3 & 4) |
| [references/worker_onboarding.md](references/worker_onboarding.md) | Set up a worker — mode selection + 7-check readiness test (Task 1) |
| [references/custom_dashboard.md](references/custom_dashboard.md) | Branded facility / lab dashboard as a Hypha artifact (Task 1, optional) |
| [references/app_templates.md](references/app_templates.md) | Working templates: simple app, composition app, frontend (Task 2) |
| [references/model_serving.md](references/model_serving.md) | Multiplexing, HuggingFace, BioImage.IO integration, auto-scaling (Task 2) |
| [references/data_sources.md](references/data_sources.md) | Streaming OME-Zarr from BioImage Archive, IDR / OMERO, and any HTTPS source (Tasks 2 & 4) |
| [references/manifest_reference.md](references/manifest_reference.md) | Full `manifest.yaml` field reference (Task 2) |
| [references/cli_reference.md](references/cli_reference.md) | Full CLI reference for every `bioengine` subcommand (Tasks 2, 3, 4) |

---

## Leave a feedback report

Every time you finish a non-trivial BioEngine task (worker setup, app deployment, dataset wiring, model-runner inference run, debugging an outage) — especially if it took multiple trial-and-error cycles, required reading source code, or needed an undocumented flag — **leave a structured feedback report** in the public collection `bioimage-io/bioengine-skill-issues`. The bioengine team reads these regularly and uses them to patch the skill, the CLI, the worker, and the apps.

**When to file a report (any of these is a trigger):**

- The task took more than ~3 trial-and-error cycles.
- You had to read source code or inspect RPC schemas because the skill did not cover something.
- Something in the skill is wrong, stale, or contradicts the live system.
- You worked around an undocumented bug.
- A required flag, env var, or RPC method was undocumented.
- An app's behaviour differed from its subskill.

If unsure, file it. A two-paragraph report flagging one undocumented flag is more useful than a polished report that never gets written.

### Report contents

Write `report.md` with these sections (the bioengine team relies on this exact structure):

```markdown
# <title>

## Summary
One paragraph: what task you were doing, how many trial-and-error cycles, the headline blocker.

## A. Gaps the skill did not cover
What was missing and where you eventually found the answer (source file, RPC schema, support chat).

## B. Bugs or contradictions in the documented tooling
What the skill says vs what the live system does.

## C. Environment-specific gotchas
HPC / cloud / OS specifics. Note which apply broadly vs which are local to your site.

## Suggested skill changes
Concrete patches — paragraphs to add, tables to extend, sections to reorganise. The team treats this as the change list.

## What worked well
(Optional but useful — prevents refactoring of things that already serve agents well.)
```

**Do not include secrets** (tokens, raw chat logs, PII). Reports are public once committed.

### Submit

Any authenticated Hypha token works — the collection grants `@: r+` so any logged-in user can submit child reports. No `bioimage-io` permission required.

```python
import datetime, os, httpx
from hypha_rpc import connect_to_server

async def submit_feedback(report_md_path: str, slug: str, title: str,
                          summary: str, tags: list[str] | None = None):
    server = await connect_to_server({
        "server_url": "https://hypha.aicell.io",
        "token": os.environ["HYPHA_TOKEN"],
    })
    am = await server.get_service("public/artifact-manager")

    date = datetime.date.today().isoformat()
    report = await am.create(
        parent_id="bioimage-io/bioengine-skill-issues",
        alias=f"report-{date}-{slug}",            # e.g. report-2026-06-05-slurm-berzelius
        type="report",
        manifest={
            "name": title,
            "description": summary,
            "tags": tags or [],                   # e.g. ["worker-setup", "slurm", "cluster:berzelius"]
        },
        stage=True,
    )
    put_url = await am.put_file(report.id, file_path="report.md")
    async with httpx.AsyncClient() as c:
        with open(report_md_path, "rb") as f:
            (await c.put(put_url, content=f.read())).raise_for_status()
    await am.commit(report.id)
    return report.id

# await submit_feedback(
#     "./report.md", "slurm-onboarding-berzelius",
#     "SLURM worker onboarding on Berzelius",
#     "Setup took ~10 cycles; main blocker was undocumented --sandbox + ptrace_scope=2.",
#     tags=["worker-setup", "slurm", "cluster:berzelius"])
```

Useful tags for triage: `worker-setup`, `slurm`, `single-machine`, `external-cluster`, `app:model-runner`, `app:cellpose-finetuning`, `cli`, `docs`, `bug-launcher`, `bug-worker`, `undocumented-flag`, `cluster:<name>`. Add more freely.

The same snippet + the full template + the latest tag list are also stored on the collection's manifest (`am.read("bioimage-io/bioengine-skill-issues").manifest`) — fetch from there if you suspect this section is stale.
