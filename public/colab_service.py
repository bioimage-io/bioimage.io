"""
BioImage.IO Colab - Data Providing Service
This service provides image data and saves annotations for collaborative image annotation.
Uses Pyodide's virtual filesystem.
"""

import io
import time
from enum import Enum
from functools import partial
from pathlib import Path
from typing import List

# Import libraries (will be installed in pyodide)
import numpy as np
import pyodide.http
import pyodide_http
from hypha_rpc import connect_to_server
from hypha_rpc.rpc import ObjectProxy, RemoteService
from js import console
from kaibu_utils import features_to_mask
from PIL import Image
from tifffile import imread

pyodide_http.patch_all()

WORKSPACE = "bioimage-io"
COLLECTION_ID = "bioimage-io/colab-annotations"


class ImageFormat(str, Enum):
    JPEG = "jpeg"
    JPG = "jpg"
    PNG = "png"
    TIF = "tif"
    TIFF = "tiff"


def list_image_files(image_folder: Path) -> List[Path]:
    """List all image files in the folder that match supported types."""
    try:
        if not image_folder.exists():
            console.log(f"Folder does not exist: {image_folder}")
            raise FileNotFoundError(f"Folder does not exist: {image_folder}")

        if not image_folder.is_dir():
            console.log(f"Directory does not exist: {image_folder}")
            raise NotADirectoryError(f"Directory does not exist: {image_folder}")

        extensions = tuple(member.value for member in ImageFormat)
        files = [
            f
            for f in image_folder.iterdir()
            if f.suffix.lower().lstrip(".") in extensions
        ]

        console.log(f"Found {len(files)} matching files in {image_folder}")
        return sorted(files)
    except Exception as e:
        console.log(f"Error listing files: {e}")
        import traceback

        traceback.print_exc()
        return []


def _read_tiff(file_path: str) -> np.ndarray:
    return imread(file_path)


def _read_pil(file_path: str) -> np.ndarray:
    with Image.open(file_path) as img:
        return np.array(img)


_IMAGE_READERS = {
    ImageFormat.TIFF: _read_tiff,
    ImageFormat.TIF: _read_tiff,
    ImageFormat.PNG: _read_pil,
    ImageFormat.JPEG: _read_pil,
    ImageFormat.JPG: _read_pil,
}


def process_image(image: np.ndarray) -> np.ndarray:
    # Check axes
    if image.ndim == 3 and image.shape[0] == 3 and image.shape[2] != 3:
        image = np.transpose(image, [1, 2, 0])

    # Convert to RGB
    if image.ndim == 2:
        image = np.stack([image] * 3, axis=-1)
    elif image.ndim == 3:
        if image.shape[2] == 1:
            image = np.concatenate([image] * 3, axis=-1)
        elif image.shape[2] == 4:
            image = image[..., :3]

    # Normalize to uint8
    if image.dtype != np.uint8:
        img_min = image.min()
        img_max = image.max()
        if img_max > img_min:
            image = ((image - img_min) / (img_max - img_min) * 255).astype(np.uint8)
        else:
            image = np.zeros_like(image, dtype=np.uint8)

    return image


def read_image(file_path: Path) -> np.ndarray:
    """Read an image file and return as numpy array."""
    try:
        ext = file_path.suffix.lower().lstrip(".")
        try:
            fmt = ImageFormat(ext)
        except ValueError:
            raise ValueError(f"Unsupported file extension: {ext}")

        reader = _IMAGE_READERS.get(fmt)
        if reader is None:
            raise NotImplementedError(f"No reader implemented for format: {fmt}")

        image = reader(str(file_path))
        processed_image = process_image(image)

        console.log(
            f"Read image: {file_path}, shape: {processed_image.shape}, dtype: {processed_image.dtype}"
        )

        return processed_image
    except Exception as e:
        console.log(f"Error reading image {file_path}: {e}")
        raise


async def get_image(
    server_url: str, artifact_manager: ObjectProxy, artifact_id: str, images_path: Path
) -> str:
    """Get a random image from the folder and upload it to the artifact."""
    console.log(f"\n🔵 get_image called")

    filenames = list_image_files(images_path)
    if not filenames:
        raise ValueError(f"No images found with supported types in {images_path}")

    r = np.random.randint(max(len(filenames) - 1, 1))
    image_path = filenames[r]

    # Read image
    image = read_image(image_path)

    pil_image = Image.fromarray(image)
    img_byte_arr = io.BytesIO()
    pil_image.save(img_byte_arr, format="PNG")
    img_bytes = img_byte_arr.getvalue()

    image_name = image_path.stem + ".png"

    try:
        existing_images = await artifact_manager.list_files(
            artifact_id, dir_path="input_images", stage=True
        )
        image_exists = any(f["name"] == image_name for f in existing_images)
    except Exception:
        image_exists = False

    if not image_exists:
        console.log(f"Uploading image {image_name} to artifact...")

        upload_url = await artifact_manager.put_file(
            artifact_id, file_path=f"input_images/{image_name}"
        )

        await pyodide.http.pyfetch(upload_url, method="PUT", body=img_bytes)

    artifact_alias = artifact_id.split("/")[-1]
    image_url = (
        f"{server_url}/{WORKSPACE}/artifacts/{artifact_alias}/files/input_images/{image_name}"
    )

    console.log(f"🔵 get_image returned url: {image_url}")

    return image_url


