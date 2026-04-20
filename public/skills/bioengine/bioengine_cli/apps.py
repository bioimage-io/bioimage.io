"""
bioengine apps — deploy and manage BioEngine Ray Serve applications.

All commands require a BioEngine worker service ID (e.g. 'my-workspace/bioengine-worker')
and a Hypha authentication token. These can be set via CLI flags or environment variables:
  BIOENGINE_WORKER_SERVICE_ID  — worker service ID
  HYPHA_TOKEN or BIOENGINE_TOKEN — auth token

API signatures verified against:
  bioengine-worker/bioengine/worker/worker.py
  bioengine-worker/bioengine/applications/apps_manager.py
  bioengine-worker/scripts/save_application.py
"""
from __future__ import annotations

import asyncio
import json
import sys
from pathlib import Path
from typing import Optional

import click

from bioengine_cli.utils import (
    connect_worker,
    error_exit,
    get_server_url,
    get_token,
    print_json,
    print_table,
)


def _get_worker_service_id(ctx_param: Optional[str]) -> Optional[str]:
    """Resolve worker service ID from CLI flag → env var."""
    import os
    return ctx_param or os.environ.get("BIOENGINE_WORKER_SERVICE_ID")


# ── Shared options ─────────────────────────────────────────────────────────────

_WORKER_OPTIONS = [
    click.option(
        "--worker",
        "worker_service_id",
        envvar="BIOENGINE_WORKER_SERVICE_ID",
        default=None,
        metavar="SERVICE_ID",
        help=(
            "BioEngine worker service ID "
            "(e.g. 'my-workspace/bioengine-worker'). "
            "Can also be set via BIOENGINE_WORKER_SERVICE_ID env var."
        ),
    ),
    click.option(
        "--token",
        envvar=["HYPHA_TOKEN", "BIOENGINE_TOKEN"],
        default=None,
        metavar="TOKEN",
        help="Hypha authentication token. Can also be set via HYPHA_TOKEN env var.",
    ),
    click.option("--server-url", envvar="BIOENGINE_SERVER_URL", default=None, hidden=True),
]


def add_worker_options(f):
    """Decorator to add worker connection options to a command."""
    for opt in reversed(_WORKER_OPTIONS):
        f = opt(f)
    return f


def require_worker(worker_service_id, token, server_url):
    """Validate and resolve required worker connection parameters."""
    server_url = get_server_url(server_url)
    worker_service_id = _get_worker_service_id(worker_service_id)
    token = get_token(token)

    if not worker_service_id:
        error_exit(
            "No BioEngine worker service ID specified.",
            "Pass --worker <service-id> or set BIOENGINE_WORKER_SERVICE_ID. "
            "Example: bioengine apps list --worker my-workspace/bioengine-worker",
        )

    return server_url, worker_service_id, token


# ── Group ─────────────────────────────────────────────────────────────────────

@click.group("apps")
def apps_group():
    """
    Deploy and manage BioEngine Ray Serve applications.

    BioEngine applications are Ray Serve classes packaged as Hypha artifacts.
    They run on BioEngine workers (remote GPU/CPU clusters) and expose services
    for model inference, training, data exploration, or custom processing.

    \b
    Typical workflow:
      bioengine apps upload ./my-app/
      bioengine apps run <artifact-id>
      bioengine apps list
      bioengine apps status <app-id>
      bioengine apps logs <app-id>
      bioengine apps stop <app-id>

    All commands require a BioEngine worker service ID. Set it once:
      export BIOENGINE_WORKER_SERVICE_ID=my-workspace/bioengine-worker
      export HYPHA_TOKEN=<your-token>
    """


# ── upload ─────────────────────────────────────────────────────────────────────

