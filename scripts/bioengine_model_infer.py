import argparse
import asyncio
import json
import os
import time
from io import BytesIO
from typing import Dict, List, Optional

import httpx
import numpy as np
import yaml
from hypha_rpc import connect_to_server, login
from hypha_rpc.utils import ObjectProxy

SERVER_URL = "https://hypha.aicell.io"
WORKSPACE = "bioimage-io"
COLLECTION = "bioimage.io"


async def fetch_previous_results(
    artifact_manager: ObjectProxy,
) -> Dict[str, Dict[str, str | float]]:
    collection = await artifact_manager.read(f"{WORKSPACE}/{COLLECTION}")

    return collection["manifest"].get("bioengine_inference", {})


async def fetch_model_ids(artifact_manager: ObjectProxy) -> List[str]:
    models = await artifact_manager.list(f"{WORKSPACE}/{COLLECTION}", limit=1000)
    model_ids = [item["id"].split("/")[1] for item in models if item["type"] == "model"]
    model_ids = sorted(model_ids)
    return model_ids


async def get_latest_change(artifact_manager: ObjectProxy, model_id: str) -> float:
    files = await artifact_manager.list_files(f"{WORKSPACE}/{model_id}")
    latest_timestamp = 0
    for file in files:
        if file.get("last_modified", 0) > latest_timestamp:
            latest_timestamp = file["last_modified"]

    return latest_timestamp


async def fetch_sample_image(artifact_manager: ObjectProxy, model_id: str) -> np.array:
    rdf_data = await artifact_manager.read_file(
        f"{WORKSPACE}/{model_id}", file_path="rdf.yaml", format="text"
    )
    rdf = yaml.safe_load(rdf_data["content"])

    if "test_tensor" in rdf["inputs"][0]:
        sample_source = rdf["inputs"][0]["test_tensor"]["source"]
    elif "test_inputs" in rdf:
        sample_source = rdf["test_inputs"][0]
    else:
        raise RuntimeError(
            "Unsupported RDF format: no test_tensor or test_inputs found"
        )

    sample_url = f"{SERVER_URL}/{WORKSPACE}/artifacts/{model_id}/files/{sample_source}"

    async with httpx.AsyncClient() as client:
        response = await client.get(sample_url)
        response.raise_for_status()

    image = np.load(BytesIO(response.content))
    return image


async def update_collection(
    artifact_manager: ObjectProxy, updated_results: Dict[str, Dict[str, str | float]]
) -> None:
    collection_id = f"{WORKSPACE}/{COLLECTION}"
    collection = await artifact_manager.read(collection_id)
    collection_manifest = collection["manifest"]
    collection_manifest["bioengine_inference"] = updated_results
    await artifact_manager.edit(artifact_id=collection_id, manifest=collection_manifest)


async def check_bmz_model_inference(
    model_ids: Optional[List[str]] = None,
    dry_run: bool = False,
) -> None:
    """Test BioImage.IO model and generate test report.

    Args:
        model_id: The ID of the model to test.
        result_dir: Directory to store JSON test results.

    Raises:
        RuntimeError: If fetching model IDs fails.
    """
    start_time = time.time()

    token = os.environ.get("HYPHA_TOKEN") or await login({"server_url": SERVER_URL})
    server = await connect_to_server(
        {"server_url": SERVER_URL, "token": token, "method_timeout": 300}
    )

    runner = await server.get_service(
        f"{WORKSPACE}/model-runner", {"mode": "select:min:get_load"}
    )
    artifact_manager = await server.get_service("public/artifact-manager")

    # Fetch previous test results
    previous_results = await fetch_previous_results(artifact_manager)

    # Fetch all model IDs if not provided
    if model_ids is None:
        model_ids = await fetch_model_ids(artifact_manager)

    # Iterate over models and test inference
    results = {}
    for model_id in model_ids:
        model_start_time = time.time()

        try:
            print(f"\nMODEL: {model_id}\n{'-' * (7 + len(model_id))}")

            last_test_at = previous_results.get(model_id, {}).get("tested_at", 0)
            last_test_status = previous_results.get(model_id, {}).get(
                "status", "never tested"
            )
            latest_change = await get_latest_change(artifact_manager, model_id)
            if latest_change <= last_test_at and last_test_status == "passed":
                print(
                    f"-> Model '{model_id}' has not changed since last test, skipping inference"
                )
                continue

            image = await fetch_sample_image(artifact_manager, model_id)

            model_start_time = time.time()
            await asyncio.wait_for(
                runner.infer(model_id=model_id, inputs=image),
                timeout=120,  # 2 minutes timeout
            )
            model_execution_time = time.time() - model_start_time
            print(
                f"-> Model '{model_id}' inference completed in {model_execution_time:.2f} seconds"
            )
            status = "passed"
            message = ""

        except asyncio.TimeoutError:
            print(f"-> Model '{model_id}' inference timed out after 2 minutes")
            status = "timeout"
            message = "Test timed out after 2 minutes"

        except Exception as e:
            print(f"-> Model '{model_id}' inference failed with error: {str(e)}")
            status = "failed"
            message = str(e)

        results[model_id] = {
            "status": status,
            "message": message,
            "tested_at": model_start_time,
        }

    print("\n============ All Models Tested ============\n")
    print(f"Total execution time: {time.time() - start_time:.2f} seconds\n")
    print(json.dumps(results, indent=2))

    # Update artifact with test results
    if not dry_run:
        print("\nUpdating collection with test results...")
        updated_results = {**previous_results, **results}
        await update_collection(artifact_manager, updated_results)
    else:
        print("\nDry run enabled, not updating collection with test results")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(
        description="Test BioImage.IO models and generate test reports"
    )
    parser.add_argument(
        "--model-ids",
        nargs="+",
        help="Specific model IDs to test (default: test all models)",
    )
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="Run tests but don't update any artifacts",
    )

    args = parser.parse_args()

    asyncio.run(
        check_bmz_model_inference(
            model_ids=args.model_ids,
            dry_run=args.dry_run,
        )
    )
