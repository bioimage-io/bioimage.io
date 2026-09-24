"""Tests for the OME-TIFF writer in ``colab_service.py``.

Scope is deliberately the pure image functions. The service methods need a
live Hypha connection and a Pyodide ``_pyfetch``, so they are not covered
here; ``encode_ome_tiff`` is, because it is the part that can silently
produce a file every downstream reader misinterprets.

Run: ``python3 -m pytest public/test_colab_service.py -q``
"""

import importlib.util
import io
from pathlib import Path

import numpy as np
import pytest
import tifffile

# colab_service.py is served to the browser kernel, not packaged, so there is
# no importable module path for it. Load it by location.
_SPEC = importlib.util.spec_from_file_location(
    "colab_service", Path(__file__).with_name("colab_service.py")
)
cs = importlib.util.module_from_spec(_SPEC)
_SPEC.loader.exec_module(cs)


# ---------------------------------------------------------------------------
# normalise_axes
# ---------------------------------------------------------------------------


def test_normalise_axes_moves_leading_channel_axis_last():
    arr = np.zeros((3, 40, 50), dtype=np.uint8)
    assert cs.normalise_axes(arr).shape == (40, 50, 3)


def test_normalise_axes_squeezes_a_trailing_singleton():
    assert cs.normalise_axes(np.zeros((40, 50, 1), dtype=np.uint16)).shape == (40, 50)


def test_normalise_axes_leaves_yxc_alone():
    arr = np.zeros((40, 50, 3), dtype=np.uint8)
    assert cs.normalise_axes(arr).shape == (40, 50, 3)


def test_normalise_axes_leaves_2d_alone():
    assert cs.normalise_axes(np.zeros((40, 50), dtype=np.uint8)).shape == (40, 50)


def test_normalise_axes_does_not_transpose_a_genuinely_small_image():
    # A 3x4 RGB image is pathological but real: shape[0] == 3 must not be read
    # as a channel axis when the other axes are just as small.
    arr = np.zeros((3, 4, 3), dtype=np.uint8)
    assert cs.normalise_axes(arr).shape == (3, 4, 3)


def test_normalise_axes_preserves_values_and_dtype():
    arr = np.arange(2 * 4 * 5, dtype=np.uint16).reshape(2, 4, 5)
    out = cs.normalise_axes(arr)
    assert out.dtype == np.uint16
    assert sorted(out.ravel().tolist()) == sorted(arr.ravel().tolist())


# ---------------------------------------------------------------------------
# build_pyramid
# ---------------------------------------------------------------------------


def test_build_pyramid_halves_until_under_the_floor():
    levels = cs.build_pyramid(np.zeros((2048, 2048), dtype=np.uint8), min_long_axis=512)
    assert [l.shape for l in levels] == [(2048, 2048), (1024, 1024), (512, 512)]


def test_build_pyramid_is_single_level_when_already_small():
    levels = cs.build_pyramid(np.zeros((300, 400), dtype=np.uint8), min_long_axis=512)
    assert len(levels) == 1


def test_build_pyramid_uses_the_long_axis_not_the_area():
    levels = cs.build_pyramid(np.zeros((100, 4000), dtype=np.uint8), min_long_axis=512)
    assert [l.shape for l in levels] == [(100, 4000), (50, 2000), (25, 1000), (12, 500)]


def test_build_pyramid_preserves_dtype_at_every_level():
    for dtype in (np.uint8, np.uint16, np.float32):
        levels = cs.build_pyramid(np.ones((1200, 1200), dtype=dtype), min_long_axis=512)
        assert all(l.dtype == dtype for l in levels)


def test_build_pyramid_does_not_wrap_around_on_uint8():
    # A naive integer mean would overflow; 255 must average to 255, not 0.
    levels = cs.build_pyramid(np.full((1024, 1024), 255, dtype=np.uint8), min_long_axis=512)
    assert levels[-1].min() == 255


def test_build_pyramid_keeps_channels():
    levels = cs.build_pyramid(np.zeros((1024, 1024, 2), dtype=np.uint16), min_long_axis=512)
    assert levels[-1].shape == (512, 512, 2)


def test_build_pyramid_drops_the_odd_edge_rather_than_padding():
    levels = cs.build_pyramid(np.zeros((1025, 1025), dtype=np.uint8), min_long_axis=512)
    assert levels[1].shape == (512, 512)


def test_build_pyramid_downsamples_by_averaging():
    arr = np.array([[0, 100], [100, 200]], dtype=np.uint8)
    tiled = np.tile(arr, (600, 600))  # 1200x1200
    levels = cs.build_pyramid(tiled, min_long_axis=512)
    assert levels[1][0, 0] == 100  # (0+100+100+200)/4


# ---------------------------------------------------------------------------
# encode_ome_tiff -- structure
# ---------------------------------------------------------------------------


