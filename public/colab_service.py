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
    """Process image to standard HWC RGB uint8 format.

    Expected output: (height, width, 3) with dtype uint8
    """
    console.log(f"Processing image - input shape: {image.shape}, dtype: {image.dtype}")

    # Check axes - convert CHW to HWC if needed
    if image.ndim == 3:
        # If first dimension is small (likely channels), transpose to HWC
        if image.shape[0] in [1, 3, 4] and image.shape[0] < image.shape[1] and image.shape[0] < image.shape[2]:
            console.log(f"  Transposing from CHW to HWC")
            image = np.transpose(image, [1, 2, 0])

    # Convert to RGB
    if image.ndim == 2:
        console.log(f"  Converting grayscale to RGB")
        image = np.stack([image] * 3, axis=-1)
    elif image.ndim == 3:
        if image.shape[2] == 1:
            console.log(f"  Converting single channel to RGB")
            image = np.concatenate([image] * 3, axis=-1)
        elif image.shape[2] == 4:
            console.log(f"  Converting RGBA to RGB")
            image = image[..., :3]
        elif image.shape[2] == 2:
            console.log(f"  Warning: 2-channel image, using first channel only")
            image = np.stack([image[..., 0]] * 3, axis=-1)

    # Normalize to uint8
    if image.dtype != np.uint8:
        console.log(f"  Normalizing from {image.dtype} to uint8")
        img_min = image.min()
        img_max = image.max()
        if img_max > img_min:
            image = ((image - img_min) / (img_max - img_min) * 255).astype(np.uint8)
        else:
            image = np.zeros_like(image, dtype=np.uint8)

    console.log(f"  Output shape: {image.shape}, dtype: {image.dtype}")
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
    server_url: str, artifact_manager: ObjectProxy, artifact_id: str, images_path: Path, context: dict = None,
) -> str:
    """Get a random image from the folder or artifact and return its URL."""
    console.log(f"\n🔵 get_image called")

    # Check if we should use local folder or remote artifact
    use_local_folder = images_path and images_path.exists() and images_path.is_dir()

    if use_local_folder:
        # Local folder mode: read from /mnt and upload to artifact
        console.log(f"Using local folder: {images_path}")
        filenames = list_image_files(images_path)
        if not filenames:
            raise ValueError(f"No images found with supported types in {images_path}")

        r = np.random.randint(max(len(filenames) - 1, 1))
        image_path = filenames[r]

        # Read image from local folder
        image = read_image(image_path)

        console.log(f"  Uploading image shape: {image.shape}, dtype: {image.dtype}")

        # Convert to PNG with explicit RGB mode
        pil_image = Image.fromarray(image, mode='RGB')
        img_byte_arr = io.BytesIO()
        pil_image.save(img_byte_arr, format="PNG")
        img_bytes = img_byte_arr.getvalue()

        image_name = image_path.stem + ".png"

        # Upload to artifact if not already there
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
    else:
        # Remote mode: get random image from artifact's input_images/
        console.log(f"Local folder not found, using artifact images")
        try:
            remote_files = await artifact_manager.list_files(
                artifact_id, dir_path="input_images", stage=True
            )
            if not remote_files:
                raise ValueError(f"No images found in artifact {artifact_id}/input_images")

            # Pick a random image from the artifact
            r = np.random.randint(len(remote_files))
            image_name = remote_files[r]["name"]
            console.log(f"Selected remote image: {image_name}")
        except Exception as e:
            console.log(f"Error accessing artifact images: {e}")
            raise ValueError(f"Cannot access images from artifact {artifact_id}/input_images: {e}")

    artifact_alias = artifact_id.split("/")[-1]
    image_url = (
        f"{server_url}/{WORKSPACE}/artifacts/{artifact_alias}/files/input_images/{image_name}"
    )

    console.log(f"🔵 get_image returned url: {image_url}")

    return image_url


