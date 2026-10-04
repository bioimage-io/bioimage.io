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
pyramidal OME-TIFF into ``images/``. Everything else (role metadata, presigned URL handout
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
    from tifffile import TiffWriter as _TiffWriter  # type: ignore
    from tifffile import imread as _tiffread  # type: ignore
except ImportError:
    Image = None  # type: ignore
    _tiffread = None  # type: ignore
    _TiffWriter = None  # type: ignore

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

# The OME-TIFF profile (colab-c-ometiff-design.md §4). Fixed rather than
# configurable so the browser-side reader can stay simple and the writer
# stays verifiable.
OME_TIFF_MIN_LONG_AXIS = 512  # coarsest pyramid level, long axis
OME_TIFF_TILE = 512  # tile edge, matches what omezarr-view reports

# Images land as ``images/<stem>.tif``, NOT ``<stem>.ome.tif``, even though
# the bytes are a full OME-TIFF (the OME-XML lives in ImageDescription, so
# Bio-Formats and QuPath detect it by content, not by name). A compound
# extension would break every stem derivation in the stack at once, because
# they all take the last extension only: `Path(name).stem` in the broker and
# `name.replace(/\.[^./]+$/, '')` in the frontend would both turn
# `cells.ome.tif` into the stem `cells.ome`. Stems key annotations,
# embeddings and splits, so a missed call site would not throw, it would
# silently orphan a user's work. One-extension naming removes the failure
# mode instead of fixing N instances of it.
OME_TIFF_EXTENSION = ".tif"

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
        # A palette image would otherwise come back as an index array, and a
        # bilevel one as booleans. Both are silently wrong as pixel data, so
        # expand them to real samples before handing over to numpy.
        if img.mode in ("P", "PA"):
            img = img.convert("RGBA" if "A" in img.mode else "RGB")
        elif img.mode == "1":
            img = img.convert("L")
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


def normalise_axes(arr: "np.ndarray") -> "np.ndarray":
    """Put an array into the profile's axis order: ``YX`` or ``YXC``.

    Only the layout is touched. dtype, channel count and every sample value
    survive unchanged, which is the whole point of the OME-TIFF path: the
    artifact is meant to stop being a lossy derivative of what the user has
    on disk.

    A leading channel axis (``CYX``, how tifffile hands back many microscopy
    files) is transposed to trailing. A trailing singleton is squeezed so a
    single-channel image round-trips as 2-D rather than as ``(H, W, 1)``.
    """
    if arr.ndim == 3 and arr.shape[0] in (1, 2, 3, 4) and arr.shape[0] < arr.shape[1] and arr.shape[0] < arr.shape[2]:
        arr = np.transpose(arr, (1, 2, 0))
    if arr.ndim == 3 and arr.shape[2] == 1:
        arr = arr[..., 0]
    return arr


def read_image_native(path: Path) -> "np.ndarray":
    """Read *path* preserving dtype and channels, in ``YX`` / ``YXC`` order."""
    reader = _READERS.get(path.suffix.lower())
    if reader is None:
        raise ValueError(f"Unsupported extension: {path.suffix}")
    return normalise_axes(reader(path))


def build_pyramid(
    arr: "np.ndarray", min_long_axis: int = OME_TIFF_MIN_LONG_AXIS
) -> "List[np.ndarray]":
    """Factor-2 levels, finest first, down to a long axis of *min_long_axis*.

    Box-averages in float so a uint8 source cannot wrap around, then casts
    back, so every level keeps the source dtype (which is what lets the
    browser pick a coarse level and still get representative intensities).
    An odd dimension drops its last row/column rather than padding: a
    one-pixel edge artifact at level n is preferable to inventing data.
    """
    levels = [arr]
    while max(levels[-1].shape[0], levels[-1].shape[1]) > min_long_axis:
        prev = levels[-1]
        h, w = prev.shape[0] // 2, prev.shape[1] // 2
        if h < 1 or w < 1:
            break
        crop = prev[: h * 2, : w * 2]
        if crop.ndim == 2:
            small = crop.reshape(h, 2, w, 2).mean(axis=(1, 3))
        else:
            small = crop.reshape(h, 2, w, 2, crop.shape[2]).mean(axis=(1, 3))
        levels.append(small.astype(arr.dtype))
    return levels


def _photometric_for(arr: "np.ndarray") -> str:
    """``rgb`` only for 3- and 4-sample images, ``minisblack`` otherwise.

    Verified against both readers we depend on: 1- and 2-channel data written
    as ``rgb`` is rejected outright by tifffile, and 2-channel data is
    genuinely not RGB (two fluorescence channels is the common case).
    """
    return "rgb" if arr.ndim == 3 and arr.shape[2] in (3, 4) else "minisblack"


def encode_ome_tiff(
    arr: "np.ndarray",
    min_long_axis: int = OME_TIFF_MIN_LONG_AXIS,
    tile: int = OME_TIFF_TILE,
) -> bytes:
    """Encode *arr* as a SubIFD-pyramidal OME-TIFF per the profile.

    Convenience wrapper over :func:`encode_ome_tiff_levels` for the common
    case where the caller has only the full-resolution array.
    """
    return encode_ome_tiff_levels(build_pyramid(arr, min_long_axis), tile=tile)


def encode_ome_tiff_levels(
    levels: "List[np.ndarray]",
    tile: int = OME_TIFF_TILE,
) -> bytes:
    """Encode an already-built pyramid, finest first, per the profile.

    Split out of :func:`encode_ome_tiff` so a caller that needs the level
    count as well as the bytes (materialisation reports it to the broker) can
    build the pyramid once. Box-averaging every level a second time just to
    count them is a full pass over the image, and in Pyodide that is not free.

    Level 0 is IFD 0; levels 1..n are its SubIFDs, which is what makes
    ``tifffile.imread`` and ``imageio.v3.imread`` return the *full* image
    rather than the smallest level. Coarsest-first page order would be
    cheaper for the browser but makes both readers return a thumbnail as if
    it were the image, so it is not an option.

    Deflate, because no browser Zarr/TIFF implementation ships an LZW codec.
    """
    if not levels:
        raise ValueError("Cannot encode an OME-TIFF from an empty pyramid.")
    arr = levels[0]
    photometric = _photometric_for(arr)
    buf = io.BytesIO()
    with _TiffWriter(buf, bigtiff=arr.nbytes > 4 * 1024**3, ome=True) as writer:
        writer.write(
            levels[0],
            subifds=len(levels) - 1,
            photometric=photometric,
            tile=(tile, tile),
            compression="deflate",
        )
        for level in levels[1:]:
            writer.write(
                level,
                subfiletype=1,  # REDUCEDIMAGE
                photometric=photometric,
                tile=(tile, tile),
                compression="deflate",
            )
    return buf.getvalue()


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
                manifest: dict = {
                    "name": self.session_name,
                    "description": description,
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

        Transcodes the source file to a pyramidal OME-TIFF before uploading,
        preserving dtype and channel count. Returns ``True`` on success,
        ``False`` on failure.
        """
        local_path: Optional[Path] = info["local_path"]
        if local_path is None:
            return True  # already remote, nothing to do
        try:
            arr = read_image_native(local_path)
            body = encode_ome_tiff(arr)
            upload_url = await self.artifact_manager.put_file(
                self.artifact_id,
                file_path=f"images/{info['name']}",
            )
            await _pyfetch(upload_url, method="PUT", body=body)
            console.log(
                f"Uploaded {info['name']} to images/ "
                f"({arr.shape} {arr.dtype}, {len(body)} bytes)"
            )
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
        """Read one local file by name, transcode to OME-TIFF, upload it.

        Returns the artifact-relative ``name`` alongside the stem so the
        caller never has to reconstruct the extension. It used to be able to
        assume ``.png``; it cannot any more, and guessing is what would put a
        row in the UI that points at a file that does not exist.
        """
        stem = Path(name).stem
        if not self.images_path:
            console.warn("upload_image: no local folder mounted")
            return {"stem": stem, "uploaded": False}

        target = f"{stem}{OME_TIFF_EXTENSION}"
        local_path = self.images_path / name
        info = {"name": target, "local_path": local_path, "source": "local"}
        await self._ensure_artifact_exists()
        uploaded = await self._upload_image(info)
        return {"stem": stem, "name": target, "uploaded": uploaded}

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
