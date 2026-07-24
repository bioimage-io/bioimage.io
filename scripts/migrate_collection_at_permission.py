#!/usr/bin/env python3
"""Migrate existing bioimage-io/bioimage.io children so their artifact-level `@`
(authenticated-user) permission no longer grants `put_file`.

Background: tightening the collection-level `@` only governs new uploads. Every
existing child stored `@: "r+"` in its own config.permissions at creation time,
and put_file checks artifact-level permissions first — so the staged-file leak
stays open on existing models until each one is rewritten.

Rewrites `@` -> ["read","get_file","list","list_files","create"] (drops
put_file/add_vectors). Reviewers (rw+) and the collection `*` are untouched.

Usage:
  python scripts/migrate_collection_at_permission.py                # dry run (report only)
  python scripts/migrate_collection_at_permission.py --only <alias> # apply to ONE artifact
  python scripts/migrate_collection_at_permission.py --execute      # apply to ALL leaky children

Requires BIOIMAGE_IO_TOKEN in /data/nmechtel/bioengine/.env (workspace admin).
"""
import argparse
import asyncio
import os
from hypha_rpc import connect_to_server

COLLECTION_ID = "bioimage-io/bioimage.io"
TIGHT = ["read", "get_file", "list", "list_files", "create"]
ENV_PATH = "/data/nmechtel/bioengine/.env"


def grants_put_file(at):
    if at is None:
        return False
    if isinstance(at, str):
        return at in ("r+", "rw", "rw+", "*", "rd+", "lf+")
    if isinstance(at, list):
        return "put_file" in at
    return False


def load_token():
    for line in open(ENV_PATH):
        if line.startswith("BIOIMAGE_IO_TOKEN="):
            return line.split("=", 1)[1].strip().strip('"').strip("'")
    raise SystemExit("BIOIMAGE_IO_TOKEN not found")


async def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--execute", action="store_true", help="apply changes to all leaky children")
    ap.add_argument("--only", help="apply to a single artifact alias/id (implies execute for that one)")
    args = ap.parse_args()

    server = await connect_to_server({"server_url": "https://hypha.aicell.io", "token": load_token()})
    am = await server.get_service("public/artifact-manager")

    async def list_all(stage):
        r = await am.list(parent_id=COLLECTION_ID, stage=stage, limit=2000, pagination=True)
        return r.get("items", []) if isinstance(r, dict) else r

    committed = await list_all("all")
    staged = await list_all(True)
    ids = {}
    for a in committed:
        ids[a["id"]] = a
    for a in staged:
        ids.setdefault(a["id"], a)

    if args.only:
        target = args.only if "/" in args.only else f"bioimage-io/{args.only}"
        ids = {target: ids.get(target, {"id": target})}

    sem = asyncio.Semaphore(16)

    async def process(aid):
        async with sem:
            try:
                art = await am.read(artifact_id=aid, stage=True)
            except Exception:
                art = await am.read(artifact_id=aid)
            config = dict(art.get("config") or {})
            perms = dict(config.get("permissions") or {})
            at = perms.get("@")
            # Never touch a model with an active staging session: a non-stage
            # config edit would finalize/clear its staging (it did to
            # affable-shark). Models with active staging carry no artifact-level
            # `@` anyway, so they already fall back to the tightened collection
            # `@` and aren't leaky. Leave their staging untouched.
            if art.get("staging") is not None:
                return ("skipped_staged", aid, at)
            if not grants_put_file(at):
                return ("clean", aid, at)
            if not (args.execute or args.only):
                return ("would_migrate", aid, at)
            perms["@"] = list(TIGHT)
            config["permissions"] = perms
            await am.edit(artifact_id=aid, config=config)
            # verify
            art2 = await am.read(artifact_id=aid, stage=True)
            new_at = ((art2.get("config") or {}).get("permissions") or {}).get("@")
            ok = not grants_put_file(new_at)
            return ("migrated" if ok else "FAILED", aid, new_at)

    results = await asyncio.gather(*[process(a) for a in ids])
    from collections import Counter
    counts = Counter(r[0] for r in results)
    print("summary:", dict(counts))
    for status in ("FAILED", "migrated", "would_migrate"):
        sample = [r[1].split("/")[-1] for r in results if r[0] == status][:10]
        if sample:
            print(f"  {status}: {sample}{' ...' if counts[status] > 10 else ''}")


if __name__ == "__main__":
    asyncio.run(main())
