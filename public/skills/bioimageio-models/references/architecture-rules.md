# Architecture File Rules (`pytorch_state_dict` only)

Read this before writing (or copying) the `architecture.py` file for a
model submitted with `weights: pytorch_state_dict`. Other weight formats
(TorchScript, ONNX, TensorFlow SavedModel, etc.) embed the architecture
in the weight file itself and do not need a `.py`.

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
- **No `conda_env` field in `rdf.yaml`.** Omit it entirely. Adding a
  custom conda environment will prevent the BioEngine from running the
  model.
- **Keep the import block small.** For most models `import torch`,
  `import torch.nn as nn`, `import numpy as np` is all you need. Import
  cellpose / careamics / tensorflow only when the model actually depends
  on them at forward time.
- **Constructor accepts plain Python types only** — `int`, `float`,
  `bool`, `str`. No custom config objects (Pydantic models, dataclasses,
  hydra configs, etc.).

### If your model needs a package that isn't in the list

- For a one-off remote test, `bioimage-io/model-runner`'s
  `test(..., additional_requirements=["your_package==x.y.z"])` kwarg
  runs that single test as a fresh Ray task that layers your extras on
  top of the baseline. Good for prototyping; slower on every call.
- For a permanent addition, file an issue at
  <https://github.com/aicell-lab/bioengine> requesting the package be
  added to `apps/model-runner/runtime.py`'s `REQUIREMENTS`. Include the
  package version and why it can't be replaced by native `torch` /
  `numpy` code.

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
