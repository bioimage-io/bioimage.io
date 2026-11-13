#!/bin/sh
# Clause 3 of myco #0069, on whatever tree this runs in.
#
# The defect: `str(yaml.safe_load(...)["version"])` does not give back the text
# the manifest spells. safe_load reads an unquoted two-component `version: 0.10`
# as the float 0.1, and str() on that float is '0.1'. In the served uploader that
# string NAMES the artifact version that gets committed, and a committed artifact
# version is immutable.
#
# Clause 1: public/skills/bioengine/scripts/upload_app.py must read the version
#           as text (BaseLoader) and must not reuse the lossy shape.
# Clause 2: the SKILL.md version-test snippet must teach the same thing.
# Clause 3: the premise must still hold in the PyYAML that is actually installed
#           -- BaseLoader non-lossy, str(safe_load(...)) lossy on 0.10/2.10/1.20.
#           Asserted by RUNNING it, not by trusting this comment.
#
# Clause 4 of the row (curl the served copy) waits on merge + deploy and is
# deliberately not attempted here -- see the row.
#
# Exit 0 = all three hold. Exit 1 = one does not. Exit 2 = could not run, which
# is NOT a pass: a missing file, an empty file, no python3 or no PyYAML would
# otherwise make every grep below match nothing and read as clause 1 satisfied.
set -u

U=public/skills/bioengine/scripts/upload_app.py
S=public/skills/bioengine/SKILL.md

for f in "$U" "$S"; do
  [ -f "$f" ] || { echo "cannot run: $f does not exist" >&2; exit 2; }
  [ -s "$f" ] || { echo "cannot run: $f is empty" >&2; exit 2; }
done

rc=0

# --- clause 1, the served uploader -------------------------------------------
# Anchored on the assignment, not on the whole file: `str(manifest["version"])`
# appearing in a docstring that WARNS about it is correct, and a file-wide grep
# would call that a violation.
if grep -qE '^[[:space:]]*base[[:space:]]*=[[:space:]]*str\(manifest\[' "$U"; then
  echo "FAIL clause 1: $U assigns base from str(manifest[\"version\"]) -- lossy on 0.10" >&2
  rc=1
fi
if ! grep -q 'Loader=yaml.BaseLoader' "$U"; then
  echo "FAIL clause 1: $U never reads the manifest with yaml.BaseLoader" >&2
  rc=1
fi
# The helper must be the thing `base` is assigned from, or the BaseLoader read
# above could sit in dead code while line 82 stayed lossy.
if ! grep -qE '^[[:space:]]*base[[:space:]]*=[[:space:]]*_manifest_version_text\(' "$U"; then
  echo "FAIL clause 1: $U does not assign base from _manifest_version_text()" >&2
  rc=1
fi

# --- clause 2, the SKILL.md snippet ------------------------------------------
# Scoped to the test_version.py fenced block, and the scoping is load-bearing
# rather than defensive: the paragraph directly BELOW the block now names the
# lossy shape in order to warn about it, so a file-wide grep is satisfied by
# the warning itself and FAILS prose nobody broke. Measured on the clean tree
# -- `str(yaml.safe_load` is 1 file-wide and 0 inside the block, and a widened
# copy of this clause exits 1 on the clean tree (mutant M8 on the row).
#
# Both spellings are caught, because both are the regression: reverting to
# `str(manifest["version"])` and reverting to `str(yaml.safe_load(...))` are
# the same defect wearing different names.
BLOCK=$(awk '/# test_version.py/{f=1} f{print} f&&/^[[:space:]]*```[[:space:]]*$/&&!/test_version/{c++; if(c>=1) exit}' "$S")
if [ -z "$BLOCK" ]; then
  echo "cannot run: the test_version.py block was not found in $S" >&2
  exit 2
fi
if printf '%s\n' "$BLOCK" | grep -qE 'str\(manifest\[|str\(yaml\.safe_load'; then
  echo "FAIL clause 2: the $S version-test snippet asserts against a str()-coerced safe_load" >&2
  rc=1
fi
if ! printf '%s\n' "$BLOCK" | grep -q 'Loader=yaml.BaseLoader'; then
  echo "FAIL clause 2: the $S version-test snippet does not use yaml.BaseLoader" >&2
  rc=1
fi

# --- clause 3, the premise, run rather than asserted -------------------------
command -v python3 >/dev/null 2>&1 || { echo "cannot run: no python3" >&2; exit 2; }
python3 -c 'import yaml' 2>/dev/null || { echo "cannot run: python3 has no PyYAML" >&2; exit 2; }
PREMISE=$(python3 - <<'PY' 2>/dev/null
import sys, yaml
lossy_expected = ["0.10", "2.10", "1.20"]      # str(safe_load) must LOSE these
exact_expected = ["1.0", "1.0.0", "0.9.1"]     # and must keep these
bad = []
for s in lossy_expected:
    if str(yaml.safe_load(f"version: {s}")["version"]) == s:
        bad.append(f"safe_load+str kept {s}, expected it to be lossy")
for s in lossy_expected + exact_expected:
    got = yaml.load(f"version: {s}", Loader=yaml.BaseLoader)["version"]
    if got != s:
        bad.append(f"BaseLoader returned {got!r} for {s}, expected verbatim")
print("PREMISE_OK" if not bad else "PREMISE_BROKEN: " + "; ".join(bad))
PY
)
case "$PREMISE" in
  PREMISE_OK) ;;
  PREMISE_BROKEN*) echo "FAIL clause 3: $PREMISE" >&2; rc=1 ;;
  *) echo "cannot run: the clause 3 probe produced no verdict" >&2; exit 2 ;;
esac

if [ "$rc" -eq 0 ]; then
  echo "ok clause 1: $U reads the version with BaseLoader via _manifest_version_text()"
  echo "ok clause 2: the $S test_version.py block uses BaseLoader, and neither str(manifest[...]) nor str(yaml.safe_load(...)) appears INSIDE that block"
  echo "ok clause 3: in this PyYAML, str(safe_load) loses 0.10/2.10/1.20 and BaseLoader does not"
fi
exit "$rc"
