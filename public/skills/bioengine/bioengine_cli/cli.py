"""
BioEngine CLI — main entry point.

Usage:
  bioengine call <service-id> <method> [--args '{"key": "val"}']
  bioengine apps deploy ./my-app/
  bioengine apps status
  bioengine cluster status

Environment variables:
  BIOENGINE_SERVER_URL          Hypha server URL (default: https://hypha.aicell.io)
  BIOENGINE_WORKER_SERVICE_ID   BioEngine worker service ID (for apps + cluster commands)
  HYPHA_TOKEN / BIOENGINE_TOKEN Authentication token
"""
import click

from bioengine_cli import __version__
from bioengine_cli.call import call_command
from bioengine_cli.cluster import cluster_group
from bioengine_cli.apps import apps_group


@click.group()
@click.version_option(version=__version__, prog_name="bioengine")
def main():
    """
    BioEngine — deploy and call AI model services on remote GPU clusters.

    \b
    Call any deployed service:
      bioengine call <service-id> <method>
      bioengine call bioimage-io/model-runner --list-methods
      bioengine call bioimage-io/model-runner ping --json

    \b
    Deploy and manage apps:
      bioengine apps deploy ./my-app/
      bioengine apps status
      bioengine apps logs <app-id>
      bioengine apps stop <app-id>

    \b
    Inspect cluster resources:
      bioengine cluster status

    \b
    Environment variables:
      BIOENGINE_SERVER_URL          Server URL (default: https://hypha.aicell.io)
      BIOENGINE_WORKER_SERVICE_ID   Worker service ID (for apps + cluster)
      HYPHA_TOKEN                   Auth token

    Run `bioengine <command> --help` for details on each command.
    """


main.add_command(call_command)
main.add_command(apps_group)
main.add_command(cluster_group)


if __name__ == "__main__":
    main()
