# Successful Submission Examples

Real-world submissions made using this skill. Each entry documents the model, the key challenges, and what approach worked — so future agents can learn from them.

---

*This file will be populated as models are successfully submitted using this skill.*

## cFOS Segmentation in Mouse Hippocampus — 2026-04-15

- **Source**: https://huggingface.co/matjesg/cFOS_in_HC
- **Artifact ID**: `bioimage-io/skeleton-demon-glow-kissingly` (staging)
- **Weight format**: `pytorch_state_dict` (UNet + ResNet34 encoder via segmentation_models_pytorch)
- **Framework version**: PyTorch 1.10+, segmentation-models-pytorch >= 0.3.0
- **Input shape**: `[1, 1, 256, 256]` (B, C, H, W), float32
- **Output shape**: `[1, 2, 256, 256]` (B, Classes, H, W), float32 probabilities

### Key challenges

1. **The original `.pth` file contained numpy metadata alongside the state dict** — deepflash2 stores normalization stats as numpy arrays in the same file. `bioimageio.core` uses `torch.load(weights_only=True)` and rejects numpy objects. Fix: extract only the state dict:
   ```python
   data = torch.load('original.pth', weights_only=False)
   torch.save(data['model'], 'weights.pt')
   ```

2. **`softmax` is not a valid bioimageio postprocessing operation** — the spec docs suggested it was, but bioimageio.spec 0.5.4.3 rejects it. Fix: embed `F.softmax(logits, dim=1)` inside the model's `forward()` so the ONNX/state-dict output is already probabilities.

3. **Python 3.8 incompatibility in bioimageio.core 0.9.0** — `TemporaryDirectory(ignore_cleanup_errors=True)` was added in Python 3.10 and causes a `TypeError` on 3.8 when importing the model architecture. Applied a one-line patch to the installed library. Issue should be reported to core-bioimage-io-python.

4. **`_rkwargs=True` rejected by current Hypha server** — the submission guide included this in all `am.create()` / `am.put_file()` calls, but the server now rejects it. Removed entirely — works fine without it.

### What worked

- Using `smp.Unet` (segmentation_models_pytorch) directly as the architecture class
- Embedding softmax inside `forward()` instead of relying on postprocessing spec
- Normalization via `scale_linear` preprocessing (gain = 1/std ≈ 26.08, offset = −mean/std ≈ −2.35)
- The `connect_to_server` call requires a config **dict** (not keyword args):
  ```python
  async with connect_to_server({"server_url": ..., "token": ..., "method_timeout": 120}) as server:
  ```

### Issues filed / fixed in this repo

- `references/model-spec-reference.md`: removed `softmax` from postprocessing table, added note and workaround
- `references/model-spec-reference.md`: added warning about pure state-dict requirement for weights files
- `references/submission-guide.md`: removed all `_rkwargs=True`, fixed `connect_to_server` to use dict, added `__pycache__` exclusion filter

### External issues to file (no GitHub token available during this run)

- **bioimage-io/core-bioimage-io-python**: Python 3.8 incompatibility in `digest_spec.py:111` (`TemporaryDirectory(ignore_cleanup_errors=True)`)
- **bioimage-io/core-bioimage-io-python**: `weights_only=True` blocks loading for `.pth` files with numpy metadata — error message could be clearer ("save a pure state dict")
- **bioimage-io/spec-bioimage-io**: `softmax` documented as postprocessing but not accepted — either add it or clarify workaround

### rdf.yaml snippet (non-obvious pattern)

The preprocessing uses training dataset statistics embedded as `scale_linear` kwargs:

```yaml
preprocessing:
  - id: scale_linear
    kwargs:
      gain: 26.078    # = 1 / dataset_std  (std=0.03835)
      offset: -2.351  # = -mean/std  (mean=0.09015)
  - id: ensure_dtype
    kwargs:
      dtype: float32
```

And softmax embedded in the architecture class:

```python
class CfosSmpUnet(smp.Unet):
    def forward(self, x):
        return F.softmax(super().forward(x), dim=1)
```

## UNet Brain MRI FLAIR Abnormality Segmentation — 2026-04-16

- **Source**: https://github.com/mateuszbuda/brain-segmentation-pytorch (PyTorch Hub: `mateuszbuda/brain-segmentation-pytorch`)
- **Artifact ID**: Not yet submitted (validated through Phase 4)
- **Weight format**: `pytorch_state_dict` (UNet with BN, ~30MB)
- **Framework version**: PyTorch 1.10+
- **Input shape**: `[1, 3, 256, 256]` (B, C, H, W) — 3-channel brain MRI (pre-T1, FLAIR, post-T1), values in `[0, 1]`
- **Output shape**: `[1, 1, 256, 256]` — probability map in `[0, 1]` (sigmoid embedded in `forward()`)

