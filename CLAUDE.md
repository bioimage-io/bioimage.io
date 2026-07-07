# BioImage.IO — Claude Code Guidelines

## Project Goal

**BioImage Model Zoo** (<https://bioimage.io>) is a community-driven, fully open platform for sharing, discovering, testing, and deploying deep learning models for bioimage analysis. The platform makes models truly **FAIR** — Findable, Accessible, Interoperable, and Reproducible — across frameworks, operating systems, and software ecosystems.

### Core Mission

1. **Model repository** — Host pre-trained DL models (segmentation, restoration, classification, etc.) with standardized metadata (RDF/YAML), DOIs, memorable nicknames, and full provenance (training data, notebooks, authors).
2. **Cross-tool interoperability** — A single model format (bioimageio spec) runs across ilastik, deepImageJ, QuPath, StarDist, ImJoy, ZeroCostDL4Mic, CSBDeep, Icy, and more — without per-tool re-integration.
3. **In-browser testing via BioEngine** — Users can evaluate any model on their own images directly on the website; the BioEngine serves GPU inference from cloud infrastructure (de.NBI / Kubernetes + Triton).
4. **Community contribution pipeline** — Model submission through Zenodo or the web upload form; automatic CI quality assurance; manual curator review; community partner collections via GitHub.
5. **FAIR developer tooling** — Python (`bioimageio.core`) and Java libraries let developers programmatically load, run, export, and re-upload models in only a few lines of code.

### Active Feature: Collaborative Annotation & Fine-Tuning

The current in-browser application layer extends the platform with:

- **Collaborative annotation** — mount local folders or upload images to cloud, share annotation sessions with teammates via URL, collect segmentation masks in real time.
- **AI-assisted annotation** — Cellpose / Cellpose-SAM auto-segmentation with interactive correction tools.
- **Fine-tune Cellpose-SAM** — trigger training from the UI using annotated data stored in Hypha Artifacts, then deploy trained models back into the annotation workflow.

This layer runs **entirely in the browser** (Python via Pyodide/WebAssembly, image visualization via OpenLayers) backed by **Hypha Cloud** for service registration, artifact storage, and RPC coordination.

---

## Tech Stack

| Layer | Technology |
|---|---|
| Frontend framework | React 18 + TypeScript |
| Package manager | pnpm |
| Styling | Tailwind CSS + Material-UI (MUI) |
| State management | Zustand |
| Image visualization | OpenLayers |
| In-browser Python | web-python-kernel (Pyodide/WebAssembly) |
| Backend / services | Hypha RPC (`hypha-rpc` npm package) |
| Artifact storage | Hypha Artifact Manager |
| AI segmentation | Cellpose / Cellpose-SAM (via Hypha service) |

---

## Where to find more

Load these skills before touching the matching area of the codebase — they hold the deeper guidance (coding standards, architectural patterns, component inventory, dev rules):

- **`.claude/skills/bioimageio-website/SKILL.md`** — code-level guide for this repository. Read it before any non-trivial change: coding conventions, component layout under `src/components/{colab,annotate}/`, store contracts, the Hypha-reachability banner pattern, the `HYPHA_SERVER_URL` config seam, and the development rules (read-before-edit, no speculative features, undo snapshots on every vector mutation, etc.).
- **`public/skills/bioimageio-models/SKILL.md`** — agent-facing skill served at `https://bioimage.io/skills/bioimageio-models/SKILL.md`. Walks any AI agent through the full model contribution pipeline (gather info → build package → static + dynamic validation → submit to Hypha → optional BioEngine validation). The Upload page (`src/components/Upload.tsx`) advertises this URL to contributors.
- **`public/skills/bioengine/SKILL.md`** — canonical deploy workflow and CLI reference for BioEngine apps. Load this before deploying or updating a BioEngine application. Critical rule: always pass `--app-id <running-id>` when updating; omitting it creates a new random instance.

## Related Repositories

Working copies of the sibling libraries live under `bioimageio-resources/` in this repo (added 2026-07-07) so they can be grepped side-by-side with the frontend:

| Repo | Path | Current release | Role |
|---|---|---|---|
| spec-bioimage-io | `bioimageio-resources/spec-bioimage-io` | 0.5.11.0 (2026-06-15) | RDF format spec + `bioimageio.spec` Python library |
| core-bioimage-io-python | `bioimageio-resources/core-bioimage-io-python` | 0.10.4 (pins spec 0.5.10.2) | `bioimageio.core` — what the Test button delegates to |
| collection | `bioimageio-resources/collection` | dev (CI-only) | Community partner registry + reviewer roster (JSON config) |
| bioengine | `../bioengine` | co-developed sibling | Ray-Serve inference backend behind the BioEngine button |

The spec ↔ core versions are a pinned chain — bumping one without the other silently rejects otherwise-valid resources. See the bioimageio-website skill for the version-chain rule, the partner-registry file, and the YAML 1.2 / ruyaml gotcha.

---

## Active Development Focus

The primary ongoing work is extending the collaborative annotation + Cellpose-SAM fine-tuning pipeline:

- Tighter integration between annotation masks and training data preparation.
- Interactive correction of Cellpose-SAM predictions within the annotation viewer.
- Model versioning and rollback in the Hypha artifact store.
- Progress reporting during fine-tuning via streaming Hypha RPC updates.
