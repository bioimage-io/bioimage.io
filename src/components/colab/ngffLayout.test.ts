/**
 * Tests for the pure NGFF layout logic (`ngffLayout.ts`).
 *
 * zarrita's own Zarr correctness is not retested here. What is tested is the
 * part that is ours and that fails silently rather than loudly: axis
 * resolution, level ordering, and pulling a 2-D plane out of a strided buffer.
 * Getting the stride arithmetic wrong does not throw, it draws a sheared or
 * transposed image, which is exactly the class of bug the design flagged for
 * the TIFF pyramid too.
 */

import {
  axisRoles,
  chunkToBands,
  dtypeItemsize,
  levelDims,
  materialiseBytes,
  parseMultiscales,
  planeSelection,
  regionAtLevel,
} from './ngffLayout';
import type { NgffAxis } from './ngffLayout';

const TCZYX: NgffAxis[] = [
  { name: 't', type: 'time' },
  { name: 'c', type: 'channel' },
  { name: 'z', type: 'space' },
  { name: 'y', type: 'space' },
  { name: 'x', type: 'space' },
];
const YX: NgffAxis[] = [
  { name: 'y', type: 'space' },
  { name: 'x', type: 'space' },
];

// --- parseMultiscales -----------------------------------------------------

describe('parseMultiscales', () => {
  it('reads dataset paths and axes from a v0.4 store', () => {
    const ms = parseMultiscales({
      multiscales: [
        {
          axes: [{ name: 'y', type: 'space' }, { name: 'x', type: 'space' }],
          datasets: [{ path: '0' }, { path: '1' }, { path: '2' }],
        },
      ],
    });
    expect(ms.datasetPaths).toEqual(['0', '1', '2']);
    expect(ms.axes.map((a) => a.name)).toEqual(['y', 'x']);
  });

  it('falls back to the implied tczyx order when axes is absent (v0.1-v0.3)', () => {
    const ms = parseMultiscales({ multiscales: [{ datasets: [{ path: '0' }] }] });
    expect(ms.axes.map((a) => a.name)).toEqual(['t', 'c', 'z', 'y', 'x']);
  });

  it('accepts axes given as bare strings', () => {
    const ms = parseMultiscales({
      multiscales: [{ axes: ['c', 'y', 'x'], datasets: [{ path: '0' }] }],
    });
    expect(ms.axes.map((a) => a.name)).toEqual(['c', 'y', 'x']);
  });

  it('accepts datasets given as bare strings', () => {
    const ms = parseMultiscales({ multiscales: [{ datasets: ['0', '1'] }] });
    expect(ms.datasetPaths).toEqual(['0', '1']);
  });

  it('selects a named multiscale when there is more than one image', () => {
    const doc = {
      multiscales: [
        { name: 'left', datasets: [{ path: 'a/0' }] },
        { name: 'right', datasets: [{ path: 'b/0' }] },
      ],
    };
    expect(parseMultiscales(doc, 'right').datasetPaths).toEqual(['b/0']);
    expect(parseMultiscales(doc, 'b/0').datasetPaths).toEqual(['b/0']);
    expect(parseMultiscales(doc).datasetPaths).toEqual(['a/0']);
  });

  it('rejects a store that is not OME-Zarr, rather than degrading', () => {
    // The import path (§7) has to say what is wrong. Returning an empty
    // pyramid would surface later as a blank viewer with no explanation.
    expect(() => parseMultiscales({})).toThrow(/multiscales/);
    expect(() => parseMultiscales(null)).toThrow(/multiscales/);
    expect(() => parseMultiscales({ multiscales: [] })).toThrow(/multiscales/);
  });

  it('rejects a multiscale with no usable dataset paths', () => {
    expect(() => parseMultiscales({ multiscales: [{ datasets: [] }] })).toThrow(/no datasets/);
    expect(() => parseMultiscales({ multiscales: [{ datasets: [{}, { path: '' }] }] })).toThrow(
      /no datasets/,
    );
  });

  it('names the multiscale it could not find', () => {
    expect(() => parseMultiscales({ multiscales: [{ datasets: ['0'] }] }, 'nope')).toThrow(/nope/);
  });
});

// --- axisRoles ------------------------------------------------------------

