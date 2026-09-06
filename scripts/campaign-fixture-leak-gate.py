#!/usr/bin/env python3
"""
Prove that no campaign fixture data reaches the production bundle.

    ./node_modules/.bin/react-scripts build      # never with CI=true
    python3 scripts/campaign-fixture-leak-gate.py

The campaigns page renders what the campaign service reports or it renders
nothing. Illustrative figures exist only in src/services/__fixtures__/campaigns.ts
and are switched on by REACT_APP_CAMPAIGN_FIXTURES=1, which production never
sets. This gate checks the claim rather than trusting it: a fixture chunk that
is emitted but unreachable is still a served file full of invented numbers, and
a source map still carries the fixture text even when the JS does not.

Why this file is checked in
---------------------------
It used to be a scratch script, re-created and deleted every round. In that form
it spent several rounds passing FOR THE WRONG REASON, and nobody could have
noticed, because every assertion it makes is negative: "this fabricated figure
appears nowhere". That class of check passes identically when the value is
absent and when the probe is broken. The green tick is the same tick. A check
whose only failure mode is silent has to live where it can be reviewed.

Two design rules follow from how it broke before.

1. PROBES ARE DERIVED, NOT LISTED. Earlier versions hardcoded a dozen probe
   strings picked by hand, and several were wrong: some named values that live
   in campaignService.ts or campaign.ts, which are ALWAYS bundled, so they
   reported leaks that were not leaks. Others named values that had never been
   in the fixture at all and could never have fired. Here every probe is
   harvested from the fixture module and then proven fixture-EXCLUSIVE by
   grepping the rest of src/ for it. A candidate that appears anywhere else is
   discarded rather than reported.

2. NUMERIC SEPARATORS ARE STRIPPED FROM BOTH SIDES. TypeScript source spells a
   number 7_760_000 and the bundle spells it 7760000. Comparing the two
   directly means the numeric probes silently match nothing, which is precisely
   how the earlier version came to be vacuous. STRIP_SEPARATORS normalises both
   the probes and the text being searched.

Run with --self-test to make the gate prove it can still fail. It builds a
copy of the bundle with three classes of leak injected (a string, a
separator-spelled number, and a reference to the fixture module) and requires
that all three are caught. Do not trust a passing run of this script that has
not been paired with a passing self-test after any edit to it.
"""

import argparse
import glob
import os
import re
import shutil
import subprocess
import sys

REPO = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
FIXTURE = os.path.join("src", "services", "__fixtures__", "campaigns.ts")
BUNDLE = os.path.join("build", "static", "js")
FIXTURE_MODULE_REF = "__fixtures__/campaigns"

# TS writes 7_760_000, the bundle writes 7760000. Normalise both sides.
STRIP_SEPARATORS = re.compile(r"(?<=\d)_(?=\d)")

# Quoted strings long enough to be distinctive, plus any 6-or-more digit number.
STRING_CANDIDATES = re.compile(r"'([A-Za-z][A-Za-z0-9 ,.\-]{7,60})'")
NUMBER_CANDIDATES = re.compile(r"\b\d[\d_]{5,}\b")


def occurrences(haystack: str, needle: str) -> int:
    """Boundary-anchored count.

    Unanchored substring matching produces false hits: short numeric probes
    collide with the path coordinates inside react-icons SVG data, which is
    real bundle content that has nothing to do with campaigns.
    """
    pattern = r"(?<![A-Za-z0-9])" + re.escape(needle) + r"(?![A-Za-z0-9])"
    return len(re.findall(pattern, haystack))


def appears_outside_fixture(value: str) -> bool:
    """True if `value` occurs anywhere in src/ other than the fixture module."""
    result = subprocess.run(
        ["grep", "-rlF", value, "src"], capture_output=True, text=True, cwd=REPO
    )
    hits = [
        f
        for f in result.stdout.split()
        if os.path.normpath(f) != os.path.normpath(FIXTURE)
    ]
    return bool(hits)