def _pages(blob):
    with tifffile.TiffFile(io.BytesIO(blob)) as tf:
        page = tf.pages[0]
        subifds = page.tags["SubIFDs"].value if "SubIFDs" in page.tags else ()
        return {
            "n_pages": len(tf.pages),
            "n_subifds": len(subifds),
            "tiled": page.is_tiled,
            "tile": (page.tilewidth, page.tilelength),
            "compression": int(page.compression),
            "levels": [l.shape for l in tf.series[0].levels],
            "is_ome": tf.is_ome,
        }


def test_encode_writes_levels_as_subifds_of_one_page():
    info = _pages(cs.encode_ome_tiff(np.zeros((2048, 2048), dtype=np.uint8)))
    # One top-level page keeps `imread` returning full resolution; the extra
    # levels hang off it.
    assert info["n_pages"] == 1
    assert info["n_subifds"] == 2
    assert info["levels"] == [(2048, 2048), (1024, 1024), (512, 512)]


def test_encode_writes_512_tiles():
    info = _pages(cs.encode_ome_tiff(np.zeros((1024, 1024), dtype=np.uint8)))
    assert info["tiled"] is True
    assert info["tile"] == (512, 512)


def test_encode_uses_deflate_never_lzw():
    info = _pages(cs.encode_ome_tiff(np.zeros((600, 600), dtype=np.uint8)))
    assert info["compression"] == 32946  # DEFLATE; LZW would be 5
    assert info["compression"] != 5


def test_encode_emits_ome_metadata():
    assert _pages(cs.encode_ome_tiff(np.zeros((600, 600), dtype=np.uint8)))["is_ome"]


def test_encode_has_no_subifds_when_the_image_is_already_small():
    assert _pages(cs.encode_ome_tiff(np.zeros((300, 400), dtype=np.uint8)))["n_subifds"] == 0


def test_encode_levels_matches_encoding_the_array():
    # `encode_ome_tiff` is now a wrapper over `encode_ome_tiff_levels`, so the
    # browser can build the pyramid once, read its length, and hand the same
    # list back to be encoded. The two entry points have to stay equivalent.
    # Compared through the reader rather than byte-for-byte: tifffile stamps a
    # fresh UUID into the OME-XML on every write.
    arr = np.random.default_rng(7).integers(0, 65535, size=(1200, 900), dtype=np.uint16)
    from_array = cs.encode_ome_tiff(arr)
    from_levels = cs.encode_ome_tiff_levels(cs.build_pyramid(arr))
    assert _pages(from_array)["levels"] == _pages(from_levels)["levels"]
    assert np.array_equal(
        tifffile.imread(io.BytesIO(from_array)),
        tifffile.imread(io.BytesIO(from_levels)),
    )


def test_encode_levels_writes_exactly_the_levels_it_is_given():
    # Truncated on purpose: the caller owns the pyramid, so passing two levels
    # of a three-level pyramid must write two, not silently rebuild.
    levels = cs.build_pyramid(np.zeros((2048, 2048), dtype=np.uint8))[:2]
    info = _pages(cs.encode_ome_tiff_levels(levels))
    assert info["n_subifds"] == 1
    assert info["levels"] == [(2048, 2048), (1024, 1024)]


def test_encode_levels_rejects_an_empty_pyramid():
    with pytest.raises(ValueError, match="empty pyramid"):
        cs.encode_ome_tiff_levels([])


# ---------------------------------------------------------------------------
# encode_ome_tiff -- round trip through every reader we depend on
# ---------------------------------------------------------------------------

CASES = [
    ("uint8 rgb", np.random.default_rng(1).integers(0, 256, (700, 900, 3), dtype=np.uint8)),
    ("uint8 gray", np.random.default_rng(2).integers(0, 256, (700, 900), dtype=np.uint8)),
    ("uint16 gray", np.random.default_rng(3).integers(0, 65536, (1100, 1100), dtype=np.uint16)),
    ("uint16 rgb", np.random.default_rng(4).integers(0, 65536, (700, 900, 3), dtype=np.uint16)),
    ("uint16 two channel", np.random.default_rng(5).integers(0, 65536, (700, 900, 2), dtype=np.uint16)),
    ("uint8 rgba", np.random.default_rng(6).integers(0, 256, (700, 900, 4), dtype=np.uint8)),
    ("float32 gray", np.random.default_rng(7).random((600, 800), dtype=np.float32)),
    ("small, no pyramid", np.random.default_rng(8).integers(0, 256, (64, 64), dtype=np.uint8)),
]


@pytest.mark.parametrize("name,arr", CASES, ids=[c[0] for c in CASES])
def test_tifffile_reads_back_the_full_image_bit_exact(name, arr):
    back = tifffile.imread(io.BytesIO(cs.encode_ome_tiff(arr)))
    assert back.shape == arr.shape
    assert back.dtype == arr.dtype
    assert np.array_equal(back, arr)


