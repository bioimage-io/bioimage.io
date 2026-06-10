# BioEngine Model Runner

Inference and discovery service for [BioImage.IO Model Zoo](https://bioimage.io) models. Runs on remote BioEngine workers — no local GPU required.

## Use this skill when

- The user wants to run a known BioImage.IO model on an image.
- The user wants to find candidate models for a task (e.g. nuclei segmentation, denoising).
- The user wants to compare multiple models against ground truth.
- The user wants to validate a model RDF or run BioImage.IO compliance tests.

## Setup

Install the CLI (Python ≥ 3.11):

```bash
pip install "bioengine[cli] @ git+https://github.com/aicell-lab/bioengine.git"
```

## Service ID — discover before calling

The model-runner is deployed on one or more BioEngine workers in the `bioimage-io` workspace. **Don't try to call `bioimage-io/model-runner` directly** — that short form is the WebRTC offer proxy and exposes only `{offer}`, not the model-runner methods. The callable service ID is the per-worker per-replica form:

```
bioimage-io/bioengine-worker-<site>-<hash>-<replica>:model-runner
```

Find the concrete ID via the worker:

```python
from hypha_rpc import connect_to_server
s = await connect_to_server({"server_url": "https://hypha.aicell.io", "token": token,
                             "workspace": "bioimage-io"})

# 1. Pick a worker (KTH and deNBI both run model-runner today):
workers = [sv["id"] for sv in await s.list_services({"type": "bioengine-worker"})]

# 2. Get the concrete app service ID from the worker:
worker = await s.get_service(workers[0])
status = await worker.get_app_status(None)
mr_sid = status["model-runner"]["service_ids"]["websocket_service_id"]
#   → "bioimage-io/bioengine-worker-kth-<hash>-<replica>:model-runner"

# 3. Get the actual model-runner service:
mr = await s.get_service(mr_sid)
```

Throughout this skill, references to the **CLI form `bioengine call bioimage-io/model-runner <method>`** are shorthand for the resolved concrete ID. In practice you need to first set `BIOENGINE_WORKER_SERVICE_ID=<concrete-worker-id>` and pass the per-replica service ID to `bioengine call`. The Python `mr` handle above is the more direct path.

If the user has their own worker, the same recipe applies — substitute their workspace and worker client_id.

## CLI reference

The `bioengine call` command is the generic interface for calling any service method. Model-runner specific operations map to service methods called via `bioengine call`:

| Operation | Command |
|---|---|
| Search models | `bioengine call bioimage-io/model-runner search_models --args '{"keywords": [...], "limit": 10}' --json` |
| Model metadata/RDF | `bioengine call bioimage-io/model-runner get_model_rdf --args '{"model_id": "<id>"}' --json` |
| Model documentation | `bioengine call bioimage-io/model-runner get_model_documentation --args '{"model_id": "<id>"}' --json` |
| Validate RDF | `bioengine call bioimage-io/model-runner validate --args '{"model_id": "<id>"}' --json` |
| Test model | `bioengine call bioimage-io/model-runner test --args '{"model_id": "<id>"}' --json` |
| Run inference | `bioengine call <ws>/<worker_client_id>-<replica_id>:model-runner infer --args '{"model_id": "<id>", "inputs": "<url-or-tensor>"}' --json` (resolve the concrete service ID as shown above) |
| List methods | `bioengine call bioimage-io/model-runner --list-methods` |

All commands accept `--json` for machine-parseable output.

## Default operating mode

- Use the CLI for all operations — it handles upload, RPC connection, and download automatically.
- Input formats: `.npy` (lossless, preferred), `.tif`/`.tiff`, `.png`.
- Output format: `.npy` by default; `.tif` if output path ends in `.tif`.
- Default to models that pass BioImage.IO checks (omit `--ignore-checks` unless necessary).
- **Output keys vary by model** — read `outputs[0].id` from the RDF via `bioengine runner info`, not assume `"output0"`.
- **Search keywords**: AND-matched against model tags. If a keyword like `"denoising"` returns few results, try synonyms: `"restoration"`, `"noise"`. Use `assets/search_keywords.yaml` for known working presets.
- **RDF objects**: `get_model_rdf` via RPC returns `ObjectProxy` (not plain dict). JSON-serialize with `json.dumps(rdf, default=str)` if needed.

## Single model inference workflow

```text
- [ ] Step 1: Search for models — bioengine runner search --keywords <task>
- [ ] Step 2: Inspect the best candidate — bioengine runner info <model-id>
- [ ] Step 3: Read model documentation — get_model_documentation(model_id) — verify domain compatibility
- [ ] Step 4: Run inference — bioengine runner infer <model-id> --input image.tif --output result.npy
- [ ] Step 5: Validate output — load result.npy with numpy, check shape and values
```

```bash
# Full example (CLI form — assumes BIOENGINE_WORKER_SERVICE_ID is set
# to a concrete worker like bioimage-io/bioengine-worker-kth-<hash>:bioengine-worker):
bioengine call <model-runner-concrete-svc-id> search_models \
    --args '{"keywords": ["nuclei", "segmentation"], "limit": 5}' --json
bioengine call <model-runner-concrete-svc-id> get_model_rdf \
    --args '{"model_id": "affable-shark"}' --json
bioengine call <model-runner-concrete-svc-id> infer \
    --args '{"model_id": "affable-shark", "inputs": "<url-or-tensor>"}' --json
```

### Direct Python — the actual API

Direct `await mr.infer(...)` is the API. There is no `scripts/utils.py` helper module — you import `numpy` / `httpx` / `tifffile` etc. and write the small amount of tensor-prep glue yourself.

```python
from hypha_rpc import connect_to_server
import httpx, numpy as np, io

# 1. Resolve the concrete model-runner service ID (see "Service ID — discover before calling" above)
s = await connect_to_server({"server_url": "https://hypha.aicell.io",
                             "token": token, "workspace": "bioimage-io"})
workers = [sv["id"] for sv in await s.list_services({"type": "bioengine-worker"})]
worker = await s.get_service(workers[0])
mr_sid = (await worker.get_app_status(None))["model-runner"]["service_ids"]["websocket_service_id"]
mr = await s.get_service(mr_sid)

# 2. (Optional) inspect the RDF — returns an ObjectProxy, json.dumps with default=str if you want to print it.
rdf = await mr.get_model_rdf(model_id="affable-shark")
input_axes = rdf["inputs"][0].get("axes", "bcyx")   # e.g. "bcyx" (RDF 0.4.x) or [{name:"b"},...] (0.5.x)
output_key = rdf["outputs"][0].get("id") or rdf["outputs"][0].get("name")

# 3. Run inference — `inputs` accepts an HTTPS URL OR a serialised tensor.
#    For models with bundled test inputs, the URL pattern is:
#      https://hypha.aicell.io/<workspace>/artifacts/<model-alias>/files/<relative-source>
#    where <relative-source> is what `rdf.inputs[0].test_tensor.source` returns.
test_url = f"https://hypha.aicell.io/bioimage-io/artifacts/affable-shark/files/test_input_0.npy"
result = await mr.infer(model_id="affable-shark", inputs=test_url)
output_array = np.asarray(result[output_key])         # output_key is e.g. "output0"

# 4. (Optional) percentile-normalise / reshape your own input array before sending.
#    A tiny inline helper is usually enough — there is no library to import.
def normalize_percentile(img, pmin=1.0, pmax=99.8):
    lo, hi = np.percentile(img, [pmin, pmax])
    return ((img.clip(lo, hi) - lo) / max(hi - lo, 1e-8)).astype(np.float32)
```

**Output keys vary by model** — read `outputs[0].id` (RDF 0.5.x) or `outputs[0].name` (RDF 0.4.x), don't assume `"output0"`. On shape errors: inspect the RDF, reshape to match `inputs[0].axes`, then retry before discarding the model.

## Model screening / comparison workflow

```text
- [ ] Step 1: Clarify task type (segmentation / denoising / restoration / detection)
- [ ] Step 2: Search models — use keywords from assets/search_keywords.yaml
- [ ] Step 3: For each candidate — call get_model_documentation to read the README
- [ ] Step 4: Filter candidates — discard domain mismatches based on documentation
- [ ] Step 5: Run all suitable models on the same input — loop `await mr.infer(model_id=..., inputs=<url>)`
- [ ] Step 6: Score models — compute mAP over IoU thresholds 0.1–0.95 (step 0.05). Use whatever IoU library is appropriate to your task; for instance segmentation, a small Hungarian-matching helper computing F1 per threshold is enough. Pixel-level IoU/Dice you can compute inline with numpy.
- [ ] Step 7: Save all artifacts to comparison_results/
- [ ] Step 8: Generate Illustration 1 (F1 vs IoU threshold curve), Illustration 2 (montage)
- [ ] Step 9: Write comparison_summary.json
- [ ] Step 10: Generate HTML report
```

```python
# Run multiple models and save all outputs.
# Assumes `mr` is the resolved model-runner handle (see "Direct Python — the actual API" above)
# and `test_url` is an HTTPS URL the worker can fetch.
import numpy as np

model_ids = ["affable-shark", "ambitious-ant", "chatty-frog"]
results = {}
for model_id in model_ids:
    rdf = await mr.get_model_rdf(model_id=model_id)
    out_key = rdf["outputs"][0].get("id") or rdf["outputs"][0].get("name")
    r = await mr.infer(model_id=model_id, inputs=test_url)
    results[model_id] = np.asarray(r[out_key])
    np.save(f"comparison_results/{model_id}_output.npy", results[model_id])
```

### Step 3: Read model documentation before running

**Always call `get_model_documentation` for every candidate before running inference.** This fetches the model's README markdown file, which contains:
- Training data domain (brightfield, fluorescence, H&E, electron microscopy, etc.)
- Required input channels and expected staining protocols
- Recommended preprocessing steps
- Known limitations and magnification constraints

**HTTP endpoint**:
```
GET https://hypha.aicell.io/bioimage-io/services/model-runner/get_model_documentation?model_id={model_id}
```

**Python (RPC)**:
```python
from hypha_rpc import connect_to_server
server = await connect_to_server(server_url="https://hypha.aicell.io")
runner = await server.get_service("bioimage-io/model-runner")
doc = await runner.get_model_documentation(model_id="affable-shark")
# Returns: Markdown string or None if no documentation file exists
```

**HTTP (requests)**:
```python
import requests
r = requests.get(
    "https://hypha.aicell.io/bioimage-io/services/model-runner/get_model_documentation",
    params={"model_id": "affable-shark"}
)
doc = r.json()  # Markdown string or null
```

**Decision rules after reading documentation**:
- Model trained on H&E/brightfield → skip if input is fluorescence (and vice versa)
- Model requires 3+ channels → skip if only 1 channel is available (unless you can provide all required channels). Note this limitation in `comparison_summary.json` under `"notes"` — do NOT annotate this in the figures themselves; it belongs in the HTML report.
- Model trained on whole-slide-imaging at 40× → skip if your image is at a very different magnification
- If documentation is None or returns the bioimage.io spec README (not model-specific) → fall back to RDF `tags`, `description`, and test tensor inspection (see domain mismatch section below). **Known server bug**: `get_model_documentation` returns the same model's README for multiple different models (e.g. fearless-crab's README is returned for fearless-crab, conscientious-seashell, loyal-parrot, and chatty-frog). Detect this by checking if the returned content is identical across models or contains "bioimage.io specification" / starts with "# BioImage.IO". When detected, fall back to RDF tags.

