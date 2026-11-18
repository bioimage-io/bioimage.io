# Apps on an HPC (SLURM) worker

Load this when the worker you are deploying to runs `--mode slurm`. Everything in SKILL.md § 2 still applies; this file covers what *changes*, and corrects two pieces of § 2 advice that are wrong on an elastic cluster.

**How to tell.** `bioengine cluster status` reports the worker mode, and a SLURM worker's Ray nodes carry a `slurm_job_id:<id>` custom resource. If you did not set the worker up yourself, ask — the differences below are not cosmetic.

**Provenance of this page.** Every claim here is read out of the BioEngine worker source (`bioengine/cluster/slurm_workers.py`, `bioengine/apps/builder.py`, `bioengine/cluster/proxy_actor.py`) and cited to it. It has **not** been re-measured on a live SLURM cluster — treat the numbers as the defaults the code ships, and check your own site's flags before relying on one.

---

## The model in one paragraph

A SLURM worker's head runs on the login node and owns no compute. Every Ray **worker node** is a separate `sbatch` job running the BioEngine image under Apptainer, submitted on demand by the worker's own autoscaler when Ray reports pending resources, and cancelled when the node goes idle (`slurm_workers.py:571 _add_worker`, `:742 _check_scale_up`, `:678 _close_worker`). So the pool your app runs on is elastic, time-limited, and scheduled by somebody else's queue. Three of the four rules below fall straight out of that.

### The shipped defaults

From `SlurmWorkers.__init__` (`slurm_workers.py:42-62`). Each is overridable on the worker command line, and no site has to use these — but they are what you get if nobody chose:

| | default | flag | why an app author cares |
|---|---|---|---|
| job wall time | `4:00:00` | `--default-time-limit` | the hard stop on any single replica |
| GPUs per node | 1 | `--default-num-gpus` | one device per node, so one `-1` app per node |
| CPUs per node | 8 | `--default-num-cpus` | `num_cpus > 8` can never be scheduled |
| memory | 16 GB/CPU | `--default-mem-in-gb-per-cpu` | 128 GB per default node |
| min / max nodes | 0 / 4 | `--min-workers` / `--max-workers` | **zero** is a legal steady state |
| idle before reap | 300 s | `--scale-down-threshold-seconds` | see "what idle means" below |

---

## 1. Your replica's node has a wall clock, and it is not negotiable

Every submitted job carries `#SBATCH --time={time_limit}` (`slurm_workers.py:278`), default `4:00:00`. When SLURM reaches it the node is killed with whatever is running on it. Nothing in Ray, Ray Serve or BioEngine extends this, and no `max_ongoing_requests` or autoscaling setting changes it.

**So any unit of work that can outlive the allocation must be resumable.** A fine-tune that trains for six hours and writes its result at the end loses six hours and produces nothing. Write checkpoints to the shared workspace (§ 4 below), record enough state to resume, and treat "my node disappeared" as an expected event rather than an incident.

This is the single biggest behavioural difference from a Kubernetes or single-machine worker, where a replica lives until something stops it.

> A long-running call also has to survive the *RPC* for that long, which it generally will not. Long jobs belong behind a start/poll/stop API — `start_training` → `get_status` → `stop_training` — not behind one blocking method. [apps/cellpose-finetuning.md](../apps/cellpose-finetuning.md) is a worked example of that shape.

## 2. A deploy is a queue submission, so "still DEPLOYING" is not a diagnosis

With `--min-workers 0` the cluster can legitimately be running **no worker nodes at all**. The first GPU deploy then goes: your replica cannot be placed → Ray reports pending resources → the autoscaler submits an `sbatch` job (`_check_scale_up`, `slurm_workers.py:742`) → **the job waits in your site's SLURM queue** → the node joins → the replica is placed.

That middle step is unbounded and entirely outside BioEngine. On a busy partition it is minutes to hours.

