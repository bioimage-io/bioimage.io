# Plan: Align website with intended model create / edit / delete behavior

Scope: `bioimage-io/bioimage.io` collection config (data only) + bioimage.io website. **No Hypha code changes.**

## Decisions locked in this session
- Deletion Request page + final delete execution: **site-admins only** (`user.roles.includes('admin')`). Uploaders/reviewers can only *mark* for deletion.
- Deletion mark storage: **flag on the model's manifest** (`manifest.request_deletion`), reason written as a comment in `comments.json`. Reason is **required** or the request is invalid.
- Self-publish: **require reviewer acceptance** — remove the uploader "Publish Without Review" path.
- Single-version delete ("Delete This Version"): **disallow entirely**.

## Intended capability matrix (target)
| Model state | Uploader (own) | Reviewer (`rw+`) | Site-admin | Any authed / public |
|---|---|---|---|---|
| View | yes | yes | yes | view only |
| Upload (create staged) | yes | n/a | n/a | create own only |
| Stage / edit files / add / remove / new version | own only | any model | any model | no |
| Commit (accept to zoo) | **no self-publish** → submit for review | yes | yes | no |
| Discard staged changes (published model) | own | any | any | no |
| Delete unpublished (versionless) model | Delete (hard) | Request deletion | Delete via Deletion Request page | no |
| Delete / mark published model | Request deletion (own) | Request deletion | Delete via Deletion Request page | no |
| Delete single version | disallowed | disallowed | disallowed | no |

Rule: **Discard is never offered on an unpublished (versionless) model** — it would leave an orphan.

---

## A. Collection-config change (no code)
1. Tighten collection `@` grant from `r+` to explicit list `["read","get_file","list","list_files","create"]` (drop `put_file`, `add_vectors`) so authenticated users cannot add files to other users' staged models. Uploads still work via the per-artifact `*` granted at create. Verify existing staged uploads still commit.
   - Reviewers stay `rw+` (already correct: edit/commit/put_file/remove_file, no delete). Delete stays admin/owner-only.

## B. UI role model refactor
2. Split the conflated `isCollectionAdmin` (currently `user.id in collection.config.permissions || roles.includes('admin')`, in `LoginButton.tsx:85`, `Edit.tsx:577`, `MyArtifacts.tsx:229`) into two explicit concepts:
   - `isReviewer` = in collection `config.permissions` with `rw`/`rw+`/`*` OR `roles.includes('admin')` → may edit/stage/commit/discard any model.
   - `isCollectionAdmin` = `roles.includes('admin')` (delete-capable) → may finalize deletions.
   - `isUploader` (per-artifact) unchanged (`created_by` / uploader email / per-artifact `*`).
   Centralize these in one helper/hook to avoid the three divergent copies.

## C. Edit page action gating (`Edit.tsx`)
3. Keep stage / put_file / remove_file / new-version / commit / discard gated to `isReviewer || isUploader` (already close). Ensure discard button (`Edit.tsx:2534`) is shown **only when `hasPublishedVersion && isStaged`** (already the case) and never on versionless artifacts.
4. **Remove** the "Delete This Version" action entirely (`Edit.tsx:3061` handler + button `1614`).
5. New-version button: keep gated `!isStaged`; keep the "recommended only when weights change" hint (UI copy only).

## D. Discard footgun fix (`ReviewArtifacts.tsx`, `MyArtifacts.tsx`)
6. `ReviewArtifacts.handleDeleteArtifact` (289/294) currently branches on `viewMode`; change to branch on **`versions.length`**: `>0` → discard (staged edits on a published model); `===0` → this is an unpublished model, do NOT discard.
7. For unpublished models, replace the discard/delete action with the state-correct action from the matrix (Section E/F).

## E. Mark-for-deletion flow (uploader + reviewer)
8. Add a "Request deletion" action on model cards/detail for `isUploader || isReviewer`, available for both published and unpublished models. It:
   - opens a dialog requiring a non-empty **reason**;
   - writes `manifest.request_deletion = { by, reason, requested_at }` (for published models: `edit(stage) → commit` in place; for unpublished: `edit(stage)` on the staged manifest);
   - appends the reason to `comments.json` (put_file/get_file), reusing `Comments.tsx` data shape;
   - blocks submit if reason is empty (request invalid without a reason).
9. Uploader on their **own unpublished** model additionally keeps a direct hard **Delete** (they hold `*`), with typed-ID confirmation.

## F. Remove self-publish
10. Remove the non-admin "Publish Without Review" / Advanced Zone publish path (`ReviewPublishArtifact.tsx:503-513` and the `onPublish` wiring for non-reviewers). Uploaders submit for review (`status:'request-review'`); only reviewers/admins accept (commit). Keep reviewer/admin accept in the Review page.

## F2. Single choke point for whole-model deletion (no direct-delete bypass)
10a. Remove the existing direct "Delete Published Model" action on the Review page (`ReviewArtifacts.tsx:294`, published view, ID-confirm). Even site-admins must **mark → finalize on the Deletion Request page** — no direct whole-model delete from Review or model detail.
10b. Audit every `.delete(` call site so the ONLY surviving whole-model deletes are: (i) uploader hard-deleting their **own unpublished** model (Section E9), and (ii) the site-admin finalize on the Deletion Request page (Section H16). Reviewers get "Request deletion" everywhere, never a `delete` button (would 403 anyway).

## G. Route guards
11. Add a client route guard to `/review` (currently only `isLoggedIn`, `ReviewArtifacts.tsx:415`) → require `isReviewer`.
12. Guard the new `/deletion-requests` route → require `isCollectionAdmin` (site-admin).

## H. Deletion Request page (new, site-admin only)
13. New route `/deletion-requests` + `DeletionRequests.tsx`.
14. Dropdown entry in `LoginButton.tsx` between Review (line 335) and BioEngine (line 337), gated by `isCollectionAdmin` (site-admin).
15. Page lists:
    - models with `manifest.request_deletion` set (scan committed + staged children), showing requester + reason + comment link;
    - **versionless orphan artifacts** (`versions.length === 0 && !staging`) — surfaced "just in case" (confirmed such orphans exist live, e.g. `determined-hedgehog`, `decisive-panda`).
16. Finalize-delete: even a site-admin must (a) see a reason present, then (b) confirm via dialog requiring the **model id typed** to match, then call `delete({delete_files:true, recursive:true})`. Reuse the ID-confirm pattern from `colab/DeleteArtifactModal.tsx` / `ReviewArtifacts.tsx:262-268`.
17. Public grid already excludes versionless/staged — **verified 2026-07-17**: `stage=false` children endpoint returns 0 versionless artifacts (258 committed), while 58 versionless orphans exist in staged listing. Backup net confirmed; no grid change needed. Open: whether to hide `request_deletion`-marked published models from the grid immediately or keep visible until finalized (decide during build).

## I. Harden + verify reviewer accept flow
18. Not a permission bug (reviewers demonstrably hold `commit`). Harden `ReviewArtifacts.handleAccept`: don't gate the real `commit()` on a possibly-absent `artifact.staging` (read fresh state or always attempt commit when not yet committed); surface the actual error instead of the generic "Failed to accept artifact" (line 409). Verify end-to-end that a reviewer can accept a new model and it appears on the public page.

## Out of scope / open items
- No Hypha code changes; only collection `@` config + website.
- Confirm during build whether a `request_deletion`-marked published model should stay visible on the public page until finalized.
- Need exact error/account if the reviewer-accept issue recurs after hardening.