### Key challenges

1. **`bioimageio.core >= 0.8` crashes on Python 3.8** — `TemporaryDirectory(ignore_cleanup_errors=True)` requires Python 3.10+. Fix: downgrade to `bioimageio.core==0.6.9 bioimageio.spec==0.5.3.2`, or upgrade to Python 3.10+.

2. **bioimageio.spec + bioimageio.core version conflict** — `pip install bioimageio.spec bioimageio.core` installs incompatible latest versions. Always install with pinned versions: `pip install "bioimageio.spec==0.5.4.3" "bioimageio.core==0.9.0"`.

3. **Tensor `description` has 128-char limit** — top-level `description` allows 1024 chars, but `inputs[].description` is limited to 128. Long descriptions cause a validation error.

4. **`# Validation` heading required in README.md** — the validator checks for this exact heading. Without it, `bioimageio test` prints a warning.

5. **PyTorch Hub model includes sigmoid in `forward()`** — the output is already probabilities in `[0, 1]`. No postprocessing needed.

### What worked

- Loading weights via `torch.hub.load('mateuszbuda/brain-segmentation-pytorch', 'unet', pretrained=True)` then saving the state dict: `torch.save(model.state_dict(), 'weights.pt')`
- Input and output axes can reuse the same `id` (e.g., both use `id: y` and `id: x`) — global uniqueness is NOT required
- Output axis size references (`tensor_id: raw, axis_id: y`) work even when input and output share the same axis IDs

### rdf.yaml snippet (non-obvious axis pattern)

Output axes that reference input axes, using the SAME axis IDs (no need for `y_out`/`x_out`):

```yaml
outputs:
  - id: probability
    axes:
      - type: batch
      - type: channel
        channel_names: [abnormality_probability]
      - type: space
        id: y
        size:
          tensor_id: raw
          axis_id: y
      - type: space
        id: x
        size:
          tensor_id: raw
          axis_id: x
```

## UNet Brain MRI FLAIR Abnormality Segmentation (ONNX) — 2026-04-16

- **Source**: https://github.com/mateuszbuda/brain-segmentation-pytorch (PyTorch Hub)
- **Artifact ID**: `bioimage-io/nitrous-diagnosis-intend-furiously` (staging)
- **Weight format**: `onnx` (opset 17, single-file, ~31 MB)
- **Framework version**: ONNX opset 17; onnxruntime CPU
- **Input shape**: `[1, 3, 256, 256]` (B, C, H, W) — pre-T1, FLAIR, post-T1 channels, values in [0,1]
- **Output shape**: `[1, 1, 256, 256]` — sigmoid probability in [0,1]

### Key challenges

1. **PyTorch 2.10 `torch.onnx.export` defaults to the dynamo-based exporter**, which creates two files: a tiny `weights.onnx` proto and a large `weights.onnx.data` external weights file. bioimageio.core cannot load a split ONNX model. Fix: pass `dynamo=False` explicitly:
   ```python
   torch.onnx.export(model, dummy, 'weights.onnx', opset_version=17,
                     input_names=['raw'], output_names=['probability'], dynamo=False)
   ```

2. **`onnxscript` module is not installed by default with PyTorch 2.10** — even the legacy (non-dynamo) path fails with `ModuleNotFoundError: No module named 'onnxscript'`. Fix: `pip install onnxscript onnx` before exporting.

3. **ONNX-only format: no `parent` field required** — the spec reference shows `parent: pytorch_state_dict` for ONNX, but that is only needed when ONNX is a secondary format alongside pytorch_state_dict. When ONNX is the sole format, omit `parent` entirely. Static validation (`bioimageio.spec`) passes without it.

4. **Dynamo-based exporter ignores `opset_version`** — it exported as opset 18 despite `opset_version=17`. The legacy exporter (`dynamo=False`) respects the requested opset.

5. **`bioimageio test` prints format_version `0.5.9` even though YAML says `0.5.4`** — the installed `bioimageio.spec 0.5.9.1` auto-upgrades the format description during load. This is expected behavior, not an error.

### What worked

- `dynamo=False` in `torch.onnx.export` for a clean single-file ONNX
- No `parent` field in the `onnx` weights block (ONNX-only package)
- Output axes reference input axes with the same IDs (`y`, `x`) — no need for `y_out`/`x_out`
- No preprocessing needed beyond `ensure_dtype: float32` — model expects [0,1] input
- No postprocessing needed — sigmoid is embedded inside the UNet `forward()`
- `bioimageio test` passed on first attempt with exact output match (max difference 0.00)

