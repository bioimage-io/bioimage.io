# BioImage Model Zoo — Submission Guide

How to upload a validated model package to the BioImage Model Zoo using the Hypha artifact manager API.

---

## Prerequisites

- A validated model package directory (passed `bioimageio test`)
- A Hypha token (user gets this from https://hypha.aicell.io after signing in)
- Python with required packages: `pip install -q hypha-rpc httpx pyyaml`

**Never hardcode or log the user's token.** Ask for it at runtime; use it once.

---

## Submission Script

```python
#!/usr/bin/env python3
"""
Submit a BioImage.IO model package to the Model Zoo.
Usage: python submit_model.py <model_package_dir> <hypha_token>
"""
import asyncio
import hashlib
import os
import sys
from pathlib import Path

import httpx
from hypha_rpc import connect_to_server

SERVER_URL = "https://hypha.aicell.io"
PARENT_ID = "bioimage-io/bioimage.io"   # The main Zoo collection


def compute_sha256(path: Path) -> str:
    h = hashlib.sha256()
    with open(path, "rb") as f:
        for chunk in iter(lambda: f.read(65536), b""):
            h.update(chunk)
    return h.hexdigest()


async def submit_model(package_dir: str, token: str):
    package = Path(package_dir).resolve()
    rdf_path = package / "bioimageio.yaml"
    if not rdf_path.exists():
        raise FileNotFoundError(f"bioimageio.yaml not found in {package}")

    # Load manifest
    import yaml  # pip install pyyaml
    with open(rdf_path) as f:
        manifest = yaml.safe_load(f)

    name = manifest.get("name", "unnamed-model")
    print(f"Submitting: {name}")

    # Connect to Hypha — pass config as a dict, not keyword arguments
    async with connect_to_server({
        "server_url": SERVER_URL,
        "token": token,
        "method_timeout": 120,
    }) as server:
        am = await server.get_service("public/artifact-manager")

        # --- Step 1: Create staged artifact ---
        # alias pattern is type-specific (matches Upload.tsx logic):
        #   model       → "{animal_adjective}-{animal}"   e.g. "affable-shark"
        #   dataset     → "{fruit_adjective}-{fruit}"     e.g. "sweet-apple"
        #   application → "{object_adjective}-{object}"   e.g. "shiny-hammer"
        artifact = await am.create(
            parent_id=PARENT_ID,
            alias="{animal_adjective}-{animal}",   # generates a memorable 2-word animal name
            type="model",
            manifest=manifest,
            stage=True,         # Staged = not publicly visible yet; goes to curator review
            overwrite=False,
        )
        artifact_id = artifact["id"]
        print(f"Created artifact: {artifact_id}")

        # --- Step 2: Upload all files ---
        # Exclude __pycache__ and other build artifacts
        files = [
            f for f in package.rglob("*")
            if f.is_file() and "__pycache__" not in f.parts
        ]

        async with httpx.AsyncClient(timeout=300) as client:
            for file_path in files:
                rel_path = str(file_path.relative_to(package))
                print(f"  Uploading {rel_path} ...")

                # Determine download weight (higher = counts more in popularity sort)
                is_weight = any(
                    rel_path.endswith(ext)
                    for ext in [".pt", ".pth", ".onnx", ".h5", ".pb", ".zip"]
                )
                weight = 1 if is_weight else 0

                # Get presigned upload URL
                put_url = await am.put_file(
                    artifact_id=artifact_id,
                    file_path=rel_path,
                    download_weight=weight,
                )

                # Upload via HTTP PUT
                with open(file_path, "rb") as fobj:
                    response = await client.put(
                        put_url,
                        content=fobj.read(),
                        headers={"Content-Type": ""},
                    )
                response.raise_for_status()
                print(f"  ✓ {rel_path}")

        # --- Step 3: Commit to staging ---
        # Note: do NOT call am.commit() — the artifact stays in "stage" mode
        # for curator review. Committing would bypass the review process.
        # Curators will review and publish when ready.

        staging_url = f"https://bioimage.io/#/upload?artifact_id={artifact_id}&stage=true"
        print(f"\nSubmission complete!")
        print(f"Artifact ID: {artifact_id}")
        print(f"Review URL:  {staging_url}")
        print(f"\nThe model is now in staging and awaiting curator review.")
        print(f"You will be notified by email when it is published.")
        return artifact_id


if __name__ == "__main__":
    if len(sys.argv) != 3:
        print("Usage: python submit_model.py <model_package_dir> <hypha_token>")
        sys.exit(1)
    asyncio.run(submit_model(sys.argv[1], sys.argv[2]))
```

---

## Hypha Artifact Manager — Key Methods

```
Server URL:   https://hypha.aicell.io
Service ID:   public/artifact-manager
Parent:       bioimage-io/bioimage.io   (the Zoo collection)
```

### `am.create(...)` — Create a new artifact

```python
artifact = await am.create(
    parent_id="bioimage-io/bioimage.io",
    alias="{animal_adjective}-{animal}",  # model alias pattern — yields e.g. "affable-shark"
    type="model",
    manifest={...},     # Your bioimageio.yaml content as a dict
    stage=True,         # ALWAYS True for new submissions
    overwrite=False,
)
# Returns: { "id": "bioimage-io/affable-shark", "alias": "affable-shark", ... }
```

### `am.put_file(...)` — Get presigned upload URL

```python
put_url = await am.put_file(
    artifact_id=artifact["id"],
    file_path="weights.pt",    # relative path within package
    download_weight=1,          # 1 for weight files, 0 for others
)
# Returns: presigned https:// URL — upload via HTTP PUT
```

### `am.edit(...)` — Update manifest

```python
await am.edit(
    artifact_id=artifact_id,
    manifest=updated_manifest,
    stage=True,
)
```

### `am.read(...)` — Check artifact status

```python
info = await am.read(
    artifact_id=artifact_id,
    stage=True,
)
print(info["manifest"]["name"], info["id"])
```

---

## After Submission

After uploading, follow these steps (covered in SKILL.md Phase 6):

1. **Run BioEngine remote test** — `bioimage-io/model-runner` service, `stage=True`
2. **Fix failures** — re-upload changed files via `am.edit()` + `am.put_file()`, then retest
3. **Request review** — `am.edit(version="stage", manifest={...status: "request-review"})`
4. Curators review: metadata quality, license, BioEngine test results
5. If `revision` status: fix, retest, request review again
6. Once `accepted`: curator commits and publishes → model appears on https://bioimage.io with a DOI

**Typical review time:** 1–5 business days.

---

## Re-submitting After Fixes

If the curator requests changes or validation fails post-submission:

```python
# Update the manifest
await am.edit(
    artifact_id=existing_artifact_id,
    manifest=fixed_manifest,
    stage=True,
)

# Re-upload changed files
put_url = await am.put_file(artifact_id=existing_artifact_id, file_path="bioimageio.yaml")
# ... HTTP PUT the updated file
```

Then re-run the BioEngine test (Phase 6a) and request review again (Phase 6b).

---

## Withdrawing or Deleting a Staged Model

Use these operations when the user wants to pull back a submission or remove it entirely.

### Withdraw from review (go back to draft)

Removes the `status: "request-review"` from the manifest so curators no longer see it.
The artifact remains in staging and can be edited and re-submitted.

```python
import asyncio, yaml
from hypha_rpc import connect_to_server

async def withdraw(artifact_id: str, token: str, package_dir: str):
    with open(f"{package_dir}/bioimageio.yaml") as f:
        manifest = yaml.safe_load(f)
    manifest.pop("status", None)   # remove status field entirely

    async with connect_to_server({
        "server_url": "https://hypha.aicell.io",
        "token": token,
        "method_timeout": 120,
    }) as server:
        am = await server.get_service("public/artifact-manager")
        await am.edit(
            artifact_id=artifact_id,
            version="stage",
            manifest=manifest,
        )
        print(f"Withdrawn from review. Artifact is now a draft again: {artifact_id}")

asyncio.run(withdraw("bioimage-io/affable-shark", token="YOUR_TOKEN", package_dir="model_package/"))
```

### Delete a staged artifact entirely

Permanently removes the staged artifact and all its files. Only possible while still in staging
(before curator approval). **This is irreversible.**

```python
import asyncio
from hypha_rpc import connect_to_server

async def delete_staged(artifact_id: str, token: str):
    async with connect_to_server({
        "server_url": "https://hypha.aicell.io",
        "token": token,
        "method_timeout": 120,
    }) as server:
        am = await server.get_service("public/artifact-manager")
        # discard() removes all staged changes (files + manifest edits)
        await am.discard(artifact_id=artifact_id)
        print(f"Staged artifact discarded: {artifact_id}")
        # If you also want to delete the artifact record itself:
        # await am.delete(artifact_id=artifact_id, delete_files=True)

asyncio.run(delete_staged("bioimage-io/affable-shark", token="YOUR_TOKEN"))
```

**Artifact status lifecycle:**
```
(created) → draft → request-review → in-review → accepted → published
                         ↑                              ↓
                     withdraw()                    revision → (fix & re-submit)
                         ↓
                    discard() / delete()
```

---

## Reporting Issues

If submission or validation fails with an error that can't be fixed:

1. Open an issue at: https://github.com/bioimage-io/spec-bioimage-io/issues
2. Include:
   - The `bioimageio.yaml` content (or the error section)
   - The full error from `bioimageio test`
   - Python version and `bioimageio.spec` / `bioimageio.core` versions
   - The model framework and weight format
