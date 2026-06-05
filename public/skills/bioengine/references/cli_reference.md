# BioEngine CLI Reference

Two CLIs ship with this repo:

| CLI | Entry point | Audience |
|---|---|---|
| **`bioengine`** | `pip install "bioengine[cli] @ git+https://github.com/aicell-lab/bioengine.git"` (Python ≥3.11) | App authors and end users — deploy apps, call services, inspect clusters. |
| **`python -m bioengine.worker`** | Built into the published worker image `ghcr.io/aicell-lab/bioengine-worker:<version>` | Operators bringing up a worker process (Docker, SLURM, K8s). Documented in [§ `python -m bioengine.worker` — worker process](#python--m-bioengineworker--worker-process). |

This document covers both. Most agents only need the `bioengine` half; jump to the worker section when bringing up infrastructure.

## Prerequisites

```bash
export HYPHA_TOKEN=<your-token>
export BIOENGINE_WORKER_SERVICE_ID=bioimage-io/bioengine-worker  # for apps + cluster
export BIOENGINE_SERVER_URL=https://hypha.aicell.io               # optional, this is the default
```

---

## `bioengine call` — call any service method

```
Usage: bioengine call [OPTIONS] SERVICE_ID [METHOD]

Call any method on any deployed BioEngine service.

Arguments:
  SERVICE_ID   Hypha service ID, e.g. 'bioimage-io/model-runner' or 'my-workspace/my-app'
  METHOD       Method to call (omit with --list-methods)

Options:
  --args JSON          Arguments as a JSON object: '{"key": "val", "n": 10}'
  --arg KEY=VALUE      Individual argument (auto-typed: int/float/bool/str). Repeat for multiple.
  --list-methods       List available methods without calling one
  --json               Output as JSON (auto-enabled when stdout is not a TTY)
  --token TOKEN        Auth token (or HYPHA_TOKEN env var)
```

**Examples:**
```bash
# Discover methods
bioengine call bioimage-io/model-runner --list-methods

# Call with no arguments
bioengine call bioimage-io/model-runner ping --json

# Call with JSON arguments (recommended for AI agents)
bioengine call bioimage-io/model-runner search --args '{"keywords": ["nucleus"], "limit": 5}' --json

# Call with individual --arg flags (auto-typed)
bioengine call bioimage-io/my-app process --arg text=hello --arg max_length=100 --json

# Mix --args base with --arg overrides
bioengine call bioimage-io/my-app run --args '{"mode": "fast"}' --arg debug=true --json
```

**Argument auto-typing with `--arg`:**
- `"true"` / `"false"` → `bool`
- Digits only → `int`
- Digits with decimal → `float`
- Else → `str`
- For lists/dicts use `--args '{"key": [1,2,3]}'` instead

---

## `bioengine apps` — deploy and manage applications

### `bioengine apps deploy`

```
Usage: bioengine apps deploy [OPTIONS] APP_DIR

Upload and immediately deploy a local BioEngine app directory.

Arguments:
  APP_DIR   Directory with manifest.yaml and deployment .py file(s)

Options:
  --app-id ID          Stable instance ID (pass same ID to update in-place; default: auto-generated)
  --no-gpu             Disable GPU even if worker has GPUs
  --env KEY=VALUE      Environment variable (repeat for multiple; prefix with _ for secrets)
  --hypha-token TOKEN  Token injected as HYPHA_TOKEN inside the Ray actor.
                       Required for apps that connect back to Hypha.
                       Defaults to --token / HYPHA_TOKEN env var.
                       Pass --hypha-token '' to deploy without a token.
  --worker SERVICE     Worker service ID (or BIOENGINE_WORKER_SERVICE_ID)
  --token TOKEN        Auth token (or HYPHA_TOKEN)
```

> **Important**: `--env HYPHA_TOKEN=...` is silently ignored — always use `--hypha-token` to inject the token.

```bash
bioengine apps deploy ./my-app/
bioengine apps deploy ./my-app/ --app-id my-app   # stable ID — enables in-place updates
bioengine apps deploy ./my-app/ --no-gpu --env _API_KEY=secret
bioengine apps deploy ./my-app/ --app-id my-app --hypha-token $HYPHA_TOKEN
```

### `bioengine apps upload`

```
Usage: bioengine apps upload [OPTIONS] APP_DIR

Upload app files to Hypha artifact storage (without deploying).
Prints the artifact ID on success — pass it to `bioengine apps run`.
```

### `bioengine apps run`

```
Usage: bioengine apps run [OPTIONS] ARTIFACT_ID

Deploy a BioEngine application from artifact storage.

Options:
  --app-id ID          Instance ID (pass same ID to update in-place)
  --version VER        Specific artifact version (default: latest)
  --no-gpu             Disable GPU
  --env KEY=VALUE      Environment variable (repeat for multiple)
  --hypha-token TOKEN  Token injected as HYPHA_TOKEN inside the Ray actor.
                       Required for apps that connect back to Hypha.
                       Defaults to --token / HYPHA_TOKEN env var.
                       Pass --hypha-token '' to deploy without a token.
```

> **Important**: `--env HYPHA_TOKEN=...` is silently ignored — always use `--hypha-token` to inject the token.

```bash
bioengine apps run bioimage-io/my-app
bioengine apps run bioimage-io/my-app --app-id production --version 1.2.0
bioengine apps run bioimage-io/my-app --hypha-token $HYPHA_TOKEN
```

### `bioengine apps list`

```
Usage: bioengine apps list [OPTIONS]
Options: --json
```

### `bioengine apps status`

```
Usage: bioengine apps status [OPTIONS] [APP_ID...]

Arguments:
  APP_ID...   One or more app IDs (default: all running apps)

Options:
  --logs N   Log lines per replica [default: 30]
  --json
```

### `bioengine apps logs`

```
Usage: bioengine apps logs [OPTIONS] APP_ID
Options: -n/--tail N [default: 100], --json
```

### `bioengine apps stop`

```
Usage: bioengine apps stop [OPTIONS] APP_ID
Options: -y/--yes (skip confirmation)
```

**Note:** `stop` removes the running deployment; does NOT delete the artifact from storage.

---

## `bioengine cluster` — inspect cluster resources

### `bioengine cluster status`

```
Usage: bioengine cluster status [OPTIONS]

Show GPU and CPU usage across the Ray cluster.

Options:
  --json     Output as JSON
  --worker   Worker service ID (or BIOENGINE_WORKER_SERVICE_ID)
  --token    Auth token
```

```bash
bioengine cluster status
bioengine cluster status --json
```

**JSON output fields:**
```json
{
  "cluster": {"total_cpu": 46, "used_cpu": 8, "total_gpu": 4, "used_gpu": 2},
  "nodes": {
    "<node-id>": {
      "node_ip": "10.42.23.40", "head": false,
      "total_cpu": 10, "used_cpu": 1,
      "total_gpu": 1, "used_gpu": 0.5,
      "total_gpu_memory": 17179869184, "used_gpu_memory": 964689920,
      "accelerator_type": "A40"
    }
  }
}
```

---

## Environment variables

| Variable | Description |
|---|---|
| `BIOENGINE_WORKER_SERVICE_ID` | Worker service ID (required for `apps` and `cluster` commands) |
| `HYPHA_TOKEN` or `BIOENGINE_TOKEN` | Auth token |
| `BIOENGINE_SERVER_URL` | Hypha server URL (default: `https://hypha.aicell.io`) |

---

## Secret environment variables

Prefix env var names with `_` to mark as secret (hidden from status output; the underscore is stripped inside the deployment):

```bash
bioengine apps deploy ./my-app/ --env _API_KEY=secret
# Inside deployment: os.environ["API_KEY"]
```

---

## File encoding

- Text files (`.py`, `.yaml`, `.md`): uploaded as UTF-8 text
- Binary files: uploaded as base64
- `__pycache__` directories are excluded automatically

---

## `python -m bioengine.worker` — worker process

The worker is launched as a Python module inside the published worker image (`ghcr.io/aicell-lab/bioengine-worker:<version>`). For SLURM, the launcher script `scripts/start_hpc_worker.sh` wraps this same invocation (see [worker_onboarding.md § 3b](worker_onboarding.md#3b-slurm)); every flag below is forwarded straight through, except for two launcher-only flags noted below.

```
Usage: python -m bioengine.worker --mode {single-machine,slurm,external-cluster} [OPTIONS]
```

Live `--help` (mirrors this section but stays in sync with the image):

```bash
docker run --rm ghcr.io/aicell-lab/bioengine-worker:<version> python -m bioengine.worker --help
```

### Core options

| Flag | Required | Description |
|---|:--:|---|
| `--mode {single-machine,slurm,external-cluster}` | ✓ | Deployment mode. |
| `--admin-users EMAIL [EMAIL …]` |  | Users with admin access to the worker. Defaults to the authenticated JWT user. |
| `--workspace-dir PATH` |  | Worker workspace (Ray data, logs, app workdir, auto-detected dataset-server socket). Mounted into the container at `/.bioengine` in single-machine mode; bound to `${HOME}/.bioengine` in SLURM mode. |
| `--ray-workspace-dir PATH` |  | External-cluster only — workspace path on the remote Ray cluster (when it differs from the local one). |
| `--startup-applications JSON [JSON …]` |  | Apps to auto-deploy at startup. Each value is a single JSON object string, e.g. `'{"artifact_id": "bioimage-io/model-runner", "application_id": "model-runner"}'`. Repeat the flag for multiple apps. Re-applied on every worker restart, so it is the production way to make Ray Serve deployments survive restarts. |
| `--monitoring-interval-seconds N` |  | Health-check cadence. |
| `--dashboard-url URL` |  | Base URL of the BioEngine dashboard registered with Hypha (shown in the worker's service metadata). |
| `--worker-name NAME` |  | Display name for the Hypha service. Default `BioEngine Worker`. |
| `--log-file PATH` |  | Log file path. `off` → console only. Default: `<workspace_dir>/logs/<timestamp>.log`. |
| `--debug` |  | Enable DEBUG-level logging. |
| `--graceful-shutdown-timeout SECONDS` |  | Timeout for graceful shutdown. |

### Hypha options

| Flag | Description |
|---|---|
| `--server-url URL` | Hypha server. Default `https://hypha.aicell.io`. |
| `--workspace NAME` | Workspace to register in. Default: workspace encoded in the JWT (auto-detected). |
| `--token TOKEN` | Hypha token. Falls back to `$HYPHA_TOKEN`. Must be an **admin** token (the worker mints scoped tokens for app replicas). |
| `--client-id ID` | Stable Hypha client_id. **Strongly recommended for any persistent deployment** — without it, the service ID changes every restart and dashboards / saved URLs break. |

### Ray Cluster options

| Flag | Default | Description |
|---|---|---|
| `--head-node-address ADDRESS` | first system IP | Head-node IP. In `external-cluster` mode this is the cluster head's address. |
| `--head-node-port PORT` | Ray default | Ray head + GCS port. |
| `--node-manager-port PORT` | Ray default | Ray node-manager port. |
| `--object-manager-port PORT` | Ray default | Ray object-manager port. |
| `--redis-shard-port PORT` | Ray default | Ray internal Redis port. |
| `--serve-port PORT` | Ray default | Ray Serve HTTP port. |
| `--dashboard-port PORT` | Ray default | Ray dashboard port. |
| `--client-server-port PORT` | Ray default | Ray Client server port (used by `external-cluster`). |
| `--redis-password PASSWORD` | random | Ray cluster Redis password. |
| `--head-num-cpus N` | autodetect | CPUs the head reports. Set to `0` for coordination-only (recommended on SLURM login nodes). |
| `--head-num-gpus N` | `0` | GPUs the head reports. Single-machine: set to your GPU count. SLURM: keep `0`. |
| `--head-memory-in-gb GB` | autodetect | Head memory advertised to Ray. |
| `--runtime-env-pip-cache-size-gb GB` | Ray default | Ray runtime_env pip cache cap. Bigger cache = faster re-deploys. |
| `--no-ray-cleanup` |  | Skip clean-up of previous Ray cluster processes/data. Use with caution. |

### SLURM Job options (mode = `slurm`)

| Flag | Default | Description |
|---|---|---|
| `--image IMAGE` | image baked into the launcher | Container image used for Ray-worker `sbatch` jobs. Accepts `docker://...`, a local `.sif`, or an apptainer sandbox dir. |
| `--worker-workspace-dir PATH` | `--workspace-dir` | Workspace path bound inside each worker job's container. Required when the launch-side `--workspace-dir` is a local realpath that differs from the compute-node mount point. |
| `--default-num-gpus N` |  | GPUs per Ray-worker sbatch job. Override per-deployment via the artifact's `ray_actor_options.num_gpus`. |
| `--default-num-cpus N` |  | CPUs per Ray-worker sbatch job. |
| `--default-mem-in-gb-per-cpu GB` |  | Memory per CPU. Total job memory = `num_cpus × mem_per_cpu`. |
| `--default-time-limit HH:MM:SS` |  | Wall time per sbatch job. |
| `--further-slurm-args "STR"` |  | **Single quoted string** of extra sbatch directives, e.g. `"-A <project> -C thin -p gpu --qos=high"`. Re-tokenised with `shlex.split`. Use this for account, partition, qos, constraints. |
| `--gpu-slurm-flag '--gres=gpu:{n}'` | `--gpus={n}` | Template for the GPU sbatch directive (`{n}` is replaced with the GPU count). Default works on Berzelius and generic clusters; switch to `--gres=gpu:{n}` for clusters that require gres. Empty string omits the directive (use when GPUs are requested via `--further-slurm-args`). |
| `--further-apptainer-args "STR"` |  | Extra `apptainer exec` flags inside the worker job, e.g. `"--bind /proj/<lab>:/proj/<lab>"`. Re-tokenised with `shlex.split`. |

### Ray Autoscaler options

| Flag | Description |
|---|---|
| `--min-workers N` | Floor on Ray-worker nodes. `0` keeps the cluster idle until a deploy_app request comes in. |
| `--max-workers N` | Ceiling on Ray-worker nodes. Prevents runaway scaling. |
| `--scale-up-cooldown-seconds SECONDS` | Cooldown between scale-up actions. |
| `--scale-down-check-interval-seconds SECONDS` | Interval between scale-down checks. |
| `--scale-down-threshold-seconds SECONDS` | Idle time before a worker node is scaled down. |

### Launcher-only flags (SLURM `start_hpc_worker.sh`)

These are **not** worker-process flags — they are consumed by the bash launcher and stripped before the args are forwarded to `python -m bioengine.worker`:

| Flag | Purpose |
|---|---|
| `--sandbox` | Build (or reuse) an apptainer sandbox dir from the docker reference and use it as the image. Required on most RHEL-8 / Rocky-8 HPC systems where `yama.ptrace_scope=2` breaks the default `apptainer build` SIF path. First build is ~10 min and ~10 GB; cached under `<workspace-dir>/images/`. |
| `--apptainer-cachedir PATH` / `--singularity-cachedir PATH` | Override the apptainer/singularity cache location (default `<workspace-dir>/images/`). Useful when scratch is faster than the workspace dir. Both flags are stripped from the args forwarded to the Python worker. |

### Examples

```bash
# Single-machine, 1 GPU (Docker)
python -m bioengine.worker \
    --mode single-machine \
    --head-num-cpus 4 \
    --head-num-gpus 1 \
    --client-id bioengine-worker-lab

# SLURM head (typically wrapped by start_hpc_worker.sh + sbatch)
python -m bioengine.worker \
    --mode slurm \
    --workspace-dir /home/me/.bioengine \
    --client-id bioengine-worker-berzelius \
    --head-num-cpus 4 --head-num-gpus 0 --head-memory-in-gb 16 \
    --default-num-gpus 1 --default-num-cpus 8 --default-mem-in-gb-per-cpu 8 \
    --default-time-limit 04:00:00 \
    --min-workers 0 --max-workers 4 --scale-down-threshold-seconds 300 \
    --further-slurm-args "-A naiss-2024-99-999 -C thin"

# External Ray cluster (KubeRay)
python -m bioengine.worker \
    --mode external-cluster \
    --head-node-address 10.0.0.100 \
    --client-server-port 10001 \
    --client-id bioengine-worker-k8s
```
