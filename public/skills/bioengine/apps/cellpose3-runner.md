# BioEngine Cellpose-3 Runner

**Service ID**: `bioimage-io/cellpose3-runner` · **Server**: `https://hypha.aicell.io`

Inference-only service for the **Cellpose-3-and-earlier bioimage.io models** via [`bioimageio.core`](https://github.com/bioimage-io/core-bioimage-io-python). A small CPU companion to `model-runner`, whose runtime ships Cellpose 4 and therefore **cannot** load the Cellpose-3 architectures. Everything else — including Cellpose-4 / Cellpose-SAM, Cellpose-DINO and micro-SAM — runs natively on [model-runner](model-runner/model-runner.md).

## Use this skill when

- The user names one of the Cellpose-3 zoo models, or `model-runner.infer` rejects a model because its runtime ships Cellpose 4.
- You are screening segmentation models and want the Cellpose-3 candidates alongside the model-runner ones (see § Screening below).

## Which models are accepted — ask the service, never hardcode

The accepted models are an explicit allow-list that evolves; **always resolve it at call time** rather than pinning an id:

```python
from hypha_rpc import connect_to_server

server = await connect_to_server({"server_url": "https://hypha.aicell.io", "token": "<HYPHA_TOKEN>"})
svc = await server.get_service("bioimage-io/cellpose3-runner")   # concrete per-replica id — see model-runner § Service ID

supported = await svc.list_supported_models()
# ["famous-fish", "happy-elephant", "merry-gorilla", "philosophical-panda", "thoughtful-chipmunk"]
```

Any `model_id` outside this set is rejected by `infer`. Both the bare nickname and the fully-qualified `bioimage-io/<nickname>` form are accepted.

## Methods

| Task | Method |
|---|---|
| List accepted Cellpose-3 model ids | `list_supported_models()` |
| Submit inference (returns a `request_id`) | `infer(model_id, inputs, ...)` |
| Poll an inference request | `get_infer_status(request_id)` |
| Cancel a still-queued request | `cancel_request(request_id)` |
| Presigned S3 PUT URL for staging an input | `get_upload_url(file_type)` |
| Current replica load / GPU count | `get_load()`, `get_num_pcs()` |

Every method this app shares with model-runner has the **same name and signature** — `infer(model_id, inputs, …, preprocessing, postprocessing, cache)`, `get_infer_status(request_id)`, `cancel_request(request_id)`, and `get_upload_url(file_type)` — so one client code path drives both. `list_supported_models()` is the only method specific to this app (model-runner resolves its models via `search_models` instead, and offers `test` / `validate` / `get_model_rdf`, which this app does not). The submit/poll contract is identical: `infer` returns a `request_id` immediately; poll `get_infer_status(request_id)` until `completed_at` is set, then read `result`.

```python
import asyncio
import numpy as np

model_id = (await svc.list_supported_models())[0]   # don't hardcode
img = np.random.rand(1, 1, 512, 512).astype("float32")
request_id = await svc.infer(model_id=model_id, inputs=img)

while True:
    status = await svc.get_infer_status(request_id=request_id)
    if status["completed_at"] is not None:
        break
    await asyncio.sleep(1)
result = status["result"]
```

`inputs` is a numpy array, a direct http(s) URL, or a `get_upload_url` file path.

**Read the output key off the RDF, not from this page.** These models do not share one output layout: `famous-fish` returns a single `masks` member, while `philosophical-panda` returns the raw Cellpose head (`flow`, `style`, `downsampled_0…3`) and leaves the flow-dynamics step to the caller. This app has no `get_model_rdf`, so fetch the RDF from model-runner (or from the model artifact) and key the result by `rdf["outputs"][i]["id"]`.

**Optional `infer` arguments:**
- `preprocessing` / `postprocessing` — per-request overrides of the model's declared ops, shaped `{op_id: {kwarg: value}}`; a value of `None` drops the op entirely. Applied to an in-memory copy of the RDF, so the published artifact is never touched. **An op id the model does not declare is an error** — and the current Cellpose-3 zoo models declare *no* pre- or postprocessing at all, so on this app both dicts are normally left unset. The mechanism is documented here only because it is the same call surface as model-runner's (see [model-runner § Per-request pre/postprocessing overrides](model-runner/model-runner.md#per-request-prepostprocessing-overrides)), where it is actually useful.
- `weights_format` / `default_blocksize_parameter` / `sample_id` — as on model-runner.
- `device` — `"cuda"` / `"cpu"`, auto-selecting when unset. **This app only.** model-runner dropped its `device` parameter in 2.7.0 (inference there moved into a subprocess, so it had stopped meaning anything), so do not cross-reference model-runner for it.
- `return_download_url=True` — return each output as a presigned S3 `.npy` URL (1-hour TTL) instead of the raw array.
- `cache` — model-cache policy, same values and meaning as model-runner's `infer` (there is **no** `skip_cache` alias here): `"check"` (default) does a real freshness round-trip to the model artifact and reloads the resident pipeline only if it changed; `"skip"` forces a full reload even if the model is resident; `"reuse"` trusts the resident pipeline with no round-trip. A reload's timing surfaces in the `model_download` stage of `get_infer_status` (a genuine warm reuse reports it as skipped).

## Deployment

The app reads `HYPHA_TOKEN` at startup (Hypha + S3), so a fresh deploy must inject it:

```python
await worker.deploy_app(
    artifact_id="bioimage-io/cellpose3-runner",
    version="0.2.0",
    application_id="cellpose3-runner",
    hypha_token=HYPHA_TOKEN,
)
```

The replica is **CPU-only** — these are small models and a whole-image run takes on the order of a minute, so do not budget a GPU for it. First deploy is slow (the runtime env pip-installs torch + a pinned `cellpose<4`).

## Screening — combine with model-runner

When screening segmentation candidates, the full pool is the **union** of the two sources:

1. model-runner models that **pass the inference check** — derive this from the `bioimage-io/test-reports` per-model manifest `score` (score ≥ 3 means the inference-check tier passed; see model-runner § Screening).
2. Cellpose-3 models from `cellpose3-runner.list_supported_models()`.

Route each candidate to the app that owns it (Cellpose-3 ids to this app's `infer`, everything else to model-runner's) — both share the same async submit/poll result shape, so a single scoring loop handles both. Budget extra wall-clock for the Cellpose-3 leg: it runs on CPU while model-runner runs on GPU.
