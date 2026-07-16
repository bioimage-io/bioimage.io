# Architecture File Rules (`pytorch_state_dict` only)

Read this before writing (or copying) the `architecture.py` file for a
model submitted with `weights: pytorch_state_dict`. Other weight formats
(TorchScript, ONNX, TensorFlow SavedModel, etc.) embed the architecture
in the weight file itself and do not need a `.py`.

## Why `pytorch_state_dict` is the preferred primary format

When the architecture code can be shared cleanly (rewritable into the
fixed BioEngine runtime — see the next section), prefer
`pytorch_state_dict` over embedded-graph formats. It's the most
*transparent* option: reviewers and downstream users can read the
architecture (`.py`) and the trained weights (`.pt`) independently.
Compatibility bugs, subtle differences between torch versions, and
weight-conversion bugs are visible at code-review time rather than
hidden inside a serialized graph.

Choose `torchscript` / `onnx` as the primary format only when the
architecture is proprietary, too complex to rewrite portably (e.g. a
full Cellpose or StarDist backbone in a hurry), or already exported by
upstream. When you do, drop the architecture `.py` from the package
entirely — the graph is in the weight file and shipping stale `.py`
alongside just invites confusion.

For maximum backend coverage, ship `pytorch_state_dict` as the primary
format and add TorchScript / ONNX as *secondary* formats with
`parent: pytorch_state_dict` in the RDF.

## Fixed BioEngine runtime

The BioEngine model runner **serves inference** from a Ray Serve
deployment with a **fixed set of pre-installed packages**. For the
`infer()` path there is no per-model install and no way to add
packages — your architecture file must run against only this set
(kept in sync with
`apps/model-runner/requirements-runtime.txt`):

```
torch==2.5.1          torchvision==0.20.1   numpy==1.26.4
tensorflow==2.16.1    bioimageio.core==0.10.4  onnxruntime==1.20.1
careamics==0.0.16     cellpose==3.1.1.2     stardist==0.9.1
xarray==2025.1.2      timm==1.0.27
```

(The **test** path can additionally build a per-model conda env — see
"If your model genuinely needs deps outside the shared runtime" below —
but that env is used only for `bioimageio test`, never for serving
`infer()`.)

## Rules

- **No imports outside the fixed list above.** `import cellpose`,
  `import torch`, `import torchvision`, `import tensorflow`,
  `import onnxruntime`, `import careamics`, `import bioimageio.core`,
  `import numpy`, `import stardist`, and `import xarray` all work —
  those packages are pre-installed at the pinned versions above.
  Anything else — including `import monai`,
  `import segmentation_models_pytorch`, `import kornia` — will fail
  at deploy time.
- **Self-contained.** The `.py` file must define the full model class
  with all layers inline. No relative imports, no local helper modules.
- **Never vendor a library into the package to dodge the runtime.**
  Do not commit a wheel, a git checkout, or a base64/zip-encoded blob
  of a package and decode-and-`import` it at runtime. This is cheating,
  it will be rejected at review, and it isn't even necessary — use one
  of the two sanctioned paths below. Beyond that, it *breaks the model
  for real users*: a frozen encoded copy is pinned to your machine, so
  it can fail to import on a different OS/CPU/GPU and silently drifts
  out of sync when the real dependencies are upgraded around it — the
  model that "passed" quietly stops working wherever it's downloaded.
  A clean package is ~5–9 real files (the ones `rdf.yaml` references);
  a package carrying an encoded library is the tell-tale sign something
  went wrong.
- **Device-agnostic.** Don't hardcode `.cuda()`, `.cpu()`, or a
  `device=` default in the model — `bioimageio.core` selects the device
  (CUDA when available, else CPU) and moves the module and inputs onto
  it. Hardcoding a device breaks portability and can crash on the
  CPU-only leg of validation.
- **No custom env needed when the runtime already fits.** If the model
  runs on the pinned set above, do **not** add a `dependencies` conda
  env — the default `test()` and `infer()` paths both use the shared
  venv, so a redundant env just adds a slow mamba solve with no benefit.
