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

  # publish — delete the throwaway -dev* pre-releases, THEN upload the
  # SAME folder as the clean release <version> (deleting after publishing
  # would re-point the release at a dev bundle)
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


class VersionReadFailed(Exception):
    """The artifact's version list could not be read, so it is NOT known to be empty."""


def _is_missing_artifact(exc: Exception) -> bool:
    """True only when the server positively said this artifact does not exist.

    The not-found case is an ordinary first release, so it must return "no versions".
    Everything else -- a timeout, a dropped connection, an expired token -- must NOT,
    because "I could not find out" and "there is nothing there" lead to opposite actions.

    Matched on the message because the server raises a plain KeyError across RPC, so
    there is no type to catch. Measured against the live artifact manager: a missing
    artifact ends with

        KeyError: "Artifact with ID '<ws>/<alias>' does not exist. Note: ..."

    Both markers are required, and anything unrecognised is treated as a FAILURE rather
    than as absence. That is the safe direction: if the server reworded this tomorrow,
    a first release stops with an error a human can read, instead of silently publishing
    over pre-releases it never tried to delete.
    """
    text = str(exc)
    return "KeyError" in text and "does not exist" in text


async def _existing_versions(server, artifact_id: str) -> list:
    """The artifact's released versions, or [] if the artifact does not exist yet.

    Raises VersionReadFailed if the list could not be read. Never conflate the two:
    the caller uses this to decide whether a version is already published, how to
    number the next pre-release, and which pre-releases to delete before publishing.
    An empty list switches all three of those guards off at once.
    """
    am = await server.get_service("public/artifact-manager")
    try:
        art = await am.read(artifact_id=artifact_id)
    except Exception as e:  # noqa: BLE001 - re-raised below unless it is a clean 404
        if _is_missing_artifact(e):
            return []
        raise VersionReadFailed(
            f"could not read the existing versions of {artifact_id}, so it is not known "
            f"whether pre-releases are waiting to be cleaned up. Nothing was uploaded.\n"
            f"  {e!r}"
        ) from e
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
    mode.add_argument("--release", action="store_true", help="delete -dev* pre-releases + upload clean <version>")
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
    # Stop here rather than proceeding on an assumed-empty list. Both paths below
    # read `existing` as authoritative: --release checks it to refuse republishing a
    # version and to find the pre-releases to delete, and --dev numbers the next
    # pre-release from it. A wrong empty switches all three off at once.
    try:
        existing = await _existing_versions(server, artifact_id)
    except VersionReadFailed as e:
        sys.exit(f"ERROR: {e}")

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
        # Drop the throwaway pre-releases BEFORE publishing. Deleting a version
        # re-points every later version at the preceding slot's payload, so
        # deleting afterwards makes the release silently serve the dev bundle.
        # The pre-releases are the newest versions here, so nothing follows
        # them to shift — and going newest-first keeps that true for each one
        # in turn, which is also what worker.delete_app_version now enforces.
        # Prefer the worker API — it only permits versions tagged '…dev…'. Decide
        # up front whether this worker has it; workers before 0.16.53 do not.
        # Catching the call instead would also catch the guard's refusal and fall
        # through to the unguarded artifact-manager delete, performing exactly the
        # corrupting delete the guard exists to prevent, and printing success.
        dev_re = re.compile(rf"^{re.escape(base)}[-.]dev\d+$")
        delete_version = getattr(worker, "delete_app_version", None)
        am = None
        # At most one, because the loop below stops at the first failure. A list here
        # would be dead generality, and a plural message would misdescribe the state.
        failed: "tuple[str, str] | None" = None
        for v in reversed([v for v in existing if dev_re.match(v)]):
            try:
                if delete_version is not None:
                    await delete_version(artifact_id=artifact_id, version=v)
                else:
                    if am is None:
                        am = await server.get_service("public/artifact-manager")
                    await am.delete(artifact_id=artifact_id, version=v)
                print(f"  deleted pre-release {v}")
            except Exception as e:
                failed = (v, repr(e))
                # STOP. Do not go on to older pre-releases. The loop walks newest-first, so
                # once this delete has failed, `v` still exists and every remaining candidate
                # now has a successor. Deleting one of those is the corrupting delete the
                # comment below says is unsafe: it re-points `v` at the preceding slot's
                # payload. Continuing would also make the abort message a lie, because it
                # says nothing was published and implies the state is retryable, while an
                # older version had already been destroyed under a surviving successor.
                break
        if failed:
            # Abort rather than publish. This is the ONLY moment these deletes are
            # safe: the pre-releases are the newest versions, so nothing follows them
            # to shift. Publish first and each one acquires a successor, after which
            # deleting it re-points that successor at the preceding slot's payload --
            # so the guard then refuses forever and the pre-releases are stuck in the
            # version list for good. Publishing over a failed cleanup trades a
            # retryable error now for an unfixable one later.
            #
            # Printed once, here, and not also at the point of failure. A remote error
            # arrives as a traceback the transport has already truncated mid-frame, so
            # the full repr is what distinguishes a permissions problem from a missing
            # version, and printing it twice only buries it.
            stopped_at, err = failed
            print(f"\nERROR: refusing to publish the release: pre-release {stopped_at} "
                  f"could not be deleted.\n  {err}", file=sys.stderr)
            sys.exit("Nothing was published. Fix the cause above and re-run --release; "
                     "the deletes are only safe while these are still the newest versions.")
        await worker.upload_app(files=_set_files_version(files, base))
        print(f"published release {artifact_id}@{base}")
        try:
            await worker.stop_app(application_id=f"{app_id}-dev")
            print(f"  stopped {app_id}-dev")
        except Exception:
            pass
        print(f"deploy the release:  worker.deploy_app('{artifact_id}', application_id='{app_id}', version='{base}')")


if __name__ == "__main__":
    asyncio.run(main())
