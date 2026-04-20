---
name: bioengine
description: Builds, deploys, and manages BioEngine applications on Ray Serve/Hypha, and calls any pre-deployed BioEngine service (model runner, Cellpose fine-tuning, cell image search). Use as the single entry point for any BioEngine task: building new apps, deploying to a worker, calling service methods, or checking cluster resources. Load app subskills in apps/ when working with a specific deployed service.
license: MIT
metadata:
  cli-package: bioengine (pip install -e skills/bioengine/bioengine_cli/)
  app-skills:
    - apps/model-runner/model-runner.md
    - apps/cellpose-finetuning.md
    - apps/cell-image-search.md
---

# BioEngine

BioEngine applications are Ray Serve classes packaged as Hypha artifacts, exposing model inference, training, and data pipelines as Hypha RPC services.

## Quick orientation

| Goal | Where |
|---|---|
| Build and deploy an app | [Deploy workflow](#deploy-workflow) |
| Multi-deployment composition app | [references/app_templates.md](references/app_templates.md) |
| Call any deployed service | `bioengine call <service-id> --list-methods` |
| Model multiplexing / HuggingFace / BioImage.IO integration | [references/model_serving.md](references/model_serving.md) |
| Full manifest fields | [references/manifest_reference.md](references/manifest_reference.md) |
| Full CLI reference | [references/cli_reference.md](references/cli_reference.md) |
| Run BioImage.IO model inference | [apps/model-runner/model-runner.md](apps/model-runner/model-runner.md) |
| Fine-tune Cellpose on custom data | [apps/cellpose-finetuning.md](apps/cellpose-finetuning.md) |
| Search cell morphology (JUMP dataset) | [apps/cell-image-search.md](apps/cell-image-search.md) |

---

## Server and service defaults

**Default Hypha server**: `https://hypha.aicell.io` — use this unless the user specifies another.

| Service | Service ID |
|---|---|
| Model Runner | `bioimage-io/model-runner` |
| Cellpose Fine-Tuning | `bioimage-io/cellpose-finetuning` |
| Cell Image Search | `bioimage-io/cell-image-search` |
| BioEngine Worker | `bioimage-io/bioengine-worker` |

User-deployed worker in workspace `ws-user-github|49943582` → service IDs like `ws-user-github|49943582/model-runner`.

---

## Application structure

```
my-app/
├── manifest.yaml          # identity, deployments, auth
├── my_deployment.py       # Ray Serve class
└── frontend/index.html    # optional static UI
```

**Minimal manifest.yaml:**
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

For composition apps (entry + multiple runtimes) and frontend UI, see [references/app_templates.md](references/app_templates.md).

---

## Deployment class skeleton

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

**Key rules:**
- Import third-party packages **inside methods** — top-level imports break Ray serialization
- `num_gpus: 1` for GPU, `num_gpus: 0` for CPU-only; never use fractional values
- Entry/orchestrator deployments in composition apps: `num_cpus: 0, num_gpus: 0`
- `Field(None)` not `Field([...])` for mutable defaults — mutable defaults crash at startup
- Never return raw numpy arrays over RPC — call `.tolist()` first

---

## Deploy workflow

```bash
pip install -e skills/bioengine/bioengine_cli/
export HYPHA_TOKEN=<your-token>
export BIOENGINE_WORKER_SERVICE_ID=bioimage-io/bioengine-worker
```

```bash
# 1. Upload + deploy in one step
bioengine apps deploy ./my-app/ --app-id my-app --hypha-token $HYPHA_TOKEN

# 2. Monitor (wait for all deployments to reach HEALTHY)
bioengine apps status my-app --logs 50

# 3. Call
bioengine call bioimage-io/my-app ping --json
```

> **HYPHA_TOKEN inside deployments**: Apps that connect back to Hypha internally need `HYPHA_TOKEN` set in the Ray actor environment. Always pass `--hypha-token $HYPHA_TOKEN` (CLI) or `hypha_token=token` (Python API). Do **NOT** use `--env HYPHA_TOKEN=...` — it is silently ignored by the app builder.

**Update a running app in-place** (inherits all env vars automatically):
```bash
bioengine apps upload ./my-app/
bioengine apps run my-workspace/my-app --app-id my-app
```

App states: `NOT_STARTED` → `DEPLOYING` → `RUNNING` / `DEPLOY_FAILED`  
Deployments ready when all reach `HEALTHY`. Check logs: `bioengine apps logs my-app --tail 100`.

After verifying on the live worker: bump `version` in `manifest.yaml` and commit.

---

## CLI quick reference

```bash
bioengine call <svc-id> --list-methods                          # discover methods
bioengine call <svc-id> <method> --args '{"k": "v"}' --json    # call with args
bioengine apps deploy ./my-app/ [--app-id ID] [--hypha-token $HYPHA_TOKEN]
bioengine apps upload ./my-app/
bioengine apps run <ws/app-id> [--app-id ID]
bioengine apps status [APP_ID] [--logs N]
bioengine apps stop <app-id> [-y]
bioengine cluster status [--json]
```

All commands respect `HYPHA_TOKEN`, `BIOENGINE_WORKER_SERVICE_ID`, `BIOENGINE_SERVER_URL` env vars.

---

## Common pitfalls

| Problem | Fix |
|---|---|
| `ModuleNotFoundError` at import | Add to `runtime_env.pip`; import inside method |
| numpy array over RPC error | Call `.tolist()` before returning |
| Long cold start on first request | `min_replicas: 1`; preload model in `async_init()` |
| Blocking inference stalls event loop | `await asyncio.get_event_loop().run_in_executor(None, fn)` |
| `Multiple services found` error | Use `connect_service()` from `bioengine_cli.utils` |
| App UNHEALTHY — `HYPHA_TOKEN` missing | Use `--hypha-token $HYPHA_TOKEN`, not `--env HYPHA_TOKEN=...` |
| Composition param name mismatch | `runtime_a:RuntimeA` must match `__init__` param name `runtime_a` |
| `Field()` mutable default crash | Use `Field(None)`, assign default inside method |

---

## References

| What | File |
|---|---|
| App code templates (simple, composition, frontend) | [references/app_templates.md](references/app_templates.md) |
| Model serving patterns (multiplexing, HuggingFace, auto-scaling) | [references/model_serving.md](references/model_serving.md) |
| Full manifest fields | [references/manifest_reference.md](references/manifest_reference.md) |
| Full CLI reference | [references/cli_reference.md](references/cli_reference.md) |

---

## App-specific subskills

Load these when the user's task involves a specific deployed service:

| Service | Subskill | When to load |
|---|---|---|
| Model Runner | [apps/model-runner/model-runner.md](apps/model-runner/model-runner.md) | Search, infer, validate, or compare BioImage.IO models |
| Cellpose Fine-Tuning | [apps/cellpose-finetuning.md](apps/cellpose-finetuning.md) | Fine-tune Cellpose on custom annotated microscopy images |
| Cell Image Search | [apps/cell-image-search.md](apps/cell-image-search.md) | Search 58M+ cells by morphological similarity |
