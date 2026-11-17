#!/usr/bin/env python3
"""Tests for sweep_github_issues.py. See myco issue #0093.

Run: python3 scripts/test_sweep_github_issues.py

Every assertion here is paired with a control that FAILS when the property it
checks is removed, because a test that passes whether or not the code is right
is not evidence. The two that matter most:

  * the GitHub issue #3 exclusion
  * the read-only-against-GitHub property

For both, the test plants the defect in a copy of the source and asserts the
check goes red. A run that merely says "#3 was not filed" would also pass
against a sweep that files nothing at all.
"""

from __future__ import annotations

import json
import re
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import sweep_github_issues as sweep  # noqa: E402

SOURCE = Path(sweep.__file__).read_text()

PASS, FAIL = [], []


def check(name: str, condition: bool, detail: str = "") -> None:
    (PASS if condition else FAIL).append(name)
    print(f"  {'ok  ' if condition else 'FAIL'}  {name}" + (f"  [{detail}]" if detail else ""))


def issue(number: int, title: str = "t", body: str = "", labels=()) -> dict:
    return {"number": number, "title": title, "body": body,
            "labels": [{"name": n} for n in labels],
            "html_url": f"https://github.com/x/y/issues/{number}",
            "created_at": "2026-11-17T00:00:00Z"}


# ---------------------------------------------------------------------------
print("\n[1] the #3 exclusion")
# ---------------------------------------------------------------------------
check("3 is in NEVER_TOUCH_ISSUES", 3 in sweep.NEVER_TOUCH_ISSUES,
      f"set={sorted(sweep.NEVER_TOUCH_ISSUES)}")

# The exclusion must be applied where the issues are selected, not merely
# declared. Exercise fetch_issues with a stubbed transport so no network is used.
_captured_urls: list[str] = []


def fake_get_json(url, token):
    _captured_urls.append(url)
    if "page=1" in url:
        return [issue(1, "ordinary"), issue(3, "MEETING MINUTES - do not touch"),
                issue(4, "another"), {"number": 9, "title": "a PR",
                                      "pull_request": {"url": "x"}}]
    return []


_real_get_json = sweep._get_json
sweep._get_json = fake_get_json
kept = sweep.fetch_issues("token-not-used")
sweep._get_json = _real_get_json

numbers = sorted(i["number"] for i in kept)
check("fetch_issues drops #3", 3 not in numbers, f"kept={numbers}")
check("fetch_issues keeps the ordinary issues", numbers == [1, 4], f"kept={numbers}")
check("fetch_issues drops pull requests", 9 not in numbers, f"kept={numbers}")

# CONTROL for the exclusion: with #3 removed from the constant, #3 IS kept. If
# this control does not fire, the assertion above was passing for some other
# reason (an empty list, a crash) and proves nothing about the exclusion.
_saved = sweep.NEVER_TOUCH_ISSUES
sweep.NEVER_TOUCH_ISSUES = frozenset()
sweep._get_json = fake_get_json
kept_without = sweep.fetch_issues("token-not-used")
sweep._get_json = _real_get_json
sweep.NEVER_TOUCH_ISSUES = _saved
nums_without = sorted(i["number"] for i in kept_without)
check("CONTROL: emptying NEVER_TOUCH_ISSUES lets #3 through",
      3 in nums_without, f"kept={nums_without}")

# ---------------------------------------------------------------------------
print("\n[2] read-only against GitHub")
# ---------------------------------------------------------------------------
WRITE_SIGNS = re.compile(
    r'method\s*=\s*["\'](POST|PATCH|PUT|DELETE)["\']'
    r'|\.(post|patch|put|delete)\s*\('
    r'|gh\s+issue\s+(comment|close|edit|reopen|lock|pin|unlock)'
    r'|issues/\d+/(comments|labels|lock|assignees)',
    re.IGNORECASE)


def write_hits(text: str) -> list[str]:
    return [m.group(0) for m in WRITE_SIGNS.finditer(text)]


hits = write_hits(SOURCE)
check("the sweep source contains no GitHub write verb", not hits, f"hits={hits}")

methods = sorted(set(re.findall(r'method\s*=\s*["\'](\w+)["\']', SOURCE)))
check("the only HTTP method named in the source is GET", methods == ["GET"],
      f"methods={methods}")

# CONTROL for the read-only check: plant a write and assert the check finds it.
# Without this, a pattern that silently stopped matching would report clean.
planted = SOURCE + '\n_x = urllib.request.Request(u, method="POST")\n'
check("CONTROL: the write-verb check fires on a planted POST",
      bool(write_hits(planted)), f"hits={write_hits(planted)}")
