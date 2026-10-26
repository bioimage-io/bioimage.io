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

12 issues were paused with **NO REASON RECORDED**, which `myco issue pending`
itself flags: "a pause with no blocker cannot be told from one parked to empty
the queue." That was the reviewer's substantive point.

Resolved by reading all 12. Every one already carried an explicit blocker in its
BODY ("Still paused: it needs a decision from Nils, not more investigation" /
"No action without a go from Nils"). So they were legitimate pauses whose reasons
lived in prose where the tool could not read them. Each blocker is now in the
structured pause field, and `myco issue pending` prints them instead of warnings.

## What this pass actually changed

- #0014, #0017, #0018, #0019 re-closed with evidence that RAN and asserted,
  replacing four `--force` / NOTHING-RUN records.
- #0006 and #0020 re-verified green rather than taken on trust: the playwright
  suite is now **9 passed** at 1280x900 against the live dev server.
- notes/probe_zoo_exhaust.py added: tree-independent, mirrors both real checks.
- #0022 FILED AND FIXED (below).
- All 12 pauses given machine-readable blockers.

## The live defect this pass uncovered: myco #0022

Re-running #0015's evidence in a current tree FAILED 3 assertions, and the cause
was real, not a stale-tree artefact:

    NOT FILED: there is no session 'deep-hake-xlurhc'

A scheduled workflow step runs with `MYCOLAB_WORKSPACE=ws-bioengine-a142944f`
(measured with a throwaway dispatch workflow that printed its own environment),
but `deep-hake-xlurhc` resolves only in `ws-bioimage-io-932fc61e`. A session id
resolves only inside its own workspace, so BOTH daily sweeps would drop any
finding on the floor.

This is #0007 and #0015's own failure mode one layer in: they swapped a DEAD
session id for a LIVE one, and the live one was unreachable from where the
scheduler stands. Invisible because both checks are green, so the filing path
never runs for real. It would first have bitten on the morning a real offender
appeared.

Fixed in `fafd8d7`: `MYCO_SWEEP_WORKSPACE` pins the workspace for every myco
subprocess, and an unresolvable session now DEGRADES TO PROJECT SCOPE loudly
rather than returning empty. Both workflow yamls carry the new var on all three
steps. The main checkout's copy is byte-identical, so **the scheduled sweeps are
fixed today regardless of when the merge happens.**

## Two things that stay dirty on purpose

- `tests/screenshots/my-artifacts-populated-authored.png` is REGENERATED by the
  playwright suite on every run, and the re-render differs by ~7.7k subpixels in
  a 77x41 box on the pagination control (a focus state caught mid-transition).
  Restore it after a test run; the committed capture is the clean one.
- The three sweep scripts show as modified/untracked in the MAIN checkout. They
  are byte-identical to the committed quick-river versions (verified with
  `diff <(git show quick-river:<f>) <f>`). That is the merge not having happened,
  not uncommitted work.
