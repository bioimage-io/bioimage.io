#!/bin/bash
# Re-runnable verification for the finetune page arming runs that
# cannot work).
#
#   bash notes/verify/verify-finetune-readiness.sh
#
# Exists because of a trap a reviewer hit on the first pass. The recipe on the
# issue named a tunnel URL, and that tunnel serves whatever branch its worktree
# happens to be on. This worktree moved to other work, so the tunnel went on
# serving the PRE-FIX tree while the recipe still pointed at it. Following the
# recipe then gives `2 failed` at the exact assertions the fix is about, which
# reads as "the fix is broken" and is actually "you are testing the wrong code".
# A verification that can fail that way is worse than none, because it produces
# a confident wrong conclusion.
#
# So this refuses BEFORE running the spec unless the served bundle actually
# contains the fix, and says which of the two problems it is.
set -uo pipefail

REPO="${REPO:-$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)}"
BASE_URL="${E2E_BASE_URL:-https://tl-colab-dev-2bc6ffc3.hypha.run}"
SPEC="tests/finetune-readiness.spec.ts"

cd "$REPO" || { echo "verify-readiness: no checkout at $REPO" >&2; exit 2; }
[ -f "$SPEC" ] || {
  echo "verify-readiness: $SPEC is not in this checkout ($(git rev-parse --abbrev-ref HEAD))." >&2
  echo "verify-readiness: check out the branch carrying this fix." >&2
  exit 2
}

# Layer 1: does the CHECKOUT carry the fix?
if ! grep -q 'trainerUnreachable' src/components/colab/Finetune.tsx; then
  echo "verify-readiness: this checkout ($(git rev-parse --abbrev-ref HEAD)) has no trainerUnreachable" >&2
  echo "verify-readiness: in src/components/colab/Finetune.tsx, so it predates the fix." >&2
  exit 2
fi

echo "verify-readiness: target $BASE_URL"
echo "verify-readiness: checkout $(git rev-parse --short HEAD) on $(git rev-parse --abbrev-ref HEAD)"

# Layer 2, the one that matters: does the SERVED bundle carry the fix? The
# checkout and the dev server are not the same thing. A dev server started on
# another branch, or still mid-recompile after a branch switch, serves code
# this checkout no longer contains.
#
# Three strings, each from a different file the fix touches, so one stale
# module cannot pass this on another's behalf. Plus a control that exists on
# BOTH trees, which is what tells "pre-fix bundle" apart from "could not read
# the bundle at all" -- without it, a 404 or an empty body would look exactly
# like a missing fix.
BUNDLE=/tmp/verify-readiness-bundle.$$.js
HTTP=$(curl -s --max-time 180 "$BASE_URL/static/js/bundle.js" -o "$BUNDLE" -w '%{http_code}')
SIZE=$(wc -c < "$BUNDLE" 2>/dev/null || echo 0)
echo "verify-readiness: bundle http=$HTTP bytes=$SIZE"

CONTROL='Start training'
if ! grep -qF "$CONTROL" "$BUNDLE"; then
  echo "verify-readiness: FAIL, could not read a finetune bundle from $BASE_URL." >&2
  echo "verify-readiness: the control string $(printf %q "$CONTROL") is absent, which means this is not" >&2
  echo "verify-readiness: a pre-fix bundle, it is not the app's bundle at all. Is the dev server up?" >&2
  rm -f "$BUNDLE"
  exit 2
fi

MISSING=0
for s in 'trainerUnreachable' 'The training service did not answer' 'Checking what this split holds'; do
  if grep -qF "$s" "$BUNDLE"; then
    echo "verify-readiness:   present in bundle: $s"
  else
    echo "verify-readiness:   ABSENT from bundle: $s" >&2
    MISSING=$((MISSING + 1))
  fi
done
rm -f "$BUNDLE"

if [ "$MISSING" -gt 0 ]; then
  echo "verify-readiness: FAIL, $BASE_URL is serving a tree WITHOUT this fix." >&2
  echo "verify-readiness: this is NOT a result about the fix. Running the spec now would give" >&2
  echo "verify-readiness: failures at the very assertions the fix is about, and they would mean" >&2
  echo "verify-readiness: nothing. Point the dev server at a checkout of the fix branch (the" >&2
  echo "verify-readiness: proxy in .dev/colab-dev-proxy serves whichever branch its worktree is" >&2
  echo "verify-readiness: on), wait for it to recompile, then re-run." >&2
  exit 6
fi

echo "verify-readiness: running $SPEC"
RUN_LOG=/tmp/verify-readiness-run.$$.log
env -u HYPHA_TOKEN E2E_BASE_URL="$BASE_URL" \
  timeout 900 npx playwright test "$SPEC" --reporter=list 2>&1 | tee "$RUN_LOG"
STATUS=${PIPESTATUS[0]}

PASSED=$(grep -oE '[0-9]+ passed' "$RUN_LOG" | tail -1 | grep -oE '^[0-9]+' || true)
FAILED=$(grep -oE '[0-9]+ failed' "$RUN_LOG" | tail -1 | grep -oE '^[0-9]+' || true)
SKIPPED=$(grep -oE '[0-9]+ skipped' "$RUN_LOG" | tail -1 | grep -oE '^[0-9]+' || true)
DECLARED=$(grep -cE '^[[:space:]]*test\(' "$SPEC" || true)
rm -f "$RUN_LOG"

echo "verify-readiness: passed=${PASSED:-0} failed=${FAILED:-0} skipped=${SKIPPED:-0} declared_in_spec=${DECLARED:-?}"

# Both tests call test.skip() without a Hypha token, and `playwright test`
# exits 0 when everything skipped, so the exit code alone cannot tell a pass
# from a suite that ran nothing.
if [ "$STATUS" -ne 0 ]; then
  echo "verify-readiness: FAIL, playwright exited $STATUS" >&2
  exit "$STATUS"
fi
if [ -z "${PASSED:-}" ] || [ "$PASSED" -eq 0 ]; then
  echo "verify-readiness: FAIL, exit was 0 but nothing passed. A suite that ran nothing is not a pass." >&2
  exit 3
fi
if [ -n "${SKIPPED:-}" ] && [ "$SKIPPED" -gt 0 ]; then
  echo "verify-readiness: FAIL, $SKIPPED skipped. The skip in this spec means no Hypha token." >&2
  exit 4
fi
if [ -n "${DECLARED:-}" ] && [ "$DECLARED" -gt 0 ] && [ "$PASSED" -ne "$DECLARED" ]; then
  echo "verify-readiness: FAIL, $PASSED passed but the spec declares $DECLARED." >&2
  exit 5
fi
echo "verify-readiness: PASS, $PASSED of $DECLARED passed, 0 skipped, 0 failed"
exit 0
