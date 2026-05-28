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

**Install the CLI**:
```bash
pip install "bioengine[cli] @ git+https://github.com/aicell-lab/bioengine.git"
```

**Environment**:
```bash
export HYPHA_TOKEN=<your-token>                             # get one at https://hypha.aicell.io
export BIOENGINE_WORKER_SERVICE_ID=<workspace>/bioengine-worker   # which worker to use
```

**Canonical service IDs** (production workers on the `bioimage-io` workspace):

| Service | Service ID pattern |
|---|---|
| KTH BioEngine worker (canonical) | `bioimage-io/bioengine-worker-kth-*:bioengine-worker` |
| deNBI BioEngine worker | `bioimage-io/bioengine-worker-denbi-*:bioengine-worker` |
| Berzelius BioEngine worker | `bioimage-io/bioengine-worker-berzelius:bioengine-worker` |
| Model Runner app | `bioimage-io/model-runner` |
| Cellpose Fine-Tuning app | `bioimage-io/cellpose-finetuning` |

A user who deployed their own worker in workspace `<ws>` has IDs like `<ws>/bioengine-worker` and `<ws>/<app-id>`.

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

# Deploy a fresh instance with a stable, addressable ID:
bioengine apps run bioimage-io/cellpose-finetuning --app-id cellpose-finetuning

# Or, to update an already-running instance to the latest artifact version,
# pass the SAME --app-id as the running instance:
bioengine apps run bioimage-io/cellpose-finetuning --app-id cellpose-finetuning
```

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
bioengine apps stop <app-id>                   # stop a running instance
```

App states: `NOT_STARTED` → `DEPLOYING` → `RUNNING` / `DEPLOY_FAILED`. Deployments are ready when all reach `HEALTHY`.

> **Debugging `DEPLOY_FAILED` / `UNHEALTHY`.** The top-level `message` is generic ("The deployments ['X'] are UNHEALTHY."). The **actionable** error — failed pip install, `RuntimeEnvSetupError`, import errors, etc. — is in `deployments[<name>].message` and `deployments[<name>].logs`. The default `bioengine apps status` output only prints per-deployment *status*, not the message. To see it: `bioengine apps status <app-id> --json`, or via the SDK: `(await worker.get_app_status(application_ids=[app_id]))[app_id]["deployments"][<name>]["message"]`.

For the full CLI flag reference: [references/cli_reference.md](references/cli_reference.md).

---

## 4. Call an app

Once an app is running you call its methods over Hypha RPC. Two equally good ways:

### CLI

```bash
# Discover methods on a service:
bioengine call <workspace>/<app-id> --list-methods

# Call with JSON arguments (recommended for agents):
bioengine call <workspace>/<app-id> <method> --args '{"key": "value"}' --json

# Or with individual --arg flags (auto-typed):
bioengine call <workspace>/<app-id> <method> --arg key=value --json
```

### Python

```python
from hypha_rpc import connect_to_server

server = await connect_to_server({"server_url": "https://hypha.aicell.io", "token": token})
svc = await server.get_service("<workspace>/<app-id>")
methods = await svc.list_methods()           # if the app exposes one
result  = await svc.<method-name>(<args>)
```

### Where to find the service ID

`bioengine apps status` lists running apps with their `application_id`. Combine with the worker's workspace: `<workspace>/<application_id>` is the service ID. For multi-replica apps (composition / scaled deployments), `get_app_status()` returns the canonical concrete `websocket_service_id` and `webrtc_service_id` in its `service_ids` field.

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
