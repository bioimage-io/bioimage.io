#!/usr/bin/env python3
"""Print one bioimage.io problem report: its manifest and its attached body.

    python scripts/read_report.py bioimage-io/skill-2026-09-23-bioengine-hello-world-app

Reports are not publicly readable, so BIOIMAGE_IO_TOKEN is required. The manifest
carries structural fields only; everything a human wants is in `report.md`.
"""
import json
import os
import sys
import urllib.error
import urllib.request

AM = "https://hypha.aicell.io/public/services/artifact-manager"


def token() -> str:
    tok = os.environ.get("BIOIMAGE_IO_TOKEN") or os.environ.get("HYPHA_TOKEN")
    if not tok:
        sys.exit("BIOIMAGE_IO_TOKEN is not set. Reports are private.")
    return tok


def fetch(url: str) -> bytes:
    req = urllib.request.Request(url, headers={"Authorization": f"Bearer {token()}"})
    try:
        return urllib.request.urlopen(req, timeout=120).read()
    except urllib.error.HTTPError as exc:
        sys.exit(f"{url} failed: {exc.code} {exc.read().decode()[:200]}")


def main() -> None:
    if len(sys.argv) != 2:
        sys.exit(__doc__)
    artifact_id = sys.argv[1]
    if "/" not in artifact_id:
        artifact_id = f"bioimage-io/{artifact_id}"
    alias = artifact_id.split("/", 1)[1]

    meta = json.loads(fetch(f"{AM}/read?artifact_id={artifact_id}"))
    manifest = meta.get("manifest") or {}
    print(f"artifact    {artifact_id}")
    print(f"type        {meta.get('type')}")
    print(f"created_by  {meta.get('created_by')}")
    print(f"skill       {manifest.get('skill')}")
    print(f"tags        {', '.join(manifest.get('tags') or []) or '(none)'}")
    print(f"reported_at {manifest.get('reported_at')}")
    print()

    files = json.loads(fetch(f"{AM}/list_files?artifact_id={artifact_id}"))
    names = [f.get("name") for f in files] if isinstance(files, list) else []
    if "report.md" not in names:
        print(f"(no report.md; files present: {names or 'none'})")
        return
    body = fetch(f"https://hypha.aicell.io/bioimage-io/artifacts/{alias}/files/report.md")
    print(body.decode("utf-8", "replace"))


if __name__ == "__main__":
    main()
