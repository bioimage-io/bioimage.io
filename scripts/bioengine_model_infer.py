import argparse
import asyncio
import json
import os
import time
from io import BytesIO
from pathlib import Path
from typing import Dict, List, Optional

import httpx
import numpy as np
import yaml
from hypha_rpc import connect_to_server, login
from hypha_rpc.utils import ObjectProxy

SERVER_URL = "https://hypha.aicell.io"
WORKSPACE = "bioimage-io"
COLLECTION = "bioimage.io"
DEFAULT_INFERENCE_SUMMARY_PATH = "../bioimageio_test_reports/inference_summary.json"


def save_inference_summary(summary_file: str, summary: Dict[str, int | float]) -> None:
    summary_path = Path(summary_file)
    summary_path.parent.mkdir(parents=True, exist_ok=True)
    summary_path.write_text(json.dumps(summary, indent=2), encoding="utf-8")


def print_inference_summary_for_ci(summary_file: str) -> None:
    summary_path = Path(summary_file)
    if not summary_path.exists():
        print("TOTAL_MODELS=0")
        print("PASSED=0")
        print("FAILED=0")
        print("TIMEOUT=0")
        print("PASSED_RATE=0.00")
        print("FAILED_RATE=0.00")
        print("TIMEOUT_RATE=0.00")
        print("RUNNER_VERSION=")
        return

    summary = json.loads(summary_path.read_text(encoding="utf-8"))

    total_models = int(summary.get("total_models", 0))
    passed = int(summary.get("passed", 0))
    failed = int(summary.get("failed", 0))
    timeout = int(summary.get("timeout", 0))
    runner_version = summary.get("runner_version") or ""

    def rate(value: int) -> str:
        if total_models == 0:
            return "0.00"
        return f"{(value / total_models) * 100:.2f}"

    print(f"TOTAL_MODELS={total_models}")
    print(f"PASSED={passed}")
    print(f"FAILED={failed}")
    print(f"TIMEOUT={timeout}")
    print(f"PASSED_RATE={rate(passed)}")
    print(f"FAILED_RATE={rate(failed)}")
    print(f"TIMEOUT_RATE={rate(timeout)}")
    print(f"RUNNER_VERSION='{runner_version.replace(chr(39), '')}'")


async def fetch_previous_results(
    artifact_manager: ObjectProxy,
) -> Dict[str, Dict[str, str | float]]:
    collection = await artifact_manager.read(f"{WORKSPACE}/{COLLECTION}")

    return collection["manifest"].get("bioengine_inference", {})


