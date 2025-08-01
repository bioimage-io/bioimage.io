import asyncio
import json
import os
import re
import argparse
import sys
import time
from datetime import datetime, timezone
from pathlib import Path
from typing import List, Dict, Union

import httpx
from hypha_rpc import connect_to_server, login

def parse_error_entry(content: str) -> Dict[str, Union[str, list]]:
    """Parse ErrorEntry objects"""
    error_dict = {}
    
    # Extract loc
    loc_match = re.search(r"loc=\((.*?)\)", content)
    if loc_match:
        loc_str = loc_match.group(1)
        # Parse tuple content
        loc_items = re.findall(r"'([^']+)'", loc_str)
        error_dict["loc"] = loc_items
    
    # Extract msg
    msg_match = re.search(r"msg='([^']+)'", content)
    if msg_match:
        error_dict["msg"] = msg_match.group(1)
    
    # Extract type
    type_match = re.search(r"type='([^']+)'", content)
    if type_match:
        error_dict["type"] = type_match.group(1)
        
    # Extract with_traceback
    traceback_match = re.search(r"with_traceback=(\w+)", content)
    if traceback_match:
        error_dict["with_traceback"] = traceback_match.group(1) == "True"
    
    # Extract traceback_md
    traceback_md_match = re.search(r"traceback_md='([^']*)'", content)
    if traceback_md_match:
        error_dict["traceback_md"] = traceback_md_match.group(1)
    
    # Extract traceback_html
    traceback_html_match = re.search(r"traceback_html='([^']*)'", content)
    if traceback_html_match:
        error_dict["traceback_html"] = traceback_html_match.group(1)
    
    return error_dict


def parse_validation_context_summary(content: str) -> Dict[str, Union[str, bool, dict]]:
    """Parse ValidationContextSummary objects"""
    context_dict = {}
    
    # Extract file_name
    file_name_match = re.search(r"file_name='([^']+)'", content)
    if file_name_match:
        context_dict["file_name"] = file_name_match.group(1)
    
    # Extract perform_io_checks
    io_checks_match = re.search(r"perform_io_checks=(\w+)", content)
    if io_checks_match:
        context_dict["perform_io_checks"] = io_checks_match.group(1) == "True"
    
    # Extract known_files (dictionary)
    known_files_match = re.search(r"known_files=\{([^}]+)\}", content)
    if known_files_match:
        files_str = known_files_match.group(1)
        known_files = {}
        # Parse key-value pairs
        file_pairs = re.findall(r"'([^']+)':\s*'([^']+)'", files_str)
        for key, value in file_pairs:
            known_files[key] = value
        context_dict["known_files"] = known_files
    
    # Extract update_hashes
    update_hashes_match = re.search(r"update_hashes=(\w+)", content)
    if update_hashes_match:
        context_dict["update_hashes"] = update_hashes_match.group(1) == "True"
    
    # Extract root
    root_match = re.search(r"root='([^']+)'", content)
    if root_match:
        context_dict["root"] = root_match.group(1)
    
    return context_dict


