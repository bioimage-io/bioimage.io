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

### bioimageio.yaml snippet (non-obvious pattern)

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

### bioimageio.yaml snippet (non-obvious axis pattern)

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
- **bioimageio.yaml snippet** (if a non-obvious pattern was needed):
```yaml
[paste relevant section here]
```

-->
