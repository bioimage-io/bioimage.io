import asyncio
import logging
import os
import sys
import argparse
from pathlib import Path

from dotenv import load_dotenv
from hypha_rpc import connect_to_server

load_dotenv()

logging.basicConfig(stream=sys.stdout)
logger = logging.getLogger("zenodo-publisher")
logger.setLevel(logging.INFO)

# Define log file path
LOG_FILE_PATH = Path("publish_zenodo.log")

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

async def publish_artifact_to_zenodo(artifact_manager, artifact, publish_to="sandbox_zenodo", dry_run=False):
    """Publish a single artifact to Zenodo."""
    artifact_id = artifact["id"]
    artifact_alias = artifact.get("alias", "N/A")
    manifest = artifact.get("manifest", {})
    
    # Check if artifact has required fields for publishing
    if not manifest.get("name"):
        logger.warning(f"Skipping artifact {artifact_alias}: Missing required 'name' field")
        return False
    
    if not manifest.get("description"):
        logger.warning(f"Skipping artifact {artifact_alias}: Missing required 'description' field")
        return False
    
    if dry_run:
        logger.info(f"[DRY RUN] Would publish artifact {artifact_alias} to {publish_to}")
        logger.info(f"[DRY RUN]   Name: {manifest.get('name')}")
        logger.info(f"[DRY RUN]   Description: {manifest.get('description')[:100]}...")
        logger.info(f"[DRY RUN]   Authors: {manifest.get('authors', [])}")
        logger.info(f"[DRY RUN]   Tags: {manifest.get('tags', [])}")
        return True
    
    logger.info(f"Publishing artifact {artifact_alias} to {publish_to}")
    
    try:
        # Call the publish method
        # Metadata example:
        # {"title": "2D UNETR for mitochondria painting from bright-field to fluorescence", "doi": "10.5072/zenodo.280539", "publication_date": "2025-07-02", "description": "Cell painting (mitochondria): image to image reconstruction from bright-field to fluorescence.", "access_right": "open", "creators": [{"name": "Daniel Franco-Barranco", "affiliation": null}], "keywords": ["bright-field", "fluorescence", "mitochondria", "2d", "pytorch", "biapy", "image-to-image", "unetr"], "license": "cc-by-4.0", "imprint_publisher": "Zenodo", "notes": "Published automatically from Hypha (https://hypha.aicell.io).", "upload_type": "other", "prereserve_doi": {"doi": "10.5281/zenodo.280539", "recid": 280539}}
        tags = artifact.manifest["tags"]
        tags.append("bioimage.io")
        tags.append(artifact.alias)
        tags.append(artifact.type)
        # make sure tags are unique
        tags = list(set(tags))
        record = await artifact_manager.publish(
            artifact_id=artifact_id,
            to=publish_to,
            metadata={
                "keywords": tags,
                "notes": f"Published automatically by the BioImage Model Zoo (https://bioimage.io), id: {artifact.alias}, version: {artifact.get('versions', [{}])[0].get('version', 'N/A')}"
            }
        )
        
        logger.info(f"✅ Successfully published {artifact_alias} to {publish_to}")
        logger.info(f"   Zenodo record: {record}")
        return True
        
    except Exception as e:
        logger.error(f"Failed to publish {artifact_alias} to {publish_to}: {e}")
        return False

async def publish_collection_to_zenodo(publish_to="sandbox_zenodo", artifact_filter=None, dry_run=False):
    """Publish all artifacts in the collection to Zenodo."""
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
        print(f"PUBLISHING ARTIFACTS TO {publish_to.upper()}")
        print("="*80)
        
        processed_count = 0
        published_count = 0
        
        for i, artifact_summary in enumerate(artifacts_list, 1):
            try:
                # Read the full artifact details
                artifact = await artifact_manager.read(artifact_summary["id"])
                artifact_alias = artifact.get("alias", "N/A")
                artifact_type = artifact.get("type", "N/A")
                
                # Apply filter if provided
                if artifact_filter and artifact_filter.lower() not in artifact_alias.lower():
                    logger.info(f"Skipping artifact {artifact_alias}: doesn't match filter '{artifact_filter}'")
                    continue
                
                print(f"\n[{i}/{len(artifacts_list)}] Artifact: {artifact_alias}")
                print(f"  Type: {artifact_type}")
                print(f"  ID: {artifact['id']}")
                
                # Publish this artifact
                was_published = await publish_artifact_to_zenodo(artifact_manager, artifact, publish_to, dry_run)
                
                processed_count += 1
                if was_published:
                    published_count += 1
                    print(f"  ✅ Successfully published to {publish_to}")
                else:
                    print(f"  ❌ Failed to publish or skipped")
                    
            except Exception as e:
                logger.error(f"Failed to process artifact {artifact_summary['id']}: {e}")
                print(f"  ❌ ERROR: Failed to process artifact - {e}")
        
        print("\n" + "="*80)
        print("PUBLISHING COMPLETED")
        print(f"Processed: {processed_count} artifacts")
        print(f"Published: {published_count} artifacts")
        print(f"Target: {publish_to}")
        print("="*80)
        
    except Exception as e:
        logger.error(f"Failed to process collection: {e}")
        print(f"ERROR: Failed to process collection - {e}")

def main():
    parser = argparse.ArgumentParser(description="Publish BioImage Model Zoo artifacts to Zenodo")
    parser.add_argument(
        "--target", 
        choices=["sandbox_zenodo", "zenodo"], 
        default="sandbox_zenodo",
        help="Zenodo target: sandbox_zenodo (default) or zenodo (production)"
    )
    parser.add_argument(
        "--filter",
        type=str,
        help="Filter artifacts by name (case-insensitive substring match)"
    )
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="Show what would be published without actually publishing"
    )
    
    args = parser.parse_args()
    
    if args.dry_run:
        logger.info("DRY RUN MODE: No artifacts will actually be published")
    
    logger.info(f"Publishing to: {args.target}")
    if args.filter:
        logger.info(f"Filter: {args.filter}")
    
    # Run the publishing process
    asyncio.run(publish_collection_to_zenodo(
        publish_to=args.target,
        artifact_filter=args.filter,
        dry_run=args.dry_run
    ))

if __name__ == "__main__":
    main() 