# BioImage.IO Model RDF — Field Reference

Format version: **0.5.4** (always use this or latest)  
Spec source: https://github.com/bioimage-io/spec-bioimage-io  
Full interactive docs: https://bioimage-io.github.io/spec-bioimage-io/interactive_docs_v0-5.html

---

## Minimal Valid Structure

```yaml
%YAML 1.2
---
format_version: 0.5.4
type: model
name: "Your Model Name Here"
description: "One or two sentences describing what this model does."
license: MIT

authors:
  - name: "Firstname Lastname"

inputs:
  - id: raw
    axes:
      - type: batch
        size: 1
      - type: channel
        channel_names: [raw]
      - type: space
        id: y
        size: 256
      - type: space
        id: x
        size: 256
    test_tensor:
      source: test_input.npy
      sha256: <sha256_of_test_input.npy>

outputs:
  - id: prediction
    axes:
      - type: batch
      - type: channel
        channel_names: [prediction]
      - type: space
        id: y
        size: 256
      - type: space
        id: x
        size: 256
    test_tensor:
      source: test_output.npy
      sha256: <sha256_of_test_output.npy>

weights:
  pytorch_state_dict:
    source: weights.pt
    sha256: <sha256_of_weights.pt>
    architecture:
      source: model.py
      callable: MyModelClass
      sha256: <sha256_of_model.py>
```

---

## Top-Level Fields

| Field | Required | Type | Notes |
|-------|----------|------|-------|
| `format_version` | YES | string | Always `"0.5.4"` |
| `type` | YES | string | Always `"model"` |
| `name` | YES | string | 5–128 chars. Human-readable, descriptive. No "model" suffix needed. |
| `description` | YES | string | Max 1024 chars. What it does, what data it handles. |
| `license` | YES | string | SPDX identifier: `MIT`, `CC-BY-4.0`, `CC0-1.0`, `Apache-2.0` |
| `authors` | YES | list | At least one entry with `name` |
| `inputs` | YES | list | At least one input tensor descriptor |
| `outputs` | YES | list | At least one output tensor descriptor |
| `weights` | YES | dict | At least one weights format |
| `documentation` | recommended | string | Path to `README.md` (must end in `.md`) |
| `covers` | recommended | list | Cover image paths (PNG/JPG, <500KB, 2:1 aspect) |
| `tags` | recommended | list | See tags section below |
| `cite` | recommended | list | Citations with `doi` or `url` |
| `git_repo` | optional | string | URL to source repository |
| `maintainers` | optional | list | Who to contact for issues |
| `timestamp` | optional | string | ISO 8601: `"2024-01-15T10:30:00+00:00"` |
| `training_data` | optional | dict | Reference to training dataset artifact |

---

## Authors

```yaml
authors:
  - name: "Firstname Lastname"          # required
    github_user: "githubhandle"         # optional
    orcid: "0000-0000-0000-0000"        # optional, strongly recommended
    affiliation: "Institute Name"       # optional
```

---

## Inputs / Outputs — Tensor Descriptors

Each tensor descriptor has:

```yaml
inputs:
  - id: raw                       # unique ID (no spaces, used in axis refs)
    description: "raw fluorescence input"   # optional but helpful — MAX 128 characters!
    axes:                         # list of axis descriptors
      - type: batch
        size: 1                   # set to 1 for single images
      - type: channel
        channel_names: [DAPI]     # list matching channel count
      - type: space
        id: y                     # id required for spatial axes
        size: 512                 # fixed size; or see dynamic sizing below
      - type: space
        id: x
        size: 512
    test_tensor:                  # REQUIRED
      source: test_input.npy
      sha256: <hash>
    sample_tensor:                # optional: for visualization on website
      source: test_input.png
      sha256: <hash>
    preprocessing:                # optional: operations applied before inference
      - id: zero_mean_unit_variance
        kwargs:
          axes: [y, x]
      - id: ensure_dtype
        kwargs:
          dtype: float32
```

### Axis Types

| Type | Description | Required subfields |
|------|-------------|-------------------|
| `batch` | Batch dimension | none (size defaults to inferred) |
| `channel` | Channel dimension | `channel_names` (list of strings) |
| `space` | Spatial (x, y, z) | `id` (x/y/z), `size` |
| `time` | Time | `id`, `size` |
| `index` | General index | `id`, `size` |

### Dynamic Output Shape

If output shape depends on input shape:
```yaml
outputs:
  - id: probability
    axes:
      - type: batch
      - type: channel
        channel_names: [probability]
      - type: space
        id: y
        size:
          tensor_id: raw        # reference input tensor
          axis_id: y            # reference input axis
        halo: 32                # border pixels to crop (for tiling)
      - type: space
        id: x
        size:
          tensor_id: raw
          axis_id: x
        halo: 32
```

---

## Preprocessing Operations

Applied to input tensors before inference:

| Operation | kwargs | Description |
|-----------|--------|-------------|
| `zero_mean_unit_variance` | `axes: [y, x]` or `[c, y, x]` | Subtract mean, divide by std |
| `scale_range` | `axes`, `min_percentile`, `max_percentile` | Percentile-based scaling |
| `scale_linear` | `gain`, `offset` | `x = x * gain + offset` |
| `ensure_dtype` | `dtype: float32` | Cast to dtype |
| `binarize` | `threshold: 0.5` | Binary threshold |
| `clip` | `min: 0.0, max: 1.0` | Clip values |