def parse_validation_detail(content: str) -> Dict[str, Union[str, list, dict, None]]:
    """Parse ValidationDetail objects"""
    detail_dict = {}
    
    # Extract name
    name_match = re.search(r"name='([^']+)'", content)
    if name_match:
        detail_dict["name"] = name_match.group(1)
    
    # Extract status
    status_match = re.search(r"status='([^']+)'", content)
    if status_match:
        detail_dict["status"] = status_match.group(1)
    else:
        detail_dict["status"] = "failed"
    
    # Extract loc (tuple)
    loc_match = re.search(r"loc=\((.*?)\)", content)
    if loc_match:
        loc_str = loc_match.group(1)
        if loc_str.strip():
            # Parse tuple content
            loc_items = re.findall(r"'([^']+)'", loc_str)
            detail_dict["loc"] = loc_items
        else:
            detail_dict["loc"] = []
    else:
        detail_dict["loc"] = []
    
    # Extract errors array
    errors_start = content.find("errors=[")
    if errors_start != -1:
        bracket_count = 0
        errors_content_start = errors_start + len("errors=[")
        errors_end = errors_content_start
        
        for i in range(errors_content_start, len(content)):
            if content[i] == '[':
                bracket_count += 1
            elif content[i] == ']':
                if bracket_count == 0:
                    errors_end = i
                    break
                bracket_count -= 1
        
        if errors_end > errors_content_start:
            errors_str = content[errors_content_start:errors_end]
            if errors_str.strip():
                # Parse ErrorEntry objects
                error_entries = []
                error_start_idx = 0
                while True:
                    error_start = errors_str.find("ErrorEntry(", error_start_idx)
                    if error_start == -1:
                        break
                    
                    # Find matching closing parenthesis
                    paren_count = 0
                    error_content_start = error_start + len("ErrorEntry(")
                    error_end = error_content_start
                    
                    for i in range(error_content_start, len(errors_str)):
                        if errors_str[i] == '(':
                            paren_count += 1
                        elif errors_str[i] == ')':
                            if paren_count == 0:
                                error_end = i
                                break
                            paren_count -= 1
                    
                    if error_end > error_content_start:
                        error_content = errors_str[error_content_start:error_end]
                        error_dict = parse_error_entry(error_content)
                        error_entries.append(error_dict)
                    
                    error_start_idx = error_end + 1
                
                detail_dict["errors"] = error_entries
            else:
                detail_dict["errors"] = []
        else:
            detail_dict["errors"] = []
    else:
        detail_dict["errors"] = []
    
    # Extract warnings array (similar to errors)
    warnings_start = content.find("warnings=[")
    if warnings_start != -1:
        bracket_count = 0
        warnings_content_start = warnings_start + len("warnings=[")
        warnings_end = warnings_content_start
        
        for i in range(warnings_content_start, len(content)):
            if content[i] == '[':
                bracket_count += 1
            elif content[i] == ']':
                if bracket_count == 0:
                    warnings_end = i
                    break
                bracket_count -= 1
        
        if warnings_end > warnings_content_start:
            warnings_str = content[warnings_content_start:warnings_end]
            detail_dict["warnings"] = [] if not warnings_str.strip() else ["warnings parsing not implemented"]
        else:
            detail_dict["warnings"] = []
    else:
        detail_dict["warnings"] = []
    
    # Extract context (ValidationContextSummary)
    context_start = content.find("context=ValidationContextSummary(")
    if context_start != -1:
        paren_count = 0
        context_content_start = context_start + len("context=ValidationContextSummary(")
        context_end = context_content_start
        
        for i in range(context_content_start, len(content)):
            if content[i] == '(':
                paren_count += 1
            elif content[i] == ')':
                if paren_count == 0:
                    context_end = i
                    break
                paren_count -= 1
        
        if context_end > context_content_start:
            context_content = content[context_content_start:context_end]
            detail_dict["context"] = parse_validation_context_summary(context_content)
        else:
            detail_dict["context"] = None
    else:
        detail_dict["context"] = None
    
    # Extract recommended_env and conda_compare
    recommended_env_match = re.search(r"recommended_env=(\w+)", content)
    if recommended_env_match:
        if recommended_env_match.group(1) == "None":
            detail_dict["recommended_env"] = None
        else:
            detail_dict["recommended_env"] = "env parsing not implemented"
    
    conda_compare_match = re.search(r"conda_compare=(\w+)", content)
    if conda_compare_match:
        if conda_compare_match.group(1) == "None":
            detail_dict["conda_compare"] = None
        else:
            detail_dict["conda_compare"] = "conda_compare parsing not implemented"
    
    return detail_dict


def parse_installed_package(content: str) -> List[str]:
    """Parse InstalledPackage objects"""
    # Extract name
    name_match = re.search(r"name='([^']+)'", content)
    name = name_match.group(1) if name_match else ""
    
    # Extract version
    version_match = re.search(r"version='([^']+)'", content)
    version = version_match.group(1) if version_match else ""
    
    # Extract build
    build_match = re.search(r"build='([^']*)'", content)
    build = build_match.group(1) if build_match else ""
    
    # Extract channel
    channel_match = re.search(r"channel='([^']*)'", content)
    channel = channel_match.group(1) if channel_match else ""
    
    return [name, version, build, channel]


