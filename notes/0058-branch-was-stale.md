## The guard failed on its own branch because the branch was one commit stale

A reviewer ran `scripts/check-concurrency-doc.sh` on the branch tree and got exit 1 with
`cannot count the proxy-admission explanation -- clause 1b found none of it in the passage`,
concluding that the guarded prose is missing and must be written into `SKILL.md`.

**The first half is right and I reproduced it verbatim. The remedy is wrong, and taking it would
have caused the exact defect #0065 exists to catch.**

### Reproduced

```
$ git worktree add --detach /tmp/revremedy ff32b54 && cd /tmp/revremedy
$ sh scripts/check-concurrency-doc.sh
FAIL  clause 1: still groups max_ongoing_requests with the application_resources redirect
FAIL  clause 1: the App lifecycle passage does not say the top-level max_ongoing_requests is what the proxy admits
ok    clause 3: memory / gpu_enabled keep their application_resources redirect
ok    clause 4: the application_resources redirect appears exactly once
FAIL  clause 4: cannot count the proxy-admission explanation -- clause 1b found none of it in the passage
rc=1
```

### The cause: stale base, not missing content

```
$ git rev-list --count HEAD..origin/main      ->  1
$ git log --oneline -1 origin/main
1d2b49d docs(bioengine): max_ongoing_requests is two limits, not one that is ignored
```

That one commit **is** the proxy-admission prose. The guard branches were cut from `904bf29`, its
parent, and carry the pre-fix `SKILL.md`. The content was never missing from the product; it was
missing from a branch that had not been brought forward. My own matrix had already recorded this as
`guardbranch 1` and explained it on the row, which was not enough: a reviewer runs the tree in front
of them, and it was red.

**Merging the PR as it stood already produced a green tree** -- the content and the guard meet on
main, which is where the guard is meant to run:

```
$ git merge --no-edit origin/main     # clean, no conflict
$ sh scripts/check-concurrency-doc.sh ; echo rc=$?
ok x5
rc=0
```

### Why the prescribed remedy was not taken, measured

Writing the passage into `SKILL.md` on the branch means re-authoring prose that exists one commit
away. Measured, re-authored approximately rather than byte-for-byte:

```
guard on the re-authored branch        rc=1   <- clause 1 still fails: the OLD sentence is
                                               still there, so the remedy is half of 1d2b49d
git merge origin/main                  rc=1   CONFLICT (content) in SKILL.md
naive both-sides resolution of it      rc=1
    FAIL clause 4: the application_resources redirect appears 2 times
    FAIL clause 4: the proxy-admission explanation appears 2 times in the App lifecycle passage
```

So the prescription produces a conflict whose obvious resolution duplicates the guarded paragraph --
the precise regression #0065 was filed about, with both of clause 4's arms firing, including the arm
that exists only because Backlog head found the residual.

### What was done instead

Both branches rebased onto `origin/main` (`1d2b49d`). The content arrives as the commit that already
carries it, no prose is re-authored, and the guard is green on its own tree:

```
PR #134 branch (659ae1d)   rc=0      PR #142 branch (e211fc6)   rc=0
```

The script bytes are unchanged by the rebase -- md5 `57bcab21…` before and after on #134,
`ad1c25a8…` on #142 -- so every earlier measurement still stands, and `git diff <branch> origin/main
-- public/skills/bioengine/SKILL.md` is **empty** on both: these PRs still touch no documentation.

Re-run after the rebase, unchanged: twelve-tree matrix `main 0 · prose 0 · r0064 0 · appres 0 ·
reword 0 · fence 0 · oldmain 1 · dup 1 · noproxy 1 · a1 1 · norename 2 · absent 2`, and the head's
four mutants `clean 0 · 690-deleted 1 · 688-duplicated 1 · 690-duplicated 1`.

The one row that changed is the branch tree itself, from 1 to 0, which was the whole point.

BioEngine pages (able-mule-xedyzl).