@apps_group.command("upload")
@click.argument("app_dir", metavar="APP_DIR")
@click.option(
    "--public",
    is_flag=True,
    default=False,
    help="Make the uploaded artifact publicly readable (accessible without a token).",
)
@add_worker_options
def upload(app_dir, public, worker_service_id, token, server_url):
    """
    Upload a local BioEngine app directory to Hypha artifact storage.

    APP_DIR must contain a manifest.yaml and at least one Python deployment file.
    Uploads all files in the directory (excluding __pycache__). The artifact ID
    is printed on success — use it with `bioengine apps run`.

    \b
    Expected directory structure:
      my-app/
        manifest.yaml       (required: id, name, type: ray-serve, deployments)
        my_deployment.py    (required: Ray Serve class)
        README.md           (optional)

    \b
    Examples:
      bioengine apps upload ./my-app/
      bioengine apps upload ./my-pipeline/ --public
    """
    server_url, worker_service_id, token = require_worker(worker_service_id, token, server_url)
    app_path = Path(app_dir).resolve()

    if not app_path.is_dir():
        error_exit(f"'{app_dir}' is not a directory.")

    manifest_path = app_path / "manifest.yaml"
    if not manifest_path.exists():
        error_exit(
            f"No manifest.yaml found in '{app_dir}'.",
            "Every BioEngine app must have a manifest.yaml. "
            "See `bioengine apps --help` for the required structure.",
        )

    async def _run():
        # Build file list (name, content, type)
        files = []
        for file_path in sorted(app_path.rglob("*")):
            if not file_path.is_file():
                continue
            if "__pycache__" in str(file_path):
                continue
            rel_name = str(file_path.relative_to(app_path))
            try:
                content = file_path.read_text(encoding="utf-8")
                files.append({"name": rel_name, "content": content, "type": "text"})
            except UnicodeDecodeError:
                import base64
                content = base64.b64encode(file_path.read_bytes()).decode("ascii")
                files.append({"name": rel_name, "content": content, "type": "base64"})

        click.echo(f"Uploading {len(files)} file(s) from '{app_path.name}'...")

        try:
            worker = await connect_worker(server_url, worker_service_id, token)
            artifact_id = await worker.save_application(files=files)
        except Exception as exc:
            error_exit(f"Upload failed: {exc}")

        click.echo(f"Uploaded. Artifact ID: {artifact_id}")
        click.echo(f"\nTo deploy: bioengine apps run {artifact_id}")

    asyncio.run(_run())


# ── run ───────────────────────────────────────────────────────────────────────

@apps_group.command("run")
@click.argument("artifact_id")
@click.option(
    "--app-id",
    "application_id",
    default=None,
    metavar="ID",
    help=(
        "Custom application instance ID. "
        "If omitted, a random unique ID is generated. "
        "Provide the same ID as a running app to update it in-place."
    ),
)
@click.option(
    "--version",
    default=None,
    metavar="VERSION",
    help="Specific artifact version to deploy. Default: latest.",
)
@click.option(
    "--no-gpu",
    "disable_gpu",
    is_flag=True,
    default=False,
    help="Disable GPU usage even if the worker has GPUs available.",
)
@click.option(
    "--env",
    "env_vars",
    multiple=True,
    metavar="KEY=VALUE",
    help=(
        "Environment variable to pass to the deployment "
        "(e.g. --env DEBUG=true). Repeat for multiple variables. "
        "Prefix with _ to mark as secret (hidden in status output). "
        "Note: use --hypha-token to pass HYPHA_TOKEN — --env HYPHA_TOKEN=... is silently ignored."
    ),
)
@click.option(
    "--hypha-token",
    "hypha_token",
    default=None,
    metavar="TOKEN",
    help=(
        "Hypha token to inject into the deployment as the HYPHA_TOKEN environment variable. "
        "Required for apps that connect back to Hypha (artifact access, dataset streaming, etc.). "
        "Defaults to the value of --token / HYPHA_TOKEN if not set. "
        "Pass --hypha-token '' to explicitly deploy without a token."
    ),
)
@add_worker_options
def run_app(artifact_id, application_id, version, disable_gpu, env_vars, hypha_token, worker_service_id, token, server_url):
    """
    Deploy a BioEngine application from artifact storage.

    ARTIFACT_ID is the artifact identifier returned by `bioengine apps upload`
    (e.g. 'my-workspace/my-app'). The app is deployed asynchronously on the
    BioEngine worker; check status with `bioengine apps status <app-id>`.

    Apps that connect back to Hypha (to access artifacts, datasets, or other
    services) need HYPHA_TOKEN set inside the Ray actor. Pass --hypha-token to
    inject it. If omitted, the auth token (--token / HYPHA_TOKEN env var) is
    used automatically.

    \b
    Examples:
      bioengine apps run my-workspace/my-app
      bioengine apps run my-workspace/my-app --app-id production-v1
      bioengine apps run my-workspace/my-app --no-gpu --env DEBUG=true
      bioengine apps run my-workspace/my-app --hypha-token $HYPHA_TOKEN
    """
    server_url, worker_service_id, token = require_worker(worker_service_id, token, server_url)

    # Default hypha_token to the auth token unless explicitly set to empty string
    if hypha_token is None:
        hypha_token = token

    # Parse KEY=VALUE env vars
    parsed_env: dict = {}
    for kv in env_vars:
        if "=" not in kv:
            error_exit(f"Invalid --env value '{kv}': must be KEY=VALUE format.")
        k, v = kv.split("=", 1)
        parsed_env[k] = v

    async def _run():
        try:
            worker = await connect_worker(server_url, worker_service_id, token)
            run_kwargs = {
                "artifact_id": artifact_id,
                "disable_gpu": disable_gpu,
                "hypha_token": hypha_token or None,
            }
            if application_id:
                run_kwargs["application_id"] = application_id
            if version:
                run_kwargs["version"] = version
            if parsed_env:
                run_kwargs["application_env_vars"] = {"*": parsed_env}

            deployed_id = await worker.run_application(**run_kwargs)
        except Exception as exc:
            error_exit(f"Deployment failed: {exc}")

        click.echo(f"Deployment started. Application ID: {deployed_id}")
        click.echo(f"\nCheck status:  bioengine apps status {deployed_id}")
        click.echo(f"View logs:     bioengine apps logs {deployed_id}")
        click.echo(f"Stop:          bioengine apps stop {deployed_id}")

    asyncio.run(_run())