> ### ⚠ Correction to § 2 "GPU apps"
>
> SKILL.md tells you to put a 3-minute wall-clock deadline on a GPU deploy loop and to read "still `DEPLOYING` at the deadline" as the diagnosis **over-requested VRAM**. **On a SLURM worker that inference is invalid.** Pending is the designed path here, not a symptom — the builder deliberately keeps a GPU replica pending so the autoscaler can provide a node for it (`builder.py:518-527`: *"An elastic cluster (SLURM) may have no GPU node at deploy time … Requesting VRAM up front keeps the replica pending until the autoscaler provides such a node"*).
>
> Distinguish the two before you conclude anything. Over-requested VRAM shows **no SLURM job moving**: `squeue -u $USER -n ray_worker` is empty or unchanged and `bioengine cluster status` shows no new node arriving. A normal cold start shows a `ray_worker` job in `PD` (pending) or `R` (running). Scale your deadline to the partition's queue time, and if you cannot see `squeue`, ask the worker's operator what it typically is rather than guessing 3 minutes.

Two further scale-up limits worth knowing: submissions are rate-limited to one per `--scale-up-cooldown-seconds` (default 60), and the pool is capped at `--max-workers` (default 4). An app whose autoscaling asks for more replicas than the node cap can supply will sit partly pending indefinitely, which again is not a failure state anything reports as one.

## 3. "Idle" means nothing is scheduled — so a live replica pins its node, and a `num_cpus=0` one does not

Scale-down reaps a node only when it is **completely** idle: `used_gpus == 0 and used_cpus == 0` (`_check_is_idle`, `slurm_workers.py:835-854`), where `used_*` is Ray's scheduler view, total minus available (`proxy_actor.py:615-622`). A Ray Serve replica holds its `num_cpus` reservation for its whole lifetime, busy or not.

Two consequences, and they point in opposite directions:

- **A deployed app is not scaled out from under you.** Any replica with `num_cpus >= 1` keeps `used_cpu > 0`, so its node never qualifies as idle and the 300-second timer never starts. What ends the replica is the wall clock in rule 1, not the autoscaler. Do not write defensive code against mid-call reaping; write it against the wall clock.
- **It also means your idle app holds an HPC allocation hostage.** One replica parked at `min_replicas: 1` keeps a GPU node — and its SLURM account charge — alive until the job's time limit, serving nothing. On a shared cluster that is the kind of thing that gets your account a phone call. Scale to zero when the app is genuinely request-driven, and stop test deployments rather than leaving them up (SKILL.md § "Cleaning up a test deployment").

## 4. The workspace is a shared filesystem, and cross-replica coordination depends on it

A SLURM worker's `--workspace-dir` must live on a filesystem readable from the compute nodes ([worker_onboarding.md](worker_onboarding.md) § 3b), and every job binds it (`#SBATCH --chdir={worker_workspace_dir}`, `slurm_workers.py:279`). That is what makes the common fine-tuning pattern work at all: a session directory on disk holding `status.json`, a stop marker, `train.log` and checkpoints, written by a runtime replica on one node and read by an entry replica on another.

Two things follow:

- **Keep that coordination in the workspace directory, not in `/tmp` and not in replica memory.** A replica's own scratch is node-local and dies with the sbatch job; process state dies with it too (rule 1).
- **Do not assume shared-ness holds everywhere.** BioEngine computes the filesystem topology internally and `clear_app_directory` returns it as `mode: "shared" | "per_node"` (SKILL.md § App-cache inspection), but **there is currently no way for an app to read that verdict at startup** — it is not in the deployment context or the replica environment. So an app that needs a shared FS must document the requirement rather than detect it. (A `BIOENGINE_FS_TOPOLOGY` environment variable has been proposed for exactly this and does not exist; do not code against it.)

---

## GPU sizing on an elastic cluster

`gpu_memory_mb` is translated into a Ray reservation at deploy time, and a SLURM worker takes a different branch from a static cluster (`AppBuilder._apply_gpu_memory`, `builder.py:476-543`).

