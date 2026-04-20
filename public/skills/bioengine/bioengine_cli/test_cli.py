"""
test_cli.py — Live integration tests for BioEngine CLI.

Tests verified against production server: https://hypha.aicell.io
Tests that require actual image files are marked as UNTESTED_LIVE.

Run with:
  python -m bioengine_cli.test_cli

Or directly:
  python test_cli.py
"""
from __future__ import annotations

import asyncio
import json
import subprocess
import sys
from pathlib import Path


PYTHON = sys.executable
CLI_MODULE = [PYTHON, "-m", "bioengine_cli"]

SERVER_URL = "https://hypha.aicell.io"

PASS = "\033[32mPASS\033[0m"
FAIL = "\033[31mFAIL\033[0m"
SKIP = "\033[33mSKIP\033[0m"


def run_cli(*args, expect_exit=0, input=None):
    """Run a CLI command and return (stdout, stderr, returncode)."""
    cmd = CLI_MODULE + list(args)
    result = subprocess.run(
        cmd,
        capture_output=True,
        text=True,
        input=input,
        timeout=120,
    )
    return result.stdout, result.stderr, result.returncode


def test(name: str, passed: bool, detail: str = ""):
    icon = PASS if passed else FAIL
    print(f"  [{icon}] {name}" + (f": {detail}" if detail else ""))
    return passed


# ── Test 1: CLI help works ────────────────────────────────────────────────────

def test_help():
    print("\n--- CLI help ---")
    stdout, stderr, code = run_cli("--help")
    ok = code == 0 and "runner" in stdout and "apps" in stdout
    test("bioengine --help works", ok, detail=f"exit={code}")

    stdout, stderr, code = run_cli("runner", "--help")
    ok = code == 0 and "search" in stdout and "infer" in stdout
    test("bioengine runner --help works", ok, detail=f"exit={code}")

    stdout, stderr, code = run_cli("apps", "--help")
    ok = code == 0 and "deploy" in stdout and "status" in stdout
    test("bioengine apps --help works", ok, detail=f"exit={code}")


# ── Test 2: search_models against live server ─────────────────────────────────

def test_search():
    print("\n--- runner search (LIVE) ---")

    # Basic search with keywords
    stdout, stderr, code = run_cli(
        "runner", "search", "--keywords", "nuclei", "--limit", "3",
        "--server-url", SERVER_URL,
    )
    test("search --keywords nuclei --limit 3 exits 0", code == 0, detail=f"exit={code}")
    test("search returns output", len(stdout.strip()) > 0, detail=f"stdout len={len(stdout)}")

    # JSON output
    stdout, stderr, code = run_cli(
        "runner", "search", "--keywords", "nuclei", "--limit", "3",
        "--json",
        "--server-url", SERVER_URL,
    )
    ok_json = False
    model_id = None
    if code == 0:
        try:
            data = json.loads(stdout)
            ok_json = isinstance(data, list) and len(data) > 0
            if ok_json:
                model_id = data[0].get("model_id")
        except json.JSONDecodeError:
            pass
    test("search --json returns valid JSON list", ok_json, detail=f"first_model={model_id}")

    return model_id


# ── Test 3: get_model_rdf (info) against live server ─────────────────────────

def test_info(model_id: str):
    print(f"\n--- runner info {model_id} (LIVE) ---")

    stdout, stderr, code = run_cli(
        "runner", "info", model_id,
        "--server-url", SERVER_URL,
    )
    test(f"info {model_id} exits 0", code == 0, detail=f"exit={code}")
    test("info output contains 'Model:'", "Model:" in stdout or "ID:" in stdout,
         detail=f"stdout snippet: {stdout[:100]!r}")

    # JSON mode
    stdout, stderr, code = run_cli(
        "runner", "info", model_id, "--json",
        "--server-url", SERVER_URL,
    )
    ok_json = False
    if code == 0:
        try:
            rdf = json.loads(stdout)
            ok_json = isinstance(rdf, dict) and "inputs" in rdf
        except json.JSONDecodeError:
            pass
    test("info --json returns valid RDF dict with 'inputs'", ok_json)


