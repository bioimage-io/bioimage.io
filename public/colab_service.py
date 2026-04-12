"""
BioImage.IO Colab - Data Providing Service

Architecture
------------
``AnnotationSession`` encapsulates all state for one annotation session and
exposes the public service API as async methods.  ``register_service()`` is
the single entry point called from the browser kernel: it connects to Hypha,
verifies the collection, and creates an ``AnnotationSession`` with lazy
artifact creation.

Artifact workspace
------------------
All annotation artifacts live in the **bioimage-io** workspace under the
``bioimage-io/colab-annotations`` collection, regardless of which user runs
the session.  Session IDs have the form ``annotation-{short-uuid}``, giving
artifact IDs of the form ``bioimage-io/annotation-{short-uuid}``.

Lazy artifact creation
----------------------
The Hypha artifact is NOT created when ``register_service()`` is called.
It is created lazily the first time an image is requested (``get_image()``)
or an upload is triggered (``upload_all_images()``).  If the artifact already
exists (resumed session), it is put into stage/edit mode instead.

Image registry and source tracking
-----------------------------------
The registry maps ``stem → {name, local_path, source}`` where ``source`` is
``"remote"`` (file already in artifact) or ``"local"`` (file only in the
mounted local folder).  Remote always wins: if the same stem exists both
remotely and locally, the remote entry is used.

Annotation status
-----------------
An image is considered **annotated** only when **both** the mask PNG
(``masks_{label}/{stem}.png``) **and** the GeoJSON
(``masks_{label}/{stem}.geojson``) are present in the artifact.

Supported image formats
-----------------------
Only the extensions listed in ``ImageFormat`` are accepted.  Files with
other extensions in a mounted local folder generate a console warning but
are otherwise silently skipped.
"""

from __future__ import annotations

import io
import time
from enum import Enum
from pathlib import Path
from typing import Dict, List, Optional, Set, Tuple

import numpy as np

# ---------------------------------------------------------------------------
# Pyodide / browser compatibility shim
# ---------------------------------------------------------------------------
try:
    from js import console as _js_console  # type: ignore

    class console:  # noqa: N801
        log = staticmethod(_js_console.log)
        warn = staticmethod(_js_console.warn)
        error = staticmethod(_js_console.error)

except ImportError:
    class console:  # type: ignore  # noqa: N801
        @staticmethod
        def log(*a): print("[LOG]", *a)
        @staticmethod
        def warn(*a): print("[WARN]", *a)
        @staticmethod
        def error(*a): print("[ERROR]", *a)

try:
    import pyodide.http as _pyodide_http  # type: ignore
    import pyodide_http as _pyodide_http_patch  # type: ignore
    _pyodide_http_patch.patch_all()
    _pyfetch = _pyodide_http.pyfetch
    IN_PYODIDE = True
except ImportError:
    IN_PYODIDE = False

    async def _pyfetch(url: str, method: str = "GET", body=None, **_):  # type: ignore
        raise NotImplementedError(
            "_pyfetch is not available outside Pyodide. Mock it in tests."
        )

try:
    from hypha_rpc import connect_to_server  # type: ignore
except ImportError:
    connect_to_server = None  # type: ignore

try:
    from PIL import Image  # type: ignore
    from tifffile import imread as _tiffread  # type: ignore
except ImportError:
    Image = None  # type: ignore
    _tiffread = None  # type: ignore

# ---------------------------------------------------------------------------
# Constants
# ---------------------------------------------------------------------------

COLLECTION_ID = "bioimage-io/colab-annotations"
ARTIFACT_WORKSPACE = "bioimage-io"


class ImageFormat(str, Enum):
    JPEG = "jpeg"
    JPG = "jpg"
    PNG = "png"
    TIF = "tif"
    TIFF = "tiff"


SUPPORTED_EXTENSIONS: frozenset[str] = frozenset(
    f".{fmt.value}" for fmt in ImageFormat
)

# ---------------------------------------------------------------------------
# Image I/O helpers
# ---------------------------------------------------------------------------


