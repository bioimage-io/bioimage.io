"""
bioengine cluster — inspect BioEngine Ray cluster resources.

Examples:
  bioengine cluster status
  bioengine cluster status --json
"""
from __future__ import annotations

import asyncio

import click

from bioengine_cli.utils import (
    connect_worker,
    error_exit,
    get_server_url,
    get_token,
    print_json,
)

_WORKER_OPTIONS = [
    click.option(
        "--worker",
        "worker_service_id",
        envvar="BIOENGINE_WORKER_SERVICE_ID",
        default=None,
        metavar="SERVICE_ID",
        help="BioEngine worker service ID (or BIOENGINE_WORKER_SERVICE_ID env var).",
    ),
    click.option(
        "--token",
        envvar=["HYPHA_TOKEN", "BIOENGINE_TOKEN"],
        default=None,
        metavar="TOKEN",
        help="Hypha auth token (or HYPHA_TOKEN env var).",
    ),
    click.option("--server-url", envvar="BIOENGINE_SERVER_URL", default=None, hidden=True),
]


def add_worker_options(f):
    for opt in reversed(_WORKER_OPTIONS):
        f = opt(f)
    return f


@click.group("cluster")
def cluster_group():
    """Inspect BioEngine Ray cluster resources (GPUs, CPUs, memory)."""


@cluster_group.command("status")
@click.option("--json", "as_json", is_flag=True, help="Output as JSON.")
@add_worker_options
def cluster_status(as_json, worker_service_id, token, server_url):
    """
    Show GPU and CPU usage across the Ray cluster.

    Reports total and used resources at cluster level and per node,
    including GPU VRAM. Useful before deploying GPU-heavy applications.

    \b
    Examples:
      bioengine cluster status
      bioengine cluster status --json
    """
    server_url = get_server_url(server_url)
    token = get_token(token)

    if not worker_service_id:
        error_exit(
            "No worker service ID specified.",
            "Pass --worker <service-id> or set BIOENGINE_WORKER_SERVICE_ID.",
        )

    async def _run():
        try:
            worker = await connect_worker(server_url, worker_service_id, token)
            status = await worker.get_status()
        except Exception as exc:
            error_exit(f"Failed to get cluster status: {exc}")

        ray = status.get("ray_cluster", {})
        cluster = ray.get("cluster", {})
        nodes = ray.get("nodes", {})

        if as_json:
            print_json({
                "cluster": cluster,
                "nodes": {
                    nid: {k: v for k, v in info.items()}
                    for nid, info in nodes.items()
                },
            })
            return

        # Human-readable summary
        click.echo(
            f"\nCluster: {cluster.get('used_cpu', 0):.0f}/{cluster.get('total_cpu', 0):.0f} CPUs, "
            f"{cluster.get('used_gpu', 0):.1f}/{cluster.get('total_gpu', 0):.0f} GPUs"
        )
        click.echo("")

        gpu_nodes = [(nid, info) for nid, info in nodes.items() if info.get("total_gpu", 0) > 0]
        cpu_only = [(nid, info) for nid, info in nodes.items() if info.get("total_gpu", 0) == 0]

        if gpu_nodes:
            click.echo("GPU nodes:")
            for nid, info in gpu_nodes:
                vram_used_gb = info.get("used_gpu_memory", 0) / 1024**3
                vram_total_gb = info.get("total_gpu_memory", 0) / 1024**3
                role = "HEAD" if info.get("head") else "worker"
                click.echo(
                    f"  {info.get('node_ip')} [{role}] "
                    f"{info.get('accelerator_type', '?')} "
                    f"GPU: {info.get('used_gpu', 0):.1f}/{info.get('total_gpu', 0):.0f} "
                    f"VRAM: {vram_used_gb:.1f}/{vram_total_gb:.1f} GiB  "
                    f"CPU: {info.get('used_cpu', 0):.0f}/{info.get('total_cpu', 0):.0f}"
                )

        if cpu_only:
            click.echo("\nCPU-only nodes:")
            for nid, info in cpu_only:
                role = "HEAD" if info.get("head") else "worker"
                click.echo(
                    f"  {info.get('node_ip')} [{role}] "
                    f"CPU: {info.get('used_cpu', 0):.0f}/{info.get('total_cpu', 0):.0f}"
                )

    asyncio.run(_run())
