#!/bin/sh
# myco #0066, on whatever tree this runs in.
#
# The served skill renders `application_resources` as a literal. That literal
# must carry its `memory` key. `memory` is the only per-app memory figure an app
# status has anywhere -- there is no top-level `memory` key to fall back on --
# and it is normally non-zero even for a CPU-only app, because `_sum_resources`
# (aicell-lab/bioengine, bioengine/apps/builder.py:441) adds the proxy's own
# reservation unconditionally. A three-key rendering sends a reader looking for
# a memory answer away from the only field that holds one.
#
# Why this file needs its own guard: the repo's other guard over SKILL.md,
# scripts/check-concurrency-doc.sh, stays FULLY green over this regression.
# Measured on a tree built from ed3c3c6 plus that script at e6024a0 (md5
# 429b3138b5c3c9f76c7f870795c7cb58):
#
#   unmutated                      5/5 ok, rc=0
#   memory key dropped out         5/5 ok, rc=0   <- the gap this closes
#   clause-1b line duplicated      clause 4 FAIL, rc=1   <- control, same tree
#
# The control matters: without it the green above is equally explained by that
# guard being inert on this tree. It is not.
#
# Exit 0 = the rendering is intact. Exit 1 = it is not. Exit 2 = could not run,
# which is NOT a pass: a missing file or a vanished section would otherwise make
# every grep below match nothing and read as satisfied.
#
# `-f` because clause 2 splits an unquoted command substitution into words: a
# literal that one day contains `?` or `[` would otherwise be glob-expanded
# against the working directory, and a token that matched a filename would be
# silently rewritten before the memory test ever saw it.
set -uf

F=public/skills/bioengine/SKILL.md
[ -f "$F" ] || { echo "cannot run: $F does not exist" >&2; exit 2; }

rc=0

# The section extractor is lifted verbatim from check-concurrency-doc.sh in this
# same repo, including its fence handling: a `#` at column 0 inside a fenced
# block is a shell comment and not a heading, and a fence is closed only by its
# OWN marker, so the opening marker is remembered rather than toggled on either
# syntax. That script's history is the argument for both -- see its comments.
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

# What counts as "the literal": a brace block that names `num_cpus` as a quoted
# key. That is what distinguishes the rendering from the prose around it, which
# is the point -- SKILL.md mentions `application_resources` in running text in
# at least two other places (line 404 discusses `application_resources.num_gpus`,
# line 694 calls the field unreliable on GPU), and neither of those is a
# rendering of the field's shape. A guard keyed on the words
# `application_resources` would be satisfied by either of them while the literal
# itself lost a key.
#
# Keyed on `num_cpus` rather than on `memory` deliberately: the key under threat
# cannot also be the anchor, or its removal takes the anchor with it and the
# clause reads "no literal found" instead of "the literal lost its memory key".
LITERAL_RE='\{[^}]*"num_cpus"[^}]*\}'

# Clause 1 -- the App lifecycle passage must actually render the field.
#
# IN-PASSAGE on purpose. This is a presence test, and a presence test is only
# weakened by widening it: a literal elsewhere in the file does not help the
# reader of the paragraph that sends them to this field. (The opposite argument
# governs clause 2 below. Scope is a bug in a presence test and a feature in an
# absence test -- the same split check-concurrency-doc.sh arrived at.)
c1=$(printf '%s\n' "$PASSAGE" | grep -cE "$LITERAL_RE")
if [ "$c1" -ge 1 ]; then
  echo "ok    clause 1: the App lifecycle passage renders application_resources as a literal"
else
  echo "FAIL  clause 1: the App lifecycle passage no longer renders application_resources as a literal -- nothing shows the reader the field's shape" >&2
  rc=1
fi

# Clause 2 -- every rendering of the field, anywhere in the file, carries
# `memory`.
#
# FILE-WIDE on purpose, and this is the assertion that actually closes #0062's
# regression. It is an absence test ("no rendering may omit the key"), and
# narrowing an absence test only lets the defect reappear somewhere else and
# still pass. A second, three-key copy dropped into another section is the same
# defect for anyone who reads that section.
#
# Each literal is extracted and tested on its own rather than testing the line,
# so a line carrying two literals cannot be rescued by the other one.
missing=0
total=0
for lit in $(grep -oE "$LITERAL_RE" "$F" | tr ' ' '\001'); do
  total=$((total + 1))
  case "$(printf '%s' "$lit" | tr '\001' ' ')" in
    *'"memory"'*) ;;
    *) missing=$((missing + 1))
       echo "FAIL  clause 2: an application_resources literal omits its memory key: $(printf '%s' "$lit" | tr '\001' ' ')" >&2 ;;
  esac
done
if [ "$total" -eq 0 ]; then
  # Not reachable while clause 1 passes, but say the true thing rather than
  # report "0 of 0 literals are missing the key" as a pass.
  echo "FAIL  clause 2: no application_resources literal anywhere in $F to check" >&2
  rc=1
elif [ "$missing" -eq 0 ]; then
  # Names its scope, as clause 3's message does. The two clauses are scoped
  # differently on purpose (this one file-wide, clause 3 in-passage), and that
  # difference is the whole design; output that states it for one and not the
  # other teaches a reader the wrong half, since they will carry whichever
  # scope they read onto the other count. Same point the reviewer raised on
  # check-concurrency-doc.sh's clause 4.
  echo "ok    clause 2: all $total application_resources literal(s) in $F carry the memory key (counted file-wide)"
else
  rc=1
fi

# Clause 3 -- the passage renders it on exactly one line.
#
# Beyond what myco #0066 asks for, and included because this repo has already
# been bitten by it once: every assertion above is a presence or content test,
# and a file that renders the field twice satisfies both while showing a reader
# two shapes. That is what a naive both-sides merge resolution of two branches
# editing this blockquote produces, and it is the whole of myco #0065. Counting
# LINES, not matches, for the reason that row settled: a match count reads 2 on
# text nobody has touched as soon as one line carries two literals.
if [ "$c1" -gt 1 ]; then
  echo "FAIL  clause 3: the App lifecycle passage renders application_resources on $c1 lines -- a merge resolution duplicated it" >&2
  rc=1
elif [ "$c1" -eq 1 ]; then
  echo "ok    clause 3: the rendering appears on exactly one line of the App lifecycle passage (counted in-passage)"
fi
# c1 = 0 is already reported by clause 1; saying it again here would read as a
# second, independent failure of something that is one problem.

exit "$rc"
