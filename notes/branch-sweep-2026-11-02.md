# Branch sweep, 2026-11-02 (myco #0028)

Measured against `origin/main` at 863ec42. Repo went from 22 worktrees to 18.

## The headline: the "parked work" in the standing orders was never lost

    git merge-base --is-ancestor bold-desert calm-river    -> yes
    git merge-base --is-ancestor calm-river  quick-river   -> yes
    git log --oneline quick-river..calm-river              -> EMPTY

bold-desert ⊂ calm-river ⊂ quick-river. quick-river absorbed them on **0d74293**
`merge(calm-river)`, which is why bb734c4 is one of its parents.

The team briefing describes calm-river (4 commits) and bold-desert (3, "subject recorded
nowhere") as work lost when `giddy-fox-iieksd` and `zany-dodo-riknsr` were archived.
Nothing was lost. Their subject, recoverable from this branch's history: the reports-sweep
committed-drafts guard (b0ddcc7), the Hypha service-discovery retry (3000a27), the skill
note that filing a feedback report needs a login (7b1d1a1), and the #0006 My Artifacts
authorship fix (bb734c4).

**The real exposure was never those worktrees. It is that quick-river itself is unpushed.**
That is the #0006 blocker, not a parked-work problem.

## Deleted, each proven lossless before the delete

| branch | was | why lossless |
|---|---|---|
| `eager-ocean` | 7b1d1a1 | same *commit* as bold-desert, not merely same tree |
| `sharp-valley-2` | 7b1d1a1 | same commit again. Three refs, one SHA |
| `bold-desert` | 7b1d1a1 | ancestor of quick-river |
| `calm-river` | bb734c4 | ancestor of quick-river |

All four SHAs re-checked reachable from quick-river afterwards.

`origin/calm-river` at bb734c4 is untouched — deleting a local ref does not touch the
remote, and removing a remote branch is an outward action for Nils. Unverified today
because ls-remote cannot reach origin.

## Could NOT delete

`worktree-bioengine-landing-r4` (265f51c). Content is **already on main** (0 residual), so
the branch holds nothing, but the worktree carries a git lock reading
`claude session bioengine-landing-r4 (pid 181619)`. That pid is not running. `git worktree
unlock` + `remove` **hung and was killed at 2 min**; state verified unchanged afterwards,
nothing half-removed. Did not retry, did not `-f -f` — forcing past a lock that names a
session is how someone's uncommitted work disappears.

## Two measurement traps that each produced a confident wrong answer

**`git ls-remote` cannot reach origin from this repo.** Positive control
`ls-remote origin refs/heads/main` exits **128**, `Permission denied (publickey)` — the same
SSH death that blocks #0006. An earlier pass of the table had a REMOTE column reading
`local-only` for all eleven branches, which was not a finding but the absence of one. Never
delete a branch here because it "looks local".

**A commit count and a three-dot diff both answer the wrong question.**
`git diff origin/main...HEAD` shows a branch's own changes whether or not main already has
them, so a fully squash-merged branch reads large. This repo squash-merges round PRs, so
that is the common case. The right measure is the branch's own files diffed **two-dot**:

```sh
files=$(git diff origin/main...$b --name-only)
printf '%s\n' "$files" | /usr/bin/grep . | tr '\n' '\0' \
  | xargs -0 -r git diff origin/main $b -- | /usr/bin/grep -c '^[+-][^+-]'
```

Built-in control: `worktree-bioengine-landing-r4` reads **0**, quick-river reads **2132**.

Also: `git worktree remove 2>&1 | sed ...; echo rc=$?` printed `rc=0` for a remove that
emitted `fatal: cannot remove a locked working tree`. That 0 is sed's. The pipe trap again.

## Ten branches left, five needing a decision

Carried by an open PR, excluded: `feat/federation-campaigns-page` (#106),
`feat/colab-ome-zarr-sources` (#107), `feat/memory-field-sets-container-limit` (#109).
Plus quick-river (mine, blocked on #0006) and landing-r4 (above).

Needing a decision, none of them this team's subject:

    fix/round34b-amendments                   901 lines not on main
    feat/campaigns-page-design              14546   (named owner)
    feat/round37-fis-existing-masks-warning   167
    smooth-forest                             137   (colab pages)
    feat/round36-merge-masks-label-info        62   (nearly all landed)

The shared `main` checkout also holds 4 commits / 311 lines in 5 files, including 4228b16
(CDI doc, which notes flag as duplicating eae73b7 already on the remote).

## Session census, same day

I am the **only live session in the whole bioimage.io tree**. All three fellow team members
are archived: Collection quality (`good-swan-lahspe`), Reporter (`graceful-goat-xoyjpw`),
Paper revision (`idle-vole-qtqhed`). Delegating to any of them needs `myco session resume`
first. `able-mule-xedyzl` does not appear in this workspace's list at all; it resolves in
`ws-bioengine-a142944f`.
