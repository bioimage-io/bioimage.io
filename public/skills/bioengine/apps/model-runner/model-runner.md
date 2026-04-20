# BioEngine Model Runner

**Service ID**: `bioimage-io/model-runner` · **Server**: `https://hypha.aicell.io`

## Use this skill when

- The user wants to run a known BioImage.IO model on an image.
- The user wants to find candidate models for a task (e.g. nuclei segmentation, denoising).
- The user wants to compare multiple models against ground truth.
- The user wants to validate a model RDF or run BioImage.IO compliance tests.

## Quick start

Install the CLI once:

```bash
pip install -e skills/bioengine/bioengine_cli/
```

**Default server**: `https://hypha.aicell.io`  
**Default service ID**: `bioimage-io/model-runner` (live, public, no auth required)  
**No local GPU required** — computation runs on BioEngine remote workers.

If the user has their own BioEngine worker in workspace `ws-user-github|49943582`, the service ID becomes `ws-user-github|49943582/model-runner`. Use `bioimage-io/model-runner` unless the user specifies otherwise.

## CLI reference

The `bioengine call` command is the generic interface for calling any service method. Model-runner specific operations map to service methods called via `bioengine call`:

| Operation | Command |
|---|---|
| Search models | `bioengine call bioimage-io/model-runner search_models --args '{"keywords": [...], "limit": 10}' --json` |
| Model metadata/RDF | `bioengine call bioimage-io/model-runner get_model_rdf --args '{"model_id": "<id>"}' --json` |
| Model documentation | `bioengine call bioimage-io/model-runner get_model_documentation --args '{"model_id": "<id>"}' --json` |
| Validate RDF | `bioengine call bioimage-io/model-runner validate --args '{"model_id": "<id>"}' --json` |
| Test model | `bioengine call bioimage-io/model-runner test --args '{"model_id": "<id>"}' --json` |
| Run inference | Use `scripts/utils.py:infer_http()` (handles upload, RPC, download automatically) |
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
# Full example
bioengine call bioimage-io/model-runner search_models --args '{"keywords": ["nuclei", "segmentation"], "limit": 5}' --json
bioengine call bioimage-io/model-runner get_model_rdf --args '{"model_id": "affable-shark"}' --json
# For inference, use scripts/utils.py:infer_http() — handles upload, RPC, download
```

Use `scripts/utils.py` helpers for normalization and evaluation — do not rewrite tensor logic:

```python
from scripts.utils import (
    infer_http,               # upload + infer + download in one call; returns np.ndarray
    get_model_rdf,            # fetch and parse RDF for a model_id
    get_input_axes_info,      # parse input axes from RDF (handles 0.4.x and 0.5.x)
    prepare_image_for_model,  # reshape array to required axes (e.g. "bcyx")
    normalize_image,          # percentile normalization (pmin=1, pmax=99.8)
    evaluate_segmentation,    # compute IoU and Dice between pred mask and GT mask
    pad_or_crop_to_valid_size,# adjust H/W to satisfy model step/min constraints
)

image = normalize_image(raw_image)               # percentile normalization
tensor = prepare_image_for_model(image, axes)    # reshape to model input axes
pred = infer_http(model_id, tensor)              # upload, infer, download — returns ndarray
iou, dice = evaluate_segmentation(pred_mask, gt_mask)
```

Do NOT write networking or upload/download boilerplate from scratch — `infer_http` handles the full upload → infer → download cycle.

Output key: `outputs[0].name` (RDF 0.4.x) or `outputs[0].id` (RDF 0.5.x). On shape errors: inspect the RDF via `get_model_rdf`, adapt dimensions, retry before discarding the model.

## Model screening / comparison workflow

```text
- [ ] Step 1: Clarify task type (segmentation / denoising / restoration / detection)
- [ ] Step 2: Search models — use keywords from assets/search_keywords.yaml
- [ ] Step 3: For each candidate — call get_model_documentation to read the README
- [ ] Step 4: Filter candidates — discard domain mismatches based on documentation
- [ ] Step 5: Run all suitable models on the same input — use `infer_http()` from `scripts/utils.py` in a loop
- [ ] Step 6: Score models — compute mAP over IoU thresholds 0.1–0.95 (step 0.05) using `compute_instance_f1(pred_labels, gt_labels, iou_thresh=t)` for each threshold `t`; `evaluate_segmentation()` for semantic/pixel-level tasks only
- [ ] Step 7: Save all artifacts to comparison_results/
- [ ] Step 8: Generate Illustration 1 (F1 vs IoU threshold curve), Illustration 2 (montage)
- [ ] Step 9: Write comparison_summary.json
- [ ] Step 10: Generate HTML report
```

```python
# Run multiple models and save all outputs
from scripts.utils import infer_http
import numpy as np

model_ids = ["affable-shark", "ambitious-ant", "chatty-frog"]
results = {}
for model_id in model_ids:
    results[model_id] = infer_http(model_id, input_array)
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

**For instance segmentation tasks**: compute F1 at each IoU threshold from 0.1 to 0.95 (step 0.05; 18 thresholds) via `compute_instance_f1(pred_labels, gt_labels, iou_thresh=t)`. Plot one curve per model. The mAP is the area under this curve (mean of the 18 F1 values). This shows both peak performance and how quickly each model degrades at strict IoU requirements.

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

def infer_with_retry(model_id, input_array, max_retries=3, retry_delay=15):
    """Run inference, retrying on OOM errors with exponential back-off."""
    for attempt in range(max_retries):
        try:
            result = infer_http(model_id, input_array)
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

## Deploying and updating the model-runner app

The `model-runner` service is deployed on the BioEngine worker (`bioimage-io/bioengine-worker`) and runs in the `bioimage-io` workspace. It requires a `HYPHA_TOKEN` that has write access to that workspace. Pass it on first deployment:

```bash
export BIOENGINE_WORKER_SERVICE_ID=bioimage-io/bioengine-worker
bioengine apps deploy ./bioengine_apps/model-runner/ \
  --env _HYPHA_TOKEN=<bioimage-io-scoped-token>
```

**When updating an existing deployment**, the new version automatically inherits all env vars (including `HYPHA_TOKEN`) and all init args/kwargs from the previous app — do **not** pass `--env` again unless intentionally rotating a secret:

```bash
bioengine apps upload ./bioengine_apps/model-runner/
bioengine apps run bioimage-io/model-runner --app-id <existing-app-id>
# HYPHA_TOKEN and all other env vars are carried over automatically
```

## References

- Full API endpoint docs and examples: [references/api_reference.md](references/api_reference.md)
- RDF format spec (0.4.x vs 0.5.x axes, output keys): [references/rdf_format.md](references/rdf_format.md)
- Task/modality keyword presets: [assets/search_keywords.yaml](assets/search_keywords.yaml)
- CLI source and advanced usage: [references/cli_reference.md](references/cli_reference.md)
