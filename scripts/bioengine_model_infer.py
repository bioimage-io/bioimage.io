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

# Inference results are published to a single dedicated artifact under the
# ``bioimage-io/test-reports`` collection (sibling to the per-model
# ``test-report-<alias>`` artifacts the model-runner writes for full tests).
# A single script writes this artifact, so all model results live in one file
# and no per-model artifact / concurrent-write coordination is needed.
TEST_REPORTS_COLLECTION = f"{WORKSPACE}/test-reports"
INFERENCE_REPORT_ARTIFACT = f"{WORKSPACE}/inference-report"
INFERENCE_REPORT_FILE = "inference_report.json"

# Inference is submitted through the async model-runner API: ``infer()`` returns
# a request id immediately and the result is retrieved by polling
# ``get_infer_status(request_id)`` until its ``result`` field is populated.
INFERENCE_TIMEOUT_SECONDS = 120
INFERENCE_POLL_INTERVAL_SECONDS = 2

# Fully-qualified id of the model-runner service to run inference on.
# Overridable via --service-id so a run can target a specific worker/cluster.
DEFAULT_SERVICE_ID = f"{WORKSPACE}/model-runner"


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
    """Read the previously published inference results from the report artifact.

    Returns an empty mapping when the artifact or its report file does not exist
    yet (first ever run), so the caller always gets a plain dict to merge into.
    """
    try:
        report = await artifact_manager.read_file(
            INFERENCE_REPORT_ARTIFACT,
            file_path=INFERENCE_REPORT_FILE,
            format="json",
        )
    except Exception:
        return {}

    content = report.get("content") if isinstance(report, dict) else None
    return content or {}


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


async def ensure_report_artifact(artifact_manager: ObjectProxy) -> None:
    """Create the inference-report artifact under the test-reports collection
    if it does not exist yet. A no-op once the artifact is present.
    """
    try:
        await artifact_manager.read(INFERENCE_REPORT_ARTIFACT, silent=True)
        return
    except Exception:
        pass

    await artifact_manager.create(
        parent_id=TEST_REPORTS_COLLECTION,
        alias=INFERENCE_REPORT_ARTIFACT.split("/")[-1],
        type="generic",
        manifest={
            "name": "BioEngine inference report",
            "description": (
                "BioEngine model-runner inference results for the "
                f"{WORKSPACE}/{COLLECTION} collection. "
                f"{INFERENCE_REPORT_FILE} maps each model id to its latest "
                "inference status, message, tested_at timestamp and the "
                "model-runner version it was checked against."
            ),
        },
    )
    print(f"Created inference report artifact '{INFERENCE_REPORT_ARTIFACT}'")


async def update_inference_report(
    artifact_manager: ObjectProxy, updated_results: Dict[str, Dict[str, str | float]]
) -> None:
    """Publish the merged inference results to the single report artifact.

    Writes ``inference_report.json`` (a flat ``{model_id: {...}}`` mapping) via
    the artifact manager's stage/put_file/commit cycle.
    """
    await ensure_report_artifact(artifact_manager)

    await artifact_manager.edit(artifact_id=INFERENCE_REPORT_ARTIFACT, stage=True)
    upload_url = await artifact_manager.put_file(
        INFERENCE_REPORT_ARTIFACT, file_path=INFERENCE_REPORT_FILE
    )
    async with httpx.AsyncClient(timeout=30) as client:
        response = await client.put(upload_url, data=json.dumps(updated_results, indent=2))
        response.raise_for_status()
    await artifact_manager.commit(INFERENCE_REPORT_ARTIFACT)


async def run_inference(
    runner: ObjectProxy, model_id: str, image: np.array, skip_cache: bool
) -> None:
    """Submit an inference request and wait for it via the async runner API.

    ``infer()`` returns a request id string on the v1.15+ async API; the result
    is then retrieved by polling ``get_infer_status(request_id)`` until its
    ``result`` field is populated. A runner ``result`` carrying an ``error`` key
    is surfaced as a ``RuntimeError``. Raises ``asyncio.TimeoutError`` when the
    request does not complete within ``INFERENCE_TIMEOUT_SECONDS``.
    """
    request_id = await runner.infer(
        model_id=model_id, inputs=image, skip_cache=skip_cache
    )

    # Legacy synchronous runners returned the result dict directly instead of a
    # request id; accept that so the script keeps working during a rollout.
    if not isinstance(request_id, str):
        return

    deadline = time.time() + INFERENCE_TIMEOUT_SECONDS
    while time.time() < deadline:
        status = await runner.get_infer_status(request_id=request_id)
        result = status.get("result") if isinstance(status, dict) else None
        if result is not None:
            if isinstance(result, dict) and "error" in result:
                raise RuntimeError(result["error"])
            return
        await asyncio.sleep(INFERENCE_POLL_INTERVAL_SECONDS)

    raise asyncio.TimeoutError()


