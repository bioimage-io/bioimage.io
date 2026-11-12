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

# Clause 1b -- and it must say what the top-level number actually is: the limit the
# application's proxy admits across the whole instance.
#
# Matched on the CLAIM, not on one phrasing. This assertion previously grepped for the
# single literal 'proxy admission limit', which is this branch's own wording -- and it
# therefore FAILED the text that actually landed on main in 1d2b49d, which makes the same
# point as "the application's ProxyDeployment admits across the whole instance" and never
# uses the four-word phrase. A guard that only passes the wording its author happened to
# choose is not a guard, it is a diff. Measured over the three refs that matter:
#
#   904bf29  old main, defect present       0 matches -> FAIL, correct
#   1d2b49d  main after docs/0323 landed    2 matches -> ok,  was a FALSE FAIL before
#   63d599c  this cluster's prose branch    1 match   -> ok
#
# The clause keeps its teeth: deleting the explanation from 1d2b49d drops it to 0.
if grep -qiE 'proxy admission limit|ProxyDeployment admits|proxy admit(s|ting)|admits across the whole instance' "$F"; then
  echo "ok    clause 1: the top-level number is named as the proxy's instance-wide admission limit"
else
  echo "FAIL  clause 1: nothing says the top-level max_ongoing_requests is what the proxy admits" >&2
  rc=1
fi

# Clause 3 -- the redirect must survive for memory and gpu_enabled.
# Case-insensitive on purpose: whether this sentence opens with "Read" or
# continues with "read" is a function of how the surrounding prose was split,
# not of whether the redirect is still there. Matching only the lowercase form
# failed a correct fix over one character -- measured, see the row.
if grep -qi 'read `application_resources` for what the app actually requested' "$F"; then
  echo "ok    clause 3: memory / gpu_enabled keep their application_resources redirect"
else
  echo "FAIL  clause 3: the application_resources redirect is gone for memory / gpu_enabled too" >&2
  rc=1
fi

exit "$rc"
