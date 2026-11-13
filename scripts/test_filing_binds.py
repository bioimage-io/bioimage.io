#!/usr/bin/env python3
"""Regression harness for myco #0083: a sweep must not report success over a row
nobody can see.

On 2026-11-13 the 07:23 scheduled run of `bioimageio-reports-sweep` filed eight
findings. `myco issue add --session deep-hake-xlurhc` was answered `Created
#0071 (ready)` eight times, stderr was empty, the step exited 0 -- and all eight
rows ended up stored as `scope: session` with an EMPTY session, the one state
`myco issue pending` reports to nobody and nobody can drain. Both pre-existing
guards in `_myco_backlog.py` ask whether the target session RESOLVES; it did.

So this harness pins the property that actually matters, which is the one that
does not depend on knowing the cause: **after a session-scoped filing, the row
is placeable.** Bound to a session, or degraded to project scope, or the sweep
says loudly that it could not tell.

## How the symptom is reproduced without knowing its cause

Through a PATH shim named `myco` that calls the real binary for everything and,
after a successful `issue add`, chains `myco issue edit <id> --unclaim` on the
row it just created. Measured 2026-11-13: `--unclaim` on a freshly added `ready`
row leaves `scope='session'`, `session=None` -- byte-identical to the state the
eight production rows are in. Every participant in the shimmed run still reports
success, exactly as production did.

That is a stand-in for the mechanism, not a claim about it: 12 arms failed to
reproduce the empty session through `myco issue add` itself, including the whole
route re-run under the real workflow runner, which bound 9 rows out of 9. The
shim buys a reproducible instance of the END STATE, which is what a guard can be
tested against.

## Nothing shared is touched

Every arm runs a COPY of the module under test out of its own temp directory.
`_myco_backlog.REPO_ROOT` is `Path(__file__).resolve().parent.parent`, and myco
resolves its issue store by walking up from the cwd it is handed -- so a copy at
`<tmp>/scripts/_myco_backlog.py` files into `<tmp>/.mycolab/issues` and cannot
reach the real backlog. Real myco throughout; no myco internals are faked.

## The arms, and which one is the discriminator

| arm        | module under test     | shim      | must                                     |
|------------|-----------------------|-----------|------------------------------------------|
| fenced     | working tree (fixed)  | orphan    | warn, and rescue the row to project scope |
| reverted   | origin/quick-river    | orphan    | stay silent and leave the row orphaned    |
| healthy    | working tree (fixed)  | pass      | bind, and say nothing                     |
| unreadable | working tree (fixed)  | show fails| warn that the check could not run         |

`reverted` is the discriminator #0083 asks for: it is the same arm as `fenced`
against the pre-fix module, and it must go RED. Without it, `fenced` passing
proves only that the code runs. `healthy` is the other half of the same
question: a guard that fires on a sound filing is not a guard, it is a second
bug. `unreadable` pins the measurement discipline -- a check that could not run
must not read as a pass.

Run: `python3 scripts/test_filing_binds.py`. Exits 0 only if every arm passes.
"""
import importlib.util
import io
import json
import os
import re
import shutil
import subprocess
import sys
import tempfile
from contextlib import redirect_stderr
from pathlib import Path

HERE = Path(__file__).resolve().parent
REPO = HERE.parent
MODULE = HERE / "_myco_backlog.py"
# The production sweep runs PR #124's code out of the shared working tree, and
# `scripts/_myco_backlog.py` there is sha256-identical to this branch's base.
# So the "before" picture is quick-river, not main: main has no such file at all
# and reverting to it would test the absence of the module rather than the
# absence of the fix.
BASE_REF = os.environ.get("FILING_BINDS_BASE_REF", "origin/quick-river")
REAL_MYCO = shutil.which("myco") or "/home/nmechtel/.myco/bin/myco"

# A session that resolves, so `session_resolves()` says yes and the filing takes
# the session-scoped path -- which is the only path that can land in the
# invisible state, and the path the 07:23 run took.
SESSION = os.environ.get("FILING_BINDS_SESSION") or os.environ.get("MYCOLAB_SESSION_ID", "")
WORKSPACE = os.environ.get("FILING_BINDS_WORKSPACE") or os.environ.get("MYCOLAB_WORKSPACE", "")