describe('axisRoles', () => {
  it('locates y, x and c in tczyx', () => {
    expect(axisRoles(TCZYX, 5)).toEqual({ y: 3, x: 4, c: 1, indexed: [0, 2] });
  });

  it('handles a plain 2-D store', () => {
    expect(axisRoles(YX, 2)).toEqual({ y: 0, x: 1, c: null, indexed: [] });
  });

  it('handles cyx with no t or z', () => {
    const axes = [{ name: 'c' }, { name: 'y' }, { name: 'x' }];
    expect(axisRoles(axes, 3)).toEqual({ y: 1, x: 2, c: 0, indexed: [] });
  });

  it('handles a channel axis that is not leading', () => {
    const axes = [{ name: 'y' }, { name: 'x' }, { name: 'c' }];
    expect(axisRoles(axes, 3)).toEqual({ y: 0, x: 1, c: 2, indexed: [] });
  });

  it('is case insensitive', () => {
    expect(axisRoles([{ name: 'Y' }, { name: 'X' }], 2)).toEqual({
      y: 0,
      x: 1,
      c: null,
      indexed: [],
    });
  });

  it('falls back to the last two dimensions when axes disagrees with the array', () => {
    // A metadata bug we can survive: Y and X are the two fastest-varying
    // dimensions in every NGFF layout, so trusting the array is safe.
    expect(axisRoles(YX, 4)).toEqual({ y: 2, x: 3, c: null, indexed: [0, 1] });
  });

  it('falls back when the axes list has no y or x at all', () => {
    expect(axisRoles([{ name: 'a' }, { name: 'b' }, { name: 'c' }], 3)).toEqual({
      y: 1,
      x: 2,
      c: null,
      indexed: [0],
    });
  });

  it('refuses an array with fewer than two dimensions', () => {
    expect(() => axisRoles([{ name: 'x' }], 1)).toThrow(/at least 2/);
  });

  it('treats every non-yxc dimension as one that must be pinned', () => {
    const axes = [{ name: 't' }, { name: 'z' }, { name: 'weird' }, { name: 'y' }, { name: 'x' }];
    expect(axisRoles(axes, 5).indexed).toEqual([0, 1, 2]);
  });
});

// --- levelDims ------------------------------------------------------------

describe('levelDims', () => {
  it('reads width from the x axis and height from the y axis', () => {
    // Deliberately non-square and t/c/z-prefixed: a naive shape[0]/shape[1]
    // would report 1x2 here.
    expect(levelDims([1, 2, 10, 480, 640], axisRoles(TCZYX, 5))).toEqual({
      width: 640,
      height: 480,
    });
  });
});

// --- planeSelection -------------------------------------------------------

describe('planeSelection', () => {
  it('passes y, x and c through whole and pins the rest', () => {
    expect(planeSelection([5, 3, 20, 480, 640], axisRoles(TCZYX, 5), TCZYX)).toEqual([
      0,
      null,
      10,
      null,
      null,
    ]);
  });

  it('pins z to the middle slice, not the first', () => {
    // The first slice of a stack is routinely empty; opening black reads as
    // a broken import.
    const sel = planeSelection([1, 1, 41, 8, 8], axisRoles(TCZYX, 5), TCZYX);
    expect(sel[2]).toBe(20);
  });

  it('pins time to the first frame', () => {
    const sel = planeSelection([7, 1, 1, 8, 8], axisRoles(TCZYX, 5), TCZYX);
    expect(sel[0]).toBe(0);
  });

  it('selects nothing at all for a 2-D store', () => {
    expect(planeSelection([8, 8], axisRoles(YX, 2), YX)).toEqual([null, null]);
  });

  it('never pins past the end of a singleton axis', () => {
    const shape = [1, 1, 1, 8, 8];
    const sel = planeSelection(shape, axisRoles(TCZYX, 5), TCZYX);
    sel.forEach((s, d) => {
      if (typeof s === 'number') expect(s).toBeLessThan(shape[d]);
    });
  });

  it('turns a region into y and x ranges and leaves the pins alone', () => {
    const sel = planeSelection([5, 3, 20, 480, 640], axisRoles(TCZYX, 5), TCZYX, {
      x: 100,
      y: 50,
      width: 64,
      height: 32,
    });
    expect(sel).toEqual([0, null, 10, [50, 82], [100, 164]]);
  });

  it('ranges a 2-D store on its only two axes', () => {
    expect(
      planeSelection([8, 8], axisRoles(YX, 2), YX, { x: 2, y: 1, width: 4, height: 3 }),
    ).toEqual([[1, 4], [2, 6]]);
  });

  it('keeps the channel axis whole inside a region', () => {
    // A patch is a spatial crop, never a channel crop: the OME-TIFF the patch
    // materialises into has to carry the same channels the full image would.
    const sel = planeSelection([5, 3, 20, 480, 640], axisRoles(TCZYX, 5), TCZYX, {
      x: 0,
      y: 0,
      width: 8,
      height: 8,
    });
    expect(sel[1]).toBeNull();
  });
});

// --- regionAtLevel --------------------------------------------------------

