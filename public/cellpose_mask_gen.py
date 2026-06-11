"""Pyodide-runnable port of cellpose.dynamics.compute_masks.

Used by the bioimage.io annotate page so that the mask-gen knobs
(``flow_threshold``, ``cellprob_threshold``, ``niter``, ``min_size``) can
be tuned without a GPU round-trip. The server-side cellpose-finetuning
service returns the raw ``(dP, cellprob)`` flows; the browser caches them
in component state and re-runs :func:`compute_masks_np` on every slider
drag.

Only numpy + scipy.ndimage are used (both are in Pyodide). The
algorithmic content mirrors ``cellpose.dynamics.compute_masks`` in
Cellpose 4.0.7 — see ``resources/cpsam.md`` in the bioengine repo for the
line-by-line cross reference and the torch-op mapping.

Public entry point
------------------
:func:`compute_masks_np` takes the same inputs the server produces and
returns a uint16 (or uint32 if labels overflow) ``(H, W)`` label image,
where 0 is background and each positive value identifies one instance.

Notes
-----
- ``flow_threshold`` QC is deliberately *not* ported in this revision.
  Cellpose's torch implementation of ``remove_bad_flow_masks`` requires a
  separate diffusion solver; the v1 client ships with that QC step
  skipped (``flow_threshold=0``). Users who want the QC will still get it
  via the server path (``return_flows_only=False``).
- The seed-extension ordering inside :func:`get_masks_np` may differ
  from the torch path by a tiebreak when two seeds share the same
  histogram count. Pixel agreement against the server output is
  expected to be ~99%, not 100%, and labels may be renumbered.
"""

from __future__ import annotations

import numpy as np
from scipy.ndimage import (
    binary_fill_holes,
    find_objects,
    map_coordinates,
    maximum_filter,
)


def _follow_flows(dP: np.ndarray, inds, niter: int) -> np.ndarray:
    """Pure-numpy Euler integration of pixel positions through the flow field.

    Mirrors the inner loop of ``cellpose.dynamics.follow_flows`` /
    ``steps_interp``. The torch ``grid_sample(align_corners=False)`` step
    on normalised pixel coordinates is equivalent to a bilinear lookup at
    raw pixel coordinates, which :func:`scipy.ndimage.map_coordinates`
    with ``order=1`` implements exactly.
    """
    H, W = dP.shape[1:]
    p = np.stack(
        [inds[0].astype(np.float32), inds[1].astype(np.float32)],
        axis=0,
    )
    for _ in range(niter):
        dy = map_coordinates(dP[0], p, order=1, mode="nearest")
        dx = map_coordinates(dP[1], p, order=1, mode="nearest")
        p[0] = np.clip(p[0] + dy, 0, H - 1)
        p[1] = np.clip(p[1] + dx, 0, W - 1)
    return p


def _renumber(masks: np.ndarray) -> np.ndarray:
    """Compress label values to a dense ``0..k`` range, preserving 0=background."""
    uniq = np.unique(masks)
    if uniq.size == 0:
        return masks
    remap = np.zeros(int(uniq.max()) + 1, dtype=masks.dtype)
    remap[uniq] = np.arange(len(uniq), dtype=masks.dtype)
    return remap[masks]


