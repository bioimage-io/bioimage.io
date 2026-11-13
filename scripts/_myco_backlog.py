#!/usr/bin/env python3
"""File sweep findings into the myco backlog, and notify a human about them.

Imported by `sweep_reports.py` and `check_committed_drafts.py`. Stdlib only, on
purpose: both callers run from a scheduled workflow under the bare system
python, with no virtualenv to activate and no interactive PATH.

## Why this exists at all

Until 2026-10-24 both sweeps filed with a bare `svamp issue add` and no
`--session`, so ownership fell to whichever session the scheduled run executed
as. That session was archived the day before and the workflow kept firing
anyway -- measured, not assumed: the 2026-10-24T05:23Z run is recorded
`status: success` with the archived session as its actor, in
`.svamp/workflows/.runs/`. A detection filed into an archived owner's list in an
undrained tracker is indistinguishable from a clean run, which is the failure
mode both sweeps exist to prevent, one level up.

## The session id is deliberately NOT hardcoded here

A myco session id is machine-local and this file is tracked (and reaches GitHub
Copilot through `.github/copilot-instructions.md`), so the target comes from
`MYCO_SWEEP_SESSION` in the environment. The scheduled workflow lives in
`.mycolab/workflows/`, which is gitignored, and that is where the id belongs.

With no `MYCO_SWEEP_SESSION` set the issue is filed at PROJECT scope instead of
session scope. That is the safe default rather than a fallback to "whoever is
running": a project-scoped issue has no owner and every session can see and
claim it, so a misconfigured environment degrades to "visible to everyone"
rather than back to "private to a session nobody drains".

## The WORKSPACE has to be pinned too, for the same reason (myco #0022)

A session id only resolves inside its own workspace, and a scheduled step does
NOT inherit the workspace of the session the workflow is stamped with. Measured
2026-10-26 with a throwaway dispatch workflow: the step ran with
`MYCOLAB_WORKSPACE` set to a SIBLING workspace, not the one the target session
lives in, so `myco issue add --session <id>` refused outright and the finding
was dropped. That is #0007 and #0015's failure mode one layer
in: those swapped a DEAD session id for a LIVE one, and the live one was
unreachable from where the scheduler stands.

`MYCO_SWEEP_WORKSPACE` carries it, and like the session id it is machine-local,
so it belongs in the gitignored workflow yaml rather than in this tracked file.

The second half of the fix is below: if the session still does not resolve, the
filing DEGRADES TO PROJECT SCOPE rather than returning empty. Losing the finding
is the one outcome these sweeps exist to prevent, and a misconfigured
environment must not be able to cause it.

## Resolving is not the same as sticking (myco #0083)

Both guards above ask whether the target session RESOLVES. On 2026-11-13 the
07:23 run passed an id that resolved at exit 0, was answered `Created #0071
(ready)` eight times with empty stderr, and all eight rows stored an EMPTY
session -- `scope: session` with no session, the one state `myco issue pending`
reports as visible to nobody and drainable by nobody. So `verify_bound()` asks
the other question, the one that matters: did the binding actually stick in the
stored row. It reads the row back after every session-scoped filing and degrades
it to project scope if it did not.

That is a FENCE and not a root cause, and `verify_bound()` says so at length:
12 arms against a throwaway store failed to reproduce the empty session through
`myco issue add` at all, including the whole route re-run under the real
workflow runner, while `myco issue edit --unclaim` reaches the same state on
demand in one command. The sweep cannot control what empties the field later; it
can refuse to report success over a row nobody can see.
"""
import json
import os
import re
import subprocess
import sys
import tempfile
from pathlib import Path

SESSION_ENV = "MYCO_SWEEP_SESSION"
WORKSPACE_ENV = "MYCO_SWEEP_WORKSPACE"
# myco resolves its issue store by walking UP from the working directory. A
# scheduled run does not necessarily start in the repo, and from somewhere else
# the filing would land in a different store (or none) while still exiting 0.
# Pin every myco call to the repo root rather than trusting the ambient cwd.
REPO_ROOT = Path(__file__).resolve().parent.parent


def target_session() -> str:
    return (os.environ.get(SESSION_ENV) or "").strip()


def _env() -> dict:
    """The environment every `myco` subprocess here runs with.

    Overrides MYCOLAB_WORKSPACE when MYCO_SWEEP_WORKSPACE is set, so the session
    id in MYCO_SWEEP_SESSION resolves. Without it the ambient value wins and a
    scheduled run files into the wrong workspace, where the id is unknown.
    """
    env = dict(os.environ)
    workspace = (os.environ.get(WORKSPACE_ENV) or "").strip()
    if workspace:
        env["MYCOLAB_WORKSPACE"] = workspace
    return env


def session_resolves(session: str) -> bool:
    """Whether `session` is a real session in the workspace we will file in.

    Checked BEFORE filing so a miss can degrade to project scope. `myco issue
    add` refuses an unknown session and writes nothing, which would lose the
    finding entirely.
    """
    if not session:
        return False
    result = subprocess.run(
        ["myco", "session", "info", session],
        capture_output=True, text=True, cwd=REPO_ROOT, env=_env(),
    )
    return result.returncode == 0


