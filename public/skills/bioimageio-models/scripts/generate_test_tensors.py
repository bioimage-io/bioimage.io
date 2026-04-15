#!/usr/bin/env python3
"""
Generate test_input.npy and test_output.npy for a model package.

Runs the model on a provided image (or a synthetic random input) and saves
the results as .npy files required by bioimageio.yaml.

Usage:
    # From an image file
    python generate_test_tensors.py --model weights.pt --arch model.py --class UNet2d \
        --input-image sample.png --input-shape "1,1,512,512" --output model_package/

    # With a random input (when no sample image is available)
    python generate_test_tensors.py --model weights.pt --arch model.py --class UNet2d \
        --input-shape "1,1,256,256" --random-input --output model_package/

    # From an existing .npy file
    python generate_test_tensors.py --model weights.pt --arch model.py --class UNet2d \
        --input-npy my_input.npy --output model_package/

    # ONNX model
    python generate_test_tensors.py --model weights.onnx --onnx \
        --input-npy my_input.npy --output model_package/
"""
import argparse
import importlib.util
import sys
from pathlib import Path

import numpy as np


def load_image_as_tensor(image_path: str, shape: tuple) -> np.ndarray:
    """Load an image and reshape to match the expected input shape."""
    try:
        from PIL import Image
    except ImportError:
        print("Install Pillow: pip install Pillow")
        sys.exit(1)
    img = Image.open(image_path).convert("L")  # Grayscale
    b, c, h, w = shape
    img = img.resize((w, h))
    arr = np.array(img, dtype=np.float32)
    arr = arr[np.newaxis, np.newaxis, :, :]  # Add batch + channel dims
    return arr


def normalize_zero_mean_unit_variance(x: np.ndarray) -> np.ndarray:
    mean = x.mean()
    std = x.std()
    if std < 1e-8:
        return x - mean
    return (x - mean) / std


def run_pytorch(model_path: str, arch_path: str, class_name: str,
                input_tensor: np.ndarray, kwargs: dict) -> np.ndarray:
    try:
        import torch
    except ImportError:
        print("Install PyTorch: pip install torch")
        sys.exit(1)

    # Load architecture
    spec = importlib.util.spec_from_file_location("model_module", arch_path)
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    ModelClass = getattr(mod, class_name)
    model = ModelClass(**kwargs)

    # Load weights — use weights_only=False for flexibility during test tensor generation.
    # NOTE: The final weights file submitted to the Zoo MUST be a pure state dict
    # (no numpy arrays, custom classes, or nested dicts with metadata).
    # If torch.load(weights_only=True) fails at submission time, extract the state dict first:
    #   checkpoint = torch.load('original.pth', weights_only=False)
    #   torch.save(checkpoint['model'], 'weights.pt')
    state = torch.load(model_path, map_location="cpu", weights_only=False)
    # Handle common checkpoint formats with nested state dicts
    for key in ("model_state_dict", "model", "state_dict", "net"):
        if isinstance(state, dict) and key in state and not isinstance(state[key], torch.Tensor):
            state = state[key]
            break
    model.load_state_dict(state)
    model.eval()

    x = torch.from_numpy(input_tensor)
    with torch.no_grad():
        y = model(x)
    return y.numpy()


def run_onnx(model_path: str, input_tensor: np.ndarray) -> np.ndarray:
    try:
        import onnxruntime as ort
    except ImportError:
        print("Install onnxruntime: pip install onnxruntime")
        sys.exit(1)
    session = ort.InferenceSession(model_path)
    input_name = session.get_inputs()[0].name
    outputs = session.run(None, {input_name: input_tensor})
    return outputs[0]


def save_cover_image(input_arr: np.ndarray, output_arr: np.ndarray, out_dir: Path):
    """Save a side-by-side PNG for use as a cover image."""
    try:
        import matplotlib.pyplot as plt
    except ImportError:
        print("Skipping cover image (matplotlib not available)")
        return

    fig, axes = plt.subplots(1, 2, figsize=(8, 4))
    # Take first batch, first channel
    inp = input_arr[0, 0] if input_arr.ndim == 4 else input_arr
    out = output_arr[0, 0] if output_arr.ndim == 4 else output_arr

    axes[0].imshow(inp, cmap="gray")
    axes[0].set_title("Input")
    axes[0].axis("off")

    axes[1].imshow(out, cmap="viridis")
    axes[1].set_title("Output")
    axes[1].axis("off")

    cover_path = out_dir / "cover0.png"
    plt.tight_layout()
    plt.savefig(cover_path, dpi=72, bbox_inches="tight")
    plt.close()
    cover_size = cover_path.stat().st_size
    if cover_size > 500 * 1024:
        print(f"  WARNING: Cover image is {cover_size // 1024}KB — exceeds 500KB Zoo limit. Reduce dpi or figure size.")
    else:
        print(f"  Cover image saved: {cover_path} ({cover_size // 1024}KB)")