# ── list ──────────────────────────────────────────────────────────────────────

@apps_group.command("list")
@click.option("--json", "as_json", is_flag=True, help="Output as JSON.")
@add_worker_options
def list_apps(as_json, worker_service_id, token, server_url):
    """
    List all available BioEngine application artifacts in the current workspace.

    Shows artifacts that have been uploaded (via `bioengine apps upload`) but
    not necessarily deployed. Use `bioengine apps status` to see running apps.

    \b
    Examples:
      bioengine apps list
      bioengine apps list --json
    """
    server_url, worker_service_id, token = require_worker(worker_service_id, token, server_url)

    async def _run():
        try:
            worker = await connect_worker(server_url, worker_service_id, token)
            result = await worker.list_applications()
        except Exception as exc:
            error_exit(f"Failed to list applications: {exc}")

        if as_json:
            print_json(result)
            return

        # result is Dict[str, List[str]]: {artifact_id: [files...]} or similar
        if isinstance(result, dict):
            artifacts = list(result.keys())
        elif isinstance(result, list):
            artifacts = result
        else:
            artifacts = [str(result)]

        if not artifacts:
            click.echo("No application artifacts found in this workspace.")
            return

        click.echo(f"\n{len(artifacts)} artifact(s):\n")
        for art_id in artifacts:
            click.echo(f"  {art_id}")

        click.echo(f"\nDeploy one:  bioengine apps run <artifact-id>")

    asyncio.run(_run())


# ── status ────────────────────────────────────────────────────────────────────

@apps_group.command("status")
@click.argument("app_ids", nargs=-1, metavar="APP_ID...")
@click.option(
    "--logs", "logs_tail",
    default=30,
    show_default=True,
    metavar="N",
    help="Number of log lines to show per replica. Use -1 for all.",
)
@click.option("--json", "as_json", is_flag=True, help="Output full status as JSON.")
@add_worker_options
def status(app_ids, logs_tail, as_json, worker_service_id, token, server_url):
    """
    Show status of deployed BioEngine applications.

    If APP_ID(s) are given, show status for those specific deployments.
    If no APP_ID is given, show status for all running deployments.

    \b
    Examples:
      bioengine apps status
      bioengine apps status my-app-id-123
      bioengine apps status app-a app-b --json
    """
    server_url, worker_service_id, token = require_worker(worker_service_id, token, server_url)

    async def _run():
        try:
            worker = await connect_worker(server_url, worker_service_id, token)
            ids = list(app_ids) if app_ids else None
            result = await worker.get_application_status(
                application_ids=ids,
                logs_tail=logs_tail,
            )
        except Exception as exc:
            error_exit(f"Failed to get application status: {exc}")

        if as_json:
            print_json(result)
            return

        _print_status(result)

    asyncio.run(_run())


def _print_status(result) -> None:
    """Pretty-print application status."""
    if not result:
        click.echo("No running applications.")
        return

    # If a single app was queried, result may be a single dict
    if isinstance(result, dict) and "status" in result:
        result = {"single": result}

    if isinstance(result, dict):
        for app_id, app_info in result.items():
            _print_single_status(app_id, app_info)
    else:
        click.echo(str(result))