SHIM = '''#!/usr/bin/env python3
"""A `myco` that is real myco, plus one scripted perturbation.

MODE=orphan     after a successful `issue add`, unclaim the row it created
MODE=showfail   fail every `issue show`
MODE=pass       plain passthrough
"""
import os, re, subprocess, sys

REAL = {real!r}
MODE = os.environ.get("FILING_BINDS_SHIM_MODE", "pass")
args = sys.argv[1:]
log = os.environ.get("FILING_BINDS_SHIM_LOG", "")
if log:
    with open(log, "a") as fh:
        fh.write(" ".join(args) + "\\n")

if MODE == "showfail" and args[:2] == ["issue", "show"]:
    sys.stderr.write("shim: simulated unreadable row\\n")
    sys.exit(7)

done = subprocess.run([REAL, *args], capture_output=True, text=True)
sys.stdout.write(done.stdout)
sys.stderr.write(done.stderr)

if MODE == "orphan" and args[:2] == ["issue", "add"] and done.returncode == 0:
    found = re.search(r"Created #(\\d+)", done.stdout)
    if found:
        subprocess.run([REAL, "issue", "edit", found.group(1), "--unclaim"],
                       capture_output=True, text=True)
sys.exit(done.returncode)
'''


def created_id(stdout: str) -> str:
    found = re.search(r"Created #(\d+)", stdout or "")
    return found.group(1) if found else ""


def read_row(root: Path, issue_id: str):
    """`(scope, session)` for a row, read with REAL myco, bypassing the shim.

    The assertion must not depend on the thing it is testing, and it must not
    read through the perturbation either: in the `showfail` arm the shim refuses
    every `issue show`, so going through it would make the arm unmeasurable
    rather than failing. Keys are read with an `"<ABSENT>"` sentinel, because an
    absent key and a null value are indistinguishable through a bare `.get()`
    and here the difference is the whole verdict.
    """
    done = subprocess.run([REAL_MYCO, "issue", "show", issue_id, "--json"],
                          capture_output=True, text=True, cwd=root,
                          env={**os.environ, "PATH": os.environ["PATH"]})
    if done.returncode != 0:
        return None
    try:
        data = json.loads(done.stdout)
    except ValueError:
        return None
    scope, session = data.get("scope", "<ABSENT>"), data.get("session", "<ABSENT>")
    if scope == "<ABSENT>" or session == "<ABSENT>":
        return None
    return (str(scope or ""), str(session or ""))


