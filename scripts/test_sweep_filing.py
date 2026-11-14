#!/usr/bin/env python3
"""Prove the daily sweeps file where a live session will actually see them.

    MYCO_SWEEP_SESSION=<id> BIOIMAGE_IO_TOKEN=<tok> python3 scripts/test_sweep_filing.py

This is the regression test for myco #0007. Both assertions it makes were, until
2026-10-24, false in production while every scheduled run still reported success:
the sweep filed into an archived session's list in a tracker nobody drains, which
is indistinguishable from a clean run.

The live collection has zero offenders -- that is the point of the check -- so the
only way to exercise the filing path is to seed one. This patches ONLY
`check_committed_drafts.list_committed()`. The offender rule, the dedup state, the
issue body, the real `myco issue add` and the real `myco session notify` all run
unpatched, so a pass here means the scheduled run would really file.

Asserted:

  1. a forced run against a seeded offender produces an issue that is in THIS
     session's own list, at session scope;
  2. a second run with the same offenders is suppressed by the dedup state, so a
     standing offender does not re-file every morning;
  3. the two negative controls are NOT flagged -- a legacy application with no
     status, and a published model.

The real dedup state is backed up and restored, and the issue filed in step 1 is
closed again, so running this leaves the backlog as it found it.
"""
import os
import re
import shutil
import subprocess
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import check_committed_drafts as chk  # noqa: E402

REPO_ROOT = Path(__file__).resolve().parent.parent

# Two offenders and two negative controls. The ids are synthetic and deliberately
# self-describing: if one ever escapes into a real backlog, it says what it is.
SEEDED = [
    {"id": "bioimage-io/seeded-test-artifact-0007", "type": "model",
     "manifest": {"status": "in-review"}, "versions": [{"version": "v0"}]},
    {"id": "bioimage-io/seeded-test-model-nostatus-0007", "type": "model",
     "manifest": {}, "versions": [{"version": "v0"}, {"version": "v1"}]},
    # negative control: predates the status field, grid-equivalent to published
    {"id": "bioimage-io/seeded-legacy-application-0007", "type": "application",
     "manifest": {}, "versions": [{"version": "v0"}]},
    # negative control: the ordinary healthy case
    {"id": "bioimage-io/seeded-published-0007", "type": "model",
     "manifest": {"status": "published"}, "versions": [{"version": "v1"}]},
]
OFFENDERS = {"bioimage-io/seeded-test-artifact-0007",
             "bioimage-io/seeded-test-model-nostatus-0007"}

failures = []


def check(ok: bool, what: str) -> None:
    print(f"  {'PASS' if ok else 'FAIL'}  {what}")
    if not ok:
        failures.append(what)


def myco(*args: str) -> subprocess.CompletedProcess:
    return subprocess.run(["myco", *args], capture_output=True, text=True, cwd=REPO_ROOT)


def main() -> int:
    session = os.environ.get("MYCO_SWEEP_SESSION", "").strip()
    if not session:
        sys.exit("MYCO_SWEEP_SESSION is not set; this test asserts on a named session's list.")

    chk.list_committed = lambda: SEEDED
    flagged = {it["id"] for it in SEEDED if chk.is_offender(it)}

    print("clause 3: the offender rule")
    check(flagged == OFFENDERS, f"flags exactly the 2 unpublished artifacts (got {len(flagged)})")

    backup = None
    if chk.STATE.exists():
        backup = chk.STATE.with_suffix(".json.test-bak")
        shutil.copy2(chk.STATE, backup)
    filed_id = ""
    try:
        print("clause 1: a forced run files into this session's list")
        chk.STATE.unlink(missing_ok=True)
        sys.argv = ["check_committed_drafts.py"]
        # file_issue() prints "  filed -> Created #NNNN (ready): ..."
        import io
        import contextlib
        buf = io.StringIO()
        with contextlib.redirect_stdout(buf):
            chk.main()
        out = buf.getvalue()
        print("".join(f"    {line}\n" for line in out.strip().splitlines()))
        match = re.search(r"Created #(\d+)", out)
        check(bool(match), "the run filed an issue")
        if match:
            filed_id = match.group(1)
            shown = myco("issue", "show", filed_id).stdout
            check("scope: session" in shown, f"#{filed_id} is at session scope, not project")
            listed = myco("issue", "list", "--session", session).stdout
            check(f"#{filed_id}" in listed,
                  f"#{filed_id} appears in `myco issue list --session {session}`")

        print("clause 2: the dedup state does not suppress a NEW offender, "
              "but does suppress a repeat")
        check(chk.STATE.exists(), "run 1 wrote the dedup state")
        buf2 = io.StringIO()
        with contextlib.redirect_stdout(buf2):
            chk.main()
        second = buf2.getvalue()
        check("Created #" not in second, "run 2 filed nothing (the repeat was suppressed)")
        check(second.count("[already filed]") == len(OFFENDERS),
              "run 2 saw both offenders as already filed")
    finally:
        if filed_id:
            myco("issue", "comment", filed_id,
                 "Seeded test exhaust from scripts/test_sweep_filing.py (myco #0007). "
                 "The artifact ids are synthetic and do not exist in the collection.")
            myco("issue", "close", filed_id, "--force", "--why",
                 "Seeded test exhaust from scripts/test_sweep_filing.py; not a real finding.")
            print(f"  cleaned up: closed #{filed_id}")
        if backup:
            shutil.copy2(backup, chk.STATE)
            backup.unlink(missing_ok=True)
            print("  restored the real dedup state")
        else:
            chk.STATE.unlink(missing_ok=True)

    print()
    if failures:
        print(f"FAILED: {len(failures)} assertion(s)")
        for f in failures:
            print(f"  - {f}")
        return 1
    print("OK: all assertions passed")
    return 0


if __name__ == "__main__":
    sys.exit(main())
