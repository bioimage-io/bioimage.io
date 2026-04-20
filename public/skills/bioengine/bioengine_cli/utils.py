"""
Shared helpers for BioEngine CLI.

- Hypha async connection management (asyncio.run wrapper)
- Image I/O: read/write .tif/.tiff, .png, .npy
- JSON output formatting
- Error formatting
"""
from __future__ import annotations

import asyncio
import json
import os
import sys
from functools import wraps
from io import BytesIO
from pathlib import Path
from typing import Any, Dict, Optional

import click
import httpx
import numpy as np

DEFAULT_SERVER_URL = "https://hypha.aicell.io"
MODEL_RUNNER_SERVICE_ID = "bioimage-io/model-runner"


# ── Async runner ────────────────────────────────────────────────────────────

def run_async(coro):
    """Run an async coroutine from a synchronous Click command."""
    return asyncio.run(coro)


def async_command(f):
    """Decorator: makes a Click command that returns a coroutine work synchronously."""
    @wraps(f)
    def wrapper(*args, **kwargs):
        return asyncio.run(f(*args, **kwargs))
    return wrapper


# ── Connection ───────────────────────────────────────────────────────────────

async def connect_service(server_url: str, service_id: str, token: Optional[str] = None):
    """
    Connect to Hypha and return any service proxy by ID.

    Handles the "Multiple services found" error that occurs when multiple replicas
    of a service are running — falls back to listing services and picking the first match.
    """
    from hypha_rpc import connect_to_server

    connect_kwargs: Dict[str, Any] = {"server_url": server_url}
    if token:
        connect_kwargs["token"] = token

    server = await connect_to_server(connect_kwargs)
    try:
        return await server.get_service(service_id)
    except Exception as exc:
        if "Multiple services found" not in str(exc):
            raise
        # Multiple replicas registered — list and pick the first match
        workspace = service_id.split("/")[0] if "/" in service_id else server.config.workspace
        alias = service_id.split("/", 1)[-1]
        async with httpx.AsyncClient(follow_redirects=True) as client:
            r = await client.get(f"{server_url}/{workspace}/services", timeout=15)
            r.raise_for_status()
            services = r.json()
        matches = [
            f"{workspace}/{s['id']}"
            for s in services
            if alias in s.get("id", "")
        ]
        if not matches:
            raise RuntimeError(f"No service matching '{service_id}' found in workspace '{workspace}'") from exc
        return await server.get_service(matches[0])


async def connect_model_runner(server_url: str, token: Optional[str] = None):
    """Connect to Hypha and return the model-runner service proxy (public, no token required)."""
    return await connect_service(server_url, MODEL_RUNNER_SERVICE_ID, token)


async def connect_worker(server_url: str, worker_service_id: str, token: Optional[str] = None):
    """Connect to Hypha and return the BioEngine worker service proxy."""
    return await connect_service(server_url, worker_service_id, token)


# ── Image I/O ────────────────────────────────────────────────────────────────

def read_image(path: str) -> np.ndarray:
    """
    Read an image file to a numpy array.

    Supported formats:
      .npy / .npz  — numpy binary (preserves exact dtype and shape)
      .tif / .tiff — TIFF via tifffile (supports float32, multi-channel, 3-D)
      .png         — PNG via PIL (uint8)

    Returns:
        numpy array. Shape depends on format; no automatic axis insertion.

    Raises:
        click.ClickException on read failure or unsupported format.
    """
    p = Path(path)
    suffix = p.suffix.lower()

    try:
        if suffix == ".npy":
            return np.load(str(p))
        elif suffix == ".npz":
            data = np.load(str(p))
            keys = list(data.files)
            if len(keys) != 1:
                raise click.ClickException(
                    f"NPZ file has {len(keys)} arrays ({', '.join(keys)}); "
                    "specify which to use by saving as .npy first."
                )
            return data[keys[0]]
        elif suffix in (".tif", ".tiff"):
            import tifffile
            return tifffile.imread(str(p))
        elif suffix == ".png":
            from PIL import Image
            img = Image.open(str(p))
            return np.array(img)
        else:
            raise click.ClickException(
                f"Unsupported input format '{suffix}'. "
                "Supported: .npy, .npz, .tif, .tiff, .png"
            )
    except click.ClickException:
        raise
    except Exception as exc:
        raise click.ClickException(f"Failed to read image '{path}': {exc}") from exc


