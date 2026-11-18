#!/usr/bin/env python3
"""Verify the live collection manifest carries each partner's declared tags.

The partner filter matches a model by declared link OR declared tag. The tag
half reads `tags` from each entry in the live collection manifest's
config.partners, falling back to the partner id when absent. The repo config
(bioimageio_collection_config.json) declares tags for all 13 partners, but if
those never reach the published manifest the filter silently runs on the id
fallback instead, which only works where id == tag.

Exit 0 when every live partner carries tags, 1 otherwise.
"""
import json
import sys
import urllib.request

URL = "https://hypha.aicell.io/bioimage-io/artifacts/bioimage.io"

try:
    with urllib.request.urlopen(URL, timeout=60) as r:
        coll = json.load(r)
except Exception as exc:  # unreachable registry must not read as a pass
    print(f"could not read the collection manifest: {exc}")
    sys.exit(2)

partners = ((coll.get("manifest") or {}).get("config") or {}).get("partners") or []
if not partners:
    print("no partners in the live manifest")
    sys.exit(1)

missing = [str(p.get("id")) for p in partners if not p.get("tags")]
print(f"live partners: {len(partners)}, missing tags: {len(missing)}")
if missing:
    print("  " + ", ".join(missing))
    sys.exit(1)
print("every partner carries declared tags")