def _print_single_status(app_id: str, info: dict) -> None:
    click.echo(f"\n{'─'*60}")
    click.echo(f"  Application: {app_id}")
    click.echo(f"  Status:      {info.get('status', 'unknown')}")

    artifact = info.get("artifact_id", info.get("artifact", ""))
    if artifact:
        click.echo(f"  Artifact:    {artifact}")

    deployments = info.get("deployments", {})
    if deployments:
        click.echo(f"  Deployments:")
        for dep_name, dep_info in deployments.items():
            dep_status = dep_info.get("status", "?") if isinstance(dep_info, dict) else dep_info
            click.echo(f"    [{dep_name}]  {dep_status}")

    logs = info.get("logs", "")
    if logs:
        click.echo(f"\n  Recent logs:")
        for line in str(logs).split("\n")[-10:]:
            if line.strip():
                click.echo(f"    {line}")


# ── logs ──────────────────────────────────────────────────────────────────────

@apps_group.command("logs")
@click.argument("app_id")
@click.option(
    "--tail", "-n",
    default=100,
    show_default=True,
    metavar="N",
    help="Number of log lines to retrieve. Use -1 for all available logs.",
)
@click.option("--json", "as_json", is_flag=True, help="Output as JSON.")
@add_worker_options
def logs(app_id, tail, as_json, worker_service_id, token, server_url):
    """
    Show logs for a deployed BioEngine application.

    APP_ID is the application instance ID returned when the app was deployed.

    \b
    Examples:
      bioengine apps logs my-app-id-123
      bioengine apps logs my-app-id-123 --tail 200
    """
    server_url, worker_service_id, token = require_worker(worker_service_id, token, server_url)

    async def _run():
        try:
            worker = await connect_worker(server_url, worker_service_id, token)
            result = await worker.get_application_status(
                application_ids=[app_id],
                logs_tail=tail,
            )
        except Exception as exc:
            error_exit(f"Failed to get logs for '{app_id}': {exc}")

        if as_json:
            print_json(result)
            return

        # Extract and print logs from status result
        if isinstance(result, dict):
            # Single-app result may be nested
            app_info = result.get(app_id, result)
            _print_logs(app_id, app_info)
        else:
            click.echo(str(result))

    asyncio.run(_run())


def _print_logs(app_id: str, info: dict) -> None:
    click.echo(f"Logs for '{app_id}':")
    deployments = info.get("deployments", {})
    if deployments:
        for dep_name, dep_info in deployments.items():
            click.echo(f"\n--- {dep_name} ---")
            if isinstance(dep_info, dict):
                replicas = dep_info.get("replicas", [dep_info])
                for replica in replicas:
                    logs = replica.get("logs", "") if isinstance(replica, dict) else ""
                    if logs:
                        click.echo(logs)
    else:
        logs = info.get("logs", "No logs available.")
        click.echo(logs)


# ── stop ──────────────────────────────────────────────────────────────────────

@apps_group.command("stop")
@click.argument("app_id")
@click.option(
    "--yes", "-y",
    is_flag=True,
    default=False,
    help="Skip confirmation prompt.",
)
@add_worker_options
def stop(app_id, yes, worker_service_id, token, server_url):
    """
    Stop and remove a deployed BioEngine application.

    APP_ID is the application instance ID. This operation is irreversible —
    the running application will be stopped and its resources released.
    The artifact in storage is NOT deleted.

    \b
    Examples:
      bioengine apps stop my-app-id-123
      bioengine apps stop my-app-id-123 --yes
    """
    server_url, worker_service_id, token = require_worker(worker_service_id, token, server_url)

    if not yes:
        click.confirm(f"Stop application '{app_id}'?", abort=True)

    async def _run():
        try:
            worker = await connect_worker(server_url, worker_service_id, token)
            await worker.stop_application(application_id=app_id)
        except Exception as exc:
            error_exit(f"Failed to stop application '{app_id}': {exc}")

        click.echo(f"Application '{app_id}' stopped.")

    asyncio.run(_run())


# ── deploy (combined upload + run convenience command) ─────────────────────────

