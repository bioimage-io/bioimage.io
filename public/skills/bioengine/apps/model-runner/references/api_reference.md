# BioImage.IO Model Runner — API Reference

## Contents

- Service Endpoints
- `search_models`
- `get_model_rdf`
- `get_upload_url`
- `infer`
- `test`
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

# 3. Use file_path in infer call
result = await mr.infer(model_id="model-id", inputs=upload_info["file_path"])
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

2. **File path** (recommended — all access methods): Upload first via `get_upload_url`
   ```python
   result = await mr.infer(model_id="affable-shark", inputs="temp/uuid.npy", return_download_url=True)
   ```

3. **HTTP/HTTPS URL**: Direct URL to a downloadable `.npy` or image file
   ```python
   result = await mr.infer(model_id="affable-shark", inputs="https://example.com/image.npy", return_download_url=True)
   ```

4. **Dict** (multi-input models): Map input names to file paths or URLs
   ```python
   result = await mr.infer(model_id="multi-input-model", inputs={"input0": "temp/file1.npy", "input1": "temp/file2.npy"}, return_download_url=True)
   ```

### Response

With `return_download_url=True`:
```json
{"output0": "https://hypha.aicell.io/s3/.../temp/uuid.npy?X-Amz-..."}
```

> **Output keys vary by model** — do not assume `"output0"`. Always read the output key from the model RDF: `rdf["outputs"][0]["id"]` (0.5.x) or `rdf["outputs"][0]["name"]` (0.4.x). Common examples: `"output0"` (affable-shark), `"prediction"` (dazzling-spider). Use `next(iter(result.values()))` as a fallback when key is unknown.

### HTTP POST Usage

```bash
curl -X POST "https://hypha.aicell.io/bioimage-io/services/model-runner/infer" \
  -H "Content-Type: application/json" \
  -d '{
    "model_id": "affable-shark",
    "inputs": "temp/c8058bf8-a43a-47c0-9b56-b315005c9503.npy",
    "return_download_url": true
  }'
```

### Download Results

```bash
# Download .npy result
curl -fsSL --compressed --output result.npy "<download_url>"

# Load in Python
import numpy as np
result = np.load("result.npy")
```

---

## `test`

Run the official bioimage.io test suite on a model.

### Parameters

| Name | Type | Required | Default | Description |
|------|------|----------|---------|-------------|
| `model_id` | `str` | **Yes** | — | Model identifier |
| `stage` | `bool` | No | `false` | Use staged version |
| `additional_requirements` | `list[str] \| null` | No | `null` | Extra pip packages |
| `skip_cache` | `bool` | No | `false` | Force re-download |

### Response

```json
{
    "status": "passed",
    "details": "All tests passed successfully."
}
```

### Usage

```python
report = await mr.test(model_id="affable-shark")
print(report["status"])  # "passed" or "failed"
```

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