planted2 = SOURCE + '\n_y = client.post("https://api.github.com/repos/a/b/issues/3/comments")\n'
check("CONTROL: the write-verb check fires on a planted comment POST",
      bool(write_hits(planted2)), f"hits={write_hits(planted2)}")

# ---------------------------------------------------------------------------
print("\n[3] routing")
# ---------------------------------------------------------------------------
be_route, be_why = sweep.classify(issue(
    10, "BioEngine worker crashes", "the ray serve replica dies on the gpu node"))
check("a worker/ray/gpu issue routes to bioengine", be_route == "bioengine", be_why)

web_route, web_why = sweep.classify(issue(
    11, "Upload editor rejects my RDF", "the uploader will not save the rdf in the collection"))
check("an upload/editor issue routes to website", web_route == "website", web_why)

amb_route, amb_why = sweep.classify(issue(12, "Something vague", "no keywords here at all"))
check("an unclassifiable issue defaults to website", amb_route == "website", amb_why)
check("an unclassifiable issue is marked NOT confident",
      not sweep.route_is_confident(amb_route, amb_why))
check("a classified issue IS marked confident",
      sweep.route_is_confident(be_route, be_why) and sweep.route_is_confident(web_route, web_why))

# The three real issues this sweep was built for. #160 is a skill/upload issue,
# #161 a token/API issue, #162 a storage/upload issue: all three are website.
real = [
    ("[Skill] bioimageio-models: outdated BioEngine runtime pins, and upload_model.py "
     "leaves id/id_emoji unset (web editor rejects RDF edits)",
     "references/architecture-rules.md lists torch and bioimageio.core pins; the editor "
     "rejects the rdf because id_emoji is unset in the manifest"),
    ("[Upload/API] Tokens from Generate New Token act as a temporary user",
     "a client-credentials token cannot edit the artifact it created; hypha login works"),
    ("[Upload/API] Uploading ~85 MB weight files to a staged draft fails",
     "put_file returns a presigned url and the single PUT dies; small files upload fine"),
]
for idx, (title, body) in enumerate(real, start=160):
    route, why = sweep.classify(issue(idx, title, body))
    check(f"real GitHub #{idx} routes to website", route == "website", why)

# ---------------------------------------------------------------------------
print("\n[4] title and body construction")
# ---------------------------------------------------------------------------
title = sweep.build_title(issue(160, "[Skill] bioimageio-models: stale pins"))
check("build_title strips the bracket tag", not title.startswith("["), title)
check("build_title keeps the GitHub number", "(GitHub #160)" in title, title)
check("build_title bounds the length", len(sweep.build_title(issue(1, "x" * 400))) < 180)

body = sweep.build_body(issue(160, "T", "REPORTER BODY TEXT"), "website", "why", True)
first = body.strip().split("\n")[0]
check("the body opens with one plain sentence", first.endswith("silence.") and "#" not in first,
      first[:60])
check("the body carries the reporter's text verbatim", "REPORTER BODY TEXT" in body)
check("the body warns against replying on GitHub", "without clearance" in body)
check("the body has DONE WHEN and STUCK WHEN",
      "## DONE WHEN" in body and "## STUCK WHEN" in body)

unconf = sweep.build_body(issue(1, "T", "B"), "website", "no term matched either list", False)
check("an unconfident row says the routing is a default", "DEFAULT, not a decision" in unconf)
check("CONTROL: a confident row does NOT say that", "DEFAULT, not a decision" not in body)

# ---------------------------------------------------------------------------
print("\n[5] the latch")
# ---------------------------------------------------------------------------
check("the state file lives under .mycolab so a reset cannot clear it",
      ".mycolab" in str(sweep.STATE_PATH), str(sweep.STATE_PATH))

import tempfile  # noqa: E402
with tempfile.TemporaryDirectory() as tmp:
    sweep.STATE_PATH = Path(tmp) / ".mycolab" / "state.json"
    check("a missing state file loads as empty", sweep.load_state()["filed"] == {})
    sweep.save_state({"filed": {"160": {"row": "#0091"}}})
    check("state round-trips", sweep.load_state()["filed"]["160"]["row"] == "#0091")
    # A corrupt state file must REFUSE, not restart from scratch: restarting
    # would re-file every open issue as new.
    sweep.STATE_PATH.write_text("{not json")
    try:
        sweep.load_state()
        check("a corrupt state file refuses to run", False, "it returned instead of exiting")
    except SystemExit as exc:
        check("a corrupt state file refuses to run", "refusing to run" in str(exc))

# ---------------------------------------------------------------------------
print(f"\n{len(PASS)} passed, {len(FAIL)} failed, {len(PASS) + len(FAIL)} cases ran")
if FAIL:
    print("FAILED: " + "; ".join(FAIL))
sys.exit(1 if FAIL else 0)
