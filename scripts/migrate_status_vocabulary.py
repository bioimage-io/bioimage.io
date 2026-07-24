#!/usr/bin/env python3
"""Migrate model manifest `status` values to the unified vocabulary.

Unified status vocabulary (workflow state of a model):
  draft        - uploaded, not yet submitted for review
  in-review    - submitted, under review by a reviewer   (was: request-review)
  in-revision  - sent back to the uploader to correct    (was: revision)
  published    - live in the public zoo                  (was: published; accepted collapses here)

Deletion is NOT a status — it lives in a separate `manifest.request_deletion`
field, so it never clobbers the workflow status. The legacy manual
`status: deletion-requested` models are reported separately (they need their
real status restored + the request_deletion field set) and are NOT auto-changed
by this script.

Rename mapping applied by this migration:
  request-review -> in-review
  revision       -> in-revision
  accepted       -> published

Left untouched: `published`, `None` (legacy, grid treats as published), and any
`deletion-requested` (reported for manual reconciliation).

Usage:
  python scripts/migrate_status_vocabulary.py            # dry run (report only)
  python scripts/migrate_status_vocabulary.py --execute  # apply

Safety: models with an active staging session are edited with stage=True so the
staging session is preserved (a non-stage edit finalizes/clears staging, as the
@-permission migration did to affable-shark). Requires BIOIMAGE_IO_TOKEN.
"""
import argparse
import asyncio
from collections import Counter
from hypha_rpc import connect_to_server

COLLECTION_ID = "bioimage-io/bioimage.io"
ENV_PATH = "/data/nmechtel/bioengine/.env"

STATUS_RENAME = {
    "request-review": "in-review",
    "revision": "in-revision",
    "accepted": "published",
}
# Reported but never auto-changed (needs status restore + request_deletion field).
RECONCILE = {"deletion-requested"}


def load_token():
    for line in open(ENV_PATH):
        if line.startswith("BIOIMAGE_IO_TOKEN="):
            return line.split("=", 1)[1].strip().strip('"').strip("'")
    raise SystemExit("BIOIMAGE_IO_TOKEN not found")


async def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--execute", action="store_true", help="apply the status renames")
    args = ap.parse_args()

    server = await connect_to_server({"server_url": "https://hypha.aicell.io", "token": load_token()})
    am = await server.get_service("public/artifact-manager")

    async def list_all(stage):
        r = await am.list(parent_id=COLLECTION_ID, stage=stage, limit=2000, pagination=True)
        return r.get("items", []) if isinstance(r, dict) else r

    committed = await list_all("all")
    staged = await list_all(True)
    ids = {a["id"]: a for a in committed}
    for a in staged:
        ids.setdefault(a["id"], a)

    sem = asyncio.Semaphore(16)
    plan = []          # (id, old, new, staged)
    reconcile = []     # (id, status, staged)

    async def process(aid):
        async with sem:
            try:
                art = await am.read(artifact_id=aid, stage=True)
            except Exception:
                art = await am.read(artifact_id=aid)
            manifest = art.get("manifest") or {}
            status = manifest.get("status")
            has_staging = art.get("staging") is not None
            if status in RECONCILE:
                reconcile.append((aid, status, has_staging))
                return ("reconcile", status)
            new = STATUS_RENAME.get(status)
            if not new:
                return ("unchanged", str(status))
            plan.append((aid, status, new, has_staging))
            if args.execute:
                await am.edit(artifact_id=aid, manifest={**manifest, "status": new}, stage=has_staging)
                return ("migrated", f"{status}->{new}")
            return ("would_migrate", f"{status}->{new}")

    results = await asyncio.gather(*[process(a) for a in ids])
    counts = Counter(r[0] for r in results)
    print("=== STATUS MIGRATION", "(EXECUTE)" if args.execute else "(DRY RUN)", "===")
    print("summary:", dict(counts))
    print("--- renames ---")
    for old, new in [("request-review", "in-review"), ("revision", "in-revision"), ("accepted", "published")]:
        rows = [p for p in plan if p[1] == old]
        staged_n = sum(1 for p in rows if p[3])
        print(f"  {old:16s} -> {new:12s}  {len(rows):3d}  (of which staged: {staged_n})")
        for p in rows[:6]:
            print(f"       {p[0].split('/')[-1]}{' [staged]' if p[3] else ''}")
        if len(rows) > 6:
            print(f"       ... +{len(rows)-6} more")
    print(f"--- deletion-requested (NOT auto-changed; reconcile manually): {len(reconcile)} ---")
    for aid, s, st in reconcile:
        print(f"       {aid.split('/')[-1]}{' [staged]' if st else ''}")


if __name__ == "__main__":
    asyncio.run(main())
