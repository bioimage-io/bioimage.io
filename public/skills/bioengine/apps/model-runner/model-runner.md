# BioEngine Model Runner

Inference and discovery service for [BioImage.IO Model Zoo](https://bioimage.io) models. Runs on remote BioEngine workers — no local GPU required.

> **One runner serves every model, Cellpose-3 included.** From **model-runner 2.11.2** this runner loads Cellpose-3-and-earlier architectures from a separate internal environment, alongside Cellpose-4 (Cellpose-SAM / Cellpose-DINO) and micro-SAM. `bioimage-io/model-runner` is the only service id you need; there is no separate runner to resolve ids against.
>
> On **older workers** (before 2.11.2) this runner's runtime shipped Cellpose 4 only and rejected Cellpose-3 models, which were served by a separate `cellpose3-runner` app. Workers are pinned and roll independently, so check the worker's deployed version before assuming which behaviour you get.
>
> **A grayscale image is refused by Cellpose-SAM — replicate the channel before sending.** Cellpose-4 / Cellpose-SAM declares its channel axis as `min=3, max=3`, so a single-channel array is rejected before inference starts, at any image size. A large share of real microscopy is single-channel, so this is the most common input failure, and it is a *different* axis from the size gotcha below — the size can be perfectly fine. Fix it on your side, because the runner will not reshape your array for you:
>
> ```python
> # arr is (y, x) or (1, 1, y, x) grayscale; Cellpose-SAM wants 3 channels
> import numpy as np
> arr = np.atleast_3d(arr)                      # -> (y, x, 1) if it was 2-D
> rgb = np.repeat(arr, 3, axis=-1)              # -> (y, x, 3)
> ```
>
> That replication is a deliberate choice you are making about your data, which is why the runner does not do it silently: it returns segmentations people treat as measurements, and a caller who sent one channel because their data IS one channel would otherwise get a plausible result computed on an array they never supplied. From the version carrying that fix the error names the axis, the required count and this remedy instead of reprinting bioimageio's raw `AxisInfo` objects.
>
> Cellpose-3 models declare large minimum input sizes. Sending a smaller array fails with an axis-size error before inference starts, which looks like a loading failure but is not: `famous-fish` needs at least 565x807, `happy-elephant` 1024x1024, `merry-gorilla` 1440x1920, `thoughtful-chipmunk` 1680x1475.

## Use this skill when

- The user wants to run a known BioImage.IO model on an image.
- The user wants to find candidate models for a task (e.g. nuclei segmentation, denoising).
- The user wants to compare multiple models against ground truth.
- The user wants to validate a model RDF or run BioImage.IO compliance tests.

## Contributing a model to the Zoo?

This skill is for **calling** an already-deployed model-runner to run existing BioImage.IO models. To **package and submit a new model** to the Zoo (RDF creation, weight-format conversion, static + dynamic validation, submission workflow, and the fixed runtime environment your architecture code will run against), load the [`bioimageio-models`](https://bioimage.io/skills/bioimageio-models/SKILL.md) skill instead.

## Setup

Install the CLI (Python ≥ 3.11):

```bash
pip install "bioengine[cli] @ git+https://github.com/aicell-lab/bioengine.git"
```

## Service ID — discover before calling

The model-runner is deployed on one or more BioEngine workers in the `bioimage-io` workspace. **Don't try to call `bioimage-io/model-runner` directly** — that short form is the WebRTC offer proxy and exposes only `{offer}`, not the model-runner methods. The callable service ID is the per-worker per-replica form:

```
bioimage-io/bioengine-worker-<site>-<hash>-<replica>:model-runner
```

Find the concrete ID via the worker:

```python
from hypha_rpc import connect_to_server
# NO "workspace" key. A token minted without `&workspace=` is bound to your own
# workspace and connecting as bioimage-io is refused; reach its services by exact id.
s = await connect_to_server({"server_url": "https://hypha.aicell.io", "token": token})

# 1. Pick a worker (KTH and deNBI both run model-runner today). Do NOT use
#    `list_services` in a script: it hangs against a busy workspace, with no upper
#    bound, and a hung script looks exactly like a dead worker. `worker_service_id()`
#    is the ready-to-paste HTTP helper in
#    references/service_ids.md § "Step 1's helper: resolve the worker over HTTP, never by RPC listing".
#    It also refuses rather than guessing when your match hits both sites.
worker_sid = worker_service_id("bioimage-io", "bioengine-worker-kth")   # or "...-denbi"

# 2. Get the concrete app service ID from the worker:
worker = await s.get_service(worker_sid)
status = await worker.get_app_status(None)
mr_sid = status["model-runner"]["service_ids"]["websocket_service_id"]
#   → "bioimage-io/bioengine-worker-kth-<hash>-<replica>:model-runner"

# 3. Get the actual model-runner service:
mr = await s.get_service(mr_sid)
```

Throughout this skill, references to the **CLI form `bioengine call bioimage-io/model-runner <method>`** are shorthand for the resolved concrete ID. In practice you need to first set `BIOENGINE_WORKER_SERVICE_ID=<concrete-worker-id>` and pass the per-replica service ID to `bioengine call`. The Python `mr` handle above is the more direct path.

If the user has their own worker, the same recipe applies — substitute their workspace and worker client_id.

## CLI reference

The `bioengine call` command is the generic interface for calling any service method. Model-runner specific operations map to service methods called via `bioengine call`:

| Operation | Command |
|---|---|
| Search models | `bioengine call bioimage-io/model-runner search_models --args '{"keywords": [...], "limit": 10}' --json` |
| Model metadata/RDF | `bioengine call bioimage-io/model-runner get_model_rdf --args '{"model_id": "<id>"}' --json` |
| Model documentation | `bioengine call bioimage-io/model-runner get_model_documentation --args '{"model_id": "<id>"}' --json` |
| Validate RDF | `bioengine call bioimage-io/model-runner validate --args '{"rdf_dict": {...}}' --json` (takes the parsed RDF dict, **not** a `model_id`) |
| Test model (submit) | `bioengine call bioimage-io/model-runner test --args '{"model_id": "<id>"}' --json` → returns a `test_run_id` |
| Test status (poll) | `bioengine call bioimage-io/model-runner get_test_status --args '{"test_run_id": "<id>"}' --json` |
| Run inference (submit) | `bioengine call <ws>/<worker_client_id>-<replica_id>:model-runner infer --args '{"model_id": "<id>", "inputs": "<url>"}' --json` → returns a `request_id` |
| Infer status (poll) | `bioengine call <...>:model-runner get_infer_status --args '{"request_id": "<id>"}' --json` |
| List methods | `bioengine call bioimage-io/model-runner --list-methods` |

All commands accept `--json` for machine-parseable output.

> **`infer()` and `test()` are asynchronous.** Each returns a **job id** immediately, not a result. Poll `get_infer_status(request_id=...)` / `get_test_status(test_run_id=...)` until the job is terminal (`completed_at` set, or `state` in `{completed, failed, cancelled}`); the `result` field then holds the inference dict / test report, or `{"error": "..."}` on failure. The `bioengine call` CLI does **not** poll for you — do it in a loop, or use the Python helpers in [§ Async job API](#async-job-api--infer-and-test-return-job-ids) below.

## Async job API — `infer()` and `test()` return job ids

Both `infer()` and `test()` are **submit-and-poll**. Calling them enqueues a background job on the worker and returns a short id string right away; you then poll a status method until the job is terminal and read its `result`. This keeps the GPU free while requests queue and lets large downloads happen off the RPC call.

The shared status shape (same for infer and test):

```python
{
  "state":        str,          # queued | model_download | env_setup | running | completed | failed | cancelled
  "submitted_at": float,        # unix ts when queued
  "completed_at": float | None, # ts finished; None until terminal
  "result":       dict | None,  # inference dict / test report on success,
                                # {"error": "..."} on failure, None until done
  "stages": {                   # per-stage timeline AND the queue position
    "model_download": {"start": float | None, "end": float | None},
    "env_setup":      {"start": float | None, "end": float | None,
                       "queue_position": int | None},   # custom-env test runs only
    "run":            {"start": float | None, "end": float | None,
                       "queue_position": int | None},   # shared test+infer GPU queue
  },
}
```

**The stage timestamps and the queue position are inside `stages`.** There is no top-level
`queue_position`, `model_download`, `env_setup` or `running`: a loop that reads those gets `None`
or a `KeyError`. Terminal is `completed_at is not None`, or equivalently `state` in
`{completed, failed, cancelled}`.

Job registries are **in-memory per Entry replica** and expire after completion (infer ~1 h, test ~24 h). A job id is only known to the replica that created it, and is lost on replica restart — poll it through to completion rather than stashing the id for later.

Two blocking helpers used throughout this skill. `mr` is the resolved model-runner handle (see [Service ID](#service-id--discover-before-calling)):

⚠️ **Poll every 10 seconds or slower, and do not shorten it.** Measured on the live KTH app, 20
concurrent clients for 240 s: at a 3-second interval **36-40% of calls were rejected** with
`has reached its maximum of N concurrent requests`; at 10 seconds, **none were**, and the same number
of jobs completed (395 against 374). End-to-end p50 barely moved, 10.9 s → 12.0 s.

The reason is not that polling is expensive — it is cheap. A `get_infer_status` call occupies an
admission slot for only **~19 ms**, so even 90 clients polling once a second use under a fifth of the
limit. What a tight poll actually does is **pace you**: noticing completion sooner makes you submit
sooner, and a *submit* holds its slot for **0.74-2.8 s** — two orders of magnitude longer. At the
3-second interval those 20 clients issued 618 requests instead of 374 and the concurrent submissions
saturated admission; the extra 244 requests produced no extra results, only errors. Polling harder
does not get your result sooner. It starts your next job sooner, and crowds out somebody else's for
no additional completed work.

So treat 10 s as a floor, not a target, and if you want a faster first answer back off
(2 s, then 5 s, then 10 s) rather than holding a tight constant. Note also that this is not a
capacity knob: at 50 clients, 26% were rejected even at a 10-second interval while completed
throughput stayed flat (368 against 374 at 20 clients), so beyond a certain load the service is
limited downstream of admission and politeness is the only thing that still helps.

⚠️ **CHECK THE SHAPE YOU GET BACK. Do not assume an oversized input was tiled.** Whether a replica
tiles an input larger than the model's declared size, or quietly runs one block and returns that,
**differs between live replicas**. Measured on 2026-11-26, same model (`territorial-cricket`,
declared `y=256, x=256`), same call, same day, one input of 768x1024:

| replica | returned |
|---|---|
| `…-5867665999-vsrtp-…:model-runner` | `(1, 1, 768, 1024)`, tiled internally |
| `…-9c4c8d75c-x24hj-…:model-runner` (after a pod roll) | `(1, 1, 256, 256)`, one block, **no warning** |

The second case is the dangerous one, because nothing about it looks wrong: the array is
well-formed, the job reports success, and a caller measuring an object count or an area fraction
then measures a 256x256 CROP of its own image and reports it as the whole. In the run that found
this, it surfaced only because an overlay step indexed a 768-row image with a 256-row mask and
raised `IndexError`.

So, whatever the model declares:

```python
# run_infer returns the output DICT, so index the output key before touching .shape.
rdf = await mr.get_model_rdf(model_id=model_id)
out_key = rdf["outputs"][0].get("id") or rdf["outputs"][0].get("name")

result = await run_infer(mr, model_id, url)     # or your own submit+poll
prob = np.asarray(result[out_key])
if prob.shape[-2:] != image.shape[-2:]:
    raise RuntimeError(f"model returned {prob.shape[-2:]} for an input of {image.shape[-2:]}")
```

and when the RDF declares a FIXED input size, tile client-side rather than relying on the server
to do it. A failed assertion costs one run; a silently cropped measurement is wrong and looks fine.

⚠️ **Ask for `return_download_url=True`, and bound every status call.** When an oversized input IS
tiled server-side, the assembled multi-tile array **fails to marshal back to the caller** — the
`get_infer_status` call then never returns, so a client without a per-call timeout waits for ever
rather than seeing an error. Asking for a download URL avoids the marshalling entirely. Measured on
the live KTH app with Cellpose-SAM, same model and upload path:

| input | inline result | `return_download_url=True` |
|---|---|---|
| 256x256 (native) | completed ~3 s | completed 4.6 s |
| 320x320 | never returns | **completed 4.3 s** |
| 512x512 | never returns | **completed 5.0 s** |
| 640x480 | never returns | **completed 4.6 s** |
| 192x192 | server-side failure | server-side failure (smaller than one tile; a separate defect) |

In a 100-client run with mixed sizes, 27 of 100 completed on the inline path; with the download URL
the same shapes complete, which is why the helper below asks for it by default and fetches the array
for you.

```python
import asyncio, io, random, time, urllib.request
import numpy as np

async def run_infer(mr, model_id, inputs, *, poll=10.0, timeout=300,
                    status_timeout=180, return_download_url=True, **kwargs):
    """Submit an inference job and block until the result dict is ready.

    ``return_download_url=True`` is the default deliberately — see the warning below.
    Extra kwargs (weights_format, device, ...) pass through."""
    request_id = await mr.infer(model_id=model_id, inputs=inputs,
                                return_download_url=return_download_url, **kwargs)
    deadline = time.monotonic() + timeout
    while True:
        # wait_for is NOT optional: for some inputs the status call does not return at all,
        # and without a per-call bound the client waits for ever rather than erroring.
        #
        # But do NOT make that bound tight. The FIRST poll after the job finishes is the one
        # that materialises the result: the app reads the output arrays off its shared storage
        # and mints a presigned URL per output before answering. That poll therefore takes
        # time proportional to the output, and a short cap aborts exactly the call that was
        # about to hand you the answer. 180 s is a bound against a hang, not a latency budget.
        st = await asyncio.wait_for(mr.get_infer_status(request_id=request_id),
                                    timeout=status_timeout)
        if st["completed_at"] is not None:        # or st["state"] in {completed, failed, cancelled}
            result = st["result"]
            if isinstance(result, dict) and "error" in result:
                raise RuntimeError(f"inference failed: {result['error']}")
            if return_download_url:
                # Each value is a presigned .npy URL rather than an inline array.
                #
                # Offloading matters in app code: urlopen is blocking, and awaiting it
                # directly inside a Ray Serve replica stalls that replica's event loop for
                # the whole download, so every other caller it is serving waits too.
                # run_in_executor rather than asyncio.to_thread, which needs Python 3.9 and
                # raises AttributeError on 3.8.
                def fetch(url):
                    # http.client, which urllib.request uses, sends
                    # `Accept-Encoding: identity`, so the body arrives uncompressed and
                    # np.load can read it straight (the header is in http.client's
                    # putrequest, not in urllib, if you go looking). A client that OFFERS gzip
                    # must also decompress: requests and aiohttp do, a plain curl does not
                    # (see the curl section below).
                    with urllib.request.urlopen(url) as r:
                        return np.load(io.BytesIO(r.read()), allow_pickle=False)
                loop = asyncio.get_event_loop()
                return {k: (await loop.run_in_executor(None, fetch, v)) if isinstance(v, str) else v
                        for k, v in result.items()}
            return result
        if time.monotonic() > deadline:
            raise TimeoutError(f"infer {request_id} timed out after {timeout}s")
        # jittered so that N clients starting together do not all poll on the same tick
        await asyncio.sleep(poll * random.uniform(0.8, 1.2))

async def run_test(mr, model_id, *, poll=10.0, timeout=600, **kwargs):
    """Submit a test job and block until the report is ready.
    Extra kwargs: stage, cache, custom_environment."""
    test_run_id = await mr.test(model_id=model_id, **kwargs)
    deadline = time.monotonic() + timeout
    while True:
        st = await mr.get_test_status(test_run_id=test_run_id)
        if st["completed_at"] is not None:
            report = st["result"]
            if isinstance(report, dict) and "error" in report:
                raise RuntimeError(f"test failed: {report['error']}")
            return report
        if time.monotonic() > deadline:
            raise TimeoutError(f"test {test_run_id} timed out after {timeout}s")
        await asyncio.sleep(poll * random.uniform(0.8, 1.2))
```

Everywhere below, `await run_infer(mr, model_id, inputs)` returns the output dict directly — it is the submit-and-poll wrapper, not a raw `mr.infer` (which returns only the id).

## Default operating mode

- Use the CLI for all operations — it handles upload, RPC connection, and download automatically.
- Input formats: `.npy` (lossless, preferred), `.tif`/`.tiff`, `.png`.
- Output format: `.npy` by default; `.tif` if output path ends in `.tif`.
- Default to models that pass BioImage.IO checks (omit `--ignore-checks` unless necessary).
- **Output keys vary by model** — read `outputs[0].id` from the RDF (`get_model_rdf`), not assume `"output0"`.
- **Search keywords**: AND-matched against model tags. If a keyword like `"denoising"` returns few results, try synonyms: `"restoration"`, `"noise"`. Use `assets/search_keywords.yaml` for known working presets.
- **RDF objects**: `get_model_rdf` via RPC returns `ObjectProxy` (not plain dict). JSON-serialize with `json.dumps(rdf, default=str)` if needed.

## Single model inference workflow

```text
- [ ] Step 1: Search for models — call search_models(keywords=[...])
- [ ] Step 2: Inspect the best candidate — call get_model_rdf(model_id)
- [ ] Step 3: Read model documentation — get_model_documentation(model_id) — verify domain compatibility
- [ ] Step 4: Run inference — submit infer(model_id, inputs), then poll get_infer_status
- [ ] Step 5: Validate output — load result array with numpy, check shape and values
```

There is no `bioengine runner` command group — everything is `bioengine call <svc> <method>`. Inference is asynchronous: `infer` returns a `request_id`, then you poll `get_infer_status`.

```bash
# Full example (CLI form — assumes BIOENGINE_WORKER_SERVICE_ID is set
# to a concrete worker like bioimage-io/bioengine-worker-kth-<hash>:bioengine-worker):
bioengine call <model-runner-concrete-svc-id> search_models \
    --args '{"keywords": ["nuclei", "segmentation"], "limit": 5}' --json
bioengine call <model-runner-concrete-svc-id> get_model_rdf \
    --args '{"model_id": "affable-shark"}' --json

# Inference: submit → get a request_id → poll until completed_at is set.
REQ=$(bioengine call <model-runner-concrete-svc-id> infer \
    --args '{"model_id": "affable-shark", "inputs": "<url>"}' --json)
bioengine call <model-runner-concrete-svc-id> get_infer_status \
    --args "{\"request_id\": $REQ}" --json     # repeat until "result" is populated
```

In Python, the `run_infer` helper above wraps this submit-and-poll loop.

### Direct Python — the actual API

Submit-and-poll `infer()` is the API — use the `run_infer` helper from [§ Async job API](#async-job-api--infer-and-test-return-job-ids). There is no `scripts/utils.py` helper module — you import `numpy` / `httpx` / `tifffile` etc. and write the small amount of tensor-prep glue yourself.

```python
from hypha_rpc import connect_to_server
import asyncio, time, httpx, numpy as np, io

# 1. Resolve the concrete model-runner service ID (see "Service ID — discover before calling" above)
# NO "workspace" key, for the same reason as above.
s = await connect_to_server({"server_url": "https://hypha.aicell.io", "token": token})
# worker_service_id() resolves over HTTP instead of enumerating by RPC, because
# `list_services` hangs against a busy workspace — see references/service_ids.md.
worker = await s.get_service(worker_service_id("bioimage-io", "bioengine-worker-kth"))
mr_sid = (await worker.get_app_status(None))["model-runner"]["service_ids"]["websocket_service_id"]
mr = await s.get_service(mr_sid)

# 2. (Optional) inspect the RDF — returns an ObjectProxy, json.dumps with default=str if you want to print it.
rdf = await mr.get_model_rdf(model_id="affable-shark")
input_axes = rdf["inputs"][0].get("axes", "bcyx")   # e.g. "bcyx" (RDF 0.4.x) or [{name:"b"},...] (0.5.x)
output_key = rdf["outputs"][0].get("id") or rdf["outputs"][0].get("name")

# 3. Run inference via run_infer (submit + poll get_infer_status; see § Async job API).
#    `inputs` accepts an HTTPS URL OR a serialised tensor. For models with bundled
#    test inputs, the URL pattern is:
#      https://hypha.aicell.io/<workspace>/artifacts/<model-alias>/files/<relative-source>
#    where <relative-source> is what `rdf.inputs[0].test_tensor.source` returns.
test_url = f"https://hypha.aicell.io/bioimage-io/artifacts/affable-shark/files/test_input_0.npy"
result = await run_infer(mr, "affable-shark", test_url)   # returns the output dict
output_array = np.asarray(result[output_key])              # output_key is e.g. "output0"

#    A bare `await mr.infer(...)` instead returns only the request_id string —
#    you would then have to poll get_infer_status yourself.

# 4. (Optional) percentile-normalise / reshape your own input array before sending.
#    A tiny inline helper is usually enough — there is no library to import.
def normalize_percentile(img, pmin=1.0, pmax=99.8):
    lo, hi = np.percentile(img, [pmin, pmax])
    return ((img.clip(lo, hi) - lo) / max(hi - lo, 1e-8)).astype(np.float32)
```

**Output keys vary by model** — read `outputs[0].id` (RDF 0.5.x) or `outputs[0].name` (RDF 0.4.x), don't assume `"output0"`. On shape errors: inspect the RDF, reshape to match `inputs[0].axes`, then retry before discarding the model.

## Model screening / comparison workflow

> **No ground truth yet?** For segmentation screening, the user can annotate their own images in the bioimage.io annotation interface and those annotations become the screening ground truth — see [references/annotation_screening.md](../../references/annotation_screening.md) for the full loop (create private dataset, user annotates, read the label masks back).

```text
- [ ] Step 1: Clarify task type (segmentation / denoising / restoration / detection)
- [ ] Step 2: Gather candidates from search_models (keywords from assets/search_keywords.yaml); see § Candidate pool
- [ ] Step 3: For each candidate — call get_model_documentation to read the README
- [ ] Step 4: Filter candidates — discard domain mismatches based on documentation
- [ ] Step 5: Run all suitable models on the same input — loop `await run_infer(mr, model_id, <url>)` (submit+poll wrapper; see § Async job API)
- [ ] Step 6: Score models — compute mAP over IoU thresholds 0.1–0.95 (step 0.05). Use whatever IoU library is appropriate to your task; for instance segmentation, a small Hungarian-matching helper computing F1 per threshold is enough. Pixel-level IoU/Dice you can compute inline with numpy.
- [ ] Step 7: Save all artifacts to comparison_results/
- [ ] Step 8: Generate Illustration 1 (F1 vs IoU threshold curve), Illustration 2 (montage)
- [ ] Step 9: Write comparison_summary.json
- [ ] Step 10: Generate HTML report
```

### Candidate pool — two sources

The screening pool is the **union** of two model sources; gather both before scoring:

1. **model-runner models that pass the inference check.** Derive "passes the inference check" from the `bioimage-io/test-reports` collection: each per-model child artifact carries `manifest["score"]` (`+1` valid format, `+2` inference check passed, `+4` reproducible core test, `+0…1` metadata completeness). A model passes the inference check when **`score >= 3`** (the `+2` tier). `search_models(ignore_checks=False)` also returns only passing models and is the convenient default; use the test-reports score when you need the explicit signal.

   **Passing the check is not the same as being runnable on the live runner.** Two models in that
   pool have been reported failing every call: `stupendous-sheep`, whose inference child cannot
   import `empanada`, and `good-microbe`. So make the FIRST call of a screening pass a one-image
   smoke call per candidate and drop whatever fails, instead of discovering it part way through a
   run of hundreds of calls. The cost is one call per candidate; the alternative is a screening
   table with holes in it and no record of why.
2. **Cellpose-3 models** need no separate source from 2.11.2: `search_models` returns them and `mr.infer` runs them like anything else. Note they declare large minimum input sizes (see the banner at the top), so a too-small array fails before inference rather than during it.

> **Loop models OUTSIDE, images INSIDE.** The runner keeps one warm child and evicts it whenever
> the model changes, logging `🔄 [predict] Evicting warm child (model switch) before loading …`.
> Alternating models within one request stream therefore pays a respawn, about 8 s observed, on
> every single call. Driving all images for one model, then moving to the next, pays it once per
> model. The loop below is written that way.

```python
# Run multiple models and save all outputs.
# Assumes `mr` is the resolved model-runner handle (see "Direct Python — the actual API" above)
# and `test_url` is an HTTPS URL the worker can fetch.
import numpy as np

model_ids = ["affable-shark", "ambitious-ant", "chatty-frog"]
image_urls = [test_url]                           # however many you have
results = {}
for model_id in model_ids:                        # models OUTSIDE: one eviction each
    rdf = await mr.get_model_rdf(model_id=model_id)
    out_key = rdf["outputs"][0].get("id") or rdf["outputs"][0].get("name")
    for i, url in enumerate(image_urls):          # images INSIDE: the child stays warm
        r = await run_infer(mr, model_id, url)    # submit + poll; see § Async job API
        results[(model_id, i)] = np.asarray(r[out_key])
        np.save(f"comparison_results/{model_id}_{i}_output.npy", results[(model_id, i)])
```

### Step 3: Read model documentation before running

**Always call `get_model_documentation` for every candidate before running inference.** This fetches the model's README markdown file, which contains:
- Training data domain (brightfield, fluorescence, H&E, electron microscopy, etc.)
- Required input channels and expected staining protocols
- Recommended preprocessing steps
- Known limitations and magnification constraints

**HTTP endpoint**:
```
GET https://hypha.aicell.io/bioimage-io/services/model-runner/get_model_documentation?model_id={model_id}
```

**Python (RPC)**:
```python
from hypha_rpc import connect_to_server
server = await connect_to_server(server_url="https://hypha.aicell.io")
# `mr` is the handle resolved in the "Service ID" section above. Passing
# "bioimage-io/model-runner" to get_service here is the mistake that section
# exists to prevent.
doc = await mr.get_model_documentation(model_id="affable-shark")
# Returns: Markdown string or None if no documentation file exists
```

**HTTP (requests)**:
```python
import requests
r = requests.get(
    "https://hypha.aicell.io/bioimage-io/services/model-runner/get_model_documentation",
    params={"model_id": "affable-shark"}
)
doc = r.json()  # Markdown string or null
```

**Decision rules after reading documentation**:
- Model trained on H&E/brightfield → skip if input is fluorescence (and vice versa)
- Model requires 3+ channels → skip if only 1 channel is available (unless you can provide all required channels). Note this limitation in `comparison_summary.json` under `"notes"` — do NOT annotate this in the figures themselves; it belongs in the HTML report.
- Model trained on whole-slide-imaging at 40× → skip if your image is at a very different magnification
- If documentation is None or returns the bioimage.io spec README (not model-specific) → fall back to RDF `tags`, `description`, and test tensor inspection (see domain mismatch section below). **Known server bug**: `get_model_documentation` returns the same model's README for multiple different models (e.g. fearless-crab's README is returned for fearless-crab, conscientious-seashell, loyal-parrot, and chatty-frog). Detect this by checking if the returned content is identical across models or contains "bioimage.io specification" / starts with "# BioImage.IO". When detected, fall back to RDF tags.

Also check the RDF `tags` and `description` fields from `get_model_rdf` as a secondary signal.

**Artifact layout** (always save here — create folder if missing):

```
comparison_results/
├── {model_id}_output.npy              # raw prediction per model
├── illustration1_f1_vs_iou.pdf        # Illustration 1: F1 vs IoU threshold curves
├── illustration1_f1_vs_iou.png        # same at 300 DPI
├── illustration2_montage.pdf          # Illustration 2: input/GT/predictions montage
├── illustration2_montage.png          # same at 300 DPI
├── comparison_summary.json
└── model_comparison_report.html       # self-contained HTML with all figures embedded
```

**Generate HTML report** (always run at the end — auto-discovers all illustrations):

```bash
python scripts/generate_report.py --output-dir comparison_results/
```

### Required illustrations

Every screening run **must produce two illustrations** plus an HTML report. Generate them as publication-quality figures (Nature/Cell style):
- Figure width: 7.0 inches (Nature Methods single-column)
- Font: Arial or Helvetica, 7–8 pt for axis labels, 6 pt for tick labels
- Resolution: 300 DPI PNG + PDF with embedded fonts (`pdf.fonttype=42`, `ps.fonttype=42`)
- No chartjunk: remove top/right spines, subtle gridlines (#e0e0e0, `zorder=0`)
- Colors: use colorblind-friendly palettes (e.g. ColorBrewer diverging/sequential)
- All labels must be legible at print size — minimum 6 pt
- **No panel labels** (no "a", "b", "c") — panels are combined at the journal layout stage

---

#### Illustration 1 — F1 vs IoU threshold curve

**Skip only if there is exactly one suitable model** (single-candidate result). In that case, embed the mAP value as a text annotation in Illustration 2 instead.

**For instance segmentation tasks**: compute F1 at each IoU threshold from 0.1 to 0.95 (step 0.05; 18 thresholds). Plot one curve per model. The mAP is the area under this curve (mean of the 18 F1 values). This shows both peak performance and how quickly each model degrades at strict IoU requirements. (Write the per-threshold F1 inline using Hungarian matching on instance masks, or use any segmentation-metrics library you prefer.)

**For other tasks**: choose the most appropriate metric (PSNR/SSIM for denoising) and label the axis accordingly.

**Layout rules**:
- x-axis: IoU threshold 0.1→0.95; y-axis: F1 score 0→1
- One line per model, colored consistently with the montage (use a shared COLOR_MAP keyed by model name, ordered best→worst by mAP; colorblind-friendly palette)
- Legend with model IDs and mAP values, placed outside the plot area (upper right)
- No top/right spines; subtle gridlines (#e0e0e0)
- figsize=(6.5, 3.0) for Nature Methods single-column

**Python implementation** (use matplotlib; do NOT use seaborn):

```python
import numpy as np
import matplotlib
import matplotlib.pyplot as plt

matplotlib.rcParams.update({
    "font.family": "sans-serif", "font.sans-serif": ["Arial", "Helvetica", "DejaVu Sans"],
    "font.size": 7, "axes.titlesize": 7, "axes.labelsize": 7,
    "xtick.labelsize": 6, "ytick.labelsize": 6, "legend.fontsize": 6,
    "axes.linewidth": 0.6, "pdf.fonttype": 42, "ps.fonttype": 42,
})

THRESHOLDS = np.round(np.arange(0.1, 1.0, 0.05), 2)
# Assign colors best→worst by mAP rank (colorblind-friendly, no green — reserved for GT overlays)
COLORS_N = ["#5B8DB8", "#C47D45", "#3AAFA9", "#8B6BA8"]   # blue, orange, teal, purple
rank_order = sorted(models, key=lambda m: map_scores[m], reverse=True)
COLOR_MAP = {m: COLORS_N[i] for i, m in enumerate(rank_order)}

fig, ax = plt.subplots(figsize=(6.5, 3.0))
for model_id in rank_order:
    f1_curve = [results[model_id][f"f1_{t}"] for t in THRESHOLDS]
    mAP = np.mean(f1_curve)
    ax.plot(THRESHOLDS, f1_curve, color=COLOR_MAP[model_id], lw=1.5,
            label=f"{model_id}  (mAP={mAP:.3f})")

ax.set_xlabel("IoU threshold", labelpad=3)
ax.set_ylabel("F1 score", labelpad=3)
ax.set_xlim(0.1, 0.95)
ax.set_ylim(0, 1.0)
ax.xaxis.grid(True, color="#e0e0e0", lw=0.5, zorder=0)
ax.yaxis.grid(True, color="#e0e0e0", lw=0.5, zorder=0)
ax.set_axisbelow(True)
ax.spines["top"].set_visible(False)
ax.spines["right"].set_visible(False)
ax.legend(loc="upper right", frameon=False, fontsize=6, handlelength=1.5)

fig.savefig("illustration1_f1_vs_iou.pdf", bbox_inches="tight")
fig.savefig("illustration1_f1_vs_iou.png", bbox_inches="tight", dpi=300)
```

---

#### Illustration 2 — Input / GT / Predictions montage

Show all screened models in a single figure. **Models are ordered in the same rank order as Illustration 1** (best first). Iterate over `ranking` directly — **NOT** `plot_order` (which is worst-first and used only for barplot y-axis). Panel idx=0 (top-left) = best model, idx=N-1 (bottom-right) = worst model.

**Layout**:
- Row 1: Input image | Ground truth (if available) — centered, with empty columns as padding if needed
- Remaining rows: one panel per model prediction, in ranked order
- If ≤ 6 models: use a 2-column grid (input/GT in cols 1-2 of row 1; pairs of models per row below)
- If > 6 models: use a 3-column grid
- Each panel: title = model ID (6 pt, bold), subtitle = metric value e.g. "F1 = 0.909 | mIoU = 0.956" (5.5 pt, grey `#555555`)
- **Title and subtitle text must be dark (`#111111` / `#555555`)** — they render above/below the axes on the white figure background, NOT inside the dark panel. Using white text here makes titles invisible.
- Elements drawn **inside** the panel (scale bar line and label) must be white for contrast against the dark background.
- Do NOT add channel limitation notes to panels — record these in `comparison_summary.json` under `"notes"` and in the HTML report
- Spacing: panels must be **tight** — use `hspace=0.38` and `wspace=0.04` in GridSpec (enough to avoid subtitle/title overlap without large gaps).
- Figure background: `fig.patch.set_facecolor("white")` — white outer background for journal compatibility
- Each panel background: **always `#141414`** (near-black), regardless of figure background. Dark panel backgrounds make fluorescence/instance-segmentation overlays look significantly better. Never use white or grey for image panels.
- Scale bar in bottom-left corner (white line + label, 5.5 pt)
- For segmentation outputs: render as colored instance overlay (tab20 colormap, background `#141414`). Do NOT show raw probability maps — always postprocess to instance labels first.
- For the input panel: apply CLAHE (`skimage.exposure.equalize_adapthist`) and display as grayscale (`cmap="gray"`)
- For GT: render as colored instance overlay, same style as predictions
- No panel labels (no "a", "b", "c")

**Python**:
```python
fig.patch.set_facecolor("white")                 # white outer background for journal
# Iterate ranking (best-first): idx=0 → top-left, idx=N-1 → bottom-right
for idx, model_id in enumerate(ranking):          # NOT plot_order (which is reversed)
    row = 1 + idx // N_COLS
    col_start = (idx % N_COLS) * 2
    ax = fig.add_subplot(gs[row, col_start : col_start + 2])
    # ... render prediction panel ...
    ax.set_facecolor("#141414")                  # always dark, regardless of fig bg
    ax.set_title(model_id, fontsize=6, fontweight="bold", pad=3, color="#111111")
    ax.text(0.5, -0.06, f"F1 = {metrics[model_id]['f1']:.3f}", ...)  # color="#555555"
fig.savefig("illustration2_montage.pdf", bbox_inches="tight", facecolor=fig.get_facecolor())
fig.savefig("illustration2_montage.png", bbox_inches="tight", dpi=300, facecolor=fig.get_facecolor())
```

---

**comparison_summary.json schema**:

```json
{
  "task": "nuclei segmentation",
  "dataset": "Human Protein Atlas field 3235, 512x512 center crop",
  "input_channel": "405nm (DAPI/nucleus)",
  "keywords": ["nuclei", "fluorescence"],
  "candidates": ["model-id-1", "model-id-2"],
  "excluded": {"model-id-x": "domain mismatch: trained on H&E brightfield"},
  "mAP_summary": {
    "model-id-1": {"mAP": 0.783, "mAP_std": 0.045}
  },
  "metrics": {
    "model-id-1": {"f1_mean": 0.909, "f1_std": 0.04, "per_sample": {...}}
  },
  "failed_models": {"model-id-3": "shape mismatch error message"},
  "best_model": "model-id-1",
  "ground_truth_n_cells": 12,
  "ranking": ["model-id-1", "model-id-2"],
  "evaluation_method": "mAP: mean F1 over IoU thresholds 0.1–0.95 (step 0.05, 18 thresholds); greedy matching per threshold",
  "notes": {
    "model-id-2": "HPA model: requires 3 channels (DAPI+488+638). Run with ch1=ch2=zeros — degraded performance expected."
  }
}
```

## Unsupervised screening workflow (no ground truth)

Use this when the user has unlabelled images and wants to rank candidate models without ground truth. Implements **Consistency-based Model Ranking (CMR-NHD)** from Talks et al. 2026 (arXiv:2503.00450) entirely as a client-side loop over `mr.infer()` — no worker changes.

**Method.** For each `(model, image)` pair: run `infer()` on the clean image, run it again on a Gaussian-perturbed copy, then score the agreement between the two binary foreground masks as **IoU restricted to the union of foreground pixels** (Eq. 2 in the paper). The per-model score is the **median across images** (Eq. 5). Rank models by descending CMR.

**Use only with ≥ 5 images.** Per-model CMR on a single image is dominated by which model has the smoothest decision surface, not which is most accurate. The paper aggregates as median across the dataset; respect that.

```text
- [ ] Step 1: Clarify task type (currently only semantic-segmentation models supported; instance models need v2)
- [ ] Step 2: Gather candidates from search_models(ignore_checks=False) (or test-reports score ≥ 3); see § Candidate pool
- [ ] Step 3: For each candidate — call get_model_documentation to read the README, exclude domain mismatches
- [ ] Step 4: Run all suitable models on each image, both clean and perturbed — 2·K·N infer() calls
- [ ] Step 5: Compute per-(model, image) CMR-NHD; aggregate as median across images per model
- [ ] Step 6: Flag mode-collapse models (mean foreground fraction <1% or >95%)
- [ ] Step 7: Save artifacts to comparison_results/
- [ ] Step 8: Generate Illustration 1 (CMR per-model bar chart), Illustration 2 (clean/perturbed prediction montage)
- [ ] Step 9: Write comparison_summary.json
- [ ] Step 10: Generate HTML report
```

```python
# Assumes `mr` is the resolved model-runner handle and `infer_with_retry` is in scope
# (see "Direct Python — the actual API" and "Inference retry on OOM" above).
import numpy as np

def add_gaussian_noise(img, sigma_frac=0.10, seed=0):
    """Additive Gaussian noise scaled to sigma_frac * (p99 - p1) of the input."""
    p1, p99 = np.percentile(img, [1, 99])
    sigma = sigma_frac * max(p99 - p1, 1e-6)
    rng = np.random.default_rng(seed)
    return (img + rng.normal(0.0, sigma, size=img.shape)).astype(img.dtype)

def cmr_nhd_binary(y_clean_bin, y_pert_bin):
    """Foreground-restricted normalised Hamming distance (Eq. 2). Returns NaN if both masks empty."""
    union = y_clean_bin | y_pert_bin
    n_union = int(union.sum())
    if n_union == 0:
        return float("nan")
    n_disagree = int((y_clean_bin != y_pert_bin)[union].sum())
    return 1.0 - n_disagree / n_union

def per_image_cmr(clean_out, pert_out, threshold=0.5):
    """Reduce two raw model outputs to one CMR-NHD score (mean across output channels)."""
    ca, pa = np.asarray(clean_out), np.asarray(pert_out)
    while ca.ndim > 3 and ca.shape[0] == 1:
        ca, pa = ca[0], pa[0]
    if ca.ndim == 2:
        ca, pa = ca[None], pa[None]
    scores, fg_clean, fg_pert = [], [], []
    for c in range(ca.shape[0]):
        yh, yt = ca[c] >= threshold, pa[c] >= threshold
        scores.append(cmr_nhd_binary(yh, yt))
        fg_clean.append(float(yh.mean()))
        fg_pert.append(float(yt.mean()))
    valid = [s for s in scores if not np.isnan(s)]
    return {
        "cmr": float(np.mean(valid)) if valid else float("nan"),
        "per_channel": scores,
        "fg_clean": fg_clean,   # foreground fraction, for mode-collapse detection
        "fg_pert": fg_pert,
    }

# ---- driver loop --------------------------------------------------------------
model_ids = ["affable-shark", "resourceful-otter", "stupendous-blowfish"]
images    = [np.load(p).astype(np.float32) for p in image_paths]   # N images
SIGMA_FRAC, THRESHOLD = 0.10, 0.5

per_model = {}    # model_id -> list[per-image CMR]
fg_track  = {}    # model_id -> list[mean foreground fraction across (clean, pert)]
failed    = {}    # model_id -> error string

for mid in model_ids:
    try:
        rdf = await mr.get_model_rdf(model_id=mid)
        out_key = rdf["outputs"][0].get("id") or rdf["outputs"][0].get("name")
    except Exception as e:
        failed[mid] = f"RDF lookup failed: {e}"
        continue
    cmr_list, fg_list = [], []
    for i, img in enumerate(images):
        img_pert = add_gaussian_noise(img, SIGMA_FRAC, seed=i)
        try:
            r_clean = await infer_with_retry(mr, mid, img)
            r_pert  = await infer_with_retry(mr, mid, img_pert)
        except Exception as e:
            failed[mid] = f"inference failed on image {i}: {e}"
            cmr_list = []   # discard partial
            break
        scored = per_image_cmr(r_clean[out_key], r_pert[out_key], THRESHOLD)
        if not np.isnan(scored["cmr"]):
            cmr_list.append(scored["cmr"])
        fg_list.extend(scored["fg_clean"] + scored["fg_pert"])
    if cmr_list:
        per_model[mid] = cmr_list
        fg_track[mid] = fg_list

# ---- aggregate, flag mode collapse, rank --------------------------------------
MODE_COLLAPSE_LO, MODE_COLLAPSE_HI = 0.01, 0.95
scores = {m: float(np.median(v)) for m, v in per_model.items()}
fg_mean = {m: float(np.mean(fg_track[m])) for m in per_model}
collapsed = {m: fg_mean[m] for m in per_model
             if fg_mean[m] < MODE_COLLAPSE_LO or fg_mean[m] > MODE_COLLAPSE_HI}
ranking = sorted(scores, key=scores.get, reverse=True)   # best → worst

print(f"Median CMR ranking (n={len(images)} images, sigma_frac={SIGMA_FRAC}):")
for r, m in enumerate(ranking, 1):
    flag = "  ⚠ MODE-COLLAPSE" if m in collapsed else ""
    print(f"  {r}. {m:32s} CMR={scores[m]:.4f}  fg={fg_mean[m]:.3f}{flag}")
```

### Mode collapse — the main failure mode

A model that predicts entirely foreground or entirely background under both clean and perturbed inputs gets an **artificially high CMR** (the perturbation can't disagree with the empty/saturated mask). The paper flags this as the primary failure mode (Sec 5.1).

Detect it by tracking the **mean foreground fraction** across all `(image, clean+perturbed, channel)` combinations:
- `< 1%` → near-background-collapse (model is predicting nothing)
- `> 95%` → saturation (model is predicting everything as foreground)

Surface flagged models in the ranking output **and** in `comparison_summary.json` under `"mode_collapse"`. **Do not silently drop them** — the user needs to see why a model is suspect. A model can be number 1 by CMR and still be useless because it predicts all-zeros.

### Perturbation tuning

| `sigma_frac` | Effect |
|---|---|
| `0.02–0.05` | Almost no signal — CMR clusters near 1.0, ranking is dominated by quantisation noise. |
| **`0.10`** | **Default.** Paper's recommended starting point; CMR-NHD drops to 0.5–0.9 for typical models — good dynamic range. |
| `0.20–0.40` | Aggressive — CMR collapses toward 0; only useful if all models score ≥ 0.95 at 0.10. |

If models cluster tightly within ±0.02 of each other at `sigma_frac=0.10`, double it. If they cluster near 0, halve it. The metric is monotonic in perturbation strength (validated on the live worker, 2026-06-10).

### Illustration 1 — CMR per-model bar chart (unsupervised variant)

Replaces "F1 vs IoU threshold" — there is no labelled threshold sweep.

- Horizontal bar chart, models sorted **worst → best** on y-axis (so the best model is on top in the visual reading order)
- One bar per model, error bar = MAD (median absolute deviation) across images
- Mode-collapse models drawn in **red** with a `⚠` annotation; non-collapsed in the standard COLOR_MAP palette
- x-axis: `0` to `1`; vertical reference line at the **lowest CMR among non-collapsed models** as the "credible floor"
- figsize=(6.5, max(2.5, 0.35 * n_models))

```python
import numpy as np, matplotlib.pyplot as plt
plot_order = sorted(ranking, key=lambda m: scores[m])   # worst → best (bottom → top)
mads = {m: float(np.median(np.abs(np.array(per_model[m]) - scores[m]))) for m in ranking}
colors = ["#C0392B" if m in collapsed else "#5B8DB8" for m in plot_order]

fig, ax = plt.subplots(figsize=(6.5, max(2.5, 0.35 * len(ranking))))
y = np.arange(len(plot_order))
ax.barh(y, [scores[m] for m in plot_order],
        xerr=[mads[m] for m in plot_order],
        color=colors, edgecolor="#222", lw=0.4, error_kw=dict(lw=0.6))
for i, m in enumerate(plot_order):
    if m in collapsed:
        ax.text(scores[m] + 0.01, i, "⚠ mode collapse", va="center", fontsize=6, color="#C0392B")
ax.set_yticks(y); ax.set_yticklabels(plot_order)
ax.set_xlabel("Median CMR-NHD across images"); ax.set_xlim(0, 1.0)
ax.spines["top"].set_visible(False); ax.spines["right"].set_visible(False)
ax.xaxis.grid(True, color="#e0e0e0", lw=0.5, zorder=0); ax.set_axisbelow(True)
fig.savefig("illustration1_cmr_ranking.pdf", bbox_inches="tight")
fig.savefig("illustration1_cmr_ranking.png", bbox_inches="tight", dpi=300)
```

### Illustration 2 — Clean / Perturbed prediction montage (unsupervised variant)

Same layout rules as the supervised montage (#141414 panel background, white scale bar, dark titles outside panels), but **two columns per model** (clean prediction | perturbed prediction) instead of one. This makes the consistency the metric measures visually obvious to the reader.

- Row 1: Input image (clean) | Input image (perturbed) — leftmost image is the actual input, rightmost shows the noise applied
- Remaining rows: one row per model in ranked order; col 1 = clean prediction, col 2 = perturbed prediction
- Each model's row gets a subtitle: `"CMR = 0.84"` or `"CMR = 0.99 (⚠ mode collapse)"` between the two panels

### comparison_summary.json schema (unsupervised variant)

```json
{
  "task": "nuclei segmentation",
  "dataset": "user-supplied unlabelled images (n=12)",
  "evaluation_method": "CMR-NHD (Talks et al. 2026, arXiv:2503.00450); Gaussian perturbation sigma_frac=0.10; median across images",
  "candidates": ["model-id-1", "model-id-2"],
  "excluded": {"model-id-x": "domain mismatch: trained on H&E brightfield"},
  "cmr_scores": {
    "model-id-1": {"median": 0.843, "mad": 0.021, "per_image": [0.81, 0.86, ...]}
  },
  "mode_collapse": {
    "model-id-3": {"mean_foreground_fraction": 0.998, "reason": "saturated foreground predictions"}
  },
  "failed_models": {"model-id-4": "shape mismatch error"},
  "best_model": "model-id-1",
  "ranking": ["model-id-1", "model-id-2"],
  "perturbation": {"type": "gaussian", "sigma_frac": 0.10, "threshold": 0.5},
  "notes": {}
}
```

### Combining with the supervised workflow

If the user has ground truth for **some** images, run both: report supervised mAP on labelled images **and** unsupervised CMR on the full set. Spearman ρ between the two rankings on the overlap is a useful sanity check — if `ρ < 0.3` on n ≥ 10 models, treat the CMR ranking with skepticism and surface the disagreement in the report.

### Known limitations

- **Single-image runs are unreliable.** With N=1 image and tightly-clustered models (e.g. 5 UNets trained on near-identical nucleus datasets), per-image CMR is dominated by decision-surface smoothness, not accuracy. Validated on the live worker, 2026-06-10: 5 nucleus models on `affable-shark`'s test tensor gave Spearman ρ(CMR, true IoU) = −0.50 (n.s.). **The paper aggregates across ≥ 50 images per dataset; respect that floor.**
- **Instance segmentation not supported by this code.** Use CMR-ARS (Eq. 3) for instance models — requires `sklearn.metrics.adjusted_rand_score` and per-model instance postprocessing (NMS / watershed). Defer to v2.
- **Feature-space perturbations (CMR-DropOut) are stronger** in the paper but require reaching into the model's intermediate layers — not implementable as a black-box client wrapper. Input perturbations are paper-equivalent in most settings (Tab. 1).

## Validation / testing workflow

```text
- [ ] Step 1: validate — synchronous format compliance check (pass rdf_dict, not a file path)
- [ ] Step 2: test — submit; runs the official BioImage.IO test suite on GPU (may be cached)
- [ ] Step 3: poll get_test_status until completed_at is set; read result (the report)
- [ ] Step 4: Review report — check report["status"] (passed / valid-format / failed) and details
```

```bash
# validate is synchronous and takes rdf_dict (the parsed YAML as a dict), not a file path
bioengine call bioimage-io/model-runner validate --args '{"rdf_dict": {"type": "model", ...}}' --json

# test is asynchronous: submit returns a test_run_id, then poll get_test_status.
RUN=$(bioengine call bioimage-io/model-runner test --args '{"model_id": "ambitious-ant"}' --json)
bioengine call bioimage-io/model-runner get_test_status --args "{\"test_run_id\": $RUN}" --json
# cache="skip" forces a fresh package download + re-test ("check" default re-downloads only if the
# artifact changed; "reuse" trusts the cached package and report):
bioengine call bioimage-io/model-runner test --args '{"model_id": "ambitious-ant", "cache": "skip"}' --json
```

> **`cache` matters more on repeated `infer` than on `test`.** The default `"check"` re-verifies
> the cached model package against upstream on EVERY call, which is paid per call when you drive
> one model over many tiles or many images. Measured on a tiled 768x1024 run: `cache="reuse"`,
> plus a bounded fan-out of 4 concurrent tiles, took one image from about 30 s per 256x256 tile to
> 277 s for the whole image. Use `"reuse"` once you have run the model successfully at least once.

In Python, `report = await run_test(mr, "ambitious-ant")` submits and polls in one call (see [§ Async job API](#async-job-api--infer-and-test-return-job-ids)). Pass `custom_environment=True` for a model that declares a `dependencies` conda env (test-only; the report auto-publishes to the `bioimage-io/test-reports` collection).

## Inference retry on OOM

GPU workers can return an out-of-memory error when multiple jobs are running simultaneously. The error surfaces as a `RuntimeError` or `torch.OutOfMemoryError` (often re-raised as `Failed to unpickle serialized exception` from the Ray worker). **This is transient — wait and retry.**

Wrap every inference call in a retry loop:

```python
import asyncio

async def infer_with_retry(mr, model_id, inputs, max_retries=3, retry_delay=15):
    """Run inference (submit + poll via run_infer), retrying on OOM with back-off.
    `mr` is the resolved model-runner handle; `run_infer` is from § Async job API.
    The OOM surfaces from get_infer_status's result["error"], which run_infer re-raises.
    """
    for attempt in range(max_retries):
        try:
            return await run_infer(mr, model_id, inputs)
        except Exception as e:
            err = str(e).lower()
            is_oom = any(kw in err for kw in [
                "outofmemory", "out of memory", "cuda out", "unpickle serialized",
            ])
            if is_oom and attempt < max_retries - 1:
                wait = retry_delay * (attempt + 1)   # 15s, 30s, 45s
                print(f"  OOM on {model_id} (attempt {attempt+1}), retrying in {wait}s…")
                await asyncio.sleep(wait)
            else:
                raise
```

- **Max retries**: 3 (configurable). Total worst-case wait before giving up: ~90 s.
- **Delay**: linear back-off — 15 s, 30 s, 45 s. GPU memory is freed quickly once the previous job finishes.
- **Only retry on OOM**: other errors (shape mismatch, model not found, timeout) should fail immediately.
- If all retries are exhausted, record the model in `failed_models` with the error message and continue with remaining models.

## Validation loop (quality-critical runs)

Run inference → if failure, inspect error and RDF constraints (`get_model_rdf`) → adjust dimensions or normalization → rerun → repeat until success or clear incompatibility → record what changed and why.

## Output interpretation guide

Model outputs are **raw tensors** — not ready-to-use instance labels. Always read the RDF to understand channel semantics before interpreting results.

### Common output formats

| Model type | Output shape | Interpretation |
|---|---|---|
| UNet nucleus (e.g. affable-shark) | `(1, 2, H, W)` | ch0=foreground prob, ch1=boundary prob. Use `foreground - boundary` → watershed |
| UNet softmax (e.g. conscientious-seashell) | `(1, 3, H, W)` | Softmax probabilities across 3 classes (background/boundary/nucleus). Sum=1 per pixel. Identify nucleus channel by lowest mean. |
| StarDist | `(1, H, W, 33)` | ch0=object probability, ch1–32=star polygon radii. Requires NMS postprocessing — do NOT threshold naively. |
| Restoration (e.g. dazzling-spider) | `(1, 1, H, W)` | Direct output; output key is `"prediction"` not `"output0"` |

### HPA multi-channel models (conscientious-seashell, loyal-parrot)

These models expect **3 channels** (not just nucleus staining):
- **Channel 0**: 405nm (DAPI/nucleus staining, normalized to [0,1])
- **Channel 1**: 488nm (ER or microtubule channel, normalized to [0,1])
- **Channel 2**: 638nm (protein of interest, normalized to [0,1])

Input shape: `(1, 3, 512, 512)` float32. Normalize each channel independently with percentile normalization (p1=1, p99=99.8). If only the DAPI channel is available, fill ch1 and ch2 with zeros — performance degrades, but the model still runs. Record this limitation in `comparison_summary.json` under `"notes"`, NOT as an annotation on the figures.

**Output channel selection** (`conscientious-seashell`): output shape is `(1, 3, H, W)` softmax probabilities:
- ch0 = background (typically high mean ≈ 0.85)
- ch1 = unused / zeros when input ch1+ch2 are zeros
- ch2 = nucleus probability (positive correlation with DAPI)

**Critical**: select the nucleus channel using `argmax(correlation_with_dapi)` — NOT `argmax(abs(correlation))`. Background (ch0) has equal absolute correlation magnitude to nucleus (ch2) but negative sign. Using abs() silently selects the background channel.

```python
# Correct nucleus channel selection for conscientious-seashell
output = ...  # shape (1, 3, H, W)
dapi_flat = ch405n.ravel()
correlations = [np.corrcoef(output[0, c].ravel(), dapi_flat)[0,1] for c in range(3)]
nucleus_ch = np.argmax(correlations)  # NOT argmax(abs(correlations))
nucleus_prob = output[0, nucleus_ch]
```

`loyal-parrot` is a **cell body** model (whole-cell segmentation), not nucleus-only. Include only if the task is whole-cell segmentation. It oversegments when used for nucleus-only tasks.

### StarDist postprocessing

StarDist output ch0 is the **object probability map** — values are typically very sparse (>99% of pixels near 0 even for images with many nuclei). Apply NMS using the 32 radii channels:

**Threshold tuning**: `prob_thresh=0.5` may miss dim or small nuclei. Use `prob_thresh=0.4` as the default — inspect the probability map distribution and lower the threshold if you see false negatives on visually clear nuclei. The `min_distance` parameter in `peak_local_max` controls over-detection; increase it (e.g. 8–12) for large nuclei.

```python
import numpy as np
from skimage.feature import peak_local_max
from skimage.draw import polygon

def stardist_nms(prob, radii, prob_thresh=0.4, nms_thresh=0.3, min_radius=5):
    H, W = prob.shape
    n_rays = radii.shape[-1]
    angles = np.linspace(0, 2*np.pi, n_rays, endpoint=False)
    lm = peak_local_max(prob, min_distance=5, threshold_abs=prob_thresh)
    if len(lm) == 0:
        return np.zeros((H, W), dtype=int)
    # Sort by score, apply greedy NMS
    order = np.argsort(-prob[lm[:, 0], lm[:, 1]])
    lm = lm[order]
    labels = np.zeros((H, W), dtype=int)
    kept = []; inst_id = 0
    for y, x in lm:
        r = np.abs(radii[y, x])
        if r.mean() < min_radius:
            continue
        poly_y = np.clip(y + r * np.sin(angles), 0, H-1)
        poly_x = np.clip(x + r * np.cos(angles), 0, W-1)
        rr, cc = polygon(poly_y, poly_x, shape=(H, W))
        if len(rr) < 20:
            continue
        cur = np.zeros((H, W), dtype=bool); cur[rr, cc] = True
        if any((np.logical_and(cur, p).sum() / (np.logical_or(cur, p).sum()+1e-6)) > nms_thresh for p in kept):
            continue
        inst_id += 1; labels[rr, cc] = inst_id; kept.append(cur)
    return labels
```

### Resolution sensitivity

StarDist models tagged `whole-slide-imaging` are trained at specific magnifications. If the detected cell radii (mean of ch1–ch32 at top-probability pixels) are much larger or smaller than actual cell sizes in your image, the model is mismatched to your resolution. Switch to a model trained at your acquisition settings.

### Domain mismatch — brightfield vs fluorescence

**Critical**: Some models tagged `nuclei` or `segmentation` are trained on H&E brightfield images, not fluorescence. In brightfield/H&E, nuclei appear **dark on a bright background**; in fluorescence, nuclei are **bright on a dark background**. Running a brightfield-trained model on fluorescence data (or vice versa) produces detections with zero overlap with actual nuclei — F1=0.

**Prevention (do this first)**: Call `get_model_documentation(model_id)` before running any model. The README describes the training domain explicitly. Exclude models with incompatible domains before running inference — this saves time and prevents misleading results.

**Fallback detection** (if documentation is None or ambiguous):
1. Check the model's test input: `inputs[0].test_tensor.source` — download it and inspect visually
2. If test input has high mean pixel values (e.g. >80 for 8-bit) across all channels → brightfield
3. If test input has low mean with bright spots → fluorescence
4. Check RDF `tags` for `"brightfield"`, `"histopathology"`, `"H&E"` → skip for fluorescence tasks
5. After inference: if probability at ground-truth nucleus centroids is all ≈ 0.000 → domain is wrong

**Input scale is NOT the cause**: StarDist models (`chatty-frog`, `fearless-crab`) internally normalize their input. Sending [0,1] vs [0,255] values produces identical outputs (correlation=1.000). The domain difference (fluorescence vs brightfield) is the actual problem.

**chatty-frog** (`whole-slide-imaging`, StarDist RGB): trained on brightfield/H&E. Do NOT use for fluorescence microscopy. Use **fearless-crab** instead for fluorescence single-channel nuclei.

### Search keyword guide for HPA images

For Human Protein Atlas fluorescence images, use these keywords in order of reliability:

| Task | Best keywords |
|---|---|
| Nucleus segmentation | `["nuclei", "segmentation"]` |
| Cell segmentation | `["cell", "segmentation", "fluorescence"]` |
| HPA-specific | `["HPA"]` or search conscientious-seashell / loyal-parrot directly |
| Denoising | `["restoration", "2D"]` (not `"denoising"` — may return 0 results) |

`conscientious-seashell` = HPA nucleus model (3-channel). `loyal-parrot` = HPA cell body model (3-channel).

## Canonical model IDs

`infer()` and the other lookup methods take a model **nickname** (the `id` field in the RDF). A few high-value defaults to short-circuit `search_models` when the user names a model family:

| User says | `model_id` | Notes |
|---|---|---|
| "Cellpose" / "cyto" | `famous-fish` | Cellpose `cyto3` base model — generalist cell segmentation. Returns `outputs[0].id == "masks"`. |
| "StarDist nuclei (fluorescence)" | `fearless-crab` | StarDist single-channel fluorescence nucleus model. See [StarDist postprocessing](#stardist-postprocessing). |
| "StarDist nuclei (brightfield / H&E)" | `chatty-frog` | StarDist RGB whole-slide-imaging model. **Do not use for fluorescence** (zero overlap, F1=0). |
| "HPA nucleus" | `conscientious-seashell` | 3-channel HPA nucleus model. See [HPA multi-channel models](#hpa-multi-channel-models-conscientious-seashell-loyal-parrot). |
| "HPA cell body" | `loyal-parrot` | 3-channel HPA whole-cell model. |
| "BBBC-style nucleus segmentation" | `affable-shark` | UNet 2-channel (foreground + boundary). |
| "Denoising / restoration" | `dazzling-spider` | Output key is `"prediction"`, not `"output0"`. |
| "Mitochondria in EM (2D)" | `territorial-cricket` | BiaPy 2D U-Net trained on **Lucchi++**. Declares a fixed `256x256` single-channel input and returns ONE sigmoid probability channel under `output0`, so it needs connected-component labelling for a count. Alternatives with the same shape and training set: `poisonous-spider` (Attention U-Net), `gleeful-skunk` (Residual U-Net), `sensible-cat` (U-NeXt V2). |

Two traps in that corner of the zoo, both measured 2026-11-26:

- **`stupendous-sheep` (2D MitoNet) is advertised and currently unusable.** It is the only
  mitochondria *instance* model, so it is the obvious first pick for a counting task, and
  `search_models` returns it. Inference fails after ~12 s with
  `ModuleNotFoundError: No module named 'empanada'` from the inference child: the runner's
  environment lacks the package. `get_model_documentation` also returns an empty string for it,
  while returning full READMEs for the BiaPy models beside it.
- **The `shallow2deep` models are not standalone segmenters.** `hiding-blowfish`,
  `dazzling-crab` and `independent-shrimp` are prediction *enhancers*, and their
  `search_models` descriptions read exactly like a segmenter's.

Ten BiaPy models answer `search_models(["mitochondria"])` with the identical description
"Mitochondria segmentation for electron microscopy", and only the RDF tells 2D from 3D and
Lucchi++ from MitoEM or VNC. `search_models` returns `{"model_id": ..., "description": ...}` and
nothing else, so the axes, the declared size and the tags all need a `get_model_rdf` per
candidate.

When in doubt, call `search_models(keywords=[...])` first — these IDs are stable but the zoo evolves and fine-tuned variants of cellpose are published as their own nicknames.

## `infer()` input convention

`mr.infer(model_id, inputs)` accepts these `inputs` types (and returns a `request_id` — poll `get_infer_status`, or use `run_infer`):

| `inputs` type | Behaviour |
|---|---|
| `str` URL (`https://…/test_input_0.npy`) | Worker downloads, deserialises, runs. Use for bundled test tensors. |
| `str` file path from `get_upload_url` | **Preferred, and the only memory-safe route for a local file.** Upload the bytes to the presigned URL, then pass the returned `file_path`. The worker resolves it and spills it to disk, so the image never sits in the proxy actor's memory. Worked example below. A bare path needs no key: the worker stages it under an internal single-input sentinel that the model loader maps onto the model's one input member, so a bare path works even when that member is not called `input0` (measured against a 0.4.x model whose only input is called `input`). |
| `numpy.ndarray` | Sent over RPC, which means the decoded array is held in the proxy actor's memory for the whole call. Fine for one caller, and the wrong choice under concurrency — see the note after the example. Most models accept a bare `(H, W)` float32 array and internally reshape to `(batch, channel, y, x)` per `rdf.inputs[0].axes`. For multi-channel models (HPA, RGB) pre-stack to `(C, H, W)` or `(1, C, H, W)`. |
| `dict[str, np.ndarray \| str]` | Required for multi-input models, and a fine default for a single-input one. Key matches `rdf.inputs[i].id` (`.name` on a 0.4.x RDF). |

**Read the TAIL of a failure, not the head.** A remote error arrives as a traceback that the
transport has already truncated mid-frame, so the first lines are frame noise and the exception
type and message are at the END. Printing `repr(e)` and reading the last line is the difference
between "RemoteError:Traceback (most recent call last):" and
"ModuleNotFoundError: No module named 'empanada'".

**A multi-input model needs the dict form, and keying from the RDF is a good habit for a
single-input one too.** It is the same amount of code either way, and it makes the call say which
tensor the array is for instead of relying on there being exactly one:

```python
rdf = await mr.get_model_rdf(model_id=model_id)
first = rdf["inputs"][0]
key = first.get("id") or first.get("name")   # 0.5.x names it `id`, 0.4.x names it `name`
result = await run_infer(mr, model_id, {key: file_path})
```

**Take the input key with that `or`, not `["id"]`.** On a 0.4.x RDF the field comes back as `None`
(measured on a 0.4.1 model: `id` is `None`, `name` is `'input'`), so `rdf["inputs"][0]["id"]` hands
you `None`, and the dict you build is keyed on `None` instead of on a member the model declares.
The screening examples earlier on this page already use the same `or` for the OUTPUT key.

**`'InputTensorDescr' object has no attribute 'id'` is not your bug, and is already fixed.** It
comes from the runner, not from your call: `get_model_rdf` hands you a dict, and a dict cannot
raise it. The runner's own fit check read `.id` off an input descriptor, which a 0.4.x model does
not have. It arrived in model-runner 2.11.14 and is declined cleanly from 2.11.15 on, so seeing it
means the app you are calling is older than that, and there is nothing to change in your code.

**One error with no confirmed cause.** `block with members [] does not overlap with sample
members []` has been reported three times, so it is worth recognising, but no explanation of it is
confirmed, including the obvious one. It is **not** caused by sending a bare path for a model whose
input member is not `input0`: that exact call was run against such a model and succeeded.

One candidate was examined and ruled out, recorded so nobody spends the afternoon on it again. The
runner's 2.11.14 axes check could answer `True` for a 0.4.x model whose axes it had not read and so
route it into the wrong branch, which looks like a promising explanation. It is not reachable: in
that dispatch the separate, unguarded fit check is evaluated first and raises `AttributeError` on
the 0.4.x descriptor before the axes check is called at all, and the only branch that skips the fit
check calls neither. So on 2.11.14 a 0.4.x model raises the error above instead. The axes check is
UNGUARDED only in that one version: before 2.11.14 it did not exist and the fit check ran only for
Cellpose models, so a 0.4.x model never reached either, and from 2.11.15 both checks decline a
0.4.x descriptor rather than misreading it.

If you hit it, record the model id, the RDF format version, the app's version and the exact
`inputs` you passed.


### Uploading a local image — the full contract

Three steps, and none of the names are guessable from the signature, so copy them:

```python
import asyncio, io, numpy as np, urllib.request
from PIL import Image

# 1. ask for a slot. The kwarg is `file_type` (NOT `suffix`), and it must be one of
#    ".npy" ".png" ".tiff" ".tif" ".jpeg" ".jpg"
slot = await mr.get_upload_url(file_type=".png")
# -> {"upload_url": "https://…", "file_path": "…"}   NOTE: "upload_url", not "url"

# 2. PUT the bytes yourself — the worker does not fetch them for you.
#    urlopen is blocking, so inside app code hand it to a thread: awaiting it on the
#    event loop stalls the replica for the whole upload. run_in_executor works on
#    every supported Python; asyncio.to_thread needs 3.9.
buf = io.BytesIO()
Image.fromarray(arr.astype("uint8")).save(buf, format="PNG")

def put(url, data):
    urllib.request.urlopen(urllib.request.Request(
        url, data=data, method="PUT",
        headers={"Content-Type": "application/octet-stream"}))

await asyncio.get_event_loop().run_in_executor(
    None, put, slot["upload_url"], buf.getvalue())

# 3. infer on the RETURNED PATH, not the URL
result = await run_infer(mr, model_id, slot["file_path"])   # submit + poll
```

The slot has a **1-hour TTL**, so request it immediately before the upload rather than reusing one.

#### The same thing from the shell, with no Python

Verified end to end against the live KTH app. `jq` is not present in the worker image, so the
extraction below uses `sed` and needs nothing installed:

```bash
MR='bioimage-io/bioengine-worker-<host>-<hash>-<replica>:model-runner'   # see § Service ID

SLOT=$(bioengine call "$MR" get_upload_url --args '{"file_type": ".png"}' --json)
URL=$(printf '%s' "$SLOT" | sed -n 's/.*"upload_url": "\([^"]*\)".*/\1/p')
FP=$(printf  '%s' "$SLOT" | sed -n 's/.*"file_path": "\([^"]*\)".*/\1/p')

curl -X PUT --data-binary @cell.png "$URL"          # the worker does not fetch it for you

RID=$(bioengine call "$MR" infer \
        --args "{\"model_id\": \"idealistic-eagle\", \"inputs\": \"$FP\",
                 \"return_download_url\": true}" --json | tr -d '" ')

ST=$(bioengine call "$MR" get_infer_status --args "{\"request_id\": \"$RID\"}" --json)

# the result is a presigned .npy URL; --compressed is REQUIRED (see below)
RES=$(printf '%s' "$ST" | sed -n 's/.*"labels": "\([^"]*\)".*/\1/p')
curl -s --compressed -o result.npy "$RES"
```

**Two things here will cost you an hour if you skip them.** Quote `"$RES"` — a presigned URL is
full of `&`, and an unquoted one is split by the shell into a truncated URL that S3 answers with a
403 `AccessDenied` document. And pass `--compressed`: the object is served `Content-Encoding: gzip`,
so a plain `curl` writes the **1887-byte gzip body** instead of the array, and `np.load` then fails
with `Cannot load file containing pickled data` — an error that names the wrong cause entirely.
Measured on the live app:

```
curl --compressed -o result.npy "$RES"   -> 1,048,704 bytes, magic \x93NUMPY, np.load OK (1,1,512,512)
curl              -o result.npy "$RES"   ->     1,887 bytes, gzip blob, np.load raises
```

Note also that `curl -w '%{size_download}'` reports the **wire** size, 1887, in both cases — so a
size check on that number cannot tell a good fetch from a bad one. **Assert on the magic bytes of
the file you wrote, not on any size:**

```bash
head -c6 result.npy | grep -q NUMPY || { echo "not an npy — did you forget --compressed?"; exit 1; }
```

Sizes are the wrong thing to pin. 1887 is the gzipped body and 1,048,704 the array *today*; if the
endpoint ever stops serving `Content-Encoding: gzip` the wire size becomes the larger number and any
check written against either literal breaks. The magic survives both.

`infer` returns the id alone, so poll `get_infer_status` until `state` is `completed`, `failed` or
`cancelled` — a warm replica takes about five seconds. Quoting note: the `--args` value is JSON
inside a shell string, so the inner quotes have to be escaped as above; a single-quoted `--args`
cannot interpolate `$FP`.


**Why this path rather than passing the array.** `infer()` resolves URL and uploaded-path inputs and spills them to disk under `$HOME/.model-runner-inference/<request_id>/input/`, so a large image does not occupy RAM during the queue-and-download wait. An `np.ndarray` sent over RPC is instead held decoded in the ProxyDeployment actor for the lifetime of the call, and that actor admits a bounded number of concurrent requests precisely because a queued caller keeps its payload resident. Under concurrency the array path is what turns a busy app into a memory problem; the upload path is not. If you are writing a client that many people will run at once, use the upload path.

**Shape is not negotiable, and a wrong shape does not fail cleanly.** A model declaring a fixed input size accepts that size only — there is no resize anywhere in the runner. Measured against Cellpose-SAM (`idealistic-eagle`), whose RDF declares `[batch, channel(3), y=256, x=256]`: a 256x256 RGB input completes in ~5 s against a warm replica and ~30 s when the model still has to download; 192x192 is rejected server-side; 512x512 and 640x480 neither complete nor return an error within several minutes. Read `rdf["inputs"][0]["axes"]` and conform to it before sending, and treat "no response" as a probable shape mismatch rather than a slow model.

**Channel count is checked too, and grayscale is the common way to trip it.** Cellpose-SAM
(`idealistic-eagle`) declares three channels, so a single-channel image is refused before inference
starts — measured in production, a 1-channel array fails in ~3 s while the same pixels as 3 channels
complete in ~32 s. A real workshop participant hit this with an 807x696 grayscale micrograph, and
most microscopy is single-channel, so expect it.

```python
rdf = await mr.get_model_rdf(model_id=model_id)
ch = next((a for a in rdf["inputs"][0]["axes"] if a.get("type") == "channel"), None)
need = len(ch.get("channel_names") or []) if ch else None     # 3 for Cellpose-SAM
```

**The remedy is yours to choose, and it is not free.** Stacking one channel into three lets the model
run, but the extra channels are *invented*: the mask you get back was computed partly on data you did
not supply. For a model whose channels carry no declared meaning — Cellpose-SAM's are named
`channel0/1/2` — two obvious fabrications (repeat the channel; put it in channel 0 and zero the rest)
agree to 0.9997 per pixel on the same image, so neither is obviously better than the other. That
agreement says they are *similarly* wrong, not that either is faithful. Decide deliberately, and
record which you used alongside the result:

```python
arr3 = np.repeat(arr1, 3, axis=channel_axis)     # explicit, and worth noting in your provenance
```

If your single channel means something specific — one stain, one wavelength — a model that wants
three is arguably the wrong model for it, and that is worth knowing before the mask informs a
measurement.

Once resolved, the `result` (from `get_infer_status` / `run_infer`) is a `dict` keyed by the RDF's `outputs[i].id` (e.g. `"masks"`, `"prediction"`, `"output0"` — model-dependent). Always read the key from the RDF; do **not** hard-code `"output0"`:

```python
rdf = await mr.get_model_rdf(model_id=model_id)
out_key = rdf["outputs"][0]["id"]
result = await run_infer(mr, model_id, image)   # submit + poll; see § Async job API
masks = np.asarray(result[out_key])
```

## Per-request pre/postprocessing overrides

Since **model-runner 2.0.0**, `infer()` takes two optional dicts that patch the model's declared
processing ops for that one call, shaped `{op_id: {kwarg: value}}`:

| Argument | Effect |
|---|---|
| `preprocessing={"scale_range": {"min_percentile": 1.0, "max_percentile": 99.0}}` | Patch the kwargs of a declared preprocessing op. |
| `postprocessing={"cellpose_flow_dynamics": {"flow_threshold": 0.4, "cellprob_threshold": 0.0, "min_size": 15}}` | Patch a declared postprocessing op. |
| `postprocessing={"cellpose_flow_dynamics": None}` | **Drop** the op — returns the model's raw output, here the Cellpose flow field instead of instance masks. |

Rules that bite:

- The overrides are applied to an **in-memory copy of the RDF**. The published artifact is never modified, and nothing leaks into the next request.
- **An op id the model does not declare is an error**, not a no-op. Read `rdf["outputs"][i]["postprocessing"]` before guessing an id.
- A *changed override set* reloads the resident pipeline, so alternating override sets on a hot model costs a reload each time. Keep one set per screening pass.
- Dropping the instance-segmentation step changes the **shape** of the result, not its key: the output member keeps its RDF id (e.g. `labels`), it just now carries the raw head.
- `postprocessing={"microsam_watershed": ...}` is the one **extra key that is not a declared op** — it configures the micro-SAM instance-segmentation watershed, and setting it to `None` returns the AIS distance maps.

```python
# Instance masks with a looser flow threshold
masks = await run_infer(
    mr, model_id, image,
    postprocessing={"cellpose_flow_dynamics": {"flow_threshold": 0.6}},
)

# Raw flow field — do the flow dynamics yourself (or on a second call)
flows = await run_infer(
    mr, model_id, image,
    postprocessing={"cellpose_flow_dynamics": None},
)
```

In practice the Cellpose-3 zoo models declare no processing ops at all, so there is nothing to override for them.

## Deploying and updating the model-runner app

You only need this section if you're **bringing model-runner up on a new worker** (e.g. running BioEngine in your own workspace). For everyday inference, point at an already-deployed model-runner using the discovery recipe above — no deploy step needed.

### Deploy an already-published artifact (most common — operators)

If `bioimage-io/model-runner` exists in the artifact manager and you just want to run it on your worker, use the worker's `deploy_app` RPC. No local clone of the app source is required:

```python
from hypha_rpc import connect_to_server

s = await connect_to_server({"server_url": "https://hypha.aicell.io",
                             "token": admin_token,
                             "workspace": my_workspace})
# Resolve it rather than using f"{my_workspace}/bioengine-worker". That short
# form asks for a service called `bioengine-worker` on ANY client in the
# workspace, so it works only while yours holds exactly one worker and fails
# the day a second is registered, with no change on your side. Nothing
# guarantees one worker per workspace, so do not rely on it.
#
# The match string has to name YOUR worker's client-id stem, not the service
# name: every worker id ends in `:bioengine-worker`, so passing that matches
# them all and `worker_service_id` refuses, listing the candidates. Read the
# stem off the worker's own startup log, or off an HTTP listing of the
# workspace.
worker = await s.get_service(worker_service_id(my_workspace, "<your-worker-client-id-stem>"))

result = await worker.deploy_app(
    artifact_id="bioimage-io/model-runner",
    application_id="model-runner",            # stable app id ⇒ stable service id
    hypha_token=admin_token,                  # required: model-runner registers Hypha services internally
    # version="1.2.3",                        # optional pin. Omitting it does NOT mean "latest" when
    #                                         # this application_id is already running: see SKILL.md,
    #                                         # "Which version you get".
)
# 0.16.29+ returns a mapping, earlier workers a bare string. See SKILL.md,
# "What deploy_app returns".
app_id = result if isinstance(result, str) else result["application_id"]

```

Or via the CLI:

```bash
export BIOENGINE_WORKER_SERVICE_ID=<my-workspace>/bioengine-worker
bioengine apps run bioimage-io/model-runner --app-id model-runner --hypha-token $HYPHA_TOKEN
```

The `application_id` **must** be passed for any kind of update — omitting it always spawns a brand-new random instance. See the SKILL.md "Deploy an existing app" section for the full rationale.

> **`hypha_token` trap on cross-worker deploys.** When `application_id` matches an existing running instance on a worker, `deploy_app` silently reuses the previously stored token if `--hypha-token` is omitted. So a redeploy on a worker that already has `model-runner` running will "succeed" without it — while the same call on a worker without a prior instance fails inside the actor (model-runner registers Hypha services in `__init__`, so it dies hard without `HYPHA_TOKEN`). Always pass it.

### Develop and publish a new model-runner version (app authors)

This is the path used by maintainers of the `bioimage-io/model-runner` artifact itself — it requires a local clone of `aicell-lab/bioengine` and write access to the `bioimage-io` workspace:

```bash
export BIOENGINE_WORKER_SERVICE_ID=bioimage-io/bioengine-worker
bioengine apps deploy ./apps/model-runner/ \
  --app-id model-runner \
  --hypha-token $HYPHA_TOKEN
```

`bioengine apps deploy` uploads the local directory as a new artifact version AND deploys it in one step. When updating an existing deployment, the new version automatically inherits all env vars and init args/kwargs from the previous app — do **not** pass `--env` again unless intentionally rotating a secret:

```bash
bioengine apps upload ./apps/model-runner/
bioengine apps run bioimage-io/model-runner --app-id model-runner
# HYPHA_TOKEN and all other env vars are carried over automatically
```

## References

- Full API endpoint docs and examples: [references/api_reference.md](references/api_reference.md)
- RDF format spec (0.4.x vs 0.5.x axes, output keys): [references/rdf_format.md](references/rdf_format.md)
- Task/modality keyword presets: [assets/search_keywords.yaml](assets/search_keywords.yaml)
- CLI source and advanced usage: [references/cli_reference.md](references/cli_reference.md)