describe('regionAtLevel', () => {
  const base = { width: 1000, height: 800 };

  it('is the identity on level 0', () => {
    const region = { x: 120, y: 40, width: 256, height: 128 };
    expect(regionAtLevel(region, base, base)).toEqual(region);
  });

  it('halves the rectangle for a half-sized level', () => {
    expect(
      regionAtLevel({ x: 120, y: 40, width: 256, height: 128 }, base, { width: 500, height: 400 }),
    ).toEqual({ x: 60, y: 20, width: 128, height: 64 });
  });

  it('scales y and x independently when the store downsamples anisotropically', () => {
    // Real stores do this. Assuming 2**level per axis would crop the wrong
    // rectangle on one of them, and nothing would throw.
    expect(
      regionAtLevel({ x: 100, y: 100, width: 100, height: 100 }, base, { width: 500, height: 800 }),
    ).toEqual({ x: 50, y: 100, width: 50, height: 100 });
  });

  it('covers the rectangle rather than truncating it', () => {
    // 1/3 scale: the near edge floors to 33 and the far edge ceils to 67, so
    // the crop spans every source pixel the request touched. Rounding both
    // ends the same way would shed a partial pixel per level.
    const r = regionAtLevel({ x: 100, y: 100, width: 100, height: 100 }, base, {
      width: 333,
      height: 267,
    });
    expect(r.x).toBe(33);
    expect(r.x + r.width).toBe(67);
  });

  it('never returns an empty crop for a patch that vanishes at a coarse level', () => {
    // A 4 px patch on a level downsampled 256x rounds to nothing. Something
    // of the right neighbourhood has to render, and a zero-width read would
    // throw out of the display path rather than degrade.
    const r = regionAtLevel({ x: 512, y: 512, width: 4, height: 4 }, base, { width: 4, height: 3 });
    expect(r.width).toBeGreaterThanOrEqual(1);
    expect(r.height).toBeGreaterThanOrEqual(1);
  });

  it('stays inside the level even when the region runs to the far edge', () => {
    const r = regionAtLevel({ x: 900, y: 700, width: 100, height: 100 }, base, {
      width: 125,
      height: 100,
    });
    expect(r.x + r.width).toBeLessThanOrEqual(125);
    expect(r.y + r.height).toBeLessThanOrEqual(100);
  });
});

// --- chunkToBands ---------------------------------------------------------

describe('chunkToBands', () => {
  it('returns one band for a 2-D plane', () => {
    const data = new Uint8Array([1, 2, 3, 4, 5, 6]);
    const bands = chunkToBands(data, [2, 3], [3, 1], null);
    expect(bands).toHaveLength(1);
    expect(Array.from(bands[0] as Uint8Array)).toEqual([1, 2, 3, 4, 5, 6]);
  });

  it('preserves the source typed-array kind', () => {
    // Load-bearing: rastersToRgba passes Uint8Array through unscaled and
    // min/max stretches everything else. Widening here would make an 8-bit
    // Zarr render differently from the identical image as PNG or TIFF.
    const u8 = chunkToBands(new Uint8Array([0, 10, 20, 30]), [2, 2], [2, 1], null)[0];
    expect(u8).toBeInstanceOf(Uint8Array);
    const u16 = chunkToBands(new Uint16Array([0, 900, 20, 30]), [2, 2], [2, 1], null)[0];
    expect(u16).toBeInstanceOf(Uint16Array);
  });

  it('splits a channel-first plane into per-channel bands', () => {
    // shape [C=2, Y=2, X=3], C-contiguous
    const data = new Uint8Array([1, 2, 3, 4, 5, 6, /* ch1 */ 11, 12, 13, 14, 15, 16]);
    const bands = chunkToBands(data, [2, 2, 3], [6, 3, 1], 0);
    expect(bands).toHaveLength(2);
    expect(Array.from(bands[0] as Uint8Array)).toEqual([1, 2, 3, 4, 5, 6]);
    expect(Array.from(bands[1] as Uint8Array)).toEqual([11, 12, 13, 14, 15, 16]);
  });

  it('splits a channel-last (interleaved) plane correctly', () => {
    // shape [Y=2, X=2, C=3], interleaved RGB. The stride walk is the only
    // thing that makes this come out unsheared.
    const data = new Uint8Array([
      1, 2, 3, 4, 5, 6, // row 0: px(1,2,3) px(4,5,6)
      7, 8, 9, 10, 11, 12, // row 1
    ]);
    const bands = chunkToBands(data, [2, 2, 3], [6, 3, 1], 2);
    expect(Array.from(bands[0] as Uint8Array)).toEqual([1, 4, 7, 10]);
    expect(Array.from(bands[1] as Uint8Array)).toEqual([2, 5, 8, 11]);
    expect(Array.from(bands[2] as Uint8Array)).toEqual([3, 6, 9, 12]);
  });

  it('reads through a non-contiguous stride rather than assuming C order', () => {
    // A transposed view: shape [Y=2, X=3] but stored column-major.
    const data = new Uint8Array([1, 4, 2, 5, 3, 6]);
    const bands = chunkToBands(data, [2, 3], [1, 2], null);
    expect(Array.from(bands[0] as Uint8Array)).toEqual([1, 2, 3, 4, 5, 6]);
  });

  it('stops at three channels', () => {
    // rastersToRgba reads three; a 40-channel store must not copy 37 planes
    // it will throw away.
    const data = new Uint8Array(40 * 4);
    const bands = chunkToBands(data, [40, 2, 2], [4, 2, 1], 0);
    expect(bands).toHaveLength(3);
  });

  it('returns fewer than three bands when the store has fewer', () => {
    const data = new Uint8Array(2 * 4);
    expect(chunkToBands(data, [2, 2, 2], [4, 2, 1], 0)).toHaveLength(2);
  });

  it('rejects a plane it cannot interpret instead of drawing garbage', () => {
    expect(() => chunkToBands(new Uint8Array(8), [2, 2, 2], [4, 2, 1], null)).toThrow(
      /Unsupported/,
    );
    expect(() => chunkToBands(new Uint8Array(16), [2, 2, 2, 2], [8, 4, 2, 1], 0)).toThrow(
      /Unsupported/,
    );
  });
});

