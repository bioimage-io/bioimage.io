# BioEngine CLI Reference — runner commands

CLI source: `/data/wei/workspace/bioengine-paper/bioengine_cli/runner.py`  
Install: `pip install bioengine`  
Entry point: `bioengine runner <command>`

## Command summary

```
bioengine runner search   Search BioImage.IO models
bioengine runner info     Show model metadata and I/O spec
bioengine runner test     Run official BioImage.IO test suite
bioengine runner infer    Run inference on a local image file
bioengine runner validate Validate a local rdf.yaml file
bioengine runner compare  Run multiple models on the same input
```

---

## `bioengine runner search`

```
Usage: bioengine runner search [OPTIONS]

Search for runnable models in the BioImage.IO collection.

Options:
  -k, --keywords WORD    Keyword(s) to filter models (repeat for multiple)
  -n, --limit N          Max results [default: 10]
  --ignore-checks        Include models that failed BioEngine inference tests
  --json                 Output raw JSON list
  --server-url URL       Override server (default: https://hypha.aicell.io)
```

**Examples:**
```bash
bioengine runner search --keywords nuclei segmentation --limit 5
bioengine runner search --keywords denoising --json
bioengine runner search --limit 20   # all runnable models
```

**JSON output schema:**
```json
[
  {"model_id": "affable-shark", "description": "Nucleus segmentation for fluorescence microscopy"},
  {"model_id": "ambitious-ant", "description": "..."}
]
```

---

## `bioengine runner info`

```
Usage: bioengine runner info [OPTIONS] MODEL_ID

Show metadata and input/output specification for a model.

Arguments:
  MODEL_ID   BioImage.IO model ID (e.g. 'affable-shark')

Options:
  --stage    Use staged (draft) version
  --json     Output full RDF as JSON
```

**Examples:**
```bash
bioengine runner info affable-shark
bioengine runner info ambitious-ant --json
```

**Human output includes:** model name, description, tags, input axes/dtype, output axes/dtype, weight formats.

---

## `bioengine runner infer`

```
Usage: bioengine runner infer [OPTIONS] MODEL_ID

Run inference on a BioImage.IO model with a local image file.

Arguments:
  MODEL_ID   BioImage.IO model ID

Options:
  -i, --input PATH             Input image file (.npy, .tif, .tiff, .png) [required]
  -o, --output PATH            Output file path [default: result.npy]
  --device [cuda|cpu]          Computation device (auto if omitted)
  --weights-format FORMAT      Preferred weights format
  --skip-cache                 Force model re-download
  --blocksize N                Override tiling block size
  --json                       Output download URLs as JSON instead of saving
```

**Supported input formats:**
- `.npy` — numpy binary (lossless, preserves exact dtype/shape)
- `.tif` / `.tiff` — TIFF via tifffile (float32, multi-channel, 3-D)
- `.png` — PNG via PIL (uint8)

**Output format** is determined by the output file extension:
- `.npy` — lossless (recommended)
- `.tif` / `.tiff` — TIFF
- `.png` — normalised uint8

**Workflow internally:**
1. Read input file → numpy array
2. Upload array to BioEngine S3 temp storage (1h TTL) via `get_upload_url`
3. Call `service.infer(model_id, inputs=file_path, return_download_url=True)`
4. Download result `.npy` from presigned URL
5. Write to output path

**Examples:**
```bash
bioengine runner infer affable-shark --input cells.tif --output mask.npy
bioengine runner infer ambitious-ant --input image.npy --output result.tif --device cuda
```

---

## `bioengine runner test`

```
Usage: bioengine runner test [OPTIONS] MODEL_ID

Run the official BioImage.IO test suite on a model.

Options:
  --skip-cache              Force re-download and re-run (bypass cache)
  --stage                   Use staged version
  --extra-packages PKG      Extra pip packages for test env (repeat for multiple)
  --json                    Output test report as JSON
```

**Examples:**
```bash
bioengine runner test ambitious-ant
bioengine runner test ambitious-ant --skip-cache
```

**Output:** `[PASSED]` or `[FAILED]` + details. Exit code 1 on failure.

---

## `bioengine runner validate`

```
Usage: bioengine runner validate [OPTIONS] RDF_PATH

Validate a BioImage.IO RDF (rdf.yaml) file against the specification.

Arguments:
  RDF_PATH   Path to local rdf.yaml file

Options:
  --json     Output validation result as JSON
```

**Examples:**
```bash
bioengine runner validate ./my-model/rdf.yaml
```

---

## `bioengine runner compare`

```
Usage: bioengine runner compare [OPTIONS] MODEL_ID...

Run the same input image through multiple models and save all outputs.

Arguments:
  MODEL_ID...   One or more model IDs

Options:
  -i, --input PATH         Input image file [required]
  --output-dir DIR         Directory for output files [default: comparison_results]
  --device [cuda|cpu]      Computation device
  --json                   Output summary as JSON
```

**Examples:**
```bash
bioengine runner compare affable-shark ambitious-ant --input cells.tif
bioengine runner compare model-a model-b model-c --input image.npy --output-dir results/
```

**Output:** Per-model `.npy` files + `comparison_summary.json` in output-dir.

---

## Environment variables

| Variable | Description | Default |
|---|---|---|
| `BIOENGINE_SERVER_URL` | Hypha server URL | `https://hypha.aicell.io` |

No auth token needed for any runner command — the model-runner service is public.

---

## Error handling

All errors print a human-readable message to stderr and exit with code 1:
```
Error: Could not fetch model 'bad-id': ...
Hint:  Check that the model ID is correct. Use `bioengine runner search` to find valid IDs.
```

For agents: check exit code; non-zero means failure. Parse `--json` output for structured data.

---

## Implementation notes

- Async internally: all network calls use `asyncio.run()` wrapped in synchronous Click commands.
- Upload is always via `.npy` for lossless transfer; `return_download_url=True` is always used so results are fetched as HTTP downloads rather than direct RPC (more reliable for large arrays).
- API parameters verified against `bioengine-worker/bioengine_apps/model-runner/entry_deployment.py`.