def parse_error_message(model_id: str, error_str: str) -> Dict[str, Union[str, bool]]:
    """
    Parse error messages from bioengine service and extract clean error information.
    
    Args:
        model_id: The model ID being tested
        error_str: The error string from the exception or a dict with test results
        
    Returns:
        Dictionary with parsed error information or extracted test result in standard format
    """
    if not isinstance(error_str, str):
        raise ValueError(
            f"Expected error_str to be a string, got {type(error_str)} for model {model_id}"
        )
        
    if not isinstance(error_str, str):
        return {
            "name": "bioimageio format validation",
            "source_name": None,
            "id": model_id,
            "type": None,
            "format_version": None,
            "status": "failed",
            "details": [{"errors": [{"msg": "Unknown error"}]}],
            "env": None,
            "conda_list": None,
        }
    
    # Case 1: Look for embedded partial test result (like serious-lobster)
    # Pattern: model_id is invalid: name='...' source_name='...' id='...' type='...' format_version='...' status='...' details=[...]
    partial_result_pattern = r"is invalid: name='([^']+)' source_name='([^']+)' id='([^']+)' type='([^']+)' format_version='([^']+)' status='([^']+)' details=\[(.*?)\] env=\{([^}]*)\}"
    match = re.search(partial_result_pattern, error_str, re.DOTALL)
    if match:
        name = match.group(1)
        source_name = match.group(2)
        full_id = match.group(3)
        type_val = match.group(4)
        format_version = match.group(5)
        status = match.group(6)
        details_str = match.group(7)
        env_str = match.group(8)

        # Parse details - use improved parsing functions
        details = []
        
        # Find all ValidationDetail objects using a more robust approach
        start_idx = 0
        while True:
            start_pattern = details_str.find("ValidationDetail(", start_idx)
            if start_pattern == -1:
                break
                
            # Find the matching closing parenthesis
            paren_count = 0
            content_start = start_pattern + len("ValidationDetail(")
            end_idx = content_start
            
            for i in range(content_start, len(details_str)):
                if details_str[i] == '(':
                    paren_count += 1
                elif details_str[i] == ')':
                    if paren_count == 0:
                        end_idx = i
                        break
                    paren_count -= 1
            
            if end_idx > content_start:
                detail_content = details_str[content_start:end_idx]
                detail_dict = parse_validation_detail(detail_content)
                details.append(detail_dict)
            
            start_idx = end_idx + 1
        
        # Parse env information - use improved parsing
        env = None
        if env_str.strip():
            # Find all InstalledPackage objects
            packages = []
            start_idx = 0
            while True:
                package_start = env_str.find("InstalledPackage(", start_idx)
                if package_start == -1:
                    break
                
                # Find matching closing parenthesis
                paren_count = 0
                content_start = package_start + len("InstalledPackage(")
                end_idx = content_start
                
                for i in range(content_start, len(env_str)):
                    if env_str[i] == '(':
                        paren_count += 1
                    elif env_str[i] == ')':
                        if paren_count == 0:
                            end_idx = i
                            break
                        paren_count -= 1
                
                if end_idx > content_start:
                    package_content = env_str[content_start:end_idx]
                    package_info = parse_installed_package(package_content)
                    packages.append(package_info)
                
                start_idx = end_idx + 1
            
            env = packages if packages else None

        return {
            "name": name,
            "source_name": source_name,
            "id": full_id,
            "type": type_val,
            "format_version": format_version,
            "status": status,
            "details": details,
            "env": env,
            "conda_list": None
        }
    
    # Case 2: Look for simple JSON error pattern (like polished-t-shirt)
    simple_json_pattern = r'\{\\?"success\\?":(?:false|False),\\?"error\\?":"([^"]+)",\\?"error_type\\?":"([^"]+)"\}'
    match = re.search(simple_json_pattern, error_str)
    if match:
        error_msg = match.group(1)

        return {
            "name": "bioimageio format validation",
            "source_name": None,
            "id": model_id,
            "type": None,
            "format_version": None,
            "status": "failed",
            "details": [{"errors": [{"msg": error_msg}]}],
            "env": None,
            "conda_list": None,
        }
    
    # Case 3: Fallback for any other error format
    print(f"WARNING: Unknown error format for model {model_id}: {error_str}")
    return {
        "name": "bioimageio format validation",
        "source_name": None,
        "id": model_id,
        "type": None,
        "format_version": None,
        "status": "failed",
        "details": [{"errors": [{"msg": "Parse error - unknown format"}]}],
        "env": None,
        "conda_list": None,
    }


