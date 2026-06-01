# Custom Pre/Postprocessing Operations

Introduced in **spec 0.5.10** / **bioimageio.core 0.10+**

Custom processing lets you ship arbitrary Python callables alongside your model weights to handle
pre/postprocessing that cannot be expressed by the built-in operations. This makes it possible to
contribute models with complex decoding logic (e.g., Cellpose flow dynamics, StarDist NMS, custom
normalizers) while keeping the package fully self-contained and reproducible.

---

## Two Modes

### Inline (development / submission)

Ship a `.py` source file inside the model package. The file is SHA256-verified before execution.

```yaml
postprocessing:
  - id: custom
    callable: my_postprocess      # class or factory function name in the source file
    source: my_postprocess.py     # path relative to rdf.yaml
    sha256: <64-char-sha256>      # required — computed from the .py file
    kwargs:
      threshold: 0.5              # forwarded to the callable
```

### Built-in (for established algorithms)

Reference a named operation from the standard library — no source file needed. Currently available
built-ins are listed in the [Postprocessing Operations](#built-in-specialized-postprocessing) section below.

---

## Writing a Custom Callable

There are two equivalent styles. Pick whichever fits your use case.

### Style 1 — Callable class

```python
# my_postprocess.py
import numpy as np

class my_postprocess:
    def __init__(self, threshold: float = 0.5) -> None:
        self.threshold = threshold

    def __call__(self, *arrays: np.ndarray) -> np.ndarray:
        """Apply threshold to first array and return uint8 mask."""
        return (arrays[0] > self.threshold).astype(np.uint8)
```

### Style 2 — Factory function (closure)

```python
# my_postprocess.py
import numpy as np

def my_postprocess(threshold: float = 0.5):
    def run(*arrays: np.ndarray) -> np.ndarray:
        return (arrays[0] > threshold).astype(np.uint8)
    return run
```

**Both styles are called identically at runtime:**
1. `op = my_postprocess(**kwargs)` — instantiated once per model load
2. `result = op(*tensors)` — called once per sample

**Constraints:**
- The callable **must not change the shape** of the input tensor(s).
- Only import packages from the BioEngine fixed runtime (see below).
- The source file must be self-contained — no relative imports, no local helpers.

### Allowed imports

Only packages pre-installed in the BioEngine runtime may be imported:

```
numpy==1.26.4         scipy                 scikit-image
torch==2.5.1          torchvision           tensorflow==2.16.1
onnxruntime==1.20.1   bioimageio.core       xarray
```

Do **not** import `cellpose`, `stardist`, or any package not in this list. If you need Cellpose or
StarDist decoding, use the dedicated built-in ops described below instead.

---

## Security Model

Custom processing source files are security-reviewed before a model is accepted into the public Zoo:

1. **SHA256 verification** — the `.py` file hash is checked on every load; tampered files are rejected.
2. **Explicit opt-in** — `bioimageio.core` requires `allow_custom_postprocessing=True` to execute custom ops; the default is `False`.
3. **Curator gate** — models with custom processing receive additional scrutiny before publication.
4. **Import sandbox** — only pre-installed packages may be imported (no `subprocess`, `os.system`, network calls, etc.).

### Running locally with allow_custom_postprocessing

```python
from bioimageio.core import load_model_description, create_prediction_pipeline

model = load_model_description("model_package/rdf.yaml")
pipeline = create_prediction_pipeline(
    model,
    allow_custom_postprocessing=True,   # required — explicit opt-in
)
```

---

## Built-in Specialized Postprocessing

These operations are part of the standard spec; no source file is needed.

### CellposeFlowDynamics

Decodes Cellpose flow fields and cell probability into integer instance labels.

**Expected input:** 3-channel tensor `[flow_y, flow_x, cellprob]`  
**Output:** integer instance label tensor (uint16, 0 = background)

```yaml
postprocessing:
  - id: cellpose_flow_dynamics
    kwargs:
      cellprob_threshold: 0.0    # cell probability threshold (default 0.0)
      flow_threshold: 0.4        # flow field threshold (default 0.4)
      do_3D: false               # enable 3D processing (default false)
      min_size: 15               # minimum object size in pixels (default 15)
      output_dtype: uint16       # output dtype (default uint16)
```

### StarDist2DPostprocessing

Decodes StarDist probability and distance predictions into instance labels via NMS.

```yaml
postprocessing:
  - id: stardist_postprocessing
    kwargs:
      grid: [2, 2]               # grid size of the network predictions
      prob_threshold: 0.5        # object probability threshold for NMS
      nms_threshold: 0.4         # IoU threshold for non-maximum suppression
      n_rays: 32                 # number of radial lines (must match model output)
```

---

## Input Padding

Spec 0.5.10 adds an optional `pad` field to input tensor descriptors. This lets the spec declare
how the runner should pad inputs that are smaller than the model's minimum tile size.

```yaml
inputs:
  - id: raw
    axes:
      - type: space
        id: y
        size: 256
      - type: space
        id: x
        size: 256
    pad:
      mode: reflect    # constant | edge | reflect | symmetric
      # For constant mode, also set:
      # value: 0.0
```

| Mode | Description |
|------|-------------|
| `constant` | Fill with a constant value (default 0) |
| `edge` | Repeat edge values |
| `reflect` | Mirror around the edge (edge pixel not duplicated) |
| `symmetric` | Mirror around the edge (edge pixel is duplicated) |

### Halo / output cropping

Models that use padding internally may produce unreliable border pixels. Declare a `halo` on output
spatial axes so tiling pipelines know how many pixels to discard:

```yaml
outputs:
  - id: labels
    axes:
      - type: space
        id: y
        size:
          tensor_id: raw
          axis_id: y
        halo: 32        # crop 32px from each side before assembling tiles
      - type: space
        id: x
        size:
          tensor_id: raw
          axis_id: x
        halo: 32
```

Use `get_halos()` from `bioimageio.core` to compute the required input padding from the output halos:

```python
from bioimageio.core import load_model_description
from bioimageio.spec.model.v0_5 import get_halos

model = load_model_description("model_package/rdf.yaml")
halos = get_halos(model.inputs, model.outputs)
```

---

## Complete Example — Cellpose Model Export

This shows a minimal but complete `rdf.yaml` for a Cellpose model that uses `CellposeFlowDynamics`
as a built-in postprocessing step.

```yaml
format_version: 0.5.10
type: model
name: Cellpose Nucleus Segmentation 2D

description: >
  2D Cellpose model for nucleus instance segmentation in fluorescence microscopy.
  Outputs flow fields decoded via CellposeFlowDynamics into instance labels.

license: BSD-3-Clause

authors:
  - name: Carsen Stringer
    github_user: carsen-stringer

tags:
  - cellpose
  - instance-segmentation
  - nucleus
  - 2D
  - fluorescence

inputs:
  - id: raw
    axes:
      - type: batch
        size: 1
      - type: channel
        channel_names: [nucleus]
      - type: space
        id: y
        size: 256
      - type: space
        id: x
        size: 256
    preprocessing:
      - id: scale_range
        kwargs:
          axes: [y, x]
          min_percentile: 1.0
          max_percentile: 99.0
    test_tensor:
      source: test_input.npy
      sha256: <hash>

outputs:
  - id: flows
    description: "3-channel output: [flow_y, flow_x, cellprob]"
    axes:
      - type: batch
      - type: channel
        channel_names: [flow_y, flow_x, cellprob]
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
    postprocessing:
      - id: cellpose_flow_dynamics
        kwargs:
          cellprob_threshold: 0.0
          flow_threshold: 0.4
          min_size: 15
          output_dtype: uint16
    test_tensor:
      source: test_output.npy
      sha256: <hash>

weights:
  pytorch_state_dict:
    source: cellpose_weights.pt
    sha256: <hash>
    architecture:
      source: cellpose_model.py
      callable: CellposeModel
      sha256: <hash>
```

---

## Complete Example — Fully Custom Postprocessing

For a model whose decoding logic is not covered by any built-in op:

```yaml
format_version: 0.5.10
type: model
name: Custom Decoder Model

# ... (other fields) ...

outputs:
  - id: labels
    axes:
      - type: batch
      - type: channel
        channel_names: [label]
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
    postprocessing:
      - id: custom
        callable: decode_predictions
        source: decode_predictions.py
        sha256: <sha256-of-decode_predictions.py>
        kwargs:
          threshold: 0.4
          min_size: 20
    test_tensor:
      source: test_output.npy
      sha256: <hash>
```

With `decode_predictions.py`:

```python
import numpy as np

class decode_predictions:
    def __init__(self, threshold: float = 0.4, min_size: int = 20) -> None:
        self.threshold = threshold
        self.min_size = min_size

    def __call__(self, *arrays: np.ndarray) -> np.ndarray:
        from skimage.measure import label
        from skimage.morphology import remove_small_objects
        binary = arrays[0] > self.threshold
        labeled = label(binary)
        labeled = remove_small_objects(labeled, min_size=self.min_size)
        return labeled.astype(np.uint16)
```

Compute SHA256 for the source file and add it to rdf.yaml:

```bash
python public/skills/bioimageio-models/scripts/compute_sha256.py model_package/
```

---

## Checklist for Custom Processing Models

```
[ ] Source file is self-contained (no local imports, no forbidden packages)
[ ] SHA256 hash computed for source file and added to rdf.yaml
[ ] Callable does not change tensor shape
[ ] Tested locally with allow_custom_postprocessing=True
[ ] Noted in README that model uses custom postprocessing
[ ] Verified with bioimageio test:
      pip install "bioimageio.spec>=0.5.10" "bioimageio.core>=0.10"
      bioimageio test model_package/rdf.yaml --allow-custom-postprocessing
```