### Issues found (for future filing)

- **bioimageio-models skill `references/model-spec-reference.md`**: ONNX section shows `parent: pytorch_state_dict` without clarifying it is only needed for secondary formats. An ONNX-only package must omit `parent`.
- **torch.onnx**: Default exporter in PyTorch >=2.9 produces split external data files; legacy exporter (`dynamo=False`) is needed for single-file export. The skill should document this.

### rdf.yaml snippet (ONNX-only, no parent)

```yaml
weights:
  onnx:
    source: weights.onnx
    sha256: a84d8d7ff0a23b2942799f831392fd133cacfb356860afa6cb8141294ff3bd2e
    opset_version: 17
    # No 'parent' field — ONNX is the sole format in this package
```

## StarDist 2D Versatile Fluorescence (Keras HDF5) — 2026-04-16

- **Source**: https://github.com/stardist/stardist-models/releases/download/v0.1/python_2D_versatile_fluo.zip
- **Artifact ID**: `bioimage-io/complacent-lemur-suspended-promptly` (staging)
- **Weight format**: `keras_hdf5` (full model + weights saved via `model.save()`, TF 2.21)
- **Framework version**: TensorFlow 2.21.0 / Keras 3.14.0
- **Input shape**: `[1, 256, 256, 1]` (B, Y, X, C) — channels-last Keras convention, grayscale fluorescence
- **Output shapes**: `[1, 128, 128, 1]` nucleus probability map + `[1, 128, 128, 32]` star-convex radial distances

### Key challenges

1. **StarDist weights file (`weights_best.h5`) only contains layer weights, not the model architecture** — it cannot be loaded with `keras.models.load_model()` directly. Fix: load via the `stardist` Python package (which reconstructs the architecture from `config.json`), then call `model.keras_model.save(path)` to produce a self-contained H5 file with embedded architecture:
   ```python
   from stardist.models import StarDist2D
   model = StarDist2D(None, name='2D_versatile_fluo', basedir='models/')
   model.keras_model.save('stardist_2D_versatile_fluo.h5')
   ```

2. **Output spatial resolution is half the input** — StarDist uses `grid=(2,2)` which downsamples output by 2× in each axis. Input `(1, 256, 256, 1)` → outputs `(1, 128, 128, 1)` and `(1, 128, 128, 32)`. The bioimageio spec's `SizeReference` has NO `scale` field in spec 0.5.9, so you cannot express "output = input/2" as a reference. Fix: use **fixed sizes** (`size: 128`) in the output axes.

3. **`covers` must be a plain list of string paths, NOT a list of dicts** — the skill's example showed `source:`/`sha256:` fields under covers (following test_tensor syntax), but the covers field only accepts string paths. Fix:
   ```yaml
   covers:
     - cover.png    # correct: just the filename
   ```

4. **`SizeReference` does not accept `scale` or `offset` fields in spec 0.5.9** — unlike the skill's "Dynamic Output Shape" example which showed `scale: 0.5`, this causes validation failure. Only `tensor_id`, `axis_id`, and `offset` (integer) are valid fields. The `scale` field does not exist.

5. **`scikit-image` build error when installing stardist after tensorflow** — a pip conflict can break the existing `scikit-image` install. Fix: `pip install scikit-image --upgrade` after installing stardist.

6. **Multi-output Keras models work fine with bioimageio.core** — the keras_hdf5 backend handles models with multiple output tensors (e.g., `(prob, dist)` tuple) without any special configuration. Just declare multiple `outputs:` entries in the YAML.

### What worked

- Loading via `stardist` library then saving the full Keras model to a new H5 file
- Fixed output sizes (`size: 128`) instead of trying to use a scaled SizeReference
- Channels-last axis order `BYXC` declared correctly in inputs/outputs
- Static validation (`bioimageio.spec 0.5.9.1`): passed on 2nd attempt after fixing covers + SizeReference
- Dynamic test (`bioimageio test`): passed on first attempt — both outputs matched expected values

### Skill/spec issues found

- **Skill `references/model-spec-reference.md`**: "Dynamic Output Shape" example shows `SizeReference` with `offset` and implies `scale` exists, but `scale` is not a valid field in spec 0.5.9. Needs clarification that scaled output sizes must use fixed sizes or a different approach.
- **Skill Phase 2**: `covers` section example in skill could mention that covers are plain string paths (not dicts like test_tensor). Confusing when test_tensor uses `source:` + `sha256:` structure but covers does not.
- **bioimageio.spec**: `SizeReference` missing a `scale` field means models with non-unity stride (like StarDist grid=2) cannot express "output shape = input/2" dynamically. This is a real spec limitation.

