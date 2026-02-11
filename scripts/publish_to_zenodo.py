import argparse
import asyncio
import logging
import os
import sys
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
CONCURRENT_TASKS = 8


async def publish_artifact_to_zenodo(
    artifact_manager,
    artifact_summary,
    semaphore,
    index,
    total_count,
    publish_to="sandbox_zenodo",
    artifact_filter=None,
    dry_run=False,
):
    """Publish a single artifact to Zenodo with concurrency control."""
    async with semaphore:
        try:
            # Read the full artifact details
            artifact = await artifact_manager.read(artifact_summary["id"])
            artifact_id = artifact["id"]
            artifact_alias = artifact.get("alias", "N/A")
            artifact_type = artifact.get("type", "N/A")
            manifest = artifact.get("manifest", {})

            # Apply filter if provided
            if (
                artifact_filter
                and artifact_filter.lower() not in artifact_alias.lower()
            ):
                logger.info(
                    f"Skipping artifact {artifact_alias}: doesn't match filter '{artifact_filter}'"
                )
                return {
                    "processed": False,
                    "published": False,
                    "alias": artifact_alias,
                    "reason": "filtered",
                }

            print(f"\n[{index}/{total_count}] Artifact: {artifact_alias}")
            print(f"  Type: {artifact_type}")
            print(f"  ID: {artifact_id}")

            # Check if artifact has required fields for publishing
            if not manifest.get("name"):
                logger.warning(
                    f"Skipping artifact {artifact_alias}: Missing required 'name' field"
                )
                print("  ❌ Skipped - Missing required 'name' field")
                return {
                    "processed": True,
                    "published": False,
                    "alias": artifact_alias,
                    "reason": "missing_name",
                }

            if not manifest.get("description"):
                logger.warning(
                    f"Skipping artifact {artifact_alias}: Missing required 'description' field"
                )
                print("  ❌ Skipped - Missing required 'description' field")
                return {
                    "processed": True,
                    "published": False,
                    "alias": artifact_alias,
                    "reason": "missing_description",
                }

            if dry_run:
                logger.info(
                    f"[DRY RUN] Would publish artifact {artifact_alias} to {publish_to}"
                )
                logger.info(f"[DRY RUN]   Name: {manifest.get('name')}")
                logger.info(
                    f"[DRY RUN]   Description: {manifest.get('description')[:100]}..."
                )
                logger.info(f"[DRY RUN]   Authors: {manifest.get('authors', [])}")
                logger.info(f"[DRY RUN]   Tags: {manifest.get('tags', [])}")
                print(f"  ✅ [DRY RUN] Would publish to {publish_to}")
                return {
                    "processed": True,
                    "published": True,
                    "alias": artifact_alias,
                    "reason": "dry_run",
                }

            logger.info(f"Publishing artifact {artifact_alias} to {publish_to}")

            # Call the publish method
            tags = list(manifest.get("tags", []))
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
                    "notes": f"Published automatically by the RI-SCALE Model Hub (https://modelhub.riscale.eu), id: {artifact.alias}, version: {artifact.get('versions', [{}])[0].get('version', 'N/A')}",
                },
            )

            logger.info(f"✅ Successfully published {artifact_alias} to {publish_to}")
            logger.info(f"   Zenodo record: {record}")
            print(f"  ✅ Successfully published to {publish_to}")
            return {
                "processed": True,
                "published": True,
                "alias": artifact_alias,
                "record": record,
            }

        except Exception as e:
            logger.error(
                f"Failed to publish {artifact_summary.get('alias', artifact_summary['id'])}: {e}"
            )
            print(f"  ❌ ERROR: Failed to publish - {e}")
            return {
                "processed": True,
                "published": False,
                "alias": artifact_summary.get("alias", artifact_summary["id"]),
                "error": str(e),
            }