async def save_annotation(
    artifact_manager: ObjectProxy,
    artifact_id: str,
    label: str,
    image_name: str,
    features: list,
    image_shape: tuple,
) -> None:
    """Save annotation features as a mask image to the artifact."""
    console.log(f"\n{'='*60}")
    console.log(f"🟢 SAVE_ANNOTATION CALLED FROM PLUGIN")
    console.log(f"{'='*60}")
    console.log(f"   - image_name: {image_name}")
    console.log(f"   - label: {label}")

    try:
        mask = features_to_mask(features, image_shape[:2])

        console.log(f"Created mask shape: {mask.shape}, dtype: {mask.dtype}")

        # Extract stem from image_name (remove extension if present)
        # This handles both "image.png" -> "image" and "image" -> "image"
        image_stem = Path(image_name).stem

        try:
            files = await artifact_manager.list_files(
                artifact_id, dir_path=f"masks_{label}", stage=True
            )
            # Look for masks with this image stem
            existing_masks = [f for f in files if f["name"].startswith(f"{image_stem}_mask_")]
            n_image_masks = len(existing_masks)
        except Exception:
            n_image_masks = 0

        mask_filename = f"{image_stem}_mask_{n_image_masks + 1}.png"
        upload_path = f"masks_{label}/{mask_filename}"

        console.log(f"Saving mask to artifact: {upload_path}")

        pil_mask = Image.fromarray(mask.astype(np.uint8))
        mask_byte_arr = io.BytesIO()
        pil_mask.save(mask_byte_arr, format="PNG")
        mask_bytes = mask_byte_arr.getvalue()

        upload_url = await artifact_manager.put_file(artifact_id, file_path=upload_path)

        await pyodide.http.pyfetch(upload_url, method="PUT", body=mask_bytes)

        console.log(f"\n{'='*60}")
        console.log(f"🟢 SAVE_ANNOTATION COMPLETED SUCCESSFULLY")
        console.log(f"{'='*60}\n")

    except Exception as e:
        console.log(f"\n{'='*60}")
        console.log(f"❌ SAVE_ANNOTATION FAILED")
        console.log(f"{'='*60}")
        console.log(f"Error: {e}")
        import traceback

        traceback.print_exc()
        console.log(f"{'='*60}\n")
        raise


async def register_service(
    server_url: str,
    token: str,
    name: str,
    description: str,
    artifact_id: str,
    images_path: str,
    label: str,
):
    """Register the data providing service with Hypha."""

    # Check if the images folder exists
    images_path = Path(images_path)
    image_files = list_image_files(images_path)
    if not image_files:
        raise ValueError(f"No images found with supported types in {images_path}")

    # Connect to the server
    console.log(f"Connecting to server: {server_url}")
    client = await connect_to_server({"server_url": server_url, "token": token})
    artifact_manager = await client.get_service("public/artifact-manager")

    # Ensure the artifact exists and is in staging mode
    try:
        artifact = await artifact_manager.edit(artifact_id=artifact_id, stage=True)
    except KeyError as e:
        console.log(f"Artifact with ID {artifact_id} not found.")
        raise e
    except PermissionError as e:
        console.log(f"Permission denied to edit artifact with ID {artifact_id}.")
        raise e
    except Exception as e:
        console.log(f"Failed to edit artifact with ID {artifact_id}: {e}")
        raise e

    if artifact.type != "dataset":
        console.log(f"Artifact with ID {artifact_id} is not a dataset.")
        raise ValueError(f"Artifact {artifact_id} is not a dataset.")

    if artifact.parent_id != COLLECTION_ID:
        console.log(
            f"Artifact with ID {artifact_id} is not part of the expected collection {COLLECTION_ID}."
        )
        raise ValueError(
            f"Artifact {artifact_id} is not part of the expected collection {COLLECTION_ID}."
        )

    # Register the service
    console.log(f"Registering service: {name}")
    svc = await client.register_service(
        {
            "name": name,
            "description": description,
            "id": "data-provider-" + str(int(time.time() * 100)),
            "type": "annotation-data-provider",
            "config": {
                "visibility": "public",
            },
            # Exposed functions:
            "get_image": partial(
                get_image,
                server_url=server_url,
                artifact_manager=artifact_manager,
                artifact_id=artifact.id,
                images_path=images_path,
            ),
            "save_annotation": partial(save_annotation, artifact_manager, artifact.id, label),
        }
    )

    console.log(f"✓ Service registered!")
    console.log(f"  Service ID: {svc['id']}")
    console.log(f"  Available functions: {list(svc.get('service_schema', {}).keys())}")

    return svc, artifact