def collect_probes() -> list:
    """Values that exist in the fixture module and nowhere else in src/."""
    source = open(os.path.join(REPO, FIXTURE), encoding="utf8").read()
    candidates = set(STRING_CANDIDATES.findall(source))
    candidates |= {STRIP_SEPARATORS.sub("", m) for m in NUMBER_CANDIDATES.findall(source)}
    return sorted(c for c in candidates if not appears_outside_fixture(c))


def scan(directory: str, probes: list) -> list:
    """Every fixture value, and any fixture-module reference, found in `directory`."""
    findings = []
    js = sorted(glob.glob(os.path.join(directory, "*.js")))
    maps = sorted(glob.glob(os.path.join(directory, "*.js.map")))
    if not js:
        raise SystemExit(f"no bundle in {directory}. Run the production build first.")

    for path in js + maps:
        raw = open(path, encoding="utf8", errors="ignore").read()
        text = STRIP_SEPARATORS.sub("", raw)
        for probe in probes:
            count = occurrences(text, probe)
            if count:
                findings.append((os.path.basename(path), repr(probe), count))
        # Structural check, JS only. A source map naming the module would only
        # mean the map was generated from a graph that once considered it.
        if path.endswith(".js") and FIXTURE_MODULE_REF in raw:
            findings.append((os.path.basename(path), "<fixture module referenced>", 1))
    return findings, len(js), len(maps)


def self_test(probes: list) -> int:
    """Inject three classes of leak into a copy and require all three are caught."""
    scratch = os.path.join("/tmp", "campaign-leak-gate-selftest")
    shutil.rmtree(scratch, ignore_errors=True)
    shutil.copytree(os.path.join(REPO, BUNDLE), scratch)

    string_probe = next((p for p in probes if not p.isdigit()), None)
    number_probe = next((p for p in probes if p.isdigit()), None)
    if not string_probe or not number_probe:
        print("SELF-TEST INCONCLUSIVE: fixture has no usable string or numeric probe")
        return 1

    spaced = STRIP_SEPARATORS.pattern and "_".join(
        [number_probe[:1], number_probe[1:4], number_probe[4:]]
    )
    target = sorted(glob.glob(os.path.join(scratch, "*.js")))[0]
    with open(target, "a", encoding="utf8") as handle:
        handle.write(
            f'\nvar _leakA="{string_probe}";'
            f"var _leakB={spaced};"
            f'var _leakC=require("./{FIXTURE_MODULE_REF}");\n'
        )

    findings, _, _ = scan(scratch, probes)
    kinds = {
        "string": any(string_probe in f[1] for f in findings),
        "separator-spelled number": any(number_probe in f[1] for f in findings),
        "fixture module reference": any("fixture module" in f[1] for f in findings),
    }
    shutil.rmtree(scratch, ignore_errors=True)

    for kind, caught in kinds.items():
        print(f"  {'caught' if caught else 'MISSED'}: {kind}")
    if all(kinds.values()):
        print("SELF-TEST PASS: the gate rejects a leaking bundle")
        return 0
    print("SELF-TEST FAIL: the gate cannot detect a leak it should detect")
    return 1


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--self-test",
        action="store_true",
        help="prove the gate can fail, by scanning a deliberately leaking copy",
    )
    args = parser.parse_args()

    probes = collect_probes()
    if not probes:
        # Not a pass. An empty probe set would make every assertion below
        # trivially true, which is the failure this whole script exists to
        # avoid making somewhere else.
        print("FAIL: no fixture-exclusive probes found. The gate would be vacuous.")
        return 1
    print(f"{len(probes)} fixture-exclusive probes")

    if args.self_test:
        return self_test(probes)

    findings, n_js, n_maps = scan(os.path.join(REPO, BUNDLE), probes)
    print(f"scanned {n_js} js + {n_maps} maps")
    for name, probe, count in findings:
        print(f"  LEAK {name}: {probe} x{count}")
    if findings:
        print(f"FAIL: {len(findings)} fixture value(s) reached the production bundle")
        return 1
    print("PASS: no fixture data and no fixture module in the production bundle")
    return 0


if __name__ == "__main__":
    sys.exit(main())
