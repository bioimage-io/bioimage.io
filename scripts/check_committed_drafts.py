#!/usr/bin/env python3
"""Detect wrongly committed artifacts in the bioimage.io zoo.

    python scripts/check_committed_drafts.py            # normal daily run
    python scripts/check_committed_drafts.py --dry-run  # report, file nothing

An artifact that is not published must be a versionless staged artifact: that is
the only thing keeping it out of the public collection index, because the
backoffice indexer never reads the manifest's `status` field. If it gains a
committed version anyway, it leaks into the index and the nightly collection CI,
and (as with chatty-koala on 2026-10-05, committed by a collection-wide
permission sweep) can break the whole "check compatibility" run. The commonest
route in is an owner committing their own artifact programmatically instead of
waiting for a reviewer to accept it on the website.

## What counts as an offender

This check lists the committed children of `bioimage-io/bioimage.io` and flags:

  * any artifact, of any type, whose manifest status is PRESENT and is not
    `published` — i.e. `draft`, `in-review`, `in-revision`, the legacy
    `deletion-requested`, or anything outside the vocabulary; and
  * any committed MODEL carrying no status at all, because every model that
    reaches the committed listing has been through the review workflow and
    should have been stamped by it.

A missing status on a non-model is NOT an offender. That asymmetry is measured,
not stylistic: on 2026-10-24 the 287 committed children were 167 models (all
`published`), 4 datasets `published`, and 116 artifacts with no status field at
all (65 applications, 46 datasets, 4 notebooks, 1 tracking). Those 116 predate
the status field, `migrate_status_vocabulary.py` documents a missing status as
legacy and grid-equivalent to published, and flagging them would bury every real
finding under 116 false positives on the first run.

New offenders are filed as ONE myco issue per run, plus a notification: a sweep
accident produces many at once and one issue per artifact would be noise.

Dedup guard: `.mycolab/committed-draft-check-state.json` records each offender
and its version signature. An unchanged offender is not re-filed; an offender
that got fixed is dropped from the state so a recurrence fires again.

Recovery recipe (what fixed the 2026-10-05 incident): back up the artifact
record, `delete(artifact_id, version=...)` for each wrongly committed version
(workspace-owner token required), then `edit(artifact_id, stage=True)` to put
the artifact back into the reviewers' staged listing. Staged files survive the
version deletion.

Like sweep_reports.py this uses only the standard library so the bare system
python can run it from the scheduled workflow, and it needs BIOIMAGE_IO_TOKEN.
"""
import argparse
import json
import os
import sys
import urllib.error
import urllib.request
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import _myco_backlog  # noqa: E402  (path shim above must run first)

AM = "https://hypha.aicell.io/public/services/artifact-manager"
COLLECTION_ID = "bioimage-io/bioimage.io"
REPO_ROOT = Path(__file__).resolve().parent.parent
STATE = REPO_ROOT / ".mycolab" / "committed-draft-check-state.json"
# Where the state lived before the 2026-10-24 move from svamp to myco. Read once
# if the new path is absent, so the move does not re-file every known offender.
LEGACY_STATE = REPO_ROOT / ".svamp" / "committed-draft-check-state.json"
PUBLISHED = "published"


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
    """Every committed child of the collection, paged.

    Two guards, because this runs unattended from a daily workflow and both
    failure modes are silent. `sweep_reports.py` already guards the shape the
    same way; this function did not.

    1. A response that is not the paginated shape exits instead of raising a
       KeyError inside a scheduled run.
    2. A page that comes back EMPTY while `total` still exceeds what we hold
       would otherwise re-request the same offset forever, because the offset
       is derived from len(items) and len(items) stops growing. That is a hang,
       not a crash, so nothing would ever alarm.
    """
    items = []
    while True:
        page = rpc("list", {
            "parent_id": COLLECTION_ID,
            "offset": len(items),
            "limit": 10000,
            "pagination": True,
        })
        if not isinstance(page, dict) or "items" not in page or "total" not in page:
            sys.exit(f"unexpected list response: {str(page)[:200]}")
        batch = page["items"]
        if not batch:
            if page["total"] > len(items):
                print(f"  WARNING: the listing stopped early at {len(items)} of "
                      f"{page['total']} committed children; checking what arrived.",
                      file=sys.stderr)
            return items
        items.extend(batch)
        if page["total"] <= len(items):
            return items


def status_of(item: dict) -> str:
    return ((item.get("manifest") or {}).get("status") or "").strip()


def is_offender(item: dict) -> bool:
    """See the module docstring. Present-and-not-published, any type; plus a
    model with no status at all."""
    status = status_of(item)
    if status:
        return status != PUBLISHED
    return item.get("type") == "model"


