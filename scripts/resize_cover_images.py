import asyncio
import logging
import os
import sys
import tempfile
from pathlib import Path
from io import BytesIO
import httpx
from PIL import Image

from dotenv import load_dotenv
from hypha_rpc import connect_to_server

load_dotenv()

logging.basicConfig(stream=sys.stdout)
logger = logging.getLogger("cover-image-resizer")
logger.setLevel(logging.INFO)

# Define log file path
LOG_FILE_PATH = Path("resize_covers.log")

# Formatter for log messages
formatter = logging.Formatter("%(asctime)s - %(name)s - %(levelname)s - %(message)s")

# Console handler
console_handler = logging.StreamHandler(sys.stdout)
console_handler.setLevel(logging.INFO)
console_handler.setFormatter(formatter)

# File handler
file_handler = logging.FileHandler(LOG_FILE_PATH)
file_handler.setLevel(logging.INFO)
file_handler.setFormatter(formatter)

# Add handlers to the logger
logger.addHandler(console_handler)
logger.addHandler(file_handler)

SERVER_URL = "https://hypha.aicell.io"
MAX_WIDTH = 400
MAX_HEIGHT = 200

def resize_image_maintain_aspect_ratio(image_data, max_width=MAX_WIDTH, max_height=MAX_HEIGHT):
    """
    Resize image while maintaining aspect ratio.
    Ensures width < max_width and height < max_height.
    """
    try:
        # Open image from bytes
        image = Image.open(BytesIO(image_data))
        
        # Convert RGBA to RGB if necessary (for JPEG output)
        if image.mode in ('RGBA', 'LA'):
            background = Image.new('RGB', image.size, (255, 255, 255))
            background.paste(image, mask=image.split()[-1] if image.mode == 'RGBA' else None)
            image = background
        elif image.mode not in ('RGB', 'L'):
            image = image.convert('RGB')
        
        # Get current dimensions
        width, height = image.size
        
        # Calculate scaling factor to fit within max dimensions
        width_ratio = max_width / width
        height_ratio = max_height / height
        scale_factor = min(width_ratio, height_ratio, 1.0)  # Don't upscale
        
        # Calculate new dimensions
        new_width = int(width * scale_factor)
        new_height = int(height * scale_factor)
        
        # Resize image
        resized_image = image.resize((new_width, new_height), Image.Resampling.LANCZOS)
        
        # Convert to JPEG bytes
        output_buffer = BytesIO()
        resized_image.save(output_buffer, format='JPEG', quality=85, optimize=True)
        output_buffer.seek(0)
        
        logger.info(f"Resized image from {width}x{height} to {new_width}x{new_height}")
        return output_buffer.getvalue()
        
    except Exception as e:
        logger.error(f"Failed to resize image: {e}")
        raise

async def download_image(artifact_manager, artifact_id, file_path):
    """Download an image file from the artifact."""
    try:
        # Get download URL for the file
        download_url = await artifact_manager.get_file(artifact_id, file_path)
        
        if not download_url:
            raise ValueError(f"No download URL found for {file_path}")
        
        # Download the file
        async with httpx.AsyncClient(timeout=30) as client:
            response = await client.get(download_url)
            response.raise_for_status()
        
        logger.info(f"Downloaded {file_path} ({len(response.content)} bytes)")
        return response.content
        
    except Exception as e:
        logger.error(f"Failed to download {file_path}: {e}")
        raise

async def upload_thumbnail(artifact_manager, artifact_id, original_filename, thumbnail_data):
    """Upload the thumbnail image to the artifact."""
    try:
        # Generate thumbnail filename
        name_parts = original_filename.rsplit('.', 1)
        if len(name_parts) == 2:
            thumbnail_filename = f"{name_parts[0]}.thumbnail.jpg"
        else:
            thumbnail_filename = f"{original_filename}.thumbnail.jpg"
        
        # Create temporary file for upload
        with tempfile.NamedTemporaryFile(suffix='.jpg', delete=False) as temp_file:
            temp_file.write(thumbnail_data)
            temp_file_path = temp_file.name
        
        try:

            # Upload the thumbnail
            upload_url = await artifact_manager.put_file(
                artifact_id, 
                thumbnail_filename, 
            )
            async with httpx.AsyncClient(timeout=30) as client:
                response = await client.put(upload_url, content=thumbnail_data)
                response.raise_for_status()
            logger.info(f"Uploaded thumbnail: {thumbnail_filename}")
            return thumbnail_filename
            
        finally:
            # Clean up temporary file
            os.unlink(temp_file_path)
            
    except Exception as e:
        logger.error(f"Failed to upload thumbnail for {original_filename}: {e}")
        raise