def main():
    parser = argparse.ArgumentParser(description="Generate test tensors for bioimageio package")
    parser.add_argument("--model", required=True, help="Path to weight file (.pt, .onnx)")
    parser.add_argument("--arch", help="Path to architecture .py file (for pytorch)")
    parser.add_argument("--class", dest="cls", help="Model class name")
    parser.add_argument("--kwargs", default="{}", help="Model constructor kwargs as JSON string")
    parser.add_argument("--onnx", action="store_true", help="Use ONNX runtime")
    parser.add_argument("--input-image", help="Path to sample input image")
    parser.add_argument("--input-npy", help="Path to existing input .npy file")
    parser.add_argument("--input-shape", default="1,1,256,256",
                        help="Input shape as B,C,H,W (default: 1,1,256,256)")
    parser.add_argument("--random-input", action="store_true",
                        help="Generate a random input tensor")
    # Default: normalize is enabled. Use --skip-normalize to disable.
    normalize_group = parser.add_mutually_exclusive_group()
    normalize_group.add_argument("--normalize", dest="normalize", action="store_true", default=True,
                                 help="Apply zero_mean_unit_variance normalization before inference (default)")
    normalize_group.add_argument("--skip-normalize", dest="normalize", action="store_false",
                                 help="Skip normalization (use when input is already normalized)")
    parser.add_argument("--output", default=".", help="Output directory")
    args = parser.parse_args()

    out_dir = Path(args.output)
    out_dir.mkdir(parents=True, exist_ok=True)

    shape = tuple(int(x) for x in args.input_shape.split(","))

    # Build input tensor
    if args.input_npy:
        print(f"Loading input from {args.input_npy}")
        input_tensor = np.load(args.input_npy).astype(np.float32)
    elif args.input_image:
        print(f"Loading image from {args.input_image}")
        input_tensor = load_image_as_tensor(args.input_image, shape)
    elif args.random_input:
        print(f"Generating random input with shape {shape}")
        input_tensor = np.random.rand(*shape).astype(np.float32)
    else:
        print("No input provided. Generating random input.")
        input_tensor = np.random.rand(*shape).astype(np.float32)

    # Normalize if requested
    if args.normalize:
        print("  Applying zero_mean_unit_variance normalization")
        input_tensor = normalize_zero_mean_unit_variance(input_tensor)

    # Run model
    print(f"Running model: {args.model}")
    if args.onnx:
        output_tensor = run_onnx(args.model, input_tensor)
    elif args.arch and args.cls:
        import json
        kwargs = json.loads(args.kwargs)
        output_tensor = run_pytorch(args.model, args.arch, args.cls, input_tensor, kwargs)
    else:
        print("Error: Provide either --onnx or (--arch + --class) for PyTorch")
        sys.exit(1)

    # Save tensors
    input_path = out_dir / "test_input.npy"
    output_path = out_dir / "test_output.npy"
    np.save(input_path, input_tensor)
    np.save(output_path, output_tensor)
    print(f"  Saved: {input_path}  shape={input_tensor.shape}  dtype={input_tensor.dtype}")
    print(f"  Saved: {output_path}  shape={output_tensor.shape}  dtype={output_tensor.dtype}")

    # Generate cover image
    save_cover_image(input_tensor, output_tensor, out_dir)

    # Print SHA256 hashes
    import hashlib
    def sha256(p):
        h = hashlib.sha256()
        with open(p, "rb") as f:
            for chunk in iter(lambda: f.read(65536), b""):
                h.update(chunk)
        return h.hexdigest()

    print(f"\nAdd to bioimageio.yaml:")
    print(f"  test_input.npy  sha256: {sha256(input_path)}")
    print(f"  test_output.npy sha256: {sha256(output_path)}")


if __name__ == "__main__":
    main()
