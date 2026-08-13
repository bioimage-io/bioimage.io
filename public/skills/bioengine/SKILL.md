---
name: bioengine
description: Single entry point for any BioEngine task — setting up a worker, developing a new app, deploying an existing app from a Hypha artifact, or calling a deployed app's methods. Load app subskills in apps/ when working with a specific deployed service. After finishing a non-trivial task, leave a structured feedback report at the shared public Hypha collection `bioimage-io/skill-issues` (see the "Leave a feedback report" section at the end of this file) so the bioengine team can patch the skill.
license: MIT
metadata:
  cli-package: bioengine[cli] (pip install "bioengine[cli] @ git+https://github.com/aicell-lab/bioengine.git")
  app-skills:
    - apps/model-runner/model-runner.md
    - apps/cellpose4-runner.md
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

> **Prerequisite — Python ≥3.11, checked before anything else.** The install and every CLI invocation hard-fail immediately on an older interpreter:
> ```
> ERROR: Package 'bioengine' requires a different Python: 3.10.14 not in '>=3.11'
> ```
> Run `python3 --version` first. A 3.10 default (common on conda `base` envs) is not enough — create a fresh 3.11+ env before installing: `conda create -n bioengine python=3.11` or `python3.11 -m venv .venv`.
>
> If you reach for `uv`, note that **`uv venv` installs no `pip` into the environment**. A plain `pip install` afterwards therefore runs the *system* pip and reproduces exactly the 3.10 error above, while looking as though the fresh 3.11 env did nothing. Use `uv pip install` (or `.venv/bin/python -m pip` after `uv pip install pip`).

**Install the CLI**:
```bash
pip install "bioengine[cli] @ git+https://github.com/aicell-lab/bioengine.git"
```
If your shell has a global `git config --global url."git@github.com:".insteadOf "https://github.com/"` rewrite (common dotfiles setup) and your SSH key isn't loaded, pip will fail with a `Permission denied (publickey)` error — temporarily unset the rewrite or load the SSH agent first.

> **The `[cli]` extra ships no pydantic — add it if you'll author an app.** `bioengine[cli]` deliberately installs a thin set (`click`, `rich`, `tifffile`, `Pillow` on top of the base deps); `pydantic` only comes with the `[worker]` extra. But every app template starts with `from pydantic import Field` at module top level, so importing, linting, or locally smoke-testing your own app module fails out of the box in exactly the venv this section tells you to create. If you're developing an app (Task 2), install it too:
> ```bash
> pip install pydantic
> ```
> **This gets you linting, not importing.** `pydantic` clears the *first* import error, not the last: `@bioengine.app` runs `from ray import serve` at decoration time, so applying the decorator — which happens on `import your_app` — fails in any `[cli]`-only venv — usually `ModuleNotFoundError: No module named 'ray'`, or `ImportError: cannot import name 'serve' from 'ray'` where some other package has pulled a partial `ray` in. **A `[cli]` venv cannot import an app module at all**, and installing `[worker]` just to import one pulls in the whole Ray stack. Don't try to smoke-test the decorated class locally. Factor the real logic into a **separate undecorated module that imports nothing from `bioengine`**, and test that; the decorated method becomes a thin wrapper around it. A helper *method* on the decorated class is not enough — it fixes the [`FieldInfo` trap](#key-rules) but is still unreachable locally, because importing it means importing the decorator. Get the shape right and you catch real bugs before a deploy round-trip.

> **Version drift.** This installs from `main`, not a pinned release — the package version (`bioengine --version`) can be ahead of whatever release number appears in this skill's prose (written against 0.15.x; earlier installs shipped 0.11.x–0.14.0). Trust the live CLI's own `--help` / error text over a version number mentioned here if they disagree.

> **Nothing validates a manifest or a decorator short of a deploy.** There is no offline checker: no `apps validate`, no dry-run flag, no schema you can lint against. Manifest fields, `@bioengine.app` kwargs and method signatures are all confirmed only by pushing the artifact and watching the worker's response, so a typo'd kwarg costs a full deploy round-trip to find. Budget for that. The local loop described below covers your *logic* thoroughly and covers the BioEngine surface not at all — copy the decorator line and the manifest from a working template rather than composing them from memory, and change one thing at a time.

**Environment**:
```bash
export HYPHA_TOKEN=<your-token>                             # see references/hypha_setup.md if you don't have one
export BIOENGINE_SERVER_URL=<hypha-server>                  # CLI/skill env var — NOT the same name as below
export BIOENGINE_WORKER_SERVICE_ID=<workspace>/bioengine-worker   # which worker to use
```
> **Env-var naming split.** The CLI and every command in this skill read `BIOENGINE_SERVER_URL` (`bioengine --help` documents it; default `https://hypha.aicell.io` if unset). If your shell environment instead provides `HYPHA_SERVER_URL` (a different variable — common when a harness or notebook sets up Hypha credentials generically), the CLI does **not** read it and will silently fall back to its own default. If your `HYPHA_SERVER_URL` differs from the CLI default, explicitly `export BIOENGINE_SERVER_URL="$HYPHA_SERVER_URL"` — don't assume the two are interchangeable.