@apps_group.command("deploy")
@click.argument("app_dir", metavar="APP_DIR")
@click.option(
    "--app-id",
    "application_id",
    default=None,
    metavar="ID",
    help="Custom application instance ID. Default: auto-generated.",
)
@click.option("--no-gpu", "disable_gpu", is_flag=True, default=False)
@click.option(
    "--env",
    "env_vars",
    multiple=True,
    metavar="KEY=VALUE",
    help=(
        "Environment variable for the deployment (repeat for multiple). "
        "Note: use --hypha-token to pass HYPHA_TOKEN — --env HYPHA_TOKEN=... is silently ignored."
    ),
)
@click.option(
    "--hypha-token",
    "hypha_token",
    default=None,
    metavar="TOKEN",
    help=(
        "Hypha token to inject into the deployment as the HYPHA_TOKEN environment variable. "
        "Required for apps that connect back to Hypha (artifact access, dataset streaming, etc.). "
        "Defaults to the value of --token / HYPHA_TOKEN if not set. "
        "Pass --hypha-token '' to explicitly deploy without a token."
    ),
)
@add_worker_options
def deploy(app_dir, application_id, disable_gpu, env_vars, hypha_token, worker_service_id, token, server_url):
    """
    Upload and immediately deploy a local BioEngine app directory.

    Combines `bioengine apps upload` and `bioengine apps run` into one step.
    APP_DIR must contain a manifest.yaml and at least one Python deployment file.

    Apps that connect back to Hypha (to access artifacts, datasets, or other
    services) need HYPHA_TOKEN set inside the Ray actor. Pass --hypha-token to
    inject it. If omitted, the auth token (--token / HYPHA_TOKEN env var) is
    used automatically.

    \b
    Examples:
      bioengine apps deploy ./my-app/
      bioengine apps deploy ./my-pipeline/ --app-id pipeline-v1 --no-gpu
      bioengine apps deploy ./my-app/ --hypha-token $HYPHA_TOKEN
    """
    server_url, worker_service_id, token = require_worker(worker_service_id, token, server_url)
    app_path = Path(app_dir).resolve()

    if not app_path.is_dir():
        error_exit(f"'{app_dir}' is not a directory.")

    manifest_path = app_path / "manifest.yaml"
    if not manifest_path.exists():
        error_exit(
            f"No manifest.yaml found in '{app_dir}'.",
            "Every BioEngine app must have a manifest.yaml.",
        )

    # Default hypha_token to the auth token unless explicitly set to empty string
    if hypha_token is None:
        hypha_token = token

    parsed_env: dict = {}
    for kv in env_vars:
        if "=" not in kv:
            error_exit(f"Invalid --env value '{kv}': must be KEY=VALUE format.")
        k, v = kv.split("=", 1)
        parsed_env[k] = v

    async def _run():
        # Upload
        files = []
        for file_path in sorted(app_path.rglob("*")):
            if not file_path.is_file():
                continue
            if "__pycache__" in str(file_path):
                continue
            rel_name = str(file_path.relative_to(app_path))
            try:
                content = file_path.read_text(encoding="utf-8")
                files.append({"name": rel_name, "content": content, "type": "text"})
            except UnicodeDecodeError:
                import base64
                content = base64.b64encode(file_path.read_bytes()).decode("ascii")
                files.append({"name": rel_name, "content": content, "type": "base64"})

        click.echo(f"Uploading {len(files)} file(s) from '{app_path.name}'...")
        try:
            worker = await connect_worker(server_url, worker_service_id, token)
            artifact_id = await worker.save_application(files=files)
        except Exception as exc:
            error_exit(f"Upload failed: {exc}")

        click.echo(f"Uploaded. Artifact ID: {artifact_id}")

        # Deploy
        click.echo(f"Deploying '{artifact_id}'...")
        run_kwargs = {
            "artifact_id": artifact_id,
            "disable_gpu": disable_gpu,
            "hypha_token": hypha_token or None,
        }
        if application_id:
            run_kwargs["application_id"] = application_id
        if parsed_env:
            run_kwargs["application_env_vars"] = {"*": parsed_env}

        try:
            deployed_id = await worker.run_application(**run_kwargs)
        except Exception as exc:
            error_exit(f"Deployment failed (artifact was uploaded): {exc}")

        click.echo(f"Deployment started. Application ID: {deployed_id}")
        click.echo(f"\nCheck status:  bioengine apps status {deployed_id}")
        click.echo(f"View logs:     bioengine apps logs {deployed_id}")
        click.echo(f"Stop:          bioengine apps stop {deployed_id}")

    asyncio.run(_run())