async def publish_collection_to_zenodo(
    publish_to="sandbox_zenodo", artifact_filter=None, dry_run=False
):
    """Publish all artifacts in the collection to Zenodo using parallel processing."""
    server = await connect_to_server(
        {
            "server_url": SERVER_URL,
            "workspace": "bioimage-io",
            "token": os.environ.get("WORKSPACE_TOKEN"),
        }
    )
    artifact_manager = await server.get_service("public/artifact-manager")

    try:
        # Read the main collection
        collection = await artifact_manager.read("bioimage.io")
        logger.info(f"Found collection: {collection['alias']}")

        # List all artifacts in the collection
        artifacts_list = await artifact_manager.list(
            parent_id=collection["id"], limit=1000000
        )
        logger.info(f"Found {len(artifacts_list)} artifacts in the collection")

        print("\n" + "=" * 80)
        print(f"PUBLISHING ARTIFACTS TO {publish_to.upper()}")
        print(f"Parallel processing with {CONCURRENT_TASKS} concurrent tasks")
        print("=" * 80)

        # Create a semaphore to limit concurrent tasks
        semaphore = asyncio.Semaphore(CONCURRENT_TASKS)

        # Create tasks for parallel processing
        tasks = []
        for i, artifact_summary in enumerate(artifacts_list, 1):
            task = publish_artifact_to_zenodo(
                artifact_manager=artifact_manager,
                artifact_summary=artifact_summary,
                semaphore=semaphore,
                index=i,
                total_count=len(artifacts_list),
                publish_to=publish_to,
                artifact_filter=artifact_filter,
                dry_run=dry_run,
            )
            tasks.append(task)

        # Execute all tasks in parallel
        logger.info(f"Starting parallel execution of {len(tasks)} tasks...")
        results = await asyncio.gather(*tasks, return_exceptions=True)

        # Process results
        processed_count = 0
        published_count = 0
        filtered_count = 0
        error_count = 0

        for result in results:
            if isinstance(result, Exception):
                logger.error(f"Task failed with exception: {result}")
                error_count += 1
            elif isinstance(result, dict):
                if result.get("processed"):
                    processed_count += 1
                    if result.get("published"):
                        published_count += 1
                elif result.get("reason") == "filtered":
                    filtered_count += 1
                if result.get("error"):
                    error_count += 1

        print("\n" + "=" * 80)
        print("PUBLISHING COMPLETED")
        print(f"Total artifacts: {len(artifacts_list)}")
        print(f"Processed: {processed_count} artifacts")
        print(f"Published: {published_count} artifacts")
        print(f"Filtered: {filtered_count} artifacts")
        print(f"Errors: {error_count} artifacts")
        print(f"Target: {publish_to}")
        print(f"Concurrent tasks: {CONCURRENT_TASKS}")
        print("=" * 80)

    except Exception as e:
        logger.error(f"Failed to process collection: {e}")
        print(f"ERROR: Failed to process collection - {e}")


def main():
    parser = argparse.ArgumentParser(
        description="Publish RI-SCALE Model Hub artifacts to Zenodo"
    )
    parser.add_argument(
        "--target",
        choices=["sandbox_zenodo", "zenodo"],
        default="sandbox_zenodo",
        help="Zenodo target: sandbox_zenodo (default) or zenodo (production)",
    )
    parser.add_argument(
        "--filter",
        type=str,
        help="Filter artifacts by name (case-insensitive substring match)",
    )
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="Show what would be published without actually publishing",
    )

    args = parser.parse_args()

    if args.dry_run:
        logger.info("DRY RUN MODE: No artifacts will actually be published")

    logger.info(f"Publishing to: {args.target}")
    if args.filter:
        logger.info(f"Filter: {args.filter}")

    # Run the publishing process
    asyncio.run(
        publish_collection_to_zenodo(
            publish_to=args.target, artifact_filter=args.filter, dry_run=args.dry_run
        )
    )


if __name__ == "__main__":
    main()
