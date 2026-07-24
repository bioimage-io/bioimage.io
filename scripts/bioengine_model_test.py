import argparse
import asyncio
import json
import os
import sys
import time
import traceback
from pathlib import Path
from typing import List, Optional

import httpx
from hypha_rpc import connect_to_server, login
from hypha_rpc.utils import ObjectProxy


# Fully-qualified id of the model-runner service to test against. Overridable
# via --service-id so a run can target a specific worker/cluster.
DEFAULT_SERVICE_ID = "bioimage-io/model-runner"

# Testing is submitted through the async model-runner API: ``test()`` returns a
# run id immediately and the report is retrieved by polling
# ``get_test_status(test_run_id)`` until its ``result`` field is populated.
TEST_TIMEOUT_SECONDS = 300
TEST_POLL_INTERVAL_SECONDS = 3


async def run_test(
    runner: ObjectProxy, model_id: str, skip_cache: bool
) -> dict:
    """Submit a model test and wait for the report via the async runner API.

    ``test()`` returns a run id string on the v1.15+ async API; the report is
    then retrieved by polling ``get_test_status(test_run_id)`` until its
    ``result`` field is populated. A ``result`` carrying an ``error`` key is
    surfaced as a ``RuntimeError``. The runner publishes the report to the
    ``bioimage-io/test-reports`` collection itself. Raises
    ``asyncio.TimeoutError`` when the run does not complete within
    ``TEST_TIMEOUT_SECONDS``.
    """
    run_id = await runner.test(model_id=model_id, stage=False, skip_cache=skip_cache)

    # Legacy synchronous runners returned the report dict directly instead of a
    # run id; accept that so the script keeps working during a rollout.
    if not isinstance(run_id, str):
        return run_id

    deadline = time.time() + TEST_TIMEOUT_SECONDS
    while time.time() < deadline:
        status = await runner.get_test_status(test_run_id=run_id)
        result = status.get("result") if isinstance(status, dict) else None
        if result is not None:
            if isinstance(result, dict) and "error" in result:
                raise RuntimeError(result["error"])
            return result
        await asyncio.sleep(TEST_POLL_INTERVAL_SECONDS)

    raise asyncio.TimeoutError()


