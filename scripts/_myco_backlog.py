#!/usr/bin/env python3
"""File sweep findings into the myco backlog, and notify a human about them.

Imported by `sweep_reports.py` and `check_committed_drafts.py`. Stdlib only, on
purpose: both callers run from a scheduled workflow under the bare system
python, with no virtualenv to activate and no interactive PATH.

## Why this exists at all

Until 2026-10-24 both sweeps filed with a bare `svamp issue add` and no
`--session`, so ownership fell to whichever session the scheduled run executed
as. That session (`cute-mare-fidhxj`) was archived on 2026-10-23 and the
workflow kept firing anyway -- measured, not assumed: the 2026-10-24T05:23Z run
is recorded `status: success, actor: cute-mare-fidhxj` in
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
"""
import os
import subprocess
import sys
import tempfile
from pathlib import Path

SESSION_ENV = "MYCO_SWEEP_SESSION"
# myco resolves its issue store by walking UP from the working directory. A
# scheduled run does not necessarily start in the repo, and from somewhere else
# the filing would land in a different store (or none) while still exiting 0.
# Pin every myco call to the repo root rather than trusting the ambient cwd.
REPO_ROOT = Path(__file__).resolve().parent.parent


def target_session() -> str:
    return (os.environ.get(SESSION_ENV) or "").strip()


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
        result = subprocess.run(cmd, capture_output=True, text=True, cwd=REPO_ROOT)
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
                            capture_output=True, text=True, cwd=REPO_ROOT)
    if result.returncode != 0:
        print(f"  (notification failed: {(result.stderr or result.stdout).strip()[:200]})",
              file=sys.stderr)
        return False
    return True
