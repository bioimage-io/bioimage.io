# Branch sweep, 2026-11-03 (myco #0028, second pass)

Supersedes the census in `branch-sweep-2026-11-02.md`, which was measured against a stale
`origin/main` (863ec42) with `ls-remote` unreachable.

    origin/main      863ec42  ->  d6e54cd
    local branches        74  ->  24
    worktrees             18  ->  10
    remote heads      UNKNOWN ->  68   (ls-remote over the PAT URL; control: `main` present)

## What changed the whole picture: ls-remote works now

The 2026-11-02 pass could not reach origin (`Permission denied (publickey)`), so it had no
way to tell a landed branch from an unpushed one and the REMOTE column was dropped. With the
GitHub PAT URL, `git ls-remote --heads` returns 68 heads. That single measurement reclassified
most of the backlog: **19 of the 39 still-ahead branches turned out to be on origin at the
identical SHA**, which makes deleting the local ref a one-command-recoverable operation
(`git fetch origin <b>:<b>`).

⚠ `git fetch origin <branch>` still FAILS here — the configured remote is the SSH one and the
gitconfig rewrite applies. Only the explicit PAT URL works. That failure goes to stderr and
the surrounding command carries on.

## Three containment proofs, in increasing cost

1. `git rev-list --count origin/main..<b>` is 0 — every commit reachable from main.
2. The branch's SHA equals its `ls-remote` head — one fetch restores it.
3. `git merge-base --is-ancestor <b> quick-river` — absorbed by this session's branch.

50 of 74 branches satisfied one of these. Nothing below that bar was deleted.

Re-verify immediately before the delete, not from the earlier scan. And note the
squash-merge case: `land-0006` read 1 ahead but all 10 of its files diffed **0** lines
two-dot against main. It was PR #113 under its pre-squash name.

## `wise-bridge` was the FIFTH ref on the same three sweep commits

The 2026-11-02 pass found `eager-ocean`, `sharp-valley-2`, `bold-desert` and `calm-river` all
sitting on 7b1d1a1 / bb734c4 and deleted them. It missed `wise-bridge`, also 7b1d1a1, because
it was reading branch names and **`wise-bridge` is also the name of a worktree holding a
completely different branch** (`feat/campaigns-page-design`, 44 ahead). Same for `campaigns`
(holds `feat/federation-campaigns-page`) and `round34b-fix` (holds `fix/round34b-amendments`).
The standing orders' "wise-bridge 44, campaigns 36, round34b-fix 14" are **worktree** names,
not branch names. Never match the two namespaces against each other.

## `merge-prep-main` looked ideal to delete and must be kept

`git log merge-prep-main --not quick-river origin/main` returns exactly one commit, a merge.
A merge commit with no original work is free to discard — but this one is not that:

    git show --cc 99476ce  ->  43 combined-diff lines
    git show --cc 0d74293  ->   0   (control: a clean merge)

43 lines of resolved conflict in `public/skills/bioengine/SKILL.md`, which **is** #0016 item 3.
`git show --cc | grep -cE '^[+ -]{2}[^+ -]'` is the test that tells a resolved merge from an
automatic one. The merge needs redoing against d6e54cd (main moved twice since 863ec42).

## `microsam-live` held 149 KB of evidence that exists nowhere else

12 untracked files — `colab-rework-plan.md` and eleven Playwright specs for rounds 28 to 32 —
each returning **0** hits from `git log --all -- <f>` and absent from the shared checkout.
Control: `tests/my-artifacts-authorship.spec.ts` returns 4 with the same command.

Preserved at `.dev/worktree-sweep-backup-2026-11-03/microsam-live-untracked/`, verified with
`cmp` per file, with a negative control (append one byte, `cmp` reports a difference) proving
the identity check discriminates. Same class of near-miss as the r4 `outputs/` shots on
2026-11-02: **`git status --porcelain --ignored`, never plain `--porcelain`, before removing a
worktree.** Here the files were untracked rather than ignored, so plain porcelain did show
them — as `??` lines that look like noise next to a `0 modified files` summary.

## A conditional echo above an unconditional action is not a guard

    [ "$a" -eq 0 ] && echo "  -> lossless"
    git branch -D "$b"

`a` was 1, the message did not print, and the branch was deleted anyway.
`feat/inference-report-artifact` restored in the same run at 16e7469; it carries one unpushed
commit. Put the action inside the `if`, or `||` the whole thing.

Related zsh trap, hit again: `set -- $pair` does not word-split, so `$1` is the whole string.
And `$(cmd | grep -c . || echo '?')` emits TWO lines when grep -c prints `0` and exits 1.

## Where it stands

Eleven branches carry content absent from origin, between 65 and 14617 lines each. All eleven
are blocked on one thing: a push. #0028 is paused on that as a single question with four
options rather than eleven questions. The same push unblocks #0006's successors, #0007, #0016,
#0022 and #0026.

Six branches are carried by open PRs (#103, #104, #106, #107, #109, #112) and need nothing.
`backup/colab-ome-zarr-pre-rebase` is retained deliberately until PR #107 merges.
`fix/slurm-passthrough-arg-quoting` and `brave-forest-2` belong to the BioEngine pages owner
(`able-mule-xedyzl`, not on this team) and were not touched.
