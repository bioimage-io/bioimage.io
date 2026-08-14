"""
BioImage.IO Colab - Dataset Image Importer

Architecture
------------
``ImageImportSession`` encapsulates state for one image-import session and
exposes the public service API as async methods. ``register_service()`` is
the entry point called from the browser kernel: it connects to Hypha,
verifies the collection, and creates an ``ImageImportSession``.

This module is intentionally narrow. It only (a) creates the dataset
artifact (owner-only ACL) and (b) reads diverse local image formats
(jpg/png/tif) from a mounted local folder and uploads them one at a time as
PNG into ``images/``. Everything else (role metadata, presigned URL handout
for annotators, label folder creation, ACL sharing, embeddings) is owned by
the standing ``annotation-broker`` BioEngine app. Annotators never talk to
this service, and the host does not need to keep a tab open once a dataset
is created and its images uploaded.

Artifact workspace
------------------
All annotation artifacts live in the **bioimage-io** workspace under the
``bioimage-io/colab-annotations`` collection, regardless of which user runs
the session. Session IDs have the form ``annotation-{short-uuid}``, giving
artifact IDs of the form ``bioimage-io/annotation-{short-uuid}``.

Artifact creation
------------------
``create_dataset()`` creates the Hypha artifact eagerly (or resumes it into
stage mode if it already exists, e.g. when mounting more images into an
existing dataset). Only the owner's own client ever calls this service, so
the artifact is created with an owner-only ACL.

Supported image formats
-----------------------
Only the extensions listed in ``ImageFormat`` are accepted. Files with other
extensions in a mounted local folder generate a console warning but are
otherwise silently skipped.
"""

from __future__ import annotations

import io
import time
from enum import Enum
from pathlib import Path
from typing import List, Optional, Tuple

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
# ImageImportSession
# ---------------------------------------------------------------------------


