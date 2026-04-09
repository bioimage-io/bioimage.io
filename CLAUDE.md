# BioImage.IO — Claude Code Guidelines

## Project Goal

Build a **collaborative, interactive bioimage annotation platform** with integrated Cellpose-SAM model fine-tuning. The platform allows bioimage researchers to:

1. **Annotate images collaboratively** — mount local folders or upload images to cloud, share annotation sessions with teammates via URL, and collect segmentation masks in real time.
2. **AI-assisted annotation** — use Cellpose (and fine-tuned variants) to auto-segment cells/nuclei, then correct predictions interactively with drawing tools.
3. **Fine-tune Cellpose-SAM** — trigger model training directly from the UI using annotated data stored in Hypha Artifacts, and deploy trained models back into the annotation workflow.

The system runs **entirely in the browser** (Python via Pyodide/WebAssembly, image visualization via OpenLayers) backed by **Hypha Cloud** for service registration, artifact storage, and RPC coordination.

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

## Active Development Focus

The primary ongoing work is extending the collaborative annotation + Cellpose-SAM fine-tuning pipeline:

- Tighter integration between annotation masks and training data preparation.
- Interactive correction of Cellpose-SAM predictions within the annotation viewer.
- Model versioning and rollback in the Hypha artifact store.
- Progress reporting during fine-tuning via streaming Hypha RPC updates.