**Getting a token, workspace, and scoped credentials.** If you don't already have a `HYPHA_TOKEN`, or you need to create a dedicated workspace or mint worker/app tokens, **load [references/hypha_setup.md](references/hypha_setup.md)** — the browser login flow, `create_workspace`, the `generate_token` scheme, and the permission ladder. Most task runs only need this once.

### Service IDs — how to discover them (read carefully)

Calling an app requires the concrete per-worker per-replica service ID, and `<workspace>/<app-id>` alone (e.g. `bioimage-io/model-runner`) does **not** reach the app methods — it returns only `{offer}`. Before any Task 3 (deploy) or Task 4 (call) work, **load [references/service_ids.md](references/service_ids.md)** for the worker-vs-app ID layers, the `list_services` type table, and the ready-to-paste discovery recipe that resolves a callable `websocket_service_id` via `worker.get_app_status(None)`.

> **Exception — an app's own frontend does not resolve service IDs.** The discovery recipe is for external callers (CLI, Python client, another service). A `frontend_entry` page served from the app's `static_site_url` is handed the fully-resolved `ws_service_id` as a URL query parameter by BioEngine itself, so it must **not** run `get_app_status` discovery. See [references/app_templates.md § Frontend UI template](references/app_templates.md#frontend-ui-template).

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

logger = bioengine.logger  # read the logging note below BEFORE you rely on this


@bioengine.app(
    num_cpus=1,
    # CPU-only, so gpu_memory_mb is absent. For GPU add gpu_memory_mb=8192
    # (VRAM in MB) or -1 for a whole device. There is no zero.
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

- Use `@bioengine.app(num_cpus=..., gpu_memory_mb=..., memory_mb=..., pip=[...], max_ongoing_requests=...)` — the framework wraps this into the underlying `@serve.deployment` for you. Authoring with raw `@serve.deployment` is deprecated and will fail introspection.
- **For anything you need to read back, `print(..., flush=True)` beats the logger.** This inverts the usual advice, so here is the measurement rather than the principle. In one instrumented app, 13 of 13 `print(..., file=sys.stderr, flush=True)` lines came back through `bioengine apps status <id> --logs 300 --json`, and 0 of 13 `bioengine.logger` lines and 0 stdlib `logging` lines did. The logger is not broken, it is under-configured: `bioengine.logger` has no handlers and level `NOTSET`, propagating to an unconfigured root, so Python's last-resort handler emits and that is fixed at **WARNING**. `logger.setLevel(logging.INFO)` alone changes nothing, because with no handler on the chain the last-resort handler is still the thing emitting.
  ```python
  import sys
  print("loaded model in %.1fs" % dt, file=sys.stderr, flush=True)   # arrives, reliably
  ```
  `flush=True` is load-bearing. Replica stdout/stderr is block-buffered when it is not a terminal, so an unflushed line sits in the buffer until the process exits or the buffer fills, which looks exactly like a line that was never written. If you prefer the logger's formatting, attach a handler once at module scope and use `logger.warning()` for the lines that matter:
  ```python
  import logging, sys

  logger = bioengine.logger
  if not logger.handlers:                       # idempotent: replicas re-import
      _h = logging.StreamHandler(sys.stderr)
      _h.setFormatter(logging.Formatter("%(levelname)s %(name)s: %(message)s"))
      logger.addHandler(_h)
      logger.setLevel(logging.INFO)
  ```
  Either way, the failure mode is the dangerous one: the framework's own INFO lines *are* captured, so a log you read back looks populated while your lines are absent. That reads as "my code never ran" when the truth is "my line was dropped". Before you debug an app on the strength of its logs, print one line you know executes and confirm you can see it.
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
- Lifecycle hooks are decorators with **free method names**: `@bioengine.async_init`, `@bioengine.smoke_test`, `@bioengine.health_check`. The reserved names `async_init` / `test_deployment` / `check_health` no longer work as plain methods.
- **Model caching is app-managed** — there is no framework model cache. `@bioengine.cached` / `bioengine.cache` were **removed in bioengine 0.11.24 (no shim)** because their torch-only GPU cleanup couldn't reclaim TensorFlow / onnxruntime VRAM. To keep model variants warm, hold them in your own instance dict and load on miss (see `references/model_serving.md`); for guaranteed cross-framework VRAM release run inference in a subprocess, as the built-in `model-runner` app does.
- API methods: `@bioengine.method` (basic) or `@bioengine.method(context=True)` (opt-in caller-context injection — the user method must declare a `context` parameter; arrives as a plain dict, never a Hypha proxy).
- Import third-party packages **inside methods** — top-level imports break Ray serialization.
- **GPU is requested in megabytes of VRAM, not in device counts.** `gpu_memory_mb=8192` asks for 8 GB, `gpu_memory_mb=-1` claims a whole GPU, and **CPU-only is expressed by omitting the kwarg** — `gpu_memory_mb=0` is hard-rejected, so "zero means no GPU" does not carry over. `num_gpus` was replaced by `gpu_memory_mb` in bioengine 0.15.0 and is no longer accepted on `@bioengine.app`. Sizing in MB is what makes several small models share one device safely: two 8 GB apps fit a 24 GB card and the third waits, whereas the old fractional `num_gpus=0.25` divided the device without enforcing any VRAM limit.
- Entry/orchestrator deployments in composition apps: `num_cpus=0` and no `gpu_memory_mb` — they route calls and hold no compute.
- `Field(None)` not `Field([...])` for mutable defaults — mutable defaults crash at startup.
- **Never call your own `@bioengine.method` in-process.** From a `@bioengine.smoke_test`, a `@bioengine.health_check`, or one method calling another, any `Field(...)`-defaulted parameter you *don't* pass arrives as a raw `FieldInfo` object rather than its default value, and the body blows up on first use:
  ```
  TypeError: float() argument must be a string or a real number, not 'FieldInfo'
  ```
  Factor the body into an **undecorated helper** and call that from both places. (The simple-app template's smoke test gets away with `await self.ping()` only because `ping` takes no arguments.)

  Put that helper in a **separate module that imports nothing from `bioengine`**, not in the decorated class. A helper *method* fixes `FieldInfo` but buys you nothing locally, because reaching it still means importing the module that carries the decorator, and a `[cli]` venv cannot do that. A separate module is importable in the venv you already have, so it is the only shape that gives you a real pre-deploy test loop as well.
  ```python
  # app_core.py — plain module, no bioengine import, importable in a [cli] venv
  def process(values: list, scale: float) -> dict:   # real defaults, no Field()
      ...
  ```
  ```python
  # app.py
  @bioengine.method
  async def process(self, values: list = Field(...), scale: float = Field(1.0, description="...")) -> dict:
      import app_core
      return app_core.process(values, float(scale))

  @bioengine.smoke_test
  async def smoke(self) -> None:
      import app_core
      assert app_core.process([1, 2, 3], 1.0)["count"] == 3   # NOT await self.process(...)
  ```
  Then the loop you could not have before: `python -c "import app_core; print(app_core.process([1,2,3], 1.0))"`, plus the failure paths, before spending a deploy round-trip on a logic bug.
  Worth getting right locally: unhandled, this surfaces as a `DEPLOY_FAILED` on a live worker with the real cause buried in `deployments[<name>].message`.

  **Then import the decorated module too, and read *which* error you get.** "A `[cli]` venv cannot import an app module" is true as a statement about success and misleading as advice, because `@bioengine.app` validates its own kwargs *before* it reaches `from ray import serve`. So `python -c "import app"` is a working decorator-argument lint, and the two outcomes mean opposite things:
  ```
  ModuleNotFoundError: No module named 'ray'        # decorator args are fine — this is as far as a [cli] venv goes
  TypeError: app() got an unexpected keyword argument 'num_gpus'   # real bug, found in 0.2 s instead of a deploy round-trip
  ```
  This is not hypothetical: it is what caught an app still passing the pre-0.15.0 `num_gpus`. It costs one command and it is the only offline check of the BioEngine surface you have. Reaching `No module named 'ray'` is the pass condition, so write it that way in a script rather than treating any traceback as failure.
- **Return only builtin types across the Hypha boundary.** The familiar form of this rule is "call `.tolist()` on numpy arrays", and that under-generalises in a way that costs a deploy round-trip. The client-side proxy reconstructs whatever you returned, so **any object whose class is defined in a third-party package fails on the client**, with an error naming a module the client was never supposed to need:
  ```
  ModuleNotFoundError: No module named 'torch'
  ```
  That one came from returning `torch.__version__`, which looks like a string and is a `torch.torch_version.TorchVersion` subclass of `str`. The same trap applies to `np.float32` / `np.int64` scalars (`float(x)`, `int(x)`), `pathlib.Path` (`str(p)`), `enum.Enum` members (`e.value`), pydantic models (`m.model_dump()`) and `datetime` (`.isoformat()`). Coerce at the return statement, not at the point of creation: `str(torch.__version__)`, `float(score)`, `arr.tolist()`. Isinstance checks will not save you here — `isinstance(torch.__version__, str)` is `True`.

  Two scope notes. This applies at the **external Hypha boundary only**: calls *between* composed deployments route through Ray Serve's own transport, so raw numpy passes between them directly, see [references/app_templates.md](references/app_templates.md#composition-app-template). And it governs the *type* of a return value, not its *size* — cap per-object results on the backend and flag the truncation, see [Capping what you send back](references/app_templates.md#capping-what-you-send-back).

  You can catch this before deploying, and `json.dumps` locally is **not** the test — it fails on numpy but happily serialises a `str` subclass. Assert on the exact types instead:
  ```python
  # test_returns.py — runs in a [cli] venv against your undecorated core module
  def assert_builtin(o, path="result"):
      if type(o) in (str, int, float, bool, type(None)):
          return
      if type(o) is list:
          return [assert_builtin(v, f"{path}[{i}]") for i, v in enumerate(o)]
      if type(o) is dict:
          return [assert_builtin(v, f"{path}[{k!r}]") for k, v in o.items()]
      raise TypeError(f"{path} is {type(o).__module__}.{type(o).__name__}, not RPC-safe")
  ```
  `type(o) is str` rather than `isinstance` is the whole point: it is what rejects `TorchVersion` and `np.str_`.
- **Don't pin `pydantic` yourself unless you have to.** BioEngine auto-injects the driver's pydantic into your `runtime_env.pip` so the deployment unpickles cleanly on the Ray Serve replica. If you *do* pin pydantic explicitly, it must resolve to the same `pydantic-core` as the driver — otherwise the pre-flight check refuses to deploy. See [Pydantic compatibility](references/manifest_reference.md#pydantic-compatibility-important).
- **If your app imports `torch` (>=2.5), set `USER`/`LOGNAME` defaults at the very top of the module.** `torch._dynamo` calls `getpass.getuser()` at import time, which raises `KeyError: getpwuid(): uid not found` when the actor runs as a host uid that has no `/etc/passwd` entry (the default for slim Docker images launched with `--user $(id -u):$(id -g)`). `setdefault` preserves the real identity wherever it's already set (HPC apptainer, K8s pods with a populated passwd) and only injects a placeholder when nothing else exists:
  ```python
  import os
  os.environ.setdefault("USER", "bioengine")
  os.environ.setdefault("LOGNAME", "bioengine")
  import torch  # or anything that transitively imports torch
  ```

### GPU apps

`gpu_memory_mb` is one number and getting it wrong is the most expensive mistake in this document, because too high does not fail — it hangs. Read this section before your first GPU deploy.

**Measure the number, do not guess it.** There is no sizing guidance in a model card and guessing overshoots badly: an app that guessed `8192` measured a **1180 MB** peak, 7× over. Reserving 8 GB on a 24 GB card when you need 1.2 GB costs six other replicas their slot. Measure it once, in the app itself, and read it out of the logs:

```python
@bioengine.method
async def measure(self) -> dict:
    import torch
    torch.cuda.reset_peak_memory_stats()
    await self.infer(...)                                   # your real workload, largest input you expect
    return {"peak_mb": round(torch.cuda.max_memory_allocated() / 2**20)}
```

Deploy once with `gpu_memory_mb=-1` (whole device, always schedulable on an idle GPU), call `measure`, then set `gpu_memory_mb` to the peak plus headroom and redeploy. Round up generously — the cost of 30% headroom is one fewer co-tenant, and the cost of being short is an OOM mid-request.

**It is a scheduling reservation, not a cap.** Nothing enforces it at runtime. A replica declaring `gpu_memory_mb=8192` was observed allocating **12 GiB** and continuing to run. So the number does not protect you from your own OOM, and it does not protect co-tenants from you either. Two consequences: your headroom estimate has to be right, because the runtime will not clip you at the boundary, and a card that looks half-free by reservation can be full in fact.

**Over-requesting VRAM hangs with no terminal state.** This is the failure you must recognise, because the skill's usual "poll until terminal state" advice deadlocks on it.

| You over-request | What happens |
|---|---|
| CPU or RAM | `DEPLOY_FAILED` in ~9 s, with `Insufficient resources` |
| VRAM | stays `DEPLOYING` indefinitely — measured at **10.8 minutes** before it was killed by hand |

Ray has nothing to schedule the replica onto, so it queues forever rather than failing. Put a wall-clock deadline on every GPU deploy loop (3 minutes is generous for an app whose image is warm) and treat "still `DEPLOYING` at the deadline" as the diagnosis *over-requested VRAM*, not as slowness. `bioengine cluster status` will show the request pending against a device that cannot satisfy it.

**The insufficient-resources error does not name the resource that was short.** It prints the whole request dict and leaves you to compare it against the cluster yourself. Change one resource at a time when you are converging on a working set, or you will not know which one moved.

**Warm up the device in `async_init`.** Preloading weights is not enough. With the model already resident, the first call still cost **2.19×** the tenth — that is CUDA context creation, kernel autotuning and cuDNN algorithm selection, all triggered by the first tensor that actually reaches the device. One throwaway forward pass in `async_init` moves the whole cost into startup, where nobody is waiting on it:

```python
@bioengine.async_init
async def load(self) -> None:
    import numpy as np, torch
    self._model = ...                                       # weights on device
    with torch.inference_mode():
        self._model(self._to_tensor(np.zeros((256, 256), np.float32)))   # discard the result
```

Use a realistically-shaped input. A warm-up at the wrong shape re-triggers autotuning when the real one arrives.

**Verify your computation ran on the GPU, not merely that a GPU exists.** `torch.cuda.is_available()` answers a question about the *host* and stays `True` while your model quietly runs on CPU. Assert on the tensors instead:

```python
assert next(self._model.parameters()).is_cuda        # weights are on the device
assert out.device.type == "cuda"                     # so is the output
```

And do not use GPU utilisation to answer this. NVML averages over roughly a **1 second** window, so a sub-second inference call reads **0%** on a card that just ran it — which looks exactly like silent CPU fallback. If you want a utilisation reading to mean something, loop the call for several seconds while you sample.

**Treat the reported GPU numbers as unreliable.** On a working GPU app, `application_resources.num_gpus` read `0`, and `bioengine cluster status` reported `used_gpu: 0.01`. `used_gpu_memory` was wrong in both directions in the same session: **466 MiB with nothing deployed**, and **1624 MiB after everything had stopped**, against 15 MiB actually on the card. These fields are for rough capacity planning. For "is my app on the GPU", use the tensor assertions above, and for "what is really on the card", read `nvidia-smi` on the node.

**Stopping an app does not free its GPU immediately.** `bioengine apps stop` returns before the resources are back: a redeploy issued 5 seconds later failed with `Insufficient resources`. Poll `bioengine cluster status` until the VRAM is actually released rather than sleeping a fixed amount.

For VRAM sizing procedure, release-between-calls patterns and per-strategy examples, **load [references/model_serving.md](references/model_serving.md#gpu-allocation-strategies)**.

### Composition apps and frontends

For apps with multiple deployments (e.g. one entry deployment routing to several runtimes) or a frontend HTML UI, **load [references/app_templates.md](references/app_templates.md)** — full working templates for simple, composition, and frontend cases.

### Advanced serving patterns

GPU VRAM sizing and release, multiplexing, HuggingFace integration, BioImage.IO model loading, auto-scaling: **load [references/model_serving.md](references/model_serving.md)**.

### Streaming datasets into your app

If your app reads image data, stream it from a public repository or from the BioEngine local data server instead of bundling it. **Load [references/data_sources.md](references/data_sources.md)** for the BioImage Archive workflow, the choice between `zarr.open(uri)` (vanilla fsspec) and `HttpZarrStore(base_url=uri)` (shared chunk cache), and how to read OME-Zarr from a local BioEngine dataset through the same code path via `bioengine.datasets`.

### Live test cycle

Live testing on a real worker is **required** before bumping version. There is no useful local emulation of Ray Serve + Hypha registration — deploy to a worker the user has access to.

```bash
# 1. Upload + deploy in one step. Use this for the FIRST deploy of an app-id.
#    To update an app that is ALREADY running, see "Updating a running app" below —
#    deploy alone does not reliably roll the running replica forward.
bioengine apps deploy ./my-app/ --app-id my-app --hypha-token $HYPHA_TOKEN

# 2. Monitor (wait for all deployments to reach HEALTHY)
bioengine apps status my-app --logs 50

# 3. Call — resolve the concrete per-replica service ID first (see "Service IDs" above),
#    then call it. Calling <workspace>/my-app directly returns only {offer}, not the methods.
bioengine apps status my-app --json
#   → find result["my-app"]["service_ids"]["websocket_service_id"]
bioengine call <ws>/<worker_client_id>-<replica>:my-app ping --json
```

> **Updating a running app: use `apps run --version`, not `apps deploy`.** `bioengine apps deploy` against an app-id that is already running uploads the new artifact version and restarts the replica, but the restarted replica has been observed coming back **on the old code**, with `version`, `running_version` and `version_verified` all reporting the stale version while `status` stays `RUNNING`. Reproduced deterministically on two consecutive Python changes. The path that reliably rolls a running instance forward is two steps:
>
> ```bash
> bioengine apps deploy ./my-app/ --app-id my-app --hypha-token $HYPHA_TOKEN   # uploads the new artifact version
> bioengine apps run my-app --app-id my-app --version 1.0.3                    # moves the RUNNING instance onto it
> ```
>
> `apps run` takes `--version`; `apps deploy` has none. The update lands in roughly 25–30 s. Tracked upstream as [aicell-lab/bioengine#157](https://github.com/aicell-lab/bioengine/issues/157).
>
> **Confirm the update behaviourally, not from a status field.** After the update, call the method and look for the thing you changed. `status: RUNNING` is worthless as an update signal, because an app being updated was already `RUNNING` — a "poll until terminal state" loop exits on the first poll, one second in, reporting success on a stale replica. `version_verified: true` has been observed while the live code was two versions old.
>
> **`running_version` only tracks the Python replica.** The static frontend and the Ray Serve deployment version-skew independently, by design. Redeploy with a change to `frontend/` only and **`running_version` never advances — polling it waits forever** while the new HTML is already being served. Verify the two separately: `running_version` for Python changes, and `curl` on `static_site_url` diffed against your local file for frontend changes.
>
> Be precise about *why*, because the comfortable explanation is wrong and it hides an outage. The replica is **not** kept. A frontend-only redeploy restarts it: replica uptime measured at 70.0 s before and 3.9 s after, with a ~10–15 s window in which the app is unavailable, while the Python files were md5-identical. What does not happen is a *version bump* — the replica comes back at the same version, which is why the number you are polling never moves. So a frontend-only change is not free. If the app is serving users, that redeploy costs them the same interruption a Python change would.
>
> **That skew has a user-facing consequence, so deploy defensively.** The static site serves the artifact head while the replica serves whatever version it is actually on. A redeploy that changes both can therefore put a new UI in front of users while the old backend is still answering, and the UI asks for a field the backend cannot return. Two habits make this survivable. Land the Python change and confirm it behaviourally *before* shipping frontend code that depends on it. And render new fields defensively — `o.newMetric != null ? fmt(o.newMetric) : "—"` degrades to a dash instead of `undefined` across the window where the two disagree.

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
bioengine apps status <app-id> --logs 50 --json  # actor logs (see the caveat below)
bioengine apps stop <app-id> -y                # stop a running instance (-y skips the confirmation prompt)
```

App states: `NOT_STARTED` → `DEPLOYING` → `RUNNING` / `DEPLOY_FAILED`. Deployments are ready when all reach `HEALTHY`.

**That state machine describes a *first* deploy only.** An app you are updating is already `RUNNING`, so a "poll until terminal state" loop exits on the first poll and reports success on whatever replica is live — stale or not. For updates, ignore `status` and confirm behaviourally (see [Live test cycle](#live-test-cycle)).

**And `DEPLOYING` is not guaranteed to be transient.** A replica asking for more VRAM than any device can give is unschedulable rather than invalid, so it queues in `DEPLOYING` with no timeout and no `DEPLOY_FAILED` (measured at 10.8 minutes before manual intervention), while the same over-request on CPU or RAM fails in about 9 seconds. Every wait loop needs a wall-clock deadline of its own — see [GPU apps](#gpu-apps).

> **`bioengine apps status --json` response shape.** The top-level dict is keyed by **app id** (not flat). The real payload carries about 27 keys per app; these are the ones worth knowing:
> ```json
> {
>   "my-app-id": {
>     "status": "RUNNING",
>     "version": "1.0.3",              // target: the artifact version the worker was last told to run
>     "running_version": "1.0.2",      // live: what the Python replica is ACTUALLY executing
>     "version_verified": true,        // do not trust as an update signal — see below
>     "deployments": {
>       "MyDeployment":    {"status": "HEALTHY", "message": "...",
>                           "logs": {"<replica_id>": {"stdout": ["…"], "stderr": ["…"], "…": "…"}}},
>       "ProxyDeployment": {"status": "HEALTHY", "…": "…"}
>     },
>     "service_ids": {"websocket_service_id": "...", "webrtc_service_id": "..."}
>   }
> }
> ```
> So `result[app_id]["deployments"][deployment_name]["message"]` is where the actionable detail lives. The bare `bioengine apps status` output only prints per-deployment *status*, not the message — always pass `--json` when debugging.
>
> `version` vs `running_version` is the pair that actually diagnoses a stuck update, and they can disagree for minutes. `version_verified` reads like a guarantee and is not one: it has been observed `true` while the replica was two versions behind. Other fields you will see and can ignore for most work: `auto_redeploy`, `recovered_app`, `application_kwargs`, `scaling`, `start_time`, `last_updated_at`.
>
> **Three reported values do not echo your decorator, and none of them means it was ignored.** `max_ongoing_requests` has been observed reporting `10` against a declared `4`, `memory` reporting `2684354560` (2560 MiB) against a declared `memory_mb=2048`, and `gpu_enabled: true` for a CPU-only app whose own `application_resources` correctly read `{"num_cpus": 1, "num_gpus": 0, "VRAM_MB": 0}`. Read `application_resources` for what the app actually requested, and don't chase the discrepancy.
>
> **`application_resources` is the better field, not a reliable one, and on GPU it is neither.** The same field read `num_gpus: 0` for an app that was demonstrably running on the device. Nothing in this payload settles whether your work reached a GPU — assert on tensor placement inside the app instead, see [GPU apps](#gpu-apps).

> **`bioengine apps list --json` has a different top-level shape from `apps status --json`.** These are the two commands you will use together to verify a deletion, and they are not keyed alike. `apps list --json` is keyed by **full artifact id** and each value wraps the manifest one level down:
> ```json
> {"bioimage-io/my-app": {"manifest": {"name": "My App", "version": "1.0.3", "…": "…"}}}
> ```
> So it is `result["<workspace>/<alias>"]["manifest"]["version"]`, against `result["<app-id>"]["status"]` for `apps status --json`. A filter written for one shape returns an empty result against the other, with no error to tell you which one you were holding.

> **`logs` is nested two levels deep, and `bioengine apps logs` prints nothing.** Two separate traps. `bioengine apps logs <app-id> -n 20` has been observed printing empty per-deployment sections while thousands of characters of logs existed — reach them through `bioengine apps status <app-id> --logs N --json` instead. And in that payload `deployments[<name>]["logs"]` is **keyed by replica id, and each value is a dict**, not a string and not a list:
> ```python
> {"<replica-id>": {"creation_timestamp": ..., "timezone": ..., "stdout": [...], "stderr": [...]}}
> ```
> Two ways to get this wrong, and the second is the dangerous one. Slicing the outer dict as if it were text raises `TypeError: unhashable type: 'slice'`, which at least tells you. Iterating a replica value directly yields its four **keys** — you print `creation_timestamp`, `timezone`, `stdout`, `stderr` and read them as four log lines, with no error at all. Reach the lists explicitly:
> ```python
> for replica_id, rec in dep.get("logs", {}).items():
>     lines = rec.get("stdout", []) + rec.get("stderr", [])
>     print(f"--- {replica_id}")
>     print("\n".join(lines[-50:]))
> ```
> **Read both channels.** Which one your own lines land in depends on how you emitted them (see the logging note under [Key rules](#key-rules)), and the framework writes to `stderr` regardless. Reading only one hides half the picture, and if you read only `stderr` you will see the worker's own INFO lines and conclude your code never ran.
>
> **The framework logs every call for you, and that line is often all you need.** Each `@bioengine.method` invocation emits an audit line carrying the method name, the outcome and the wall-clock duration:
> ```
> CALL analyze OK 19453.3ms
> ```
> It comes from the framework, so it survives whatever your own logging is doing — which makes it the thing to look for first when you are asking "did my method run at all, and how long did it take". Timing an app end to end usually needs no instrumentation beyond grepping `CALL` out of the logs.
>
> **`--logs N` is not a hard bound.** It is a hint applied per replica per stream, not a total: `--logs 40` returned **795 lines**. Slice on your side after flattening (`lines[-40:]`) if you need a bounded amount, and do not size a buffer or a context window on the number you passed.

> **Transient invalid JSON during `DEPLOYING`.** While an app is still `DEPLOYING`, the `--json` payload can contain raw unescaped control characters in the `message`/`logs` string fields (pip/progress-bar output leaking through), which makes strict `json.loads` fail with "Invalid control character" errors at varying offsets. This self-resolves once the app reaches `RUNNING`. Parse defensively (`json.loads(text, strict=False)`), or only strictly parse once `status` is `RUNNING` or `DEPLOY_FAILED`.

> **Debugging `DEPLOY_FAILED` / `UNHEALTHY`.** The top-level `message` is generic ("The deployments ['X'] are UNHEALTHY."). The **actionable** error — failed pip install, `RuntimeEnvSetupError`, import errors, etc. — is in `deployments[<name>]["message"]` and `deployments[<name>]["logs"]` (that second one is a dict of lists — flatten it, see above). Check these before guessing.

### Cleaning up a test deployment

`bioengine apps stop` halts the running app (frees compute) but leaves its Hypha artifact in place. To fully remove a test deployment (so it doesn't clutter the artifact list):

```bash
# 1. Stop the running instance:
bioengine apps stop my-test-app -y
```

To also delete the artifact, **do not** call `public/artifact-manager`'s `am.delete` directly — unless you are the artifact's owner it fails:
```
PermissionError: User does not have permission 'delete' on the artifact.
```
Instead call `delete_app` on the **worker service** itself (`$BIOENGINE_WORKER_SERVICE_ID`) — it runs with the worker's own elevated permission, not yours, so it succeeds even when `am.delete` doesn't. Validated:
```bash
python - <<'PY'
import asyncio, os
from hypha_rpc import connect_to_server
async def main():
    s = await connect_to_server({"server_url": os.environ["BIOENGINE_SERVER_URL"],
                                 "token": os.environ["HYPHA_TOKEN"],
                                 "workspace": os.environ["HYPHA_WORKSPACE"]})
    worker = await s.get_service(os.environ["BIOENGINE_WORKER_SERVICE_ID"])
    await worker.delete_app(artifact_id=f"{os.environ['HYPHA_WORKSPACE']}/my-test-app")
asyncio.run(main())
PY
```
This is irreversible and removes the whole app artifact (all versions) — only run it against artifacts you created for testing. If you only need to drop one pre-release "dev" version rather than the whole artifact, use `worker.delete_app_version` instead.

> **Verifying deletion.** `delete_app` returns `None` on success — don't treat the return value as confirmation either way. Verify with `bioengine apps list` (artifact should be gone) or `bioengine apps status <id>`. After deletion, `apps status <id>` can report the app as `NOT_RUNNING` rather than an outright "not found" error — treat `NOT_RUNNING` or absence from `apps list` as "gone".

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
# model-runner's infer() is async — it returns a request_id; poll get_infer_status
# for the result (see apps/model-runner/model-runner.md § Async job API).
request_id = await app.infer(model_id="affable-shark", inputs="<url>")
```

### Apps that take dataset URIs

Some apps (e.g. cellpose-finetuning) take HTTPS URIs of OME-Zarr datasets as input rather than streaming through the worker. Discover candidate datasets via the BioImage Archive search API, the IDR OME-NGFF samples catalogue, or any other public source — see [references/data_sources.md](references/data_sources.md) for the BIA, IDR / OMERO query patterns and how to extract `.ome.zarr` URIs from the response.

### App-specific subskills

When working with a specific deployed app, load its dedicated subskill for the method signatures, conventions, and known quirks:

| Service | Subskill | Load when |
|---|---|---|
| Model Runner | [apps/model-runner/model-runner.md](apps/model-runner/model-runner.md) | Searching, running inference on, or comparing BioImage.IO Model Zoo models (Cellpose-3 and earlier) |
| Cellpose-4 Runner | [apps/cellpose4-runner.md](apps/cellpose4-runner.md) | Running Cellpose-4 / Cellpose-SAM models — which model-runner cannot serve |
| Cellpose Fine-Tuning | [apps/cellpose-finetuning.md](apps/cellpose-finetuning.md) | Fine-tuning Cellpose on custom annotated microscopy data |

> **After completing an inference / analysis run: leave a feedback report** if the call surface, tensor format, model-ID nicknames, or RDF output keys did not match what the subskill described. See [§ Leave a feedback report](#leave-a-feedback-report) at the end of this file.

---

## Common pitfalls (across all four tasks)

| Problem | Fix |
|---|---|
| `ModuleNotFoundError` at import | Add to `runtime_env.pip`; import inside method |
| numpy array over RPC error | Call `.tolist()` before returning |
| `ModuleNotFoundError: No module named 'torch'` **on the client**, not the worker | You returned a third-party type across the Hypha boundary (classically `torch.__version__`, a `str` subclass). Coerce to a builtin at the return statement: `str(...)`, `float(...)`, `.tolist()` |
| App stuck in `DEPLOYING` for minutes with no error | You asked for more `gpu_memory_mb` than any device has. It is unschedulable, not invalid, so it never reaches `DEPLOY_FAILED`. Lower the request; put a deadline on the wait loop |
| `Insufficient resources` printing the whole request dict | It does not name which resource was short. Change one of `num_cpus` / `memory_mb` / `gpu_memory_mb` at a time and re-read `bioengine cluster status` |
| GPU utilisation reads 0% during a call that clearly ran | NVML averages over ~1 s, so a sub-second call is invisible. Assert on `tensor.device.type == "cuda"` instead of on utilisation |
| First request far slower than steady state with weights already loaded | CUDA context + kernel autotuning, not model loading. Run one throwaway forward pass at a realistic shape in `async_init` |
| `bioengine apps stop` then immediately redeploy → `Insufficient resources` | Stop does not release resources synchronously. Observed still held 5 s later. Poll `bioengine cluster status` until the resource is back before redeploying |
| `apps deploy` printed no `Uploading…` line | It still uploaded. The line is not emitted on every path, so its absence is not evidence that the artifact was unchanged. Verify with the artifact version, not the console output |
| `nvml_compute_processes` PIDs match nothing you can see | They are **host** PIDs. Inside the container `os.getpid()` is in a different namespace (7167 against an NVML pid of 2846561), so matching them is not a valid way to find your own process |
| Long cold start on first request | `min_replicas: 1`; preload model in `async_init()` |
| Blocking inference stalls event loop | `await asyncio.get_event_loop().run_in_executor(None, fn)` |
| `Multiple services found` error | Use `connect_service()` from `bioengine.cli.utils` |
| App UNHEALTHY — `HYPHA_TOKEN` missing | Use `--hypha-token $HYPHA_TOKEN`, not `--env HYPHA_TOKEN=...` |
| Composition runtime not injected | In 0.6.0 the wiring is the **import + type hint**: `from runtime_a import RuntimeA` and annotate the `__init__` parameter `runtime_a: RuntimeA` (not `DeploymentHandle`). The parameter *name* is free; there is no `deployments:` list to match |
| `Field()` mutable default crash | Use `Field(None)`, assign default inside method |
| `TypeError: float() argument must be … not 'FieldInfo'` | You called your own `@bioengine.method` in-process (usually from a smoke test) and omitted a `Field(...)`-defaulted argument. Factor the body into a separate undecorated module and call that from both sides |
| `apps status --json` fails to parse while `DEPLOYING` | Pip/progress output leaks unescaped control characters into `message`/`logs`. Use `json.loads(text, strict=False)`, or only parse strictly once `status` is `RUNNING` / `DEPLOY_FAILED` |
| Frontend URL missing from `bioengine apps status` | The plain status output never prints it. Read `static_site_url` from `bioengine apps status <id> --json` |
| `running_version` never advances after a redeploy | Expected if you only changed `frontend/`. The replica does restart (~10–15 s unavailable) but comes back at the same version, so the number is correct and polling it never terminates. The new HTML is already live — verify by fetching `static_site_url` instead |
| Local `import your_app` fails with `No module named 'ray'` (or `cannot import name 'serve' from 'ray'`) | `@bioengine.app` imports `ray.serve` at decoration time, and `bioengine[cli]` ships no ray. A `[cli]` venv cannot import an app module. Put the logic in a separate module that imports nothing from `bioengine`, and test that |
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
| [references/model_serving.md](references/model_serving.md) | GPU VRAM sizing, multiplexing, HuggingFace, BioImage.IO integration, auto-scaling (Task 2) |
| [references/data_sources.md](references/data_sources.md) | Streaming OME-Zarr from BioImage Archive, IDR / OMERO, and any HTTPS source (Tasks 2 & 4) |
| [references/manifest_reference.md](references/manifest_reference.md) | Full `manifest.yaml` field reference (Task 2) |
| [references/cli_reference.md](references/cli_reference.md) | Full CLI reference for every `bioengine` subcommand (Tasks 2, 3, 4) |

---

## Leave a feedback report

Every time you finish a non-trivial BioEngine task (worker setup, app deployment, dataset wiring, model-runner inference run, debugging an outage) — especially if it took multiple trial-and-error cycles, required reading source code, or needed an undocumented flag — **leave a structured feedback report** in the shared public collection `bioimage-io/skill-issues` (feedback for every bioimage.io skill lands here; the `skill: "bioengine"` field below tags it). The bioengine team reads these regularly and uses them to patch the skill, the CLI, the worker, and the apps.

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
        parent_id="bioimage-io/skill-issues",
        alias=f"report-{date}-bioengine-{slug}",  # e.g. report-2026-06-05-bioengine-slurm-berzelius
        type="report",
        manifest={
            "name": title,
            "description": summary,
            "skill": "bioengine",                 # REQUIRED — which skill this report is about
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

The same snippet + the full template + the latest tag list are also stored on the collection's manifest (`am.read("bioimage-io/skill-issues").manifest`) — fetch from there if you suspect this section is stale.