## Postprocessing Operations

Applied to output tensors after inference:

| Operation | kwargs |
|-----------|--------|
| `sigmoid` | none |
| `scale_linear` | `gain`, `offset` |
| `ensure_dtype` | `dtype: float32` |
| `binarize` | `threshold: 0.5` |
| `clip` | `min`, `max` |
| `zero_mean_unit_variance` | `axes` |
| `scale_range` | `axes`, `min_percentile`, `max_percentile` |
| `scale_mean_variance` | `axes` |

> **Note:** `softmax` is NOT a valid postprocessing operation in `bioimageio.spec` 0.5.x.
> For multi-class models that need softmax, embed it inside the model's `forward()` method
> so the output tensor is already a probability map. This keeps the model self-contained
> and compatible with all runtimes.

---

## Weights Formats

### PyTorch State Dict (most common)

```yaml
weights:
  pytorch_state_dict:
    source: weights.pt              # relative path to .pt or .pth file
    sha256: <hash>
    pytorch_version: "2.0.0"        # optional
    architecture:
      source: model.py              # Python file with model class
      callable: UNet2d              # class name
      sha256: <hash>
      kwargs:                       # constructor arguments
        in_channels: 1
        out_channels: 1
    dependencies:
      source: environment.yaml      # optional conda env file
      sha256: <hash>
```

**Rule:** `pytorch_state_dict` must NOT have a `parent` field — it is the root format.

**Rule:** The weights file must contain ONLY the state dict (`OrderedDict` of tensors), not a nested dict with extra metadata (e.g., normalization stats). `bioimageio.core` loads with `torch.load(weights_only=True)` which blocks numpy or other non-tensor objects. If your original `.pth` file contains extra metadata, extract just the state dict:

```python
data = torch.load('original.pth', weights_only=False)
torch.save(data['model'], 'weights.pt')  # save only the state dict
```

### ONNX (for cross-platform)

```yaml
weights:
  onnx:
    source: weights.onnx
    sha256: <hash>
    opset_version: 17
    parent: pytorch_state_dict      # required: what format this was converted from
```

### TorchScript

```yaml
weights:
  torchscript:
    source: weights.pt
    sha256: <hash>
    pytorch_version: "2.0.0"
    parent: pytorch_state_dict
```

### TensorFlow SavedModel

```yaml
weights:
  tensorflow_saved_model_bundle:
    source: tf_weights.zip
    sha256: <hash>
    tensorflow_version: "2.10"
```

### Keras HDF5

```yaml
weights:
  keras_hdf5:
    source: model.h5
    sha256: <hash>
    tensorflow_version: "2.10"
```

---

## Tags — Recommended Values

Use specific, searchable tags. Examples by category:

**Modality:** `fluorescence`, `electron-microscopy`, `brightfield`, `phase-contrast`, `confocal`, `widefield`, `STED`, `TIRF`, `H&E`

**Task:** `segmentation`, `instance-segmentation`, `semantic-segmentation`, `object-detection`, `denoising`, `super-resolution`, `restoration`, `classification`, `tracking`

**Architecture:** `unet`, `unet2d`, `unet3d`, `resnet`, `transformer`, `stardist`, `cellpose`

**Framework:** `pytorch`, `tensorflow`, `onnx`, `keras`

**Dimension:** `2D`, `3D`

**Organism/tissue:** `nucleus`, `cell`, `neuron`, `mitochondria`, `bacteria`, `tissue`

**Compatible tools:** `ilastik`, `deepimagej`, `qupath`, `imagej`, `napari`, `fiji`

---

## Citations

```yaml
cite:
  - text: "Ronneberger et al. U-Net: Convolutional Networks for Biomedical Image Segmentation. MICCAI 2015."
    doi: 10.1007/978-3-319-24574-4_28
  - text: "Training dataset reference"
    url: https://example.com/dataset
```

---

## SHA256 Computation

Every `source` field that references a local file needs a corresponding `sha256`.

```python
import hashlib
def sha256(path):
    h = hashlib.sha256()
    with open(path, "rb") as f:
        for chunk in iter(lambda: f.read(65536), b""):
            h.update(chunk)
    return h.hexdigest()
```

Or use the helper script: `scripts/compute_sha256.py model_package/`

---

## Common Validation Errors and Fixes

| Error | Fix |
|-------|-----|
| `sha256 mismatch for ...` | Recompute SHA256 and update in YAML |
| `axis id 'x' not unique` | Axis `id` values must be unique **within** each tensor (not globally across tensors) |
| `pytorch_state_dict cannot have parent` | Remove `parent` from `pytorch_state_dict` block |
| `format_version not supported` | Change to `"0.5.4"` |
| `channel_names length != axis size` | Ensure `channel_names` list length matches number of channels |
| `test output does not match` | Regenerate `test_output.npy` by running the model on `test_input.npy` |
| `documentation must end in .md` | Rename doc file or fix path in YAML |
| `name too short` | Name must be 5–128 characters |
