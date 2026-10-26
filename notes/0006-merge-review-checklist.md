# #0006 merge review — what to check when `giddy-fox-iieksd` finishes

Crew child on branch `calm-river`. Written 2026-10-24 while it was still working,
so it survives a compaction of this session.

## Carry its notes across before the worktree is removed

`outputs/` is **gitignored**, so `outputs/my-artifacts-authorship-notes.md` and
`outputs/measure_my_artifacts.py` do NOT come across in the merge and die with the
worktree. Copy them into `notes/` or paste the measurement block into #0006 as a
comment BEFORE `myco feature done` archives the child.

## Its measurements, 2026-10-24, to re-check rather than trust

    artifacts in collection                         316   (was 278 on 2026-10-06)
    current rule (created_by OR uploader.email)      10   <- what Daniel sees
    authorship by NAME                               74
    authorship by github_user                        74   set-equal to name
    authorship by EMAIL                              10   uploader only, 0 via authors[]
    UNION shipped                                    76   = 52 model, 15 application, 9 dataset
    [contrast] write permission on any identity     294   <- the trap, must NOT be matched

Reproduces the 2026-10-06 figures (10 -> 76, 52/15/9) on a grown collection.

## The four acceptance clauses, and where its design answers each

1. full authorship union across models/applications/datasets — new
   `src/utils/artifactOwnership.ts` matcher + a third `keywords: [user.name]` server
   query merged and deduped with created / uploaded / staged.
2. authorship rows visibly labelled, conferring nothing — "Listed as author" label,
   owner-only Delete / Request-deletion removed on those rows.
3. no permission or reviewer-grant matching — it explicitly never reads
   `config.permissions` / `_permissions` for matching. Verify this by grep, it is the
   clause most likely to regress, and 294 of 316 is what getting it wrong looks like.
4. no query truncates at limit 100 — pagination by offset until a short page, replacing
   both `limit: 100` calls and the `limit: 1000` staged call.

## Things it found that are worth keeping

- **A browser session does NOT always carry `user.name`.** Evidence from live
  `comments.json`: some rows hold 'Nils Mechtel' / 'Simon Britzelli' (a Google session,
  Daniel's provider) and others fall back to a bare `github|NNN`. A token-minted session
  has no name at all. So name must be one signal in a union that degrades, never the only
  one. Check the signed-out and no-name paths in the UI review.
- Hypha keyword search needs client-side post-filtering: `keywords=Daniel Franco-Barranco`
  -> 74 (set-equal to the exact client-side match) but single tokens are broader,
  `Daniel` -> 84, `Franco` -> 77.
- `offset` works on list/children, so pagination is viable (limit=100&offset=300 -> 16).
- **The python hypha-rpc client stalls on `list(limit>=50)`** (120 s timeout; limit=20
  returns in <0.1 s). Use the HTTP children endpoint for measurement. Browser JS is fine.

## Flag raised at review time

Its measurement probes were invoked with a Hypha JWT as a literal argv string, readable
via `ps` by any user on this box. Harmless for a throwaway probe on a dev machine; the
thing to catch is the habit reaching committed code. Grep the diff for a token in a
command string.

## Validation this session owes before closing

Per CLAUDE.md, UI-level validation is not optional: render My Artifacts at a desktop
viewport on the live dev server and look at it, including the signed-out, empty, loading
and error states. A build pass alone does not close this.

---

## Outcome, 2026-10-24

`calm-river` merged by hand into `quick-river` as `0d74293` (see that commit for why
`myco feature merge` could not be used). #0006 closed on executing evidence; the close
archived the crew child `giddy-fox-iieksd`. Its leaked dev server on port 3061 was stopped.

Validated on the merged tree: build exit 0, Jest 10 suites / 100 tests, Playwright
`tests/my-artifacts-authorship.spec.ts` 9/9 at 1280x900. The five state screenshots are
now committed under `tests/screenshots/`, so the evidence no longer dies with a worktree.

One defect found during the render and fixed separately as #0020 (`a215a8a`): the card
said "Published" twice, and contradicted itself on a committed draft. Pre-existing, from
`287b521`, not from this work.