def write_image(array: np.ndarray, path: str) -> None:
    """
    Write a numpy array to an image file.

    Format is inferred from the output path extension:
      .npy         — numpy binary (default, lossless, recommended)
      .tif / .tiff — TIFF via tifffile
      .png         — PNG via PIL (converts to uint8, clips values)

    Raises:
        click.ClickException on write failure.
    """
    p = Path(path)
    p.parent.mkdir(parents=True, exist_ok=True)
    suffix = p.suffix.lower()

    try:
        if suffix == ".npy":
            np.save(str(p), array)
        elif suffix in (".tif", ".tiff"):
            import tifffile
            tifffile.imwrite(str(p), array)
        elif suffix == ".png":
            from PIL import Image
            if array.dtype != np.uint8:
                # Normalise to uint8
                arr_min, arr_max = array.min(), array.max()
                if arr_max > arr_min:
                    array = ((array - arr_min) / (arr_max - arr_min) * 255).astype(np.uint8)
                else:
                    array = np.zeros_like(array, dtype=np.uint8)
            Image.fromarray(array).save(str(p))
        else:
            raise click.ClickException(
                f"Unsupported output format '{suffix}'. "
                "Supported: .npy, .tif, .tiff, .png"
            )
    except click.ClickException:
        raise
    except Exception as exc:
        raise click.ClickException(f"Failed to write image to '{path}': {exc}") from exc


# ── Upload helper (for infer via HTTP path) ──────────────────────────────────

async def upload_array(service, array: np.ndarray) -> str:
    """
    Upload a numpy array to BioEngine temporary S3 storage.

    Returns the file_path string to pass to service.infer(inputs=...).
    """
    upload_info = await service.get_upload_url(file_type=".npy")
    buf = BytesIO()
    np.save(buf, array)

    async with httpx.AsyncClient() as client:
        resp = await client.put(upload_info["upload_url"], content=buf.getvalue())
        resp.raise_for_status()

    return upload_info["file_path"]


# ── Download helper ───────────────────────────────────────────────────────────

async def download_array(url: str) -> np.ndarray:
    """Download a .npy file from a presigned S3 URL and return as numpy array."""
    async with httpx.AsyncClient(follow_redirects=True) as client:
        resp = await client.get(url)
        resp.raise_for_status()
    return np.load(BytesIO(resp.content))


# ── Output formatting ─────────────────────────────────────────────────────────

def print_json(data: Any) -> None:
    """Print data as pretty-printed JSON to stdout."""
    click.echo(json.dumps(data, indent=2, default=str))


def print_table(rows: list, headers: list) -> None:
    """Print a simple ASCII table."""
    if not rows:
        click.echo("(no results)")
        return
    col_widths = [max(len(str(h)), max(len(str(r[i])) for r in rows))
                  for i, h in enumerate(headers)]
    sep = "  ".join("-" * w for w in col_widths)
    header_line = "  ".join(str(h).ljust(w) for h, w in zip(headers, col_widths))
    click.echo(header_line)
    click.echo(sep)
    for row in rows:
        click.echo("  ".join(str(c).ljust(w) for c, w in zip(row, col_widths)))


def error_exit(msg: str, hint: str = "") -> None:
    """Print a human-readable error and exit with code 1."""
    click.echo(f"Error: {msg}", err=True)
    if hint:
        click.echo(f"Hint:  {hint}", err=True)
    sys.exit(1)


# ── Env helpers ───────────────────────────────────────────────────────────────

def get_server_url(ctx_param: Optional[str]) -> str:
    """Resolve server URL from CLI flag → env var → default."""
    return ctx_param or os.environ.get("BIOENGINE_SERVER_URL", DEFAULT_SERVER_URL)


def get_token(ctx_param: Optional[str]) -> Optional[str]:
    """Resolve auth token from CLI flag → env var."""
    return ctx_param or os.environ.get("HYPHA_TOKEN") or os.environ.get("BIOENGINE_TOKEN")