def list_image_files(
    folder: Path,
) -> Tuple[List[Path], List[Path]]:
    """Return ``(supported, unsupported)`` file lists from *folder* (non-recursive).

    *supported* are files whose extension is in :data:`SUPPORTED_EXTENSIONS`.
    *unsupported* are all other files (directories are ignored).
    """
    supported: List[Path] = []
    unsupported: List[Path] = []
    try:
        for entry in sorted(folder.iterdir()):
            if not entry.is_file():
                continue
            if entry.suffix.lower() in SUPPORTED_EXTENSIONS:
                supported.append(entry)
            else:
                unsupported.append(entry)
    except Exception as exc:
        console.error(f"list_image_files({folder}): {exc}")
    return supported, unsupported


def _read_pil(path: Path) -> "np.ndarray":
    with Image.open(path) as img:
        return np.array(img)


def _read_tiff(path: Path) -> "np.ndarray":
    return _tiffread(str(path))


_READERS = {
    ".jpeg": _read_pil,
    ".jpg": _read_pil,
    ".png": _read_pil,
    ".tif": _read_tiff,
    ".tiff": _read_tiff,
}


def _process_image(arr: "np.ndarray") -> "np.ndarray":
    """Normalise to HWC RGB uint8."""
    if arr.ndim == 3:
        if arr.shape[0] in (1, 3, 4) and arr.shape[0] < arr.shape[1] and arr.shape[0] < arr.shape[2]:
            arr = np.transpose(arr, (1, 2, 0))
    if arr.ndim == 2:
        arr = np.stack([arr] * 3, axis=-1)
    elif arr.ndim == 3:
        c = arr.shape[2]
        if c == 1:
            arr = np.concatenate([arr] * 3, axis=-1)
        elif c == 4:
            arr = arr[..., :3]
        elif c == 2:
            arr = np.stack([arr[..., 0]] * 3, axis=-1)
    if arr.dtype != np.uint8:
        lo, hi = arr.min(), arr.max()
        if hi > lo:
            arr = ((arr - lo) / (hi - lo) * 255).astype(np.uint8)
        else:
            arr = np.zeros_like(arr, dtype=np.uint8)
    return arr


def read_image(path: Path) -> "np.ndarray":
    """Read *path* and return an HWC RGB uint8 numpy array."""
    reader = _READERS.get(path.suffix.lower())
    if reader is None:
        raise ValueError(f"Unsupported extension: {path.suffix}")
    return _process_image(reader(path))


# ---------------------------------------------------------------------------
# AnnotationSession
# ---------------------------------------------------------------------------