// --- level ordering, via the shared helper --------------------------------

describe('level ordering', () => {
  it('orders NGFF datasets finest-first regardless of stored order', () => {
    // `datasets[]` is documented as coarsest-last but nothing validates it,
    // so a coarsest-first store must still read correctly. Same guarantee the
    // TIFF path gets from re-deriving order out of the SubIFDs.
    const { orderPyramidLevels } = require('./omeTiffPyramid');
    const shuffled = [
      { path: '2', width: 160, height: 120 },
      { path: '0', width: 640, height: 480 },
      { path: '1', width: 320, height: 240 },
    ];
    expect(orderPyramidLevels(shuffled).map((l: any) => l.path)).toEqual(['0', '1', '2']);
  });
});

// --- the size estimate behind the picker's guard ---------------------------

describe('dtypeItemsize', () => {
  it('reads the v2 spelling a Zarr v2 store uses', () => {
    expect(dtypeItemsize('<u2')).toBe(2);
    expect(dtypeItemsize('|u1')).toBe(1);
    expect(dtypeItemsize('>f4')).toBe(4);
    expect(dtypeItemsize('<i8')).toBe(8);
  });

  it('reads the named spelling a Zarr v3 store uses', () => {
    expect(dtypeItemsize('uint16')).toBe(2);
    expect(dtypeItemsize('int8')).toBe(1);
    expect(dtypeItemsize('float64')).toBe(8);
    expect(dtypeItemsize('bool')).toBe(1);
  });

  it('says 0 rather than guessing at something it does not know', () => {
    // The broker reports 0 as "no opinion" and lets the attempt proceed, so
    // an invented itemsize here would be shown as a confident wrong number.
    expect(dtypeItemsize('complex64')).toBe(0);
    expect(dtypeItemsize('')).toBe(0);
    expect(dtypeItemsize(null)).toBe(0);
    expect(dtypeItemsize(undefined)).toBe(0);
  });
});

describe('materialiseBytes', () => {
  it('counts every channel', () => {
    expect(materialiseBytes(100, 50, 'uint16', ['a', 'b'])).toBe(100 * 50 * 2 * 2);
  });

  it('counts one channel when the store names none', () => {
    // Matches the broker's lower bound; a store with no omero metadata is
    // far more often single-channel than not.
    expect(materialiseBytes(10, 10, 'uint8', [])).toBe(100);
    expect(materialiseBytes(10, 10, 'uint8', null)).toBe(100);
  });

  it('agrees with the broker on the 64 MiB gate at the boundary', () => {
    const MAX = 64 * 1024 * 1024;
    expect(materialiseBytes(8192, 8192, 'uint8', ['c'])).toBe(MAX);
    expect(materialiseBytes(8193, 8192, 'uint8', ['c'])).toBeGreaterThan(MAX);
    expect(materialiseBytes(4096, 4096, 'uint16', ['r', 'g'])).toBe(MAX);
  });

  it('reports 0 for an unknown dtype or an empty rectangle', () => {
    expect(materialiseBytes(10, 10, 'complex64', ['c'])).toBe(0);
    expect(materialiseBytes(0, 10, 'uint8', ['c'])).toBe(0);
    expect(materialiseBytes(10, -1, 'uint8', ['c'])).toBe(0);
  });
});
