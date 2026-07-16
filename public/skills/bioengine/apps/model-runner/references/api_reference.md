# BioImage.IO Model Runner — API Reference

## Contents

- Service Endpoints
- `search_models`
- `get_model_rdf`
- `get_upload_url`
- `infer`
- `get_infer_status`
- `test`
- `get_test_status`
- `validate`
- `get_upload_url` — Supported File Formats

## Service Endpoints

- **HTTP Base**: `https://hypha.aicell.io/bioimage-io/services/model-runner/`
- **MCP Server**: `https://hypha.aicell.io/bioimage-io/mcp/model-runner`
- **Hypha RPC Service ID**: `bioimage-io/model-runner`
- **Hypha Server**: `https://hypha.aicell.io`

---

## `search_models`

Search for runnable deep learning models in the BioImage.IO collection.

### Parameters

| Name | Type | Required | Default | Description |
|------|------|----------|---------|-------------|
| `keywords` | `list[str] \| null` | No | `null` | Keywords to filter by (AND-matched against model tags, case-insensitive). Examples: `["nuclei", "segmentation"]`, `["restoration", "2D"]`. Note: `"denoising"` may return fewer results than expected — try `"restoration"` as an alternative for denoising tasks. |
| `limit` | `int` | No | `10` | Max number of results (1–100) |
| `ignore_checks` | `bool` | No | `false` | If `true`, include models that haven't passed BioEngine inference tests |

### Response

```json
[
    {
        "model_id": "affable-shark",
        "description": "Nucleus segmentation for fluorescence microscopy"
    },
    {
        "model_id": "chatty-frog",
        "description": "StarDist - Object Detection with Star-convex Shapes"
    }
]
```

### HTTP Usage

```bash
# Simple keyword search
curl "https://hypha.aicell.io/bioimage-io/services/model-runner/search_models?keywords=nuclei,segmentation&limit=5"

# Multiple keywords (comma-separated in HTTP)
curl "https://hypha.aicell.io/bioimage-io/services/model-runner/search_models?keywords=cell,membrane,segmentation&limit=10"

# Get all runnable models (no keyword filter)
curl "https://hypha.aicell.io/bioimage-io/services/model-runner/search_models?limit=50"
```

### Hypha RPC Usage

```python
results = await mr.search_models(keywords=["nuclei", "segmentation"], limit=5)
```

---

## `get_model_rdf`

Retrieve model metadata (Resource Description Framework).

### Parameters

| Name | Type | Required | Default | Description |
|------|------|----------|---------|-------------|
| `model_id` | `str` | **Yes** | — | Model identifier, e.g., `"affable-shark"` |
| `stage` | `bool` | No | `false` | Get staged (draft) version |

### Response

Full model RDF as an `ObjectProxy` object (not a plain Python dict). Access fields like a dict: `rdf["inputs"][0]["axes"]`. Nested objects are also `ObjectProxy`. To JSON-serialize: `json.dumps(rdf, default=str)`.

Key fields:

```json
{
    "name": "NucleiSegmentationBoundaryModel",
    "description": "Nucleus segmentation for fluorescence microscopy",
    "format_version": "0.5.7",
    "tags": ["fluorescence-light-microscopy", "nuclei", "instance-segmentation"],
    "inputs": [
        {
            "id": "input0",
            "axes": [
                {"type": "batch"},
                {"id": "channel", "type": "channel", "channel_names": ["channel0"]},
                {"id": "y", "type": "space", "size": {"min": 64, "step": 16}},
                {"id": "x", "type": "space", "size": {"min": 64, "step": 16}}
            ],
            "test_tensor": {"source": "test_input_0.npy"},
            "data": {"type": "float32"}
        }
    ],
    "outputs": [
        {
            "id": "output0",
            "axes": [
                {"type": "batch"},
                {"id": "channel", "type": "channel", "channel_names": ["channel0", "channel1"]},
                {"id": "y", "type": "space"},
                {"id": "x", "type": "space"}
            ],
            "test_tensor": {"source": "test_output_0.npy"},
            "data": {"type": "float32"}
        }
    ],
    "weights": {
        "pytorch_state_dict": {"source": "weights.pt"}
    }
}
```

### Known Issue

The HTTP endpoint fails for some models with `"ValueError: Out of range float values are not JSON compliant"`. Workaround — fetch RDF as YAML:

```bash
curl "https://hypha.aicell.io/bioimage-io/artifacts/ambitious-ant/files/rdf.yaml"
```

Or use the Hypha RPC SDK (no issue):

```python
rdf = await mr.get_model_rdf(model_id="ambitious-ant")
```

### Test tensor URL pattern

Model test inputs are hosted alongside the RDF. Given `inputs[0]["test_tensor"]["source"]` from the RDF (e.g., `"test_input_0.npy"` or `"inputs.npy"`), download with:

```
https://hypha.aicell.io/bioimage-io/artifacts/{model_id}/files/{source_filename}
```

Example:
```bash
curl -o test_input.npy "https://hypha.aicell.io/bioimage-io/artifacts/affable-shark/files/test_input_0.npy"
```

