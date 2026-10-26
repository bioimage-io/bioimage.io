# The daily zoo sweeps moved from svamp to myco — 2026-10-24

myco #0007 (paused, awaiting merge approval) and #0015 (closed).

## What runs now

| myco workflow | cron | steps |
|---|---|---|
| `bioimageio-reports-sweep` | `23 7 * * *` | `sweep_reports.py`, then `check_committed_drafts.py` |
| `bioimageio-published-report-check` | `13 7 * * *` | `check_published_model_reports.py` |

Both are stamped `session: deep-hake-xlurhc` and each step exports
`MYCO_SESSION` + `MYCO_SWEEP_SESSION=deep-hake-xlurhc`. The two svamp
originals (`bioimageio-reports-sweep`, `check-published-model-reports`) are
**disabled**, not deleted, so the sweep does not run twice.

## Why it had to move, measured not assumed

A svamp workflow keeps firing after its owning session is archived.
`.svamp/workflows/.runs/bioimageio-reports-sweep.jsonl` records
2026-10-24T05:23:07.798Z, `actor: cute-mare-fidhxj`, `status: success` — a clean
run that filed into an archived session's list in a tracker nobody drains. That
is indistinguishable from "nothing to report", which is the exact failure mode
the sweeps exist to catch one level up.

`check-published-model-reports` had the same rot twice over: owned by
`aged-calf-nysanq` (gone) and alarming a hardcoded `bioengine:even-clam` (also
gone). It had been green on every recorded run, so the broken alarm path had
**never once executed**.

## The files

| File | Tracked? | What it does |
|---|---|---|
| `scripts/_myco_backlog.py` | yes (branch `quick-river`) | shared `file_issue()` + `notify()`; both pin `cwd` to the repo root |
| `scripts/sweep_reports.py` | yes (branch) | user problem reports → myco, notify at `info` |
| `scripts/check_committed_drafts.py` | yes (branch) | unpublished-but-committed artifacts → myco, notify at `warning` |
| `scripts/test_sweep_filing.py` | yes (branch) | seeded end-to-end test, 7 assertions |
| `scripts/check_published_model_reports.py` | **no** — `.git/info/exclude:7` | phantom grid cards → myco, notify at `warning` |
| `scripts/test_published_report_filing.py` | **no** — excluded alongside it | seeded end-to-end test, 10 assertions |

**The session id is never hardcoded in a tracked file.** It comes from
`MYCO_SWEEP_SESSION`, set in the gitignored workflow yaml. A tracked file here
reaches GitHub Copilot through `.github/copilot-instructions.md`, and a myco
session id is machine-local and meaningless there. Unset, `_myco_backlog` files
at **project** scope — ownerless and visible to every session — rather than
falling back to whoever happens to be running.

## State files, all moved to `.mycolab/` with a one-time read-through to `.svamp/`

- `report-sweep-watermark.json` — `1790687301.0`, copied across today.
- `committed-draft-check-state.json` — never existed (no offender has ever been seen).
- `published-report-check-state.json` — new; the old code re-sent its alarm every
  single morning while an offender stood.

Dropping the legacy read-through would re-file history, so keep it.

## The widened committed-draft rule, and why it is asymmetric

An offender is any artifact of **any type** whose status is present and not
`published` (`draft`, `in-review`, `in-revision`, legacy `deletion-requested`),
**plus** any committed **model** with no status at all.

A missing status on a non-model is deliberately not an offender. Of 287
committed children on 2026-10-24: 167 models and 4 datasets `published`, and
**116 with no status field** (65 applications, 46 datasets, 4 notebooks,
1 tracking). Those predate the field and `migrate_status_vocabulary.py`
documents a missing status as legacy and grid-equivalent to published. Widening
naively would have buried every real finding under 116 false positives on run 1.

## Measured today, separately from what was inferred

    check_committed_drafts.py --dry-run        287 committed children, 0 unpublished
    sweep_reports.py --dry-run                 5 reports, 1 open, 0 newer than watermark
    check_published_model_reports.py --dry-run 167 reports | 167 published | offenders: 0
    test_sweep_filing.py                       7/7 assertions, exit 0
    test_published_report_filing.py            10/10 assertions, exit 0
    myco workflow run (both)                   completed, clean
    py_compile (all 5 scripts)                 clean

Both seeded tests patch **only** the listing call; the real `myco issue add` and
`myco session notify` execute, because that is where the defect lived. Each
files a real issue, asserts it is at `scope: session` in this session's own
list, asserts the repeat is suppressed, then closes it and restores the state.

Not validated: the 07:13 and 07:23 scheduled firings have not been observed.
What was observed is the same code path invoked by `myco workflow run` with the
identical environment.

## Open

**#0007 is blocked on merge approval**, not on work. `quick-river` holds 4
commits `main` does not, and the close gate refuses until they land. The fixed
scripts are ALSO sitting uncommitted in the shared main checkout, deliberately,
so tomorrow's 07:23 run executes the fixed code whatever happens to the branch.
If the answer is "do not merge", revert those and re-point the workflow.

Note `local main` is 3 behind / 4 ahead of `origin/main`, and `git fetch origin`
fails with Permission denied (publickey), so a PR is not currently possible.
