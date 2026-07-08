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

The BioEngine model runner runs inside a Ray Serve deployment that has
a **fixed set of pre-installed packages**. There is no `conda_env`
support, no `pip install` at deploy time, no way to add packages
per-model. Your architecture file must work with only:

```
torch==2.5.1          torchvision==0.20.1   numpy==1.26.4
tensorflow==2.16.1    bioimageio.core==0.10.0  onnxruntime==1.20.1
careamics==0.0.16     cellpose==3.1.1.2     stardist==0.9.1
xarray==2025.1.2
```

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
- **No `conda_env` in `rdf.yaml` for models that should be served by
  the shared BioEngine runtime.** The default `test()` and
  `infer()` code paths both use the RuntimeApp's own venv (the pinned
  set below), so declaring a custom conda env for a
  runtime-compatible model just adds cost with no benefit.
- **Keep the import block small.** For most models `import torch`,
  `import torch.nn as nn`, `import numpy as np` is all you need. Import
  cellpose / careamics / tensorflow only when the model actually depends
  on them at forward time.
- **Constructor accepts plain Python types only** — `int`, `float`,
  `bool`, `str`. No custom config objects (Pydantic models, dataclasses,
  hydra configs, etc.).

### If your model genuinely needs deps outside the shared runtime

- **Declare a `conda_env` in `rdf.yaml`** with the extra packages
  and expect callers to opt into
  `test(..., custom_environment=True)`. That path spawns
  `mamba env create` from the model's declared spec, runs
  `bioimageio test` inside the fresh env, and removes it on both
  success and failure. First run is slow (~10 min for a full torch
  env solve + install); subsequent runs reuse the cached env in
  ~1-2 min. **Only the test path** honours `custom_environment` —
  regular `infer()` still uses the shared runtime, so the model
  will not be servable for inference outside its own env.
- **Alternative — extend the shared runtime.** For packages that
  would benefit multiple models, open an issue at
  <https://github.com/aicell-lab/bioengine> requesting the pin be
  added to `apps/model-runner/requirements-runtime.txt`. Include
  the exact version and a one-line rationale for why it can't be
  replaced with native `torch` / `numpy` code.

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