- **Keep the import block small.** For most models `import torch`,
  `import torch.nn as nn`, `import numpy as np` is all you need. Import
  cellpose / careamics / tensorflow only when the model actually depends
  on them at forward time.
- **Constructor accepts plain Python types only** — `int`, `float`,
  `bool`, `str`. No custom config objects (Pydantic models, dataclasses,
  hydra configs, etc.).

### If your model genuinely needs deps outside the shared runtime

Two sanctioned paths, in order of preference. **Never** bundle the
library into the package instead.

1. **Preferred — export to TorchScript or ONNX.** Both formats embed
   the architecture in the weight file, drop the `.py` entirely, and
   run on the shared runtime, so the model stays **fully servable via
   `infer()`**. This is the right choice for Cellpose / StarDist
   backbones and anything else that can't be rewritten into the pinned
   set. See "When the original is too complex" below.

2. **Test-only — declare a conda environment file via `dependencies`.**
   On the `pytorch_state_dict` (or `tensorflow_saved_model_bundle`)
   weights entry, point the spec's `dependencies` field at a bundled
   `environment.yaml`:

   ```yaml
   weights:
     pytorch_state_dict:
       source: weights.pt
       sha256: <weights-sha256>
       architecture:
         source: architecture.py
         callable: MyModel
         sha256: <arch-sha256>
       pytorch_version: "2.7.1"          # must match the env's torch pin
       dependencies:
         source: environment.yaml         # a real conda env file, .yaml/.yml
         sha256: <environment-yaml-sha256>
   ```

   with, e.g.:

   ```yaml
   name: bioimageio-model-runtime
   channels: [conda-forge, nodefaults]
   dependencies:
     - python=3.11
     - pip
     - pip:
         - bioimageio.core==0.10.4
         - torch==2.7.1
         - torchvision==0.22.1
         - cellpose==4.2.1.1
         - segment-anything==1.0
   ```

   Callers opt in with `test(..., custom_environment=True)`. The runner
   computes the env via `bioimageio.spec.get_conda_env`, builds it with
   `mamba`, runs `bioimageio test` inside it, and **caches** it on the
   shared PVC (LRU-evicted under a size ceiling — not deleted per call).
   First build is slow (~10 min for a full torch solve); later runs
   reuse the cached env in ~1–2 min. The env file must include a
   `pytorch` compatible with the entry's `pytorch_version`.

   > **Critical limitation:** `custom_environment` is honoured **only on
   > the test path**. `infer()` always uses the shared runtime, so a
   > model that depends on a custom env is testable but **not servable**
   > on the public model-runner. If the model must run via `infer()`,
   > use path 1 (TorchScript/ONNX) instead.

3. **Or extend the shared runtime.** For packages that would benefit
   multiple models, open an issue at
   <https://github.com/aicell-lab/bioengine> requesting the pin be
   added to `apps/model-runner/requirements-runtime.txt`. Include the
   exact version and a one-line rationale for why it can't be replaced
   with native `torch` / `numpy` code.

## Bad — will fail on BioEngine

```python
import monai                                   # not in the fixed runtime — deploy fails
import segmentation_models_pytorch as smp      # not in the fixed runtime — deploy fails
from my_project.blocks import ResBlock         # local import, path not available at runtime
```

## Good

```python
import torch
import torch.nn as nn


class UNet(nn.Module):
    def __init__(self, in_channels: int = 1, out_channels: int = 1) -> None:
        super().__init__()
        self.enc = nn.Conv2d(in_channels, 64, 3, padding=1)
        self.dec = nn.Conv2d(64, out_channels, 1)

    def forward(self, x):
        return self.dec(torch.relu(self.enc(x)))
```

## When the original is too complex

If the model relies on a library that can't be rewritten portably —
for example a Cellpose backbone with 500+ lines of specialized blocks —
export the weights to **TorchScript** (`torch.jit.script` /
`torch.jit.trace`) or **ONNX** instead. Both formats embed the
architecture in the weight file and drop the `.py` requirement entirely.
Add them as secondary weight formats with
`parent: pytorch_state_dict` if you can still produce native state-dict
weights, or as the primary format if you cannot.
