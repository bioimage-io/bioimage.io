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
"""
import os
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
    return result.stdout.strip()


def notify(message: str, level: str = "warning") -> bool:
    """Raise a myco notification, which reaches the user even when unfocused.

    `myco session notify` acts on THIS session, chosen from the ambient
    environment, so the workflow exports MYCO_SESSION alongside
    MYCO_SWEEP_SESSION. A failure here is reported but never fatal: the issue is
    already filed by the time this runs, and losing the bell is much less bad
    than losing the finding.
    """
    result = subprocess.run(["myco", "session", "notify", message, "--level", level],
                            capture_output=True, text=True, cwd=REPO_ROOT, env=_env())
    if result.returncode != 0:
        print(f"  (notification failed: {(result.stderr or result.stdout).strip()[:200]})",
              file=sys.stderr)
        return False
    return True