def analyze_test_results(
    test_result: Union[str, dict],
) -> List[Dict[str, Union[str, int]]]:
    """Analyze test results and create test_reports field for manifest"""
    test_report = [
        {"name": "RDF validation", "status": "failed", "runtime": "bioimageio.core"},
        {"name": "Model Test Run", "status": "failed", "runtime": "bioimageio.core"},
        {"name": "Reproduce Outputs", "status": "failed", "runtime": "bioimageio.core"},
    ]

    # If test_result is not a dict, assume all failed
    if not isinstance(test_result, dict):
        return test_report
    
    # Handle test results with details (both successful and failed)
    if "details" not in test_result:
        return test_report

    details = test_result["details"]

    # Check RDF validation (bioimageio.spec format validation)
    for detail in details:
        if (
            detail.get("name", "").startswith("bioimageio.spec format validation")
            and detail.get("status") == "passed"
        ):
            test_report[0]["status"] = "passed"
            break

    # Check if Model Test Run passed (all tests except "Reproduce Outputs" tests must pass)
    non_reproduce_tests = [
        detail
        for detail in details
        if not detail.get("name", "").startswith(
            "Reproduce test outputs from test inputs"
        )
    ]
    if non_reproduce_tests and all(
        test.get("status") == "passed" for test in non_reproduce_tests
    ):
        test_report[1]["status"] = "passed"

    # Check Reproduce Outputs (all "Reproduce test outputs from test inputs" tests must pass)
    reproduce_tests = [
        detail
        for detail in details
        if detail.get("name", "").startswith("Reproduce test outputs from test inputs")
    ]
    if reproduce_tests and all(
        test.get("status") == "passed" for test in reproduce_tests
    ):
        test_report[2]["status"] = "passed"

    return test_report


def calculate_model_score(test_reports: List[Dict[str, Union[str, int]]]) -> int:
    """Calculate score for a model based on passed tests (1 point per passed test)"""
    return sum(1 for report in test_reports if report.get("status") == "passed")


def create_test_reports_dict(
    test_reports: List[Dict[str, Union[str, int]]], 
    execution_time: float
) -> Dict[str, Union[str, float, List]]:
    """Create test_reports dictionary with metadata"""
    return {
        "created_at": datetime.now(timezone.utc).isoformat(),
        "execution_time": round(execution_time, 2),
        "reports": test_reports
    }


def analyze_existing_test_results(result_dir: Path) -> None:
    """Analyze existing test results and output summary for GitHub Actions"""
    if not result_dir.exists():
        print("TOTAL_MODELS=0")
        return
    
    # Find all JSON files in the result directory
    json_files = list(result_dir.glob("*.json"))
    
    if not json_files:
        print("TOTAL_MODELS=0")
        return
    
    total_models = len(json_files)
    passed_rdf = 0
    passed_model = 0
    passed_reproduce = 0
    total_score = 0
    total_execution_time = 0
    
    for json_file in json_files:
        try:
            with open(json_file, 'r') as f:
                test_result = json.load(f)
            
            # Analyze the test result
            test_reports = analyze_test_results(test_result)
            model_score = calculate_model_score(test_reports)
            
            # Count passed tests
            if test_reports[0]["status"] == "passed":
                passed_rdf += 1
            if test_reports[1]["status"] == "passed":
                passed_model += 1
            if test_reports[2]["status"] == "passed":
                passed_reproduce += 1
            
            # Add to total score
            total_score += model_score
            
            # Try to extract execution time if available
            if isinstance(test_result, dict) and "execution_time" in test_result:
                total_execution_time += test_result["execution_time"]
            
        except Exception as e:
            print(f"Error processing {json_file}: {e}", file=sys.stderr)
    
    # Calculate percentages
    rdf_rate = round((passed_rdf / total_models) * 100, 1) if total_models > 0 else 0
    model_rate = round((passed_model / total_models) * 100, 1) if total_models > 0 else 0
    reproduce_rate = round((passed_reproduce / total_models) * 100, 1) if total_models > 0 else 0
    
    # Calculate average score
    average_score = round(total_score / total_models, 2) if total_models > 0 else 0
    
    # Calculate average execution time
    average_execution_time = round(total_execution_time / total_models, 2) if total_models > 0 else 0
    
    # Output variables for GitHub Actions
    print(f"TOTAL_MODELS={total_models}")
    print(f"PASSED_RDF={passed_rdf}")
    print(f"PASSED_MODEL={passed_model}")
    print(f"PASSED_REPRODUCE={passed_reproduce}")
    print(f"RDF_RATE={rdf_rate}")
    print(f"MODEL_RATE={model_rate}")
    print(f"REPRODUCE_RATE={reproduce_rate}")
    print(f"TOTAL_SCORE={total_score}")
    print(f"AVERAGE_SCORE={average_score}")
    print(f"TOTAL_EXECUTION_TIME={total_execution_time:.2f}")
    print(f"AVERAGE_EXECUTION_TIME={average_execution_time}")


