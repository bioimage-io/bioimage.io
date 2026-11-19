# BioEngine Cellpose-3 Runner


> **SUPERSEDED.** From **model-runner 2.11.2** the main runner serves Cellpose-3 from its own
> internal environment, so `bioimage-io/model-runner` is the only service id you need and this app
> is not part of the normal path. This page is kept because workers are pinned and roll
> independently: if you are targeting a worker below 2.11.2, the behaviour below still applies.
> Check the worker's deployed version before relying on either.

> **NOT RUNNING ANYWHERE RIGHT NOW, so `get_service` on it fails.** Measured 2026-11-17: of the
> 36 services registered in the `bioimage-io` workspace and the 11 in `reef-imaging`, **none** is
> a `cellpose3-runner`. It was deployed on the KTH worker as recently as 2026-10-28 (version
> 0.2.0) and has since been taken down, so older notes and transcripts that show it working are
> not wrong, just out of date. Every `get_service("bioimage-io/cellpose3-runner")` call on this
> page therefore fails today with a service-not-found error, and no version check on the worker
> will tell you that, because the worker is fine and the service is simply absent.
>
> **The artifact is still published**: 6 versions, latest 0.2.2, with no declared worker floor
> or image pin that would refuse a deploy. So the likely reason your call fails is a deploy step
> you are missing rather than a dead end. **A deploy has not been attempted**, here or by anyone
> who checked this, so treat it as untested rather than known to work: what is measured is that
> the artifact exists and nothing in its manifest forbids deploying it. If you are on a worker
> below 2.11.2 and need Cellpose-3, **deploy it yourself first** (see
> [§ Deployment](#deployment) below), then resolve the per-replica service id from
> `worker.get_app_status(None)`. Read the snippets below as "after you have deployed it", and if
> the deploy itself fails, that is new information worth reporting rather than something this
> page has ruled out.
>
> If you can instead reach a worker running model-runner 2.11.2 or newer, prefer that: it needs
> no deploy and no second service. KTH runs 2.11.6 and the published model-runner is 2.11.12.
> At least one production worker, reef, is **still below 2.11.2** and is the reason this page
> still exists. Its exact version is not stated here on purpose, because the available readings
> disagree: its container image tag reads `model-runner:2.9.0` while a drift table from
> 2026-10-28 recorded 2.10.3, and the worker is too old to self-report a pinned version at all.
> All three readings are below the floor, which is the only part that affects what you should do.

**Service ID**: `bioimage-io/cellpose3-runner` · **Server**: `https://hypha.aicell.io` ·
**Deployed**: nowhere, as of 2026-11-17 (deploy it yourself first, see the note above)

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
# ^ FAILS unless you deployed it first: nothing is registered under this id on any worker
#   as of 2026-11-17. Deploy it (§ Deployment), then use the per-replica id from get_app_status.

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

**On a worker below 2.11.2 this is not optional**, it is the first step: nothing is registered
anywhere (see the note at the top), so the service id does not resolve until you deploy it.

The app reads `HYPHA_TOKEN` at startup (Hypha + S3), so a fresh deploy must inject it. The
`version` below is an example, not a recommendation: `0.2.0` is what KTH last ran, while the
published artifact is at `0.2.2`. Resolve the version you want from the artifact rather than
copying this one.

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