async def test_bmz_models(
    model_ids: Optional[List[str]] = None,
    reports_dir: Optional[Path] = None,
    skip_cache: bool = False,
    service_id: str = DEFAULT_SERVICE_ID,
) -> None:
    """Test BioImage.IO models and generate test reports.

    Connects to the Hypha server, runs tests on specified models (or all models
    if none specified), and writes per-model JSON reports locally for the CI
    summary. The model-runner publishes each report to the
    ``bioimage-io/test-reports`` collection itself.

    Args:
        model_ids: List of model IDs to test. If None, fetches all models.
        reports_dir: Directory where per-model JSON test reports are written.
        skip_cache: Whether to skip cache during model testing.
        service_id: Fully-qualified id of the model-runner service to use.

    Raises:
        RuntimeError: If fetching model IDs fails.
    """
    start_time = time.time()

    server_url = "https://hypha.aicell.io"
    token = os.environ.get("HYPHA_TOKEN") or await login({"server_url": server_url})
    server = await connect_to_server(
        {"server_url": server_url, "token": token, "method_timeout": 300}
    )

    print(f"Using model-runner service '{service_id}'")
    model_runner = await server.get_service(
        service_id, {"mode": "select:min:get_load"}
    )

    # Fetch all model IDs if not provided
    if model_ids is None:
        url = "https://hypha.aicell.io/bioimage-io/artifacts/bioimage.io/children?limit=10000"
        async with httpx.AsyncClient() as client:
            response = await client.get(url)
            if response.status_code != 200:
                raise RuntimeError(f"Failed to fetch model IDs: {response.status_code}")
            model_ids = [
                item["id"].split("/")[1]
                for item in response.json()
                if item["type"] == "model"
            ]
            model_ids = sorted(model_ids)

    # Initialize counters for overall statuses
    total_passed = 0
    total_valid_format = 0
    total_failed = 0
    total_timeout = 0
    total_error = 0

    output_dir = (
        reports_dir
        or Path(__file__).resolve().parent.parent / "bioimageio_test_reports"
    )
    output_dir.mkdir(parents=True, exist_ok=True)

    # Test each model
    for model_id in model_ids:
        model_start_time = time.time()

        try:
            print(f"Testing model '{model_id}'...")
            test_report = await run_test(
                model_runner, model_id=model_id, skip_cache=skip_cache
            )

            model_execution_time = time.time() - model_start_time
            print(f"Model '{model_id}' tested in {model_execution_time:.2f} seconds")

        except asyncio.TimeoutError:
            model_execution_time = time.time() - model_start_time
            print(
                f"Model '{model_id}' timed out after {model_execution_time:.2f} seconds"
            )
            test_report = {
                "id": model_id,
                "status": "service-timeout",
                "details": [{"errors": [{"msg": "Test timed out after 5 minutes"}]}],
            }
        except Exception:
            error_traceback = traceback.format_exc()
            test_report = {
                "id": model_id,
                "status": "service-error",
                "details": [{"errors": [{"msg": error_traceback}]}],
            }
            model_execution_time = time.time() - model_start_time
            print(f"Model '{model_id}' failed after {model_execution_time:.2f} seconds")

        if "status" not in test_report:
            test_report["status"] = "failed"
        status = test_report["status"]
        if status == "passed":
            total_passed += 1
        elif status == "valid-format":
            total_valid_format += 1
        elif status == "failed":
            total_failed += 1
        elif status == "service-timeout":
            total_timeout += 1
        elif status == "service-error":
            total_error += 1

        output_file = output_dir / f"{model_id}.json"
        try:
            with open(output_file, "w", encoding="utf-8") as f:
                json.dump(test_report, f, indent=2)
        except Exception as e:
            print(
                f"Failed to write test report for '{model_id}' to {output_file}: {e}",
                file=sys.stderr,
            )

    total_execution_time = time.time() - start_time

    # Print summary
    perc_passed = (total_passed / len(model_ids)) * 100 if model_ids else 0
    perc_valid_format = (total_valid_format / len(model_ids)) * 100 if model_ids else 0
    perc_failed = (total_failed / len(model_ids)) * 100 if model_ids else 0
    perc_timeout = (total_timeout / len(model_ids)) * 100 if model_ids else 0
    perc_error = (total_error / len(model_ids)) * 100 if model_ids else 0
    formatted_time = time.strftime("%H:%M:%S", time.gmtime(total_execution_time))

    print(
        f"Total models with status passed: {total_passed}/{len(model_ids)} ({perc_passed:.2f}%)"
    )
    print(
        f"Total models with status valid-format: {total_valid_format}/{len(model_ids)} ({perc_valid_format:.2f}%)"
    )
    print(
        f"Total models with status failed: {total_failed}/{len(model_ids)} ({perc_failed:.2f}%)"
    )
    print(
        f"Total models with execution timeout: {total_timeout}/{len(model_ids)} ({perc_timeout:.2f}%)"
    )
    print(
        f"Total models with execution error: {total_error}/{len(model_ids)} ({perc_error:.2f}%)"
    )
    print(f"Total execution time: {formatted_time} (hh:mm:ss)")
    print(f"Saved model test reports to: {output_dir}")


