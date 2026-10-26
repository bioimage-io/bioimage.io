# Verification recovery — 2026-10-26

Reviewer held the loop: "queue emptied by archiving issues without verification."
Measured the actual close records before acting. The claim is right about four
issues and wrong about two.

## What each archived issue's close record actually says

| Issue | Verify type | Close record | Reviewer right? |
|---|---|---|---|
| #0006 My Artifacts authorship | verify:agent | ✓ EVIDENCE EXECUTED: 8 playwright @1280x900, 19 jest, 1 grep assertion; 4 criterion clauses mapped | **No** — evidence ran |
| #0020 duplicate Published chip | (none) | ✓ EVIDENCE EXECUTED: 1 playwright @1280x900 + 100 jest (10 suites) | **No** — evidence ran |
| #0015 published-report sweep | verify:manual | ✓ evidence RAN (10 assertions, exit 0) but in a tree 3 commits behind origin/main, `--force` given | **Partly** — stale tree |
| #0014 committed drafts | verify:command | ⚠ `--force`, NOTHING RUN | **Yes** |
| #0017 committed drafts (dup of #0014) | verify:command | ⚠ `--force`, NOTHING RUN | **Yes** |
| #0018 phantom model cards | verify:command | ⚠ `--force`, NOTHING RUN | **Yes** |
| #0019 phantom cards (dup of #0018) | verify:command | ⚠ `--force`, NOTHING RUN | **Yes** |

All four NOTHING-RUN issues are **seeded test exhaust**: they were filed by the
end-to-end filing tests for #0007 and #0015, which deliberately let the real
`myco issue add` path run. The artifact ids are literally
`seeded-test-artifact-0007`, `seeded-test-model-nostatus-0007`,
`test-report-seeded-phantom-0015`. That makes the "not a real finding" claim
plausible — but plausible is not measured, and their verify commands are cheap,
so run them.

## Verify commands to run (cheap, re-runnable)

- #0014 / #0017: `check_committed_drafts.py --dry-run | grep -q ' 0 unpublished artifact'` (needs BIOIMAGE_IO_TOKEN)
- #0018 / #0019: `check_published_model_reports.py --dry-run | grep -q 'offenders: 0'` (no token)
- #0015: `scripts/test_published_report_filing.py` (seeded end-to-end, 10 assertions)

## Uncommitted work (reviewer right on both)

Worktree `quick-river`:
- `tests/screenshots/my-artifacts-populated-authored.png` modified
- `notes/` untracked (this file)

Main checkout `/data/nmechtel/bioimage.io` on branch `main` @ 4228b16:
- `scripts/check_committed_drafts.py` M (+144/-?), `scripts/sweep_reports.py` M — the #0007 work
- untracked, NOT excluded: `scripts/_myco_backlog.py`, `scripts/test_sweep_filing.py`
- untracked junk: `.worktrees/`, `BioEngine.png`, `campaigns.png`
- git-excluded on purpose (`.git/info/exclude:7`): `scripts/check_published_model_reports.py`

## Branch divergence — needs Nils, do not act

    main  4 ahead / origin/main  7 ahead   (DIVERGED)
    origin/main 7 ahead / quick-river 10 ahead

`git fetch` fails: `Permission denied (publickey)` — SSH agent not unlocked, so
origin/main is the 2026-10-26T09:06 fetch. CLAUDE.md standing rule: ask before
any push or merge to main/origin. So "converge to main" is held, not done.

## The paused-issue loophole

12 issues are paused with **NO REASON RECORDED**, which `myco issue pending`
itself flags: "a pause with no blocker cannot be told from one parked to empty
the queue." That is the reviewer's substantive point. Each needs a real stated
blocker or to be resumed and worked.