class ImageImportSession:
    """All state and service operations for one image-import session.

    Parameters
    ----------
    artifact_manager:
        Connected Hypha artifact-manager service proxy.
    artifact_alias:
        Short alias, e.g. ``"annotation-abc123"``. The full artifact ID is
        always ``bioimage-io/{artifact_alias}``.
    session_name:
        Human-readable dataset name stored in the artifact manifest.
    session_description:
        Dataset description stored in the artifact manifest.
    images_path:
        :class:`pathlib.Path` to the locally mounted image folder, or
        ``None`` for cloud-only sessions.
    server_url:
        Hypha server base URL.
    """

    def __init__(
        self,
        artifact_manager,
        artifact_alias: str,
        session_name: str,
        session_description: str,
        images_path: Optional[Path],
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
        self.server_url = server_url
        self.user_id = user_id
        self.user_email = user_email
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

        Called explicitly from :meth:`create_dataset`. Subsequent calls are
        no-ops once the artifact is confirmed to exist.
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
                    "labels": [],
                }
                if self.user_id:
                    manifest["created_by"] = self.user_id
                if self.user_email:
                    manifest["owner"] = {"id": self.user_id, "email": self.user_email}
                create_kwargs: dict = {
                    "parent_id": COLLECTION_ID,
                    "alias": self.artifact_alias,
                    "manifest": manifest,
                    "type": "dataset",
                    "stage": True,
                }
                # Only the dataset owner needs ACL access to the artifact.
                # Annotators and the annotation-broker never touch the ACL
                # through this service: the broker mints presigned URLs and
                # mirrors roles into the artifact ACL itself. Without an
                # explicit block, Hypha would grant write only to the
                # ephemeral connection workspace (the animal-named workspace
                # that dies with the websocket), so a reconnect could no
                # longer create/edit the artifact. Pinning the owner's
                # *persistent* identity keeps it working across reconnects.
                # Anonymous hosts have no persistent id, so fall back to
                # Hypha's default (writable by the creating connection only)
                # rather than granting anyone broad access.
                if self.user_id and self.user_id.strip().lower() != "anonymous":
                    create_kwargs["config"] = {
                        "permissions": {self.user_id: "*"}
                    }
                await self.artifact_manager.create(**create_kwargs)
                console.log(f"_ensure_artifact_exists: created {self.artifact_id}")
            except Exception as exc:
                raise ValueError(
                    f"Failed to create artifact {self.artifact_id!r}: {exc}"
                ) from exc

        self._artifact_ready = True

    async def _upload_image(self, info: dict) -> bool:
        """Upload one local image to ``images/`` in the artifact.

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
                file_path=f"images/{info['name']}",
            )
            await _pyfetch(upload_url, method="PUT", body=buf.getvalue())
            console.log(f"Uploaded {info['name']} to images/")
            return True
        except Exception as exc:
            console.error(f"Failed to upload {info.get('name')}: {exc}")
            return False

    # ------------------------------------------------------------------
    # Public service API
    # ------------------------------------------------------------------

    async def create_dataset(self, context=None) -> dict:
        """Create (or resume) the dataset artifact and return its id."""
        await self._ensure_artifact_exists()
        return {"artifact_id": self.artifact_id}

    async def list_local_images(self, context=None) -> List[dict]:
        """List stems and formats of supported images in the mounted folder."""
        if not self._use_local:
            return []
        supported, unsupported = list_image_files(self.images_path)
        for uf in unsupported:
            console.warn(f"Skipping unsupported file type in local folder: {uf.name}")
        return [
            {"stem": p.stem, "format": p.suffix.lower().lstrip(".")}
            for p in supported
        ]

    async def upload_image(self, name: str, context=None) -> dict:
        """Read one local file by name, convert to PNG, upload to ``images/``."""
        stem = Path(name).stem
        if not self.images_path:
            console.warn("upload_image: no local folder mounted")
            return {"stem": stem, "uploaded": False}

        local_path = self.images_path / name
        info = {"name": f"{stem}.png", "local_path": local_path, "source": "local"}
        await self._ensure_artifact_exists()
        uploaded = await self._upload_image(info)
        return {"stem": stem, "uploaded": uploaded}

    async def upload_all_images(self, context=None) -> dict:
        """Upload every supported image from the local folder to ``images/``.

        Thin convenience loop over :meth:`upload_image`. Returns
        ``{total, success, failed, errors}``.
        """
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

        total = len(supported)
        success = 0
        failed = 0

        for lf in supported:
            result = await self.upload_image(lf.name)
            if result["uploaded"]:
                success += 1
            else:
                failed += 1
                errors.append(f"Failed to upload {lf.name}")

        console.log(f"upload_all_images: {success}/{total} succeeded, {failed} failed")
        return {"total": total, "success": success, "failed": failed, "errors": errors}


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
    client_id: str = None,
    service_id: str = None,
    user_id: str = "",
    user_email: str = "",
) -> dict:
    """Connect to Hypha and register the image-import service.

    The Hypha artifact is NOT created here — it is created explicitly by the
    frontend calling ``create_dataset()`` after registration.

    Parameters
    ----------
    artifact_alias:
        Short alias without workspace prefix, e.g. ``"annotation-abc123"``.
        For resumed sessions this may be a full ID like
        ``"bioimage-io/annotation-abc123"`` — the workspace part is stripped.
    images_path:
        String path to the locally mounted folder (``"/mnt"``), or
        ``"None"`` / empty for cloud-only sessions.

    Returns
    -------
    dict with keys ``service_id``, ``artifact_id``, ``workspace``,
    ``client_id``.
    """
    console.log(
        f"register_service: name={name!r}, alias={artifact_alias!r}, "
        f"images_path={images_path!r}"
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

    # ── Build session ──────────────────────────────────────────────────────────
    session = ImageImportSession(
        artifact_manager=artifact_manager,
        artifact_alias=artifact_alias,  # constructor strips workspace prefix
        session_name=name,
        session_description=description,
        images_path=resolved_path,
        server_url=server_url,
        user_id=user_id or "",
        user_email=user_email or "",
    )

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
                "type": "annotation-image-importer",
                "config": {
                    "require_context": True,
                },
                "create_dataset": session.create_dataset,
                "list_local_images": session.list_local_images,
                "upload_image": session.upload_image,
                "upload_all_images": session.upload_all_images,
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
