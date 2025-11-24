"""
BioImage.IO Colab - Data Providing Service
This service provides image data and saves annotations for collaborative image annotation.
Uses Pyodide's virtual filesystem.
"""

import os
import json
import time
from typing import Tuple
from functools import partial
import asyncio

# Import libraries (will be installed in pyodide)
try:
    import numpy as np
    from hypha_rpc import connect_to_server
    # Note: tifffile and kaibu_utils will be installed on demand
except ImportError:
    print("Required libraries not yet installed. They will be loaded when needed.")


def list_image_files(image_folder: str, supported_file_types: Tuple[str]):
    """List all image files in the folder that match supported types."""
    try:
        if not os.path.isdir(image_folder):
            print(f"Directory does not exist: {image_folder}")
            return []

        files = []
        for f in os.listdir(image_folder):
            file_path = os.path.join(image_folder, f)
            if os.path.isfile(file_path):
                # Case-insensitive check
                f_lower = f.lower()
                if any(f_lower.endswith(ext.lower()) for ext in supported_file_types):
                    files.append(f)

        print(f"Found {len(files)} matching files in {image_folder}")
        return sorted(files)
    except Exception as e:
        print(f"Error listing files: {e}")
        import traceback
        traceback.print_exc()
        return []


def read_image(file_path: str):
    """Read an image file and return as numpy array."""
    try:
        from tifffile import imread
        import numpy as np

        if not os.path.exists(file_path):
            raise FileNotFoundError(f"File not found: {file_path}")

        image = imread(file_path)

        # Transpose if needed (CHW to HWC)
        if len(image.shape) == 3 and image.shape[0] == 3:
            image = np.transpose(image, [1, 2, 0])

        print(f"Read image: {file_path}, shape: {image.shape}, dtype: {image.dtype}")
        return image
    except Exception as e:
        print(f"Error reading image {file_path}: {e}")
        raise


async def get_random_image(image_folder: str, supported_file_types: Tuple[str]):
    """Get a random image from the folder."""
    import numpy as np

    # List files
    filenames = list_image_files(image_folder, supported_file_types)

    if not filenames:
        raise ValueError(f"No images found with supported types in {image_folder}")

    r = np.random.randint(0, len(filenames))
    file_name = filenames[r]
    file_path = os.path.join(image_folder, file_name)

    # Read image
    image = read_image(file_path)

    return (image, file_name.split(".")[0])


async def save_annotation(
    annotations_folder: str, image_name: str, features: list, image_shape: tuple
):
    """Save annotation features as a mask image."""
    try:
        # Try to use kaibu_utils first, fallback to custom implementation
        try:
            from kaibu_utils import features_to_mask
            mask = features_to_mask(features, image_shape[:2])
        except ImportError:
            # Fallback: use numpy and skimage to create mask from polygons
            import numpy as np
            from skimage.draw import polygon

            mask = np.zeros(image_shape[:2], dtype=np.uint8)
            # Simple implementation: draw polygons from features
            for idx, feature in enumerate(features.get('features', []), start=1):
                if feature['geometry']['type'] == 'Polygon':
                    coords = feature['geometry']['coordinates'][0]
                    if coords:
                        y_coords = [c[1] for c in coords]
                        x_coords = [c[0] for c in coords]
                        rr, cc = polygon(y_coords, x_coords, image_shape[:2])
                        mask[rr, cc] = idx

        from tifffile import imwrite

        # Ensure annotations folder exists
        os.makedirs(annotations_folder, exist_ok=True)

        # Count existing masks for this image
        existing_masks = [
            f for f in os.listdir(annotations_folder)
            if f.startswith(image_name) and f.endswith('.tif')
        ]
        n_image_masks = len(existing_masks)
        mask_name = f"{image_name}_mask_{n_image_masks + 1}.tif"
        mask_path = os.path.join(annotations_folder, mask_name)

        # Save mask
        imwrite(mask_path, mask)

        print(f"Saved annotation to {mask_path}")
    except Exception as e:
        print(f"Error saving annotation: {e}")
        raise


async def register_service(
    server_url: str,
    token: str,
    supported_file_types_json: str,
    name: str,
    description: str,
    service_id: str = None,
    images_path: str = "/mnt",
    annotations_path: str = "/mnt/annotations",
):
    """Register the data providing service with Hypha."""
    # Decode the JSON string to a Python tuple
    supported_file_types = tuple(json.loads(supported_file_types_json))
    print(f"Service paths: images={images_path}, annotations={annotations_path}")
    print(f"Supported file types: {supported_file_types}")

    # Verify directories exist
    if not os.path.isdir(images_path):
        raise ValueError(f"Images directory does not exist: {images_path}")

    # Create annotations directory if needed
    os.makedirs(annotations_path, exist_ok=True)

    # Test listing files
    files = list_image_files(images_path, supported_file_types)
    print(f"Found {len(files)} image files")
    if files:
        print(f"Sample files: {files[:5]}")

    print(f"Connecting to server: {server_url}")

    # Connect to the Hypha server
    client = await connect_to_server({"server_url": server_url, "token": token})

    print(f"Registering service: {name}")

    # Use provided service ID or create one with timestamp
    if service_id is None:
        service_id = f"data-provider-{int(time.time() * 100)}"

    # Create async wrapper functions that capture the parameters
    async def get_random_image_wrapper():
        return await get_random_image(images_path, supported_file_types)

    async def save_annotation_wrapper(image_name, features, image_shape):
        return await save_annotation(annotations_path, image_name, features, image_shape)

    # Register the service
    svc = await client.register_service(
        {
            "name": name,
            "description": description,
            "id": service_id,
            "type": "annotation-data-provider",
            "config": {
                "visibility": "public",
                "run_in_executor": True,  # Standard Python functions can use executor
            },
            # Exposed functions (async):
            "get_random_image": get_random_image_wrapper,
            "save_annotation": save_annotation_wrapper,
        }
    )

    print(f"Service registered successfully with ID: {svc['id']}")
    return svc
