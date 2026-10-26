#!/usr/bin/env python3
"""Self-contained live probe for myco #0014/#0017/#0018/#0019.

Depends on NOTHING in this repo: it talks straight to the Hypha artifact-manager
HTTP API, so its verdict is a fact about the live collection and is unaffected by
which commits any local tree carries. That is what makes it honest to cite with
`myco issue close --evidence-env live`. It matters here because the real
phantom-card check (`scripts/check_published_model_reports.py`) is deliberately
git-excluded and therefore exists on no branch at all.

It asserts the two claims those four archived issues rest on:

  1. no unpublished artifact in bioimage-io/bioimage.io has a committed version
     (the #0014 / #0017 claim), and
  2. every test report typed `published-model` maps to a published model
     (the #0018 / #0019 claim),

and additionally that the four SYNTHETIC ids those issues named do not exist,
which is the specific thing "seeded test exhaust" predicts.

The set logic in check 2 MIRRORS check_published_model_reports.main() exactly:
same two REST listings, same `stage=false`, same HIDDEN_STATUSES, same
`test-report-` prefix strip, same direction of the set difference. A first
hand-rolled version of this probe got that wrong (compared report manifest ids
against model aliases) and reported 46 phantoms where the real check reports 0 --
recorded here because a probe that mismatches is the failure mode this file
exists to avoid.

Exit 0 only if every assertion holds. Check 1 needs BIOIMAGE_IO_TOKEN; check 2
and the id check are public.
"""
import json
import os
import sys
import urllib.error
import urllib.parse
import urllib.request

SERVER = "https://hypha.aicell.io"
AM = f"{SERVER}/public/services/artifact-manager"
BASE = f"{SERVER}/bioimage-io/artifacts"
ZOO = "bioimage-io/bioimage.io"
PUBLISHED = "published"
# Model statuses that are NOT part of the public zoo even when committed.
HIDDEN_STATUSES = {"draft", "in-review", "in-revision"}

# The ids the four issues named. All were minted by the end-to-end filing tests.
SYNTHETIC = [
    "seeded-test-artifact-0007",
    "seeded-test-model-nostatus-0007",
    "test-report-seeded-phantom-0015",
    "seeded-phantom-0015",
]


def _get(url):
    with urllib.request.urlopen(url, timeout=60) as resp:
        return json.load(resp)


def _children_rest(collection, filters, stage=None):
    """The listing shape check_published_model_reports.py uses. Public."""
    f = urllib.parse.quote(json.dumps(filters))
    url = f"{BASE}/{collection}/children?pagination=true&limit=5000&filters={f}"
    if stage is not None:
        url += f"&stage={'true' if stage else 'false'}"
    return _get(url).get("items", [])


def _alias(item):
    return (item.get("id") or "").split("/").pop()


def _rpc(method, params):
    """The authed RPC listing check_committed_drafts.py uses."""
    tok = os.environ.get("BIOIMAGE_IO_TOKEN") or os.environ.get("HYPHA_TOKEN")
    if not tok:
        sys.exit("BIOIMAGE_IO_TOKEN is not set")
    req = urllib.request.Request(
        f"{AM}/{method}",
        data=json.dumps(params).encode(),
        headers={"Content-Type": "application/json", "Authorization": f"Bearer {tok}"},
    )
    try:
        return json.loads(urllib.request.urlopen(req, timeout=120).read())
    except urllib.error.HTTPError as exc:
        sys.exit(f"{method} failed: {exc.read().decode()[:300]}")


def zoo_committed():
    items = []
    while True:
        page = _rpc(
            "list",
            {"parent_id": ZOO, "offset": len(items), "limit": 10000, "pagination": True},
        )
        items.extend(page["items"])
        if page["total"] <= len(items):
            return items


def status_of(item):
    return ((item.get("manifest") or {}).get("status") or "").strip()


def main():
    failures = []

    # --- claim 1: no unpublished artifact carries a committed version ---------
    # Mirrors check_committed_drafts.is_offender(): present-and-not-published for
    # any type, plus a model carrying no status at all.
    zoo = zoo_committed()
    offenders = [
        i
        for i in zoo
        if (status_of(i) != PUBLISHED if status_of(i) else i.get("type") == "model")
    ]
    print(f"[1] zoo committed children: {len(zoo)} | unpublished among them: {len(offenders)}")
    for o in offenders:
        print(f"      OFFENDER {_alias(o)} status={status_of(o) or '(missing)'}")
    if offenders:
        failures.append(f"{len(offenders)} unpublished artifact(s) with committed versions")

    # --- claim 2: every published-model report maps to a published model ------
    reports = _children_rest("test-reports", {"type": "published-model"})
    report_model_ids = {
        _alias(r).replace("test-report-", "") for r in reports if _alias(r)
    }
    models = _children_rest("bioimage.io", {"type": "model"}, stage=False)
    published_model_ids = {
        _alias(m)
        for m in models
        if (m.get("manifest") or {}).get("status") not in HIDDEN_STATUSES
    }
    phantom = sorted(report_model_ids - published_model_ids)
    print(
        f"[2] published-model reports: {len(report_model_ids)} | published models: "
        f"{len(published_model_ids)} | phantoms: {len(phantom)}"
    )
    for p in phantom:
        print(f"      PHANTOM test-report-{p} (model {p} has no published version)")
    if phantom:
        failures.append(f"{len(phantom)} phantom published-model report(s)")

    # --- the exhaust claim: those four ids are not real ----------------------
    live_ids = {_alias(i) for i in zoo} | {_alias(r) for r in reports} | report_model_ids
    present = [s for s in SYNTHETIC if s in live_ids]
    print(f"[3] synthetic ids checked: {len(SYNTHETIC)} | present in the collection: {len(present)}")
    for s in present:
        print(f"      UNEXPECTEDLY REAL {s}")
    if present:
        failures.append(f"{len(present)} supposedly-synthetic id(s) actually exist")

    if failures:
        print("\nFAIL: " + "; ".join(failures))
        return 1
    print("\nOK: collection clean on both invariants, and all 4 named ids are synthetic")
    return 0


if __name__ == "__main__":
    sys.exit(main())