### rdf.yaml snippet (keras_hdf5 multi-output, fixed output sizes)

```yaml
inputs:
  - id: raw
    axes:
      - type: batch
        size: 1
      - type: space
        id: y
        size: 256
      - type: space
        id: x
        size: 256
      - type: channel
        channel_names: [fluorescence]

outputs:
  - id: probability
    axes:
      - type: batch
      - type: space
        id: y
        size: 128    # = input_size / 2 (grid=2), fixed not referenced
      - type: space
        id: x
        size: 128
      - type: channel
        channel_names: [nucleus_probability]

  - id: distances
    axes:
      - type: batch
      - type: space
        id: y
        size: 128
      - type: space
        id: x
        size: 128
      - type: channel
        channel_names: [dist_0, dist_1, ..., dist_31]  # 32 entries

weights:
  keras_hdf5:
    source: stardist_2D_versatile_fluo.h5
    sha256: 20624163d41dcdf2542dd30da21267e716507b50d3fdb3f0c31d5da178086b62
    tensorflow_version: "2.21.0"
```

## DnCNN Blind Gaussian Denoiser (TorchScript) — 2026-04-16

- **Source**: https://github.com/cszn/KAIR (MIT License)
- **Artifact ID**: `bioimage-io/tough-lion` (staging)
- **Weight format**: `torchscript` (first TorchScript submission)
- **Framework version**: PyTorch 1.13.1
- **Input shape**: `[1, 1, 256, 256]` (B, C, H, W) — normalized grayscale fluorescence, float32 in [0,1]
- **Output shape**: `[1, 1, 256, 256]` — denoised image, float32 in [0,1]

### Key challenges

1. **KAIR weights URL**: `raw.githubusercontent.com` path returned 404. Use the GitHub **releases** URL:
   ```bash
   curl -L "https://github.com/cszn/KAIR/releases/download/v1.0/dncnn_gray_blind.pth" -o weights.pth
   ```

2. **Architecture has 20 layers (not 17)** — the KAIR blind variant uses 20 Conv layers and no BatchNorm. Must inspect the state dict to reconstruct the architecture before defining the class. Keys pattern: `model.0.weight` through `model.38.weight` (step=2, odd indices = non-parametric ReLUs).

3. **TorchScript needs NO architecture file** — unlike `pytorch_state_dict`, the TorchScript format embeds the computation graph. No `.py` file is needed in the package; the `weights.torchscript` YAML block has no `architecture:` subkey.

4. **BioEngine Ray cluster outage** — the remote test hung for 35+ minutes because the local Ray cluster had crashed the day before. The `runner.get_load()` returned `0.1` even though the cluster was dead (misleading). Local `bioimageio test` confirmed the model was correct.

5. **Review request: `stage=True` not `version="stage"`** — the SKILL.md Phase 6b code uses `version="stage"` which causes a PermissionError. Correct call:
   ```python
   await am.edit(artifact_id=artifact_id, stage=True, manifest={**manifest, "status": "request-review"})
   ```

6. **`bioimageio test` not in PATH on some systems** — use `python3 -m bioimageio.core test` instead.

### What worked

- `bioimageio.core==0.9.0` on **Python 3.8** for TorchScript — the `ignore_cleanup_errors` issue only affects the `pytorch_state_dict` code path. No patch needed for TorchScript.
- Wrapping DnCNN to output denoised image directly (`x − predicted_noise`) makes the output immediately interpretable.
- Static + dynamic validation both passed on first attempt.
- Model denoising performance validated: MSE reduced 114× on synthetic test.

### rdf.yaml snippet (TorchScript — no architecture field)

```yaml
weights:
  torchscript:
    source: weights.pt
    sha256: c1bc1ade186a645dc58291df87232f3827ab69ece6f85f12c3441cb2c44c6e66
    pytorch_version: "1.13.1"
    # NO architecture: field — TorchScript embeds the computation graph
```

---

<!-- Template for new entries:

## [Model Name] — [YYYY-MM-DD]
- **Source**: [URL to original model weights]
- **Artifact ID**: [bioimage-io/GENERATED-ID after submission]
- **Weight format**: pytorch_state_dict / onnx / tensorflow_saved_model_bundle / keras_hdf5
- **Framework version**: e.g. PyTorch 2.0, TF 2.14
- **Input shape**: e.g. [1, 1, 256, 256] (B, C, H, W)
- **Key challenge**: [The hardest part of packaging this model]
- **What worked**: [The specific approach/fix that solved it]
- **Issues filed**: [Links to any GitHub issues opened during the process]
- **rdf.yaml snippet** (if a non-obvious pattern was needed):
```yaml
[paste relevant section here]
```

-->