Also check the RDF `tags` and `description` fields from `get_model_rdf` as a secondary signal.

**Artifact layout** (always save here — create folder if missing):

```
comparison_results/
├── {model_id}_output.npy              # raw prediction per model
├── illustration1_f1_vs_iou.pdf        # Illustration 1: F1 vs IoU threshold curves
├── illustration1_f1_vs_iou.png        # same at 300 DPI
├── illustration2_montage.pdf          # Illustration 2: input/GT/predictions montage
├── illustration2_montage.png          # same at 300 DPI
├── comparison_summary.json
└── model_comparison_report.html       # self-contained HTML with all figures embedded
```

**Generate HTML report** (always run at the end — auto-discovers all illustrations):

```bash
python scripts/generate_report.py --output-dir comparison_results/
```

### Required illustrations

Every screening run **must produce two illustrations** plus an HTML report. Generate them as publication-quality figures (Nature/Cell style):
- Figure width: 7.0 inches (Nature Methods single-column)
- Font: Arial or Helvetica, 7–8 pt for axis labels, 6 pt for tick labels
- Resolution: 300 DPI PNG + PDF with embedded fonts (`pdf.fonttype=42`, `ps.fonttype=42`)
- No chartjunk: remove top/right spines, subtle gridlines (#e0e0e0, `zorder=0`)
- Colors: use colorblind-friendly palettes (e.g. ColorBrewer diverging/sequential)
- All labels must be legible at print size — minimum 6 pt
- **No panel labels** (no "a", "b", "c") — panels are combined at the journal layout stage

---

#### Illustration 1 — F1 vs IoU threshold curve

**Skip only if there is exactly one suitable model** (single-candidate result). In that case, embed the mAP value as a text annotation in Illustration 2 instead.

**For instance segmentation tasks**: compute F1 at each IoU threshold from 0.1 to 0.95 (step 0.05; 18 thresholds). Plot one curve per model. The mAP is the area under this curve (mean of the 18 F1 values). This shows both peak performance and how quickly each model degrades at strict IoU requirements. (Write the per-threshold F1 inline using Hungarian matching on instance masks, or use any segmentation-metrics library you prefer.)

**For other tasks**: choose the most appropriate metric (PSNR/SSIM for denoising) and label the axis accordingly.

**Layout rules**:
- x-axis: IoU threshold 0.1→0.95; y-axis: F1 score 0→1
- One line per model, colored consistently with the montage (use a shared COLOR_MAP keyed by model name, ordered best→worst by mAP; colorblind-friendly palette)
- Legend with model IDs and mAP values, placed outside the plot area (upper right)
- No top/right spines; subtle gridlines (#e0e0e0)
- figsize=(6.5, 3.0) for Nature Methods single-column

**Python implementation** (use matplotlib; do NOT use seaborn):

```python
import numpy as np
import matplotlib
import matplotlib.pyplot as plt

matplotlib.rcParams.update({
    "font.family": "sans-serif", "font.sans-serif": ["Arial", "Helvetica", "DejaVu Sans"],
    "font.size": 7, "axes.titlesize": 7, "axes.labelsize": 7,
    "xtick.labelsize": 6, "ytick.labelsize": 6, "legend.fontsize": 6,
    "axes.linewidth": 0.6, "pdf.fonttype": 42, "ps.fonttype": 42,
})

THRESHOLDS = np.round(np.arange(0.1, 1.0, 0.05), 2)
# Assign colors best→worst by mAP rank (colorblind-friendly, no green — reserved for GT overlays)
COLORS_N = ["#5B8DB8", "#C47D45", "#3AAFA9", "#8B6BA8"]   # blue, orange, teal, purple
rank_order = sorted(models, key=lambda m: map_scores[m], reverse=True)
COLOR_MAP = {m: COLORS_N[i] for i, m in enumerate(rank_order)}

fig, ax = plt.subplots(figsize=(6.5, 3.0))
for model_id in rank_order:
    f1_curve = [results[model_id][f"f1_{t}"] for t in THRESHOLDS]
    mAP = np.mean(f1_curve)
    ax.plot(THRESHOLDS, f1_curve, color=COLOR_MAP[model_id], lw=1.5,
            label=f"{model_id}  (mAP={mAP:.3f})")

ax.set_xlabel("IoU threshold", labelpad=3)
ax.set_ylabel("F1 score", labelpad=3)
ax.set_xlim(0.1, 0.95)
ax.set_ylim(0, 1.0)
ax.xaxis.grid(True, color="#e0e0e0", lw=0.5, zorder=0)
ax.yaxis.grid(True, color="#e0e0e0", lw=0.5, zorder=0)
ax.set_axisbelow(True)
ax.spines["top"].set_visible(False)
ax.spines["right"].set_visible(False)
ax.legend(loc="upper right", frameon=False, fontsize=6, handlelength=1.5)

fig.savefig("illustration1_f1_vs_iou.pdf", bbox_inches="tight")
fig.savefig("illustration1_f1_vs_iou.png", bbox_inches="tight", dpi=300)
```

---

#### Illustration 2 — Input / GT / Predictions montage

Show all screened models in a single figure. **Models are ordered in the same rank order as Illustration 1** (best first). Iterate over `ranking` directly — **NOT** `plot_order` (which is worst-first and used only for barplot y-axis). Panel idx=0 (top-left) = best model, idx=N-1 (bottom-right) = worst model.

**Layout**:
- Row 1: Input image | Ground truth (if available) — centered, with empty columns as padding if needed
- Remaining rows: one panel per model prediction, in ranked order
- If ≤ 6 models: use a 2-column grid (input/GT in cols 1-2 of row 1; pairs of models per row below)
- If > 6 models: use a 3-column grid
- Each panel: title = model ID (6 pt, bold), subtitle = metric value e.g. "F1 = 0.909 | mIoU = 0.956" (5.5 pt, grey `#555555`)
- **Title and subtitle text must be dark (`#111111` / `#555555`)** — they render above/below the axes on the white figure background, NOT inside the dark panel. Using white text here makes titles invisible.
- Elements drawn **inside** the panel (scale bar line and label) must be white for contrast against the dark background.
- Do NOT add channel limitation notes to panels — record these in `comparison_summary.json` under `"notes"` and in the HTML report
- Spacing: panels must be **tight** — use `hspace=0.38` and `wspace=0.04` in GridSpec (enough to avoid subtitle/title overlap without large gaps).
- Figure background: `fig.patch.set_facecolor("white")` — white outer background for journal compatibility
- Each panel background: **always `#141414`** (near-black), regardless of figure background. Dark panel backgrounds make fluorescence/instance-segmentation overlays look significantly better. Never use white or grey for image panels.
- Scale bar in bottom-left corner (white line + label, 5.5 pt)
- For segmentation outputs: render as colored instance overlay (tab20 colormap, background `#141414`). Do NOT show raw probability maps — always postprocess to instance labels first.
- For the input panel: apply CLAHE (`skimage.exposure.equalize_adapthist`) and display as grayscale (`cmap="gray"`)
- For GT: render as colored instance overlay, same style as predictions
- No panel labels (no "a", "b", "c")

**Python**:
```python
fig.patch.set_facecolor("white")                 # white outer background for journal
# Iterate ranking (best-first): idx=0 → top-left, idx=N-1 → bottom-right
for idx, model_id in enumerate(ranking):          # NOT plot_order (which is reversed)
    row = 1 + idx // N_COLS
    col_start = (idx % N_COLS) * 2
    ax = fig.add_subplot(gs[row, col_start : col_start + 2])
    # ... render prediction panel ...
    ax.set_facecolor("#141414")                  # always dark, regardless of fig bg
    ax.set_title(model_id, fontsize=6, fontweight="bold", pad=3, color="#111111")
    ax.text(0.5, -0.06, f"F1 = {metrics[model_id]['f1']:.3f}", ...)  # color="#555555"
fig.savefig("illustration2_montage.pdf", bbox_inches="tight", facecolor=fig.get_facecolor())
fig.savefig("illustration2_montage.png", bbox_inches="tight", dpi=300, facecolor=fig.get_facecolor())
```

---

**comparison_summary.json schema**:

```json
{
  "task": "nuclei segmentation",
  "dataset": "Human Protein Atlas field 3235, 512x512 center crop",
  "input_channel": "405nm (DAPI/nucleus)",
  "keywords": ["nuclei", "fluorescence"],
  "candidates": ["model-id-1", "model-id-2"],
  "excluded": {"model-id-x": "domain mismatch: trained on H&E brightfield"},
  "mAP_summary": {
    "model-id-1": {"mAP": 0.783, "mAP_std": 0.045}
  },
  "metrics": {
    "model-id-1": {"f1_mean": 0.909, "f1_std": 0.04, "per_sample": {...}}
  },
  "failed_models": {"model-id-3": "shape mismatch error message"},
  "best_model": "model-id-1",
  "ground_truth_n_cells": 12,
  "ranking": ["model-id-1", "model-id-2"],
  "evaluation_method": "mAP: mean F1 over IoU thresholds 0.1–0.95 (step 0.05, 18 thresholds); greedy matching per threshold",
  "notes": {
    "model-id-2": "HPA model: requires 3 channels (DAPI+488+638). Run with ch1=ch2=zeros — degraded performance expected."
  }
}
```

## Unsupervised screening workflow (no ground truth)

Use this when the user has unlabelled images and wants to rank candidate models without ground truth. Implements **Consistency-based Model Ranking (CMR-NHD)** from Talks et al. 2026 (arXiv:2503.00450) entirely as a client-side loop over `mr.infer()` — no worker changes.

**Method.** For each `(model, image)` pair: run `infer()` on the clean image, run it again on a Gaussian-perturbed copy, then score the agreement between the two binary foreground masks as **IoU restricted to the union of foreground pixels** (Eq. 2 in the paper). The per-model score is the **median across images** (Eq. 5). Rank models by descending CMR.

**Use only with ≥ 5 images.** Per-model CMR on a single image is dominated by which model has the smoothest decision surface, not which is most accurate. The paper aggregates as median across the dataset; respect that.

```text
- [ ] Step 1: Clarify task type (currently only semantic-segmentation models supported; instance models need v2)
- [ ] Step 2: Search models — use keywords from assets/search_keywords.yaml
- [ ] Step 3: For each candidate — call get_model_documentation to read the README, exclude domain mismatches
- [ ] Step 4: Run all suitable models on each image, both clean and perturbed — 2·K·N infer() calls
- [ ] Step 5: Compute per-(model, image) CMR-NHD; aggregate as median across images per model
- [ ] Step 6: Flag mode-collapse models (mean foreground fraction <1% or >95%)
- [ ] Step 7: Save artifacts to comparison_results/
- [ ] Step 8: Generate Illustration 1 (CMR per-model bar chart), Illustration 2 (clean/perturbed prediction montage)
- [ ] Step 9: Write comparison_summary.json
- [ ] Step 10: Generate HTML report
```

```python
# Assumes `mr` is the resolved model-runner handle and `infer_with_retry` is in scope
# (see "Direct Python — the actual API" and "Inference retry on OOM" above).
import numpy as np

def add_gaussian_noise(img, sigma_frac=0.10, seed=0):
    """Additive Gaussian noise scaled to sigma_frac * (p99 - p1) of the input."""
    p1, p99 = np.percentile(img, [1, 99])
    sigma = sigma_frac * max(p99 - p1, 1e-6)
    rng = np.random.default_rng(seed)
    return (img + rng.normal(0.0, sigma, size=img.shape)).astype(img.dtype)

def cmr_nhd_binary(y_clean_bin, y_pert_bin):
    """Foreground-restricted normalised Hamming distance (Eq. 2). Returns NaN if both masks empty."""
    union = y_clean_bin | y_pert_bin
    n_union = int(union.sum())
    if n_union == 0:
        return float("nan")
    n_disagree = int((y_clean_bin != y_pert_bin)[union].sum())
    return 1.0 - n_disagree / n_union

def per_image_cmr(clean_out, pert_out, threshold=0.5):
    """Reduce two raw model outputs to one CMR-NHD score (mean across output channels)."""
    ca, pa = np.asarray(clean_out), np.asarray(pert_out)
    while ca.ndim > 3 and ca.shape[0] == 1:
        ca, pa = ca[0], pa[0]
    if ca.ndim == 2:
        ca, pa = ca[None], pa[None]
    scores, fg_clean, fg_pert = [], [], []
    for c in range(ca.shape[0]):
        yh, yt = ca[c] >= threshold, pa[c] >= threshold
        scores.append(cmr_nhd_binary(yh, yt))
        fg_clean.append(float(yh.mean()))
        fg_pert.append(float(yt.mean()))
    valid = [s for s in scores if not np.isnan(s)]
    return {
        "cmr": float(np.mean(valid)) if valid else float("nan"),
        "per_channel": scores,
        "fg_clean": fg_clean,   # foreground fraction, for mode-collapse detection
        "fg_pert": fg_pert,
    }

# ---- driver loop --------------------------------------------------------------
model_ids = ["affable-shark", "resourceful-otter", "stupendous-blowfish"]
images    = [np.load(p).astype(np.float32) for p in image_paths]   # N images
SIGMA_FRAC, THRESHOLD = 0.10, 0.5

per_model = {}    # model_id -> list[per-image CMR]
fg_track  = {}    # model_id -> list[mean foreground fraction across (clean, pert)]
failed    = {}    # model_id -> error string

for mid in model_ids:
    try:
        rdf = await mr.get_model_rdf(model_id=mid)
        out_key = rdf["outputs"][0].get("id") or rdf["outputs"][0].get("name")
    except Exception as e:
        failed[mid] = f"RDF lookup failed: {e}"
        continue
    cmr_list, fg_list = [], []
    for i, img in enumerate(images):
        img_pert = add_gaussian_noise(img, SIGMA_FRAC, seed=i)
        try:
            r_clean = await infer_with_retry(mr, mid, img)
            r_pert  = await infer_with_retry(mr, mid, img_pert)
        except Exception as e:
            failed[mid] = f"inference failed on image {i}: {e}"
            cmr_list = []   # discard partial
            break
        scored = per_image_cmr(r_clean[out_key], r_pert[out_key], THRESHOLD)
        if not np.isnan(scored["cmr"]):
            cmr_list.append(scored["cmr"])
        fg_list.extend(scored["fg_clean"] + scored["fg_pert"])
    if cmr_list:
        per_model[mid] = cmr_list
        fg_track[mid] = fg_list

# ---- aggregate, flag mode collapse, rank --------------------------------------
MODE_COLLAPSE_LO, MODE_COLLAPSE_HI = 0.01, 0.95
scores = {m: float(np.median(v)) for m, v in per_model.items()}
fg_mean = {m: float(np.mean(fg_track[m])) for m in per_model}
collapsed = {m: fg_mean[m] for m in per_model
             if fg_mean[m] < MODE_COLLAPSE_LO or fg_mean[m] > MODE_COLLAPSE_HI}
ranking = sorted(scores, key=scores.get, reverse=True)   # best → worst

print(f"Median CMR ranking (n={len(images)} images, sigma_frac={SIGMA_FRAC}):")
for r, m in enumerate(ranking, 1):
    flag = "  ⚠ MODE-COLLAPSE" if m in collapsed else ""
    print(f"  {r}. {m:32s} CMR={scores[m]:.4f}  fg={fg_mean[m]:.3f}{flag}")
```

### Mode collapse — the main failure mode

A model that predicts entirely foreground or entirely background under both clean and perturbed inputs gets an **artificially high CMR** (the perturbation can't disagree with the empty/saturated mask). The paper flags this as the primary failure mode (Sec 5.1).

Detect it by tracking the **mean foreground fraction** across all `(image, clean+perturbed, channel)` combinations:
- `< 1%` → near-background-collapse (model is predicting nothing)
- `> 95%` → saturation (model is predicting everything as foreground)

Surface flagged models in the ranking output **and** in `comparison_summary.json` under `"mode_collapse"`. **Do not silently drop them** — the user needs to see why a model is suspect. A model can be number 1 by CMR and still be useless because it predicts all-zeros.

### Perturbation tuning

| `sigma_frac` | Effect |
|---|---|
| `0.02–0.05` | Almost no signal — CMR clusters near 1.0, ranking is dominated by quantisation noise. |
| **`0.10`** | **Default.** Paper's recommended starting point; CMR-NHD drops to 0.5–0.9 for typical models — good dynamic range. |
| `0.20–0.40` | Aggressive — CMR collapses toward 0; only useful if all models score ≥ 0.95 at 0.10. |

If models cluster tightly within ±0.02 of each other at `sigma_frac=0.10`, double it. If they cluster near 0, halve it. The metric is monotonic in perturbation strength (validated on the live worker, 2026-06-10).

### Illustration 1 — CMR per-model bar chart (unsupervised variant)

Replaces "F1 vs IoU threshold" — there is no labelled threshold sweep.

- Horizontal bar chart, models sorted **worst → best** on y-axis (so the best model is on top in the visual reading order)
- One bar per model, error bar = MAD (median absolute deviation) across images
- Mode-collapse models drawn in **red** with a `⚠` annotation; non-collapsed in the standard COLOR_MAP palette
- x-axis: `0` to `1`; vertical reference line at the **lowest CMR among non-collapsed models** as the "credible floor"
- figsize=(6.5, max(2.5, 0.35 * n_models))

```python
import numpy as np, matplotlib.pyplot as plt
plot_order = sorted(ranking, key=lambda m: scores[m])   # worst → best (bottom → top)
mads = {m: float(np.median(np.abs(np.array(per_model[m]) - scores[m]))) for m in ranking}
colors = ["#C0392B" if m in collapsed else "#5B8DB8" for m in plot_order]

fig, ax = plt.subplots(figsize=(6.5, max(2.5, 0.35 * len(ranking))))
y = np.arange(len(plot_order))
ax.barh(y, [scores[m] for m in plot_order],
        xerr=[mads[m] for m in plot_order],
        color=colors, edgecolor="#222", lw=0.4, error_kw=dict(lw=0.6))
for i, m in enumerate(plot_order):
    if m in collapsed:
        ax.text(scores[m] + 0.01, i, "⚠ mode collapse", va="center", fontsize=6, color="#C0392B")
ax.set_yticks(y); ax.set_yticklabels(plot_order)
ax.set_xlabel("Median CMR-NHD across images"); ax.set_xlim(0, 1.0)
ax.spines["top"].set_visible(False); ax.spines["right"].set_visible(False)
ax.xaxis.grid(True, color="#e0e0e0", lw=0.5, zorder=0); ax.set_axisbelow(True)
fig.savefig("illustration1_cmr_ranking.pdf", bbox_inches="tight")
fig.savefig("illustration1_cmr_ranking.png", bbox_inches="tight", dpi=300)
```

### Illustration 2 — Clean / Perturbed prediction montage (unsupervised variant)

Same layout rules as the supervised montage (#141414 panel background, white scale bar, dark titles outside panels), but **two columns per model** (clean prediction | perturbed prediction) instead of one. This makes the consistency the metric measures visually obvious to the reader.

- Row 1: Input image (clean) | Input image (perturbed) — leftmost image is the actual input, rightmost shows the noise applied
- Remaining rows: one row per model in ranked order; col 1 = clean prediction, col 2 = perturbed prediction
- Each model's row gets a subtitle: `"CMR = 0.84"` or `"CMR = 0.99 (⚠ mode collapse)"` between the two panels

### comparison_summary.json schema (unsupervised variant)

```json
{
  "task": "nuclei segmentation",
  "dataset": "user-supplied unlabelled images (n=12)",
  "evaluation_method": "CMR-NHD (Talks et al. 2026, arXiv:2503.00450); Gaussian perturbation sigma_frac=0.10; median across images",
  "candidates": ["model-id-1", "model-id-2"],
  "excluded": {"model-id-x": "domain mismatch: trained on H&E brightfield"},
  "cmr_scores": {
    "model-id-1": {"median": 0.843, "mad": 0.021, "per_image": [0.81, 0.86, ...]}
  },
  "mode_collapse": {
    "model-id-3": {"mean_foreground_fraction": 0.998, "reason": "saturated foreground predictions"}
  },
  "failed_models": {"model-id-4": "shape mismatch error"},
  "best_model": "model-id-1",
  "ranking": ["model-id-1", "model-id-2"],
  "perturbation": {"type": "gaussian", "sigma_frac": 0.10, "threshold": 0.5},
  "notes": {}
}
```

### Combining with the supervised workflow

If the user has ground truth for **some** images, run both: report supervised mAP on labelled images **and** unsupervised CMR on the full set. Spearman ρ between the two rankings on the overlap is a useful sanity check — if `ρ < 0.3` on n ≥ 10 models, treat the CMR ranking with skepticism and surface the disagreement in the report.

### Known limitations

- **Single-image runs are unreliable.** With N=1 image and tightly-clustered models (e.g. 5 UNets trained on near-identical nucleus datasets), per-image CMR is dominated by decision-surface smoothness, not accuracy. Validated on the live worker, 2026-06-10: 5 nucleus models on `affable-shark`'s test tensor gave Spearman ρ(CMR, true IoU) = −0.50 (n.s.). **The paper aggregates across ≥ 50 images per dataset; respect that floor.**
- **Instance segmentation not supported by this code.** Use CMR-ARS (Eq. 3) for instance models — requires `sklearn.metrics.adjusted_rand_score` and per-model instance postprocessing (NMS / watershed). Defer to v2.
- **Feature-space perturbations (CMR-DropOut) are stronger** in the paper but require reaching into the model's intermediate layers — not implementable as a black-box client wrapper. Input perturbations are paper-equivalent in most settings (Tab. 1).

## Validation / testing workflow

```text
- [ ] Step 1: validate — format compliance check (pass rdf_dict, not a file path)
- [ ] Step 2: test — runs official BioImage.IO test suite (may be cached)
- [ ] Step 3: Review output — check status (passed/failed) and details
```

```bash
# validate takes rdf_dict (the parsed YAML as a dict), not a file path
bioengine call bioimage-io/model-runner validate --args '{"rdf_dict": {"type": "model", ...}}' --json

# test takes model_id
bioengine call bioimage-io/model-runner test --args '{"model_id": "ambitious-ant"}' --json
bioengine call bioimage-io/model-runner test --args '{"model_id": "ambitious-ant", "skip_cache": true}' --json
```

## Inference retry on OOM

GPU workers can return an out-of-memory error when multiple jobs are running simultaneously. The error surfaces as a `RuntimeError` or `torch.OutOfMemoryError` (often re-raised as `Failed to unpickle serialized exception` from the Ray worker). **This is transient — wait and retry.**

Wrap every inference call in a retry loop:

```python
import time, requests

async def infer_with_retry(mr, model_id, inputs, max_retries=3, retry_delay=15):
    """Run inference, retrying on OOM errors with exponential back-off.
    `mr` is the resolved model-runner handle (see "Direct Python — the actual API").
    """
    for attempt in range(max_retries):
        try:
            result = await mr.infer(model_id=model_id, inputs=inputs)
            return result
        except Exception as e:
            err = str(e).lower()
            is_oom = any(kw in err for kw in [
                "outofmemory", "out of memory", "cuda out", "unpickle serialized",
            ])
            if is_oom and attempt < max_retries - 1:
                wait = retry_delay * (attempt + 1)   # 15s, 30s, 45s
                print(f"  OOM on {model_id} (attempt {attempt+1}), retrying in {wait}s…")
                time.sleep(wait)
            else:
                raise
```

- **Max retries**: 3 (configurable). Total worst-case wait before giving up: ~90 s.
- **Delay**: linear back-off — 15 s, 30 s, 45 s. GPU memory is freed quickly once the previous job finishes.
- **Only retry on OOM**: other errors (shape mismatch, model not found, timeout) should fail immediately.
- If all retries are exhausted, record the model in `failed_models` with the error message and continue with remaining models.

## Validation loop (quality-critical runs)

Run inference → if failure, inspect error and RDF constraints (`get_model_rdf`) → adjust dimensions or normalization → rerun → repeat until success or clear incompatibility → record what changed and why.

## Output interpretation guide

Model outputs are **raw tensors** — not ready-to-use instance labels. Always read the RDF to understand channel semantics before interpreting results.

### Common output formats

| Model type | Output shape | Interpretation |
|---|---|---|
| UNet nucleus (e.g. affable-shark) | `(1, 2, H, W)` | ch0=foreground prob, ch1=boundary prob. Use `foreground - boundary` → watershed |
| UNet softmax (e.g. conscientious-seashell) | `(1, 3, H, W)` | Softmax probabilities across 3 classes (background/boundary/nucleus). Sum=1 per pixel. Identify nucleus channel by lowest mean. |
| StarDist | `(1, H, W, 33)` | ch0=object probability, ch1–32=star polygon radii. Requires NMS postprocessing — do NOT threshold naively. |
| Restoration (e.g. dazzling-spider) | `(1, 1, H, W)` | Direct output; output key is `"prediction"` not `"output0"` |

### HPA multi-channel models (conscientious-seashell, loyal-parrot)

These models expect **3 channels** (not just nucleus staining):
- **Channel 0**: 405nm (DAPI/nucleus staining, normalized to [0,1])
- **Channel 1**: 488nm (ER or microtubule channel, normalized to [0,1])
- **Channel 2**: 638nm (protein of interest, normalized to [0,1])

Input shape: `(1, 3, 512, 512)` float32. Normalize each channel independently with percentile normalization (p1=1, p99=99.8). If only the DAPI channel is available, fill ch1 and ch2 with zeros — performance degrades, but the model still runs. Record this limitation in `comparison_summary.json` under `"notes"`, NOT as an annotation on the figures.

**Output channel selection** (`conscientious-seashell`): output shape is `(1, 3, H, W)` softmax probabilities:
- ch0 = background (typically high mean ≈ 0.85)
- ch1 = unused / zeros when input ch1+ch2 are zeros
- ch2 = nucleus probability (positive correlation with DAPI)

**Critical**: select the nucleus channel using `argmax(correlation_with_dapi)` — NOT `argmax(abs(correlation))`. Background (ch0) has equal absolute correlation magnitude to nucleus (ch2) but negative sign. Using abs() silently selects the background channel.

```python
# Correct nucleus channel selection for conscientious-seashell
output = ...  # shape (1, 3, H, W)
dapi_flat = ch405n.ravel()
correlations = [np.corrcoef(output[0, c].ravel(), dapi_flat)[0,1] for c in range(3)]
nucleus_ch = np.argmax(correlations)  # NOT argmax(abs(correlations))
nucleus_prob = output[0, nucleus_ch]
```

`loyal-parrot` is a **cell body** model (whole-cell segmentation), not nucleus-only. Include only if the task is whole-cell segmentation. It oversegments when used for nucleus-only tasks.

### StarDist postprocessing

StarDist output ch0 is the **object probability map** — values are typically very sparse (>99% of pixels near 0 even for images with many nuclei). Apply NMS using the 32 radii channels:

**Threshold tuning**: `prob_thresh=0.5` may miss dim or small nuclei. Use `prob_thresh=0.4` as the default — inspect the probability map distribution and lower the threshold if you see false negatives on visually clear nuclei. The `min_distance` parameter in `peak_local_max` controls over-detection; increase it (e.g. 8–12) for large nuclei.

```python
import numpy as np
from skimage.feature import peak_local_max
from skimage.draw import polygon

def stardist_nms(prob, radii, prob_thresh=0.4, nms_thresh=0.3, min_radius=5):
    H, W = prob.shape
    n_rays = radii.shape[-1]
    angles = np.linspace(0, 2*np.pi, n_rays, endpoint=False)
    lm = peak_local_max(prob, min_distance=5, threshold_abs=prob_thresh)
    if len(lm) == 0:
        return np.zeros((H, W), dtype=int)
    # Sort by score, apply greedy NMS
    order = np.argsort(-prob[lm[:, 0], lm[:, 1]])
    lm = lm[order]
    labels = np.zeros((H, W), dtype=int)
    kept = []; inst_id = 0
    for y, x in lm:
        r = np.abs(radii[y, x])
        if r.mean() < min_radius:
            continue
        poly_y = np.clip(y + r * np.sin(angles), 0, H-1)
        poly_x = np.clip(x + r * np.cos(angles), 0, W-1)
        rr, cc = polygon(poly_y, poly_x, shape=(H, W))
        if len(rr) < 20:
            continue
        cur = np.zeros((H, W), dtype=bool); cur[rr, cc] = True
        if any((np.logical_and(cur, p).sum() / (np.logical_or(cur, p).sum()+1e-6)) > nms_thresh for p in kept):
            continue
        inst_id += 1; labels[rr, cc] = inst_id; kept.append(cur)
    return labels
```

### Resolution sensitivity

StarDist models tagged `whole-slide-imaging` are trained at specific magnifications. If the detected cell radii (mean of ch1–ch32 at top-probability pixels) are much larger or smaller than actual cell sizes in your image, the model is mismatched to your resolution. Switch to a model trained at your acquisition settings.

### Domain mismatch — brightfield vs fluorescence

**Critical**: Some models tagged `nuclei` or `segmentation` are trained on H&E brightfield images, not fluorescence. In brightfield/H&E, nuclei appear **dark on a bright background**; in fluorescence, nuclei are **bright on a dark background**. Running a brightfield-trained model on fluorescence data (or vice versa) produces detections with zero overlap with actual nuclei — F1=0.

**Prevention (do this first)**: Call `get_model_documentation(model_id)` before running any model. The README describes the training domain explicitly. Exclude models with incompatible domains before running inference — this saves time and prevents misleading results.

**Fallback detection** (if documentation is None or ambiguous):
1. Check the model's test input: `inputs[0].test_tensor.source` — download it and inspect visually
2. If test input has high mean pixel values (e.g. >80 for 8-bit) across all channels → brightfield
3. If test input has low mean with bright spots → fluorescence
4. Check RDF `tags` for `"brightfield"`, `"histopathology"`, `"H&E"` → skip for fluorescence tasks
5. After inference: if probability at ground-truth nucleus centroids is all ≈ 0.000 → domain is wrong

**Input scale is NOT the cause**: StarDist models (`chatty-frog`, `fearless-crab`) internally normalize their input. Sending [0,1] vs [0,255] values produces identical outputs (correlation=1.000). The domain difference (fluorescence vs brightfield) is the actual problem.

**chatty-frog** (`whole-slide-imaging`, StarDist RGB): trained on brightfield/H&E. Do NOT use for fluorescence microscopy. Use **fearless-crab** instead for fluorescence single-channel nuclei.

### Search keyword guide for HPA images

For Human Protein Atlas fluorescence images, use these keywords in order of reliability:

| Task | Best keywords |
|---|---|
| Nucleus segmentation | `["nuclei", "segmentation"]` |
| Cell segmentation | `["cell", "segmentation", "fluorescence"]` |
| HPA-specific | `["HPA"]` or search conscientious-seashell / loyal-parrot directly |
| Denoising | `["restoration", "2D"]` (not `"denoising"` — may return 0 results) |

`conscientious-seashell` = HPA nucleus model (3-channel). `loyal-parrot` = HPA cell body model (3-channel).

## Canonical model IDs

`infer()` and the other lookup methods take a model **nickname** (the `id` field in the RDF). A few high-value defaults to short-circuit `search_models` when the user names a model family:

| User says | `model_id` | Notes |
|---|---|---|
| "Cellpose" / "cyto" | `famous-fish` | Cellpose `cyto3` base model — generalist cell segmentation. Returns `outputs[0].id == "masks"`. |
| "StarDist nuclei (fluorescence)" | `fearless-crab` | StarDist single-channel fluorescence nucleus model. See [StarDist postprocessing](#stardist-postprocessing). |
| "StarDist nuclei (brightfield / H&E)" | `chatty-frog` | StarDist RGB whole-slide-imaging model. **Do not use for fluorescence** (zero overlap, F1=0). |
| "HPA nucleus" | `conscientious-seashell` | 3-channel HPA nucleus model. See [HPA multi-channel models](#hpa-multi-channel-models-conscientious-seashell-loyal-parrot). |
| "HPA cell body" | `loyal-parrot` | 3-channel HPA whole-cell model. |
| "BBBC-style nucleus segmentation" | `affable-shark` | UNet 2-channel (foreground + boundary). |
| "Denoising / restoration" | `dazzling-spider` | Output key is `"prediction"`, not `"output0"`. |

When in doubt, call `search_models(keywords=[...])` first — these IDs are stable but the zoo evolves and fine-tuned variants of cellpose are published as their own nicknames.

## `infer()` input convention

`mr.infer(model_id, inputs)` accepts:

| `inputs` type | Behaviour |
|---|---|
| `str` URL (`https://…/test_input_0.npy`) | Worker downloads, deserialises, runs. Use for bundled test tensors. |
| `numpy.ndarray` | Sent over RPC. Most models accept a bare `(H, W)` float32 array and internally reshape to `(batch, channel, y, x)` per `rdf.inputs[0].axes`. For multi-channel models (HPA, RGB) pre-stack to `(C, H, W)` or `(1, C, H, W)`. |
| `dict[str, np.ndarray]` | Multi-input models. Key matches `rdf.inputs[i].id`. |

Return value is a `dict` keyed by the RDF's `outputs[i].id` (e.g. `"masks"`, `"prediction"`, `"output0"` — model-dependent). Always read it from the RDF; do **not** hard-code `"output0"`:

```python
rdf = await mr.get_model_rdf(model_id=model_id)
out_key = rdf["outputs"][0]["id"]
result = await mr.infer(model_id=model_id, inputs=image)
masks = np.asarray(result[out_key])
```

## Deploying and updating the model-runner app

You only need this section if you're **bringing model-runner up on a new worker** (e.g. running BioEngine in your own workspace). For everyday inference, point at an already-deployed model-runner using the discovery recipe above — no deploy step needed.

### Deploy an already-published artifact (most common — operators)

If `bioimage-io/model-runner` exists in the artifact manager and you just want to run it on your worker, use the worker's `deploy_app` RPC. No local clone of the app source is required:

```python
from hypha_rpc import connect_to_server

s = await connect_to_server({"server_url": "https://hypha.aicell.io",
                             "token": admin_token,
                             "workspace": my_workspace})
worker = await s.get_service(f"{my_workspace}/bioengine-worker")

app_id = await worker.deploy_app(
    artifact_id="bioimage-io/model-runner",
    application_id="model-runner",            # stable app id ⇒ stable service id
    hypha_token=admin_token,                  # required: model-runner registers Hypha services internally
    # version="1.2.3",                        # optional: pin a specific artifact version (default: latest)
)
```

Or via the CLI:

```bash
export BIOENGINE_WORKER_SERVICE_ID=<my-workspace>/bioengine-worker
bioengine apps run bioimage-io/model-runner --app-id model-runner --hypha-token $HYPHA_TOKEN
```

The `application_id` **must** be passed for any kind of update — omitting it always spawns a brand-new random instance. See the SKILL.md "Deploy an existing app" section for the full rationale.

> **`hypha_token` trap on cross-worker deploys.** When `application_id` matches an existing running instance on a worker, `deploy_app` silently reuses the previously stored token if `--hypha-token` is omitted. So a redeploy on a worker that already has `model-runner` running will "succeed" without it — while the same call on a worker without a prior instance fails inside the actor (model-runner registers Hypha services in `__init__`, so it dies hard without `HYPHA_TOKEN`). Always pass it.

### Develop and publish a new model-runner version (app authors)

This is the path used by maintainers of the `bioimage-io/model-runner` artifact itself — it requires a local clone of `aicell-lab/bioengine` and write access to the `bioimage-io` workspace:

```bash
export BIOENGINE_WORKER_SERVICE_ID=bioimage-io/bioengine-worker
bioengine apps deploy ./apps/model-runner/ \
  --app-id model-runner \
  --hypha-token $HYPHA_TOKEN
```

`bioengine apps deploy` uploads the local directory as a new artifact version AND deploys it in one step. When updating an existing deployment, the new version automatically inherits all env vars and init args/kwargs from the previous app — do **not** pass `--env` again unless intentionally rotating a secret:

```bash
bioengine apps upload ./apps/model-runner/
bioengine apps run bioimage-io/model-runner --app-id model-runner
# HYPHA_TOKEN and all other env vars are carried over automatically
```

## References

- Full API endpoint docs and examples: [references/api_reference.md](references/api_reference.md)
- RDF format spec (0.4.x vs 0.5.x axes, output keys): [references/rdf_format.md](references/rdf_format.md)
- Task/modality keyword presets: [assets/search_keywords.yaml](assets/search_keywords.yaml)
- CLI source and advanced usage: [references/cli_reference.md](references/cli_reference.md)
