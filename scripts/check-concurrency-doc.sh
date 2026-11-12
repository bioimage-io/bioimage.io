#!/bin/sh
# Clauses 1 and 3 of myco #0058, on whatever tree this runs in.
#
# Clause 1: the served skill must not send a reader to `application_resources`
#           for `max_ongoing_requests` -- that field cannot hold the answer.
# Clause 3: `memory` and `gpu_enabled` must KEEP that redirect, which is correct
#           for them. A fix that drops it has over-corrected.
#
# Clauses 2 (per-deployment field, waits on aicell-lab/bioengine PR #298) and 4
# (curl the served copy, waits on merge + deploy) cannot be checked from a tree
# and are deliberately not attempted here -- see the row.
#
# Exit 0 = both clauses hold. Exit 1 = one does not. Exit 2 = could not run,
# which is NOT a pass: a missing file would otherwise make every grep below
# match nothing and read as clause 1 satisfied.
set -u

F=public/skills/bioengine/SKILL.md
[ -f "$F" ] || { echo "cannot run: $F does not exist" >&2; exit 2; }

rc=0

# Clause 1 -- the old sentence bundled max_ongoing_requests in with the two
# values the redirect does answer for. Matched on the distinctive opening so a
# reworded fix still passes while the original text still fails.
if grep -q 'max_ongoing_requests` has been observed reporting' "$F"; then
  echo "FAIL  clause 1: still groups max_ongoing_requests with the application_resources redirect" >&2
  rc=1
else
  echo "ok    clause 1: max_ongoing_requests no longer redirected to application_resources"
fi

# Clause 1b -- and it must say what the top-level number actually is.
if grep -q 'proxy admission limit' "$F"; then
  echo "ok    clause 1: the top-level number is named as the proxy admission limit"
else
  echo "FAIL  clause 1: nothing calls the top-level max_ongoing_requests the proxy admission limit" >&2
  rc=1
fi

# Clause 3 -- the redirect must survive for memory and gpu_enabled.
if grep -q 'read `application_resources` for what the app actually requested' "$F"; then
  echo "ok    clause 3: memory / gpu_enabled keep their application_resources redirect"
else
  echo "FAIL  clause 3: the application_resources redirect is gone for memory / gpu_enabled too" >&2
  rc=1
fi

exit "$rc"
