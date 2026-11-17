#!/usr/bin/env python3
"""Daily sweep of the bioimage-io/bioimage.io GitHub ISSUE list.

Files one myco backlog row per NEW GitHub issue, routed to the backlog that owns
it. See myco issue #0093.

WHY A SWEEP AND NOT A NOTIFICATION
----------------------------------
Automation escalates into the BACKLOG, not the mailbox. A `myco session send`
from a scheduled job arrives as an inbox letter at urgency `normal`: it raises
no `act` count, so it interrupts nothing, and the call exits 0 even when
delivery fails outright (measured 2026-10-27: 4/4 HTTP 500 merely queued, and
exit 0 plus "filed as a letter (queued)" for a recipient no session backs). A
finding that must be acted on therefore goes into a backlog, which a work loop
already polls. This script never messages a session.

=============================================================================
HARD RULE: GITHUB ISSUE #3 IS EXCLUDED, EXPLICITLY AND BY CONSTRUCTION
=============================================================================
`bioimage-io/bioimage.io` issue #3 is the live meeting-minutes thread that
people read and add to. It must never be modified by any route. This script is
a bulk automated operation over the issue list, which is exactly how that rule
gets broken by accident, so the exclusion is designed in TWO independent ways:

  1. NEVER_TOUCH_ISSUES below is an explicit named constant, applied as a
     positive exclusion and covered by its own test case. It is not a filter
     that happens to miss #3 today.

  2. This script is READ-ONLY against GitHub. The only HTTP method it ever
     issues is GET (see _get_json, the single network entry point). There is no
     code path here that can comment, label, close, reopen, assign, milestone,
     pin or lock anything, on #3 or on any other issue.

Those two facts are independent, so neither alone is relied upon. Do not add a
write call to this file. If a future change needs one, the #3 exclusion stops
being a property of the file and has to be re-argued from scratch.
=============================================================================
"""

from __future__ import annotations

import argparse
import json
import os
import re
import subprocess
import sys
import tempfile
import urllib.error
import urllib.request
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
try:
    import _myco_backlog  # noqa: E402  the shared filing route; see file_issue_website
except ModuleNotFoundError as _exc:  # pragma: no cover - environment, not logic
    # `scripts/_myco_backlog.py` is deliberately UNTRACKED in this repo, so that
    # a `git reset --hard` of the shared checkout cannot remove the filing route
    # (see .mycolab/workflows/assert-filing-route.sh). The cost of that choice is
    # that the module is absent from a fresh clone and from any new worktree, and
    # the bare ModuleNotFoundError does not say so. Fail with the remedy instead.
    raise SystemExit(
        "sweep: cannot import _myco_backlog, the shared filing module.\n"
        f"  looked in: {Path(__file__).resolve().parent}\n"
        "  It is UNTRACKED by design, so it is missing from a fresh clone or a new\n"
        "  worktree even though it is present in /data/nmechtel/bioimage.io/scripts/.\n"
        "  Copy it in to run this script outside the main checkout:\n"
        "    cp /data/nmechtel/bioimage.io/scripts/_myco_backlog.py <here>/\n"
        f"  (underlying error: {_exc})"
    ) from _exc

REPO = "bioimage-io/bioimage.io"

# ---------------------------------------------------------------------------
# The exclusion. See the module docstring. A number in this set is never read
# into a row, never classified and never filed, and the sweep says out loud
# that it skipped it so a silent exclusion cannot be mistaken for an absence.
# ---------------------------------------------------------------------------
NEVER_TOUCH_ISSUES = frozenset({3})

# Where the two backlogs live. myco resolves its issue store by walking UP from
# the working directory, and a scheduled run does not start in either repo, so
# every myco call is pinned to one of these rather than trusting the cwd.
WEBSITE_ROOT = Path("/data/nmechtel/bioimage.io")
BIOENGINE_ROOT = Path("/data/nmechtel/bioengine")