def created_issue_id(stdout: str) -> str:
    """The id `myco issue add` just created, or "" if its line cannot be parsed.

    The success line is `Created #0071 (ready): <title>`. Matched on the first
    `Created #<digits>` only: the title is echoed after the colon and may carry a
    `#1234` of its own, so a bare `#(\\d+)` search would sometimes return the
    wrong number.
    """
    match = re.search(r"Created #(\d+)", stdout)
    return match.group(1) if match else ""


def stored_binding(issue_id: str):
    """`(scope, session)` for `issue_id` AS STORED, or None if it cannot be read.

    None and `("session", "")` must stay distinguishable: the first is a check
    that could not run, the second is the defect. Both are reported; only the
    second is acted on.

    Every field is read with an `"<ABSENT>"` sentinel rather than a bare
    `.get()`, because an absent key and a null value read identically through
    `.get()` -- and here that difference decides whether the row is broken or
    merely unreadable. `myco issue show --json` really does omit keys (it has no
    `comments` key at all, though the comments are in `body`), so this is not a
    hypothetical.
    """
    result = subprocess.run(["myco", "issue", "show", issue_id, "--json"],
                            capture_output=True, text=True, cwd=REPO_ROOT, env=_env())
    if result.returncode != 0:
        return None
    try:
        data = json.loads(result.stdout)
    except (ValueError, json.JSONDecodeError):
        return None
    if not isinstance(data, dict):
        return None
    scope = data.get("scope", "<ABSENT>")
    session = data.get("session", "<ABSENT>")
    if scope == "<ABSENT>" or session == "<ABSENT>":
        return None
    return (str(scope or ""), str(session or ""))


def verify_bound(issue_id: str, filed: str) -> bool:
    """Read the row back and make sure a session-scoped filing actually bound.

    Returns True when the row is placeable -- bound to a session, or at project
    scope. Returns False when it is not, or when that could not be established.

    ## Why a read-back, when `session_resolves()` already guards the filing

    The guard in `file_issue()` asks whether the session RESOLVES. This asks
    whether it actually STUCK. Those are different questions, and myco #0083 is
    the case where the first answers yes and the second answers no: the
    2026-11-13 07:23 scheduled run passed `--session deep-hake-xlurhc`, an id
    that resolves at exit 0, was answered `Created #0071 (ready)` eight times
    with EMPTY stderr, and all eight rows stored an empty session. `scope:
    session` with no session is the one state `myco issue pending` reports as
    visible to nobody and drainable by nobody, and every participant -- the
    script, the CLI, the scheduler -- reported success over it.

    ## This is a FENCE, not a root-cause fix, and it is labelled as one

    The filing path is not known to be the cause. Measured 2026-11-13 against a
    throwaway store, 12 arms never reproduced it: a dead-but-resolving id, a
    live id, with and without an ambient session in the environment, `--session`
    naming the very session doing the filing, and the entire route re-run
    through the real workflow runner with the production step command, which
    bound 9 rows out of 9. Meanwhile `myco issue edit --unclaim` reaches the
    identical state on demand in one command, which makes a post-filing mutation
    at least as good a candidate as the add itself.

    So this does not claim to know what empties the field. It makes a sweep
    unable to report success over a row nobody can see, which is the property
    the row actually needs and the one that does not depend on the cause.
    """
    issue_id = issue_id.strip()
    if not issue_id:
        print("  WARNING: the filing succeeded but myco's success line could not be"
              " parsed for an issue id, so the row was NOT verified to be bound."
              f" Check it by hand: {filed.strip()[:120]}", file=sys.stderr)
        return False

    binding = stored_binding(issue_id)
    if binding is None:
        print(f"  WARNING: filed #{issue_id}, but reading it back failed, so it was NOT"
              " verified to be bound to a session. A check that could not run is not a"
              " pass -- read the row by hand.", file=sys.stderr)
        return False

    scope, session = binding
    if scope == "session" and not session:
        # The defect. Degrade to project scope rather than failing the run: the
        # finding is already written, and the whole point of these sweeps is
        # that losing one is the worst outcome. Project scope has no owner, is
        # visible to every session and can be claimed, which is where an
        # unbindable finding belongs. Same reasoning as the #0022 degrade above.
        print(f"  WARNING: #{issue_id} was filed at session scope with an EMPTY session,"
              " so it is visible to nobody and nobody can drain it (myco #0083)."
              " Re-scoping it to PROJECT so the finding is not lost.", file=sys.stderr)
        rescue = subprocess.run(["myco", "issue", "edit", issue_id, "--scope", "project"],
                                capture_output=True, text=True, cwd=REPO_ROOT, env=_env())
        after = stored_binding(issue_id)
        if rescue.returncode == 0 and after is not None and after[0] == "project":
            print(f"  #{issue_id} is now at project scope and any session can claim it."
                  " The row is placeable, but the sweep's session routing is broken and"
                  " needs looking at.", file=sys.stderr)
        else:
            print(f"  RESCUE FAILED for #{issue_id}: it is still invisible."
                  f" Fix it by hand with `myco issue edit {issue_id} --scope project`."
                  f" ({(rescue.stderr or rescue.stdout).strip()[:200]})", file=sys.stderr)
        return False
    return True


