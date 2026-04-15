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

## What Has Already Been Built

### `src/components/colab/` — Collaborative Session Management

- **ColabPage.tsx** — Main orchestrator: file system state, session lifecycle, 3-step workflow (Start → Collaborate → Train).
- **KernelContext.tsx** — React Context that shares a single web-python-kernel instance across routes; exposes `executeCode`, `mountDirectory`, `syncFileSystem`, `writeFilesToPyodide`.
- **useColabKernel.ts** — Hook that initializes kernel manager (`KernelMode.WORKER` + `KernelLanguage.PYTHON`), handles streaming output and errors.
- **SessionModal.tsx** — Creates sessions: mounts local folder (File System Access API), uploads to cloud, or resumes an existing artifact. Installs Python packages and loads `colab_service.py`.
- **ShareModal.tsx** — Displays annotation URL + QR code, Cellpose model selector, session resume URL.
- **ImageViewer.tsx** — Session dashboard: image list with annotation status, colorized mask preview, progress tracker, ZIP download, cloud upload/delete.
- **TrainingModal.tsx** — Triggers Cellpose-SAM fine-tuning via `cellpose-finetuning` Hypha service; browses existing trained models.
- **DeleteArtifactModal.tsx** — Safe artifact deletion with stats and ID confirmation.
- **ColabGuide.tsx** — In-app help tutorial.

### `src/components/annotate/` — Interactive Annotation Interface

- **AnnotationViewer.tsx** — OpenLayers map with pixel-space coordinate system; exposes refs for reset view, vector source, image layer.
- **ToolBar.tsx** — 6 tools (Move M, Select S, Draw D, Cut C, Eraser E, Expand A) + AI (Cellpose), Undo, Clear, CLAHE, Filter by Area, Upload GeoJSON, Save, Help.
- **LabelPanel.tsx** — Color-coded label selector (Cell, Nucleus, Background defaults); backed by `useAnnotationStore`.
- **useHyphaService.ts** — Connects to image provider service; wraps `getImage`, `getSaveUrls`, `saveAnnotation`, `runCellpose`; converts masks ↔ polygons.
- **useAnnotationMap.ts** — Initializes OpenLayers map, image layer, vector layer with styled features; exports GeoJSON.
- **useDrawInteraction.ts** — Draw/modify/snap interactions for polygon editing.
- **CellposeConfigDialog.tsx** — Model selection, diameter, thresholds, iteration parameters.
- **SegmentationDialog.tsx** — Review and accept/modify Cellpose output masks.
- **FloatingBanners.tsx** — Toast notifications (info/loading/success/warning/error) with auto-dismiss.
- **CLAHEDialog.tsx**, **MaskFilterDialog.tsx**, **HelpTutorial.tsx**, **ConfirmDialog.tsx** — Supporting UI components.

### Global State

- **useHyphaStore** (Zustand) — Hypha connection, authentication, artifact browsing, pagination, resource selection.
- **useAnnotationStore** (Zustand) — Active tool, labels, image info, undo stack (max 10 snapshots), loading/error states.

### Python Backend (in-browser)

- **`public/colab_service.py`** — Hypha service registered per session: `get_image()`, `save_annotation()`, `get_save_urls()`, optional `get_local_image_base64()`.

---

## Coding Standards

Derived from `.github/copilot-instructions.md`:

### Python

- PEP 8 + PEP 257 compliance.
- Type hints on all function signatures.
- Docstrings for all significant classes and functions.
- Naming: `snake_case` variables/functions, `PascalCase` classes.
- Wrap all I/O in `try/except`; log with the `logging` module and provide meaningful context.
- Use `async/await` for Hypha RPC calls.

### TypeScript / React

- Prettier + ESLint enforced.
- Naming: `camelCase` variables/functions, `PascalCase` classes and React components, `kebab-case` files/folders.
- TypeScript interfaces for all data structures — no implicit `any`.
- Wrap async operations in `try/catch`; surface errors through store state or `FloatingBanners`.
- Use `async/await`, not raw `.then()` chains.

### Component Architecture

- Feature-scoped directories (e.g., `colab/`, `annotate/`).
- Hooks in a `hooks/` subdirectory inside each feature.
- Shared stores in `src/store/`.
- Shared types in `src/types/`.
- UI modals as self-contained components with a clear open/close prop API.

### State Management

- **Zustand** for global/shared state.
- React `useState`/`useReducer` for local UI state only.
- Do not duplicate state between store and component.

### Styling

- Tailwind CSS utilities as the primary styling mechanism.
- MUI components for form elements, dialogs, icons, and feedback (Snackbar, CircularProgress).
- Fixed overlay modals with semi-transparent backdrop and Z-index layering.
- Keyboard shortcut hints shown in tooltips.

---

## Key Architectural Patterns

### Image Provider Protocol

Each session registers a Hypha service with:
```
imageProviderId = "{workspace}/{clientId}:{serviceId}"
```
The annotation URL encodes this ID so the annotator (`AnnotatePage`) can connect without any shared backend session.

### Annotation Data Format

- **Masks** stored as PNG in `masks_{label}/{imageName}.png` inside the session's Hypha artifact.
- **Metadata** stored as GeoJSON alongside each mask.
- OpenLayers features carry `face_color`, `edge_color`, `edge_width` properties for styling.