def signature(item: dict) -> str:
    versions = ",".join(v.get("version") or "?" for v in item.get("versions") or [])
    return f"{status_of(item) or '(missing)'}@{versions}"


def read_state() -> dict:
    path = STATE if STATE.exists() else LEGACY_STATE
    if not path.exists():
        return {}
    try:
        return json.loads(path.read_text())
    except (ValueError, json.JSONDecodeError):
        return {}


def write_state(state: dict) -> None:
    STATE.parent.mkdir(parents=True, exist_ok=True)
    STATE.write_text(json.dumps(state, indent=2, sort_keys=True) + "\n")


def file_issue(offenders: list) -> bool:
    lines = []
    for item in offenders:
        status = status_of(item) or "(missing)"
        versions = ", ".join(v.get("version") or "?" for v in item.get("versions") or [])
        kind = item.get("type") or "?"
        lines.append(f"    {item['id']}    type={kind}    status={status}    "
                     f"committed versions: {versions}")
    listing = "\n".join(lines)
    plural = "artifacts" if len(offenders) > 1 else "artifact"
    title = (f"Wrongly committed {plural} in the zoo: {len(offenders)} unpublished "
             "with committed versions")
    body = f"""The daily sweep found {plural} in the bioimage.io collection that are not published but have
committed Hypha versions. An unpublished artifact must stay a versionless staged artifact; a
committed version leaks it into the public collection index and the nightly collection CI (the
indexer never reads the manifest status). Exactly this broke the "check compatibility" run after
the 2026-10-05 permission-sweep incident.

The usual cause is the artifact's owner committing it programmatically instead of waiting for a
reviewer to accept it on the website, so check who committed before assuming a sweep did it.

{listing}

A `status` of `(missing)` above is only ever reported for a model. Applications, datasets and
notebooks predating the status field are legacy and are deliberately not flagged.

Recovery recipe (used for chatty-koala and the six other drafts on 2026-10-08/09, see memory
project_oct5_bulk_commit_sweep):

1. Back up the artifact record and file list.
2. With the workspace-owner token: `delete(artifact_id, version=<v>)` for each committed version.
3. `edit(artifact_id, stage=True)` to put the artifact back into the reviewers' staged listing.
4. Verify it left the committed listing and its staged files are intact
   (`list_files(version="stage")`). Staged files survive the version deletion.

Deleting a version is destructive and not reversible from here, so get Nils's approval before
step 2 unless the artifact is a known-bad duplicate.

If an artifact here was published on purpose, fix its manifest status to `published` instead and
this check stops flagging it.
"""
    # The verify gate for closing the issue: the check itself reports a clean
    # collection. Prefers a BIOIMAGE_IO_TOKEN already in the environment and
    # falls back to a dotenv file named by BIOIMAGE_IO_ENV_FILE, so the gate
    # works from any session in this repo.
    #
    # The dotenv PATH is deliberately not written here. This file is tracked and
    # reaches GitHub (and Copilot, via .github/copilot-instructions.md), and
    # where a machine keeps its secrets is not something a public repo should
    # say. Same reasoning as the session id in _myco_backlog.py: the value is
    # machine-local, so it belongs in the gitignored workflow yaml.
    verify_cmd = (
        'BIOIMAGE_IO_TOKEN="${BIOIMAGE_IO_TOKEN:-$(grep -m1 ^BIOIMAGE_IO_TOKEN= '
        '"$BIOIMAGE_IO_ENV_FILE" | cut -d= -f2-)}" '
        "/usr/bin/python3 scripts/check_committed_drafts.py --dry-run "
        "| grep -q ' 0 unpublished artifact'"
    )
    filed = _myco_backlog.file_issue(
        title, body,
        labels=("collection", "reports", "automation"),
        verify_cmd=verify_cmd,
    )
    if not filed:
        return False
    print(f"  filed -> {filed}")
    ids = ", ".join(it["id"].split("/")[-1] for it in offenders[:5])
    if len(offenders) > 5:
        ids += f", and {len(offenders) - 5} more"
    _myco_backlog.notify(
        f"Zoo sweep: {len(offenders)} unpublished {plural} have committed versions ({ids}). "
        "Filed as a myco issue; deleting a committed version needs your approval.",
        level="warning",
    )
    return True


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--dry-run", action="store_true", help="report offenders, file nothing")
    args = parser.parse_args()

    items = list_committed()
    offenders = [it for it in items if is_offender(it)]
    print(f"{len(items)} committed children, "
          f"{len(offenders)} unpublished artifact(s) among them")

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
