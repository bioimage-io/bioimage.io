"""Create a throwaway colab annotation dataset for verifying issue #0035.

Mirrors exactly what the app does: `public/colab_service.py:_ensure_artifact_exists`
(artifact create under bioimage-io/colab-annotations, type=dataset, stage=True,
config.permissions {user_id: '*'}) and `_upload_image` (put_file into `images/`,
then a plain PUT of PNG bytes). Then the two broker calls the UI makes,
`register_dataset` and `create_label`.

The artifact is left STAGED and is never committed: the broker hard-asserts on
staging in `get_save_urls`, so committing it would break the save path (this is
the self-inflicted breakage the 2026-10-25 reviewer documented).

Prints the artifact id, label and image stem so the Playwright run can use them.
"""

import asyncio
import io
import json
import os
import sys

import numpy as np
from PIL import Image
from hypha_rpc import connect_to_server

SERVER_URL = os.environ.get("HYPHA_SERVER_URL", "https://hypha.aicell.io")
COLLECTION_ID = "bioimage-io/colab-annotations"
BROKER_ID = "bioimage-io/annotation-broker"


def synthetic_cells(w=512, h=512, n=12, seed=7):
    """A deterministic blob image, bright enough not to trip the low-contrast path."""
    rng = np.random.default_rng(seed)
    img = np.full((h, w, 3), 24, dtype=np.float64)
    yy, xx = np.mgrid[0:h, 0:w]
    for _ in range(n):
        cx, cy = rng.integers(60, w - 60), rng.integers(60, h - 60)
        r = rng.integers(28, 46)
        d2 = (xx - cx) ** 2 + (yy - cy) ** 2
        blob = np.exp(-d2 / (2 * (r / 1.7) ** 2))
        img[..., 0] += blob * 150
        img[..., 1] += blob * 205
        img[..., 2] += blob * 120
    return np.clip(img, 0, 255).astype(np.uint8)


async def main():
    token = os.environ.get("HYPHA_TOKEN")
    if not token:
        sys.exit("HYPHA_TOKEN is not set")

    alias = os.environ.get("FIXTURE_ALIAS", "verify35-nonce")
    label = os.environ.get("FIXTURE_LABEL", "cells")
    stem = "verify35_cells"
    artifact_id = f"bioimage-io/{alias}"

    server = await connect_to_server({"server_url": SERVER_URL, "token": token})
    user = server.config.user
    user_id = getattr(user, "id", None) or user.get("id")
    user_email = getattr(user, "email", None) or (user.get("email") if hasattr(user, "get") else None)
    print(f"connected as {user_id} ({user_email})", flush=True)

    am = await server.get_service("public/artifact-manager")

    manifest = {"name": f"verify #0035 {alias}", "description": "throwaway fixture, delete after use"}
    if user_id:
        manifest["created_by"] = user_id
        manifest["owner"] = {"id": user_id, "email": user_email}
    create_kwargs = {
        "parent_id": COLLECTION_ID,
        "alias": alias,
        "manifest": manifest,
        "type": "dataset",
        "stage": True,
    }
    if user_id and user_id.strip().lower() != "anonymous":
        create_kwargs["config"] = {"permissions": {user_id: "*"}}
    try:
        await am.create(**create_kwargs)
        print(f"created staged artifact {artifact_id}", flush=True)
    except Exception as exc:
        # Re-running against the same alias after a later step failed: resume
        # it in stage mode rather than minting another orphan.
        print(f"create failed ({exc}); resuming existing {artifact_id}", flush=True)
        await am.edit(artifact_id=artifact_id, stage=True)

    # Upload one image exactly as colab_service._upload_image does.
    buf = io.BytesIO()
    Image.fromarray(synthetic_cells(), mode="RGB").save(buf, format="PNG")
    png = buf.getvalue()
    put_url = await am.put_file(artifact_id, file_path=f"images/{stem}.png")
    import urllib.request

    req = urllib.request.Request(put_url, data=png, method="PUT")
    with urllib.request.urlopen(req) as resp:
        if resp.status not in (200, 204):
            sys.exit(f"image PUT failed: HTTP {resp.status}")
    print(f"uploaded images/{stem}.png ({len(png)} B)", flush=True)

    # The JS client's `{mode: ...}` has no kwarg equivalent here: the python
    # `get_service(query, webrtc=..., **kwargs)` forwards kwargs to the server,
    # which rejects `mode`. The selector goes in the query string instead,
    # which matters because several workers register this same app id.
    # The JS client's `{mode: 'select:min:get_load'}` has no equivalent here.
    # `mode=` as a kwarg is forwarded to the server, which rejects it; putting
    # `?_mode=` in the id is not parsed and ends up in the service NAME. So
    # resolve the fully-qualified id instead, which is unambiguous.
    svcs = await server.list_services("bioimage-io")
    ids = [s["id"] if isinstance(s, dict) else s.id for s in svcs]
    broker_ids = [i for i in ids if i.endswith(":annotation-broker")]
    if not broker_ids:
        sys.exit("no annotation-broker replica is registered")
    print(f"broker replicas: {broker_ids}", flush=True)
    broker = await server.get_service(broker_ids[0])
    meta = await broker.register_dataset(artifact_id=artifact_id)
    print(f"register_dataset -> {meta}", flush=True)
    created = await broker.create_label(artifact_id=artifact_id, name=label, description="verify fixture")
    print(f"create_label -> {created}", flush=True)

    index = await broker.get_dataset_index(artifact_id=artifact_id)
    images = index["images"] if isinstance(index, dict) else index.images
    print(f"dataset index images: {[i['stem'] if isinstance(i, dict) else i.stem for i in images]}", flush=True)

    out = {"artifact_id": artifact_id, "alias": alias, "label": label, "stem": stem}
    print("FIXTURE_JSON " + json.dumps(out), flush=True)


asyncio.run(main())