async def check_bmz_model_inference(
    model_ids: Optional[List[str]] = None,
    summary_file: str = DEFAULT_INFERENCE_SUMMARY_PATH,
    skip_cache: bool = False,
    service_id: str = DEFAULT_SERVICE_ID,
) -> None:
    """Run inference on BioImage.IO models and publish the inference report.

    Args:
        model_ids: Model IDs to check. If None, checks every model in the
            collection.
        summary_file: Path to write the CI summary JSON to.
        skip_cache: When True, re-run inference even for unchanged models that
            previously passed or failed (bypasses the in-script result cache),
            and ask the model-runner to bypass its own cache too.
        service_id: Fully-qualified id of the model-runner service to use.

    Raises:
        RuntimeError: If fetching model IDs fails.
    """
    start_time = time.time()

    token = os.environ.get("HYPHA_TOKEN") or await login({"server_url": SERVER_URL})
    server = await connect_to_server(
        {"server_url": SERVER_URL, "token": token, "method_timeout": 300}
    )

    print(f"Using model-runner service '{service_id}'")
    runner = await server.get_service(
        service_id, {"mode": "select:min:get_load"}
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
            # Strict cache: skip both previously-passed and previously-failed
            # inference calls when the model has not changed since it was last
            # checked and the model-runner version is unchanged. A failed
            # inference is a deterministic property of (model, runner version),
            # so re-running an unchanged model against the same runner can only
            # reproduce the same failure. Timeouts are excluded on purpose: they
            # are usually transient (cold start / load) rather than a stable
            # model property, so they are always retried.
            if (
                not skip_cache
                and not runner_version_changed
                and latest_change <= last_test_at
                and last_test_status in ("passed", "failed")
            ):
                print(
                    f"-> Model '{model_id}' has not changed since last inference "
                    f"(cached status '{last_test_status}') and the runner version "
                    "is unchanged, skipping"
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
            await run_inference(
                runner, model_id=model_id, image=image, skip_cache=skip_cache
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
            "message": message if message else None,
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

    # Merge freshly-run results over the previous report so cached (skipped)
    # models keep their last known status.
    updated_results = {**previous_results, **results}

    # Derive the summary from the final status of every model in scope, so that
    # cached passed and cached failed models land in the correct bucket instead
    # of all skipped models being counted as passed.
    def final_status(mid: str) -> str:
        return str(updated_results.get(mid, {}).get("status") or "never tested")

    passed = sum(1 for mid in model_ids if final_status(mid) == "passed")
    timeout = sum(1 for mid in model_ids if final_status(mid) == "timeout")
    # A timeout is a failed inference call; keep it in the failed total while
    # also reporting it on its own line.
    failed = sum(1 for mid in model_ids if final_status(mid) == "failed") + timeout

    summary = {
        "total_models": len(model_ids),
        "skipped": skipped_models,
        "passed": passed,
        "failed": failed,
        "timeout": timeout,
        "execution_time_seconds": round(execution_time, 2),
        "runner_version": current_runner_version,
        "runner_version_invalidations": runner_version_invalidations,
    }
    save_inference_summary(summary_file, summary)

    # Publish the merged inference results to the report artifact
    print(f"\nUpdating inference report artifact '{INFERENCE_REPORT_ARTIFACT}'...")
    await update_inference_report(artifact_manager, updated_results)


if __name__ == "__main__":
    parser = argparse.ArgumentParser(
        description="Run inference on BioImage.IO models and publish the inference report"
    )
    parser.add_argument(
        "--model-ids",
        nargs="+",
        help="Specific model IDs to test (default: test all models)",
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
        "(re-run inference even for previously-passed or previously-failed "
        "unchanged models, and ask the model-runner to bypass its own cache)",
    )
    parser.add_argument(
        "--service-id",
        default=DEFAULT_SERVICE_ID,
        help=f"Model-runner service id to run inference on (default: {DEFAULT_SERVICE_ID})",
    )

    args = parser.parse_args()

    if args.analyze_results:
        print_inference_summary_for_ci(args.summary_file)
        raise SystemExit(0)

    asyncio.run(
        check_bmz_model_inference(
            model_ids=args.model_ids,
            summary_file=args.summary_file,
            skip_cache=args.skip_cache,
            service_id=args.service_id,
        )
    )
