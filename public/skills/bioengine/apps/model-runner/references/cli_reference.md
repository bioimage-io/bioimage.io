# BioEngine CLI Reference — model-runner via `bioengine call`

There is **no `bioengine runner` command group**. The CLI exposes exactly three top-level commands — `call`, `apps`, `cluster` — and every model-runner operation is a service method invoked through the generic `bioengine call`:

```
bioengine call <SERVICE_ID> <METHOD> --args '<json>' [--json]
```

Install (Python ≥ 3.11):

```bash
pip install "bioengine[cli] @ git+https://github.com/aicell-lab/bioengine.git"
```

## Resolving `<SERVICE_ID>`

`bioimage-io/model-runner` alone is the WebRTC offer proxy and does **not** expose the methods. Resolve the concrete per-worker per-replica id first (see the "Service ID — discover before calling" section in `model-runner.md`), then either pass it directly or set it once:

```bash
export BIOENGINE_WORKER_SERVICE_ID=bioimage-io/bioengine-worker-<site>-<hash>:bioengine-worker
# then use the concrete <ws>/<worker_client_id>-<replica_id>:model-runner id with bioengine call
```

Below, `<svc>` stands for that resolved model-runner service id.

## Operation → command map

| Operation | Method | Command |
|---|---|---|
| Search models | `search_models` | `bioengine call <svc> search_models --args '{"keywords": ["nuclei","segmentation"], "limit": 5}' --json` |
| Model metadata / I-O spec | `get_model_rdf` | `bioengine call <svc> get_model_rdf --args '{"model_id": "affable-shark"}' --json` |
| Model documentation | `get_model_documentation` | `bioengine call <svc> get_model_documentation --args '{"model_id": "affable-shark"}' --json` |
| Validate an RDF dict | `validate` | `bioengine call <svc> validate --args '{"rdf_dict": {"type":"model", ...}}' --json` |
| Test a model (submit) | `test` | `bioengine call <svc> test --args '{"model_id": "ambitious-ant"}' --json` → `test_run_id` |
| Test status (poll) | `get_test_status` | `bioengine call <svc> get_test_status --args '{"test_run_id": "<id>"}' --json` |
| Request an upload URL | `get_upload_url` | `bioengine call <svc> get_upload_url --args '{"file_type": ".npy"}' --json` |
| Run inference (submit) | `infer` | `bioengine call <svc> infer --args '{"model_id": "affable-shark", "inputs": "<url-or-file_path>"}' --json` → `request_id` |
| Infer status (poll) | `get_infer_status` | `bioengine call <svc> get_infer_status --args '{"request_id": "<id>"}' --json` |

All commands accept `--json` for machine-parseable output.

## `infer` and `test` are asynchronous — submit then poll

Neither returns a result directly. `infer` returns a `request_id`, `test` returns a `test_run_id`; you poll the matching status method until the job is terminal (`completed_at` set, `queue_position == 0`) and read its `result`:

- `infer` → poll `get_infer_status(request_id=...)`; `result` is the output dict (or `{"error": "..."}`).
- `test` → poll `get_test_status(test_run_id=...)`; `result` is the BioImage.IO test report (`result["status"]` ∈ `passed` / `valid-format` / `failed`).

The report auto-publishes to the `bioimage-io/test-reports` collection — there is no `attach_test_report` parameter. Pass `custom_environment=True` to `test` for a model that declares a `dependencies` conda env (test-only path).

```bash
# Inference, end to end (submit → poll):
REQ=$(bioengine call <svc> infer --args '{"model_id": "affable-shark", "inputs": "https://…/test_input_0.npy"}' --json)
bioengine call <svc> get_infer_status --args "{\"request_id\": $REQ}" --json    # repeat until "result" is set

# Test, end to end:
RUN=$(bioengine call <svc> test --args '{"model_id": "ambitious-ant"}' --json)
bioengine call <svc> get_test_status --args "{\"test_run_id\": $RUN}" --json    # repeat until "completed_at" is set
```

The Python `run_infer` / `run_test` helpers in `model-runner.md` wrap this submit-and-poll loop.

## Uploading a local image for inference

`infer` does not read local files. Upload first, then pass the returned `file_path`:

1. `get_upload_url --args '{"file_type": ".npy"}'` → `{upload_url, file_path}`.
2. `PUT` the serialized array (`.npy` is lossless and preferred) to `upload_url`.
3. `infer --args '{"model_id": "<id>", "inputs": "<file_path>", "return_download_url": true}'`.
4. Poll `get_infer_status`; with `return_download_url=true` the `result` maps output keys to presigned download URLs (valid ~1 h).

Supported `file_type` values for `get_upload_url`: `.npy`, `.png`, `.tiff`/`.tif`, `.jpeg`/`.jpg`.

## `infer` parameters

| Name | Type | Default | Notes |
|---|---|---|---|
| `model_id` | str | — | Model nickname (the RDF `id`), not the `bioimage-io/` artifact id. |
| `inputs` | ndarray \| str \| dict | — | HTTPS URL, `get_upload_url` file path, raw array, or `{input_id: url/path/array}` for multi-input. |
| `weights_format` | str \| null | null | `pytorch_state_dict` / `torchscript` / `onnx` / `tensorflow_saved_model`; auto if null. |
| `device` | `"cuda"`\|`"cpu"`\|null | null | Auto-selects based on availability if null. |
| `default_blocksize_parameter` | int \| null | null | Override tiling block size (tiled models only). |
| `return_download_url` | bool | false | Return presigned S3 URLs instead of raw arrays. |
| `skip_cache` | bool | false | Force a model re-download before inference. |

## `test` parameters

| Name | Type | Default | Notes |
|---|---|---|---|
| `model_id` | str | — | Model nickname. |
| `stage` | bool | false | Test the staged version; report lands in the `staged/` slot. |
| `skip_cache` | bool | false | Force a fresh package download + re-test. |
| `custom_environment` | bool | false | Run inside the model's declared `dependencies` conda env (test-only; env cached on the shared PVC, LRU-evicted). |

## Environment variables

| Variable | Description | Default |
|---|---|---|
| `BIOENGINE_WORKER_SERVICE_ID` | Concrete worker service id used to resolve app service ids | — |

No auth token is required to read from or run the public `bioimage-io/model-runner`; a token is only needed for your own workspace/worker.

## Error handling

`bioengine call` prints errors to stderr and exits non-zero. For async jobs, a *submitted* job that later fails surfaces as `result: {"error": "..."}` in the status poll — the submit call itself may have already returned `0`. Always inspect the polled `result`.
