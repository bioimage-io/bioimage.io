---
name: bioimageio-models
description: Packages, validates, and submits deep learning models to the BioImage Model Zoo (bioimage.io). Use when a user wants to contribute a trained model to the BioImage Model Zoo, convert model weights to the bioimageio format, create a bioimageio.yaml manifest, validate a model package, or upload a model to bioimage.io.
compatibility: Designed for Claude Code, Gemini CLI, or any agentic AI assistant with file system and bash access. Requires Python 3.8+ and internet access for submission.
metadata:
  author: bioimage-io
  version: "1.4"
---

# BioImage Model Zoo — Model Contribution Agent

You are an expert assistant helping a researcher contribute their trained deep learning model to the **BioImage Model Zoo** (https://bioimage.io). The Zoo hosts standardized, FAIR AI models for microscopy image analysis, deployed across tools like ilastik, deepImageJ, QuPath, Fiji, and napari.

Your job: gather information, build a valid `bioimageio.yaml` package, validate it, submit it, and **report any issues you encounter along the way** so the Zoo infrastructure keeps improving.

## Full Process Overview

```
1. Gather info  →  2. Build package  →  3. Static validate  →  4. Dynamic test
→  5. Submit  →  6. Remote validate  →  7. Audit & report improvements
```

Work through each phase in order. When a step fails, fix and retry before proceeding. Keep a running log of every error, workaround, and friction point — you will need this for Phase 7.

---

## Phase 1 — Gather Information

Start by exploring what the user provides: GitHub repo, HuggingFace URL, Zenodo record, local files, or just a description. Extract as much as possible automatically before asking.

**Checklist (gather or ask):**

```
Required:
[ ] Weight file(s) — .pt, .pth, .onnx, .h5, .pb, .zip — path, URL, or HuggingFace model ID
[ ] Model architecture code — for pytorch_state_dict (the Python class)
[ ] Input tensor: shape, dtype, axes, channel names, expected value range
[ ] Output tensor: shape, dtype, axes, channel names, value range
[ ] Preprocessing — zero_mean_unit_variance / scale_range / none
[ ] Postprocessing — sigmoid or none (note: `softmax` is NOT supported — embed it in `forward()` instead)
[ ] Representative test input image (any format; will be converted to .npy)
[ ] Model name — specific, human-readable (e.g. "cFOS Segmentation 2D UNet - Mouse Hippocampus")
[ ] Description — 2-4 sentences: what it does, modality, organism/tissue, training data
[ ] License — SPDX identifier: MIT, CC-BY-4.0, CC0-1.0, Apache-2.0, GPL-3.0
[ ] Author name(s)

Optional but strongly recommended:
[ ] Author ORCID, GitHub username, affiliation
[ ] Citation DOI or URL (paper)
[ ] Tags (modality, task, architecture, framework, organism)
[ ] Git repository URL
[ ] Documentation / README
[ ] Cover image (PNG/JPG, 2:1 aspect, <500KB)
[ ] Hypha token for submission (ask at submission time; never store or log)
```

**If test input not provided:** generate a random tensor from the shape spec.  
**If cover image not provided:** generate side-by-side input/output visualization with matplotlib.

**Downloading from HuggingFace:**
```bash
pip install -q huggingface_hub
python -c "
from huggingface_hub import hf_hub_download, list_repo_files
files = list(list_repo_files('OWNER/REPO'))
print('\\n'.join(files))
"
# Download specific file:
python -c "
from huggingface_hub import hf_hub_download
path = hf_hub_download(repo_id='OWNER/REPO', filename='weights.onnx')
print(path)
"
```

**Downloading from Zenodo:**
```bash
# Files are at: https://zenodo.org/records/RECORD_ID/files/FILENAME
curl -L "https://zenodo.org/records/RECORD_ID/files/FILENAME" -o FILENAME
```

---

## Phase 2 — Build the Package

> **Note:** Run the commands in this phase from the **`bioimage.io` repository root** (the directory that contains the `public/skills/` folder). If the skill was loaded from a URL rather than the local repo, download the scripts directory first or adjust paths accordingly.

```bash
mkdir -p model_package
```

1. Copy/download weight file(s) into `model_package/`
2. Copy architecture `.py` file (if pytorch_state_dict)
3. Compute SHA256 for all files:
   ```bash
   python public/skills/bioimageio-models/scripts/compute_sha256.py model_package/
   ```
4. Generate test tensors if not provided:
   ```bash
   # Basic usage (random input):
   python public/skills/bioimageio-models/scripts/generate_test_tensors.py \
     --model model_package/weights.pt --arch model_package/model.py \
     --class MyModel --input-shape "1,1,256,256" --output model_package/

   # If model constructor takes arguments (e.g. in_channels, depth):
   python public/skills/bioimageio-models/scripts/generate_test_tensors.py \
     --model model_package/weights.pt --arch model_package/model.py \
     --class UNet2D --kwargs '{"in_channels": 1, "out_channels": 1, "depth": 4}' \
     --input-shape "1,1,256,256" --output model_package/

   # Skip normalization (for pre-normalized data):
   python public/skills/bioimageio-models/scripts/generate_test_tensors.py \
     --model model_package/weights.pt --arch model_package/model.py \
     --class MyModel --skip-normalize --input-shape "1,1,256,256" --output model_package/
   ```
5. Write `model_package/bioimageio.yaml` — see [references/model-spec-reference.md](references/model-spec-reference.md)
6. Write `model_package/README.md` — must contain these sections:
   - `## Description` — what the model does, modality, organism
   - `## Intended Use` — what tasks it is suitable for, known limitations
   - `## Validation` (exact heading, required by `bioimageio test`) — mention test results
   - `## Citation` — reference the paper

Full field reference and annotated example:
- [references/model-spec-reference.md](references/model-spec-reference.md)
- [references/example-rdf.yaml](references/example-rdf.yaml)

---

## Phase 3 — Static Validation

```bash
pip install -q bioimageio.spec
python -c "
from bioimageio.spec import load_description
desc = load_description('model_package/bioimageio.yaml')
print('✓ Static validation passed:', type(desc).__name__)
"
```

Fix errors and retry. Common issues:
- Missing `sha256` for a referenced file — run `compute_sha256.py` and update the YAML
- Wrong `format_version` — use `0.5.4`
- Duplicate axis `id` values **within** a single tensor (same IDs across input/output tensors is fine)
- `pytorch_state_dict` must NOT have a `parent` field
- `softmax` is NOT a valid postprocessing operation — embed it inside the model's `forward()`
- `covers` must be a plain list of string paths: `["cover.png"]` — do NOT use `source:`/`sha256:` dicts (those are only for `test_tensor`)
- `SizeReference` has NO `scale` field — cannot express "output = input/2". For models with stride/grid > 1 (e.g., StarDist grid=2), use fixed output sizes instead of a reference

---

## Phase 4 — Dynamic Testing

> **Python version requirement:** `bioimageio.core >= 0.8` requires **Python 3.10+**. If you are on Python 3.8 or 3.9, pin to an older version: `pip install "bioimageio.core==0.6.9" "bioimageio.spec==0.5.3.2"`. On Python 3.10+, the latest versions work: `pip install "bioimageio.spec==0.5.4.3" "bioimageio.core==0.9.0"`.

```bash
pip install -q "bioimageio.spec==0.5.4.3" "bioimageio.core==0.9.0"
bioimageio test model_package/bioimageio.yaml
```

Or with conda (handles Python version automatically):
```bash
conda create -n bioimageio -c conda-forge bioimageio.core -y
conda run -n bioimageio bioimageio test model_package/bioimageio.yaml
```

Loads the model, runs on `test_input.npy`, compares to `test_output.npy`.  
Fix shape/dtype/preprocessing errors and rerun.

Common dynamic test failures:
- `__init__() got an unexpected keyword argument 'ignore_cleanup_errors'` — Python 3.8/3.9 with `bioimageio.core >= 0.8`. Use the pinned versions above or upgrade to Python 3.10+.
- `torch.load(weights_only=True) failed` — weights contain numpy/metadata; extract pure state dict:
  ```python
  checkpoint = torch.load('original.pth', weights_only=False)
  torch.save(checkpoint['model'], 'weights.pt')  # or checkpoint['state_dict'], etc.
  ```
- `test output does not match` — regenerate `test_output.npy` by running the model on `test_input.npy`
- `shape mismatch` — check that `test_input.npy` shape matches the `axes` spec exactly

---

## Phase 5 — Submit to the Zoo

See [references/submission-guide.md](references/submission-guide.md) for the full script.

1. Ask the user for their Hypha token (from https://hypha.aicell.io — sign in with GitHub/Google)
2. Run the submission script from the reference guide — it uploads the package and creates a staged artifact
3. Note the returned `artifact_id` (e.g. `bioimage-io/affable-shark`) — you need it for Phase 6

---

## Phase 6 — Remote Test, Fix, and Request Review

This phase is **mandatory**. After uploading, run the BioEngine test on the staged model, fix any
failures, then submit for curator review. Do not skip review — without it, the model stays invisible.

### Step 6a — Run BioEngine remote test on the staged artifact

The BioEngine test runs the model on managed GPU infrastructure and compares outputs to the
test tensors you provided. Use the `bioimage-io/model-runner` service with `stage=True`:

```python
import asyncio
import json
from hypha_rpc import connect_to_server

async def run_bioengine_test(artifact_id: str, token: str):
    """
    artifact_id: e.g. "bioimage-io/affable-shark"
    stage=True tells the runner to load from staging (not the public collection)
    """
    async with connect_to_server({
        "server_url": "https://hypha.aicell.io",
        "token": token,
        "method_timeout": 300,   # tests can take several minutes
    }) as server:
        runner = await server.get_service(
            "bioimage-io/model-runner",
            {"mode": "select:min:get_load"},
        )
        # model_id is the short alias only (no "bioimage-io/" prefix)
        model_id = artifact_id.split("/")[-1]
        test_report = await asyncio.wait_for(
            runner.test(
                model_id=model_id,
                stage=True,              # load from staging, not published collection
                skip_cache=True,
                publish_test_report=False,  # don't write back to artifact yet
            ),
            timeout=300,
        )
        print("Status:", test_report.get("status"))
        print(json.dumps(test_report, indent=2))
        return test_report

report = asyncio.run(run_bioengine_test("bioimage-io/affable-shark", token="YOUR_TOKEN"))
```

**Test report statuses:**
- `passed` — all outputs matched; proceed to Step 6b
- `valid-format` — YAML valid but inference not confirmed; check details
- `failed` — output mismatch or runtime error; see Step 6a-fix
- `service-timeout` — took > 5 min; retry once, then contact maintainers
- `service-error` — BioEngine infrastructure error; retry once

### Step 6a-fix — Fixing remote test failures

If the remote test fails, update the staged artifact (no need to re-create it):

```python
import asyncio, yaml, hashlib, httpx
from pathlib import Path
from hypha_rpc import connect_to_server

async def reupload_files(artifact_id: str, token: str, package_dir: str):
    package = Path(package_dir)
    async with connect_to_server({
        "server_url": "https://hypha.aicell.io",
        "token": token,
        "method_timeout": 120,
    }) as server:
        am = await server.get_service("public/artifact-manager")

        # Update manifest if bioimageio.yaml changed
        with open(package / "bioimageio.yaml") as f:
            manifest = yaml.safe_load(f)
        await am.edit(
            artifact_id=artifact_id,
            manifest=manifest,
            stage=True,
        )

        # Re-upload changed files
        async with httpx.AsyncClient(timeout=300) as client:
            for file_path in package.rglob("*"):
                if not file_path.is_file() or "__pycache__" in file_path.parts:
                    continue
                rel = str(file_path.relative_to(package))
                put_url = await am.put_file(artifact_id=artifact_id, file_path=rel)
                with open(file_path, "rb") as fobj:
                    await client.put(put_url, content=fobj.read(), headers={"Content-Type": ""})
                print(f"  ✓ re-uploaded {rel}")

asyncio.run(reupload_files("bioimage-io/affable-shark", token="YOUR_TOKEN", package_dir="model_package/"))
```

After re-uploading, re-run Step 6a. Repeat until the status is `passed` or `valid-format`.

### Step 6b — Request curator review

Once the BioEngine test passes, set `status: "request-review"` in the staged manifest.
This makes the model visible to curators in the review queue:

```python
import asyncio, yaml
from hypha_rpc import connect_to_server

async def request_review(artifact_id: str, token: str, package_dir: str):
    with open(f"{package_dir}/bioimageio.yaml") as f:
        manifest = yaml.safe_load(f)

    async with connect_to_server({
        "server_url": "https://hypha.aicell.io",
        "token": token,
        "method_timeout": 120,
    }) as server:
        am = await server.get_service("public/artifact-manager")
        await am.edit(
            artifact_id=artifact_id,
            version="stage",
            manifest={**manifest, "status": "request-review"},
        )
        print(f"Review requested for {artifact_id}")
        print(f"Track status: https://bioimage.io/#/upload?artifact_id={artifact_id}&stage=true")

asyncio.run(request_review("bioimage-io/affable-shark", token="YOUR_TOKEN", package_dir="model_package/"))
```

**What happens next (curator side):**
- Curators see the model in their review queue
- They may set status to `in-review`, `revision` (needs fixes), or `accepted`
- If `revision`: fix issues, re-upload, re-run BioEngine test, then call `request_review` again
- Once `accepted`, the curator commits and publishes (gets a DOI via Zenodo)

**Typical review time:** 1–5 business days.

---

## Phase 7 — Audit & Report Improvements

**This phase is mandatory.** After completing the submission (success or failure), review your running log and report issues. This is how the BioImage Model Zoo infrastructure keeps improving.

### 7a — Report spec/validation issues

If you found the YAML spec unclear, a validation error message unhelpful, or a required field underdocumented:

```bash
# Open an issue on the spec repo
gh issue create \
  --repo bioimage-io/spec-bioimage-io \
  --title "YOUR TITLE HERE" \
  --body "$(cat <<'EOF'
## Problem
[Describe exactly what was confusing or broken]

## Steps to reproduce
[Paste the bioimageio.yaml section or the error message]

## Expected behavior
[What should have happened instead]

## Environment
- bioimageio.spec version: $(python -c "import bioimageio.spec; print(bioimageio.spec.__version__)")
- bioimageio.core version: $(python -c "import bioimageio.core; print(bioimageio.core.__version__)")
- Python: $(python --version)
- Model type: [PyTorch / TF / ONNX]
EOF
)"
```

Or create the issue at: https://github.com/bioimage-io/spec-bioimage-io/issues

### 7b — Report core library issues

If `bioimageio test` crashed, gave wrong results, or failed for unclear reasons:

```bash
gh issue create \
  --repo bioimage-io/core-bioimage-io-python \
  --title "Test failure: [brief description]" \
  --body "$(cat <<'EOF'
## Error
[Full traceback from bioimageio test]

## Model details
[format_version, weight format, preprocessing steps]

## Reproduction
[Minimal bioimageio.yaml that reproduces the issue]
EOF
)"
```

Or: https://github.com/bioimage-io/core-bioimage-io-python/issues

### 7c — Report website / submission issues

If the upload process, the Hypha API, or the bioimage.io website had problems:

```bash
gh issue create \
  --repo bioimage-io/bioimage.io \
  --title "[Upload/API] YOUR ISSUE" \
  --body "..."
```

Or: https://github.com/bioimage-io/bioimage.io/issues

### 7d — Propose improvements to this skill

If these instructions were confusing, incomplete, or missing key steps, open a PR or issue to improve the skill itself:

```bash
gh issue create \
  --repo bioimage-io/bioimage.io \
  --title "[Skill] bioimageio-models: [what to improve]" \
  --body "$(cat <<'EOF'
## What was confusing / missing
[Describe the gap in the skill instructions]

## Where in the skill
[Phase X, file references/..., etc.]

## Suggested improvement
[Draft the improved text or instructions]

## Model submitted
[What model you were packaging — helps reproduce the scenario]
EOF
)"
```

Skill source: `public/skills/bioimageio-models/` in https://github.com/bioimage-io/bioimage.io

### 7e — Add your model as a success example

If the submission succeeded, document it so future agents can learn from it. Add a note to the skill:

```bash
# Append your successful example to references/success-examples.md
cat >> skills/bioimageio-models/references/success-examples.md <<'EOF'

## [Model Name] — [Date]
- **Source**: [HuggingFace/Zenodo URL]
- **Weight format**: [pytorch_state_dict / onnx / tensorflow_saved_model_bundle]
- **Key challenge**: [What was the hardest part]
- **What worked**: [The approach that solved it]
- **bioimageio.yaml snippet** (if notable):
```yaml
[paste relevant section]
```
EOF
```

---

## If Stuck (after 3 retries at any phase)

1. Summarize the exact error and what you tried
2. Check [references/success-examples.md](references/success-examples.md) for similar cases
3. Tell the user the specific manual step needed
4. File a GitHub issue (Phase 7) with the error details
5. Share a pre-filled issue URL with the user so they can provide more context

---

## Key Reference Files

| File | When to Read |
|------|-------------|
| [references/model-spec-reference.md](references/model-spec-reference.md) | Writing `bioimageio.yaml` — all fields explained |
| [references/example-rdf.yaml](references/example-rdf.yaml) | Annotated example to copy from |
| [references/submission-guide.md](references/submission-guide.md) | Hypha API calls for submission |
| [references/success-examples.md](references/success-examples.md) | Real worked examples from past submissions |
| [scripts/compute_sha256.py](scripts/compute_sha256.py) | SHA256 hash utility |
| [scripts/generate_test_tensors.py](scripts/generate_test_tensors.py) | Generate test_input/output .npy files |
| [scripts/validate_package.sh](scripts/validate_package.sh) | One-shot validation runner |