def analyze_existing_test_reports(reports_dir: Path) -> None:
    """Analyze existing test reports and output summary for GitHub Actions.

    Reads all JSON test report files from the given directory, calculates
    statistics, and prints environment variables suitable for GitHub Actions.

    Args:
        reports_dir: Path to directory containing test report JSON files.

    Outputs (printed to stdout):
        TOTAL_MODELS, PASSED, VALID_FORMAT, FAILED, TIMEOUT, ERROR,
        PASSED_RATE, VALID_FORMAT_RATE, FAILED_RATE, TIMEOUT_RATE, ERROR_RATE
    """
    if not reports_dir.exists():
        print("TOTAL_MODELS=0")
        return

    # Find all JSON files in the reports directory
    json_files = list(reports_dir.glob("*.json"))

    if not json_files:
        print("TOTAL_MODELS=0")
        return

    total_models = len(json_files)
    passed = 0
    valid_format = 0
    failed = 0
    timeout = 0
    error = 0
    runner_versions = set()

    for json_file in json_files:
        try:
            with open(json_file, "r") as f:
                test_report = json.load(f)

            status = test_report.get("status", "failed")
            if status == "passed":
                passed += 1
            elif status == "valid-format":
                valid_format += 1
            elif status == "failed":
                failed += 1
            elif status == "service-timeout":
                timeout += 1
            elif status == "service-error":
                error += 1

            # The runner records its own artifact version inside test_report["env"]
            # as a row ["bioimage-io/model-runner", "<version>", "", ""], alongside
            # rows for bioimageio.core, bioimageio.spec, and bioengine. Rows added
            # before the runner started stamping itself do not contain that name.
            for row in test_report.get("env", []) or []:
                if (
                    isinstance(row, (list, tuple))
                    and len(row) >= 2
                    and row[0] == "bioimage-io/model-runner"
                    and row[1]
                ):
                    runner_versions.add(str(row[1]))
                    break

        except Exception as e:
            print(f"Error processing {json_file}: {e}", file=sys.stderr)

    # Calculate percentages
    passed_rate = round((passed / total_models) * 100, 1) if total_models > 0 else 0
    valid_format_rate = (
        round((valid_format / total_models) * 100, 1) if total_models > 0 else 0
    )
    failed_rate = round((failed / total_models) * 100, 1) if total_models > 0 else 0
    timeout_rate = round((timeout / total_models) * 100, 1) if total_models > 0 else 0
    error_rate = round((error / total_models) * 100, 1) if total_models > 0 else 0

    if len(runner_versions) == 0:
        runner_version_display = ""
    elif len(runner_versions) == 1:
        runner_version_display = next(iter(runner_versions))
    else:
        runner_version_display = "mixed: " + ", ".join(sorted(runner_versions))

    # Output variables for GitHub Actions
    print(f"TOTAL_MODELS={total_models}")
    print(f"PASSED={passed}")
    print(f"VALID_FORMAT={valid_format}")
    print(f"FAILED={failed}")
    print(f"TIMEOUT={timeout}")
    print(f"ERROR={error}")
    print(f"PASSED_RATE={passed_rate}")
    print(f"VALID_FORMAT_RATE={valid_format_rate}")
    print(f"FAILED_RATE={failed_rate}")
    print(f"TIMEOUT_RATE={timeout_rate}")
    print(f"ERROR_RATE={error_rate}")
    print(f"RUNNER_VERSION='{runner_version_display.replace(chr(39), '')}'")


def clear_existing_test_reports(reports_dir: Path) -> None:
    """Remove existing JSON test report files from a reports directory.

    Args:
        reports_dir: Directory containing per-model JSON test report files.
    """
    reports_dir.mkdir(parents=True, exist_ok=True)
    removed_count = 0

    for json_file in reports_dir.glob("*.json"):
        try:
            json_file.unlink()
            removed_count += 1
        except Exception as e:
            print(f"Failed to remove {json_file}: {e}", file=sys.stderr)

    print(f"Cleared {removed_count} existing JSON report file(s) in: {reports_dir}")