def load(path: Path, name: str):
    spec = importlib.util.spec_from_file_location(name, path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def build_arm(tmp: Path, name: str, source: Path, mode: str):
    """A private repo root, a private issue store, and a `myco` shim on PATH."""
    root = tmp / name
    (root / "scripts").mkdir(parents=True)
    (root / ".mycolab" / "issues").mkdir(parents=True)
    shutil.copy2(source, root / "scripts" / "_myco_backlog.py")
    shim_dir = root / "bin"
    shim_dir.mkdir()
    shim = shim_dir / "myco"
    shim.write_text(SHIM.format(real=REAL_MYCO))
    shim.chmod(0o755)
    return root, shim_dir, mode


def run_arm(tmp: Path, name: str, source: Path, mode: str):
    """File one issue through `name`'s module and return what was measured."""
    root, shim_dir, mode = build_arm(tmp, name, source, mode)
    module = load(root / "scripts" / "_myco_backlog.py", f"backlog_{name}")
    assert module.REPO_ROOT == root, f"{name}: module is anchored outside its sandbox"

    log = root / "myco-calls.log"
    saved = dict(os.environ)
    os.environ["PATH"] = f"{shim_dir}:{os.environ['PATH']}"
    os.environ["FILING_BINDS_SHIM_MODE"] = mode
    os.environ["FILING_BINDS_SHIM_LOG"] = str(log)
    os.environ["MYCO_SWEEP_SESSION"] = SESSION
    os.environ["MYCO_SWEEP_WORKSPACE"] = WORKSPACE
    noise = io.StringIO()
    try:
        with redirect_stderr(noise):
            filed = module.file_issue(
                f"#0083 harness arm {name}: delete me",
                "Filed by scripts/test_filing_binds.py into a throwaway store."
                " If you are reading this in a real backlog, the harness leaked.",
                labels=("reports",),
            )
    finally:
        os.environ.clear()
        os.environ.update(saved)

    issue_id = created_id(filed)
    return {
        "name": name,
        "filed": filed,
        "id": issue_id,
        "stderr": noise.getvalue(),
        "stored": read_row(root, issue_id) if issue_id else None,
        "calls": log.read_text().splitlines() if log.exists() else [],
    }


def main() -> int:
    if not SESSION or not WORKSPACE:
        print("ABORT: no session/workspace to file against. Set FILING_BINDS_SESSION"
              " and FILING_BINDS_WORKSPACE, or run from a myco session.", file=sys.stderr)
        return 2

    pre = subprocess.run([REAL_MYCO, "session", "info", SESSION], capture_output=True,
                         text=True, cwd=REPO, env={**os.environ, "MYCOLAB_WORKSPACE": WORKSPACE})
    if pre.returncode != 0:
        print(f"ABORT: session {SESSION!r} does not resolve in workspace {WORKSPACE!r},"
              " so every arm would take the degrade-to-project path and the harness"
              " would pass vacuously.", file=sys.stderr)
        return 2
    print(f"target session {SESSION} resolves in {WORKSPACE}; real myco at {REAL_MYCO}")

    failures = []
    with tempfile.TemporaryDirectory(prefix="filing-binds-") as raw:
        tmp = Path(raw)

        reverted = tmp / "base_myco_backlog.py"
        show = subprocess.run(["git", "show", f"{BASE_REF}:scripts/_myco_backlog.py"],
                              capture_output=True, text=True, cwd=REPO)
        if show.returncode != 0:
            print(f"ABORT: cannot read {BASE_REF}:scripts/_myco_backlog.py"
                  f" ({show.stderr.strip()[:200]})", file=sys.stderr)
            return 2
        reverted.write_text(show.stdout)
        if "verify_bound" in show.stdout:
            print(f"ABORT: {BASE_REF} already contains verify_bound, so the `reverted`"
                  " arm would not be reverted and could not discriminate.", file=sys.stderr)
            return 2
        print(f"reverted arm reads {BASE_REF} ({len(show.stdout)} chars, no verify_bound)")

        # ---- arm: fenced. The fix, against the production end state.
        got = run_arm(tmp, "fenced", MODULE, "orphan")
        want_warn = "EMPTY session" in got["stderr"] and "PROJECT" in got["stderr"]
        want_scope = got["stored"] is not None and got["stored"][0] == "project"
        ok = bool(got["id"]) and want_warn and want_scope
        failures += [] if ok else ["fenced"]
        report("fenced", ok, got,
               "warned about the empty session and rescued the row to project scope",
               f"warned={want_warn} stored={got['stored']}")

        # ---- arm: reverted. THE DISCRIMINATOR. Must go RED.
        got = run_arm(tmp, "reverted", reverted, "orphan")
        silent = "EMPTY session" not in got["stderr"]
        orphaned = got["stored"] is not None and got["stored"] == ("session", "")
        ok = bool(got["id"]) and silent and orphaned
        failures += [] if ok else ["reverted"]
        report("reverted", ok, got,
               "left the row orphaned and said nothing, i.e. reproduced #0083",
               f"silent={silent} stored={got['stored']}")

        # ---- arm: healthy. The guard must be specific, not always-firing.
        got = run_arm(tmp, "healthy", MODULE, "pass")
        quiet = got["stderr"].strip() == ""
        bound = got["stored"] is not None and got["stored"] == ("session", SESSION)
        no_rescue = not any("--scope project" in " ".join([c]) for c in got["calls"])
        ok = bool(got["id"]) and quiet and bound and no_rescue
        failures += [] if ok else ["healthy"]
        report("healthy", ok, got,
               "bound the row, printed nothing and attempted no rescue",
               f"quiet={quiet} stored={got['stored']} no_rescue={no_rescue}")

        # ---- arm: unreadable. A check that could not run is not a pass.
        got = run_arm(tmp, "unreadable", MODULE, "showfail")
        said_so = "could not run is not a pass" in got["stderr"]
        ok = bool(got["id"]) and said_so
        failures += [] if ok else ["unreadable"]
        report("unreadable", ok, got,
               "reported that the read-back failed rather than passing quietly",
               f"said_so={said_so}")

    print()
    if failures:
        print(f"FAIL: {len(failures)} arm(s) failed: {', '.join(failures)}")
        return 1
    print("PASS: 4 arms ran, 4 passed. The fenced arm rescues the row the reverted"
          " arm loses, and the healthy arm shows the guard does not fire on a sound filing.")
    return 0


def report(name: str, ok: bool, got: dict, expectation: str, measured: str):
    print(f"\n[{'PASS' if ok else 'FAIL'}] {name}: must have {expectation}")
    print(f"  filed:    {got['filed'].strip()[:100] or '(nothing)'}")
    print(f"  measured: {measured}")
    for line in got["stderr"].splitlines():
        print(f"  stderr:   {line.strip()[:160]}")
    if not ok:
        print(f"  myco calls: {got['calls']}")


if __name__ == "__main__":
    sys.exit(main())