# Routing targets. The session id is checked before filing; if it does not
# resolve the row is filed at project scope instead, because an unowned row is
# visible and claimable while a refused `myco issue add --session <unknown>`
# writes nothing and loses the finding entirely.
WEBSITE_SESSION = os.environ.get("SWEEP_WEBSITE_SESSION", "deep-hake-xlurhc")
WEBSITE_WORKSPACE = os.environ.get("SWEEP_WEBSITE_WORKSPACE", "ws-bioimage-io-932fc61e")
BIOENGINE_SESSION = os.environ.get("SWEEP_BIOENGINE_SESSION", "nice-bird-njonwf")
BIOENGINE_WORKSPACE = os.environ.get("SWEEP_BIOENGINE_WORKSPACE", "ws-bioengine-a142944f")

# The latch. `.mycolab/` is git-ignored, so this survives `git reset --hard`,
# `checkout` and `clean -fd` in the shared root checkout. Keeping it in the
# working tree instead would mean a reset silently re-files every open issue.
STATE_PATH = WEBSITE_ROOT / ".mycolab" / "github-issue-sweep-state.json"

ENV_FILE = Path(os.environ.get("BIOIMAGE_IO_ENV_FILE", "/data/nmechtel/bioengine/.env"))

# Keyword routing. Deliberately asymmetric: a row only goes to the BioEngine
# backlog when the BioEngine signal clearly wins, because a row in the wrong
# backlog is visible and fixable whereas one filed to a lane that does not read
# it is not. Ambiguity resolves to the website store with a label saying so.
BIOENGINE_TERMS = (
    "bioengine", "model-runner", "model_runner", "model-finetune", "model_finetune",
    "ray serve", "rayserve", "ray cluster", "worker runtime", "deploy_app",
    "gpu", "cuda", "replica", "denbi", "kth", "nvidia", "inference server",
    "worker dashboard", "setup wizard", "ray actor", "autoscal",
)
WEBSITE_TERMS = (
    "website", "frontend", "upload", "uploader", "editor", "collection",
    "rdf", "bioimageio.spec", "bioimageio.core", "model zoo", "my artifacts",
    "search", "partner", "doi", "review", "thumbnail", "netlify", "page",
    "hypha", "artifact-manager", "token", "login", "skill",
)


# ---------------------------------------------------------------------------
# GitHub, read-only
# ---------------------------------------------------------------------------
def _token() -> str:
    """The GitHub PAT, read from the env file. Never printed."""
    env_token = (os.environ.get("GITHUB_PAT") or "").strip()
    if env_token:
        return env_token
    if not ENV_FILE.is_file():
        raise SystemExit(f"sweep: no GITHUB_PAT in the environment and {ENV_FILE} is absent")
    for line in ENV_FILE.read_text().splitlines():
        if line.startswith("GITHUB_PAT="):
            return line.split("=", 1)[1].strip()
    raise SystemExit(f"sweep: GITHUB_PAT not found in {ENV_FILE}")


def _get_json(url: str, token: str):
    """The ONLY network call in this file, and it is a GET.

    Keeping every request behind one function is what makes the read-only
    property checkable by reading the source rather than by trusting a claim.
    """
    request = urllib.request.Request(url, method="GET")
    request.add_header("Authorization", f"Bearer {token}")
    request.add_header("Accept", "application/vnd.github+json")
    request.add_header("X-GitHub-Api-Version", "2022-11-28")
    with urllib.request.urlopen(request, timeout=60) as response:
        return json.loads(response.read().decode())


def fetch_issues(token: str, state: str = "open") -> list[dict]:
    """Every issue in the repo, pull requests removed and #3 excluded.

    GitHub's /issues endpoint returns pull requests too: any item carrying a
    `pull_request` key IS a pull request. Without that filter the sweep would
    file a backlog row for every open PR, of which this repo has dozens.
    """
    issues: list[dict] = []
    page = 1
    while True:
        batch = _get_json(
            f"https://api.github.com/repos/{REPO}/issues"
            f"?state={state}&per_page=100&page={page}",
            token,
        )
        if not batch:
            break
        issues.extend(batch)
        if len(batch) < 100:
            break
        page += 1
        if page > 20:  # 2000 issues; a runaway loop should stop, loudly.
            print("sweep: WARNING stopped paginating at 20 pages", file=sys.stderr)
            break

    kept, pulls, excluded = [], 0, []
    for item in issues:
        if "pull_request" in item:
            pulls += 1
            continue
        if item.get("number") in NEVER_TOUCH_ISSUES:
            excluded.append(item.get("number"))
            continue
        kept.append(item)

    print(f"sweep: GitHub returned {len(issues)} items: "
          f"{len(kept)} issues kept, {pulls} pull requests dropped, "
          f"{len(excluded)} explicitly excluded {excluded or ''}".rstrip())
    # Say it even when #3 is closed and so absent from an open-state listing:
    # "not mentioned" and "excluded" must not look the same in the log.
    print(f"sweep: NEVER_TOUCH_ISSUES = {sorted(NEVER_TOUCH_ISSUES)} "
          f"(hit {len(excluded)} time(s) in this listing)")
    return kept


