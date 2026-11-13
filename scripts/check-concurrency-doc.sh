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

# The passage clause 1b governs is the "### App lifecycle" section, and that
# clause must be asked about THAT section rather than about the whole file.
#
# Why: the claim it greps for is also made, legitimately and for a different
# audience, under "### Key rules" at line 245 of main. A file-wide grep is
# therefore satisfied by the Key rules sentence alone -- so deleting the App
# lifecycle explanation outright, which is the regression this guard exists to
# catch, left all three assertions green and the script exiting 0. Measured.
#
# Fence-aware on purpose: a `#` at column 0 inside a fenced block is a shell
# comment, not a heading, and ending the section there would silently truncate
# it. There is a ```bash block inside this section on main today with no such
# line in it, so the trap is latent rather than live -- which is exactly when
# it is cheapest to close.
#
# ⚠ BOTH fence syntaxes, and this clause's first version handled only one.
# CommonMark fences with ``` or with ~~~, and a tilde fence was invisible here:
# the `#` inside it ended the section early, the passage stopped above line 690,
# and clause 1b FAILED correct text. That is a false FAIL on prose nobody broke,
# and it is a regression this scoping INTRODUCED -- the old file-wide clause was
# green on that tree. Found by the reviewer (polar-shark-grvryd) on the APPROVE
# of PR #134 and reproduced here before being fixed, with a backtick-fence tree
# as the control so the mechanism and the marker are told apart:
#
#   ~~~ fence with a column-0 #    rc=1   <- the gap
#   ``` fence with a column-0 #    rc=0   <- same tree, same comment, other marker
#
# The marker is REMEMBERED rather than toggled on either syntax, because a fence
# is closed only by its own character: a ``` line inside a ~~~ block is content,
# and a shared boolean would close the block on it. Costs one variable.
#
# An empty passage means the heading was renamed, removed, or swallowed by an
# unbalanced fence opened above it. That is exit 2, could not run, NOT a pass:
# every grep below would otherwise match nothing and the absence would read as
# clause 1b failing for a reason that is not true. The message names all three,
# because "renamed or removed" sent a reader looking for a heading that was
# sitting there intact.
PASSAGE=$(awk '
  /^(```|~~~)/ {
    marker = substr($0, 1, 3)
    if (!infence)             { infence = 1; fence = marker }
    else if (marker == fence) { infence = 0 }
  }
  started && !infence && /^#+ /              { exit }
  started                                    { print; next }
  !started && !infence && /^### App lifecycle[ \t]*$/ { started = 1 }
' "$F")
if [ -z "$PASSAGE" ]; then
  echo "cannot run: no '### App lifecycle' section in $F -- renamed, removed, or inside an unbalanced code fence" >&2
  exit 2
fi

# Clause 1 -- the old sentence bundled max_ongoing_requests in with the two
# values the redirect does answer for. Matched on the distinctive opening so a
# reworded fix still passes while the original text still fails.
#
# Deliberately FILE-WIDE, unlike clause 1b. This is a negative assertion, and a
# negative assertion is only weakened by narrowing it: the defect reappearing in
# some other section is still the defect. Scope is a bug in a presence test and
# a feature in an absence test.
#
# ⚠ Call this what it is: a REVERT-GUARD, not a defect detector. It matches one
# historical literal, so it catches the old sentence coming BACK -- a revert, a
# bad merge resolution, a stale branch landing late -- and it does NOT catch the
# same mistake written in new words. That matters more than usual right now,
# because several branches are rewriting this paragraph at once, which is exactly
# how a reworded reintroduction would arrive. Clause 1b is what makes a reworded
# passage still have to state the truth; clause 1 only makes the known-bad
# sentence unable to return.
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
# choose is not a guard, it is a diff. Measured over the three refs that matter,
# counting file-wide:
#
#   904bf29  old main, defect present       0 matches -> FAIL, correct
#   1d2b49d  main after docs/0323 landed    2 matches -> ok,  was a FALSE FAIL before
#   63d599c  this cluster's prose branch    1 match   -> ok
#
# ⚠ An earlier version of this comment ended "the clause keeps its teeth: deleting
# the explanation from 1d2b49d drops it to 0." The three counts above are exactly
# right; that last sentence inferred one step too far from them. Those two matches
# were never in the same section -- one is Key rules, one is App lifecycle -- so
# deleting the App lifecycle explanation leaves ONE, not zero, and the file-wide
# form of this clause stayed GREEN over the deletion it exists to catch. Measured
# by the reviewer on PR #134 and reproduced here before being fixed. Hence the
# passage scoping above: the patterns were never the bug, the scope was.
if printf '%s\n' "$PASSAGE" | grep -qiE 'proxy admission limit|ProxyDeployment admits|proxy admit(s|ting)|admits across the whole instance'; then
  echo "ok    clause 1: the top-level number is named as the proxy's instance-wide admission limit"
else
  echo "FAIL  clause 1: the App lifecycle passage does not say the top-level max_ongoing_requests is what the proxy admits" >&2
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
