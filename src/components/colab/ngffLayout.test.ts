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
  assertNoChannelTruncation,
  assertPlaneIsResolvable,
  axisRoles,
  chunkToBands,
  describeDtype,
  displayedPlanes,
  displayedPlanesForProbe,
  dtypeItemsize,
  levelDims,
  materialiseBytes,
  parseMultiscales,
  planeAtLevel,
  planeSelection,
  regionAtLevel,
  resampledIndexedAxes,
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

// --- displayedPlanes ------------------------------------------------------

/**
 * The defect these exist for, measured on a real store: a 5-axis tczyx source
 * of shape [1, 3, 9, 1000, 2000] was displayed at z index 4 and trained at z
 * index 0. Nothing noticed, because the mask rasterises non-empty, the shapes
 * agree and the run reaches COMPLETED. So the assertion that matters is not
 * "a plane is recorded" but "the recorded index is the DISPLAYED one", which
 * is why each case names the number rather than only its presence.
 */
describe('displayedPlanes', () => {
  it('records the MIDDLE z slice, which is what the viewer shows', () => {
    // The exact store from the measurement. Recording 0 here is the bug.
    const planes = displayedPlanes([1, 3, 9, 1000, 2000], axisRoles(TCZYX, 5), TCZYX);
    expect(planes).toEqual({ z: 4 });
    expect(planeSelection([1, 3, 9, 1000, 2000], axisRoles(TCZYX, 5), TCZYX)[2]).toBe(4);
  });

  it('records every non-singleton non-spatial axis, so a time series is complete', () => {
    // The broker refuses a PARTIAL mapping: once any plane is named, every
    // axis that is neither spatial nor channel and larger than one must be.
    expect(displayedPlanes([7, 3, 9, 64, 64], axisRoles(TCZYX, 5), TCZYX)).toEqual({ t: 0, z: 4 });
  });

  it('omits a singleton axis, so a flat 2-D store records no plane at all', () => {
    expect(displayedPlanes([8, 8], axisRoles(YX, 2), YX)).toBeUndefined();
    expect(displayedPlanes([1, 1, 1, 8, 8], axisRoles(TCZYX, 5), TCZYX)).toBeUndefined();
  });

  it('never names the channel axis, which the broker refuses and training reads whole', () => {
    const planes = displayedPlanes([1, 32, 1, 64, 64], axisRoles(TCZYX, 5), TCZYX);
    // 32 channels, and still nothing to record: a plane on c would be written
    // and then ignored, so the record would say one thing and training do
    // another.
    expect(planes).toBeUndefined();
  });

  it('never names y or x, which are the crop', () => {
    const planes = displayedPlanes([2, 1, 1, 64, 64], axisRoles(TCZYX, 5), TCZYX);
    expect(Object.keys(planes || {})).toEqual(['t']);
  });

  it('refuses a layout whose non-singleton axis has no name', () => {
    const unnamed: NgffAxis[] = [{ name: '' }, ...YX];
    // Rank 3 with only two usable names: axisRoles falls back to "the last two
    // are y and x", leaving dimension 0 indexed and nameless.
    expect(() => displayedPlanes([9, 64, 64], axisRoles(unnamed, 3), unnamed)).toThrow(
      /has 9 slices but no name/,
    );
  });

  it('refuses a layout naming two non-singleton axes the same', () => {
    const twins: NgffAxis[] = [{ name: 'z' }, { name: 'z' }, ...YX];
    expect(() => displayedPlanes([3, 5, 64, 64], axisRoles(twins, 4), twins)).toThrow(
      /more than one axis z/,
    );
  });
});

// --- the record and the drawn level must describe the same slice ----------

/**
 * Does level-k index `at` cover reference index `ref`?
 *
 * Level k's index `at` spans reference indices
 * [at * refSize / size, (at + 1) * refSize / size). This is the only honest
 * way to state the claim: on a downsampled axis one level-k slice stands for
 * several reference slices, so "equal" is the wrong question and "contains" is
 * the right one.
 */
const covers = (at: number, size: number, ref: number, refSize: number) =>
  ref >= (at * refSize) / size && ref < ((at + 1) * refSize) / size;