async def process_artifact_covers(artifact_manager, artifact):
    """Process cover images for a single artifact."""
    artifact_id = artifact["id"]
    artifact_alias = artifact.get("alias", "N/A")
    manifest = artifact.get("manifest", {})
    covers = manifest.get("covers", [])
    
    if not covers:
        logger.info(f"No covers found for artifact {artifact_alias}")
        return False
    
    logger.info(f"Processing {len(covers)} cover(s) for artifact {artifact_alias}")
    
    updated_covers = []
    changes_made = False
    
    big_covers = [cover for cover in covers if ".thumbnail." not in cover]
    
    if len(big_covers) < 1:
        logger.info(f"No big covers found for artifact {artifact_alias}")
        return False
    
    await artifact_manager.edit(artifact_id=artifact_id, stage=True)
    
    try:
        for cover_file in big_covers:
            try:
                # Check if image file (basic extension check)
                if not any(cover_file.lower().endswith(ext) for ext in ['.jpg', '.jpeg', '.png', '.gif', '.bmp', '.tiff', '.webp']):
                    logger.warning(f"Skipping non-image file: {cover_file}")
                    updated_covers.append(cover_file)
                    continue
                
                logger.info(f"Processing cover image: {cover_file}")
                
                # Download the original image
                image_data = await download_image(artifact_manager, artifact_id, cover_file)
                
                # Resize the image
                thumbnail_data = resize_image_maintain_aspect_ratio(image_data)
                
                # Upload the thumbnail
                thumbnail_filename = await upload_thumbnail(artifact_manager, artifact_id, cover_file, thumbnail_data)
                
                # Use thumbnail in updated covers
                updated_covers.append(thumbnail_filename)
                changes_made = True
                
                logger.info(f"✅ Successfully processed {cover_file} -> {thumbnail_filename}")
                
            except Exception as e:
                logger.error(f"Failed to process cover {cover_file}: {e}")
                # Keep original file in covers if processing failed
                updated_covers.append(cover_file)
    except Exception as e:
        logger.error(f"Failed to process artifact {artifact_alias}: {e}")
        raise Exception(f"Failed to process artifact {artifact_alias}: {e}")
    finally:
        await artifact_manager.commit(artifact_id=artifact_id)
        
    # Update manifest if changes were made
    if changes_made:
        try:
            # Update the manifest with thumbnail covers
            updated_manifest = manifest.copy()
            updated_manifest["covers"] = updated_covers
            
            # Update the artifact
            await artifact_manager.edit(
                artifact_id=artifact_id,
                manifest=updated_manifest
            )
            
            logger.info(f"✅ Updated manifest covers for {artifact_alias}")
            return True
            
        except Exception as e:
            logger.error(f"Failed to update manifest for {artifact_alias}: {e}")
            return False
    
    return False

async def resize_collection_covers():
    """Process cover images for all artifacts in the collection."""
    server = await connect_to_server({
        "server_url": SERVER_URL, 
        "workspace": "bioimage-io", 
        "token": os.environ.get("WORKSPACE_TOKEN")
    })
    artifact_manager = await server.get_service("public/artifact-manager")

    try:
        # Read the main collection
        collection = await artifact_manager.read("bioimage.io")
        logger.info(f"Found collection: {collection['alias']}")
        
        # List all artifacts in the collection
        artifacts_list = await artifact_manager.list(parent_id=collection["id"], limit=1000000)
        logger.info(f"Found {len(artifacts_list)} artifacts in the collection")
        
        print("\n" + "="*80)
        print("PROCESSING ARTIFACT COVER IMAGES")
        print("="*80)
        
        processed_count = 0
        updated_count = 0
        
        for i, artifact_summary in enumerate(artifacts_list, 1):
            try:
                # Read the full artifact details
                artifact = await artifact_manager.read(artifact_summary["id"])
                artifact_alias = artifact.get("alias", "N/A")
                artifact_type = artifact.get("type", "N/A")
                
                print(f"\n[{i}/{len(artifacts_list)}] Artifact: {artifact_alias}")
                print(f"  Type: {artifact_type}")
                print(f"  ID: {artifact['id']}")
                
                # Process covers for this artifact
                was_updated = await process_artifact_covers(artifact_manager, artifact)
                
                processed_count += 1
                if was_updated:
                    updated_count += 1
                    print(f"  ✅ Cover images processed and updated")
                else:
                    print(f"  ℹ️  No cover images to process or no changes made")
                    
            except Exception as e:
                logger.error(f"Failed to process artifact {artifact_summary['id']}: {e}")
                print(f"  ❌ ERROR: Failed to process artifact - {e}")
        
        print("\n" + "="*80)
        print("PROCESSING COMPLETED")
        print(f"Processed: {processed_count}/{len(artifacts_list)} artifacts")
        print(f"Updated: {updated_count} artifacts")
        print("="*80)
        
    except Exception as e:
        logger.error(f"Failed to process collection: {e}")
        print(f"ERROR: Failed to process collection - {e}")

if __name__ == "__main__":
    asyncio.run(resize_collection_covers()) 