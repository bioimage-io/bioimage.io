# BioEngine worker onboarding

This is the playbook an AI agent runs when the user wants to **start a new BioEngine worker** from scratch. It covers environment selection, the right deployment command, registration, and a 7-check readiness test you must run before declaring the worker ready.

Do not skip the readiness checks. A worker that starts is not necessarily a worker that works.

---

## 0. Hard constraints to surface up front

Mention these to the user before they pick a mode, so they know what they will need:

- **External-cluster mode**: Ray Client requires the worker image's Ray version to **exactly match** the cluster's Ray version. The published image `ghcr.io/aicell-lab/bioengine-worker:0.9.1` ships Ray `2.55.1`. For any other cluster Ray version the user must build a thin overlay image first (covered in §3c below).
- **SLURM mode**: needs login-node access, a SLURM allocation for the requested CPUs / GPUs / wall time, and Apptainer or Singularity available on compute nodes.
- **Single-machine mode**: needs Docker, Podman, Apptainer, or Singularity on the host. GPU support requires the NVIDIA Container Toolkit.
- **All modes**: the user needs an **admin** Hypha token (not read-only) to register the worker and to create the optional facility dashboard artifact. If they paste a token whose `permission` is anything other than `admin`, registration silently fails.

If any of these is a blocker for the user's environment, stop and resolve it before issuing the deployment command.

---

## 1. Identify the environment

Ask the user 2–3 questions and pick the deployment mode:

| User answer | Mode | Why |
|---|---|---|
| "I have a laptop / workstation / single GPU server" | `single-machine` | One node, Docker-friendly, no scheduler |
| "I have an HPC account with SLURM" | `slurm` | Login node submits jobs via `sbatch` |
| "I have a Kubernetes cluster (or Ray cluster) already running" | `external-cluster` | Worker connects via Ray Client |

If unsure, ask explicitly:
1. Is it a single machine, or a cluster?
2. If cluster: is it managed by SLURM, Kubernetes, or something else?
3. Are GPUs available? How many?

---

## 2. Get a Hypha token

The worker authenticates to https://hypha.aicell.io with a JWT. Two paths:

1. **Interactive (preferred for humans)**: tell the user to visit https://bioimage.io/#/bioengine and click "Launch Your Own BioEngine Instance" — the page auto-generates a 30-day admin token after Hypha login. They paste it back to you.
2. **Programmatic**: `python -c "import asyncio; from hypha_rpc import login; print(asyncio.run(login({'server_url':'https://hypha.aicell.io'})))"` — opens a browser, returns the token.

Store the token in an environment variable: `export HYPHA_TOKEN=<token>`. The workspace name is encoded in the JWT and is auto-detected by the worker.

---

## 3. Pick the deployment command

### 3a. Single-machine (Docker)

Pick the latest worker image tag from `https://github.com/aicell-lab/bioengine/pkgs/container/bioengine-worker`. The examples below use `:0.10.1` — substitute the current tag.

**Foreground (interactive — good for first runs, easy to Ctrl+C):**

```bash
docker run --rm -it \
  --user $(id -u):$(id -g) \
  --shm-size=8g \
  --gpus=all \
  -v $HOME/.bioengine:/.bioengine \
  -e HYPHA_TOKEN \
  ghcr.io/aicell-lab/bioengine-worker:0.10.1 \
  python -m bioengine.worker \
    --mode single-machine \
    --head-num-cpus 4 \
    --head-num-gpus 1
```

**Detached (production / agent automation — survives session close, addressable by name):**

```bash
docker run -d --name bioengine-worker \
  --restart unless-stopped \
  --user $(id -u):$(id -g) \
  --shm-size=8g \
  --gpus=all \
  -v $HOME/.bioengine:/.bioengine \
  -e HYPHA_TOKEN \
  ghcr.io/aicell-lab/bioengine-worker:0.10.1 \
  python -m bioengine.worker \
    --mode single-machine \
    --head-num-cpus 4 \
    --head-num-gpus 1

# Inspect:  docker logs -f bioengine-worker
# Stop:     docker stop bioengine-worker && docker rm bioengine-worker
```

