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
careamics==0.0.16     cellpose==3.1.1.2     xarray==2025.1.2
```

## Rules

- **No custom library imports.** Do not `import cellpose`,
  `import stardist`, `import monai`, or any package not in the list
  above. If the original model used such a library, rewrite the
  architecture class using only `torch` + `torch.nn`.
- **Self-contained.** The `.py` file must define the full model class
  with all layers inline. No relative imports, no local helper modules.
- **No `conda_env` field in `rdf.yaml`.** Omit it entirely. Adding a
  custom conda environment will prevent the BioEngine from running the
  model.
- **Minimal imports.** Only `import torch`, `import torch.nn as nn`,
  and `import numpy as np` at the top. Nothing else unless it's in the
  fixed list above.
- **Constructor accepts plain Python types only** — `int`, `float`,
  `bool`, `str`. No custom config objects (Pydantic models, dataclasses,
  hydra configs, etc.).

## Bad — will fail on BioEngine

```python
from cellpose.models import CellposeModel   # custom lib, not installed
from my_project.blocks import ResBlock      # local import, path not available
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
