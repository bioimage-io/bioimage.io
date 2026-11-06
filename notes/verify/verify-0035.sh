#!/bin/bash
# Re-runnable verification for issue #0035 (annotate save/restore reliability).
#
# tests/annotate-save-reliability.spec.ts needs a throwaway dataset, and its
# third test writes a real annotation into it, so the fixture has to be built
# before the run and deleted after. Stitching that together by hand means an
# evidence command with a value someone has to substitute first, and a command
# like that can half-run: on #0035 the recorded evidence was
# `FIXTURE_ALIAS=<fresh> … npx playwright test …`, where the shell read
# `<fresh>` as an input redirection and the suite never ran at all.
#
# So this takes no arguments and leaves nothing behind:
#
#   bash notes/verify/verify-0035.sh
#
# E2E_BASE_URL overrides the target and must be a PUBLIC url, not localhost,
# because that is the only thing a reviewer on another machine can reach. The
# dev server has to be up (.dev/colab-dev-proxy/start-dev.sh); a production
# build compiles out the seams the spec drives.
#
# What makes a pass here mean something: the spec is self-guarding about which
# code it measures. Its D3 case fails if the served build lacks the restore,
# which is the measured negative control recorded on the issue. And the case
# counts are checked below, because `playwright test` also exits 0 when every
# test SKIPPED, which for this spec means the Hypha token was missing.
set -uo pipefail

REPO="${REPO:-$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)}"
BASE_URL="${E2E_BASE_URL:-https://tl-colab-dev-2bc6ffc3.hypha.run}"
BUILDER="notes/verify/make_fixture.cjs"
SPEC="tests/annotate-save-reliability.spec.ts"

cd "$REPO" || { echo "verify-0035: no checkout at $REPO" >&2; exit 2; }
[ -f "$BUILDER" ] || { echo "verify-0035: missing $BUILDER" >&2; exit 2; }
# The spec only exists from the #0035 fix onward, so a checkout without it
# would otherwise read as "nothing to run" rather than "wrong revision".
[ -f "$SPEC" ] || {
  echo "verify-0035: $SPEC is not in this checkout ($(git rev-parse --abbrev-ref HEAD))." >&2
  echo "verify-0035: check out a revision that contains the #0035 fix." >&2
  exit 2
}

# A fresh alias per run: reusing one would hand the next run a dataset that
# already carries a saved annotation, which tests 1 and 2 assume it does not.
ALIAS="verify35-$(head -c6 /dev/urandom | od -An -tx1 | tr -d ' \n')"
ARTIFACT="bioimage-io/$ALIAS"

# Read the viewport back out of the spec rather than restating it here, so the
# number reported cannot drift from the number that ran.
VIEWPORT=$(grep -oE 'viewport: \{ width: [0-9]+, height: [0-9]+ \}' "$SPEC" \
  | grep -oE '[0-9]+, height: [0-9]+' | sed 's/, height: /x/' | head -1)
if [ -z "$VIEWPORT" ]; then
  echo "verify-0035: FAIL, $SPEC states no viewport, so this cannot report the one it ran at." >&2
  exit 2
fi
VIEWPORT_W=${VIEWPORT%x*}
if [ "$VIEWPORT_W" -lt 1024 ]; then
  echo "verify-0035: FAIL, viewport ${VIEWPORT} is not a desktop width." >&2
  exit 2
fi

echo "verify-0035: target $BASE_URL"
echo "verify-0035: viewport ${VIEWPORT} (desktop, read from $SPEC)"
echo "verify-0035: revision $(git rev-parse --short HEAD) on $(git rev-parse --abbrev-ref HEAD)"
echo "verify-0035: building fixture $ARTIFACT"
if ! env -u HYPHA_TOKEN FIXTURE_ALIAS="$ALIAS" node "$BUILDER" \
     > /tmp/verify-0035-fixture.$$.log 2>&1; then
  echo "verify-0035: fixture build FAILED" >&2
  tail -20 /tmp/verify-0035-fixture.$$.log >&2
  rm -f /tmp/verify-0035-fixture.$$.log
  exit 2
fi
grep -E '^(images in index|labels in index|FIXTURE_ALIAS)' /tmp/verify-0035-fixture.$$.log
rm -f /tmp/verify-0035-fixture.$$.log

# Delete it however we leave, interrupts included, so a failed run does not
# strand a staged artifact in the shared collection.
cleanup() {
  echo "verify-0035: deleting $ARTIFACT"
  env -u HYPHA_TOKEN node "$BUILDER" --delete "$ARTIFACT" 2>&1 | grep -E 'deleted|ERR' || true
}
trap cleanup EXIT

echo "verify-0035: running $SPEC"
RUN_LOG=/tmp/verify-0035-run.$$.log
env -u HYPHA_TOKEN E2E_BASE_URL="$BASE_URL" \
  FIXTURE_ALIAS="$ALIAS" FIXTURE_LABEL=cells FIXTURE_STEM=verify35_cells \
  npx playwright test "$SPEC" --reporter=list 2>&1 | tee "$RUN_LOG"
STATUS=${PIPESTATUS[0]}

PASSED=$(grep -oE '[0-9]+ passed' "$RUN_LOG" | tail -1 | grep -oE '^[0-9]+' || true)
FAILED=$(grep -oE '[0-9]+ failed' "$RUN_LOG" | tail -1 | grep -oE '^[0-9]+' || true)
SKIPPED=$(grep -oE '[0-9]+ skipped' "$RUN_LOG" | tail -1 | grep -oE '^[0-9]+' || true)
DECLARED=$(grep -cE '^[[:space:]]*test\(' "$SPEC" || true)
rm -f "$RUN_LOG"

echo "verify-0035: passed=${PASSED:-0} failed=${FAILED:-0} skipped=${SKIPPED:-0} declared_in_spec=${DECLARED:-?}"

if [ "$STATUS" -ne 0 ]; then
  echo "verify-0035: FAIL, playwright exited $STATUS" >&2
  exit "$STATUS"
fi
if [ -z "${PASSED:-}" ] || [ "$PASSED" -eq 0 ]; then
  echo "verify-0035: FAIL, exit was 0 but nothing passed. A suite that ran nothing is not a pass." >&2
  exit 3
fi
if [ -n "${SKIPPED:-}" ] && [ "$SKIPPED" -gt 0 ]; then
  echo "verify-0035: FAIL, $SKIPPED skipped. The skip in this spec means the Hypha token was rejected." >&2
  exit 4
fi
if [ -n "${DECLARED:-}" ] && [ "$DECLARED" -gt 0 ] && [ "$PASSED" -ne "$DECLARED" ]; then
  echo "verify-0035: FAIL, $PASSED passed but the spec declares $DECLARED." >&2
  exit 5
fi
echo "verify-0035: PASS, $PASSED of $DECLARED passed, 0 skipped, 0 failed"
exit 0