async def test_bmz_models(
    skip_exists: bool = True,
    model_ids: List[str] = None,
    result_dir: Path = None,
    update_artifacts: bool = True,
    update_collection: bool = True,
):
    start_time = time.time()
    
    server_url = "https://hypha.aicell.io"
    token = os.environ.get("HYPHA_TOKEN") or await login({"server_url": server_url})
    server = await connect_to_server(
        {"server_url": server_url, "token": token, "method_timeout": 3000}
    )

    runner = await server.get_service('bioimage-io/model-runner', {"mode": "select:min:get_load"});
    artifact_manager = await server.get_service("public/artifact-manager")

    # Fetch all model IDs if not provided
    if model_ids is None:
        url = (
            "https://hypha.aicell.io/bioimage-io/artifacts/bioimage.io/children?limit=10000"
        )
        async with httpx.AsyncClient() as client:
            response = await client.get(url)
            if response.status_code != 200:
                raise RuntimeError(f"Failed to fetch model IDs: {response.status_code}")
            model_ids = [
                item["id"].split("/")[1] for item in response.json() if item["type"] == "model"
            ]
            model_ids = sorted(model_ids)

    # Create test results directory
    if result_dir is None:
        result_dir = Path(__file__).resolve().parent.parent / "bioimageio_test_reports"
    result_dir.mkdir(parents=True, exist_ok=True)

    # Initialize counters for test results
    total_rdf_passed = 0
    total_model_test_passed = 0
    total_reproduce_passed = 0
    total_collection_score = 0

    # Test each model
    for model_id in model_ids:
        model_start_time = time.time()
        test_results_file = result_dir / f"{model_id}.json"
        
        if skip_exists and test_results_file.exists():
            print(
                f"Skipping test run for already tested model: {model_id} - file exists"
            )
            test_results = json.loads(test_results_file.read_text(encoding="utf-8"))
            if not isinstance(test_results, dict):
                raise ValueError(
                    f"Test results for model {model_id} are not in expected format: {test_results}"
                )
            model_execution_time = 0  # Unknown for existing results
        else:
            try:
                print(f"Testing model: {model_id}")
                test_results = await runner.test(
                    model_id=model_id,
                    stage=False
                )
                model_execution_time = time.time() - model_start_time
                print(f"Model {model_id} tested in {model_execution_time:.2f} seconds")
            except Exception as e:
                # Parse the error message to extract clean error information
                test_results = parse_error_message(model_id, str(e))
                model_execution_time = time.time() - model_start_time
                print(f"Model {model_id} failed after {model_execution_time:.2f} seconds")

            with open(test_results_file, "w") as f:
                json.dump(test_results, f, indent=2)

        # Update artifact with test results
        if update_artifacts:
            artifact_id = f"bioimage-io/{model_id}"
            await asyncio.sleep(0.5)  # Avoid rate limiting issues
            try:
                # Get current artifact to read its manifest
                current_artifact = await artifact_manager.read(artifact_id)
                manifest = current_artifact.get("manifest", {})

                print(f"Adding test reports to artifact: {artifact_id}")

                # Analyze test results and add test_reports to manifest
                test_reports = analyze_test_results(test_results)
                model_score = calculate_model_score(test_reports)
                
                # Create test_reports dictionary with metadata
                manifest["test_reports"] = create_test_reports_dict(test_reports, model_execution_time)
                manifest["score"] = model_score

                # Update counter for test results
                total_rdf_passed += int(test_reports[0]["status"] == "passed")
                total_model_test_passed += int(test_reports[1]["status"] == "passed")
                total_reproduce_passed += int(test_reports[2]["status"] == "passed")
                
                # Add to collection score if model passes all tests
                if model_score == 3:  # All tests passed
                    total_collection_score += 3

                # Edit the artifact and stage it for review
                artifact = await artifact_manager.edit(
                    artifact_id=artifact_id,
                    manifest=manifest,
                    type=current_artifact.get("type", "model"),
                    stage=True,
                )

                upload_url = await artifact_manager.put_file(
                    artifact.id, file_path="test_reports.json"
                )

                async with httpx.AsyncClient(timeout=30) as client:
                    response = await client.put(upload_url, data=json.dumps(test_results))
                    response.raise_for_status()

                # Commit the artifact
                await artifact_manager.commit(artifact_id=artifact.id)
                print(f"Updated artifact {artifact_id} with test reports (score: {model_score})")

            except Exception as e:
                print(f"Failed to update artifact {artifact_id}: {e}")
        else:
            # Still need to analyze results for counting even if not updating artifacts
            test_reports = analyze_test_results(test_results)
            model_score = calculate_model_score(test_reports)
            total_rdf_passed += int(test_reports[0]["status"] == "passed")
            total_model_test_passed += int(test_reports[1]["status"] == "passed")
            total_reproduce_passed += int(test_reports[2]["status"] == "passed")
            
            # Add to collection score if model passes all tests
            if model_score == 3:  # All tests passed
                total_collection_score += 3

    total_execution_time = time.time() - start_time
    
    print(f"Total models tested: {len(model_ids)}")
    print(f"Total models with valid RDF: {total_rdf_passed}")
    print(f"Total models with passed test run: {total_model_test_passed}")
    print(f"Total models with reproducible outputs: {total_reproduce_passed}")
    print(f"Total collection score: {total_collection_score}")
    print(f"Total execution time: {total_execution_time:.2f} seconds")

    # Update collection artifact
    if update_collection:
        # Get current artifact to read its manifest
        collection_id = "bioimage-io/bioimage.io"
        print(f"Updating collection artifact ({collection_id}) with test reports")
        collection_artifact = await artifact_manager.read(collection_id)
        manifest = collection_artifact.get("manifest", {})

        # Create collection test reports with new format
        collection_test_reports = [
            {
                "name": "RDF validation",
                "status": f"{total_rdf_passed}/{len(model_ids)}",
                "runtime": "bioimageio.core",
            },
            {
                "name": "Model Test Run",
                "status": f"{total_model_test_passed}/{len(model_ids)}",
                "runtime": "bioimageio.core",
            },
            {
                "name": "Reproduce Outputs",
                "status": f"{total_reproduce_passed}/{len(model_ids)}",
                "runtime": "bioimageio.core",
            },
        ]

        # Add test reports and score to the manifest
        manifest["test_reports"] = create_test_reports_dict(collection_test_reports, total_execution_time)
        manifest["score"] = total_collection_score
        
        print("Updated collection test reports:", manifest["test_reports"])
        print(f"Collection score: {total_collection_score}")

        # Edit the artifact and stage it for review
        artifact = await artifact_manager.edit(
            artifact_id=collection_id,
            manifest=manifest,
            type=collection_artifact["type"],
        )
        print(f"Updated artifact {collection_id} with test reports")


