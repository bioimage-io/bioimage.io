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
        from js import console
        if not os.path.isdir(image_folder):
            console.log(f"Directory does not exist: {image_folder}")
            return []

        files = []
        for f in os.listdir(image_folder):
            file_path = os.path.join(image_folder, f)
            if os.path.isfile(file_path):
                # Case-insensitive check
                f_lower = f.lower()
                if any(f_lower.endswith(ext.lower()) for ext in supported_file_types):
                    files.append(f)

        console.log(f"Found {len(files)} matching files in {image_folder}")
        return sorted(files)
    except Exception as e:
        from js import console
        console.log(f"Error listing files: {e}")
        import traceback
        traceback.print_exc()
        return []


def read_image(file_path: str):
    """Read an image file and return as numpy array."""
    try:
        from tifffile import imread
        import numpy as np
        from js import console

        if not os.path.exists(file_path):
            raise FileNotFoundError(f"File not found: {file_path}")

        image = imread(file_path)

        # Transpose if needed (CHW to HWC)
        if len(image.shape) == 3 and image.shape[0] == 3:
            image = np.transpose(image, [1, 2, 0])

        console.log(f"Read image: {file_path}, shape: {image.shape}, dtype: {image.dtype}")
        return image
    except Exception as e:
        from js import console
        console.log(f"Error reading image {file_path}: {e}")
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
    """Save annotation features as a mask image.

    Args:
        annotations_folder: Path to save annotations
        image_name: Name of the image being annotated
        features: GeoJSON feature collection with annotations
        image_shape: Can be either [height, width] or [height, width, channels]
    """
    import numpy as np
    from js import console
    console.log("Saving annotation...")

    try:
        console.log("=== Saving annotation ===")
        console.log(f"Annotations folder: {annotations_folder}")
        console.log(f"Image name: {image_name}")
        console.log(f"Image shape (received): {image_shape}")
        console.log(f"Image shape length: {len(image_shape) if hasattr(image_shape, '__len__') else 'N/A'}")
        console.log(f"Features type: {type(features)}")

        # Normalize image_shape to 2D for mask creation
        # Plugin sends [width, height], we need [height, width] for mask
        if len(image_shape) == 2:
            # Plugin sends [width, height], swap to [height, width]
            mask_shape = (image_shape[1], image_shape[0])
            console.log(f"Using 2D shape: {mask_shape}")
        elif len(image_shape) == 3:
            # Already in [height, width, channels] format
            mask_shape = (image_shape[0], image_shape[1])
            console.log(f"Using 3D shape, extracting 2D: {mask_shape}")
        else:
            raise ValueError(f"Invalid image_shape: {image_shape}")

        # Try to use kaibu_utils first, fallback to custom implementation
        try:
            from kaibu_utils import features_to_mask
            mask = features_to_mask(features, mask_shape)
            console.log(f"Created mask using kaibu_utils")
        except ImportError:
            # Fallback: use numpy and skimage to create mask from polygons
            from skimage.draw import polygon

            mask = np.zeros(mask_shape, dtype=np.uint8)
            # Simple implementation: draw polygons from features
            feature_count = 0
            for idx, feature in enumerate(features.get('features', []), start=1):
                if feature['geometry']['type'] == 'Polygon':
                    coords = feature['geometry']['coordinates'][0]
                    if coords:
                        y_coords = [c[1] for c in coords]
                        x_coords = [c[0] for c in coords]
                        rr, cc = polygon(y_coords, x_coords, mask_shape)
                        mask[rr, cc] = idx
                        feature_count += 1
            console.log(f"Created mask using fallback method with {feature_count} features")

        console.log(f"Mask shape: {mask.shape}, dtype: {mask.dtype}, unique values: {len(np.unique(mask))}")

        from tifffile import imwrite

        # Ensure annotations folder exists
        os.makedirs(annotations_folder, exist_ok=True)
        console.log(f"Annotations folder exists: {os.path.exists(annotations_folder)}")

        # Count existing masks for this image
        existing_masks = [
            f for f in os.listdir(annotations_folder)
            if f.startswith(image_name) and f.endswith('.tif')
        ]
        n_image_masks = len(existing_masks)
        console.log(f"Found {n_image_masks} existing masks for this image")

        mask_name = f"{image_name}_mask_{n_image_masks + 1}.tif"
        mask_path = os.path.join(annotations_folder, mask_name)
        console.log(f"Saving to: {mask_path}")

        # Save mask with detailed error handling
        console.log(f"About to write mask to: {mask_path}")
        try:
            imwrite(mask_path, mask)
            console.log(f"imwrite completed without error")
        except Exception as write_error:
            console.log(f"ERROR during imwrite: {write_error}")
            import traceback
            traceback.print_exc()
            raise

        # Note: FileSystem sync is handled by the host JavaScript (kernel manager)
        # The sync will happen automatically via autoSyncFs and manual refresh in the UI

        # Verify file was created
        console.log(f"Checking if file exists at {mask_path}...")
        if os.path.exists(mask_path):
            file_size = os.path.getsize(mask_path)
            console.log(f"✓ Successfully saved annotation to {mask_path} ({file_size} bytes)")

            # List all files in annotations folder
            all_files = os.listdir(annotations_folder)
            console.log(f"Total files in {annotations_folder}: {len(all_files)}")
            console.log(f"Files: {all_files}")
        else:
            console.log(f"✗ ERROR: File was not created at {mask_path}")

            # Debug: Check what files do exist
            try:
                existing = os.listdir(annotations_folder)
                console.log(f"Files that DO exist in {annotations_folder}: {existing}")
            except Exception as list_error:
                console.log(f"Cannot list folder: {list_error}")

    except Exception as e:
        console.log(f"ERROR saving annotation: {e}")
        import traceback
        traceback.print_exc()
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
    from js import console as js_console
    os.makedirs(annotations_path, exist_ok=True)

    # List image files
    files = list_image_files(images_path, supported_file_types)
    js_console.log(f"Found {len(files)} image files")
    if files:
        js_console.log(f"Sample files: {files[:5]}")

    js_console.log(f"Connecting to server: {server_url}")

    # Connect to the Hypha server
    client = await connect_to_server({"server_url": server_url, "token": token})

    js_console.log(f"Registering service: {name}")

    # Use provided service ID or create one with timestamp
    if service_id is None:
        service_id = f"data-provider-{int(time.time() * 100)}"

    # Create async wrapper functions that capture the parameters
    async def get_random_image_wrapper():
        from js import console
        console.log(f"\n🔵 get_random_image called")
        result = await get_random_image(images_path, supported_file_types)
        console.log(f"🔵 get_random_image returned image: {result[1]}")
        return result

    async def save_annotation_wrapper(image_name, features, image_shape):
        from js import console
        console.log(f"\n{'='*60}")
        console.log(f"🟢 SAVE_ANNOTATION CALLED FROM PLUGIN")
        console.log(f"{'='*60}")
        console.log(f"   - image_name: {image_name}")
        console.log(f"   - image_name type: {type(image_name)}")
        console.log(f"   - image_shape: {image_shape}")
        console.log(f"   - image_shape type: {type(image_shape)}")
        console.log(f"   - features type: {type(features)}")
        if hasattr(features, 'keys'):
            console.log(f"   - features keys: {list(features.keys())}")
        console.log(f"{'='*60}\n")
        try:
            result = await save_annotation(annotations_path, image_name, features, image_shape)
            console.log(f"\n{'='*60}")
            console.log(f"🟢 SAVE_ANNOTATION COMPLETED SUCCESSFULLY")
            console.log(f"{'='*60}\n")
            return result
        except Exception as e:
            console.log(f"\n{'='*60}")
            console.log(f"❌ SAVE_ANNOTATION FAILED")
            console.log(f"{'='*60}")
            console.log(f"Error: {e}")
            import traceback
            traceback.print_exc()
            console.log(f"{'='*60}\n")
            raise

    # Log service info before registration
    js_console.log(f"\nService configuration:")
    js_console.log(f"  - name: {name}")
    js_console.log(f"  - description: {description}")
    js_console.log(f"  - id: {service_id}")
    js_console.log(f"  - type: annotation-data-provider")
    js_console.log(f"  - Functions: get_random_image, save_annotation")
    js_console.log(f"  - run_in_executor: False\n")

    # Register the service
    svc = await client.register_service(
        {
            "name": name,
            "description": description,
            "id": service_id,
            "type": "annotation-data-provider",
            "config": {
                "visibility": "public",
                "run_in_executor": False,  # Run in main async context to see logs
            },
            # Exposed functions (async):
            "get_random_image": get_random_image_wrapper,
            "save_annotation": save_annotation_wrapper,
        }
    )

    js_console.log(f"\n✓ Service registered!")
    js_console.log(f"  Service ID: {svc['id']}")
    js_console.log(f"  Available functions: {list(svc.get('service_schema', {}).keys())}")
    js_console.log(f"  Workspace: {svc.get('config', {}).get('workspace', 'N/A')}")

    js_console.log(f"Service registered successfully with ID: {svc['id']}")
    return svc