def _get_masks(
    p: np.ndarray,
    inds,
    shape0,
    max_size_fraction: float = 0.4,
    rpad: int = 20,
) -> np.ndarray:
    """Histogram + seed-extension implementation of cellpose's get_masks.

    The torch path uses ``sparse_coo_tensor`` + ``max_pool_nd`` for both
    the per-pixel histogram and the seed-extension iteration. Both have
    direct numpy equivalents: :func:`np.add.at` and
    :func:`scipy.ndimage.maximum_filter`.
    """
    H0, W0 = shape0
    H, W = H0 + 2 * rpad, W0 + 2 * rpad

    pi = np.round(p).astype(np.int32) + rpad
    pi[0] = np.clip(pi[0], 0, H - 1)
    pi[1] = np.clip(pi[1], 0, W - 1)

    h = np.zeros((H, W), dtype=np.int32)
    np.add.at(h, (pi[0], pi[1]), 1)

    hmax = maximum_filter(h, size=5, mode="constant")
    seeds = np.column_stack(np.where((h - hmax > -1e-6) & (h > 10)))
    if len(seeds) == 0:
        return np.zeros(shape0, dtype=np.uint16)

    counts = h[seeds[:, 0], seeds[:, 1]]
    order = np.argsort(counts)
    seeds = seeds[order]
    n = len(seeds)

    label_dtype = np.int32 if n < (1 << 16) else np.int64
    M = np.zeros((H, W), dtype=label_dtype)
    for k, (sy, sx) in enumerate(seeds, start=1):
        if sy < 5 or sy + 6 > H or sx < 5 or sx + 6 > W:
            continue
        patch_h = h[sy - 5 : sy + 6, sx - 5 : sx + 6]
        seed_mask = np.zeros_like(patch_h, dtype=np.uint8)
        seed_mask[5, 5] = 1
        for _ in range(5):
            seed_mask = (
                maximum_filter(seed_mask, size=3) * (patch_h > 2)
            ).astype(np.uint8)
        ys, xs = np.where(seed_mask)
        M[sy - 5 + ys, sx - 5 + xs] = k

    labels = M[pi[0], pi[1]]
    M0 = np.zeros(shape0, dtype=np.uint32)
    M0[inds] = labels

    uniq, count = np.unique(M0, return_counts=True)
    too_big = uniq[count > shape0[0] * shape0[1] * max_size_fraction]
    too_big = too_big[too_big != 0]
    if len(too_big):
        M0[np.isin(M0, too_big)] = 0

    M0 = _renumber(M0)
    if M0.max() < (1 << 16):
        return M0.astype(np.uint16)
    return M0


def _fill_holes_remove_small(masks: np.ndarray, min_size: int = 15) -> np.ndarray:
    """Drop labels below ``min_size`` pixels, fill internal holes."""
    if min_size > 0:
        uniq, counts = np.unique(masks, return_counts=True)
        small = uniq[(counts < min_size) & (uniq != 0)]
        if len(small):
            masks[np.isin(masks, small)] = 0
        masks = _renumber(masks)

    slices = find_objects(masks)
    if not slices:
        return masks

    out = np.zeros_like(masks)
    j = 0
    for i, slc in enumerate(slices):
        if slc is None:
            continue
        msk = masks[slc] == (i + 1)
        msk = binary_fill_holes(msk)
        j += 1
        out_slc = out[slc]
        out_slc[msk] = j
        out[slc] = out_slc
    return out


def compute_masks_np(
    dP: np.ndarray,
    cellprob: np.ndarray,
    niter: int = 200,
    cellprob_threshold: float = 0.0,
    flow_threshold: float = 0.0,
    min_size: int = 15,
    max_size_fraction: float = 0.4,
) -> np.ndarray:
    """Reproduce ``cellpose.dynamics.compute_masks`` on the CPU in numpy.

    Parameters
    ----------
    dP : ndarray of shape ``(2, H, W)`` float32
        First channel is dy, second is dx. The network's raw flow output
        (after the server-side resize, if any).
    cellprob : ndarray of shape ``(H, W)`` float32
        Pre-sigmoid cell-probability logits.
    niter : int
        Number of flow-following Euler steps.
    cellprob_threshold : float
        Pixels with ``cellprob > cellprob_threshold`` enter the
        flow-following stage.
    flow_threshold : float
        Currently unused (the v1 client skips the QC step; see the module
        docstring). Accepted as a kwarg so the call signature mirrors
        ``cellpose.dynamics.compute_masks``.
    min_size : int
        Labels with fewer than this many pixels are dropped.
    max_size_fraction : float
        Labels that cover more than this fraction of the image are
        dropped (typical Cellpose default: 0.4).

    Returns
    -------
    masks : ndarray of shape ``(H, W)`` uint16 or uint32
        Instance label image. 0 = background.
    """
    _ = flow_threshold  # reserved for the QC port (see module docstring)

    if dP.ndim != 3 or dP.shape[0] != 2:
        raise ValueError(f"dP must have shape (2, H, W), got {dP.shape}")
    if cellprob.shape != dP.shape[1:]:
        raise ValueError(
            "cellprob shape mismatch: "
            f"cellprob={cellprob.shape} dP={dP.shape[1:]}"
        )

    above = cellprob > cellprob_threshold
    if not above.any():
        return np.zeros(cellprob.shape, dtype=np.uint16)

    inds = np.nonzero(above)
    dP_scaled = dP * above[None].astype(np.float32) / 5.0
    p = _follow_flows(dP_scaled, inds, niter)
    mask = _get_masks(p, inds, dP.shape[1:], max_size_fraction=max_size_fraction)
    if min_size > 0:
        mask = _fill_holes_remove_small(mask, min_size=min_size)
    return mask


__all__ = ["compute_masks_np"]