@pytest.mark.parametrize("name,arr", CASES, ids=[c[0] for c in CASES])
def test_imageio_reads_back_bit_exact_when_given_the_extension(name, arr):
    """``imageio.v3`` is what ``model-finetune`` calls (entry.py:312).

    The extension hint is load-bearing: without it imageio sniffs and picks
    Pillow, which silently downconverts 16-bit RGB to 8-bit. See the
    companion test below, which pins that behaviour so a future imageio
    cannot change it without us noticing.
    """
    iio = pytest.importorskip("imageio.v3")
    back = iio.imread(io.BytesIO(cs.encode_ome_tiff(arr)), extension=".tif")
    assert back.shape == arr.shape
    assert back.dtype == arr.dtype
    assert np.array_equal(back, arr)


def test_imageio_without_an_extension_hint_downgrades_uint16_rgb():
    """Pins the defect that makes ``model-finetune`` lossy for uint16 RGB.

    This asserts BROKEN behaviour on purpose. `_load_image_from_source`
    computes `ext` and then calls `iio.imread(buffer)` without passing it, so
    imageio falls through to Pillow, which cannot hold 16-bit RGB. The file
    itself is correct: the test above proves the same bytes read back exact
    with the hint. If this test starts failing, imageio's dispatch changed
    (or someone fixed the caller) and the note in the design's §9 should be
    revisited.
    """
    iio = pytest.importorskip("imageio.v3")
    arr = np.random.default_rng(9).integers(0, 65536, (600, 800, 3), dtype=np.uint16)
    back = iio.imread(io.BytesIO(cs.encode_ome_tiff(arr)))
    assert back.dtype == np.uint8  # <- the loss
    assert not np.array_equal(back, arr)


def test_coarsest_level_is_readable_and_the_right_size():
    arr = np.random.default_rng(10).integers(0, 256, (2048, 2048), dtype=np.uint8)
    with tifffile.TiffFile(io.BytesIO(cs.encode_ome_tiff(arr))) as tf:
        coarsest = tf.series[0].levels[-1].asarray()
    assert coarsest.shape == (512, 512)
    assert coarsest.dtype == np.uint8


def test_levels_are_consistent_with_the_source_not_noise():
    # A left-dark/right-bright split must survive to the coarsest level.
    arr = np.zeros((1024, 1024), dtype=np.uint8)
    arr[:, 512:] = 200
    with tifffile.TiffFile(io.BytesIO(cs.encode_ome_tiff(arr))) as tf:
        coarse = tf.series[0].levels[-1].asarray()
    assert coarse[:, :200].max() == 0
    assert coarse[:, 300:].min() == 200


# ---------------------------------------------------------------------------
# photometric selection
# ---------------------------------------------------------------------------


@pytest.mark.parametrize(
    "shape,expected",
    [
        ((10, 10), "minisblack"),
        ((10, 10, 2), "minisblack"),
        ((10, 10, 3), "rgb"),
        ((10, 10, 4), "rgb"),
    ],
)
def test_photometric_selection(shape, expected):
    assert cs._photometric_for(np.zeros(shape, dtype=np.uint8)) == expected


# ---------------------------------------------------------------------------
# read_image_native
# ---------------------------------------------------------------------------


def test_read_image_native_preserves_uint16_from_tiff(tmp_path):
    arr = np.random.default_rng(11).integers(0, 65536, (64, 80), dtype=np.uint16)
    path = tmp_path / "src.tif"
    tifffile.imwrite(path, arr)
    out = cs.read_image_native(path)
    assert out.dtype == np.uint16
    assert np.array_equal(out, arr)


def test_read_image_native_rejects_an_unsupported_extension(tmp_path):
    path = tmp_path / "src.bmp"
    path.write_bytes(b"")
    with pytest.raises(ValueError, match="Unsupported extension"):
        cs.read_image_native(path)


def test_read_image_native_expands_a_palette_png(tmp_path):
    """A palette PNG must come back as colour, not as palette indices."""
    from PIL import Image

    path = tmp_path / "pal.png"
    Image.new("P", (32, 32)).save(path)
    out = cs.read_image_native(path)
    assert out.ndim == 3 and out.shape[2] in (3, 4)


def test_full_pipeline_preserves_a_16_bit_tiff_end_to_end(tmp_path):
    """The regression this whole step exists to prevent.

    The old path was read -> min/max stretch to uint8 -> force RGB -> PNG.
    A 16-bit single-channel source came back as 8-bit RGB.
    """
    arr = np.random.default_rng(12).integers(0, 65536, (800, 600), dtype=np.uint16)
    src = tmp_path / "cells.tif"
    tifffile.imwrite(src, arr)

    blob = cs.encode_ome_tiff(cs.read_image_native(src))
    back = tifffile.imread(io.BytesIO(blob))

    assert back.dtype == np.uint16
    assert back.shape == (800, 600)
    assert np.array_equal(back, arr)