Always read the filename dynamically from the RDF — it is not always `test_input_0.npy`.

---

## `get_upload_url`

Get a presigned URL for uploading a file to temporary S3 storage.

### Parameters

| Name | Type | Required | Default | Description |
|------|------|----------|---------|-------------|
| `file_type` | `str` | **Yes** | — | File extension: `.npy`, `.png`, `.tiff`, `.tif`, `.jpeg`, `.jpg` |

### Response

```json
{
    "upload_url": "https://hypha.aicell.io/s3/hypha-workspaces/bioimage-io/temp/uuid.npy?X-Amz-...",
    "file_path": "temp/c8058bf8-a43a-47c0-9b56-b315005c9503.npy"
}
```

### Usage Pattern

```python
# 1. Get upload URL
upload_info = await mr.get_upload_url(file_type=".npy")

# 2. Serialize and upload
import numpy as np, httpx
from io import BytesIO

buffer = BytesIO()
np.save(buffer, image.astype(np.float32))
async with httpx.AsyncClient() as client:
    await client.put(upload_info["upload_url"], content=buffer.getvalue())

# 3. Use file_path in infer call (async: returns a request_id — poll get_infer_status)
request_id = await mr.infer(model_id="model-id", inputs=upload_info["file_path"])
```

### Curl Usage

```bash
# Get upload URL
UPLOAD_INFO=$(curl -s "https://hypha.aicell.io/bioimage-io/services/model-runner/get_upload_url?file_type=.npy")
UPLOAD_URL=$(echo "$UPLOAD_INFO" | python3 -c "import sys,json; print(json.load(sys.stdin)['upload_url'])")
FILE_PATH=$(echo "$UPLOAD_INFO" | python3 -c "import sys,json; print(json.load(sys.stdin)['file_path'])")

# Upload file
curl -fsSL -X PUT --data-binary @/path/to/image.npy "$UPLOAD_URL"
```

### Notes

- Uploaded files expire after **1 hour**
- Each call creates a new unique file path
- The `file_path` is what you pass to `infer(inputs=...)`

---

## `infer`

Run inference on a bioimage.io model.

