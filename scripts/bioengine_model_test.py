import argparse
import asyncio
import json
import time
from pathlib import Path

from hypha_rpc import connect_to_server


async def test_bmz_model(
    model_id: str,
    result_dir: str,
) -> None:
    """Test BioImage.IO model and generate test report.

    Args:
        model_id: The ID of the model to test.
        result_dir: Directory to store JSON test results.

    Raises:
        RuntimeError: If fetching model IDs fails.
    """
    result_dir = Path(result_dir)
    result_dir.mkdir(parents=True, exist_ok=True)

    async with connect_to_server(
        {"server_url": "https://hypha.aicell.io", "method_timeout": 300}
    ) as server:
        runner = await server.get_service(
            "bioimage-io/model-runner", {"mode": "select:min:get_load"}
        )
        model_start_time = time.time()
        test_results_file = result_dir / f"{model_id}.json"

        try:
            print(f"Testing model '{model_id}'...")
            test_results = await asyncio.wait_for(
                runner.test(
                    model_id=model_id,
                    stage=False,  # Only test published versions
                    skip_cache=True,  # Force fresh execution without using cached results
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
            test_results = "Model test timed out after 5 minutes"

        except Exception as e:
            model_execution_time = time.time() - model_start_time
            print(f"Model '{model_id}' failed after {model_execution_time:.2f} seconds")
            test_results = str(e)

        with open(test_results_file, "w") as f:
            json.dump(test_results, f, indent=2)


if __name__ == "__main__":
    parser = argparse.ArgumentParser(
        description="Test BioImage.IO models and generate test reports"
    )
    parser.add_argument(
        "--model-id",
        type=str,
        help="Specific model ID to test (default: test all models)",
    )
    parser.add_argument(
        "--result-dir",
        type=str,
        default="bioimageio_test_reports",
        help="Directory to store test results",
    )

    args = parser.parse_args()

    asyncio.run(
        test_bmz_model(
            model_id=args.model_id,
            result_dir=args.result_dir,
        )
    )
