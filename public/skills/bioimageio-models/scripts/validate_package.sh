#!/usr/bin/env bash
# validate_package.sh — Run static + dynamic validation on a bioimageio model package
#
# Usage:
#   bash validate_package.sh <model_package_dir>
#   bash validate_package.sh model_package/

set -e

PACKAGE_DIR="${1:-.}"
RDF="$PACKAGE_DIR/rdf.yaml"

if [ ! -f "$RDF" ]; then
  echo "Error: $RDF not found"
  echo "Usage: bash validate_package.sh <model_package_dir>"
  exit 1
fi

echo "======================================="
echo "BioImage.IO Model Validation"
echo "Package: $PACKAGE_DIR"
echo "======================================="

# --- Static validation ---
echo ""
echo "Step 1: Static validation (bioimageio.spec)"
echo "---"
pip install -q bioimageio.spec 2>/dev/null
python - <<EOF
from bioimageio.spec import load_description
import sys
try:
    desc = load_description("$RDF")
    print("✓ Static validation passed:", type(desc).__name__)
except Exception as e:
    print("✗ Static validation FAILED:")
    print(str(e))
    sys.exit(1)
EOF

# --- Dynamic testing ---
echo ""
echo "Step 2: Dynamic testing (bioimageio.core)"
echo "---"
if command -v conda &>/dev/null && conda env list | grep -q bioimageio; then
  echo "Using conda env 'bioimageio'"
  conda run -n bioimageio bioimageio test "$RDF"
else
  pip install -q bioimageio.core 2>/dev/null
  bioimageio test "$RDF"
fi

echo ""
echo "======================================="
echo "✓ All validation checks passed!"
echo "Ready to submit to the BioImage Model Zoo."
echo "======================================="
