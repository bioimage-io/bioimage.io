---
name: bioengine
description: Single entry point for any BioEngine task — setting up a worker, developing a new app, deploying an existing app from a Hypha artifact, or calling a deployed app's methods. Load app subskills in apps/ when working with a specific deployed service.
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
export HYPHA_TOKEN=<your-token>                             # get one at https://hypha.aicell.io
export BIOENGINE_WORKER_SERVICE_ID=<workspace>/bioengine-worker   # which worker to use
```

### Service IDs — how to discover them (read carefully)

BioEngine service IDs follow `<workspace>/<client_id>:<service_name>`. There are two layers, and **they look superficially similar but resolve to different things**:

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
for app_id, info in status.items():
    if info.get("status") == "RUNNING":
        ws_sid  = info["service_ids"]["websocket_service_id"]   # concrete; this is what you call
        rtc_sid = info["service_ids"]["webrtc_service_id"]
        print(app_id, "→", ws_sid)

# 3. Call the app:
app = await s.get_service(ws_sid)                     # e.g. "...-denbi-<hash>-<replica>:model-runner"
result = await app.infer(model_id="affable-shark", inputs="<url-or-tensor>")
```

A user who deployed their own worker in workspace `<ws>` has the same pattern: a `<ws>/bioengine-worker-*:bioengine-worker` for the worker and `<ws>/<worker_client_id>-<replica_id>:<app_id>` per app instance.

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
format_version: 0.5.0
license: MIT
deployments:
  - my_deployment:MyDeployment   # python_filename_without_py:ClassName
authorized_users:
  - "*"
```

Full field reference: [references/manifest_reference.md](references/manifest_reference.md).

### Minimal deployment class

```python
import asyncio, logging, time
from ray import serve
from hypha_rpc.utils.schema import schema_method
from pydantic import Field

logger = logging.getLogger("ray.serve")  # never use print()

@serve.deployment(
    ray_actor_options={
        "num_cpus": 1,
        "num_gpus": 1,           # 1 for GPU, 0 for CPU-only; never fractional
        "memory": 4 * 1024**3,
        "runtime_env": {
            "pip": ["numpy==1.26.4"],  # pin exact versions — any change = full rebuild
        },
    },
    max_ongoing_requests=10,
)
class MyDeployment:
    def __init__(self) -> None:
        self.start_time = time.time()

    async def async_init(self) -> None:
        """Called once before accepting requests. Load models here."""
        import numpy as np  # third-party: always import inside methods

    async def test_deployment(self) -> None:
        """Smoke test — raise to fail startup."""
        assert (await self.ping())["status"] == "ok"

    @schema_method
    async def ping(self) -> dict:
        """Return service status."""
        return {"status": "ok", "uptime": time.time() - self.start_time}
```

### Key rules

- Import third-party packages **inside methods** — top-level imports break Ray serialization.
- `num_gpus: 1` for GPU, `num_gpus: 0` for CPU-only; never use fractional values.
- Entry/orchestrator deployments in composition apps: `num_cpus: 0, num_gpus: 0`.
- `Field(None)` not `Field([...])` for mutable defaults — mutable defaults crash at startup.
- Never return raw numpy arrays over RPC — call `.tolist()` first.
- **Don't pin `pydantic` yourself unless you have to.** BioEngine auto-injects the driver's pydantic into your `runtime_env.pip` so the deployment unpickles cleanly on the Ray Serve replica. If you *do* pin pydantic explicitly, it must resolve to the same `pydantic-core` as the driver — otherwise the pre-flight check refuses to deploy. See [Pydantic compatibility](references/manifest_reference.md#pydantic-compatibility-important).

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

# 3. Call
bioengine call <workspace>/my-app ping --json
```

> **HYPHA_TOKEN inside deployments.** Apps that connect back to Hypha internally need `HYPHA_TOKEN` set in the Ray actor environment. Always pass `--hypha-token $HYPHA_TOKEN` (CLI) or `hypha_token=token` (Python API). Do **NOT** use `--env HYPHA_TOKEN=...` — it is silently ignored by the app builder.

After verifying behaviour: bump `version` in `manifest.yaml` and commit.

---

## 3. Deploy an existing app

You have an artifact ID (e.g. `bioimage-io/model-runner`) and a worker you have access to. You don't need the app's source — just deploy the artifact.

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

> **`--hypha-token` is required for any app that calls back into Hypha** — model-runner, cellpose-finetuning, anything that registers services or reads datasets via Hypha RPC. Without it the deployment fails inside the actor with `RuntimeError: HYPHA_TOKEN environment variable is not set.` (you'll find this in `deployments[<name>].message`, not the top-level error). If you don't know whether an app needs it: pass it anyway, it's harmless.

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

### Apps that take dataset URIs

Some apps (e.g. cellpose-finetuning) take HTTPS URIs of OME-Zarr datasets as input rather than streaming through the worker. Discover candidate datasets via the BioImage Archive search API or any other public catalogue — see [references/data_sources.md](references/data_sources.md) for the BIA query patterns and how to extract `.ome.zarr` URIs from the response.

### App-specific subskills

When working with a specific deployed app, load its dedicated subskill for the method signatures, conventions, and known quirks:

| Service | Subskill | Load when |
|---|---|---|
| Model Runner | [apps/model-runner/model-runner.md](apps/model-runner/model-runner.md) | Searching, running inference on, or comparing BioImage.IO Model Zoo models |
| Cellpose Fine-Tuning | [apps/cellpose-finetuning.md](apps/cellpose-finetuning.md) | Fine-tuning Cellpose on custom annotated microscopy data |

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

---

## References

| File | Covers |
|---|---|
| [references/worker_onboarding.md](references/worker_onboarding.md) | Set up a worker — mode selection + 7-check readiness test (Task 1) |
| [references/custom_dashboard.md](references/custom_dashboard.md) | Branded facility / lab dashboard as a Hypha artifact (Task 1, optional) |
| [references/app_templates.md](references/app_templates.md) | Working templates: simple app, composition app, frontend (Task 2) |
| [references/model_serving.md](references/model_serving.md) | Multiplexing, HuggingFace, BioImage.IO integration, auto-scaling (Task 2) |
| [references/data_sources.md](references/data_sources.md) | Streaming OME-Zarr from BioImage Archive and any HTTPS source (Tasks 2 & 4) |
| [references/manifest_reference.md](references/manifest_reference.md) | Full `manifest.yaml` field reference (Task 2) |
| [references/cli_reference.md](references/cli_reference.md) | Full CLI reference for every `bioengine` subcommand (Tasks 2, 3, 4) |
