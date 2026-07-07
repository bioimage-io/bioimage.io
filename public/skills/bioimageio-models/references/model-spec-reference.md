# BioImage.IO Model RDF — Field Reference

Format version: **0.5.11** (or the latest released model spec supported by `bioimageio.spec`)  
Spec source: https://github.com/bioimage-io/spec-bioimage-io  
Full interactive docs: https://bioimage-io.github.io/spec-bioimage-io/interactive_docs_v0-5.html

---

## Minimal Valid Structure

```yaml
%YAML 1.2
---
format_version: 0.5.11
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
| `format_version` | YES | string | Use `"0.5.11"` or the latest released model spec supported by `bioimageio.spec` |
| `type` | YES | string | Always `"model"` |
| `name` | YES | string | 5–128 chars. Human-readable, descriptive. No "model" suffix needed. |
| `description` | YES | string | Max 1024 chars. What it does, what data it handles. |
| `license` | YES | string or FileDescr | SPDX identifier (e.g. `MIT`, `CC-BY-4.0`, `CC0-1.0`, `Apache-2.0`, `GPL-3.0`), or a custom license file descriptor for non-SPDX licenses |
| `authors` | YES | list | At least one entry with `name` |
| `inputs` | YES | list | At least one input tensor descriptor |
| `outputs` | YES | list | At least one output tensor descriptor |
| `weights` | YES | dict | At least one weights format |
| `documentation` | recommended | FileDescr | `source` + `sha256` for `README.md` |
| `covers` | recommended | list of FileDescr | Cover image descriptors with `source` + `sha256` (PNG/JPG, <500KB, 2:1 aspect) |
| `tags` | recommended | list | See tags section below |
| `cite` | recommended | list | Citations with `doi` or `url` |
| `git_repo` | optional | string | URL to source repository |
| `maintainers` | optional | list | Who to contact for issues |
| `packaged_by` | optional | list | People who packaged/uploaded the model, especially if different from `authors` |
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

## License, Documentation, Covers, and Packagers

For standard licenses, use an SPDX identifier:

```yaml
license: MIT
```

For non-SPDX or custom upstream licenses, use a file descriptor (model spec 0.5.11+):

```yaml
license:
  source: LICENSE.md
  sha256: <hash>
```

Current model spec versions also use file descriptors for docs and covers:

```yaml
documentation:
  source: README.md
  sha256: <hash>
covers:
  - source: cover0.png
    sha256: <hash>
```

If the package was prepared by someone other than the model authors, record that explicitly:

```yaml
packaged_by:
  - name: "Firstname Lastname"
    github_user: githubhandle
    affiliation: "Institute Name"
maintainers:
  - name: "Firstname Lastname"
    github_user: githubhandle
```

Use the packagers as `maintainers` by default; they are usually the people who can fix packaging issues and update the submitted package.

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

Use real representative images for `test_tensor`, `sample_tensor`, and `covers`
whenever possible. Search the model card, source repository, linked dataset, or
paper assets before falling back to synthetic/random data. If synthetic test data
is used, mention that in the README or packaging log.

### Axis Types

| Type | Description | Required subfields |
|------|-------------|-------------------|
| `batch` | Batch dimension | none (size defaults to inferred) |
| `channel` | Channel dimension | `channel_names` (list of strings) |
| `space` | Spatial (x, y, z) | `id` (x/y/z), `size` |
| `time` | Time | `id`, `size` |
| `index` | General index | `id`, `size` |

### Dynamic Output Shape

If output shape equals input shape (e.g., semantic segmentation, denoising):
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

> **Important:** `SizeReference` only supports `tensor_id`, `axis_id`, and `offset` (integer).
> There is **no `scale` field** — you cannot express "output = input/2" via a reference.
> For models where the output is a fixed fraction of the input (e.g., StarDist with `grid=(2,2)`
> producing 128×128 output from 256×256 input), use **fixed sizes** in the output axes instead:
> ```yaml
> outputs:
>   - id: probability
>     axes:
>       - type: space
>         id: y
>         size: 128    # fixed — equal to expected_input_size / grid_factor
> ```

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

**Preference:** choose adaptable normalization such as `zero_mean_unit_variance` or
`scale_range` when it is compatible with the model. Use fixed constants only when
the native model contract requires fixed training statistics, and document their
source.

**Reference-output rule:** generate `test_output.npy` with the same preprocessing
declared here, preferably through the model's native library/runtime rather than
through `bioimageio.core`.

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

> **Beyond built-ins:** Cellpose flow dynamics (`cellpose_flow_dynamics` — kwargs `cellprob_threshold`, `flow_threshold`, `do_3D`, `min_size`, `output_dtype`), StarDist NMS (`stardist_postprocessing` — kwargs `grid`, `prob_threshold`, `nms_threshold`, `n_rays`), and any other decoder shipped as a callable live under `id: custom` (or the registered `id:` for the two ops above). See [custom-processing.md](custom-processing.md) for the full pattern including the SHA256 security model.

---

## Weights Formats

### PyTorch State Dict (most common)

Prefer including native `pytorch_state_dict` weights whenever a portable
architecture file can be provided. Treat it as the canonical/root weights format,
and attach converted formats such as ONNX or TorchScript with
`parent: pytorch_state_dict`.

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
    # parent: pytorch_state_dict   # Only include if pytorch_state_dict is ALSO in this package.
                                   # For ONNX-only packages, omit 'parent' entirely.
```

> **ONNX export note (PyTorch >= 2.9):** The default `torch.onnx.export` now uses the
> dynamo-based exporter, which produces **two files** (a small `.onnx` proto + a large
> `.onnx.data` external weights file). `bioimageio.core` cannot load split ONNX models.
> Use `dynamo=False` to get a single self-contained file:
> ```python
> torch.onnx.export(model, dummy, 'weights.onnx', opset_version=17,
>                   input_names=['raw'], output_names=['out'], dynamo=False)
> ```
> Also install `onnxscript` and `onnx` before exporting: `pip install onnxscript onnx`

### TorchScript

```yaml
weights:
  torchscript:
    source: weights.pt
    sha256: <hash>
    pytorch_version: "2.0.0"
    parent: pytorch_state_dict   # Only include if pytorch_state_dict is ALSO in this package.
                                 # For TorchScript-only packages, omit 'parent' entirely.
```

> **TorchScript packaging note:** TorchScript embeds the computation graph in the `.pt` file.
> Unlike `pytorch_state_dict`, you do NOT need a separate architecture `.py` file or an
> `architecture:` subkey in the weights block. Just export the model with
> `torch.jit.script(model).save("weights.pt")` and reference it above.
> `bioimageio.core==0.9.0` works on Python 3.8/3.9 for TorchScript (no downgrade needed).

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

Or use the helper script on the generated package directory: `scripts/compute_sha256.py model_package/generated/`

---

## Common Validation Errors and Fixes

| Error | Fix |
|-------|-----|
| `sha256 mismatch for ...` | Recompute SHA256 and update in YAML |
| `axis id 'x' not unique` | Axis `id` values must be unique **within** each tensor (not globally across tensors) |
| `pytorch_state_dict cannot have parent` | Remove `parent` from `pytorch_state_dict` block |
| `format_version not supported` | Use `"0.5.11"` or the latest released model spec supported by `bioimageio.spec` |
| `channel_names length != axis size` | Ensure `channel_names` list length matches number of channels |
| `test output does not match` | Regenerate `test_output.npy` from the exact RDF preprocessing, model, and postprocessing contract |
| `documentation must end in .md` | Rename doc file or fix path in YAML |
| `name too short` | Name must be 5–128 characters |