- Omit `--gpus=all` if the host has no GPU.
- Restrict to specific GPUs with `--gpus '"device=0,1"'` (note the doubled quoting; required by Docker's CLI parser).
- Replace `--gpus=all` with `--device nvidia.com/gpu=all` on Podman.
- Use `apptainer exec --nv` on HPC login nodes that have no Docker.
- If you need more than one worker on the same host, give each its own `$HOME/.bioengine-<name>` volume and `--name`.

> **Stable worker identity — `--client-id`.** By default the worker gets a random client_id each restart (e.g. `SemhzYTvD8aj8tZ5M7Rasj`) and its full Hypha service ID drifts: `<workspace>/<random>:bioengine-worker`. Anything that hard-codes the service ID — a [custom dashboard](custom_dashboard.md), an upstream script, a saved URL — breaks the next time the worker restarts. **For any persistent deployment, pass a stable `--client-id`** as the last python argument:
>
> ```bash
> python -m bioengine.worker \
>     --mode single-machine \
>     --head-num-cpus 4 \
>     --head-num-gpus 1 \
>     --client-id bioengine-worker-<facility>     # ← pin this
> ```
>
> The full worker CLI is `python -m bioengine.worker --help` inside the image: `docker run --rm ghcr.io/aicell-lab/bioengine-worker:0.10.1 python -m bioengine.worker --help`.

### 3b. SLURM

```bash
bash <(curl -s https://raw.githubusercontent.com/aicell-lab/bioengine/refs/heads/main/scripts/start_hpc_worker.sh)
```

The script downloads an Apptainer image, starts the Ray head inside Apptainer on the login node, and submits Ray-worker jobs via `sbatch` on demand. Key knobs (set via env vars or pass on the command line):

- `--workspace-dir PATH` — shared filesystem path mounted on all SLURM jobs.
- `--default-num-gpus N` — GPUs per SLURM job.
- `--default-time-limit HH:MM:SS` — wall time per SLURM job.
- `--max-workers N` — cap on auto-scaling.

Tell the user: their SLURM account must have allocation for the requested GPUs and time.

### 3c. External-cluster (KubeRay or any existing Ray cluster)

**Hard constraint**: Ray Client requires the **driver image's Ray version to exactly match the cluster's Ray version**. The published image `ghcr.io/aicell-lab/bioengine-worker:0.9.1` ships **Ray 2.55.1**.

If the cluster runs a different Ray version, build a matching image first:

```bash
# Fast: overlay the published image (pulls ~all of it, swaps only the Ray + env layers)
docker build \
  --build-arg BIOENGINE_IMAGE=ghcr.io/aicell-lab/bioengine-worker:0.9.1 \
  --build-arg RAY_VERSION=<cluster-ray-version> \
  -f docker/worker-ray-overlay.Dockerfile \
  -t bioengine-worker:0.9.1-ray<cluster-ray-version> .
```

The supported Ray range is `>=2.33.0, <3.0.0`. After building, push to a registry your Kubernetes cluster can pull from.

Then run the worker (locally or as a Kubernetes `Deployment`):

```bash
python -m bioengine.worker \
  --mode external-cluster \
  --connection-address ray://<head-svc>:10001
```

Recommended for production: deploy as a Kubernetes Deployment with a 10 Gi PVC mounted at `/.bioengine`. See the BioEngine README for a complete YAML.

---

## 4. Wait for the worker to register

The worker logs include lines like:

```
[bioengine.worker] registered as service: <workspace>/<client-id>:bioengine-worker
[bioengine.worker] is_ready: True
```

Pull the **full service ID** (`<workspace>/<client-id>:bioengine-worker`) out of the logs — you will need it for the readiness checks and for telling the user how to call their worker.

Smoke test that the worker is callable:

```bash
bioengine call <workspace>/<client-id>:bioengine-worker get_status --json
```

If this hangs or errors, the worker has not finished registering — wait 30 seconds and retry, then inspect logs.

---

## 5. Readiness checklist (7 checks)

Run all seven before telling the user "your worker is ready." Each is a single Python snippet you can execute with `hypha-rpc`.

```python
# Common setup for all checks
import asyncio
from hypha_rpc import connect_to_server

SERVER = "https://hypha.aicell.io"
TOKEN  = os.environ["HYPHA_TOKEN"]
WORKER = "<workspace>/<client-id>:bioengine-worker"   # from §4

async def get_worker():
    server = await connect_to_server({"server_url": SERVER, "token": TOKEN})
    return server, await server.get_service(WORKER)
```

### C1 — Worker reachable

```python
async def c1():
    _, w = await get_worker()
    s = await w.get_status()
    assert s["is_ready"] is True
    assert s["worker_mode"] in {"single-machine", "slurm", "external-cluster"}
    return s
```

**Expected**: `is_ready == True`. If `False`, the worker process is up but the Ray cluster has not finished registering — wait, retry, then inspect logs.

> **`run_code` API contract.** The `code` parameter must define a function (default name `analyze`); the worker calls it on a Ray task and returns its return value in `result["result"]`. Ray resource options go through `remote_options={...}`, **not** as direct kwargs. The shape is:
>
> ```python
> code = "def analyze():\n    return {'sum': 2 + 2}"
> result = await w.run_code(code=code, remote_options={"num_cpus": 1})
> # result == {"result": {"sum": 4}, ...}
> ```
> A `print(...)` from inside `analyze` ends up in the worker logs, not in the return value — return your result instead. (The skill examples below all follow this pattern.)

### C2 — CPU compute

```python
async def c2():
    _, w = await get_worker()
    code = "def analyze():\n    return 2 + 2"
    out = await w.run_code(code=code, remote_options={"num_cpus": 1})
    assert out["result"] == 4
    return out
```

**Expected**: `run_code` executes a trivial Python expression on a Ray task and returns the output. Failure usually means the Ray cluster is unreachable from the worker process.

### C3 — GPU available (conditional)

Skip if the user said they have no GPU. Otherwise:

```python
async def c3():
    _, w = await get_worker()
    s = await w.get_status()
    total = s["ray_cluster"]["cluster"]["total_gpu"]
    assert total > 0, f"No GPUs detected; expected at least one (worker_mode={s['worker_mode']})"
    code = (
        "def analyze():\n"
        "    import torch\n"
        "    return {'cuda_available': torch.cuda.is_available(),\n"
        "            'device_count': torch.cuda.device_count()}\n"
    )
    return await w.run_code(code=code, remote_options={"num_gpus": 1})
```

**Expected**: `cuda_available: True`, `device_count >= 1`. If `total_gpu == 0`, the host has no GPU, or the container was started without `--gpus=all`, or the GPU is masked by `CUDA_VISIBLE_DEVICES`. Inspect those in order.

### C4 — Outbound network from a Ray task

```python
async def c4():
    _, w = await get_worker()
    code = (
        "def analyze():\n"
        "    import httpx\n"
        "    r = httpx.get('https://hypha.aicell.io/health', timeout=10)\n"
        "    return r.status_code\n"
    )
    out = await w.run_code(code=code, remote_options={"num_cpus": 1})
    assert out["result"] == 200
    return out
```

**Expected**: HTTP 200. If a Ray task cannot reach the Internet, apps that download model weights, stream from OME-Zarr archives, or talk to Hypha at runtime will all fail.

### C5 — App working dir writable

```python
async def c5():
    _, w = await get_worker()
    code = (
        "def analyze():\n"
        "    from pathlib import Path\n"
        "    p = Path('/.bioengine/onboarding-test.txt')\n"
        "    p.write_text('hello')\n"
        "    txt = p.read_text(); p.unlink()\n"
        "    return txt\n"
    )
    out = await w.run_code(code=code, remote_options={"num_cpus": 1})
    assert out["result"] == "hello"
    return out
```

**Expected**: the file roundtrips. If write fails, the workspace dir was not mounted (`-v $HOME/.bioengine:/.bioengine`), or the user lacks write permission, or the PVC (Kubernetes) was not attached.

### C6 — Datasets server reachable (conditional)

Skip if the user does not need the BioEngine datasets server. Otherwise:

```python
async def c6():
    _, w = await get_worker()
    datasets = await w.list_datasets()
    assert isinstance(datasets, (list, dict))
    return datasets
```

**Expected**: a list or dict of available datasets (empty is acceptable on a fresh deployment). If this raises, the datasets server URL is not configured.

### C7 — Hypha artifact creation in the user's workspace

This is the prerequisite for the custom dashboard step (see `custom_dashboard.md`). If C7 fails, the dashboard step cannot run.

```python
async def c7():
    server = await connect_to_server({"server_url": SERVER, "token": TOKEN})
    am = await server.get_service("public/artifact-manager")
    ws = server.config.workspace
    alias = "bioengine-onboarding-test"
    art = await am.create(
        type="application",
        alias=alias,
        manifest={"name": "Onboarding probe", "type": "application"},
        stage=True,
    )
    await am.delete(art.id)
    return art.id
```

**Expected**: artifact ID returned, then cleanly deleted. If `create` raises a permission error, the Hypha token is read-only — generate a new admin token (`permission='admin'`).

### Reporting back to the user

After all checks pass, present a short summary table to the user with the worker's mode, geo location, total CPUs / GPUs / memory, deployment mode, and Ray version (all from `get_status()`).

---

## 6. Common failures and fixes

| Symptom | Likely cause | Fix |
|---|---|---|
| `RuntimeError: Ray Client version mismatch (driver=X, server=Y)` (external-cluster) | Image Ray version ≠ cluster Ray version | Rebuild the image with `--build-arg RAY_VERSION=<cluster>`; push; update Deployment |
| `is_ready: false` 60 s after start | Ray head still booting, or external Ray cluster unreachable | Wait, then re-run C1. If still false: check the Ray dashboard, check `connection-address` |
| C3 returns `cuda_available: false` | No `--gpus=all`, or no NVIDIA Container Toolkit, or wrong CUDA driver | Add `--gpus=all` (Docker) or `--nv` (Apptainer); install [NVIDIA Container Toolkit](https://docs.nvidia.com/datacenter/cloud-native/container-toolkit/install-guide.html) |
| `Permission denied` on C5 | Mount path owned by root or PVC not attached | Run docker with `--user $(id -u):$(id -g)`; verify PVC binding in Kubernetes |
| C7 returns `403 Forbidden` | Token has insufficient permissions | Re-issue token with `permission='admin'` and 30-day expiry |
| SLURM job pending forever | No allocation for requested GPU/time | Lower `--default-num-gpus` or `--default-time-limit`; check `sinfo` for partition |
| `Multiple services found` when calling worker | More than one worker registered with the same alias | Pass the full service ID `<workspace>/<client-id>:bioengine-worker`, not just the alias |
| `get_status()` reports `total_memory: 0` in single-machine Docker mode | Ray's auto-detection mis-reads cgroups in some Docker setups (other resource fields are fine) | Cosmetic; not a worker fault. The CPU and GPU counts in the same payload are still correct, so the dashboard / scheduler aren't affected — only the memory card on the dashboard renders as `0 GB / 0 GB`. |

---

## 7. After the worker is ready

Once all 7 checks pass:

- Direct the user to the [BioEngine Dashboard](https://bioimage.io/#/bioengine) to manage their worker, or
- If they asked for a branded dashboard (facility / lab), load **`custom_dashboard.md`** and follow it.
- If they want to deploy an app, load the matching app subskill in `apps/` or follow the main SKILL.md app development sections.

Always remind the user to keep their `HYPHA_TOKEN` private and to rotate it before expiry.