# ---------------------------------------------------------------------------
# Routing
# ---------------------------------------------------------------------------
def classify(issue: dict) -> tuple[str, str]:
    """Return (route, why). route is "bioengine" or "website"."""
    haystack = " ".join([
        (issue.get("title") or ""),
        (issue.get("body") or "")[:4000],
        " ".join(label.get("name", "") for label in issue.get("labels") or []),
    ]).lower()

    hits_be = sorted({term for term in BIOENGINE_TERMS if term in haystack})
    hits_web = sorted({term for term in WEBSITE_TERMS if term in haystack})

    # A clear BioEngine signal means strictly more BioEngine terms than website
    # terms. Equal counts, including zero and zero, stay with the website store.
    if len(hits_be) > len(hits_web):
        return "bioengine", (
            f"BioEngine terms {hits_be} outweigh website terms {hits_web}"
        )
    return "website", (
        f"website terms {hits_web} vs BioEngine terms {hits_be}"
        + ("; no term matched either list, so it stays in the default store"
           if not hits_be and not hits_web else "")
    )


def route_is_confident(route: str, why: str) -> bool:
    """Whether the classification is worth trusting on the row.

    A website route chosen only because nothing matched is a default, not a
    decision, and the row should say so.
    """
    return not (route == "website" and "no term matched either list" in why)


# ---------------------------------------------------------------------------
# Filing
# ---------------------------------------------------------------------------
def _myco_env(workspace: str) -> dict:
    env = dict(os.environ)
    if workspace:
        env["MYCOLAB_WORKSPACE"] = workspace
    return env


def session_resolves(session: str, root: Path, workspace: str) -> bool:
    if not session:
        return False
    result = subprocess.run(
        ["myco", "session", "info", session],
        capture_output=True, text=True, cwd=root, env=_myco_env(workspace),
    )
    return result.returncode == 0


def file_issue_website(title: str, body: str, labels: tuple[str, ...]) -> tuple[str, str]:
    """File into THIS repo's backlog, through the shared, proven filing module.

    Delegates to `_myco_backlog.file_issue`, which already solves three traps a
    second implementation would rediscover: it pins every myco call to the repo
    root (myco resolves its store by walking up from the cwd, and cron does not
    start in the repo), it overrides MYCOLAB_WORKSPACE from MYCO_SWEEP_WORKSPACE
    so the target session id resolves, and it checks the session BEFORE filing so
    a miss degrades to project scope instead of myco refusing and writing nothing.

    Reusing it also keeps this script inside `.mycolab/workflows/assert-filing-route.sh`,
    the preflight that asserts a caller really does reach the filing route. That
    guard greps for `_myco_backlog.file_issue`, so routing the website path around
    it would silently opt out of the very check that catches a reverted checkout.
    """
    out = _myco_backlog.file_issue(title, body, labels=list(labels))
    session = _myco_backlog.target_session()
    return out, (f"session {session}" if session else "project")


