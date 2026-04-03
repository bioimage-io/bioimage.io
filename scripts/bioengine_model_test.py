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


async def test_bmz_models(
    model_ids: Optional[List[str]] = None,
    publish_test_report: bool = True,
    reports_dir: Optional[Path] = None,
) -> None:
    """Test BioImage.IO models and generate test reports.

    Connects to the Hypha server, runs tests on specified models (or all models
    if none specified), and optionally updates artifact manifests with reports.

    Args:
        model_ids: List of model IDs to test. If None, fetches all models.
        publish_test_report: Whether model_runner.test should publish test_report.json.
        reports_dir: Directory where per-model JSON test reports are written.

    Raises:
        RuntimeError: If fetching model IDs fails.
    """
    start_time = time.time()

    server_url = "https://hypha.aicell.io"
    token = os.environ.get("HYPHA_TOKEN") or await login({"server_url": server_url})
    server = await connect_to_server(
        {"server_url": server_url, "token": token, "method_timeout": 300}
    )

    model_runner = await server.get_service(
        "bioimage-io/model-runner", {"mode": "select:min:get_load"}
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

    output_dir = reports_dir or Path(__file__).resolve().parent.parent / "bioimageio_test_reports"
    output_dir.mkdir(parents=True, exist_ok=True)

    # Test each model
    for model_id in model_ids:
        model_start_time = time.time()

        try:
            print(f"Testing model '{model_id}'...")
            test_report = await asyncio.wait_for(
                model_runner.test(
                    model_id=model_id,
                    stage=False,
                    publish_test_report=publish_test_report,
                ),
                timeout=300,  # 5 minutes timeout
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
                "status": "failed",
                "details": [{"errors": [{"msg": "Test timed out after 5 minutes"}]}]
            }
        except Exception:
            error_traceback = traceback.format_exc()
            test_report = {
                "id": model_id,
                "status": "failed",
                "details": [{"errors": [{"msg": error_traceback}]}]
            }
            model_execution_time = time.time() - model_start_time
            print(f"Model '{model_id}' failed after {model_execution_time:.2f} seconds")

        model_status = test_report.get("status", "failed")
        if model_status == "passed":
            total_passed += 1
        elif model_status == "valid-format":
            total_valid_format += 1
        else:
            total_failed += 1

        output_file = output_dir / f"{model_id}.json"
        try:
            with open(output_file, "w", encoding="utf-8") as f:
                json.dump(test_report, f, indent=2)
        except Exception as e:
            print(
                f"Failed to write test report for '{model_id}' to {output_file}: {e}",
                file=sys.stderr,
            )

    total_collection_score = total_passed
    total_execution_time = time.time() - start_time

    # Print summary
    perc_passed = (total_passed / len(model_ids)) * 100 if model_ids else 0
    perc_valid_format = (
        (total_valid_format / len(model_ids)) * 100 if model_ids else 0
    )
    perc_failed = (total_failed / len(model_ids)) * 100 if model_ids else 0
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
        f"Total collection score: {total_collection_score} (out of {len(model_ids)})"
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
        TOTAL_MODELS, PASSED, VALID_FORMAT, FAILED,
        PASSED_RATE, VALID_FORMAT_RATE, FAILED_RATE,
        TOTAL_SCORE, AVERAGE_SCORE
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

    for json_file in json_files:
        try:
            with open(json_file, "r") as f:
                test_report = json.load(f)

            status = test_report.get("status", "failed")
            if status == "passed":
                passed += 1
            elif status == "valid-format":
                valid_format += 1
            else:
                failed += 1

        except Exception as e:
            print(f"Error processing {json_file}: {e}", file=sys.stderr)

    # Calculate percentages
    passed_rate = round((passed / total_models) * 100, 1) if total_models > 0 else 0
    valid_format_rate = (
        round((valid_format / total_models) * 100, 1) if total_models > 0 else 0
    )
    failed_rate = round((failed / total_models) * 100, 1) if total_models > 0 else 0

    # Calculate average score
    total_score = passed
    average_score = round(total_score / total_models, 2) if total_models > 0 else 0

    # Output variables for GitHub Actions
    print(f"TOTAL_MODELS={total_models}")
    print(f"PASSED={passed}")
    print(f"VALID_FORMAT={valid_format}")
    print(f"FAILED={failed}")
    print(f"PASSED_RATE={passed_rate}")
    print(f"VALID_FORMAT_RATE={valid_format_rate}")
    print(f"FAILED_RATE={failed_rate}")
    print(f"TOTAL_SCORE={total_score}")
    print(f"AVERAGE_SCORE={average_score}")


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
        "--no-publish-test-report",
        action="store_false",
        dest="publish_test_report",
        help="Do not publish test_report.json via model_runner.test",
    )
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="Run tests but don't update any artifacts",
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

    args = parser.parse_args()

    # Handle dry-run mode
    if args.dry_run:
        args.publish_test_report = False
        print("Running in dry-run mode - test_report.json will not be published")

    reports_dir = (
        args.reports_dir
        or Path(__file__).resolve().parent.parent / "bioimageio_test_reports"
    )

    if args.analyze_reports:
        # Set default reports_dir if not provided
        analyze_existing_test_reports(reports_dir)
    else:
        if args.clear_reports_dir:
            clear_existing_test_reports(reports_dir)

        asyncio.run(
            test_bmz_models(
                model_ids=args.model_ids,
                publish_test_report=args.publish_test_report,
                reports_dir=reports_dir,
            )
        )


if __name__ == "__main__":
    main()