### Cellpose / Cellpose-SAM Integration

- Inference: `cellposeService.infer(input_arrays, params)` returns `[{output: ndarray}]`.
- ndarray serialization format (hypha-rpc): `{ _rtype, _rvalue, _rshape, _rdtype }`.
- Training: triggered via `bioimage-io/cellpose-finetuning` Hypha service with configurable epochs, learning rate, weight decay, validation interval.
- Trained model IDs are stored and retrievable per artifact for re-use in annotation sessions.

### In-Browser Python Kernel

- Single kernel instance per app lifecycle (via `KernelContext`).
- Python packages installed with `micropip` inside the session init flow.
- File sync between Python VFS and browser File System Access API via `syncFileSystem()`.

---

## Related Repositories

| Repo | Path | Language |
|---|---|---|
| spec-bioimage-io | `../spec-bioimage-io` | Python |
| core-bioimage-io-python | `../core-bioimage-io-python` | Python |
| bioengine-worker | `../bioengine-worker` | Python |

### `../spec-bioimage-io`

Defines the **official YAML format specification** for all bioimage.io resources (models, datasets, notebooks, applications). Every resource is described by a Resource Description File (RDF) validated against this spec. The repo provides the schema, documentation, and a Python library (`bioimageio.spec`) used by both the website and tooling to parse, validate, and build compliant resource descriptions. Any change to the model metadata format originates here.

### `../core-bioimage-io-python`

The **core Python runtime library** (`bioimageio.core`) for loading and executing bioimage.io models. Implements standardized pre/post-processing pipelines, weight format conversion (PyTorch, TensorFlow, ONNX, TorchScript, Keras), dataset statistics computation, and CLI tools for testing resource descriptions. This is what community partner tools and custom scripts use to run inference on Zoo models in a few lines of code.

### `../bioengine-worker`

The **distributed AI inference backend** that powers the BioEngine — the in-browser model testing service on bioimage.io. Built on Ray and Ray Serve for auto-scaling GPU inference across cloud/HPC nodes. Exposes model serving via Hypha RPC, supports dataset streaming with access control, and manages custom application deployment. This is the server-side counterpart to the BioEngine frontend that lets users test models on the website.

---

## Development Rules

1. **Read before modifying.** Always read the relevant source files before proposing changes.
2. **No speculative features.** Only build what is explicitly requested. Do not add extra abstractions, configurations, or error handling for hypothetical futures.
3. **Minimal blast radius.** Prefer scoped edits over broad refactors. A bug fix should not reformat surrounding code.
4. **No mock data in production paths.** Integration with Hypha must use real service calls. Tests may use fixtures but must be clearly separated.
5. **Keyboard accessibility.** Any new annotation tool or panel must include a keyboard shortcut and a tooltip that shows it.
6. **Coordinate system.** OpenLayers uses pixel-space (origin top-left). Never mix geographic and pixel coordinates.
7. **Undo support.** Any action that modifies the vector source must push an undo snapshot to `useAnnotationStore` before applying the change.
8. **Error surfacing.** Errors from Hypha calls must be surfaced via `FloatingBanners` (annotate) or inline UI feedback (colab), not silently swallowed.
9. **Session hygiene.** Do not leave dangling Hypha services registered. Clean up on component unmount or session delete.
10. **Model outputs are async.** Cellpose inference can be slow; always show a loading banner and disable conflicting tools during inference.

---

## Agent Skill: `bioimageio-models`

Located at `public/skills/bioimageio-models/` — served at `https://bioimage.io/skills/bioimageio-models/SKILL.md`.

This skill enables any AI agent (Claude Code, Gemini CLI, etc.) to guide a researcher through the full model contribution pipeline — no BioImage.IO expertise required:

1. **Gather info** — iteratively asks the user for model files, tensor specs, metadata
2. **Build package** — generates `bioimageio.yaml`, computes SHA256 hashes, creates test tensors
3. **Static validate** — runs `bioimageio.spec` parser
4. **Dynamic test** — runs `bioimageio test` via `bioimageio.core`
5. **Submit** — uploads to Hypha artifact manager under `bioimage-io/bioimage.io`
6. **Remote validate** — optionally triggers BioEngine runner

| File | Purpose |
|------|---------|
| `SKILL.md` | Main instructions (loaded by the agent) |
| `references/model-spec-reference.md` | Full YAML field reference |
| `references/example-rdf.yaml` | Annotated real example |
| `references/submission-guide.md` | Hypha API submission walkthrough |
| `scripts/compute_sha256.py` | SHA256 hash utility |
| `scripts/generate_test_tensors.py` | Generate test_input/output .npy |
| `scripts/validate_package.sh` | One-shot static + dynamic validation |

The Upload page (`src/components/Upload.tsx`) displays this skill URL in a banner so contributors know they can use it.

---

## Active Development Focus

The primary ongoing work is extending the collaborative annotation + Cellpose-SAM fine-tuning pipeline:

- Tighter integration between annotation masks and training data preparation.
- Interactive correction of Cellpose-SAM predictions within the annotation viewer.
- Model versioning and rollback in the Hypha artifact store.
- Progress reporting during fine-tuning via streaming Hypha RPC updates.