async def get_local_image_base64(
    images_path: Path,
    image_name: str,
    context: dict = None,
) -> str:
    """Read a specific local image and return it as base64 PNG."""
    import base64

    console.log(f"🔵 get_local_image_base64 called for: {image_name}")

    # Check if using local folder
    if images_path is None:
        raise ValueError("Local folder not available: images_path is None")
    if not images_path.exists() or not images_path.is_dir():
        raise ValueError(f"Local folder not available: {images_path}")

    # Find the image file
    image_path = images_path / image_name
    if not image_path.exists():
        raise FileNotFoundError(f"Image not found: {image_name}")

    # Read and process the image
    image = read_image(image_path)

    console.log(f"  Image array shape for base64: {image.shape}, dtype: {image.dtype}")

    # Verify shape is correct (H, W, 3)
    if image.ndim != 3 or image.shape[2] != 3:
        raise ValueError(f"Invalid image shape for RGB: {image.shape}, expected (H, W, 3)")

    # Convert to PNG bytes - explicitly specify RGB mode
    pil_image = Image.fromarray(image, mode='RGB')
    img_byte_arr = io.BytesIO()
    pil_image.save(img_byte_arr, format="PNG")
    img_bytes = img_byte_arr.getvalue()

    # Encode as base64
    base64_str = base64.b64encode(img_bytes).decode('ascii')

    console.log(f"✓ Returning base64 image, size: {len(base64_str)} chars")
    return base64_str


