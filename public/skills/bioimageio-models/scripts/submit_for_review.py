#!/usr/bin/env python3
"""
submit_for_review.py — Submit a staged model for curator review.

Usage:
    export HYPHA_TOKEN=...            # from `python hypha_login.py`
    python submit_for_review.py <artifact_id>
    python submit_for_review.py bioimage-io/affable-shark --token <hypha_token>

What it does:
  1. Reads the staged artifact's current manifest.
  2. Flips `status` -> "in-review" in a single STAGED edit. No commit, no
     permission changes: reviewer access was already granted at upload time
     (upload_model.py sets config.permissions on create), so the model stays
     staged/versionless and reviewers can already edit it.

What it must NOT do (guardrails):
  - Never `am.commit(...)` your own model. Publishing is the curator's action
    after review, and it is what mints the citable DOI. Self-publishing bypasses
    quality review and wastes reviewer time.
  - Never set status to "published" yourself.
  - Only valid statuses are: draft, in-review, in-revision, published.

If a curator sends the model back as `in-revision`: fix the package, re-upload
the changed files, then run this script again to return it to `in-review`.
"""
import argparse
import asyncio
import os
import sys

SERVER_URL = "https://hypha.aicell.io"
VALID_PRIOR_STATUSES = {"draft", "in-revision"}


async def submit_for_review(artifact_id: str, token: str) -> None:
    from hypha_rpc import connect_to_server

    async with connect_to_server({
        "server_url": SERVER_URL,
        "token": token,
        "method_timeout": 120,
    }) as server:
        am = await server.get_service("public/artifact-manager")

        # Read the CURRENT staged manifest so we preserve any edits and only
        # touch `status`. (Reading from Hypha, not from a local rdf.yaml, avoids
        # clobbering server-side manifest fields like id/id_emoji.)
        artifact = await am.read(artifact_id=artifact_id, stage=True)
        manifest = dict(artifact.get("manifest") or {})
        current = manifest.get("status")

        if current == "in-review":
            print(f"{artifact_id} is already in-review — nothing to do.")
            return
        if current == "published":
            print(f"Refusing: {artifact_id} is already published. Do not re-submit a published model.", file=sys.stderr)
            sys.exit(1)
        if current not in VALID_PRIOR_STATUSES:
            print(f"Warning: unexpected current status {current!r}; proceeding to set in-review.")

        # One staged edit: flip status to in-review. No commit, no permissions.
        await am.edit(
            artifact_id=artifact_id,
            stage=True,  # use stage=True, NOT version="stage" (causes PermissionError)
            manifest={**manifest, "status": "in-review"},
        )
        print(f"Review requested for {artifact_id} (status: {current} -> in-review)")
        print(f"Track: https://bioimage.io/#/upload?artifact_id={artifact_id}&stage=true")


def main() -> None:
    parser = argparse.ArgumentParser(description="Submit a staged model for curator review.")
    parser.add_argument("artifact_id", help="Full artifact id, e.g. bioimage-io/affable-shark")
    parser.add_argument(
        "--token",
        default=os.environ.get("HYPHA_TOKEN"),
        help="Hypha token (default: $HYPHA_TOKEN). Get one with hypha_login.py.",
    )
    args = parser.parse_args()
    if not args.token:
        print("No Hypha token. Set $HYPHA_TOKEN (run hypha_login.py) or pass --token.", file=sys.stderr)
        sys.exit(1)
    asyncio.run(submit_for_review(args.artifact_id, args.token))


if __name__ == "__main__":
    main()
