# BioImage Model Zoo — Agent Skill Plan
## `bioimageio-models`

**Date:** 2026-04-15  
**Goal:** An agent skill that takes a user's trained model (files, GitHub repo, or description) and guides them end-to-end through packaging, validation, and submission to the BioImage Model Zoo — as automatically as possible, with minimal expert knowledge required.

---

## Problem Statement

Contributing a model to the BioImage Model Zoo is painful because:
1. The `bioimageio.yaml` (RDF) spec is complex — dozens of fields, strict axis notation, SHA256 hashes for every file, tensor shape specs, etc.
2. Documentation is scattered and hard to parse
3. The static + dynamic validation steps require environment setup
4. Hypha-based submission requires knowing the API
5. The whole process is sequential and error-prone; one wrong field breaks everything

An LLM agent is well-suited: it's highly logical, can ask clarifying questions, generate YAML, run validators in a loop, and call APIs.

---

## Solution Architecture

### Skill Location

```
public/skills/bioimageio-models/
├── SKILL.md                          # Main skill file (~300 lines)
├── references/
│   ├── model-spec-reference.md       # Full field reference for bioimageio.yaml
│   ├── submission-guide.md           # Hypha API submission walkthrough
│   └── example-rdf.yaml             # Annotated real-world example
└── scripts/
    ├── compute_sha256.py             # Compute SHA256 hashes for files
    ├── generate_test_tensors.py      # Generate test_input.npy / test_output.npy
    └── validate_package.sh           # Run bioimageio test + report
```

**Public URL:** `https://bioimage.io/skills/bioimageio-models/SKILL.md`

This URL is added to the Upload page so users can copy it into any AI agent (Claude Code, Gemini CLI, etc.) to get guided assistance.

---

## Workflow (Agent Executes This)

### Phase 0 — Understand the Input
1. Read everything the user provides: GitHub URL, local files, training scripts, paper, README
2. Identify what is already available vs missing
3. Ask for missing critical items (see Phase 1 checklist)

### Phase 1 — Information Gathering
Required items checklist:
- [ ] **Weight file(s)** — `.pt`, `.pth`, `.onnx`, `.h5`, `.pb`, etc.
- [ ] **Model architecture code** (if PyTorch state dict)
- [ ] **Input tensor spec** — shape, dtype, axes (b, c, y, x), channel names, value range
- [ ] **Output tensor spec** — shape, dtype, axes, channel names, value range  
- [ ] **Preprocessing** — normalization method, scale, offset
- [ ] **Postprocessing** — sigmoid, softmax, threshold, etc.
- [ ] **Test input array** — a representative input sample
- [ ] **Model name** — human-readable, descriptive (e.g., "Nucleus Segmentation 2D UNet - Fluorescence")
- [ ] **Description** — what it does, what data it was trained on
- [ ] **Authors** — name, affiliation, ORCID (optional)
- [ ] **License** — SPDX identifier (MIT, CC-BY-4.0, etc.)
- [ ] **Tags** — modality, task, architecture, framework
- [ ] **Documentation** — README.md with validation section
- [ ] **Cover image** — 2:1 or 1:1 aspect ratio PNG/JPG < 500KB

If no test input/output provided → generate using `scripts/generate_test_tensors.py`  
If no cover image → generate a visualization from test_input/test_output using matplotlib

### Phase 2 — Build the Model Package
1. Create a working directory: `model_package/`
2. Copy weight files in
3. Compute SHA256 for all files using `scripts/compute_sha256.py`
4. Generate `bioimageio.yaml` from gathered info (see `references/model-spec-reference.md`)
5. Generate `README.md` (documentation)
6. Generate test tensors if needed

### Phase 3 — Static Validation
```bash
pip install -q bioimageio.spec
python -c "from bioimageio.spec import load_description; load_description('model_package/bioimageio.yaml')"
```
Fix any errors. Repeat until clean.

### Phase 4 — Dynamic Testing (bioimageio.core)
```bash
pip install -q bioimageio.core
bioimageio test model_package/bioimageio.yaml
```
This runs inference on `test_input.npy` and compares to `test_output.npy`.  
Fix any mismatches. Repeat until all checks pass.

### Phase 5 — Submit to Hypha
Use the Hypha artifact manager API (see `references/submission-guide.md`):
1. Connect to `https://hypha.aicell.io` with user token
2. Create staged artifact under `bioimage-io/bioimage.io`
3. Upload all files via presigned URLs
4. Commit to staging (awaits curator review)

### Phase 6 — Remote Validation (BioEngine Worker)
After submission, trigger the BioEngine runner to validate on managed infrastructure.  
Report results back; if failed, fix manifest and resubmit.

### Phase 7 — Done / Escalation
- **Success:** Share the staging URL with the user; explain the review process
- **Failure after N iterations:** Write a detailed GitHub issue template with the specific error, point user to: https://github.com/bioimage-io/spec-bioimage-io/issues

---

## UI Integration

**Upload page** (`src/components/Upload.tsx`): Add a banner/card at the top:

> **New: AI-assisted model upload**
> Copy the following to your AI agent (Claude Code, Gemini CLI, etc.) for guided model packaging and submission:
> ```
> https://bioimage.io/skills/bioimageio-models/SKILL.md
> ```
> The agent will ask you questions and handle the entire process — from converting your model files to a valid BioImage.IO package to submitting it to the Zoo.

---

## Files to Create

| File | Purpose |
|------|---------|
| `public/skills/bioimageio-models/SKILL.md` | Main agent skill instructions |
| `public/skills/bioimageio-models/references/model-spec-reference.md` | Full RDF field reference |
| `public/skills/bioimageio-models/references/submission-guide.md` | Hypha submission API |
| `public/skills/bioimageio-models/references/example-rdf.yaml` | Annotated real example |
| `public/skills/bioimageio-models/scripts/compute_sha256.py` | SHA256 utility |
| `public/skills/bioimageio-models/scripts/generate_test_tensors.py` | Test tensor generator |
| `public/skills/bioimageio-models/scripts/validate_package.sh` | Validation runner |

---

## Testing Plan

1. Spawn a fresh agent (`svamp session spawn claude`) pointing only at this skill
2. Give it a simple real model (e.g., a small PyTorch ONNX export)
3. Watch if it asks the right questions, builds a valid YAML, runs validation
4. Verify the manifest passes `bioimageio test`
5. Iterate on the skill based on observed failure modes
