#!/usr/bin/env python3
"""File new bioimage.io problem reports into the svamp backlog.

    python scripts/sweep_reports.py            # normal daily run
    python scripts/sweep_reports.py --dry-run  # show what would be filed
    python scripts/sweep_reports.py --since 0  # ignore the watermark, list everything

Reads `bioimage-io/issues` (created in svamp #0044) and files one svamp issue per
unseen report. The report artifact stays put and remains the source of truth; the
svamp issue is just the work item pointing at it.

Two independent guards stop a report being filed twice, which is the part most
easily got wrong:

  the watermark   `.svamp/report-sweep-watermark.json`, the created_at of the
                  newest report filed so far.
  the type        a handled report has its type flipped to `*-solved`, so it is
                  skipped regardless of the watermark. This means losing the
                  watermark file re-files only reports nobody has dealt with,
                  not the entire history.

Deliberately uses plain urllib against the artifact-manager HTTP endpoint rather
than hypha_rpc: a cron job should not depend on a virtualenv being present and
importable, and this module has no third-party imports at all.

Reports are NOT publicly readable, so BIOIMAGE_IO_TOKEN is required.
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
COLLECTION_ID = "bioimage-io/issues"
# Anchored to the repo root via __file__, NOT the working directory. A
# scheduled run does not start in the repo, and a CWD-relative path there
# reads as "no watermark", which re-files every open report on every run.
# That is not hypothetical: it happened on the first scheduled sweep and
# duplicated an issue that had already been filed by hand.
REPO_ROOT = Path(__file__).resolve().parent.parent
WATERMARK = REPO_ROOT / ".svamp" / "report-sweep-watermark.json"
OPEN_TYPES = ("skill-issue", "website-issue")


def token() -> str:
    tok = os.environ.get("BIOIMAGE_IO_TOKEN") or os.environ.get("HYPHA_TOKEN")
    if not tok:
        sys.exit("BIOIMAGE_IO_TOKEN is not set. Reports are private; the sweep cannot read them.")
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


def read_watermark() -> float:
    if not WATERMARK.exists():
        return 0.0
    try:
        return float(json.loads(WATERMARK.read_text()).get("last_created_at", 0))
    except (ValueError, json.JSONDecodeError):
        # A corrupt watermark must not wedge the sweep. The type guard above
        # still prevents re-filing anything already dealt with.
        return 0.0


def write_watermark(value: float) -> None:
    WATERMARK.parent.mkdir(parents=True, exist_ok=True)
    WATERMARK.write_text(json.dumps({"last_created_at": value}, indent=2) + "\n")


def created_at(report: dict) -> float:
    return float(report.get("created_at") or 0)


def file_issue(report: dict) -> bool:
    artifact_id = report.get("id") or f"bioimage-io/{report.get('alias')}"
    manifest = report.get("manifest") or {}
    kind = "Skill" if report.get("type") == "skill-issue" else "Website"
    subject = manifest.get("skill") or "bioimage.io"
    title = f"{kind} problem report: {subject}"
    body = f"""A user filed a problem report on bioimage.io. Nobody has looked at it yet.

The report itself lives in Hypha and is not readable without a token, because it can carry a log
buffer the reporter did not mean to publish. Read it with:

    python scripts/read_report.py {artifact_id}

When it has been dealt with, mark it so the daily sweep stops considering it open:

    python scripts/solve_report.py {artifact_id}

---

    artifact     {artifact_id}
    type         {report.get('type')}
    skill        {manifest.get('skill')}
    tags         {', '.join(manifest.get('tags') or []) or '(none)'}
    reported_at  {manifest.get('reported_at')}

The manifest carries structural fields only. The description, the steps and any logs are in the
attached `report.md`, which is why reading it takes the command above rather than a glance here.
"""
    result = subprocess.run(
        ["svamp", "issue", "add", title, "--body", body],
        capture_output=True, text=True,
    )
    if result.returncode != 0:
        print(f"  FAILED to file {artifact_id}: {result.stderr.strip()[:200]}")
        return False
    print(f"  filed {artifact_id} -> {result.stdout.strip()}")
    return True


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--dry-run", action="store_true", help="list what would be filed, file nothing")
    parser.add_argument("--since", type=float, default=None,
                        help="override the watermark (epoch seconds; 0 means everything)")
    args = parser.parse_args()

    since = args.since if args.since is not None else read_watermark()
    reports = rpc("list", {"parent_id": COLLECTION_ID, "limit": 1000, "order_by": "-created_at"})
    if not isinstance(reports, list):
        sys.exit(f"unexpected list response: {str(reports)[:200]}")

    # Both guards. `type` is the durable one: it survives the watermark file.
    open_reports = [r for r in reports if r.get("type") in OPEN_TYPES]
    fresh = sorted((r for r in open_reports if created_at(r) > since), key=created_at)

    print(f"{len(reports)} reports, {len(open_reports)} open, "
          f"{len(fresh)} open and newer than watermark {since:.0f}")

    if not fresh:
        return
    if args.dry_run:
        for r in fresh:
            print(f"- {r.get('id') or r.get('alias')} created_at={created_at(r):.0f} type={r.get('type')}")
        return

    filed = sum(1 for r in fresh if file_issue(r))
    if filed == len(fresh):
        write_watermark(created_at(fresh[-1]))
        print(f"Filed {filed}; watermark now {created_at(fresh[-1]):.0f}")
    else:
        # Leave the watermark alone so the ones that failed are retried tomorrow.
        print(f"Filed {filed}/{len(fresh)}; watermark left at {since:.0f} so the rest are retried.")


if __name__ == "__main__":
    main()
