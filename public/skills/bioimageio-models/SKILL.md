---
name: bioimageio-models
description: Packages, validates, and submits deep learning models to the BioImage Model Zoo (bioimage.io). Use when a user wants to contribute a trained model to the BioImage Model Zoo, convert model weights to the bioimageio format, create a rdf.yaml manifest, validate a model package, or upload a model to bioimage.io.
compatibility: Designed for Claude Code, Gemini CLI, or any agentic AI assistant with file system and bash access. Requires Python 3.8+ and internet access for submission.
metadata:
  author: bioimage-io
  version: "1.8"
---

# BioImage Model Zoo — Model Contribution Agent

You are an expert assistant helping a researcher contribute their trained deep learning model to the **BioImage Model Zoo** (https://bioimage.io). The Zoo hosts standardized, FAIR AI models for microscopy image analysis, deployed across tools like ilastik, deepImageJ, QuPath, Fiji, and napari.

Your job: gather information, build a valid `rdf.yaml` package, validate it, submit it, and **report any issues you encounter along the way** so the Zoo infrastructure keeps improving.

> **How to load the linked reference files.** Every `references/...` and `scripts/...` link below resolves to a raw file served from this same site (e.g. `https://bioimage.io/skills/bioimageio-models/references/example-rdf.yaml`). **Always fetch them with raw HTTP** — `curl -sSL <url>` for AI agents, or read directly if you have a local clone of the repo. **Do not use WebFetch / WebSearch** for these links: those tools return an AI-summarised digest that strips the exact YAML fields, SHA256 lines, and code you need to copy verbatim. Treat each reference file as canonical source, not as a webpage.

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
[ ] Preprocessing — prefer adaptable normalization (`zero_mean_unit_variance`, `scale_range`) over fixed values when compatible with the model; verify whether any upstream pipeline already applies it
[ ] Postprocessing — `sigmoid`, `none`, or a custom callable (Cellpose flow dynamics, StarDist NMS, custom decoders → see [references/custom-processing.md](https://bioimage.io/skills/bioimageio-models/references/custom-processing.md)); note that `softmax` is NOT a valid built-in op — embed it in `forward()` instead
[ ] Representative example image(s) for test/sample/cover use — search the source repo/model card/dataset links first, then ask the user if needed
[ ] Model name — specific, human-readable (e.g. "cFOS Segmentation 2D UNet - Mouse Hippocampus")
[ ] Description — 2-4 sentences: what it does, modality, organism/tissue, training data
[ ] License — SPDX identifier (e.g. `MIT`, `CC-BY-4.0`, `CC0-1.0`, `Apache-2.0`, `GPL-3.0`), or a custom license file descriptor for spec >= 0.5.11
[ ] Author name(s)

Optional but strongly recommended:
[ ] Author ORCID, GitHub username, affiliation
[ ] `packaged_by` person(s), especially when packagers differ from model authors
[ ] Citation DOI or URL (paper)
[ ] Tags (modality, task, architecture, framework, organism)
[ ] Git repository URL
[ ] Documentation / README
[ ] Cover image (PNG/JPG, ~2:1 aspect ratio, <500KB) and sample tensors derived from real example data where possible
[ ] Hypha token for submission (ask at submission time; never store or log)
```

**If example images are not provided:** search the model card, source repository, linked dataset, or paper assets for a permissive representative image; otherwise ask the user. Generate a random/synthetic tensor only as a last resort, and say so in the packaging log.
**If cover image not provided:** create a cover from the representative input/output/sample tensors — the spec accepts both `~2:1` (a horizontal input-then-output panel) and `1:1` (a square with input in one corner and prediction in the diagonally-opposite corner separated by a thin line). Matplotlib handles either. Avoid contact sheets, text-heavy previews, unrelated decorative imagery, and multiple cover drafts.

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

### Pick the primary weight format first

Every package has exactly one primary weight format. Decide before you copy anything — `rdf.yaml` is the source of truth for what belongs in the upload, and the primary format determines whether an architecture `.py` needs to travel with the weights.

- **`pytorch_state_dict` — preferred when the architecture can be shared cleanly.** Most transparent: reviewers and downstream users can inspect both the architecture (`.py`) and the trained weights (`.pt`). Requires a self-contained architecture file — see [architecture-rules.md](https://bioimage.io/skills/bioimageio-models/references/architecture-rules.md) for the fixed BioEngine runtime constraints. Add ONNX or TorchScript as **secondary** formats with `parent: pytorch_state_dict` to broaden backend coverage without re-declaring the model.
- **`torchscript` or `onnx` — embedded graph, no `.py`.** The architecture is baked into the weight file. Do **not** ship an architecture `.py` alongside these formats; it will be ignored at best and become stale at worst. Use when the architecture is proprietary, too complex to rewrite portably, or already exported by upstream.
- **Source checkpoints stay outside the package.** A `checkpoint.pth`, HuggingFace snapshot, or Zenodo record you started from is *provenance* — cite it in `cite:` or `training_data:`, don't copy it into `generated/`. The only weight files that belong in the package are the ones `rdf.yaml` actually references.

### Build steps

> **Note:** Resolve helper scripts relative to the directory containing this `SKILL.md`. In examples below, set `SKILL_DIR` to that directory.

```bash
mkdir -p model_package/generated
SKILL_DIR=/path/to/bioimageio-models  # directory containing this SKILL.md
printf 'generated/\n' >> model_package/.gitignore
```

1. Create a package source folder for hand-written files (`build_package.py`, architecture source, notes) and a dedicated generated package folder such as `generated/`. Add `generated/` to `.gitignore` when the work sits in a repository.
2. **Only files that `rdf.yaml` will reference belong in `generated/`.** A clean package is usually 5–9 files; if `generated/` grows past that, something is being packaged that shouldn't be.

   Keep:
   - `rdf.yaml` and `README.md`
   - The active weight file per declared format (e.g. `weights.pt` for `pytorch_state_dict`, `weights.onnx` for ONNX)
   - Architecture `.py` — **only** for `pytorch_state_dict`
   - `test_input.npy` and `test_output.npy`
   - One cover image
   - Custom license file when the license isn't SPDX-listed
   - Custom pre/postprocessing `.py` sources declared in `rdf.yaml`

   Drop:
   - Source checkpoints (`checkpoint.pth`, HF snapshots, Zenodo tarballs) — provenance goes in `cite:` / `training_data:`
   - Alternate cover drafts, source TIFFs, ground-truth references, training/validation datasets
   - Validation plots, metrics JSON, TensorBoard logs, notebooks, Fiji macros
   - `build_package.py`, helper scripts, `.gitignore`, packaging notes
   - Anything produced by Phases 5–7 (Hypha upload scripts, tokens, remote-test reports, issue drafts)

3. Copy or download the primary weight file into `generated/`. If a native `pytorch_state_dict` is available, use it as the canonical format and add ONNX/TorchScript as secondary formats with `parent: pytorch_state_dict`. Do not include source checkpoints alongside the exported weights.
4. Copy the architecture `.py` into `generated/` **only** when `pytorch_state_dict` is the primary format. TorchScript and ONNX packages omit `.py` — the graph is embedded in the weight file. Keep the source copy of the architecture outside `generated/` so rebuilds are reproducible — **see architecture rules below**.
5. Compute SHA256 for every file `rdf.yaml` will reference (weights, test tensors, architecture, cover, custom license, custom processing sources):
   ```bash
   python "$SKILL_DIR"/scripts/compute_sha256.py model_package/generated/
   ```
   The script hashes everything in the directory — copy only the hashes for files listed in `rdf.yaml`; ignore any hashes for stray files you left in `generated/`.
6. Generate test tensors if not provided:
   ```bash
   # Basic usage (random input):
   python "$SKILL_DIR"/scripts/generate_test_tensors.py \
     --model model_package/generated/weights.pt --arch model_package/generated/model.py \
     --class MyModel --input-shape "1,1,256,256" --output model_package/generated/

   # If model constructor takes arguments (e.g. in_channels, depth):
   python "$SKILL_DIR"/scripts/generate_test_tensors.py \
     --model model_package/generated/weights.pt --arch model_package/generated/model.py \
     --class UNet2D --kwargs '{"in_channels": 1, "out_channels": 1, "depth": 4}' \
     --input-shape "1,1,256,256" --output model_package/generated/

   # Skip normalization (for pre-normalized data):
   python "$SKILL_DIR"/scripts/generate_test_tensors.py \
     --model model_package/generated/weights.pt --arch model_package/generated/model.py \
     --class MyModel --skip-normalize --input-shape "1,1,256,256" --output model_package/generated/
   ```
7. Write `model_package/generated/rdf.yaml` — see [references/model-spec-reference.md](https://bioimage.io/skills/bioimageio-models/references/model-spec-reference.md). If the model needs custom pre/postprocessing (Cellpose flow dynamics, StarDist NMS, custom normalizers, or any callable that isn't a built-in op), see [references/custom-processing.md](https://bioimage.io/skills/bioimageio-models/references/custom-processing.md) for the `id: custom` pattern (inline `.py` + SHA256 vs. registered ops) — this is preferred over embedding logic in `forward()` when the extra step is data transformation rather than the model itself.
8. Write `model_package/generated/README.md` — describes the **model itself** (what it does, how to use it, provenance). Do not list files or paths; `rdf.yaml` is the source of truth for package contents, and repeating that inventory in the README is where it goes stale. Must contain these sections:
   - `## Description` — what the model does, modality, organism
   - `## Intended Use` — what tasks it is suitable for, known limitations
   - `## Validation` (exact heading, required by `bioimageio test`) — mention test results
   - `## Citation` — reference the paper

### Spec 0.5.11+ packaging notes

- Use `format_version: 0.5.11` or the latest released model spec supported by `bioimageio.core`.
- `license` may be either an SPDX identifier or a file descriptor:
  ```yaml
  license:
    source: LICENSE.md
    sha256: <sha256>
  ```
  Use a custom license file when the upstream license is not SPDX-listed.
- `covers` and `documentation` are file descriptors in current spec versions:
  ```yaml
  covers:
    - source: cover0.png
      sha256: <sha256>
  documentation:
    source: README.md
    sha256: <sha256>
  ```
- Add `packaged_by` when the packaging author differs from the model authors:
  ```yaml
  packaged_by:
    - name: "Firstname Lastname"
      github_user: githubhandle
      affiliation: "Institute"
  ```
- Set `maintainers` to the packagers by default, since they are usually the people who can fix packaging issues and update the submitted package.
- Keep all `source` paths relative to the package directory that contains `rdf.yaml`. If artifacts live in `generated/`, validate `generated/rdf.yaml`, not a stale root-level RDF.

### Test-output contract

`test_output.npy` must be generated from `test_input.npy` using exactly the preprocessing, model weights, and output postprocessing declared in `rdf.yaml`.

- Prefer generating reference outputs independently from `bioimageio.core`, as close to the model's native library/runtime as possible (for example PyTorch/Transformers/Keras/Stardist native APIs). Use `bioimageio.core` to validate the package, not as the source of truth for `test_output.npy`.
- If an upstream pipeline already applies the same preprocessing declared in `rdf.yaml`, use the pipeline directly to create `test_output.npy`.
- If the upstream pipeline applies different preprocessing, do not double-normalize or silently rely on it. Either declare the upstream preprocessing in `rdf.yaml`, or bypass the pipeline preprocessing and feed the model tensors that have been preprocessed according to the RDF.
- Inspect pipeline/image-processor configs numerically. For Hugging Face image models, check fields like `do_normalize`, `image_mean`, and `image_std`, and compare actual `pixel_values` to the intended BioImage.IO preprocessing.
- When comparing backends, first confirm outputs are correlated and shaped correctly before loosening tolerances. Device/provider changes should not create drastic differences; large drift usually means a preprocessing or output-selection mismatch.

### Preprocessing preference

- Prefer adaptable input normalization such as `zero_mean_unit_variance` or `scale_range` over fixed constants when the model can reasonably support it. Adaptive normalization is usually more portable across acquisition settings.
- Use `fixed_zero_mean_unit_variance` or `scale_linear` only when the native model contract requires fixed training statistics (for example ImageNet mean/std or published dataset statistics). If fixed values are required, document their source.
- Keep the RDF, reference-output generation, README, and packaging log consistent. Do not switch preprocessing just in the RDF without regenerating `test_output.npy`.

### Architecture file rules (pytorch_state_dict only)

If the model ships `pytorch_state_dict` weights, the architecture `.py` must be self-contained and use only the fixed set of packages pre-installed on the BioEngine model runner (`torch==2.5.1`, `torchvision==0.20.1`, `numpy==1.26.4`, `bioimageio.core==0.10.0`, `onnxruntime==1.20.1`, plus a few others — no `conda_env` support, no per-model installs). See [references/architecture-rules.md](https://bioimage.io/skills/bioimageio-models/references/architecture-rules.md) for the full list, the rules on imports / constructor args / self-containment, and Bad/Good examples. When rewriting isn't feasible (e.g. Cellpose backbones), export to TorchScript or ONNX and skip the `.py` entirely.

Full field reference and annotated example:
- [references/model-spec-reference.md](https://bioimage.io/skills/bioimageio-models/references/model-spec-reference.md)
- [references/example-rdf.yaml](https://bioimage.io/skills/bioimageio-models/references/example-rdf.yaml)

---

## Phase 3 — Static Validation

```bash
pip install -q "bioimageio.spec>=0.5.11"
python -c "
from bioimageio.spec import load_description
desc = load_description('model_package/generated/rdf.yaml')
print('✓ Static validation passed:', type(desc).__name__)
"
```

Fix errors and retry. Common issues:
- Missing `sha256` for a referenced file — run `compute_sha256.py` and update the YAML
- Wrong `format_version` — use `0.5.11` or the latest released model spec supported by the installed `bioimageio.spec` package; custom license files require `0.5.11` or newer
- Duplicate axis `id` values **within** a single tensor (same IDs across input/output tensors is fine)
- `pytorch_state_dict` must NOT have a `parent` field
- `softmax` is NOT a valid postprocessing operation — embed it inside the model's `forward()`
- Current spec versions expect file descriptors for `covers` and `documentation`; include both `source` and `sha256`
- `SizeReference` has NO `scale` field — cannot express "output = input/2". For models with stride/grid > 1 (e.g., StarDist grid=2), use fixed output sizes instead of a reference

---

## Phase 4 — Dynamic Testing

> **Python version requirement:** `bioimageio.core >= 0.8` requires **Python 3.10+** for `pytorch_state_dict` models (uses `TemporaryDirectory(ignore_cleanup_errors=True)`). For `torchscript` and `onnx` models, `bioimageio.core==0.9.0` works on Python 3.8/3.9 without downgrading. On Python 3.8/3.9 with `pytorch_state_dict`, pin to an older version: `pip install "bioimageio.core==0.6.9" "bioimageio.spec==0.5.3.2"`. On Python 3.10+, use current versions from conda-forge or `pip install "bioimageio.spec>=0.5.11" "bioimageio.core>=0.10"`.

```bash
pip install -q "bioimageio.spec>=0.5.11" "bioimageio.core>=0.10"
bioimageio test model_package/generated/rdf.yaml

# For models that use custom pre/postprocessing (id: custom, source: .py),
# opt in to executing the shipped callable:
bioimageio test model_package/generated/rdf.yaml --allow-custom-postprocessing
```

Or with conda (handles Python version automatically):
```bash
conda create -n bioimageio -c conda-forge bioimageio.core -y
conda run -n bioimageio bioimageio test model_package/generated/rdf.yaml
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
- `test output does not match` — regenerate `test_output.npy` by running the declared preprocessing + model + postprocessing on `test_input.npy`; verify upstream pipeline preprocessing before using it
- `shape mismatch` — check that `test_input.npy` shape matches the `axes` spec exactly
- ONNX passes on CPU but may fail on a device/provider such as CoreML — compare CPU vs provider outputs and record drift. Prefer generating reference outputs with the same provider used for validation, or force CPU during local validation when provider-specific numerical drift is unrelated to package correctness.

---

## Phase 5 — Submit to the Zoo

See [references/submission-guide.md](https://bioimage.io/skills/bioimageio-models/references/submission-guide.md) for the full script.

1. **Get a Hypha token** — run the login helper (it opens a browser and saves the token to `.env`):
   ```bash
   pip install -q hypha-rpc
   python https://bioimage.io/skills/bioimageio-models/scripts/hypha_login.py
   # or if running from the local repo:
   python "$SKILL_DIR"/scripts/hypha_login.py
   ```
   Then load it:
   ```bash
   export HYPHA_TOKEN=$(grep HYPHA_TOKEN .env | cut -d= -f2)
   ```
   If `HYPHA_TOKEN` is already set in the environment, skip this step.
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

        # Update manifest if rdf.yaml changed
        with open(package / "rdf.yaml") as f:
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

asyncio.run(reupload_files("bioimage-io/affable-shark", token="YOUR_TOKEN", package_dir="model_package/generated/"))
```

After re-uploading, re-run Step 6a. Repeat until the status is `passed` or `valid-format`.

### Step 6b — Request curator review

Once the BioEngine test passes, set `status: "request-review"` in the staged manifest.
This makes the model visible to curators in the review queue:

```python
import asyncio, yaml
from hypha_rpc import connect_to_server

async def request_review(artifact_id: str, token: str, package_dir: str):
    with open(f"{package_dir}/rdf.yaml") as f:
        manifest = yaml.safe_load(f)

    async with connect_to_server({
        "server_url": "https://hypha.aicell.io",
        "token": token,
        "method_timeout": 120,
    }) as server:
        am = await server.get_service("public/artifact-manager")
        await am.edit(
            artifact_id=artifact_id,
            stage=True,          # use stage=True, NOT version="stage" (causes PermissionError)
            manifest={**manifest, "status": "request-review"},
        )
        print(f"Review requested for {artifact_id}")
        print(f"Track status: https://bioimage.io/#/upload?artifact_id={artifact_id}&stage=true")

asyncio.run(request_review("bioimage-io/affable-shark", token="YOUR_TOKEN", package_dir="model_package/generated/"))
```

**What happens next (curator side):**
- Curators see the model in their review queue
- They may set status to `in-review`, `revision` (needs fixes), or `accepted`
- If `revision`: fix issues, re-upload, re-run BioEngine test, then call `request_review` again
- Once `accepted`, the curator commits and publishes (gets a DOI via Zenodo)

**Typical review time:** 1–5 business days.

---

## Phase 7 — Audit & Report Improvements

**This phase is mandatory.** After the submission (success or failure), walk your running log and file the reports below. This is how the BioImage Model Zoo infrastructure keeps improving. All boilerplate — `gh issue create` bodies for each target repo and the success-example template — lives in [references/audit-templates.md](https://bioimage.io/skills/bioimageio-models/references/audit-templates.md); copy from there rather than authoring from scratch.

- **7a — Spec / validation issues** (unclear field, unhelpful validation error, missing docs) → file against `bioimage-io/spec-bioimage-io`.
- **7b — Core library issues** (`bioimageio test` crashed or gave wrong results) → file against `bioimage-io/core-bioimage-io-python`.
- **7c — Website / submission issues** (upload flow, Hypha API, bioimage.io UI) → file against `bioimage-io/bioimage.io`.
- **7d — Skill improvements** — if these instructions were confusing or missing steps, file against `bioimage-io/bioimage.io` with a concrete draft of the improved text. Skill source lives at `public/skills/bioimageio-models/`.
- **7e — Success example** — on a successful submission, append the model to [references/success-examples.md](https://bioimage.io/skills/bioimageio-models/references/success-examples.md) so future runs can learn from what worked. Use the append template in `audit-templates.md`.

---

## If Stuck (after 3 retries at any phase)

1. Summarize the exact error and what you tried
2. Check [references/success-examples.md](https://bioimage.io/skills/bioimageio-models/references/success-examples.md) for similar cases
3. Tell the user the specific manual step needed
4. File a GitHub issue (Phase 7) with the error details
5. Share a pre-filled issue URL with the user so they can provide more context

---

## Key Reference Files

| File | When to Read |
|------|-------------|
| [references/model-spec-reference.md](https://bioimage.io/skills/bioimageio-models/references/model-spec-reference.md) | Writing `rdf.yaml` — all fields explained |
| [references/example-rdf.yaml](https://bioimage.io/skills/bioimageio-models/references/example-rdf.yaml) | Annotated example to copy from |
| [references/architecture-rules.md](https://bioimage.io/skills/bioimageio-models/references/architecture-rules.md) | `pytorch_state_dict` architecture `.py` constraints, allowed packages, Bad/Good examples |
| [references/custom-processing.md](https://bioimage.io/skills/bioimageio-models/references/custom-processing.md) | Custom pre/postprocessing ops (Cellpose flow dynamics, StarDist NMS, custom normalizers), the SHA256 security model, and inline `.py` vs. registered patterns (spec 0.5.10+) |
| [references/submission-guide.md](https://bioimage.io/skills/bioimageio-models/references/submission-guide.md) | Hypha API calls for submission |
| [references/audit-templates.md](https://bioimage.io/skills/bioimageio-models/references/audit-templates.md) | `gh issue create` bodies for Phase 7 audit + success-example append template |
| [references/success-examples.md](https://bioimage.io/skills/bioimageio-models/references/success-examples.md) | Real worked examples from past submissions |
| [scripts/hypha_login.py](https://bioimage.io/skills/bioimageio-models/scripts/hypha_login.py) | Log in to Hypha and save token to `.env` |
| [scripts/compute_sha256.py](https://bioimage.io/skills/bioimageio-models/scripts/compute_sha256.py) | SHA256 hash utility |
| [scripts/generate_test_tensors.py](https://bioimage.io/skills/bioimageio-models/scripts/generate_test_tensors.py) | Generate test_input/output .npy files |
| [scripts/validate_package.sh](https://bioimage.io/skills/bioimageio-models/scripts/validate_package.sh) | One-shot validation runner |