class AnnotationSession:
    """All state and service operations for one annotation session.

    Parameters
    ----------
    artifact_manager:
        Connected Hypha artifact-manager service proxy.
    artifact_alias:
        Short alias, e.g. ``"annotation-abc123"``.  The full artifact ID is
        always ``bioimage-io/{artifact_alias}``.
    session_name:
        Human-readable session name stored in the artifact manifest.
    session_description:
        Session description stored in the artifact manifest.
    images_path:
        :class:`pathlib.Path` to the locally mounted image folder, or
        ``None`` for cloud-only / resume sessions.
    label:
        Annotation label, e.g. ``"cells"``.
    server_url:
        Hypha server base URL (used for fallback download URLs).
    """

    def __init__(
        self,
        artifact_manager,
        artifact_alias: str,
        session_name: str,
        session_description: str,
        images_path: Optional[Path],
        label: str,
        server_url: str,
        user_id: str = "",
        user_email: str = "",
    ) -> None:
        self.artifact_manager = artifact_manager
        # artifact_alias is the short part (no workspace prefix)
        self.artifact_alias = artifact_alias.split("/")[-1]
        self.artifact_id = f"{ARTIFACT_WORKSPACE}/{self.artifact_alias}"
        self.session_name = session_name
        self.session_description = session_description
        self.images_path = images_path
        self.label = label
        self.server_url = server_url
        self.user_id = user_id
        self.user_email = user_email
        self._cellpose_model: Optional[str] = None
        self._artifact_ready = False  # True once artifact has been verified/created

    # ------------------------------------------------------------------
    # Internal helpers
    # ------------------------------------------------------------------

    @property
    def _use_local(self) -> bool:
        return bool(
            self.images_path
            and self.images_path.exists()
            and self.images_path.is_dir()
        )

    async def _ensure_artifact_exists(self) -> None:
        """Create or resume the artifact in ``bioimage-io/`` workspace.

        Called lazily before the first image request or upload.  Subsequent
        calls are no-ops once the artifact is confirmed to exist.
        """
        if self._artifact_ready:
            return

        try:
            artifact = await self.artifact_manager.read(
                artifact_id=self.artifact_id, stage=True
            )
            console.log(f"_ensure_artifact_exists: resuming {self.artifact_id}")
            # Put into edit/stage mode so we can write new files
            try:
                await self.artifact_manager.edit(
                    artifact_id=artifact.id, stage=True
                )
            except Exception as exc:
                console.warn(f"Could not put artifact into stage mode: {exc}")
        except Exception:
            console.log(f"_ensure_artifact_exists: creating {self.artifact_id}")
            try:
                description = self.session_description
                if self.user_email:
                    description = f"{description} (Owner: {self.user_email})"
                manifest: dict = {
                    "name": self.session_name,
                    "description": description,
                }
                if self.user_id:
                    manifest["created_by"] = self.user_id
                if self.user_email:
                    manifest["owner"] = {"id": self.user_id, "email": self.user_email}
                await self.artifact_manager.create(
                    parent_id=COLLECTION_ID,
                    alias=self.artifact_alias,
                    manifest=manifest,
                    type="dataset",
                    stage=True,
                )
                console.log(f"_ensure_artifact_exists: created {self.artifact_id}")
            except Exception as exc:
                raise ValueError(
                    f"Failed to create artifact {self.artifact_id!r}: {exc}"
                ) from exc

        self._artifact_ready = True

    async def _list_remote_images(self) -> List[dict]:
        """Return list of file dicts from ``train_images/`` and ``test_images/``.

        Returns an empty list if the artifact does not yet exist or has no
        files in those directories.
        """
        result: List[dict] = []
        for folder in ("train_images", "test_images"):
            try:
                files = await self.artifact_manager.list_files(
                    self.artifact_id, dir_path=folder, stage=True
                )
                result.extend(files or [])
            except Exception:
                pass  # folder may not exist yet
        return result

    async def _build_registry(self) -> Dict[str, dict]:
        """Build stem → ``{name, local_path, source}`` registry.

        Remote files are added first (``source="remote"``).  Local files only
        fill gaps — same stem present remotely is skipped.  The ``source``
        field is always ``"remote"`` for artifact images and ``"local"`` for
        images only on disk.
        """
        registry: Dict[str, dict] = {}

        # 1. Remote images (already in artifact)
        remote = await self._list_remote_images()
        console.log(f"_build_registry: {len(remote)} remote image(s)")
        for rf in remote:
            stem = Path(rf["name"]).stem
            registry[stem] = {
                "name": rf["name"],
                "local_path": None,
                "source": "remote",
            }

        # 2. Local images (only new stems)
        console.log(
            f"_build_registry: images_path={self.images_path!r}, "
            f"_use_local={self._use_local}"
        )
        if self._use_local:
            supported, unsupported = list_image_files(self.images_path)
            for uf in unsupported:
                console.warn(f"Skipping unsupported file type in local folder: {uf.name}")
            for lf in supported:
                if lf.stem not in registry:
                    registry[lf.stem] = {
                        "name": lf.stem + ".png",  # uploaded as PNG
                        "local_path": lf,
                        "source": "local",
                    }
            console.log(
                f"_build_registry: {len(supported)} local image(s), "
                f"{len(registry) - len(remote)} new"
            )

        return registry

    async def _get_annotated_stems(self) -> Set[str]:
        """Return stems where **both** mask PNG and GeoJSON are present."""
        try:
            files = await self.artifact_manager.list_files(
                self.artifact_id,
                dir_path=f"masks_{self.label}",
                stage=True,
            )
            if not files:
                return set()
            names = [f["name"] for f in files]
            png_stems = {Path(n).stem for n in names if n.endswith(".png")}
            geojson_stems = {Path(n).stem for n in names if n.endswith(".geojson")}
            return png_stems & geojson_stems  # annotated = BOTH files present
        except Exception:
            return set()

    async def _upload_image(self, info: dict) -> bool:
        """Upload one local image to ``train_images/`` in the artifact.

        Converts the source file to PNG before uploading.
        Returns ``True`` on success, ``False`` on failure.
        """
        local_path: Optional[Path] = info["local_path"]
        if local_path is None:
            return True  # already remote, nothing to do
        try:
            arr = read_image(local_path)
            pil = Image.fromarray(arr, mode="RGB")
            buf = io.BytesIO()
            pil.save(buf, format="PNG")
            upload_url = await self.artifact_manager.put_file(
                self.artifact_id,
                file_path=f"train_images/{info['name']}",
            )
            await _pyfetch(upload_url, method="PUT", body=buf.getvalue())
            console.log(f"Uploaded {info['name']} to train_images/")
            return True
        except Exception as exc:
            console.error(f"Failed to upload {info.get('name')}: {exc}")
            return False

    async def _get_download_url(self, image_name: str) -> str:
        """Return a presigned download URL for *image_name*.

        Checks ``train_images/`` first, then ``test_images/``.
        Falls back to a direct URL if the artifact manager call fails.
        """
        for folder in ("train_images", "test_images"):
            try:
                return await self.artifact_manager.get_file(
                    self.artifact_id,
                    file_path=f"{folder}/{image_name}",
                    stage=True,
                )
            except Exception:
                pass
        console.warn(f"get_file failed for {image_name}, using direct URL fallback")
        return (
            f"{self.server_url}/{ARTIFACT_WORKSPACE}/artifacts/{self.artifact_alias}"
            f"/files/train_images/{image_name}"
        )

    # ------------------------------------------------------------------
    # Public service API
    # ------------------------------------------------------------------

    def set_cellpose_model(self, model: str, context=None) -> bool:
        """Update the active Cellpose model returned with image results."""
        console.log(f"set_cellpose_model → {model}")
        self._cellpose_model = model
        return True

    async def get_image(self, context=None) -> dict:
        """Return a presigned download URL for the next unannotated image.

        Ensures the artifact exists first (lazy creation).  If the chosen
        image is only available locally it is uploaded on demand.

        Return dict shapes
        ------------------
        - ``{"url": ..., "name": ..., "cellpose_model": ...}``  — normal case
        - ``{"status": "no_images", "message": ...}``           — nothing available
        - ``{"status": "all_annotated", ...}``                  — all done
        - ``{"status": "error", "message": ...}``               — upload failed
        """
        console.log("get_image called")
        await self._ensure_artifact_exists()

        registry = await self._build_registry()

        if not registry:
            return {
                "status": "no_images",
                "message": (
                    "No images found. Mount a local folder or upload images to the "
                    "artifact first."
                ),
            }

        annotated = await self._get_annotated_stems()
        unannotated = {s: v for s, v in registry.items() if s not in annotated}
        console.log(
            f"Registry: {len(registry)} total, {len(annotated)} annotated, "
            f"{len(unannotated)} remaining"
        )

        if not unannotated:
            return {
                "status": "all_annotated",
                "total": len(registry),
                "annotated": len(annotated),
                "label": self.label,
                "message": (
                    f"All {len(registry)} images have been annotated for label "
                    f"'{self.label}'."
                ),
            }

        # Random sample from unannotated
        stems = list(unannotated.keys())
        chosen_stem = stems[int(np.random.randint(len(stems)))]
        chosen = unannotated[chosen_stem]
        console.log(
            f"Selected: {chosen['name']} (source={chosen['source']})"
        )

        # Upload on demand if local-only
        if chosen["source"] == "local":
            # Check if it was already uploaded in a previous call
            remote = await self._list_remote_images()
            already_remote = any(Path(f["name"]).stem == chosen_stem for f in remote)
            if not already_remote:
                if not await self._upload_image(chosen):
                    return {
                        "status": "error",
                        "message": (
                            f"Failed to upload image '{chosen['name']}'. "
                            "Check console for details."
                        ),
                    }

        url = await self._get_download_url(chosen["name"])
        return {
            "url": url,
            "name": chosen["name"],
            "cellpose_model": self._cellpose_model,
        }

    async def upload_all_images(self, context=None) -> dict:
        """Upload all images from the local folder to the artifact.

        Ensures the artifact exists first (lazy creation).  Already-uploaded
        images are skipped.  Returns ``{total, success, failed, errors}``.
        """
        # Diagnose _use_local to provide actionable error messages
        console.log(
            f"upload_all_images: images_path={self.images_path!r}, "
            f"_use_local={self._use_local}, "
            f"path_exists={self.images_path.exists() if self.images_path else 'N/A'}, "
            f"path_is_dir={self.images_path.is_dir() if self.images_path and self.images_path.exists() else 'N/A'}"
        )
        if not self._use_local:
            reason = (
                "images_path is None" if not self.images_path
                else f"path does not exist: {self.images_path}"
                if not self.images_path.exists()
                else f"path is not a directory: {self.images_path}"
            )
            console.warn(f"upload_all_images: cannot upload — {reason}")
            return {
                "total": 0,
                "success": 0,
                "failed": 0,
                "errors": [f"No local folder mounted ({reason})"],
            }

        await self._ensure_artifact_exists()

        supported, unsupported = list_image_files(self.images_path)
        errors: List[str] = [
            f"Skipping unsupported file: {f.name}" for f in unsupported
        ]
        for uf in unsupported:
            console.warn(f"Unsupported file skipped: {uf.name}")

        # Fetch remote stems once to avoid repeated list_files calls
        remote = await self._list_remote_images()
        uploaded_stems: Set[str] = {Path(f["name"]).stem for f in remote}

        total = len(supported)
        success = 0
        failed = 0

        for lf in supported:
            if lf.stem in uploaded_stems:
                console.log(f"{lf.name} already uploaded, skipping")
                success += 1
                continue
            info = {"name": lf.stem + ".png", "local_path": lf, "source": "local"}
            if await self._upload_image(info):
                success += 1
                uploaded_stems.add(lf.stem)
            else:
                failed += 1
                errors.append(f"Failed to upload {lf.name}")

        console.log(f"upload_all_images: {success}/{total} succeeded, {failed} failed")
        return {"total": total, "success": success, "failed": failed, "errors": errors}

    async def upload_images_from_temp(self, context=None) -> dict:
        """Upload files written to ``/tmp/uploads`` (browser drag-and-drop flow).

        Returns the same shape as :meth:`upload_all_images`.
        """
        temp_dir = Path("/tmp/uploads")
        if not temp_dir.exists():
            return {
                "total": 0,
                "success": 0,
                "failed": 0,
                "errors": ["Temp upload directory does not exist"],
            }

        try:
            all_files = list(temp_dir.iterdir())
        except Exception as exc:
            return {
                "total": 0,
                "success": 0,
                "failed": 0,
                "errors": [f"Cannot read temp dir: {exc}"],
            }

        supported = [f for f in all_files if f.suffix.lower() in SUPPORTED_EXTENSIONS]
        unsupported = [f for f in all_files if f.suffix.lower() not in SUPPORTED_EXTENSIONS]
        errors: List[str] = [f"Skipping unsupported file: {f.name}" for f in unsupported]

        await self._ensure_artifact_exists()

        total = len(supported)
        success = 0
        failed = 0

        for fp in supported:
            info = {"name": fp.stem + ".png", "local_path": fp, "source": "local"}
            if await self._upload_image(info):
                success += 1
                fp.unlink(missing_ok=True)
            else:
                failed += 1
                errors.append(f"Failed to upload {fp.name}")

        try:
            if not list(temp_dir.iterdir()):
                temp_dir.rmdir()
        except Exception:
            pass

        return {"total": total, "success": success, "failed": failed, "errors": errors}

    async def get_save_urls(self, image_name: str, label: str = None, context=None) -> dict:
        """Return presigned PUT URLs for saving annotation files.

        ``label`` overrides the session label when provided (allows the
        annotation UI to specify which label it is saving for).

        Returns ``{"png_url": ..., "geojson_url": ..., "image_stem": ...}``
        """
        effective_label = label if label else self.label
        stem = Path(image_name).stem
        console.log(f"get_save_urls for {stem}, label={effective_label!r}")
        await self._ensure_artifact_exists()
        png_url = await self.artifact_manager.put_file(
            self.artifact_id, file_path=f"masks_{effective_label}/{stem}.png"
        )
        geojson_url = await self.artifact_manager.put_file(
            self.artifact_id, file_path=f"masks_{effective_label}/{stem}.geojson"
        )
        return {"png_url": png_url, "geojson_url": geojson_url, "image_stem": stem}

    async def list_images(self, context=None) -> List[dict]:
        """List all images with their annotation status.

        Returns a list of dicts: ``name``, ``stem``, ``source``,
        ``is_annotated``.
        """
        registry = await self._build_registry()
        annotated = await self._get_annotated_stems()
        return [
            {
                "name": info["name"],
                "stem": stem,
                "source": info["source"],
                "is_annotated": stem in annotated,
            }
            for stem, info in sorted(registry.items())
        ]


