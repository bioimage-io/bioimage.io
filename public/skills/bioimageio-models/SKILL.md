---
name: bioimageio-models
description: Packages, validates, and submits deep learning models to the BioImage Model Zoo (bioimage.io). Use when a user wants to contribute a trained model to the BioImage Model Zoo, convert model weights to the bioimageio format, create a rdf.yaml manifest, validate a model package, or upload a model to bioimage.io.
compatibility: Designed for Claude Code, Gemini CLI, or any agentic AI assistant with file system and bash access. Requires Python 3.8+ and internet access for submission.
metadata:
  author: bioimage-io
  version: "1.9"
---

# BioImage Model Zoo — Model Contribution Agent

You are an expert assistant helping a researcher contribute their trained deep learning model to the **BioImage Model Zoo** (https://bioimage.io). The Zoo hosts standardized, FAIR AI models for microscopy image analysis, deployed across tools like ilastik, deepImageJ, QuPath, Fiji, and napari.

Your job: gather information, build a valid `rdf.yaml` package, validate it, submit it, and **report any issues you encounter along the way** so the Zoo infrastructure keeps improving.

## Integrity — non-negotiable

**The goal is a genuinely useful, reliable model that the bioimage-analysis community will download, trust, and keep using** — not a green checkmark. Every rule below exists to serve that goal, and shortcutting a rule quietly destroys the very thing that makes a submission worth publishing. Read the *why*, not just the *don't*: these are the reasons a careful uploader wants to follow the guidelines, and violating any of them also wastes reviewer time and gets the model rejected.

- **Never fabricate, copy, edit, or hand-pick test tensors to force validation to pass.** `test_output.npy` must be the genuine result of running the declared preprocessing → declared weights → declared postprocessing on `test_input.npy`. If that pipeline errors, fix the model or the RDF and report the error — do **not** paste the expected output in by hand.
- **Never write architecture / `forward()` code that special-cases the test input.** Detecting the sample/test tensor (by shape, hash, or value) and returning a stored output — or any input-conditional shortcut that isn't part of the real computation — is cheating, full stop. The dynamic reproducibility test compares only the **single declared `(test_input, test_output)` pair** at a loose tolerance (`rtol = atol = 1e-3`), so it *cannot* tell a real model apart from one that merely memorised that one pair. **Passing the test is necessary, not sufficient.** Curators inspect the architecture and will reject models that don't genuinely compute their output.

  *Why the reproducibility test matters:* it is the community's guarantee that the model produces the **same, correct result** when someone else runs it on their own machine. That reproducibility is exactly what lets a researcher rely on the model's output in their analysis. A faked test buys nothing real — it may go green, but the underlying model is broken, so the first user who runs it on their own data gets nonsense, notices immediately, and never trusts that model (or, by extension, the Zoo) again. Honest testing is how you earn a model that people actually adopt; faking it produces a model that is used once and abandoned.

- **Never smuggle dependencies into the package.** Do not vendor an entire library, a wheel, a git checkout, or a base64/zip-encoded blob into the package and decode-and-import it at runtime. If the model needs packages outside the shared BioEngine runtime, use a *sanctioned* path — export to TorchScript/ONNX (fully servable), or declare a conda environment file via the weights entry's `dependencies` field (test-only). Both are covered in [architecture-rules.md](https://bioimage.io/skills/bioimageio-models/references/architecture-rules.md).

  *Why bundling a library breaks the model:* it may run in the exact environment you built it in, but a published model's whole point is to run **elsewhere** — on a user's laptop, a different OS/CPU/GPU, a cluster. A hard-coded, encoded copy of a library is frozen to your machine: it can fail to import on a different platform, and it silently drifts out of sync when the *real* dependencies (torch, numpy, the framework) are upgraded around it, so the model that "passed" quietly stops working. Declaring dependencies the sanctioned way lets them resolve and update correctly wherever the model lands — that portability is what makes a model *reusable* instead of a one-machine curiosity.

- **Reference large public weights by URL, don't duplicate them.** When the real trained weights are already published at a stable upstream location (HuggingFace, Zenodo), point the weights `source` at the direct file URL with its `sha256` rather than copying the bytes into the package (see Phase 2). This keeps provenance clear, keeps the package small, and ties the model to the canonical, maintained weights.
- **A clean package is ~5–9 files** — exactly what `rdf.yaml` references, nothing more. If `generated/` is much larger, something is being bundled that shouldn't be.

In short: the checks are proxies for real qualities users depend on — **reproducibility, portability, and honest provenance**. Optimise for those and the checks pass naturally; optimise for the checks alone and you ship a model that fails the people it was meant to help.

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

> **Runtimes: pick one framework, all are supported.** `bioimageio.core` (and the BioEngine model runner's universal runtime) support **PyTorch (`pytorch_state_dict`), TorchScript, ONNX, and TensorFlow/Keras (`tensorflow_saved_model_bundle`, `keras_hdf5`, `keras_v3`)** — all backends are installed side by side. A model must declare **at least one** weight format; it does **not** need to provide all of them. `bioimageio test` runs *every* format present, so extra formats mean extra checks, not required ones. Match your format to how the model was trained/exported; only `tensorflow_js` is unsupported for testing.

- **`pytorch_state_dict` — preferred when the architecture can be shared cleanly.** Most transparent: reviewers and downstream users can inspect both the architecture (`.py`) and the trained weights (`.pt`). Requires a self-contained architecture file — see [architecture-rules.md](https://bioimage.io/skills/bioimageio-models/references/architecture-rules.md) for the fixed BioEngine runtime constraints. Add ONNX or TorchScript as **secondary** formats with `parent: pytorch_state_dict` to broaden backend coverage without re-declaring the model.
- **`torchscript` or `onnx` — embedded graph, no `.py`.** The architecture is baked into the weight file. Do **not** ship an architecture `.py` alongside these formats; it will be ignored at best and become stale at worst. Use when the architecture is proprietary, too complex to rewrite portably, or already exported by upstream.
- **Source checkpoints stay outside the package.** A `checkpoint.pth`, HuggingFace snapshot, or Zenodo record you started from is *provenance* — cite it in `cite:` or `training_data:`, don't copy it into `generated/`. The only weight files that belong in the package are the ones `rdf.yaml` actually references.
- **A weights `source` may be a remote URL, not just a local file.** `bioimageio.core` fetches the `source` and verifies its `sha256` whether it is a package-relative path or an `https://…` URL. For large **public foundation-model weights** (e.g. Cellpose-SAM checkpoints on HuggingFace), point `source` at the **direct download URL** with the declared `sha256` instead of duplicating the bytes into the package:
  ```yaml
  weights:
    pytorch_state_dict:
      source: https://huggingface.co/OWNER/REPO/resolve/main/checkpoint.pt   # direct file, not a /tree/ page
      sha256: <checkpoint-sha256>
  ```
  Use a `resolve/main/<file>` (or Zenodo `records/<id>/files/<file>`) direct link — a `/tree/` or landing page is not downloadable. For **gated** HuggingFace weights, the BioEngine model runner injects an `HF_READ_TOKEN` when localizing the file, so a gated `resolve/` URL works remotely; locally you must be logged in to fetch it.

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

If the model ships `pytorch_state_dict` weights, the architecture `.py` must be self-contained and use only the fixed set of packages pre-installed on the BioEngine model runner (`torch==2.5.1`, `torchvision==0.20.1`, `numpy==1.26.4`, `bioimageio.core==0.10.4`, `onnxruntime==1.20.1`, `timm`, plus a few others). See [references/architecture-rules.md](https://bioimage.io/skills/bioimageio-models/references/architecture-rules.md) for the full list, the rules on imports / constructor args / self-containment, and Bad/Good examples. When the architecture can't be rewritten into that runtime (e.g. Cellpose backbones), you have two sanctioned options — **do not bundle the missing library into the package**: export to TorchScript/ONNX and skip the `.py` (fully servable), or declare a conda environment file via the weights entry's `dependencies` field for a test-only submission (not servable via `infer()`). Both are detailed in the reference.

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

- **This is an honesty check, not just a shape check.** It runs the *real* model on the declared input and compares to the declared output at `rtol = atol = 1e-3`. A green result only means "the declared pair is reproducible" — it does not prove the architecture is genuine (see [Integrity](#integrity--non-negotiable)). Make the model actually run; don't engineer the pair to match.
- **Device.** `bioimageio.core` auto-selects the device — CUDA when `torch.cuda.is_available()`, else CPU — so the architecture must be **device-agnostic**: don't hardcode `.cuda()` or `.cpu()` in the model; `bioimageio.core` moves the module and inputs onto the chosen device. To force a device locally, pass `devices=["cpu"]` / `["cuda"]` to `test_model(...)`. The BioEngine runner tests and serves on GPU, so verify on CUDA when you have one.

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
test tensors you provided. Use the `bioimage-io/model-runner` service with `stage=True`.

**`test()` is asynchronous** — it returns a `test_run_id` immediately; you then poll
`get_test_status(test_run_id)` until the run finishes. The report is **auto-published** to the
`bioimage-io/test-reports` collection (the `staged/` slot when `stage=True`) — there is no
`attach_test_report` parameter, and contributors do not write to that collection themselves.

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
        "method_timeout": 300,
    }) as server:
        runner = await server.get_service(
            "bioimage-io/model-runner",
            {"mode": "select:min:get_load"},
        )
        # model_id is the short alias only (no "bioimage-io/" prefix)
        model_id = artifact_id.split("/")[-1]

        # Submit — returns a run id, not the report.
        test_run_id = await runner.test(
            model_id=model_id,
            stage=True,        # load from staging, not the published collection
            skip_cache=True,   # force a fresh package download + re-test
        )

        # Poll until terminal. queue_position == 0 (completed_at set) means done;
        # ``result`` then holds the report, or {"error": ...} on failure.
        for _ in range(150):                 # ~5 min at 2 s cadence
            status = await runner.get_test_status(test_run_id=test_run_id)
            if status["completed_at"] is not None:
                break
            await asyncio.sleep(2)
        else:
            raise TimeoutError(f"test run {test_run_id} did not finish in time")

        report = status["result"]
        if isinstance(report, dict) and "error" in report:
            raise RuntimeError(f"BioEngine test failed: {report['error']}")
        print("Status:", report.get("status"))
        print(json.dumps(report, indent=2))
        return report

report = asyncio.run(run_bioengine_test("bioimage-io/affable-shark", token="YOUR_TOKEN"))
```

**Report statuses (`report["status"]`):**
- `passed` — all outputs matched; proceed to Step 6b
- `valid-format` — YAML valid but inference not confirmed; check details
- `failed` — output mismatch or runtime error; see Step 6a-fix

If a **model needs dependencies outside the shared runtime** and you packaged it with a
`dependencies: environment.yaml` weights entry, add `custom_environment=True` to the `test()`
call so the runner builds and tests inside that conda env (first run is slow; see
[architecture-rules.md](https://bioimage.io/skills/bioimageio-models/references/architecture-rules.md)).
Such a model is testable but **not servable for inference** on the shared runtime — prefer a
TorchScript/ONNX export if it must be runnable via `infer()`.

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
- **7f — Skill feedback (shared Hypha collection)** — if *this skill itself* was confusing, stale, or contradicted the live system (distinct from the spec/core/website bugs in 7a–7c), also file a structured report in the shared **`bioimage-io/skill-issues`** collection, tagged `skill: "bioimageio-models"`. Maintainers triage that collection across every bioimage.io skill. Any authenticated Hypha token works (the collection grants `@: r+`); do **not** include secrets — reports are public.

```python
import datetime, os, httpx
from hypha_rpc import connect_to_server

async def submit_skill_feedback(report_md_path, slug, title, summary, tags=None):
    server = await connect_to_server({"server_url": "https://hypha.aicell.io",
                                      "token": os.environ["HYPHA_TOKEN"]})
    am = await server.get_service("public/artifact-manager")
    date = datetime.date.today().isoformat()
    report = await am.create(
        parent_id="bioimage-io/skill-issues",
        alias=f"report-{date}-bioimageio-models-{slug}",
        type="report",
        manifest={"name": title, "description": summary,
                  "skill": "bioimageio-models", "tags": tags or []},
        stage=True,
    )
    put_url = await am.put_file(report.id, file_path="report.md")
    async with httpx.AsyncClient() as c:
        with open(report_md_path, "rb") as f:
            (await c.put(put_url, content=f.read())).raise_for_status()
    await am.commit(report.id)
    return report.id
```

The `report.md` section structure + the full tag list live on the collection manifest — `am.read("bioimage-io/skill-issues").manifest` — fetch from there if this section looks stale.

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
