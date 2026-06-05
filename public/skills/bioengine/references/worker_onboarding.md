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

The worker authenticates to https://hypha.aicell.io with a JWT. The full login + workspace + token-minting recipes (browser login flow, `create_workspace`, the BioEngine worker's own admin / read_write / 30-day expiration conventions) live in [SKILL.md → "If you don't have a Hypha token yet"](../SKILL.md). Read that subsection if you're bootstrapping a new user from zero — it covers:

- `hypha_rpc.login()` browser flow with `login_callback` for headless agents
- `server.create_workspace({"id": "...", "persistent": True})` for lab/facility deployments
- `server.generate_token({"permission": "admin", "expires_in": 3600*24*30})` for the worker's bootstrap token
- `server.generate_token({"permission": "read_write", "expires_in": 3600*24*30})` for app tokens

For the worker specifically:

- Use an **admin** token (the worker mints app + service tokens internally; needs admin to do that).
- 30-day expiration is the BioEngine default — long enough that the worker doesn't need re-bootstrapping during normal operation, short enough to bound the blast radius if leaked.
- Store as `export HYPHA_TOKEN=<token>`. The workspace name is encoded in the JWT and is auto-detected by the worker on startup.

If the user has already done the login and has a token, skip the whole flow and just collect the env var from them.

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

The launcher script `start_hpc_worker.sh` wraps a `python -m bioengine.worker --mode slurm` invocation: it loads the apptainer/singularity image, binds SLURM binaries and the workspace dir, then submits Ray-worker jobs via `sbatch` on demand. Everything after the script name is forwarded straight to the worker's argparse, **except** for two launcher-only flags (`--sandbox`, `--apptainer-cachedir` / `--singularity-cachedir`) handled by the script itself.

Minimal invocation (downloads + runs the script from `main`):

```bash
export HYPHA_TOKEN=<admin-token>

bash <(curl -s https://raw.githubusercontent.com/aicell-lab/bioengine/main/scripts/start_hpc_worker.sh) \
    --mode slurm \
    --workspace-dir $HOME/.bioengine \
    --client-id bioengine-worker-<facility> \
    --head-num-cpus 4 \
    --head-num-gpus 0 \
    --head-memory-in-gb 16 \
    --default-num-gpus 1 \
    --default-num-cpus 8 \
    --default-mem-in-gb-per-cpu 8 \
    --default-time-limit 04:00:00 \
    --min-workers 0 \
    --max-workers 4 \
    --scale-down-threshold-seconds 300 \
    --further-slurm-args "-A <project> -C thin"
```