def file_issue_at(root: Path, workspace: str, session: str, title: str, body: str,
                  labels: tuple[str, ...]) -> tuple[str, str]:
    """File into ANOTHER repo's backlog. Returns (stdout, scope_used).

    Separate from file_issue_website because `_myco_backlog` is pinned to this
    repo's root by design, and the BioEngine route has to reach a different store
    with a different workspace and a different owning session. The protections are
    mirrored rather than inherited: cwd pinned explicitly, workspace overridden,
    session resolved before filing with a degrade to project scope.
    """
    scope_used = f"session {session}"
    if session and not session_resolves(session, root, workspace):
        print(f"  WARNING: session '{session}' does not resolve in workspace "
              f"'{workspace or 'ambient'}'; filing at PROJECT scope so the "
              f"finding is not lost.", file=sys.stderr)
        session = ""
        scope_used = "project (session did not resolve)"
    scope = ["--session", session] if session else ["--scope", "project"]

    with tempfile.NamedTemporaryFile("w", suffix=".md", delete=False) as handle:
        handle.write(body)
        body_path = handle.name
    try:
        cmd = ["myco", "issue", "add", title, "--body-file", body_path,
               "--no-unverified", "--anyway", "--manual", *scope]
        for label in labels:
            cmd += ["--label", label]
        result = subprocess.run(cmd, capture_output=True, text=True,
                                cwd=root, env=_myco_env(workspace))
    finally:
        Path(body_path).unlink(missing_ok=True)

    if result.returncode != 0:
        print(f"  FAILED to file: {(result.stderr or result.stdout).strip()[:300]}",
              file=sys.stderr)
        return "", scope_used
    return result.stdout.strip(), scope_used


def build_title(issue: dict) -> str:
    """A title a stranger can read, with the GitHub number kept out of the front.

    myco derives nothing from this; it is what a human sees on the board.
    """
    raw = (issue.get("title") or "").strip()
    # Strip a leading bracket tag like "[Upload/API]" so the sentence starts
    # with words, and collapse whitespace.
    cleaned = re.sub(r"^\s*\[[^\]]{1,40}\]\s*", "", raw).strip() or raw
    cleaned = re.sub(r"\s+", " ", cleaned)
    if len(cleaned) > 150:
        cleaned = cleaned[:147].rstrip() + "..."
    return f"{cleaned} (GitHub #{issue.get('number')})"


def build_body(issue: dict, route: str, why: str, confident: bool) -> str:
    number = issue.get("number")
    title = (issue.get("title") or "").strip()
    url = issue.get("html_url") or f"https://github.com/{REPO}/issues/{number}"
    created = (issue.get("created_at") or "")[:10]
    labels = ", ".join(label.get("name", "") for label in issue.get("labels") or []) or "none"
    body = (issue.get("body") or "").strip() or "(the GitHub issue has an empty body)"

    confidence_note = (
        "" if confident else
        "\n**The routing is a DEFAULT, not a decision.** No keyword matched either lane, so this "
        "landed in the website store because that is the safer place for an unclassified row. "
        "Re-route it if it belongs elsewhere.\n"
    )

    return f"""A contributor opened a GitHub issue that nothing in this backlog was tracking, so it needs triaging into real work or closing with a reason; finishing it means the reporter gets an answer instead of silence.

Filed automatically by the `bioimage-io-issue-sweep` workflow (myco #0093) from
{REPO} issue #{number}, opened {created}. The sweep reads the issue list and files
rows; it does not post anything to GitHub.

    source     {url}
    title      {title}
    gh labels  {labels}
    routing    {route} ({why})
{confidence_note}
## What to do with this row

Triage it like any other: read the report, measure what it claims rather than taking it on trust,
and either turn it into actionable work or close it with the reason. The reporter's own diagnosis is
in the quoted body below and is NOT authoritative, so treat it as a lead rather than a requirement.

**Do not reply on GitHub without clearance.** Commenting on a contributor's issue is outward-facing
and needs the owner's go.

## DONE WHEN

The issue is either turned into tracked work whose own row names what will close it, or closed here
with the reason recorded, and in both cases the row says which of the two happened. If a reply to
the reporter is wanted, that is a separate step needing clearance and the row says so rather than
implying the conversation happened.

## STUCK WHEN

The report cannot be reproduced without a credential or an environment nobody here holds. Pause with
what was tried and what is missing, naming the credential.

---

## The GitHub issue body, verbatim

{body}
"""


# ---------------------------------------------------------------------------
# State
# ---------------------------------------------------------------------------
def load_state() -> dict:
    if not STATE_PATH.is_file():
        return {"filed": {}}
    try:
        data = json.loads(STATE_PATH.read_text())
    except (json.JSONDecodeError, OSError) as exc:
        # Do NOT silently start from scratch: that re-files every open issue.
        raise SystemExit(f"sweep: state file {STATE_PATH} is unreadable ({exc}); "
                         f"refusing to run rather than re-file every issue")
    data.setdefault("filed", {})
    return data


