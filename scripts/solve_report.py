#!/usr/bin/env python3
"""Mark a bioimage.io problem report as addressed.

    python scripts/solve_report.py bioimage-io/skill-2026-09-23-bioengine-hello-world-app

Flips the artifact type from `skill-issue` to `skill-issue-solved` (or the website
equivalent). The report is NOT deleted: it stays readable to maintainers as the
record of what was wrong. The type is what the daily sweep uses to decide a report
is no longer open, so this is what stops it being re-filed if the watermark is ever
lost. Requires BIOIMAGE_IO_TOKEN.
"""
import json
import os
import sys
import urllib.error
import urllib.request

AM = "https://hypha.aicell.io/public/services/artifact-manager"
SOLVED = {"skill-issue": "skill-issue-solved", "website-issue": "website-issue-solved"}


def token() -> str:
    tok = os.environ.get("BIOIMAGE_IO_TOKEN") or os.environ.get("HYPHA_TOKEN")
    if not tok:
        sys.exit("BIOIMAGE_IO_TOKEN is not set.")
    return tok


def rpc(method: str, params: dict) -> object:
    req = urllib.request.Request(
        f"{AM}/{method}",
        data=json.dumps(params).encode(),
        headers={"Content-Type": "application/json", "Authorization": f"Bearer {token()}"},
    )
    try:
        return json.loads(urllib.request.urlopen(req, timeout=120).read())
    except urllib.error.HTTPError as exc:
        sys.exit(f"{method} failed: {exc.read().decode()[:300]}")


def main() -> None:
    if len(sys.argv) != 2:
        sys.exit(__doc__)
    artifact_id = sys.argv[1]
    if "/" not in artifact_id:
        artifact_id = f"bioimage-io/{artifact_id}"

    current = rpc("read", {"artifact_id": artifact_id})
    kind = current.get("type") if isinstance(current, dict) else None
    if kind in SOLVED.values():
        print(f"{artifact_id} is already {kind}; nothing to do.")
        return
    if kind not in SOLVED:
        sys.exit(f"{artifact_id} has type {kind!r}, which is not a report type. Refusing to change it.")

    rpc("edit", {"artifact_id": artifact_id, "type": SOLVED[kind]})
    after = rpc("read", {"artifact_id": artifact_id})
    print(f"{artifact_id}: {kind} -> {after.get('type') if isinstance(after, dict) else '?'}")


if __name__ == "__main__":
    main()