# ── Test 4: search with no keywords ──────────────────────────────────────────

def test_search_no_keywords():
    print("\n--- runner search (no keywords) ---")
    stdout, stderr, code = run_cli(
        "runner", "search", "--limit", "5", "--json",
        "--server-url", SERVER_URL,
    )
    ok = code == 0
    models = []
    if ok:
        try:
            models = json.loads(stdout)
            ok = isinstance(models, list)
        except Exception:
            ok = False
    test("search with no keywords returns list", ok, detail=f"count={len(models)}")


# ── Test 5: Image I/O helpers (no server needed) ──────────────────────────────

def test_image_io():
    print("\n--- image I/O (local, no server) ---")
    import numpy as np
    import tempfile
    import os

    # Write and read .npy
    with tempfile.NamedTemporaryFile(suffix=".npy", delete=False) as f:
        tmp_npy = f.name
    arr = np.random.rand(4, 32, 32).astype(np.float32)
    np.save(tmp_npy, arr)

    try:
        sys.path.insert(0, str(Path(__file__).parent.parent))
        from bioengine_cli.utils import read_image, write_image

        loaded = read_image(tmp_npy)
        test(".npy round-trip", np.allclose(arr, loaded), detail=f"shape={loaded.shape}")

        # TIFF
        tmp_tif = tmp_npy.replace(".npy", ".tif")
        write_image(arr[0], tmp_tif)
        loaded_tif = read_image(tmp_tif)
        test(".tif write/read preserves shape", loaded_tif.shape == arr[0].shape,
             detail=f"in={arr[0].shape} out={loaded_tif.shape}")

    except Exception as exc:
        test("image I/O", False, detail=str(exc))
    finally:
        os.unlink(tmp_npy)
        try:
            os.unlink(tmp_tif)
        except Exception:
            pass


# ── Test 6: API connectivity (direct async) ───────────────────────────────────

async def _test_api_direct():
    """Test model-runner API connectivity directly via hypha_rpc."""
    from bioengine_cli.utils import connect_model_runner
    service = await connect_model_runner(SERVER_URL)
    models = await service.search_models(keywords=["cell"], limit=2)
    assert isinstance(models, list), f"Expected list, got {type(models)}"
    assert len(models) > 0, "Expected at least one model"
    return models


def test_api_direct():
    print("\n--- direct API (LIVE) ---")
    try:
        models = asyncio.run(_test_api_direct())
        test("direct hypha_rpc.connect + search_models", True,
             detail=f"returned {len(models)} model(s)")
    except Exception as exc:
        test("direct hypha_rpc.connect + search_models", False, detail=str(exc))


# ── Tests marked UNTESTED_LIVE ────────────────────────────────────────────────
# The following tests require actual image files or GPU worker access
# and are not run automatically. They are documented here for manual verification.

UNTESTED_LIVE = """
UNTESTED_LIVE:
  - bioengine runner infer <model-id> --input image.tif --output result.npy
      Requires: actual image file + model compatible with uploaded array shape
  - bioengine runner test <model-id>
      Not run in CI: takes 2–10 minutes per model
  - bioengine runner validate rdf.yaml
      Requires: a local rdf.yaml file
  - bioengine runner compare model-a model-b --input image.tif
      Requires: actual image file
  - bioengine apps upload / run / status / logs / stop
      Requires: BioEngine worker service ID + auth token
"""


# ── Main ──────────────────────────────────────────────────────────────────────

def main():
    print("=" * 60)
    print("BioEngine CLI — Live Integration Tests")
    print(f"Server: {SERVER_URL}")
    print("=" * 60)

    test_help()
    test_image_io()
    test_api_direct()
    model_id = test_search()
    test_search_no_keywords()

    if model_id:
        test_info(model_id)
    else:
        print(f"\n  [{SKIP}] info test skipped (no model_id from search)")

    print("\n" + "=" * 60)
    print(UNTESTED_LIVE)


if __name__ == "__main__":
    main()