# ---------------------------------------------------------------------------
# Standalone helper (no session state needed)
# ---------------------------------------------------------------------------


async def write_file_to_temp(
    file_name: str,
    file_data_base64: str,
    context=None,
) -> dict:
    """Write a base64-encoded file from the browser to ``/tmp/uploads``."""
    import base64

    try:
        data = base64.b64decode(file_data_base64)
        dest = Path("/tmp/uploads")
        dest.mkdir(exist_ok=True)
        out = dest / file_name
        out.write_bytes(data)
        console.log(f"write_file_to_temp: {file_name} ({len(data)} bytes)")
        return {"success": True, "temp_path": str(out), "error": None}
    except Exception as exc:
        console.error(f"write_file_to_temp failed for {file_name}: {exc}")
        return {"success": False, "temp_path": None, "error": str(exc)}


# ---------------------------------------------------------------------------
# Service registration
# ---------------------------------------------------------------------------


async def register_service(
    server_url: str,
    token: str,
    name: str,
    description: str,
    artifact_alias: str,
    images_path: str,
    label: str,
    client_id: str = None,
    service_id: str = None,
    cellpose_model: str = None,
    user_id: str = "",
    user_email: str = "",
) -> dict:
    """Connect to Hypha and register the annotation data-provider service.

    The Hypha artifact is NOT created here — it is created lazily on the
    first ``get_image()`` or ``upload_all_images()`` call.

    Parameters
    ----------
    artifact_alias:
        Short alias without workspace prefix, e.g. ``"annotation-abc123"``.
        For resumed sessions this may be a full ID like
        ``"bioimage-io/annotation-abc123"`` — the workspace part is stripped.
    images_path:
        String path to the locally mounted folder (``"/mnt"``), or
        ``"None"`` / empty for cloud-only / resume sessions.

    Returns
    -------
    dict with keys ``service_id``, ``artifact_id``, ``workspace``,
    ``client_id``.
    """
    console.log(
        f"register_service: name={name!r}, alias={artifact_alias!r}, "
        f"label={label!r}, images_path={images_path!r}"
    )

    if connect_to_server is None:
        raise RuntimeError("hypha_rpc is not available")

    # ── Connect ──────────────────────────────────────────────────────────────
    connect_cfg: dict = {"server_url": server_url, "token": token}
    if client_id:
        connect_cfg["client_id"] = client_id

    global _hypha_client  # noqa: PLW0603

    async def _disconnect():
        global _hypha_client
        if "_hypha_client" in globals() and _hypha_client is not None:
            try:
                await _hypha_client.disconnect()
            except Exception:
                pass
            _hypha_client = None

    await _disconnect()

    try:
        _hypha_client = await connect_to_server(connect_cfg)
    except Exception as exc:
        raise ValueError(f"Failed to connect to Hypha: {exc}") from exc

    try:
        artifact_manager = await _hypha_client.get_service("public/artifact-manager")
    except Exception as exc:
        await _disconnect()
        raise ValueError(f"Failed to get artifact-manager: {exc}") from exc

    user_workspace: str = _hypha_client.config.get("workspace", "")
    console.log(f"register_service: connected to workspace={user_workspace!r}")

    # ── Verify collection exists ──────────────────────────────────────────────
    try:
        await artifact_manager.read(artifact_id=COLLECTION_ID)
    except Exception as exc:
        await _disconnect()
        raise ValueError(f"Collection {COLLECTION_ID!r} not found: {exc}") from exc

    # ── Resolve images path ───────────────────────────────────────────────────
    resolved_path: Optional[Path] = None
    if images_path and str(images_path).strip() not in ("", "None", "null"):
        p = Path(str(images_path).strip())
        console.log(
            f"register_service: checking path {p!r}, "
            f"exists={p.exists()}, is_dir={p.is_dir() if p.exists() else 'N/A'}"
        )
        if p.exists() and p.is_dir():
            supported, unsupported = list_image_files(p)
            if unsupported:
                console.warn(
                    f"{len(unsupported)} unsupported file(s) in {p} will be skipped: "
                    f"{[f.name for f in unsupported[:5]]}"
                )
            console.log(f"Local folder {p}: {len(supported)} supported image(s)")
            resolved_path = p
        else:
            console.warn(f"images_path {images_path!r} does not exist or is not a dir")

    # ── Build session (artifact created lazily) ───────────────────────────────
    session = AnnotationSession(
        artifact_manager=artifact_manager,
        artifact_alias=artifact_alias,  # constructor strips workspace prefix
        session_name=name,
        session_description=description,
        images_path=resolved_path,
        label=label,
        server_url=server_url,
        user_id=user_id or "",
        user_email=user_email or "",
    )
    if cellpose_model:
        session._cellpose_model = cellpose_model

    console.log(
        f"register_service: session ready — artifact_id={session.artifact_id!r}, "
        f"_use_local={session._use_local}"
    )

    # ── Register Hypha service ────────────────────────────────────────────────
    actual_service_id = service_id or f"data-provider-{int(time.time() * 100)}"

    try:
        svc = await _hypha_client.register_service(
            {
                "name": name,
                "description": description,
                "id": actual_service_id,
                "type": "annotation-data-provider",
                "config": {
                    "visibility": "public",
                    "require_context": True,
                },
                "get_image": session.get_image,
                "upload_all_images": session.upload_all_images,
                "upload_images_from_temp": session.upload_images_from_temp,
                "get_save_urls": session.get_save_urls,
                "list_images": session.list_images,
                "set_cellpose_model": session.set_cellpose_model,
                "write_file_to_temp": write_file_to_temp,
            }
        )
    except Exception as exc:
        await _disconnect()
        raise ValueError(f"Failed to register service: {exc}") from exc

    console.log(
        f"Service registered: id={svc['id']}, artifact={session.artifact_id}, "
        f"user_workspace={user_workspace}"
    )

    return {
        "service_id": svc["id"],
        "artifact_id": session.artifact_id,
        "workspace": user_workspace,
        "client_id": _hypha_client.config.get("client_id", ""),
    }