describe('a pyramid that downsamples z', () => {
  // Legal NGFF: tools that build 3-D pyramids for isotropic volumes resample
  // z along with y and x.
  const S0 = [1, 1, 9, 4096, 4096];
  const S1 = [1, 1, 4, 2048, 2048];
  const recorded = { planes: { z: 4 }, shape: S0 };

  it('reads the level-0 record at the level the canvas actually draws', () => {
    // THE DEFECT THIS EXISTS FOR. The record is made once against level 0 and
    // says z=4. The viewer draws at s1, which has only four z slices. Pinning
    // s1's own middle gives 2, and index 2 of s1 covers reference slices
    // 4.5 to 6.75, which does NOT include 4: the annotation would be drawn on
    // one slice and the record would name another.
    const naive = planeSelection(S1, axisRoles(TCZYX, 5), TCZYX)[2] as number;
    expect(naive).toBe(2);
    expect(covers(naive, S1[2], 4, S0[2])).toBe(false);

    // Derived from the record instead, s1 index 1 covers reference slices
    // 2.25 to 4.5, which does include 4.
    const derived = planeSelection(S1, axisRoles(TCZYX, 5), TCZYX, null, recorded)[2] as number;
    expect(derived).toBe(1);
    expect(covers(derived, S1[2], 4, S0[2])).toBe(true);
  });

  it('is the identity on the level the record was measured against', () => {
    expect(planeSelection(S0, axisRoles(TCZYX, 5), TCZYX, null, recorded)[2]).toBe(4);
  });

  it('agrees with the record at EVERY level of the pyramid', () => {
    for (const shape of [S0, S1, [1, 1, 2, 1024, 1024]]) {
      const at = planeSelection(shape, axisRoles(TCZYX, 5), TCZYX, null, recorded)[2] as number;
      expect(covers(at, shape[2], 4, S0[2])).toBe(true);
    }
  });

  it('leaves an axis the pyramid does NOT resample exactly where it was', () => {
    // The common case, and the one that must not change: a store pyramided
    // only in y and x keeps its z index at every level.
    const flat0 = [1, 1, 9, 4096, 4096];
    const flat1 = [1, 1, 9, 2048, 2048];
    const sel = planeSelection(flat1, axisRoles(TCZYX, 5), TCZYX, { planes: { z: 7 }, shape: flat0 });
    // Guard against the argument order silently shifting: `recorded` is the
    // FIFTH parameter and `region` the fourth, so passing it in the wrong slot
    // would be a no-op that this assertion catches.
    expect(sel[2]).toBe(4);
    const proper = planeSelection(flat1, axisRoles(TCZYX, 5), TCZYX, null, {
      planes: { z: 7 },
      shape: flat0,
    });
    expect(proper[2]).toBe(7);
  });

  it('scales UP when the record was measured on a coarser reference', () => {
    // A store listing its datasets coarsest-first: the broker's level0_shape
    // is then the COARSE one, and training reads that as level 0 too, so the
    // mapping has to work in this direction as well.
    //
    // The claim is the OTHER WAY ROUND here, and that asymmetry is the point.
    // Going coarser, one shown slice contains several recorded ones, so the
    // shown slice must CONTAIN the record. Going finer, the recorded slice
    // contains several shown ones, so the shown slice must sit INSIDE the
    // record. A single rounding rule satisfies one and breaks the other: the
    // floor would pick fine index 2, which sits at coarse position 0.89 and so
    // shows a slice the record does not name.
    const coarse = [1, 1, 4, 512, 512];
    const fine = [1, 1, 9, 2048, 2048];
    const at = planeSelection(fine, axisRoles(TCZYX, 5), TCZYX, null, {
      planes: { z: 1 },
      shape: coarse,
    })[2] as number;
    expect(at).toBe(3);
    // Inside the recorded coarse slice: its position in coarse coordinates
    // falls within [1, 2).
    expect(covers(1, coarse[2], at, fine[2])).toBe(true);
    // And the floor, which the first attempt used, does not satisfy that.
    expect(covers(1, coarse[2], 2, fine[2])).toBe(false);
  });

  it('falls back to the middle rule when the record says nothing', () => {
    expect(planeSelection(S1, axisRoles(TCZYX, 5), TCZYX, null, null)[2]).toBe(2);
    expect(
      planeSelection(S1, axisRoles(TCZYX, 5), TCZYX, null, { planes: {}, shape: S0 })[2],
    ).toBe(2);
    // A record naming a different axis must not move z.
    expect(
      planeSelection(S1, axisRoles(TCZYX, 5), TCZYX, null, { planes: { t: 0 }, shape: S0 })[2],
    ).toBe(2);
  });

  it('never leaves the axis, whatever the record says', () => {
    for (const index of [0, 8, 1000, -5]) {
      const at = planeSelection(S1, axisRoles(TCZYX, 5), TCZYX, null, {
        planes: { z: index },
        shape: S0,
      })[2] as number;
      expect(at).toBeGreaterThanOrEqual(0);
      expect(at).toBeLessThan(S1[2]);
    }
  });
});

