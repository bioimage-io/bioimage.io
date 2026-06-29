---
name: BioImage.IO website
description: Code-level guidance for the bioimage.io React/TypeScript frontend — coding standards, architectural patterns, component inventory, and development rules.
---

# BioImage.IO website — maintainer guide

Deep guidance for anyone working in this repository. The slim
top-level `CLAUDE.md` covers what the project is and which stack it
uses; this skill covers *how* the code is organized and what
conventions to follow when changing it.

## Coding Standards

Mirrors `.github/copilot-instructions.md`.

### Python (in-browser kernel + service modules)

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

### Hypha-reachability Banner

- One global `HyphaStatusBanner` mounted at the layout root owns the "Hypha is temporarily unreachable" UI. Any fetch/connect failure flips `isHyphaUnreachable` on `useHyphaStore`; per-section components defer to the banner instead of showing their own red error cards.
- Banner files: `src/components/HyphaStatusBanner.tsx`, store flag in `src/store/hyphaStore.ts`.

### Centralized Hypha server URL

- `src/config/hypha.ts` exports `HYPHA_SERVER_URL`. Override at build time via `REACT_APP_HYPHA_SERVER_URL`. Import the constant everywhere instead of hard-coding `https://hypha.aicell.io`.

## Component Inventory

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

- **useHyphaStore** (Zustand, `src/store/hyphaStore.ts`) — Hypha connection, authentication, artifact browsing, pagination, resource selection, Hypha-reachability signal.
- **useAnnotationStore** (Zustand) — Active tool, labels, image info, undo stack (max 10 snapshots), loading/error states.

### Python Backend (in-browser)

- **`public/colab_service.py`** — Hypha service registered per session: `get_image()`, `save_annotation()`, `get_save_urls()`, optional `get_local_image_base64()`.

## Related Repositories

| Repo | Path | Language |
|---|---|---|
| spec-bioimage-io | `../spec-bioimage-io` | Python |
| core-bioimage-io-python | `../core-bioimage-io-python` | Python |
| bioengine | `../bioengine` | Python |

### `../spec-bioimage-io`

Defines the **official YAML format specification** for all bioimage.io resources (models, datasets, notebooks, applications). Every resource is described by a Resource Description File (RDF) validated against this spec. The repo provides the schema, documentation, and a Python library (`bioimageio.spec`) used by both the website and tooling to parse, validate, and build compliant resource descriptions. Any change to the model metadata format originates here.

### `../core-bioimage-io-python`

The **core Python runtime library** (`bioimageio.core`) for loading and executing bioimage.io models. Implements standardized pre/post-processing pipelines, weight format conversion (PyTorch, TensorFlow, ONNX, TorchScript, Keras), dataset statistics computation, and CLI tools for testing resource descriptions. This is what community partner tools and custom scripts use to run inference on Zoo models in a few lines of code.

### `../bioengine`

The **distributed AI inference backend** that powers the BioEngine — the in-browser model testing service on bioimage.io. Built on Ray and Ray Serve for auto-scaling GPU inference across cloud/HPC nodes. Exposes model serving via Hypha RPC, supports dataset streaming with access control, and manages custom application deployment. This is the server-side counterpart to the BioEngine frontend that lets users test models on the website.

**BioEngine skill**: When working with BioEngine apps (deploying, updating, calling services), load the skill at `public/skills/bioengine/SKILL.md` first — it contains the canonical deploy workflow, CLI reference, and critical pitfalls. Key rule: always pass `--app-id <running-id>` when updating a deployed app; omitting it always creates a new random instance.

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
