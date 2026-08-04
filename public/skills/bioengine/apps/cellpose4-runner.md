# BioEngine Cellpose-4 Runner

**Service ID**: `bioimage-io/cellpose4-runner` · **Server**: `https://hypha.aicell.io`

Inference-only service for **supported Cellpose-4 bioimage.io models** (Cellpose-SAM) via [`bioimageio.core`](https://github.com/bioimage-io/core-bioimage-io-python). PyTorch-only — a small companion to `model-runner`, which ships Cellpose-3 and **cannot** run Cellpose-4 models. Use this app whenever a user wants to run Cellpose-SAM / Cellpose-DINO.

## Use this skill when

- The user names a Cellpose-4 / Cellpose-SAM model, or `model-runner` rejects a model as unsupported because it is Cellpose-4.
- You are screening segmentation models and want the Cellpose-4 candidates alongside the model-runner ones (see § Screening below).

## Which models are accepted — ask the service, never hardcode

The accepted models are an explicit allow-list that evolves; **always resolve it at call time** rather than pinning an id:

```python
from hypha_rpc import connect_to_server

server = await connect_to_server({"server_url": "https://hypha.aicell.io", "token": "<HYPHA_TOKEN>"})
svc = await server.get_service("bioimage-io/cellpose4-runner")   # concrete per-replica id — see model-runner § Service ID

supported = await svc.list_supported_models()   # e.g. ["idealistic-eagle"]
```

Any `model_id` outside this set is rejected by `infer`.

## Methods

| Task | Method |
|---|---|
| List accepted Cellpose-4 model ids | `list_supported_models()` |
| Submit inference (returns a `request_id`) | `infer(model_id, inputs, ...)` |
| Poll an inference request | `get_infer_status(request_id)` |
| Cancel a still-queued request | `cancel_request(request_id)` |
| Presigned S3 PUT URL for staging an input | `get_upload_url(file_type)` |

The submit/poll contract is **identical to model-runner**: `infer` returns a `request_id` immediately; poll `get_infer_status(request_id)` until `completed_at` is set, then read `result`.

```python
import asyncio
import numpy as np

model_id = (await svc.list_supported_models())[0]     # don't hardcode
img = np.random.rand(1, 3, 256, 256).astype("float32")  # Cellpose-SAM: 3-channel 2D
request_id = await svc.infer(model_id=model_id, inputs=img)

while True:
    status = await svc.get_infer_status(request_id=request_id)
    if status["completed_at"] is not None:
        break
    await asyncio.sleep(1)
labels = status["result"]["labels"]   # integer instance mask
```

`inputs` is a numpy array, a direct http(s) URL, or a `get_upload_url` file path.

**Optional `infer` arguments:**
- `flow_threshold` / `cellprob_threshold` / `min_size` — override the Cellpose flow-dynamics postprocessing; `None` uses the model RDF defaults (Cellpose-SAM: `0.4` / `0.0` / `15`). Overrides patch only an in-memory RDF copy; a changed override set reloads the resident pipeline.
- `return_flows=True` — return the raw flow field (`{"flows": array}`, 2 flow components + cell probability) instead of instance masks; the threshold overrides do not apply in this mode.
- `return_download_url=True` — return each output as a presigned S3 `.npy` URL (1-hour TTL) instead of the raw array.

## Deployment

The app reads `HYPHA_TOKEN` at startup (Hypha + S3), so a fresh deploy must inject it:

```python
await worker.deploy_app(
    artifact_id="bioimage-io/cellpose4-runner",
    version="0.3.0",
    application_id="cellpose4-runner",
    hypha_token=HYPHA_TOKEN,
)
```

First deploy is slow (runtime env pip-installs torch + `cellpose`) and requires a GPU replica.

## Screening — combine with model-runner

When screening segmentation candidates, the full pool is the **union** of the two sources:

1. model-runner models that **pass the inference check** — derive this from the `bioimage-io/test-reports` per-model manifest `score` (score ≥ 3 means the inference-check tier passed; see model-runner § Screening).
2. Cellpose-4 models from `cellpose4-runner.list_supported_models()`.

Route each candidate to the app that owns it (model-runner ids to model-runner's `infer`, Cellpose-4 ids to this app's `infer`) — both share the same async submit/poll result shape, so a single scoring loop handles both.
