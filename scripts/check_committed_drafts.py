#!/usr/bin/env python3
"""Detect wrongly committed models in the bioimage.io zoo.

    python scripts/check_committed_drafts.py            # normal daily run
    python scripts/check_committed_drafts.py --dry-run  # report, file nothing

A model that is not published must be a versionless staged artifact: that is the
only thing keeping it out of the public collection index, because the backoffice
indexer never reads the manifest's `status` field. If such a model gains a
committed version anyway, it leaks into the index and the nightly collection CI,
and (as with chatty-koala on 2026-10-05, committed by a collection-wide
permission sweep) can break the whole "check compatibility" run.

This check lists the committed children of `bioimage-io/bioimage.io` and flags
every model whose manifest status is not `published` — including a missing
status, which no committed model should have. New offenders are filed as ONE
svamp issue per run (a sweep accident produces many at once; one issue per model
would be noise).

Dedup guard: `.svamp/committed-draft-check-state.json` records each offender and
its version signature. An unchanged offender is not re-filed; an offender that
got fixed is dropped from the state so a recurrence fires again.

Recovery recipe (what fixed the 2026-10-05 incident): back up the artifact
record, `delete(artifact_id, version=...)` for each wrongly committed version
(workspace-owner token required), then `edit(artifact_id, stage=True)` to put
the model back into the reviewers' staged listing. Staged files survive the
version deletion.

Like sweep_reports.py this uses only the standard library so the bare system
python can run it from the scheduled workflow, and it needs BIOIMAGE_IO_TOKEN.
"""
import argparse
import json
import os
import subprocess
import sys
import urllib.error
import urllib.request
from pathlib import Path

AM = "https://hypha.aicell.io/public/services/artifact-manager"
COLLECTION_ID = "bioimage-io/bioimage.io"
REPO_ROOT = Path(__file__).resolve().parent.parent
STATE = REPO_ROOT / ".svamp" / "committed-draft-check-state.json"


def token() -> str:
    tok = os.environ.get("BIOIMAGE_IO_TOKEN") or os.environ.get("HYPHA_TOKEN")
    if not tok:
        sys.exit("BIOIMAGE_IO_TOKEN is not set; the committed-draft check needs it.")
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


def list_committed() -> list:
    items = []
    while True:
        page = rpc("list", {
            "parent_id": COLLECTION_ID,
            "offset": len(items),
            "limit": 10000,
            "pagination": True,
        })
        items.extend(page["items"])
        if page["total"] <= len(items):
            return items


def signature(item: dict) -> str:
    versions = ",".join(v.get("version") or "?" for v in item.get("versions") or [])
    status = (item.get("manifest") or {}).get("status") or "(missing)"
    return f"{status}@{versions}"


def read_state() -> dict:
    if not STATE.exists():
        return {}
    try:
        return json.loads(STATE.read_text())
    except (ValueError, json.JSONDecodeError):
        return {}


def write_state(state: dict) -> None:
    STATE.parent.mkdir(parents=True, exist_ok=True)
    STATE.write_text(json.dumps(state, indent=2, sort_keys=True) + "\n")


def file_issue(offenders: list) -> bool:
    lines = []
    for item in offenders:
        status = (item.get("manifest") or {}).get("status") or "(missing)"
        versions = ", ".join(v.get("version") or "?" for v in item.get("versions") or [])
        lines.append(f"    {item['id']}    status={status}    committed versions: {versions}")
    listing = "\n".join(lines)
    plural = "models" if len(offenders) > 1 else "model"
    title = f"Wrongly committed {plural} in the zoo: {len(offenders)} unpublished with committed versions"
    body = f"""The daily sweep found {plural} in the bioimage.io collection that are not published but have
committed Hypha versions. An unpublished model must stay a versionless staged artifact; a committed
version leaks it into the public collection index and the nightly collection CI (the indexer never
reads the manifest status). Exactly this broke the "check compatibility" run after the 2026-10-05
permission-sweep incident.

{listing}

Recovery recipe (used for chatty-koala and the six other drafts on 2026-10-08/09, see memory
project_oct5_bulk_commit_sweep):

1. Back up the artifact record and file list.
2. With the workspace-owner token: `delete(artifact_id, version=<v>)` for each committed version.
3. `edit(artifact_id, stage=True)` to put the model back into the reviewers' staged listing.
4. Verify the model left the committed listing and its staged files are intact
   (`list_files(version="stage")`). Staged files survive the version deletion.

If a model here was published on purpose, fix its manifest status to `published` instead and this
check stops flagging it.
"""
    # The verify gate for closing the issue: the check itself reports a clean
    # collection. Reads the token the same way the scheduled workflow does, so
    # the gate works from any session in this repo.
    verify_cmd = (
        'BIOIMAGE_IO_TOKEN="$(grep -m1 ^BIOIMAGE_IO_TOKEN= '
        "/data/nmechtel/bioengine/.env | cut -d= -f2-)\" "
        "/usr/bin/python3 scripts/check_committed_drafts.py --dry-run "
        "| grep -q ' 0 unpublished model'"
    )
    result = subprocess.run(
        ["svamp", "issue", "add", title, "--body", body, "--verify-cmd", verify_cmd],
        capture_output=True, text=True,
    )
    if result.returncode != 0:
        print(f"  FAILED to file issue: {result.stderr.strip()[:200]}")
        return False
    print(f"  filed -> {result.stdout.strip()}")
    return True


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--dry-run", action="store_true", help="report offenders, file nothing")
    args = parser.parse_args()

    items = list_committed()
    offenders = [
        it for it in items
        if it.get("type") == "model"
        and (it.get("manifest") or {}).get("status") != "published"
    ]
    print(f"{len(items)} committed children, {len(offenders)} unpublished model(s) among them")

    state = read_state()
    current = {it["id"]: signature(it) for it in offenders}
    fresh = [it for it in offenders if state.get(it["id"]) != signature(it)]

    for it in offenders:
        marker = "NEW" if it in fresh else "already filed"
        print(f"  {it['id']}  {signature(it)}  [{marker}]")

    if args.dry_run:
        return

    if fresh and not file_issue(fresh):
        # Keep the old state so the failed filing is retried tomorrow.
        return
    # Record the full current offender set; fixed entries drop out so a
    # recurrence is treated as new.
    if current != state:
        write_state(current)


if __name__ == "__main__":
    main()
