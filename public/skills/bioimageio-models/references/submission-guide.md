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

Use [`scripts/upload_model.py`](https://bioimage.io/skills/bioimageio-models/scripts/upload_model.py)
(SKILL.md Phase 5). It creates the staged draft with reviewers granted `rw+`, sets `id` /
`id_emoji` from the generated alias in the manifest and the uploaded `rdf.yaml` (the web editor
rejects RDF edits until both match), and uploads every file. Don't hand-roll a copy of it: an
earlier copy here skipped the `id` step. The calls it makes are listed below.

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
    manifest={...},     # Your rdf.yaml content as a dict
    config={"permissions": reviewer_permissions},  # reviewers → rw+, see build_reviewer_permissions
    stage=True,         # ALWAYS True for new submissions
    overwrite=False,
)
# Returns: { "id": "bioimage-io/affable-shark", "alias": "affable-shark", ... }
# `config.permissions` given at create() lands in the ENFORCED base config while
# the artifact stays versionless — this is how reviewers get edit access without
# any commit. Do NOT pass permissions via a later stage=False edit: that publishes.
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

> **The RDF lives in two places, and they can silently diverge.** An artifact holds the RDF as a
> **file** (`rdf.yaml`, in the file inventory) *and* as a separate stored **manifest** record.
> `put_file` updates only the file; `am.edit(manifest=…)` updates only the record. Nothing warns you
> when they disagree.
>
> This matters because the two audiences read different copies: `bioimageio` static validation and
> the BioEngine remote test read the **file**, so they stay green on a stale record — while the
> website, the collection listing, and a reviewer read the **record**. The usual way to get bitten
> is to change a packaged file that `rdf.yaml` hashes (documentation, `environment.yaml`, weights,
> architecture), regenerate `rdf.yaml`, re-upload just the changed files, and forget the `am.edit`.
> The stored record then carries `sha256` values pointing at the pre-change files.
>
> **Rule: every `rdf.yaml` regeneration needs both a `put_file` and an `am.edit`.** Assert it before
> requesting review:
>
> ```python
> import yaml
> stored = (await am.read(artifact_id=artifact_id, stage=True))["manifest"]
> shipped = yaml.safe_load(open(f"{package_dir}/rdf.yaml"))
> stale = sorted(k for k, v in shipped.items() if stored.get(k) != v)
> assert not stale, f"stored manifest is stale for: {stale}"
> ```
>
> This checks one direction on purpose: the record legitimately carries keys that are deliberately
> kept out of the shipped `rdf.yaml` (`status`) or are set at upload from the generated alias (`id`,
> `id_emoji`, added by `upload_model.py` to the manifest and the uploaded `rdf.yaml` only). For
> the same reason, **merge rather than replace** when you call `am.edit` — read the current staged
> manifest and lay the regenerated `rdf.yaml` on top of it (`{**current, **rdf}`), as
> `submit_for_review.py` does. Passing the bare `rdf.yaml` wipes those fields.

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
3. **Request review** — `am.edit(stage=True, manifest={...status: "in-review"})`
4. Curators review: metadata quality, license, BioEngine test results
5. If `in-revision` status: fix, retest, request review again
6. Once accepted: curator commits and publishes → model appears on https://bioimage.io with `status: published` and a DOI

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
put_url = await am.put_file(artifact_id=existing_artifact_id, file_path="rdf.yaml")
# ... HTTP PUT the updated file, with id / id_emoji kept via upload_model.set_rdf_ids
# (see SKILL.md Step 6a-fix)
```

Then re-run the BioEngine test (Phase 6a) and request review again (Phase 6b).

---

## Withdrawing or Deleting a Staged Model

Use these operations when the user wants to pull back a submission or remove it entirely.

### Withdraw from review (go back to draft)

Sets `status` back to `"draft"` so curators no longer see it in the review queue.
The artifact remains in staging and can be edited and re-submitted.

```python
import asyncio, yaml
from hypha_rpc import connect_to_server

async def withdraw(artifact_id: str, token: str, package_dir: str):
    with open(f"{package_dir}/rdf.yaml") as f:
        manifest = yaml.safe_load(f)
    manifest["status"] = "draft"   # back to draft (not submitted for review)

    async with connect_to_server({
        "server_url": "https://hypha.aicell.io",
        "token": token,
        "method_timeout": 120,
    }) as server:
        am = await server.get_service("public/artifact-manager")
        await am.edit(
            artifact_id=artifact_id,
            stage=True,   # use stage=True, NOT version="stage" (causes PermissionError)
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

**Artifact status lifecycle** (unified vocabulary):
```
(created) → draft → in-review → published
              ↑          ↓
          withdraw()  in-revision → (fix & re-submit → in-review)
              ↓
        discard() / delete()
```
Statuses: `draft` (not submitted) · `in-review` (awaiting curator) ·
`in-revision` (curator requested changes) · `published` (committed & live).

---

## Reporting Issues

If submission or validation fails with an error that can't be fixed:

1. Open an issue at: https://github.com/bioimage-io/spec-bioimage-io/issues
2. Include:
   - The `rdf.yaml` content (or the error section)
   - The full error from `bioimageio test`
   - Python version and `bioimageio.spec` / `bioimageio.core` versions
   - The model framework and weight format
