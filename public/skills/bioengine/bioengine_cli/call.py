"""
bioengine call — call any method on any BioEngine service.

Connects to a Hypha service by ID and invokes a method with JSON arguments.
Designed for AI agent use: JSON output by default, structured errors.

Examples:
  bioengine call bioimage-io/model-runner ping
  bioengine call bioimage-io/model-runner search --args '{"keywords": ["nucleus"]}'
  bioengine call bioimage-io/my-app process --arg text=hello --arg max_length=100
  bioengine call bioimage-io/my-app --list-methods
"""
from __future__ import annotations

import asyncio
import json
import sys
from typing import Optional

import click

from bioengine_cli.utils import (
    connect_service,
    error_exit,
    get_server_url,
    get_token,
    print_json,
)


def _parse_value(s: str):
    """Auto-type a KEY=VALUE string value: try int, float, bool, else string."""
    if s.lower() == "true":
        return True
    if s.lower() == "false":
        return False
    try:
        return int(s)
    except ValueError:
        pass
    try:
        return float(s)
    except ValueError:
        pass
    return s


@click.command("call")
@click.argument("service_id")
@click.argument("method", required=False, default=None)
@click.option(
    "--args",
    "args_json",
    default=None,
    metavar="JSON",
    help=(
        "Method arguments as a JSON object, e.g. '{\"key\": \"value\", \"n\": 10}'. "
        "Merged with any --arg flags (--arg takes precedence)."
    ),
)
@click.option(
    "--arg",
    "arg_pairs",
    multiple=True,
    metavar="KEY=VALUE",
    help=(
        "Individual argument. Values are auto-typed: integers, floats, booleans, "
        "or strings. Repeat for multiple arguments. "
        "Use --args for complex types (lists, dicts)."
    ),
)
@click.option(
    "--list-methods",
    "list_methods",
    is_flag=True,
    default=False,
    help="List available methods on the service instead of calling one.",
)
@click.option(
    "--json",
    "as_json",
    is_flag=True,
    default=False,
    help="Output result as JSON (automatically enabled when stdout is not a TTY).",
)
@click.option(
    "--token",
    envvar=["HYPHA_TOKEN", "BIOENGINE_TOKEN"],
    default=None,
    metavar="TOKEN",
    help="Hypha auth token. Can also be set via HYPHA_TOKEN env var.",
)
@click.option("--server-url", envvar="BIOENGINE_SERVER_URL", default=None, hidden=True)
def call_command(service_id, method, args_json, arg_pairs, list_methods, as_json, token, server_url):
    """
    Call any method on any deployed BioEngine service.

    SERVICE_ID is the Hypha service identifier, e.g. 'bioimage-io/model-runner'
    or 'my-workspace/my-app'. METHOD is the name of the method to call.

    Use --list-methods to discover available methods without calling one.

    \b
    Arguments are passed as a JSON object via --args, or as individual
    KEY=VALUE pairs via --arg (auto-typed: int, float, bool, or string):
      --args '{"keywords": ["nucleus"], "limit": 5}'
      --arg keywords=nucleus --arg limit=5

    \b
    Examples:
      bioengine call bioimage-io/model-runner ping
      bioengine call bioimage-io/model-runner --list-methods
      bioengine call bioimage-io/model-runner search --args '{"keywords": ["nucleus"]}'
      bioengine call bioimage-io/my-app process --arg text=hello --arg max_length=100
    """
    server_url = get_server_url(server_url)
    token = get_token(token)
    force_json = as_json or not sys.stdout.isatty()

    async def _run():
        try:
            svc = await connect_service(server_url, service_id, token)
        except Exception as exc:
            error_exit(f"Could not connect to service '{service_id}': {exc}",
                       "Check the service ID and make sure the service is running.")

        if list_methods:
            # Discover available methods from service info
            methods = []
            for attr in dir(svc):
                if not attr.startswith("_"):
                    obj = getattr(svc, attr, None)
                    if callable(obj):
                        methods.append(attr)
            if force_json:
                print_json({"service_id": service_id, "methods": methods})
            else:
                click.echo(f"Methods on '{service_id}':")
                for m in methods:
                    click.echo(f"  {m}")
            return

        if not method:
            error_exit(
                "No method specified.",
                "Pass a method name or use --list-methods to see available methods.",
            )

        # Build kwargs
        kwargs = {}
        if args_json:
            try:
                kwargs = json.loads(args_json)
            except json.JSONDecodeError as e:
                error_exit(f"Invalid JSON in --args: {e}",
                           "Wrap the JSON in single quotes and use double quotes inside.")

        for kv in arg_pairs:
            if "=" not in kv:
                error_exit(f"Invalid --arg '{kv}': must be KEY=VALUE format.")
            k, v = kv.split("=", 1)
            kwargs[k] = _parse_value(v)

        fn = getattr(svc, method, None)
        if fn is None:
            error_exit(
                f"Method '{method}' not found on service '{service_id}'.",
                "Use --list-methods to see available methods.",
            )

        try:
            if kwargs:
                result = await fn(**kwargs)
            else:
                result = await fn()
        except Exception as exc:
            error_exit(f"Call to '{method}' failed: {exc}")

        if force_json or isinstance(result, (dict, list)):
            print_json(result)
        else:
            click.echo(str(result))

    asyncio.run(_run())
