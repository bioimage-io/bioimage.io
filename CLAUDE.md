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

| Repo | Path | Role |
|---|---|---|
| spec-bioimage-io | `../spec-bioimage-io` | The official YAML/RDF spec for every resource — schema lives here. |
| core-bioimage-io-python | `../core-bioimage-io-python` | The Python runtime (`bioimageio.core`) that loads and runs models. |
| bioengine | `../bioengine` | The distributed Ray-Serve inference backend behind the BioEngine button. |

The bioimageio-website skill carries the longer description of each repo and how the website depends on it.

---

## Active Development Focus

The primary ongoing work is extending the collaborative annotation + Cellpose-SAM fine-tuning pipeline:

- Tighter integration between annotation masks and training data preparation.
- Interactive correction of Cellpose-SAM predictions within the annotation viewer.
- Model versioning and rollback in the Hypha artifact store.
- Progress reporting during fine-tuning via streaming Hypha RPC updates.