def save_state(state: dict) -> None:
    STATE_PATH.parent.mkdir(parents=True, exist_ok=True)
    tmp = STATE_PATH.with_suffix(".json.tmp")
    tmp.write_text(json.dumps(state, indent=2, sort_keys=True))
    tmp.replace(STATE_PATH)


# ---------------------------------------------------------------------------
def unfiled(issues: list, already: dict) -> list:
    """The issues the latch has NOT already recorded as filed.

    Extracted from main() so it can be tested directly. It was an inline
    comprehension, and the suite's latch arms only exercised the state STORE
    (save/load/corrupt), so replacing the whole expression with
    `new = list(issues)` — which re-files every open issue every single day —
    left the suite green at 30/30 (reviewer REFUSE on #0093, point 1).

    The keys are STRINGS: the GitHub payload carries `number` as an int and the
    JSON latch can only key on strings, so comparing without str() silently
    matches nothing and re-files everything.
    """
    return [i for i in issues if str(i.get("number")) not in already]


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--dry-run", action="store_true",
                        help="print the routing for every issue and file nothing")
    parser.add_argument("--state", choices=["open", "all"], default="open")
    parser.add_argument("--seed", action="store_true",
                        help="mark every current issue as already filed, without filing. "
                             "For adopting the sweep on a repo with a long history.")
    args = parser.parse_args()

    token = _token()
    issues = fetch_issues(token, state=args.state)
    state = load_state()
    already = state["filed"]

    new = unfiled(issues, already)
    print(f"sweep: {len(issues)} issue(s) in scope, {len(new)} not yet filed")

    if args.seed:
        for issue in issues:
            already[str(issue["number"])] = {"row": "(seeded, not filed)",
                                             "route": "n/a"}
        save_state(state)
        print(f"sweep: seeded {len(issues)} issue(s) as already filed")
        return 0

    filed = 0
    # A dry run reports on EVERY issue in scope, not only the unlatched ones.
    # Iterating `new` meant that after the first real run a dry run printed zero
    # routing lines, so the one command meant for inspecting the routing showed
    # nothing at all once the latch was warm (reviewer REFUSE on #0093, point 3).
    for issue in (issues if args.dry_run else new):
        number = issue["number"]
        route, why = classify(issue)
        confident = route_is_confident(route, why)
        title = build_title(issue)
        print(f"\n--- GitHub #{number} -> {route} "
              f"{'' if confident else '(DEFAULT, unconfirmed) '}---")
        print(f"    {title}")
        print(f"    {why}")

        if args.dry_run:
            continue

        if route == "bioengine":
            root, workspace, session = BIOENGINE_ROOT, BIOENGINE_WORKSPACE, BIOENGINE_SESSION
            labels = ("github-intake", "bioengine", "triage-intake")
        else:
            root, workspace, session = WEBSITE_ROOT, WEBSITE_WORKSPACE, WEBSITE_SESSION
            labels = ("github-intake", "triage-intake")
            if not confident:
                labels += ("routing-unconfirmed",)

        body = build_body(issue, route, why, confident)
        if route == "bioengine":
            out, scope_used = file_issue_at(root, workspace, session, title, body, labels)
        else:
            out, scope_used = file_issue_website(title, body, labels)
        if not out:
            print(f"    NOT filed; leaving #{number} unlatched so the next run retries")
            continue
        print(f"    {out.splitlines()[0] if out else ''}  [{scope_used}]")
        already[str(number)] = {
            "row": out.splitlines()[0] if out else "",
            "route": route,
            "store": str(root),
            "scope": scope_used,
        }
        filed += 1
        save_state(state)  # after each, so a crash cannot re-file what landed

    # NEVER write the latch on a dry run. This used to be unconditional while the
    # line below printed "nothing written": the content happened to be safe,
    # because a dry run returns before mutating `already`, but the FILE was
    # rewritten every time. A dry run racing the real daily run then writes back
    # its own stale snapshot and un-latches whatever the real run had just filed,
    # which re-files those rows tomorrow (reviewer REFUSE on #0093, point 2).
    if not args.dry_run:
        save_state(state)
    print(f"\nsweep: filed {filed} new row(s)"
          + (" (dry run, nothing written)" if args.dry_run else ""))
    return 0


if __name__ == "__main__":
    sys.exit(main())