describe('planeAtLevel refuses what it cannot map', () => {
  // These call the mapping DIRECTLY, and they exist because the guards around
  // it hid the root cause: a mutation restoring the old
  // `Number(shape[dim]) || 1` default broke no test at all, since every case
  // reached the record through usableRecord or the rank check first. A guard
  // in front of a defect is not a test of the defect.
  const at = (shape: any, levelSize: number) =>
    planeAtLevel({ planes: { z: 4 }, shape }, 'z', 2, levelSize);

  it('gives NO ANSWER when the reference shape has nothing at that axis', () => {
    // The measured failure: with an empty shape the default treated z as
    // having one slice and returned index 8 for a 9-slice level, and index 3
    // for a 4-slice one. Both are a recorded slice 4 drawn as another slice.
    expect(at([], 9)).toBeNull();
    expect(at([], 4)).toBeNull();
    expect(at(undefined, 9)).toBeNull();
  });

  it('gives no answer for a reference size that is not a positive whole number', () => {
    expect(at([1, 1, 0, 64, 64], 4)).toBeNull();
    expect(at([1, 1, -9, 64, 64], 4)).toBeNull();
    expect(at([1, 1, 9.5, 64, 64], 4)).toBeNull();
    expect(at([1, 1, '9', 64, 64], 4)).toBeNull();
    expect(at([1, 1, null, 64, 64], 4)).toBeNull();
  });

  it('still answers for a reference it CAN use', () => {
    // The control: the same call shape with a usable reference returns a
    // number, so the nulls above are about the reference and not about the
    // function refusing everything.
    expect(at([1, 1, 9, 64, 64], 4)).toBe(1);
    expect(at([1, 1, 9, 64, 64], 9)).toBe(4);
  });
});