Each SLURM worker job detects its own GPU's VRAM with `nvidia-smi` **inside the job** and advertises it as a custom `VRAM_MB` Ray resource (`slurm_workers.py:231-250`). When that resource is present, a replica books `VRAM_MB` plus a token `num_gpus = 0.01` handle (`_GPU_HANDLE_EPSILON`, `builder.py:97-101`) — the handle only binds a device and populates `CUDA_VISIBLE_DEVICES`; the VRAM reservation is what bounds packing.

Three things an app author should take from that:

- **VRAM detection is single-GPU only, and it can fail silently.** The block runs only when the job requested exactly one GPU, and if `nvidia-smi` is missing it logs *"Could not detect GPU VRAM; VRAM-based packing will be unavailable on this node"* and advertises nothing. Your measured `gpu_memory_mb` then falls back to a fraction of the smallest GPU, or — on a cluster with no GPU node up yet — still to the VRAM path. Either way the number you chose is not doing what you think unless `VRAM_MB` is actually advertised.
- **`used_gpu` is a useless occupancy signal here.** With epsilon handles, a GPU whose VRAM is fully booked reads as ~0.04/1.0 — the code says so in as many words (`proxy_actor.py:622-625`). Read `VRAM_MB` booked against `VRAM_MB` total instead.
- > ### ⚠ Correction to § 2 "GPU apps"
  >
  > SKILL.md's measurement procedure says to deploy once with `gpu_memory_mb=-1`, described as "whole device, **always schedulable on an idle GPU**". On a VRAM-packing cluster that is not true. `-1` books `num_gpus = 1.0` and explicitly bypasses VRAM packing (`builder.py:512-515`), so it needs a *full* 1.0 handle — and **one** epsilon replica on the device leaves 0.99, which means the `-1` deploy pends forever rather than failing. Before using `-1` to measure, confirm the target GPU has no epsilon replica resident; otherwise measure on a node you know is empty, or on a non-SLURM worker.
  >
  > The same arithmetic applies to your finished app: two `-1` deployments in one composition app need two whole devices before they serve a single request, and with one GPU per node that is two SLURM nodes.

---

## Smaller things that bite on HPC and nowhere else

- **`USER` / `LOGNAME` may be unset.** Already covered in SKILL.md § 2 Key rules — `torch._dynamo` calls `getpass.getuser()` at import and raises `KeyError: getpwuid(): uid not found`. The `os.environ.setdefault` fix there preserves the real identity under Apptainer, where it is usually populated, and only injects a placeholder when nothing exists. Keep it; it costs nothing and the failure is an import-time crash.
- **`runtime_env` builds land on the shared filesystem.** Every distinct `pip=[...]` set is a fresh virtualenv, built on an NFS-class mount, repeated per node that has not cached it. Pinning exact versions (already § 2 advice, for rebuild reasons) matters more here: a shared requirement set is the only thing that gets reused across apps.
- **No Docker on the compute nodes.** Workers run under Apptainer/Singularity, so nothing app-side may assume a Docker socket, and `--further-apptainer-args` is the only way extra host paths get bound into the replica. If your app needs a dataset directory that is not under the workspace dir, that is a worker-configuration request to the operator, not something the app can arrange.
- **Login-node policy applies to the head.** The head is coordination-only and is usually given `--head-num-gpus 0`. Do not expect to schedule anything on it, and do not write an app that assumes the entry deployment and a GPU runtime can land on the same node.

---

## Checklist before you deploy to a SLURM worker

1. Can one unit of work finish inside `--default-time-limit`? If not, checkpoint and resume.
2. Is the long-running work behind start/poll/stop rather than one blocking call?
3. Does `num_cpus` fit one node (default 8), and `memory_mb` fit `num_cpus × 16 GB`?
4. Is cross-replica state in the workspace directory, not `/tmp` and not process memory?
5. If GPU: does `gpu_memory_mb` reflect a real measurement, and have you checked whether `-1` can actually schedule?
6. Does your deploy loop's timeout account for SLURM queue time, or will it report a false diagnosis?
7. Will an idle replica hold a node — and is that acceptable to whoever pays for the allocation?
