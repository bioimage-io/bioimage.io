# Bug: `discard` permanently deletes committed files that were edited in the staging session

**Severity:** high — silent, irreversible data loss on *published* models.
**Where:** Hypha artifact-manager backend, `artifact.py::discard` (deployed hypha.aicell.io; observed at `/home/hypha/artifact.py:9811`).
**Observed:** `bioimage-io/affable-shark` lost `documentation.md` (still referenced by `rdf.yaml`, 404 on all versions).

## Reproduction (matches the reported flow)

1. Open a published model in the editor and click **Stage for Editing**.
   Frontend calls `edit({ artifact_id, stage: true })` — **no `version` argument**.
2. Edit a file (e.g. `documentation.md`) and save. Frontend does
   `put_file(...)` + `edit({ manifest, stage: true })`.
3. Click **Discard**. Frontend calls `discard({ artifact_id })`.

Result: `documentation.md` is deleted from the committed version and cannot be recovered.

## Root cause (two backend facts combine)

### 1. Staging a published artifact without `version:"new"` writes into the *committed* version directory

`edit(stage=True)` sets the staging intent based on the `version` arg
(`artifact.py` ~5673):

```python
"_intent": "new_version" if version == "new" else "edit_version"
```

With no `version` arg the intent is **`edit_version`**. `put_file` then computes
the target directory from that intent (`artifact.py` ~7400):

```python
has_new_version_intent = staging_dict.get("_intent") == "new_version"
if has_new_version_intent:
    target_version_index = len(artifact.versions or [])        # a fresh v{N} dir
else:
    target_version_index = max(0, len(artifact.versions or []) - 1)   # the EXISTING committed dir v{N-1}
```

So under `edit_version`, staged uploads land in `v{N-1}/…` — **the same S3
prefix as the live committed files**, sitting right next to them (and
overwriting the file if it has the same path).

### 2. `discard` deletes those staged files from the committed directory, and never restores

In `discard`, the non-new-version branch (`artifact.py` ~9889) does:

```python
staged_files_version_index = max(0, len(artifact.versions) - 1)   # = the committed dir
for file_info in staging_dict.get("files", []):
    if "_intent" in file_info or "_remove" in file_info: continue
    file_key = f"{prefix}/{artifact.id}/v{staged_files_version_index}/{file_info['path']}"
    await s3_client.delete_object(Bucket=..., Key=file_key)       # deletes from the COMMITTED dir
```

The surrounding comment claims it will "restore the committed files", and it
sets `original_manifest_restored = True`, but the S3 restore block right below
is guarded by `if not original_manifest_restored:` — so **it never runs**. The
net effect for any file edited during the session is: delete from `v{N-1}/`,
restore nothing → the committed file is gone.

Files *not* touched in the discarded session (weights, cover, samples) are
untouched, which is exactly the observed damage pattern. `rdf.yaml` survived
because a later save re-committed it into `v0/`.

## Why the "new version" flow is safe

`Edit.tsx::handleCreateNewVersion` already calls
`edit({ stage: true, version: 'new' })`. That sets `new_version` intent, so
`put_file` writes to a fresh `v{N}/` and `discard` takes the
`has_new_version_intent` branch, which deletes the **entire new** `v{N}` index
via `_delete_version_files_from_s3` and never touches the committed `v{N-1}/`.

## Fix

**Backend (correct fix):** staged uploads for an existing version must go to a
separate staging prefix (as `discard_changes` already does for git storage:
`{prefix}/{id}/staging/{branch}/…`), and `discard` must only ever delete from
that staging prefix — never from a committed `v{N}` directory. The dead
restore-from-S3 branch should also be fixed or removed.

**Frontend mitigation (no backend change):** never stage a *published* artifact
in-place. Make **Stage for Editing** create a new version instead —
`edit({ artifact_id, stage: true, version: 'new' })` and copy files forward from
the previous version (same as `handleCreateNewVersion`). Then in-place
`edit_version` staging is never used on data that must be preserved, and
`discard` is safe.

## Frontend mitigation applied (interim, until the backend is fixed)

The **Discard** action is disabled in the UI, because a working content-revert
alternative would require preserving the committed version (i.e. staging as a
new version), and in-place staging overwrites committed files in S3 the moment
a staged change is saved — leaving no pristine copy to revert from.

- `Edit.tsx` — the **Discard** button is disabled with an explanatory tooltip;
  `handleDiscardChanges` also returns early as a guard.
- `ReviewArtifacts.tsx` — the **Discard staged changes** menu item (Staging
  view) is disabled with the same tooltip; `handleDiscardStaged` guards too.

To abandon staged edits while Discard is disabled: commit the changes (safe), or
an admin reverts the model server-side. Re-enable Discard once the backend
stages/discards in a separate prefix (or once Stage-for-Editing is switched to
new-version staging so committed content is preserved).

## Recovery of affable-shark/documentation.md

Recovered from the canonical Zenodo source deposit (concept DOI
`10.5281/zenodo.5764892`, record `6647674` — same `id: affable-shark`, matching
file set). Saved to `outputs/affable-shark-recovery/documentation.md`
(1571 bytes, sha256 `9b8330e6fae8403efc7a44bb7365186c14fb6222b608791baab7a4e0352dbdcd`).