describe('refusing a pyramid whose plane nobody recorded', () => {
  const Z_PYRAMID = [
    [1, 1, 9, 4096, 4096],
    [1, 1, 4, 2048, 2048],
  ];
  const FLAT_PYRAMID = [
    [1, 1, 9, 4096, 4096],
    [1, 1, 9, 2048, 2048],
  ];
  const roles = axisRoles(TCZYX, 5);

  it('names the axis that is sampled differently at each resolution', () => {
    expect(resampledIndexedAxes(Z_PYRAMID, roles, TCZYX)).toEqual(['z']);
    // The ordinary case: pyramided in y and x alone, so no indexed axis moves.
    expect(resampledIndexedAxes(FLAT_PYRAMID, roles, TCZYX)).toEqual([]);
  });

  it('REFUSES a z-downsampled store opened with no record', () => {
    // This is the last disguise of the row's own defect. Without a record each
    // level pins its own middle slice, so the annotation is drawn on one slice
    // while the record names another, the run completes, and nothing reports
    // it. The refusal names the axis and what to do.
    expect(() => assertPlaneIsResolvable(Z_PYRAMID, roles, TCZYX, null)).toThrow(/z axis/);
    expect(() => assertPlaneIsResolvable(Z_PYRAMID, roles, TCZYX, null)).toThrow(
      /no usable slice was recorded/,
    );
    expect(() => assertPlaneIsResolvable(Z_PYRAMID, roles, TCZYX, null)).toThrow(/v0\.12\.6/);
  });

  it('allows it once a record IS supplied, because the plane is then derived', () => {
    expect(() =>
      assertPlaneIsResolvable(Z_PYRAMID, roles, TCZYX, { planes: { z: 4 }, shape: Z_PYRAMID[0] }),
    ).not.toThrow();
  });

  it('leaves every ordinary store alone, with or without a record', () => {
    // The check must not become a tax on the common case: a store pyramided in
    // y and x only, and a single-level store, both open exactly as before.
    expect(() => assertPlaneIsResolvable(FLAT_PYRAMID, roles, TCZYX, null)).not.toThrow();
    expect(() => assertPlaneIsResolvable([[1, 1, 9, 64, 64]], roles, TCZYX, null)).not.toThrow();
    expect(() => assertPlaneIsResolvable([[64, 64]], axisRoles(YX, 2), YX, null)).not.toThrow();
  });

  it('ignores a record of the WRONG RANK on a pyramid that resamples nothing', () => {
    // F7.1, and the reason the earlier rank check was not enough: a flat
    // pyramid takes the early return in assertPlaneIsResolvable, so nothing
    // examined the record before it was used. Measured: with a record of
    // {z: 4} and shape [9, 64, 64] read at the z dimension, the selection came
    // back as slice 0 of a 9-slice store whose recorded slice is 4, silently.
    const FLAT = [
      [1, 1, 9, 64, 64],
      [1, 1, 9, 32, 32],
    ];
    const malformed = { planes: { z: 4 }, shape: [9, 64, 64] };
    // Not refused, because nothing here is ambiguous: with the record ignored,
    // every level agrees on its own middle slice.
    expect(() => assertPlaneIsResolvable(FLAT, roles, TCZYX, malformed)).not.toThrow();
    for (const shape of FLAT) {
      const at = planeSelection(shape, axisRoles(TCZYX, 5), TCZYX, null, malformed)[2];
      // 4, the middle of nine, and never 0.
      expect(at).toBe(4);
    }
    // And a record of the RIGHT rank is still honoured, so the guard has not
    // simply disabled records on flat pyramids.
    expect(
      planeSelection(FLAT[0], axisRoles(TCZYX, 5), TCZYX, null, {
        planes: { z: 7 },
        shape: FLAT[0],
      })[2],
    ).toBe(7);
  });

  it('treats a record whose SHAPE cannot answer as no record', () => {
    // Measured: with shape [] the mapping used to read a missing reference
    // size, default it to one slice, and return index 8 at a 9-slice level for
    // a recorded slice 4. The record was present, so the refusal was skipped,
    // and a wrong slice was drawn with no error. That combination is the
    // defect this row exists to remove, so an unusable shape now refuses.
    expect(() =>
      assertPlaneIsResolvable(Z_PYRAMID, roles, TCZYX, { planes: { z: 4 }, shape: [] }),
    ).toThrow(/no usable slice was recorded/);

    // A shape of the wrong rank reads some other axis's size as z's: [9,64,64]
    // at dim 2 gives a reference of 64, and index 0 out of it.
    expect(() =>
      assertPlaneIsResolvable(Z_PYRAMID, roles, TCZYX, { planes: { z: 4 }, shape: [9, 64, 64] }),
    ).toThrow(/no usable slice was recorded/);
  });

  it('refuses a record that names an axis OTHER than the resampled one', () => {
    // {t: 0} answers for t, and t is not what is ambiguous here.
    expect(() =>
      assertPlaneIsResolvable(Z_PYRAMID, roles, TCZYX, { planes: { t: 0 }, shape: Z_PYRAMID[0] }),
    ).toThrow(/no usable slice was recorded/);
  });

  it('treats an EMPTY record as no record, not as permission', () => {
    // `{}` is what a source with nothing recorded looks like once it has been
    // through a normaliser, and it carries no slice, so it must not satisfy
    // the check.
    expect(() =>
      assertPlaneIsResolvable(Z_PYRAMID, roles, TCZYX, { planes: {}, shape: Z_PYRAMID[0] }),
    ).toThrow(/no usable slice was recorded/);
  });
});