**Asynchronous.** `infer` enqueues a job and returns a `request_id` string immediately. Poll `get_infer_status(request_id=...)` until `completed_at` is set (`queue_position == 0`); its `result` is the output dict (or `{"error": "..."}` on failure). See [`get_infer_status`](#get_infer_status) below.

### Parameters

| Name | Type | Required | Default | Description |
|------|------|----------|---------|-------------|
| `model_id` | `str` | **Yes** | — | Model identifier |
| `inputs` | `ndarray \| str \| dict` | **Yes** | — | Input: numpy array (RPC only), file path from `get_upload_url`, or HTTP/S URL |
| `return_download_url` | `bool` | No | `false` | Return download URLs instead of arrays |
| `weights_format` | `str \| null` | No | `null` | Preferred weights format |
| `device` | `"cuda" \| "cpu" \| null` | No | `null` | Computation device (auto if null) |
| `default_blocksize_parameter` | `int \| null` | No | `null` | Override tiling block size |
| `sample_id` | `str` | No | `"sample"` | Request identifier for logging |
| `skip_cache` | `bool` | No | `false` | Force model re-download |

### Input Types

> **Warning**: Passing a numpy array directly via Hypha RPC (`inputs=numpy_array`) hangs indefinitely and does not return. Use the file-path workflow (types 2–4) for all inference calls.

1. ~~**Numpy array** (Hypha RPC only)~~: **Do not use** — RPC direct numpy transfer hangs with no error or timeout. Use file path instead.

Each `infer` call returns a `request_id`; the examples below then resolve it via `get_infer_status`.

2. **File path** (recommended — all access methods): Upload first via `get_upload_url`
   ```python
   request_id = await mr.infer(model_id="affable-shark", inputs="temp/uuid.npy", return_download_url=True)
   ```

3. **HTTP/HTTPS URL**: Direct URL to a downloadable `.npy` or image file
   ```python
   request_id = await mr.infer(model_id="affable-shark", inputs="https://example.com/image.npy", return_download_url=True)
   ```

4. **Dict** (multi-input models): Map input names to file paths or URLs
   ```python
   request_id = await mr.infer(model_id="multi-input-model", inputs={"input0": "temp/file1.npy", "input1": "temp/file2.npy"}, return_download_url=True)
   ```

### Response

`infer` returns the `request_id` string. The **`result`** you read from `get_infer_status` is a dict keyed by output id. With `return_download_url=True`:
```json
{"output0": "https://hypha.aicell.io/s3/.../temp/uuid.npy?X-Amz-..."}
```
Without it, each value is the raw numpy array instead of a URL.

> **Output keys vary by model** — do not assume `"output0"`. Always read the output key from the model RDF: `rdf["outputs"][0]["id"]` (0.5.x) or `rdf["outputs"][0]["name"]` (0.4.x). Common examples: `"output0"` (affable-shark), `"prediction"` (dazzling-spider). Use `next(iter(result.values()))` as a fallback when key is unknown.

### HTTP POST Usage

The POST returns a `request_id`; poll the `get_infer_status` endpoint until the result is ready.

```bash
REQ=$(curl -s -X POST "https://hypha.aicell.io/bioimage-io/services/model-runner/infer" \
  -H "Content-Type: application/json" \
  -d '{
    "model_id": "affable-shark",
    "inputs": "temp/c8058bf8-a43a-47c0-9b56-b315005c9503.npy",
    "return_download_url": true
  }')
# then poll:
curl -s "https://hypha.aicell.io/bioimage-io/services/model-runner/get_infer_status?request_id=$REQ"
```

### Download Results

```bash
# Once get_infer_status result is populated (return_download_url=True), download each output URL:
curl -fsSL --compressed --output result.npy "<download_url>"

# Load in Python
import numpy as np
result = np.load("result.npy")
```

---

## `get_infer_status`

Poll for an `infer` job's progress and result.

### Parameters

| Name | Type | Required | Description |
|------|------|----------|-------------|
| `request_id` | `str` | **Yes** | The id returned by `infer`. |

### Response

Shared progress dict — terminal when `completed_at` is not `null` (`queue_position == 0`):

```json
{
  "queue_position": 0,
  "submitted_at": 1735689590.0,
  "model_download": 1735689600.0,
  "env_setup": null,
  "running": 1735689630.0,
  "completed_at": 1735689645.0,
  "result": {"output0": "https://…/temp/uuid.npy?X-Amz-…"}
}
```

`result` holds the output dict on success or `{"error": "..."}` on failure. Requests live in memory per Entry replica and expire ~1 h after completion.

---

## `test`

Run the official bioimage.io test suite on a model.

**Asynchronous.** `test` returns a `test_run_id` string; poll [`get_test_status`](#get_test_status) until terminal, then read `result` (the report). Each run executes the model in a **child process** for GPU/CUDA context isolation — no residual VRAM stays pinned across calls. The report is **auto-published** to the `bioimage-io/test-reports` collection (`staged/` slot when `stage=True`, else `published/`) under the app's own credentials — there is no `attach_test_report` / `hypha_token` parameter.

### Parameters

| Name | Type | Required | Default | Description |
|------|------|----------|---------|-------------|
| `model_id` | `str` | **Yes** | — | Model identifier |
| `stage` | `bool` | No | `false` | Test the staged version instead of the published one; report lands in the `staged/` slot |
| `skip_cache` | `bool` | No | `false` | Force a fresh model download and bypass cached test results |
| `custom_environment` | `bool` | No | `false` | If `true`, run inside the conda env declared by the model's own weights `dependencies` (built via `mamba`, **cached** on the shared PVC and LRU-evicted — not deleted per call). Test-only: `infer()` always uses the shared venv. If `false`, run in the RuntimeApp's shared venv — the same one that serves `infer()`. |

### Usage

```python
# Submit — returns a run id, not the report.
test_run_id = await mr.test(model_id="affable-shark")

# Poll until terminal, then read the report.
import asyncio
while True:
    status = await mr.get_test_status(test_run_id=test_run_id)
    if status["completed_at"] is not None:
        break
    await asyncio.sleep(2)
report = status["result"]
print(report["status"])   # "passed", "valid-format", or "failed"

# Model with a custom conda env declared via the weights `dependencies` field:
test_run_id = await mr.test(model_id="resourceful-lizard", custom_environment=True)
```

---

## `get_test_status`

Poll for a `test` job's progress and result. Same shape as [`get_infer_status`](#get_infer_status); `result` holds the test report (`result["status"]`) on success or `{"error": "..."}` on failure. Runs expire ~24 h after completion.

### Parameters

| Name | Type | Required | Description |
|------|------|----------|-------------|
| `test_run_id` | `str` | **Yes** | The id returned by `test`. |

---

## `validate`

Validate an RDF dictionary against bioimage.io specifications.

### Parameters

| Name | Type | Required | Default | Description |
|------|------|----------|---------|-------------|
| `rdf_dict` | `dict` | **Yes** | — | Full RDF dictionary |
| `known_files` | `dict \| null` | No | `null` | File path → hash mapping |

### Response

```json
{
    "success": true,
    "details": "Validation summary tables..."
}
```

### Usage

```python
rdf = await mr.get_model_rdf(model_id="affable-shark")
result = await mr.validate(rdf_dict=rdf)
print(f"Valid: {result['success']}")
```

---

## `get_upload_url` — Supported File Formats

| Extension | Format | Best For | Notes |
|-----------|--------|----------|-------|
| `.npy` | NumPy binary | All cases | Preserves exact shape and dtype; preferred format |
| `.png` | PNG image | 2D uint8 images | Lossless; single-channel (grayscale) or 3-channel (RGB) |
| `.tiff` / `.tif` | TIFF image | 2D/3D scientific images | Supports float32; larger file sizes |
| `.jpeg` / `.jpg` | JPEG image | 2D RGB previews | Lossy compression; not recommended for analysis |

**Recommendation**: Use `.npy` for all programmatic workflows. Use `.png`/`.tiff` only when the input is already in that format.