def file_issue(title: str, body: str, *, labels=(), verify_cmd: str = "") -> str:
    """File one myco issue. Returns the CLI's stdout, or "" if the filing failed.

    `--anyway` is passed because these callers carry their own dedup state (a
    watermark, or a signature map) and have already decided this finding is new.
    myco's own duplicate check is lexical and compares against the whole
    backlog, so a recurring sweep title matches the previous occurrence every
    time and nothing would ever be filed.

    `--no-unverified` says every claim in the body was measured by the sweep,
    which is true: the bodies are generated from the live listing the sweep just
    read, not from a diagnosis.
    """
    session = target_session()
    if session and not session_resolves(session):
        # Do NOT let a misconfigured environment lose the finding. `myco issue
        # add --session <unknown>` refuses and writes nothing; project scope has
        # no owner, is visible to every session, and can be claimed. See #0022.
        # Report the EFFECTIVE workspace, the one session_resolves() actually
        # looked in, not the ambient one. They differ precisely when
        # MYCO_SWEEP_WORKSPACE is doing its job, which is the moment an operator
        # is most likely to be reading this line.
        effective = _env().get("MYCOLAB_WORKSPACE") or "unset"
        pinned = (os.environ.get(WORKSPACE_ENV) or "").strip()
        remedy = (
            f"{WORKSPACE_ENV} is set to '{pinned}' and the session is still unknown there,"
            " so check the id and the workspace it actually lives in"
            if pinned else
            f"set {WORKSPACE_ENV} in the workflow to fix the routing"
        )
        print(
            f"  WARNING: session '{session}' does not resolve"
            f" (looked in workspace {effective});"
            f" filing at PROJECT scope instead so the finding is not lost."
            f" {remedy}.",
            file=sys.stderr,
        )
        session = ""
    scope = ["--session", session] if session else ["--scope", "project"]

    # --body-file rather than --body: these bodies contain backticks and $( ),
    # and the file route is the one myco documents as safe for them.
    with tempfile.NamedTemporaryFile("w", suffix=".md", delete=False) as handle:
        handle.write(body)
        body_path = handle.name
    try:
        cmd = ["myco", "issue", "add", title, "--body-file", body_path,
               "--no-unverified", "--anyway", *scope]
        for label in labels:
            cmd += ["--label", label]
        if verify_cmd:
            cmd += ["--verify-cmd", verify_cmd]
        result = subprocess.run(cmd, capture_output=True, text=True, cwd=REPO_ROOT,
                                env=_env())
    finally:
        Path(body_path).unlink(missing_ok=True)

    if result.returncode != 0:
        print(f"  FAILED to file issue: {(result.stderr or result.stdout).strip()[:300]}",
              file=sys.stderr)
        return ""

    filed = result.stdout.strip()
    # Only the session-scoped path can land in the invisible state; a filing
    # that already degraded to project scope is placeable by construction and
    # re-reading it would only add a way for a healthy run to look broken.
    if session:
        verify_bound(created_issue_id(filed), filed)
    # Deliberately NOT gated on the return value. The caller's contract is "was
    # this finding written", and it was: the row exists either bound or at
    # project scope, and returning "" here would make the sweep leave its
    # watermark alone and re-file the same report tomorrow on top of a row that
    # is already there.
    return filed


def notify(message: str, level: str = "warning") -> bool:
    """Raise a myco notification, which reaches the user even when unfocused.

    A failure here is reported but never fatal: the issue is already filed by the
    time this runs, and losing the bell is much less bad than losing the finding.

    ## MYCO_SESSION does not steer this, contrary to what the workflow assumes

    This docstring used to say `myco session notify` acts on whichever session
    the environment names, "so the workflow exports MYCO_SESSION alongside
    MYCO_SWEEP_SESSION". Measured 2026-11-13 under a throwaway dispatch that
    exported `MYCO_SESSION=deep-hake-xlurhc` exactly as the production workflow
    does: the call still acted on `MYCOLAB_SESSION_ID` and failed with "session
    'able-mule-xedyzl' is not visible in the mesh". MYCO_SESSION was ignored.

    So the workflow's MYCO_SESSION export is inert for this purpose. Whether the
    production run's bell therefore fails is NOT measured here -- that dispatch
    inherited an interactive `MYCOLAB_SESSION_ID`, and what the scheduler sets in
    that variable has not been read. The claim being corrected is only the one
    this docstring made about which variable is consulted.
    """
    result = subprocess.run(["myco", "session", "notify", message, "--level", level],
                            capture_output=True, text=True, cwd=REPO_ROOT, env=_env())
    if result.returncode != 0:
        print(f"  (notification failed: {(result.stderr or result.stdout).strip()[:200]})",
              file=sys.stderr)
        return False
    return True