describe('displayedPlanesForProbe', () => {
  const layout = {
    axes: ['t', 'c', 'z', 'y', 'x'],
    axis_roles: { y: 3, x: 4, c: 1 },
    level0_shape: [1, 3, 9, 1000, 2000],
  };

  it('reads the same middle slice off a probe as off the parsed layout', () => {
    expect(displayedPlanesForProbe(layout)).toEqual({ z: 4 });
  });

  it('handles what the LIVE broker actually returns, not an invented shape', () => {
    // Copied from a real `probe_ngff_source` response on 2026-11-25, for a
    // 9-slice fixture store. The point is that the field names and the role
    // mapping are the service's own: a helper tested only against a shape this
    // file invented would be green and still wrong at the one call site it
    // has. Note axis_roles carries no `indexed` list, which is why the adapter
    // derives one rather than expecting the broker to send it.
    const live = {
      axes: ['t', 'c', 'z', 'y', 'x'],
      axis_roles: { y: 3, x: 4, c: 1 },
      level0_shape: [1, 1, 9, 256, 256],
    };
    // t is singleton so it is omitted, c may not carry a plane, and z is 9
    // deep so the middle slice is 4. This is the value the live worker was
    // then measured reading: it fetched chunk s0/0.0.4.0.0 and staged an
    // array whose background is slice 4's.
    expect(displayedPlanesForProbe(live)).toEqual({ z: 4 });
  });

  it('uses the PROBE roles, so the axis set matches what the broker will accept', () => {
    // A store whose channel axis sits at index 0. If this used its own role
    // resolution and disagreed, the record would name an axis the broker
    // refuses, and an importable source would fail to import.
    expect(
      displayedPlanesForProbe({
        axes: ['c', 'z', 'y', 'x'],
        axis_roles: { y: 2, x: 3, c: 0 },
        level0_shape: [3, 9, 1000, 2000],
      }),
    ).toEqual({ z: 4 });
  });

  it('records nothing when the probe did not describe its layout', () => {
    // A broker older than v0.12.6. Without names and a shape there is no way
    // to tell a z-stack from a 2-D image, so there is nothing to refuse on
    // here and the training reader refuses it instead.
    expect(displayedPlanesForProbe(undefined)).toBeUndefined();
    expect(displayedPlanesForProbe({})).toBeUndefined();
    expect(displayedPlanesForProbe({ axes: ['z', 'y', 'x'] })).toBeUndefined();
  });

  it('records nothing when the names and the shape do not describe each other', () => {
    expect(
      displayedPlanesForProbe({
        axes: ['z', 'y', 'x'],
        axis_roles: { y: 1, x: 2, c: null },
        level0_shape: [9, 1000],
      }),
    ).toBeUndefined();
  });

  it('propagates the refusal for a layout a plane cannot describe', () => {
    expect(() =>
      displayedPlanesForProbe({
        axes: ['', 'y', 'x'],
        axis_roles: { y: 1, x: 2, c: null },
        level0_shape: [9, 1000, 2000],
      }),
    ).toThrow(/no name/);
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

describe('describeDtype', () => {
  it('says both spellings of the same depth the same way', () => {
    expect(describeDtype('<u2')).toBe('16-bit');
    expect(describeDtype('uint16')).toBe('16-bit');
    expect(describeDtype('>u2')).toBe('16-bit');
    expect(describeDtype('|u1')).toBe('8-bit');
    expect(describeDtype('uint8')).toBe('8-bit');
  });

  it('marks signed and floating point, because unsigned is the unmarked case', () => {
    expect(describeDtype('<i2')).toBe('16-bit signed');
    expect(describeDtype('int16')).toBe('16-bit signed');
    expect(describeDtype('<f4')).toBe('32-bit float');
    expect(describeDtype('float32')).toBe('32-bit float');
    expect(describeDtype('bool')).toBe('binary');
  });

  it('passes an unrecognised dtype through rather than blanking it', () => {
    // A blank where the bit depth belongs would read as a bug. Showing the
    // raw spelling is ugly but honest.
    expect(describeDtype('complex64')).toBe('complex64');
    expect(describeDtype('<c8')).toBe('<c8');
  });

  it('renders nothing for no dtype at all', () => {
    expect(describeDtype('')).toBe('');
    expect(describeDtype(null)).toBe('');
    expect(describeDtype(undefined)).toBe('');
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


// Added after a review found that materialisation could drop channels in
// silence. The premise and the guard are tested separately, because the
// premise is what makes the guard necessary.
describe('materialisation refuses rather than dropping channels', () => {
  const MAX = 4;

  it('chunkToBands DOES truncate silently, which is why the guard exists', () => {
    // 10 channels of a 1x1 plane, channel axis first.
    const data = new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
    const bands = chunkToBands(data, [10, 1, 1], [1, 1, 1], 0, MAX);
    expect(bands).toHaveLength(MAX);
    // No error, no warning: the caller gets 4 bands and no indication that 6
    // were discarded. That is correct for display and wrong for a copy.
  });

  it('refuses when the store has more channels than were copied', () => {
    expect(() => assertNoChannelTruncation(10, MAX, MAX)).toThrow(/10 channels/);
    expect(() => assertNoChannelTruncation(10, MAX, MAX)).toThrow(/at most 4/);
  });

  it('allows a store that fits, and one exactly at the cap', () => {
    expect(() => assertNoChannelTruncation(1, 1, MAX)).not.toThrow();
    expect(() => assertNoChannelTruncation(4, 4, MAX)).not.toThrow();
  });

  it('does not refuse on an unknown channel count', () => {
    // A count we could not read is not evidence of truncation, and refusing
    // on it would block stores that are perfectly fine.
    expect(() => assertNoChannelTruncation(NaN, MAX, MAX)).not.toThrow();
  });
});
