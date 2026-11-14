#!/bin/sh
# #0060 -- the served BioEngine skill must not attribute `max_queued_requests` to `deploy_app`.
#
# Exit 0 = all three DONE WHEN clauses hold at the ref under test.
# Exit 1 = a clause is violated.
# Exit 2 = COULD NOT RUN. Deliberately not a pass: a check that cannot run is not green.
#
# Usage: check-0060-queue-param.sh [git-ref]   (default: origin/docs/0321-proxy-admission-params)
#
# Controls that must hold for this script to be worth anything -- run them, do not assume:
#   8bed8ff (divergent local ref, known defective) -> 1
#   0d74d71 (origin head, known corrected)         -> 0
#   origin/main (passage absent entirely)          -> 2
#   a ref that does not exist                      -> 2

REF="${1:-origin/docs/0321-proxy-admission-params}"
F="public/skills/bioengine/SKILL.md"
T=$(mktemp) || { echo "cannot run: mktemp failed" >&2; exit 2; }
trap 'rm -f "$T"' EXIT

git show "$REF:$F" > "$T" 2>/dev/null || {
  echo "cannot run: $REF:$F is not readable" >&2; exit 2; }
[ -s "$T" ] || { echo "cannot run: $REF:$F is empty" >&2; exit 2; }

# The passage must exist at all, else there is nothing to judge and this is NOT a pass.
grep -qF 'Per-deployment admission control' "$T" || {
  echo "cannot run: $REF carries no 'Per-deployment admission control' section" >&2; exit 2; }

rc=0

# Clause 1: the deploy_app layer names max_queued_payloads, in BOTH the table and the example.
if grep -F 'deploy_app' "$T" | grep -qF 'max_queued_payloads'; then
  echo "ok   clause1a: deploy_app table row names max_queued_payloads"
else
  echo "FAIL clause1a: no deploy_app line names max_queued_payloads"; rc=1
fi
if grep -qE '^ *max_queued_payloads *=' "$T"; then
  echo "ok   clause1b: the example passes max_queued_payloads="
else
  echo "FAIL clause1b: the example does not pass max_queued_payloads="; rc=1
fi

# Clause 2a: the @bioengine.app layer KEEPS its max_queued_requests row -- that name is correct there.
if grep -qF '@bioengine.app(max_queued_requests=' "$T"; then
  echo "ok   clause2a: @bioengine.app(max_queued_requests=...) row kept"
else
  echo "FAIL clause2a: the correct @bioengine.app max_queued_requests row is missing"; rc=1
fi

# Clause 2b: THE DEFECT. No line may attribute max_queued_requests to deploy_app, and the
# example must not pass it. Disambiguation prose ("is not Ray Serve's ...", "used to share the
# name ...") legitimately names both and is excluded by the `is not`/`used to share` filter.
bad=$(grep -nF 'max_queued_requests' "$T" \
      | grep -F 'deploy_app' \
      | grep -vF 'is not Ray Serve' \
      | grep -vF 'used to share the name')
if [ -n "$bad" ]; then
  echo "FAIL clause2b: max_queued_requests attributed to deploy_app:"; echo "$bad" | cut -c1-160; rc=1
else
  echo "ok   clause2b: no deploy_app line attributes max_queued_requests"
fi
if grep -qE '^ *max_queued_requests *=' "$T"; then
  echo "FAIL clause2c: the deploy_app example passes max_queued_requests="; rc=1
else
  echo "ok   clause2c: the example does not pass max_queued_requests="
fi

# Clause 3: a version floor, since no RELEASED worker accepts either parameter.
if grep -qF 'Version floor' "$T" && grep -qF 'raises' "$T"; then
  echo "ok   clause3: version floor present and says a predating worker raises"
else
  echo "FAIL clause3: no version floor stating a predating worker raises"; rc=1
fi

[ $rc -eq 0 ] && echo "PASS $REF" || echo "FAIL $REF"
exit $rc
