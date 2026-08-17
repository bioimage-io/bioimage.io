# Annotation-based model screening (few-shot ground truth)

Create a **private annotation dataset** from user-provided images, let the user annotate it in the browser at bioimage.io, then use those annotations as **screening ground truth** for the model screening workflow in [apps/model-runner/model-runner.md](../apps/model-runner/model-runner.md#model-screening--comparison-workflow).

**Scope: segmentation models only.** The annotations produced by the annotation interface are instance label masks; they are ground truth for segmentation screening and nothing else. Do not use this workflow to screen denoising, restoration, classification, or detection models.

Everything below works against the deployed production stack today (annotation interface at `https://bioimage.io/#/colab`, `annotation-broker` app on the public BioEngine cluster). The user needs a Hypha login (`HYPHA_TOKEN` in the snippets is *their* personal token — the whole flow runs with the user's own identity, no shared credentials).

## The loop at a glance

```text
- [ ] Step 1: Collect the user's images — minimum 1, ideally 3, more is fine
- [ ] Step 2: Create a private annotation dataset artifact (name it generically, e.g. "My model screening"; put the task + start datetime in the description)
- [ ] Step 3: Upload the images as PNGs into images/
- [ ] Step 4: Register the dataset with the annotation-broker and create ONE generic label
- [ ] Step 5: Hand the user the annotation URL and wait for them to annotate
- [ ] Step 6: Read the image + label-mask pairs back from the artifact
- [ ] Step 7: Run the standard screening workflow against these masks (segmentation candidates = model-runner ∪ cellpose4-runner, scored with mAP/F1 as documented there)
```

## Step 1 — collect images

Accept whatever the user has (png/jpg/tif). Convert each to PNG before upload — the annotation viewer serves `images/<stem>.png`. Keep stems unique and filesystem-safe.

```python
from pathlib import Path
from PIL import Image

def to_png_bytes(path: Path) -> bytes:
    import io
    im = Image.open(path)
    if im.mode not in ("L", "RGB"):
        im = im.convert("RGB")
    buf = io.BytesIO()
    im.save(buf, format="PNG")
    return buf.getvalue()
```

One image is enough to screen; three give a much more robust ranking. There is no upper limit, but every image must be annotated by the user before it contributes ground truth, so do not upload fifty.

## Step 2 — create the dataset artifact

Datasets live as **permanently staged** artifacts in the `bioimage-io/colab-annotations` collection. Create with the user's token; the alias convention is `annotation-<base36 time>-<4 random>`:

```python
import time, random, string
from datetime import datetime, timezone
from hypha_rpc import connect_to_server

server = await connect_to_server({"server_url": "https://hypha.aicell.io", "token": HYPHA_TOKEN})
am = await server.get_service("public/artifact-manager")
user = server.config.user  # {'id': ..., 'email': ...}

alias = f"annotation-{format(int(time.time()*1000), 'x')}-{''.join(random.choices(string.ascii_lowercase + string.digits, k=4))}"
artifact_id = f"bioimage-io/{alias}"

started = datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M UTC")
manifest = {
    "name": "My model screening",  # generic title, per convention
    "description": f"Screening ground truth for: <one-line task description>. Started {started}.",
    "owner": {"id": user["id"], "email": user.get("email")},
    "created_by": user["id"],
}
await am.create(
    parent_id="bioimage-io/colab-annotations",
    alias=alias,
    manifest=manifest,
    type="dataset",
    stage=True,
    config={"permissions": {user["id"]: "*"}},
)
```

> **The start datetime in the description is not optional.** Users run multiple screenings; the description (task + datetime) is what tells "My model screening" cards apart on their bioimage.io colab page.

> **The dataset stays private.** Do not set it public and do not add annotators or managers — this workflow never calls any sharing method. If the user wants to share the annotation work with colleagues, they do that themselves from the dataset's Share dialog at `https://bioimage.io/#/colab`.

## Step 3 — upload the images

```python
import httpx

async with httpx.AsyncClient(timeout=120) as http:
    for path in image_paths:
        stem = Path(path).stem
        put_url = await am.put_file(artifact_id, file_path=f"images/{stem}.png")
        r = await http.put(put_url, content=to_png_bytes(Path(path)))
        r.raise_for_status()
```

Do **not** commit the artifact — annotation datasets are permanently staged by design; every read below passes `stage=True`.

## Step 4 — register with the broker, create one label

The `annotation-broker` is the standing authority for annotation datasets (roles, presigned URLs, label folders). Resolve it by its qualified name and register the dataset — the caller must match the artifact's `manifest.owner` (id or email), which is why Step 2 wrote it:

```python
broker = await server.get_service("bioimage-io/annotation-broker")
await broker.register_dataset(artifact_id=alias)
await broker.create_label(artifact_id=alias, name="screening", description="Screening ground truth")
```

One generic label is all a screening needs. Label names must match `^[a-z0-9._-]+$`.

## Step 5 — hand over the annotation URL, wait

```text
https://bioimage.io/#/colab/annotate?session_id=<alias>&label=screening
```

Give the user that URL (with their `<alias>` substituted) and ask them to annotate every object in each image and press **Save Annotation** per image. Annotation quality directly becomes screening ground truth, so completeness matters more than speed.

To check progress without nagging the user, list the label folder (annotations appear as timestamped files as each image is saved):

```python
entries = await am.list_files(artifact_id, dir_path="label_screening", stage=True)
user_dirs = [e["name"] for e in entries if e.get("type") == "directory"]
```

## Step 6 — read the ground-truth pairs back

Annotation saves are **never overwritten**: each save writes `label_screening/user-<sanitized id>/{stem}-{YYYYMMDD-HHMMSS}.png` plus a `.geojson` sibling (the vector form — not needed for screening). Take the **latest complete pair per stem** (lexicographic timestamp sort = chronological), across all `user-*` folders:

```python
import re
import numpy as np
from PIL import Image
import io

PAIR = re.compile(r"^(?P<stem>.+)-(?P<ts>\d{8}-\d{6})\.(?P<ext>png|geojson)$")

async def latest_masks(artifact_id: str, label: str = "screening") -> dict:
    """{stem: mask_filename_path} for the newest complete (png+geojson) save per stem."""
    root = f"label_{label}"
    best = {}  # stem -> (ts, path)
    for e in await am.list_files(artifact_id, dir_path=root, stage=True):
        if e.get("type") != "directory" or not e["name"].startswith("user-"):
            continue
        folder = f"{root}/{e['name']}"
        files = [f["name"] for f in await am.list_files(artifact_id, dir_path=folder, stage=True)]
        by_ts = {}
        for name in files:
            m = PAIR.match(name)
            if m:
                by_ts.setdefault((m["stem"], m["ts"]), set()).add(m["ext"])
        for (stem, ts), exts in by_ts.items():
            if {"png", "geojson"} <= exts and (stem not in best or ts > best[stem][0]):
                best[stem] = (ts, f"{folder}/{stem}-{ts}.png")
    return {stem: path for stem, (ts, path) in best.items()}

async def fetch_mask(artifact_id: str, file_path: str) -> np.ndarray:
    url = await am.get_file(artifact_id=artifact_id, file_path=file_path, stage=True)
    async with httpx.AsyncClient(timeout=120) as http:
        r = await http.get(url)
        r.raise_for_status()
    rgb = np.array(Image.open(io.BytesIO(r.content)).convert("RGB"))
    # 16-bit instance labels packed into the PNG's color channels:
    # label id = (R << 8) | G   (B unused, 0 = background)
    return (rgb[..., 0].astype(np.uint16) << 8) | rgb[..., 1].astype(np.uint16)
```

> **The mask PNG is not a grayscale label image.** It is an RGB PNG with the 16-bit instance id packed as `R = high byte, G = low byte`. Reading it naively (e.g. `Image.open(...).convert("L")`) silently mangles the labels. Use the decode above; the result is a standard instance label array (`0` = background, `1..N` = objects) ready for IoU/mAP scoring.

The matching raw image for each stem is `images/<stem>.png` (fetch the same way with `am.get_file(..., stage=True)`).

## Step 7 — screen models against the annotations

You now have `(image, instance_label_mask)` pairs. Run the standard screening workflow from [apps/model-runner/model-runner.md](../apps/model-runner/model-runner.md#model-screening--comparison-workflow) with these pairs as the ground truth: candidates are the union of model-runner segmentation models and the cellpose4-runner pool, every candidate runs on the same images, and scoring is mAP/F1 over IoU thresholds against these masks exactly as documented there. Restrict the candidate pool to **segmentation models** — the ground truth is instance masks and supports nothing else.

If only some images were annotated, screen on the annotated subset and say so in the report rather than waiting indefinitely; more annotations can always be added later (re-run Step 6 to pick them up).
