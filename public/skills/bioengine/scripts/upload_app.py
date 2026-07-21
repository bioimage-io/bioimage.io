#!/usr/bin/env python3
"""Upload a BioEngine app the right way: whole-folder, version-bump enforced,
with a dev-iteration workflow that keeps the release namespace clean.

Why this exists
---------------
A committed artifact version is IMMUTABLE and its content is what a deploy
runs. Never let a version string point at two different bundles over time
(don't delete+recreate a version to change code, and don't deploy a *staged*
version). Iterate on throwaway pre-releases, publish the verified bundle once.

Workflow
--------
  # iterate — each call uploads <version>-dev<N+1> and deploys <app>-dev
  python upload_app.py ./my-app --worker <worker_service_id> --dev
  # ... test the -dev deployment, fix, repeat ...

  # publish — upload the SAME folder as the clean release <version>,
  # then delete the throwaway -dev* pre-releases
  python upload_app.py ./my-app --worker <worker_service_id> --release

`<version>` is read from manifest.yaml; the local manifest is never modified
(the version is rewritten only in the uploaded copy).
"""
import argparse
import asyncio
import os
import re
import sys

import yaml
from hypha_rpc import connect_to_server
from packaging.version import Version

# Requires `pip install bioengine` for the whole-folder packer (handles text +
# binary, applies the same excludes the worker uses).
from bioengine.utils import create_file_list_from_directory

SERVER_URL = os.environ.get("HYPHA_SERVER_URL", "https://hypha.aicell.io")


def _read_manifest(directory: str) -> dict:
    with open(os.path.join(directory, "manifest.yaml")) as f:
        return yaml.safe_load(f)


def _set_files_version(files: list, version: str) -> list:
    """Rewrite manifest.yaml's version in the in-memory file list only."""
    out = []
    for f in files:
        if f["name"] in ("manifest.yaml", "manifest.yml") and f.get("type") == "text":
            m = yaml.safe_load(f["content"])
            m["version"] = version
            f = {**f, "content": yaml.safe_dump(m, sort_keys=False)}
        out.append(f)
    return out


async def _existing_versions(server, artifact_id: str) -> list:
    am = await server.get_service("public/artifact-manager")
    try:
        art = await am.read(artifact_id=artifact_id)
    except Exception:
        return []
    return [v["version"] for v in (art.get("versions") or [])]


async def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("directory")
    ap.add_argument("--worker", required=True, help="worker service id (…:bioengine-worker)")
    ap.add_argument("--token", default=os.environ.get("HYPHA_TOKEN"))
    ap.add_argument("--app-id", help="application_id (defaults to the manifest id)")
    ap.add_argument("--disable-gpu", action="store_true", help="deploy the -dev instance CPU-only")
    mode = ap.add_mutually_exclusive_group(required=True)
    mode.add_argument("--dev", action="store_true", help="upload next <version>-devN + deploy <app>-dev")
    mode.add_argument("--release", action="store_true", help="upload clean <version> + delete -dev* pre-releases")
    args = ap.parse_args()

    manifest = _read_manifest(args.directory)
    base = str(manifest["version"])          # target release, e.g. 0.1.2
    app_id = args.app_id or manifest["id"]

    server = await connect_to_server({"server_url": SERVER_URL, "token": args.token})
    worker = await server.get_service(args.worker)
    workspace = server.config.workspace
    artifact_id = f"{workspace}/{manifest['id']}"

    files = [f for f in create_file_list_from_directory(directory_path=args.directory)
             if "__pycache__" not in f.get("name", "")]
    existing = await _existing_versions(server, artifact_id)

    if args.dev:
        dev_re = re.compile(rf"^{re.escape(base)}[-.]dev(\d+)$")
        n = max([int(dev_re.match(v).group(1)) for v in existing if dev_re.match(v)] or [0]) + 1
        version = f"{base}-dev{n}"
        await worker.upload_app(files=_set_files_version(files, version))
        await worker.deploy_app(artifact_id=artifact_id, application_id=f"{app_id}-dev",
                                version=version, disable_gpu=args.disable_gpu, hypha_token=args.token)
        print(f"uploaded + deployed {artifact_id}@{version} as application_id={app_id}-dev")
        print(f"  test it, then when good:  python {sys.argv[0]} {args.directory} --worker {args.worker} --release")
    else:  # --release
        if base in existing:
            sys.exit(f"ERROR: {base} already exists — bump manifest.yaml version for the next release.")
        await worker.upload_app(files=_set_files_version(files, base))
        print(f"published release {artifact_id}@{base}")
        # Drop the throwaway pre-releases (they have no consumers; never delete
        # a released version). Prefer the worker API — worker.delete_app_version
        # only permits versions tagged '…dev…' — and fall back to the artifact
        # manager for workers that predate that method.
        dev_re = re.compile(rf"^{re.escape(base)}[-.]dev\d+$")
        am = None
        for v in [v for v in existing if dev_re.match(v)]:
            try:
                try:
                    await worker.delete_app_version(artifact_id=artifact_id, version=v)
                except Exception:
                    if am is None:
                        am = await server.get_service("public/artifact-manager")
                    await am.delete(artifact_id=artifact_id, version=v)
                print(f"  deleted pre-release {v}")
            except Exception as e:
                print(f"  could not delete {v}: {str(e)[:80]}")
        try:
            await worker.stop_app(application_id=f"{app_id}-dev")
            print(f"  stopped {app_id}-dev")
        except Exception:
            pass
        print(f"deploy the release:  worker.deploy_app('{artifact_id}', application_id='{app_id}', version='{base}')")


if __name__ == "__main__":
    asyncio.run(main())
