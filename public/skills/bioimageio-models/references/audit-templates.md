# Audit & Improvement Report Templates

Copy-paste-ready `gh issue create` snippets and success-example
template for the mandatory Phase 7 audit step. The main SKILL.md
describes when to file each report; this file holds the boilerplate
so those instructions stay short.

## Contents

- 7a — Spec / validation issue → `bioimage-io/spec-bioimage-io`
- 7b — Core library issue → `bioimage-io/core-bioimage-io-python`
- 7c — Website / submission issue → `bioimage-io/bioimage.io`
- 7d — Skill improvement → `bioimage-io/bioimage.io`
- 7e — Add a success example → `references/success-examples.md`

## 7a — Spec / validation issue

Use when the RDF spec was unclear, a validation error message was
unhelpful, or a required field was underdocumented.

```bash
gh issue create \
  --repo bioimage-io/spec-bioimage-io \
  --title "YOUR TITLE HERE" \
  --body "$(cat <<'EOF'
## Problem
[Describe exactly what was confusing or broken]

## Steps to reproduce
[Paste the rdf.yaml section or the error message]

## Expected behavior
[What should have happened instead]

## Environment
- bioimageio.spec version: $(python -c "import bioimageio.spec; print(bioimageio.spec.__version__)")
- bioimageio.core version: $(python -c "import bioimageio.core; print(bioimageio.core.__version__)")
- Python: $(python --version)
- Model type: [PyTorch / TF / ONNX]
EOF
)"
```

Or open manually at
<https://github.com/bioimage-io/spec-bioimage-io/issues>.

## 7b — Core library issue

Use when `bioimageio test` crashed, gave wrong results, or failed for
unclear reasons.

```bash
gh issue create \
  --repo bioimage-io/core-bioimage-io-python \
  --title "Test failure: [brief description]" \
  --body "$(cat <<'EOF'
## Error
[Full traceback from bioimageio test]

## Model details
[format_version, weight format, preprocessing steps]

## Reproduction
[Minimal rdf.yaml that reproduces the issue]
EOF
)"
```

Or: <https://github.com/bioimage-io/core-bioimage-io-python/issues>.

## 7c — Website / submission issue

Use when the upload process, the Hypha API, or the bioimage.io website
itself had problems.

```bash
gh issue create \
  --repo bioimage-io/bioimage.io \
  --title "[Upload/API] YOUR ISSUE" \
  --body "..."
```

Or: <https://github.com/bioimage-io/bioimage.io/issues>.

## 7d — Skill improvement

Use when these instructions themselves were confusing, incomplete, or
missing key steps. Aim for a concrete draft of the improved text.

```bash
gh issue create \
  --repo bioimage-io/bioimage.io \
  --title "[Skill] bioimageio-models: [what to improve]" \
  --body "$(cat <<'EOF'
## What was confusing / missing
[Describe the gap in the skill instructions]

## Where in the skill
[Phase X, file references/..., etc.]

## Suggested improvement
[Draft the improved text or instructions]

## Model submitted
[What model you were packaging — helps reproduce the scenario]
EOF
)"
```

Skill source lives at `public/skills/bioimageio-models/` in
<https://github.com/bioimage-io/bioimage.io>.

## 7e — Add a success example

Only after the submission succeeded. Documenting the run helps future
agents learn from what worked.

```bash
cat >> public/skills/bioimageio-models/references/success-examples.md <<'EOF'

## [Model Name] — [Date]
- **Source**: [HuggingFace / Zenodo URL]
- **Weight format**: [pytorch_state_dict / onnx / tensorflow_saved_model_bundle]
- **Key challenge**: [What was the hardest part]
- **What worked**: [The approach that solved it]
- **rdf.yaml snippet** (if notable):
~~~yaml
[paste relevant section]
~~~
EOF
```
