#!/bin/sh
# #0061 -- the BioEngine skill must not claim `get_app_status` can return
# `max_queued_payloads: None`. It cannot: manager.py's status projection resolves the unset case
# to `max_ongoing_requests` and always reports an int. The None is real but lives only in the
# internal `_deployed_applications` record, which no status reader sees.
#
# Exit 0 = all four DONE WHEN clauses hold at the ref under test.
# Exit 1 = a clause is violated.
# Exit 2 = COULD NOT RUN. Deliberately not a pass.
#
# NOTE ON CONTROL DIRECTION: this check has BOTH directions available as of 8c796c8.
# `0d74d71` is the firing control (defect live, expect 1) and `8c796c8` is the passing one
# (the fix, expect 0). An earlier revision of this header said no ref could exit 0; that was
# true when it was written and stopped being true when the fix landed.
#
# Clause 2 used to reject `8c796c8` because it matched only the finite verb `reports` while the
# fix says "is reported as". A clause that a correct fix cannot satisfy is worse than no clause:
# it makes the gate unpassable and reads to a reviewer as unfinished work. The participle forms
# are accepted now, and the mutation control below is what shows the clause still has teeth.
#
# Usage: check-0061-queue-none.sh [git-ref]
# Controls:
#   8c796c8     (the fix)                       -> 0
#   0d74d71     (defect live)                   -> 1
#   8c796c8 with the clause-2 sentence deleted  -> 1, clause2 alone firing
#   8bed8ff     (pre-rename, no such parameter) -> 2
#   origin/main (passage absent entirely)       -> 2
#   1d2b49d     (docs/0323, no such section)    -> 2
#   nonexistent ref                             -> 2

REF="${1:-origin/docs/0321-proxy-admission-params}"
F="public/skills/bioengine/SKILL.md"
T=$(mktemp) || { echo "cannot run: mktemp failed" >&2; exit 2; }
trap 'rm -f "$T"' EXIT

git show "$REF:$F" > "$T" 2>/dev/null || {
  echo "cannot run: $REF:$F is not readable" >&2; exit 2; }
[ -s "$T" ] || { echo "cannot run: $REF:$F is empty" >&2; exit 2; }
grep -qF 'Per-deployment admission control' "$T" || {
  echo "cannot run: $REF carries no 'Per-deployment admission control' section" >&2; exit 2; }
grep -qF 'max_queued_payloads' "$T" || {
  echo "cannot run: $REF names no max_queued_payloads, so #0061's sentence cannot be there" >&2; exit 2; }

rc=0

# Clause 1 + 4: no line may state or imply get_app_status returns max_queued_payloads: None,
# UNLESS it attributes the None to the internal record and marks it invisible to a status reader.
# Fold newlines first: the claim can wrap, and a line-scoped grep cannot see a wrapped phrase.
folded=$(tr '\n' ' ' < "$T")
if printf '%s' "$folded" | grep -qF 'max_queued_payloads: None'; then
  if printf '%s' "$folded" | grep -qiE 'max_queued_payloads: None[^.]{0,400}(internal record|_deployed_applications|not visible to a status reader)'; then
    echo "ok   clause1/4: the None is mentioned but attributed to the internal record"
  else
    echo "FAIL clause1/4: 'max_queued_payloads: None' stated without attributing it to the internal record"
    printf '%s' "$folded" | grep -oE '.{90}max_queued_payloads: None.{110}' | head -2
    rc=1
  fi
else
  echo "ok   clause1/4: no 'max_queued_payloads: None' claim present"
fi

# Clause 2: it must say what the unset case ACTUALLY reports -- the resolved max_ongoing_requests.
if printf '%s' "$folded" | grep -qiE 'max_queued_payloads[^.]{0,300}(report(s|ed)|resolve[sd]|reads back|as deep as)[^.]{0,200}max_ongoing_requests'; then
  echo "ok   clause2: states the unset case reports the resolved max_ongoing_requests"
else
  echo "FAIL clause2: does not say the unset case reports max_ongoing_requests"; rc=1
fi

# Clause 3: the request_timeout_s 600.0 half is CORRECT (manager.py:1537
# `.get("request_timeout_s", 600.0)`) and must survive the edit.
if printf '%s' "$folded" | grep -qF '600.0'; then
  echo "ok   clause3: the request_timeout_s 600.0 statement is preserved"
else
  echo "FAIL clause3: the correct 600.0 half was removed along with the wrong half"; rc=1
fi

[ $rc -eq 0 ] && echo "PASS $REF" || echo "FAIL $REF"
exit $rc
