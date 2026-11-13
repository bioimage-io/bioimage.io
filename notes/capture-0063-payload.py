#!/usr/bin/env python3
"""myco #0063 clause 1 — capture what a 0.16.96 worker REALLY reports, as a test fixture.

This reads ONE named service, including a service outside workspace `bioimage-io`, and writes
the raw `get_app_status` payload to disk so the dialog can be rendered against bytes that came
off a real worker rather than against a hand-typed mock. (An earlier docstring pointed at a
companion sweep script, `notes/check-0063-live-workers.py`, which is NOT tracked at any commit
on this branch. It was a local probe and is not needed to re-run this one.)

Exit codes follow this lane's convention:
  0 = the service answered, is >= the floor, and its payload was written
  1 = the service answered and is >= the floor but carries no per-deployment field at all
  2 = could not run (no token, service unreachable, payload unreadable, version below floor)
      — deliberately NOT a pass

    set -a; . /data/nmechtel/bioimage.io/.env; set +a
    python3 notes/capture-0063-payload.py '<service_id>' <out.json>
"""
import asyncio
import json
import os
import sys

FIELD = "max_ongoing_requests"
CONTROL_KEYS = {"logs", "message", "replica_states", "replicas", "status"}
FLOOR = (0, 16, 96)


def parse(v):
    try:
        return tuple(int(x) for x in str(v).split(".")[:3])
    except Exception:
        return None


async def main(service_id, out_path):
    token = os.environ.get("HYPHA_TOKEN")
    if not token:
        print("no HYPHA_TOKEN in the environment — see the docstring")
        return 2
    try:
        from hypha_rpc import connect_to_server
    except ImportError:
        print("hypha_rpc is not importable")
        return 2

    api = await connect_to_server({"server_url": "https://hypha.aicell.io", "token": token})
    try:
        w = await api.get_service(service_id)
        status = await w.get_status()
        apps = await w.get_app_status()
    except Exception as exc:  # noqa: BLE001 - reporting is the point
        print(f"could not read {service_id}: {type(exc).__name__}: {str(exc)[:200]}")
        return 2

    version = status.get("bioengine_version")
    v = parse(version)
    print(f"service      {service_id}")
    print(f"version      {version}")
    if v is None or v < FLOOR:
        print(f"below the {'.'.join(map(str, FLOOR))} floor, so this cannot answer clause 1")
        return 2

    present = absent = uncontrolled = 0
    for app_id, entry in (apps or {}).items():
        if not isinstance(entry, dict):
            continue
        print(f"  app {app_id}: top-level {FIELD}={entry.get(FIELD, '<none>')!r}")
        for name, dep in (entry.get("deployments") or {}).items():
            if not isinstance(dep, dict) or not (CONTROL_KEYS & set(dep)):
                uncontrolled += 1
                print(f"    !! {name}: no control key, payload not trusted")
                continue
            if FIELD in dep:
                present += 1
                print(f"    {name}: PRESENT value={dep[FIELD]!r}")
            else:
                absent += 1
                print(f"    {name}: ABSENT")
    print(f"-> present={present} absent={absent} uncontrolled={uncontrolled}")
    if uncontrolled:
        return 2
    if present == 0:
        return 1

    with open(out_path, "w") as fh:
        json.dump({"service_id": service_id, "bioengine_version": version, "app_status": apps},
                  fh, indent=2, sort_keys=True, default=str)
    print(f"wrote {out_path}")
    return 0


if __name__ == "__main__":
    if len(sys.argv) != 3:
        print(__doc__)
        sys.exit(2)
    sys.exit(asyncio.run(main(sys.argv[1], sys.argv[2])))