async def save_annotation(
    artifact_manager: ObjectProxy,
    artifact_id: str,
    label: str,
    image_name: str,
    features: list,
    image_shape: tuple,
    context: dict = None,
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

        # Simple naming: just use image_stem.png (will overwrite if exists)
        mask_filename = f"{image_stem}.png"
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


async def list_local_images(
    images_path: Path,
    context: dict = None,
) -> list:
    """List all available images in the local folder."""
    console.log(f"🔵 list_local_images called")

    if images_path is None or not images_path.exists() or not images_path.is_dir():
        return []

    filenames = list_image_files(images_path)
    # Return just the names (stems) without extensions
    return [f.name for f in filenames]


async def upload_local_images_to_artifact(
    artifact_manager: ObjectProxy,
    artifact_id: str,
    images_path: Path,
    context: dict = None,
) -> dict:
    """Upload all local images to the artifact.

    Returns:
        dict with keys: total, success, failed, errors (list of error messages)
    """
    console.log(f"🔵 upload_local_images_to_artifact called")

    if images_path is None or not images_path.exists() or not images_path.is_dir():
        return {"total": 0, "success": 0, "failed": 0, "errors": ["Local folder not available"]}

    filenames = list_image_files(images_path)
    total = len(filenames)
    success = 0
    failed = 0
    errors = []

    console.log(f"Found {total} images to upload")

    for image_path in filenames:
        try:
            # Read and process image
            image = read_image(image_path)

            # Convert to PNG with explicit RGB mode
            pil_image = Image.fromarray(image, mode='RGB')
            img_byte_arr = io.BytesIO()
            pil_image.save(img_byte_arr, format="PNG")
            img_bytes = img_byte_arr.getvalue()

            image_name = image_path.stem + ".png"

            # Upload to artifact
            upload_url = await artifact_manager.put_file(
                artifact_id, file_path=f"input_images/{image_name}"
            )
            await pyodide.http.pyfetch(upload_url, method="PUT", body=img_bytes)

            success += 1
            console.log(f"✓ Uploaded {image_name} ({success}/{total})")

        except Exception as e:
            failed += 1
            error_msg = f"Failed to upload {image_path.name}: {str(e)}"
            errors.append(error_msg)
            console.log(f"✗ {error_msg}")

    result = {"total": total, "success": success, "failed": failed, "errors": errors}
    console.log(f"Upload complete: {result}")
    return result


async def write_file_to_temp(
    file_name: str,
    file_data_base64: str,
    context: dict = None,
) -> dict:
    """Write a file from JavaScript to temporary location in Python filesystem.

    Args:
        file_name: Original filename
        file_data_base64: Base64-encoded file data from JavaScript

    Returns:
        dict with keys: success (bool), temp_path (str), error (str or None)
    """
    import base64

    console.log(f"🔵 write_file_to_temp called for: {file_name}")

    try:
        # Decode base64 data
        file_bytes = base64.b64decode(file_data_base64)

        # Write to temporary location
        temp_dir = Path("/tmp/uploads")
        temp_dir.mkdir(exist_ok=True)
        temp_path = temp_dir / file_name

        with open(temp_path, "wb") as f:
            f.write(file_bytes)

        console.log(f"✓ Wrote {file_name} to {temp_path}")
        return {"success": True, "temp_path": str(temp_path), "error": None}

    except Exception as e:
        error_msg = f"Failed to write {file_name}: {str(e)}"
        console.log(f"✗ {error_msg}")
        return {"success": False, "temp_path": None, "error": error_msg}


async def upload_images_from_temp(
    artifact_manager: ObjectProxy,
    artifact_id: str,
    context: dict = None,
) -> dict:
    """Upload all images from /tmp/uploads to the artifact.

    Returns:
        dict with keys: total, success, failed, errors (list of error messages)
    """
    console.log(f"🔵 upload_images_from_temp called")

    temp_dir = Path("/tmp/uploads")
    if not temp_dir.exists():
        return {"total": 0, "success": 0, "failed": 0, "errors": ["Temp upload directory does not exist"]}

    # Get all files in temp directory
    try:
        filenames = list(temp_dir.iterdir())
    except Exception as e:
        return {"total": 0, "success": 0, "failed": 0, "errors": [f"Failed to list temp directory: {str(e)}"]}

    total = len(filenames)
    success = 0
    failed = 0
    errors = []

    console.log(f"Found {total} files in temp directory")

    for file_path in filenames:
        try:
            # Read and process image
            image = read_image(file_path)

            # Convert to PNG with explicit RGB mode
            pil_image = Image.fromarray(image, mode='RGB')
            img_byte_arr = io.BytesIO()
            pil_image.save(img_byte_arr, format="PNG")
            img_bytes = img_byte_arr.getvalue()

            image_name = file_path.stem + ".png"

            # Upload to artifact
            upload_url = await artifact_manager.put_file(
                artifact_id, file_path=f"input_images/{image_name}"
            )
            await pyodide.http.pyfetch(upload_url, method="PUT", body=img_bytes)

            success += 1
            console.log(f"✓ Uploaded {image_name} ({success}/{total})")

            # Clean up temp file
            file_path.unlink()

        except Exception as e:
            failed += 1
            error_msg = f"Failed to upload {file_path.name}: {str(e)}"
            errors.append(error_msg)
            console.log(f"✗ {error_msg}")

    # Clean up temp directory if empty
    if not list(temp_dir.iterdir()):
        temp_dir.rmdir()

    result = {"total": total, "success": success, "failed": failed, "errors": errors}
    console.log(f"Upload complete: {result}")
    return result


async def register_service(
    server_url: str,
    token: str,
    name: str,
    description: str,
    artifact_id: str,
    images_path: str,
    label: str,
    client_id: str = None,
    service_id: str = None,
):
    """Register the data providing service with Hypha.

    Args:
        server_url: URL of the Hypha server
        token: Authentication token
        name: Service name
        description: Service description
        artifact_id: Artifact ID to store annotations
        images_path: Path to local images folder (or None for cloud-only)
        label: Label for annotations
        client_id: Optional client ID for predictable service ID
        service_id: Optional service ID for predictable service ID

    Returns:
        dict: Service info with keys 'service_id', 'artifact_id', 'workspace', 'client_id'
    """

    # Connect to the server first
    console.log(f"Connecting to server: {server_url}")

    # Use client_id if provided for predictable connection
    connect_config = {"server_url": server_url, "token": token}
    if client_id:
        connect_config["client_id"] = client_id
        console.log(f"Using client_id: {client_id}")

    client = await connect_to_server(connect_config)
    artifact_manager = await client.get_service("public/artifact-manager")

    # Check if images are in local folder or artifact
    # images_path can be None for cloud-only mode
    if images_path is not None:
        images_path = Path(images_path)
        use_local_folder = images_path and images_path.exists() and images_path.is_dir()
    else:
        use_local_folder = False

    if use_local_folder:
        # Local folder mode: check for images in /mnt
        console.log(f"Using local folder: {images_path}")
        image_files = list_image_files(images_path)
        if not image_files:
            raise ValueError(f"No images found with supported types in {images_path}")
    else:
        # Remote mode: check for images in artifact
        console.log(f"Local folder not found, checking artifact for images...")
        try:
            remote_files = await artifact_manager.list_files(
                artifact_id, dir_path="input_images", stage=True
            )
            if remote_files:
                console.log(f"Found {len(remote_files)} images in artifact")
            else:
                console.log(f"No images found in artifact {artifact_id}/input_images yet (OK for resume mode)")
        except Exception as e:
            # It's OK if input_images doesn't exist yet - user might upload later
            console.log(f"Artifact {artifact_id} doesn't have input_images/ yet: {e}")

    # Ensure the artifact exists and is in staging mode
    # Only try to edit if we're using local folder (need to upload images)
    # For cloud-only mode, we can just read the artifact without editing
    try:
        if use_local_folder:
            console.log(f"Using local folder mode - editing artifact for write access")
            artifact = await artifact_manager.edit(artifact_id=artifact_id, stage=True)
        else:
            # For cloud-only mode, just get the artifact info without editing
            console.log(f"Cloud-only mode - reading artifact (no write access needed)")
            artifact = await artifact_manager.read(artifact_id=artifact_id, stage=True)
    except KeyError as e:
        console.log(f"Artifact with ID {artifact_id} not found.")
        raise e
    except PermissionError as e:
        console.log(f"Permission denied to access artifact with ID {artifact_id}.")
        raise e
    except Exception as e:
        console.log(f"Failed to access artifact with ID {artifact_id}: {e}")
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

    # Use provided service_id or generate one
    actual_service_id = service_id if service_id else "data-provider-" + str(int(time.time() * 100))

    svc = await client.register_service(
        {
            "name": name,
            "description": description,
            "id": actual_service_id,
            "type": "annotation-data-provider",
            "config": {
                "visibility": "public",
                "require_context": True,
            },
            # Exposed functions:
            "get_image": partial(
                get_image,
                server_url=server_url,
                artifact_manager=artifact_manager,
                artifact_id=artifact.id,
                images_path=images_path,
            ),
            "get_local_image_base64": partial(
                get_local_image_base64,
                images_path=images_path,
            ),
            "list_local_images": partial(
                list_local_images,
                images_path=images_path,
            ),
            "upload_local_images_to_artifact": partial(
                upload_local_images_to_artifact,
                artifact_manager=artifact_manager,
                artifact_id=artifact.id,
                images_path=images_path,
            ),
            "write_file_to_temp": write_file_to_temp,
            "upload_images_from_temp": partial(
                upload_images_from_temp,
                artifact_manager=artifact_manager,
                artifact_id=artifact.id,
            ),
            "save_annotation": partial(save_annotation, artifact_manager, artifact.id, label),
        }
    )

    console.log(f"✓ Service registered!")
    console.log(f"  Service ID: {svc['id']}")
    console.log(f"  Client ID: {client.config.get('client_id', 'N/A')}")
    console.log(f"  Workspace: {client.config.get('workspace', 'N/A')}")
    console.log(f"  Available functions: {list(svc.get('service_schema', {}).keys())}")

    # Return structured data instead of raw service/artifact objects
    return {
        "service_id": svc["id"],
        "artifact_id": artifact.id,
        "workspace": client.config.get("workspace", WORKSPACE),
        "client_id": client.config.get("client_id", ""),
    }