async def cleanup_orphan_test_reports(dry_run: bool = False) -> None:
    """Delete per-model test reports whose model no longer exists in the zoo.

    Scans the ``bioimage-io/test-reports`` collection and removes any
    ``test-report-<id>`` artifact whose ``<id>`` model is not present in
    ``bioimage-io/bioimage.io`` (neither committed nor staged). The consolidated
    ``inference-report`` and any non ``test-report-`` prefixed member are left
    untouched. Deletion is best-effort: a permission error on one report is
    logged and the sweep continues.

    Args:
        dry_run: If True, only report what would be deleted.
    """
    server_url = "https://hypha.aicell.io"
    token = os.environ.get("HYPHA_TOKEN") or await login({"server_url": server_url})
    server = await connect_to_server(
        {"server_url": server_url, "token": token, "method_timeout": 120}
    )
    am = await server.get_service("public/artifact-manager")

    # Existing model aliases (committed AND staged), so we never delete a report
    # for a model that still exists in any form.
    existing = set()
    for stage in (False, True):
        try:
            listed = await am.list(
                parent_id="bioimage-io/bioimage.io",
                stage=stage,
                limit=10000,
                pagination=True,
            )
            for it in listed.get("items", []):
                existing.add(it["id"].split("/")[-1])
        except Exception as e:  # pragma: no cover - defensive
            print(f"Warning: failed to list models (stage={stage}): {e}", file=sys.stderr)

    reports = await am.list(
        parent_id="bioimage-io/test-reports", limit=10000, pagination=True
    )
    orphans = []
    for it in reports.get("items", []):
        alias = it["id"].split("/")[-1]
        if not alias.startswith("test-report-"):
            continue  # keep inference-report and other non per-model members
        model_alias = alias[len("test-report-") :]
        if model_alias not in existing:
            orphans.append(it["id"])

    print(
        f"Orphan cleanup: {len(orphans)} test report(s) for models no longer in the zoo"
    )
    deleted = 0
    for aid in orphans:
        short = aid.split("/")[-1]
        if dry_run:
            print(f"  [dry-run] would delete {short}")
            continue
        try:
            await am.delete(artifact_id=aid, delete_files=True, recursive=True)
            deleted += 1
            print(f"  deleted {short}")
        except Exception as e:
            print(f"  FAILED to delete {short}: {e}", file=sys.stderr)
    if not dry_run:
        print(f"Orphan cleanup: deleted {deleted}/{len(orphans)} report(s)")


def main():
    parser = argparse.ArgumentParser(
        description="Test BioImage.IO models and generate test summaries"
    )
    parser.add_argument(
        "--model-ids",
        nargs="+",
        help="Specific model IDs to test (default: test all models)",
    )
    parser.add_argument(
        "--reports-dir",
        type=Path,
        help="Directory for writing test reports and reading them in --analyze-reports (default: ../bioimageio_test_reports)",
    )
    parser.add_argument(
        "--analyze-reports",
        action="store_true",
        help="Analyze existing test reports in the reports_dir and output summary for GitHub Actions",
    )
    parser.add_argument(
        "--clear-reports-dir",
        action="store_true",
        help="Clear existing JSON files in reports_dir before running tests",
    )
    parser.add_argument(
        "--cleanup-orphans",
        action="store_true",
        help="Delete test-report artifacts for models that no longer exist in the bioimage.io collection, then exit",
    )
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="With --cleanup-orphans, only report which reports would be deleted",
    )
    parser.add_argument(
        "--skip-cache",
        action="store_true",
        help="Skip cache during model testing",
    )
    parser.add_argument(
        "--service-id",
        default=DEFAULT_SERVICE_ID,
        help=f"Model-runner service id to test against (default: {DEFAULT_SERVICE_ID})",
    )

    args = parser.parse_args()

    reports_dir = (
        args.reports_dir
        or Path(__file__).resolve().parent.parent / "bioimageio_test_reports"
    )

    if args.cleanup_orphans:
        asyncio.run(cleanup_orphan_test_reports(dry_run=args.dry_run))
    elif args.analyze_reports:
        # Set default reports_dir if not provided
        analyze_existing_test_reports(reports_dir)
    else:
        if args.clear_reports_dir:
            clear_existing_test_reports(reports_dir)

        asyncio.run(
            test_bmz_models(
                model_ids=args.model_ids,
                reports_dir=reports_dir,
                skip_cache=args.skip_cache,
                service_id=args.service_id,
            )
        )


if __name__ == "__main__":
    main()