def main():
    parser = argparse.ArgumentParser(
        description="Test BioImage.IO models and generate test reports"
    )
    parser.add_argument(
        "--skip-exists",
        action="store_true",
        default=True,
        help="Skip testing models that already have test results (default: True)"
    )
    parser.add_argument(
        "--no-skip-exists",
        action="store_false",
        dest="skip_exists",
        help="Re-test models even if they already have test results"
    )
    parser.add_argument(
        "--model-ids",
        nargs="+",
        help="Specific model IDs to test (default: test all models)"
    )
    parser.add_argument(
        "--result-dir",
        type=Path,
        help="Directory to store test results (default: ../bioimageio_test_reports)"
    )
    parser.add_argument(
        "--no-update-artifacts",
        action="store_false",
        dest="update_artifacts",
        help="Don't update individual model artifacts with test reports"
    )
    parser.add_argument(
        "--no-update-collection",
        action="store_false",
        dest="update_collection",
        help="Don't update the collection artifact with test reports"
    )
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="Run tests but don't update any artifacts"
    )
    parser.add_argument(
        "--analyze-results",
        action="store_true",
        help="Analyze existing test results in the result_dir and output summary for GitHub Actions"
    )

    args = parser.parse_args()

    # Handle dry-run mode
    if args.dry_run:
        args.update_artifacts = False
        args.update_collection = False
        print("Running in dry-run mode - no artifacts will be updated")

    if args.analyze_results:
        # Set default result_dir if not provided
        result_dir = args.result_dir or Path(__file__).resolve().parent.parent / "bioimageio_test_reports"
        analyze_existing_test_results(result_dir)
    else:
        asyncio.run(test_bmz_models(
            skip_exists=args.skip_exists,
            model_ids=args.model_ids,
            result_dir=args.result_dir,
            update_artifacts=args.update_artifacts,
            update_collection=args.update_collection,
        ))
        print("All models tested successfully.")


if __name__ == "__main__":
    main()