Key knobs (most are forwarded directly to `python -m bioengine.worker` — see [cli_reference.md → `python -m bioengine.worker`](cli_reference.md#python--m-bioengineworker--worker-process) for the full list):

| Flag | Purpose | Notes |
|---|---|---|
| `--workspace-dir PATH` | Shared FS path the head binds and mounts on every SLURM job | Must be on a filesystem readable from compute nodes. Default `$HOME/.bioengine`. |
| `--client-id NAME` | Stable Hypha client_id (and therefore stable service ID across restarts) | Without it, the service ID changes every restart. **Always set for persistent SLURM deployments.** |
| `--head-num-cpus / --head-num-gpus / --head-memory-in-gb` | Resources Ray pretends the head has (it runs on the login node) | Login-node policy usually forbids long-running compute, so the head is coordination-only: keep `--head-num-gpus 0`. |
| `--default-num-gpus / --default-num-cpus / --default-mem-in-gb-per-cpu / --default-time-limit` | Defaults baked into every `sbatch` Ray-worker submission | Per-deployment overrides are possible later but these are the cluster's "house" allocations. |
| `--min-workers / --max-workers / --scale-down-threshold-seconds` | Autoscaler bounds | `--min-workers 0` keeps the cluster idle until a deploy_app request comes in. |
| `--further-slurm-args "<one quoted string>"` | Extra `sbatch` directives appended to every Ray-worker job | **One quoted string, not multiple tokens** (argparse rejects flag-shaped tokens). Use for `-A <project>` (account), `-C thin` (constraint), `-p <partition>`, `--qos=<qos>`. |
| `--gpu-slurm-flag '--gres=gpu:{n}'` | Use `--gres=gpu:N` instead of `--gpus=N` for the sbatch GPU directive | Default `--gpus={n}` works on Berzelius and generic clusters; switch to `--gres=gpu:{n}` for clusters that require it (some Slurm setups). Pass `''` to omit entirely when GPUs are requested via `--further-slurm-args`. |
| `--further-apptainer-args "<one quoted string>"` | Extra flags forwarded to `apptainer exec` inside each worker job | Useful for `--bind /proj/<lab>:/proj/<lab>` to expose extra filesystems. |
| `--sandbox` | **Launcher-only.** Build/reuse an apptainer sandbox dir instead of pulling a SIF | See below; required on most RHEL-8 HPC systems. |

#### `--sandbox` — required on most HPC systems

Most RHEL-8 / Rocky-8 HPC systems set `kernel.yama.ptrace_scope = 2`, which breaks the default `apptainer pull` → SIF path (`proot` / `mksquashfs` can't trace inside themselves). Symptoms during script startup: an opaque `apptainer build` failure under `~/.apptainer/cache` or a hang.

**Fix:** pass `--sandbox` to the launcher. The script then `apptainer build --sandbox <dir> docker://...` once into `<workspace-dir>/images/<image>-sandbox/` and reuses that directory on subsequent starts. The first build is ~10 min and ~10 GB; pre-stage it before submitting if start-up time matters. The `--sandbox` flag is stripped before the args are forwarded to the Python worker.

Both `--apptainer-cachedir` and `--singularity-cachedir` are similarly launcher-only and are stripped from the forwarded args. Use them to redirect the cache off the default `<workspace-dir>/images/` (e.g. onto a faster local scratch).

#### Running the head from inside `sbatch`

Login-node policy on most HPC sites forbids long-running processes, so the head itself should run as an sbatch job on the CPU partition (the head is coordination-only — `--head-num-gpus 0`). Wrap the `bash <(curl …)` line in a script and submit it:

```bash
#!/bin/bash
#SBATCH -A <project>
#SBATCH -p <cpu-partition>
#SBATCH -c 4
#SBATCH --mem=16G
#SBATCH -t 72:00:00
#SBATCH -J bioengine-head

source ~/.env   # loads HYPHA_TOKEN
bash <(curl -s https://raw.githubusercontent.com/aicell-lab/bioengine/main/scripts/start_hpc_worker.sh) \
    --mode slurm \
    --client-id bioengine-worker-<facility> \
    --sandbox \
    --further-slurm-args "-A <project> -C thin" \
    # … rest of the knobs above
```

Tell the user: their SLURM account must hold allocation for the head job **and** the Ray-worker jobs it spawns. Multi-project users should pass the right `-A` explicitly via `--further-slurm-args` (use `projinfo` to enumerate accounts).

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
  --head-node-address ray://<head-svc> \
  --client-server-port 10001 \
  --client-id bioengine-worker-k8s
```

`--head-node-address` accepts the bare `ray://<host>` form; the port comes from `--client-server-port` (default `10001`). Recommended for production: deploy as a Kubernetes Deployment with a 10 Gi PVC mounted at `/.bioengine`. See the BioEngine README for a complete YAML.

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

> **`run_code` API contract — read before writing any check.** `run_code(code=..., remote_options={...})` schedules a Ray task that imports the code string, looks up a top-level function named **`analyze`** (literal), calls it with no arguments, and returns its value in `result["result"]`. Three rules that catch every agent the first time:
> 1. The function MUST be named `analyze`. Anything else raises `Object 'analyze' is not callable: None` — a misleading error that does not name the missing symbol.
> 2. The function MUST return a JSON-serialisable value. `print(...)` lands in the worker logs, not the return.
> 3. Ray resource options go through `remote_options={"num_cpus": ..., "num_gpus": ...}`, **not** as direct kwargs.
>
> All seven checks below follow this contract.

```python
# Common setup for all checks
import asyncio, os
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
| SLURM job pending forever | No allocation for requested GPU/time | Lower `--default-num-gpus` or `--default-time-limit`; check `sinfo` for partition; verify the right `-A <project>` via `--further-slurm-args` |
| `Multiple services found` when calling worker | More than one worker registered with the same alias | Pass the full service ID `<workspace>/<client-id>:bioengine-worker`, not just the alias |
| `get_status()` reports `total_memory: 0` in single-machine Docker mode | Ray's auto-detection mis-reads cgroups in some Docker setups (other resource fields are fine) | Cosmetic; not a worker fault. The CPU and GPU counts in the same payload are still correct, so the dashboard / scheduler aren't affected — only the memory card on the dashboard renders as `0 GB / 0 GB`. |
| SLURM launcher fails during `apptainer pull` or hangs in `apptainer build` (RHEL-8 / Rocky-8) | Kernel `yama.ptrace_scope=2` breaks the default `proot/mksquashfs` SIF build path | Add `--sandbox` to the launcher invocation; it builds an apptainer sandbox dir (no proot needed) and caches it at `<workspace-dir>/images/`. See §3b. |
| `--further-slurm-args` raises `expected one argument` or `unrecognized arguments` | Multi-token args are not quoted | Pass as a **single quoted string**, e.g. `--further-slurm-args "-A <project> -C thin"`. Internally `shlex.split` re-tokenises. |
| Worker exits cleanly after a brief Hypha 503 / upstream outage | WebSocket reconnect timeout is ~100 s; longer Hypha blips trigger a clean shutdown | Re-submit the sbatch / restart the process. Hypha artifacts persist, but Ray Serve deployments **do not auto-recover** — see §7. |
| `am.get_file(path=...)` raises `unexpected keyword argument 'path'` | The artifact-manager API uses `file_path=`, not `path=` | Call `await am.get_file(artifact_id=..., file_path="manifest.yaml")`. |
| `list_services({"type": "bioengine-apps"})` returns 0 entries despite a running app | Service type is **singular** `bioengine-app` (worker is `bioengine-worker`) | Use `{"type": "bioengine-app"}`. To enumerate apps on a specific worker, prefer `worker.get_app_status(None)`. |

---

## 7. After the worker is ready

Once all 7 checks pass:

- Direct the user to the [BioEngine Dashboard](https://bioimage.io/#/bioengine) to manage their worker, or
- If they asked for a branded dashboard (facility / lab), load **`custom_dashboard.md`** and follow it.
- If they want to deploy an app, load the matching app subskill in `apps/` or follow the main SKILL.md app development sections.

Always remind the user to keep their `HYPHA_TOKEN` private and to rotate it before expiry.

### Worker restarts and app recovery

The Hypha artifact-manager persists every uploaded app artifact, so artifacts survive a worker restart. **Ray Serve deployments do not.** When the worker comes back up it logs `No existing Ray Serve applications needed recovery.` and registers `<workspace>/bioengine-worker` with no apps running.

To bring previously-deployed apps back, either:

1. **Manual re-deploy** — call `worker.deploy_app(artifact_id=..., application_id=..., version=..., hypha_token=...)` (or `bioengine apps run …`) again, passing the **same `application_id`** as before so the service ID resolves to the same name.
2. **Auto-deploy on startup** — pass `--startup-applications '{"artifact_id": "<ws>/my-app", "application_id": "my-app"}'` (one JSON object per `--startup-applications` value, repeatable) when launching the worker. The worker then deploys those apps as part of its bring-up before flipping `is_ready: True`.

For production SLURM deployments the auto-deploy path keeps recovery hands-off across short outages and head-job rotations.
