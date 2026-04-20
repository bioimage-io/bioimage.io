# BioImage.IO RDF Format Reference

## Contents

- Format Versions
- Format 0.4.x
- Format 0.5.x
- Common Top-Level Fields
- Fetching the RDF
- Determining Input Shape from RDF

The Resource Description Framework (RDF) is a YAML/JSON metadata document that describes a bioimage.io model. The model-runner uses the RDF to understand input/output specifications.

## Format Versions

There are two major format versions in use:

| Version | Axes Format | Shape Format | ID Field | Example Models |
|---------|------------|-------------|----------|----------------|
| **0.4.x** | String (`"bcyx"`) | Fixed list (`[1,1,128,128]`) | `name` | ambitious-ant |
| **0.5.x** | List of dicts | Flexible with min/step | `id` | affable-shark |

---

## Format 0.4.x

### Input Specification

```yaml
inputs:
  - axes: bcyx                     # b=batch, c=channel, y=height, x=width
    data_type: float32
    shape: [1, 1, 128, 128]        # Exact expected shape
    data_range: [0.0, 1.0]         # Expected value range
    name: input0                   # Input tensor name
```

### Output Specification

```yaml
outputs:
  - axes: bcyx
    data_type: float32
    shape: [1, 1, 256, 256]        # May differ from input (e.g., super-resolution)
    data_range: [-.inf, .inf]      # Output range (-.inf/.inf = unbounded)
    name: output0                  # Output tensor name (used as dict key in infer result)
```

### Test Data References

```yaml
test_inputs: [test-input.npy]      # Files in the model artifact
test_outputs: [test-output.npy]
```

### Reading Axes

```python
axes_str = rdf["inputs"][0]["axes"]   # "bcyx"
shape = rdf["inputs"][0]["shape"]     # [1, 1, 128, 128]
output_key = rdf["outputs"][0]["name"]  # "output0"

# Map axes to dimensions
axis_map = {char: size for char, size in zip(axes_str, shape)}
# {'b': 1, 'c': 1, 'y': 128, 'x': 128}
```

---

## Format 0.5.x

### Input Specification

```yaml
inputs:
  - id: input0                     # Input tensor ID
    description: ''
    axes:
      - type: batch                # Batch dimension (always size 1 for inference)
      - id: channel
        type: channel
        channel_names: [channel0]  # Number and names of channels
      - id: y
        type: space
        size:
          min: 64                  # Minimum spatial size
          step: 16                 # Size must be: min + N*step (N >= 0)
      - id: x
        type: space
        size:
          min: 64
          step: 16
    test_tensor:
      source: test_input_0.npy    # Test data file
    data:
      type: float32               # Expected data type
```

### Output Specification

```yaml
outputs:
  - id: output0                    # Output tensor ID (used as dict key in infer result)
    axes:
      - type: batch
      - id: channel
        type: channel
        channel_names: [channel0, channel1]  # Multi-channel output
      - id: y
        type: space
        halo: 16                   # Border pixels to crop (handled by model-runner)
        size:
          tensor_id: input0        # Output size depends on input
          axis_id: y
          offset: 0               # output_size = input_size + offset
      - id: x
        type: space
        halo: 16
        size:
          tensor_id: input0
          axis_id: x
          offset: 0
    test_tensor:
      source: test_output_0.npy
    data:
      type: float32
```

### Reading Axes (0.5.x)

```python
axes = rdf["inputs"][0]["axes"]
output_key = rdf["outputs"][0]["id"]  # "output0"

for ax in axes:
    ax_type = ax.get("type")
    ax_id = ax.get("id", ax_type)
    
    if ax_type == "batch":
        print(f"Batch axis")
    elif ax_type == "channel":
        channels = ax.get("channel_names", [])
        print(f"Channel axis: {len(channels)} channel(s)")
    elif ax_type == "space":
        size_spec = ax.get("size", {})
        if isinstance(size_spec, dict):
            min_size = size_spec.get("min", 0)
            step = size_spec.get("step", 1)
            print(f"Space axis '{ax_id}': min={min_size}, step={step}")
        elif isinstance(size_spec, int):
            print(f"Space axis '{ax_id}': fixed size={size_spec}")
```

### Valid Spatial Sizes (0.5.x)

For an axis with `min=64, step=16`, valid sizes are:
`64, 80, 96, 112, 128, 144, 160, ...` (i.e., `64 + 16*N` for `N >= 0`)

```python
def get_valid_size(current_size: int, min_size: int, step: int) -> int:
    """Round current_size to nearest valid size >= min_size."""
    if current_size <= min_size:
        return min_size
    # Round down to nearest valid size
    n = (current_size - min_size) // step
    valid = min_size + n * step
    return valid
```

---

## Common Top-Level Fields

| Field | Description |
|-------|-------------|
| `name` | Human-readable model name |
| `description` | Short model description |
| `tags` | List of tags (e.g., `["fluorescence-light-microscopy", "nuclei"]`) |
| `format_version` | RDF format version (`"0.4.10"` or `"0.5.7"`) |
| `authors` | List of `{name, affiliation}` |
| `license` | License identifier (e.g., `"CC-BY-4.0"`) |
| `weights` | Available weight formats and their sources |
| `covers` | Cover image filenames |
| `documentation` | Documentation file name |
| `config` | Additional config including `bioimageio.nickname` |

---

## Fetching the RDF

### Via Hypha RPC (recommended)

```python
from hypha_rpc import connect_to_server

server = await connect_to_server({"server_url": "https://hypha.aicell.io", "method_timeout": 60})
mr = await server.get_service("bioimage-io/model-runner")
rdf = await mr.get_model_rdf(model_id="affable-shark")
```

### Via YAML download (works for all models)

```python
import requests
import yaml

resp = requests.get("https://hypha.aicell.io/bioimage-io/artifacts/affable-shark/files/rdf.yaml")
rdf = yaml.safe_load(resp.text)
```

### Via curl

```bash
curl -s "https://hypha.aicell.io/bioimage-io/artifacts/affable-shark/files/rdf.yaml"
```

---

## Determining Input Shape from RDF

Universal helper that works for both format versions:

```python
def get_input_info(rdf: dict) -> dict:
    """Extract input shape information from any RDF format version."""
    inp = rdf["inputs"][0]
    axes = inp["axes"]
    
    if isinstance(axes, str):
        # Format 0.4.x
        shape = inp.get("shape", [])
        return {
            "format": "0.4",
            "axes": list(axes),
            "shape": shape,
            "n_dims": len(axes),
            "input_key": inp.get("name", "input0"),
            "data_type": inp.get("data_type", "float32"),
            "data_range": inp.get("data_range"),
        }
    else:
        # Format 0.5.x
        axis_info = []
        for ax in axes:
            info = {"type": ax.get("type"), "id": ax.get("id", ax.get("type"))}
            size_spec = ax.get("size")
            if isinstance(size_spec, dict):
                info["min"] = size_spec.get("min")
                info["step"] = size_spec.get("step")
            elif isinstance(size_spec, int):
                info["fixed"] = size_spec
            if "channel_names" in ax:
                info["n_channels"] = len(ax["channel_names"])
            axis_info.append(info)
        
        return {
            "format": "0.5",
            "axes": axis_info,
            "n_dims": len(axes),
            "input_key": inp.get("id", "input0"),
            "data_type": inp.get("data", {}).get("type", "float32"),
        }
```
