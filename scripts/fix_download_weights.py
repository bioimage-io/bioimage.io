import asyncio
import logging
import os
import sys
from pathlib import Path

from dotenv import load_dotenv
from hypha_rpc import connect_to_server

load_dotenv()

logging.basicConfig(stream=sys.stdout)
logger = logging.getLogger("collection-scanner")
logger.setLevel(logging.INFO)

# Define log file path
LOG_FILE_PATH = Path("scan_weights.log")

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

def extract_weight_files(manifest):
    """Extract weight file paths from manifest, similar to Edit.tsx extractWeightFiles function."""
    if not manifest or not manifest.get('weights'):
        return []
    
    weight_files = []
    weights = manifest.get('weights', {})
    
    for weight_info in weights.values():
        if weight_info and weight_info.get('source'):
            # Handle paths that might start with ./ or just be filenames
            path = weight_info['source']
            if path.startswith('./'):
                path = path[2:]  # Remove './' prefix
            weight_files.append(path)
    
    return weight_files

async def scan_collection_weights():
    """Scan the migrated collection and print download_weights config for each artifact."""
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
        print("SCANNING ARTIFACT DOWNLOAD WEIGHTS")
        print("="*80)
        
        for i, artifact_summary in enumerate(artifacts_list, 1):
            try:
                # Read the full artifact details
                artifact = await artifact_manager.read(artifact_summary["id"])
                artifact_alias = artifact.get("alias", "N/A")
                artifact_type = artifact.get("type", "N/A")
                
                print(f"\n[{i}/{len(artifacts_list)}] Artifact: {artifact_alias}")
                print(f"  Type: {artifact_type}")
                print(f"  ID: {artifact['id']}")
                
                if artifact.get("type") == "model":
                    manifest = artifact.get("manifest", {})
                    
                    # Extract weight file paths from manifest
                    weight_file_paths = extract_weight_files(manifest)
                    if weight_file_paths:
                        print(f"  Weight Files: {weight_file_paths}")
                        
                        # Get current config or create empty one
                        current_config = artifact.get("config", {})
                        new_config = current_config.copy()
                        
                        # Create/update download_weights
                        if "download_weights" not in new_config:
                            new_config["download_weights"] = {}
                        
                        # Set weight files to 1.0 and add special create-zip-file key
                        new_config["download_weights"].update({k: 1.0 for k in weight_file_paths})
                        new_config["download_weights"]["create-zip-file"] = 1.0
                        
                        print(f"  Current Download Weights: {current_config.get('download_weights', 'None')}")
                        print(f"  New Download Weights: {new_config['download_weights']}")
                        
                        # Update the artifact config
                        try:
                            new_artifact =await artifact_manager.edit(
                                artifact_id=artifact["id"],
                                config=new_config
                            )
                            assert new_artifact.get("config", {}).get("download_weights", {}) == new_config["download_weights"], "Download weights not updated correctly"
                            
                            print(f"  ✅ Successfully updated download_weights config")
                        except Exception as e:
                            print(f"  ❌ Failed to update config: {e}")
                            logger.error(f"Failed to update config for {artifact['id']}: {e}")
                    else:
                        print("  Weight Files: None found in manifest")
                        # Still check existing download_weights
                        if "config" in artifact and "download_weights" in artifact["config"]:
                            print(f"  Current Download Weights: {artifact['config']['download_weights']}")
                else:
                    print(f"  Skipping non-model artifact (type: {artifact.get('type', 'unknown')})")
                
                # For non-model artifacts or when no weight files found, just show current config
                if artifact.get("type") != "model" or not extract_weight_files(artifact.get("manifest", {})):
                    if "config" in artifact:
                        config = artifact["config"]
                        if "download_weights" in config:
                            download_weights = config["download_weights"]
                            print(f"  Download Weights: {download_weights}")
                        else:
                            print("  Download Weights: Not found in config")
                    else:
                        print("  Config: Not found")
                    
            except Exception as e:
                logger.error(f"Failed to read artifact {artifact_summary['id']}: {e}")
                print(f"  ERROR: Failed to read artifact - {e}")
        
        print("\n" + "="*80)
        print("SCAN COMPLETED")
        print("="*80)
        
    except Exception as e:
        logger.error(f"Failed to scan collection: {e}")
        print(f"ERROR: Failed to scan collection - {e}")

if __name__ == "__main__":
    asyncio.run(scan_collection_weights()) 