async def fetch_runner_version(runner: ObjectProxy) -> Optional[str]:
    """Ask the deployed model-runner which BioEngine artifact version it was built from.

    Returns the version string when the runner exposes ``get_version()`` and the
    response includes a non-empty ``version`` field. Returns ``None`` when the
    method is missing, raises, or returns no version. A ``None`` result disables
    runner-version cache invalidation for this run so the workflow still does
    useful work during the rollout window before the runner exposes the field.
    """
    try:
        info = await runner.get_version()
    except Exception as exc:
        print(
            f"Note: runner.get_version() unavailable ({exc}); "
            "runner-version cache invalidation disabled for this run"
        )
        return None

    if isinstance(info, dict):
        version = info.get("version")
    else:
        version = info

    if not version:
        print(
            "Note: runner reported no version; "
            "runner-version cache invalidation disabled for this run"
        )
        return None

    return str(version)


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
    summary_file: str = DEFAULT_INFERENCE_SUMMARY_PATH,
    skip_cache: bool = False,
) -> None:
    """Test BioImage.IO model and generate test report.

    Args:
        model_id: The ID of the model to test.
        result_dir: Directory to store JSON test results.
        skip_cache: When True, re-run inference even for models that previously
            passed and haven't changed since (bypasses the in-script result
            cache), and ask the model-runner to bypass its own cache too.

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

    current_runner_version = await fetch_runner_version(runner)
    if current_runner_version:
        print(f"Deployed model-runner version: {current_runner_version}")
    else:
        print("Deployed model-runner version: unknown")

    # Fetch previous test results
    previous_results = await fetch_previous_results(artifact_manager)

    # Fetch all model IDs if not provided
    if model_ids is None:
        model_ids = await fetch_model_ids(artifact_manager)

    # Iterate over models and test inference
    results = {}
    skipped_models = 0
    timeout_models = 0
    runner_version_invalidations = 0
    for model_id in model_ids:
        model_start_time = time.time()

        try:
            print(f"\nMODEL: {model_id}\n{'-' * (7 + len(model_id))}")

            previous_entry = previous_results.get(model_id, {})
            last_test_at = previous_entry.get("tested_at", 0)
            last_test_status = previous_entry.get("status", "never tested")
            stored_runner_version = previous_entry.get("runner_version")
            # Only treat the runner version as a cache-invalidation signal when we
            # actually know the current version. When the runner does not expose
            # the field yet, leave older entries alone instead of forcing a
            # workflow-wide re-run.
            runner_version_changed = (
                current_runner_version is not None
                and stored_runner_version != current_runner_version
            )
            latest_change = await get_latest_change(artifact_manager, model_id)
            if (
                not skip_cache
                and not runner_version_changed
                and latest_change <= last_test_at
                and last_test_status == "passed"
            ):
                print(
                    f"-> Model '{model_id}' has not changed since last test, skipping inference"
                )
                skipped_models += 1
                continue

            if runner_version_changed:
                print(
                    f"-> Model '{model_id}' was last tested against runner "
                    f"'{stored_runner_version or 'unknown'}', current is "
                    f"'{current_runner_version}', re-running inference"
                )
                runner_version_invalidations += 1

            image = await fetch_sample_image(artifact_manager, model_id)

            model_start_time = time.time()
            await asyncio.wait_for(
                runner.infer(model_id=model_id, inputs=image, skip_cache=skip_cache),
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
            timeout_models += 1

        except Exception as e:
            print(f"-> Model '{model_id}' inference failed with error: {str(e)}")
            status = "failed"
            message = str(e)

        results[model_id] = {
            "status": status,
            "message": message[:20] if message else None,
            "tested_at": model_start_time,
            "runner_version": current_runner_version,
        }

    execution_time = time.time() - start_time
    print("\n============ All Models Tested ============\n")
    print(f"Total execution time: {execution_time:.2f} seconds")
    if current_runner_version:
        print(
            f"Runner version stamped on new results: {current_runner_version} "
            f"(invalidated {runner_version_invalidations} stale entry/entries)"
        )
    else:
        print("Runner version unknown; results stamped with null runner_version")
    print(json.dumps(results, indent=2))

    summary = {
        "total_models": len(model_ids),
        "skipped": skipped_models,
        "passed": sum(1 for result in results.values() if result["status"] == "passed")
        + skipped_models,
        "failed": sum(1 for result in results.values() if result["status"] == "failed")
        + timeout_models,
        "timeout": timeout_models,
        "execution_time_seconds": round(execution_time, 2),
        "runner_version": current_runner_version,
        "runner_version_invalidations": runner_version_invalidations,
    }
    save_inference_summary(summary_file, summary)

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
    parser.add_argument(
        "--summary-file",
        default=DEFAULT_INFERENCE_SUMMARY_PATH,
        help="Path to save/read inference summary for CI",
    )
    parser.add_argument(
        "--analyze-results",
        action="store_true",
        help="Print shell variables derived from inference summary report",
    )
    parser.add_argument(
        "--skip-cache",
        action="store_true",
        help="Skip cache during inference checks "
        "(re-run inference even for previously-passed unchanged models, "
        "and ask the model-runner to bypass its own cache)",
    )

    args = parser.parse_args()

    if args.analyze_results:
        print_inference_summary_for_ci(args.summary_file)
        raise SystemExit(0)

    asyncio.run(
        check_bmz_model_inference(
            model_ids=args.model_ids,
            dry_run=args.dry_run,
            summary_file=args.summary_file,
            skip_cache=args.skip_cache,
        )
    )
