/**
 * NGFF (OME-Zarr) layout logic (colab-c-ometiff-design.md §5, §7).
 *
 * Pure functions only: no Zarr I/O, no network, no zarrita. `ngffPyramid.ts`
 * is the module that actually reads a store and it imports everything here.
 *
 * The split is physical rather than stylistic. This is the part that is ours
 * and the part that fails *silently* -- get the axis mapping or the stride
 * walk wrong and nothing throws, you just draw a sheared, transposed or
 * all-black image. It therefore has to stay testable no matter what the Zarr
 * library does, and zarrita ships an `import`-only exports map that jest 27
 * cannot resolve at all. Keeping this file dependency-free is what lets the
 * tests exercise it directly instead of through five brittle
 * `moduleNameMapper` entries pointing into three packages' `dist/` internals.
 *
 * What makes the logic non-trivial:
 *
 *   - **Axis order is not fixed.** NGFF says a multiscale carries an `axes`
 *     list, and real stores are `tczyx`, `czyx`, `cyx`, `zyx` and `yx`. Every
 *     dimension that is not Y or X has to be resolved to a single index before
 *     there are pixels to draw.
 *   - **`axes` is optional.** v0.1 to v0.3 predate it and imply 5D `tczyx`.
 *     A store written to those versions is still out there.
 *   - **Level order is a convention.** `datasets[]` is *documented* as ordered
 *     coarsest-last, but nothing validates it, so it is re-derived from the
 *     shapes exactly as the TIFF path re-derives it from the SubIFDs.
 */

import type { PyramidLevel } from './imageSource';

/** One entry of `multiscales[].axes`. `type` is absent before v0.4. */
export interface NgffAxis {
  name: string;
  type?: string;
}

export interface NgffMultiscale {
  /** Array paths relative to the store root, in the order the store gave them. */
  datasetPaths: string[];
  axes: NgffAxis[];
}

/**
 * Where each meaningful axis sits in the array's dimension list.
 *
 * `y` and `x` are required. `c` is optional. `indexed` lists every remaining
 * dimension (t, z, and anything non-standard), which is what has to be pinned
 * to one value before a 2-D plane exists.
 */
export interface AxisRoles {
  y: number;
  x: number;
  c: number | null;
  indexed: number[];
}

/** Implied axis order for NGFF v0.1 to v0.3, which had no `axes` field. */
const IMPLICIT_AXES: NgffAxis[] = [
  { name: 't', type: 'time' },
  { name: 'c', type: 'channel' },
  { name: 'z', type: 'space' },
  { name: 'y', type: 'space' },
  { name: 'x', type: 'space' },
];

/**
 * Pull the multiscale we are going to read out of a group's `.zattrs`.
 *
 * `multiscalePath` selects one by its `name` or by the path of its first
 * dataset, for a store that holds several images in one group. Without it the
 * first is used, which is what every single-image store wants.
 *
 * Throws rather than returning null: a store root with no readable
 * `multiscales` is not a slightly-degraded image, it is not an image, and the
 * import path (§7) is supposed to reject it with a specific message.
 */
export function parseMultiscales(attrs: unknown, multiscalePath?: string): NgffMultiscale {
  const list = (attrs as any)?.multiscales;
  if (!Array.isArray(list) || list.length === 0) {
    throw new Error('Not an OME-Zarr store: no "multiscales" in .zattrs');
  }

  const chosen = multiscalePath
    ? list.find(
        (m: any) =>
          m?.name === multiscalePath || m?.datasets?.[0]?.path === multiscalePath,
      )
    : list[0];
  if (!chosen) {
    throw new Error(`No multiscale named "${multiscalePath}" in this store`);
  }

  const datasetPaths = (Array.isArray(chosen.datasets) ? chosen.datasets : [])
    .map((d: any) => (typeof d === 'string' ? d : d?.path))
    .filter((p: any): p is string => typeof p === 'string' && p.length > 0);
  if (datasetPaths.length === 0) {
    throw new Error('OME-Zarr multiscale lists no datasets');
  }

  const axes: NgffAxis[] = Array.isArray(chosen.axes)
    ? chosen.axes.map((a: any) =>
        typeof a === 'string' ? { name: a } : { name: String(a?.name ?? ''), type: a?.type },
      )
    : IMPLICIT_AXES;

  return { datasetPaths, axes };
}

/**
 * Map axes onto array dimensions.
 *
 * *rank* is the array's own dimension count and wins over `axes.length` when
 * they disagree: the array is the thing we are actually going to index, and a
 * mismatched `axes` list is a metadata bug we can survive by falling back to
 * "the last two dimensions are Y and X", which is true of every NGFF layout.
 */
export function axisRoles(axes: NgffAxis[], rank: number): AxisRoles {
  const names = axes.map((a) => (a.name || '').toLowerCase());
  let y = names.indexOf('y');
  let x = names.indexOf('x');
  let c = names.indexOf('c');

  const usable = axes.length === rank && y >= 0 && x >= 0;
  if (!usable) {
    if (rank < 2) {
      throw new Error(`OME-Zarr array has rank ${rank}; need at least 2 dimensions`);
    }
    // Y and X are always the two fastest-varying dimensions in NGFF.
    y = rank - 2;
    x = rank - 1;
    c = -1;
  }

  const indexed: number[] = [];
  for (let d = 0; d < rank; d++) {
    if (d !== y && d !== x && d !== c) indexed.push(d);
  }
  return { y, x, c: c >= 0 ? c : null, indexed };
}

/** `{ width, height }` for one array shape. */
export function levelDims(shape: number[], roles: AxisRoles): PyramidLevel {
  return { width: shape[roles.x], height: shape[roles.y] };
}

/**
 * A rectangle of one image, in **level-0 pixel coordinates**.
 *
 * This is how a whole-slide source enters a dataset (design §2, §13 step 6):
 * the manifest entry *is* the patch, so its `width`/`height` are this
 * rectangle's and everything downstream — the 64 MiB materialisation gate,
 * the dimensions in the index, the OME-TIFF that gets written — is sized to
 * the patch rather than to the slide.
 */
export interface PixelRegion {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** A half-open `[start, stop)` range along one dimension. */
export type AxisRange = [number, number];

function clamp(value: number, low: number, high: number): number {
  return Math.min(high, Math.max(low, value));
}

/**
 * *region* mapped from level-0 coordinates onto *level*'s own grid.
 *
 * The scale is taken per axis from the two levels' dimensions rather than
 * from a `2 ** level` assumption: NGFF lets a multiscale downsample anisotropically
 * (and `coarsen`-built stores routinely do), so Y and X can have different
 * factors and neither need be a power of two.
 *
 * The near edge floors and the far edge ceils, so the crop always *covers*
 * the requested rectangle. Rounding both the same way would lose a partial
 * pixel at one edge per level, which compounds down a deep pyramid into a
 * visible drift between what the picker outlined and what got copied.
 *
 * The result is clamped into the level and is never empty: a patch small
 * enough to vanish at a coarse level still has to render as *something*, and
 * one pixel of the right neighbourhood beats a zero-sized read that throws.
 */
export function regionAtLevel(
  region: PixelRegion,
  base: PyramidLevel,
  level: PyramidLevel,
): PixelRegion {
  const sx = base.width > 0 ? level.width / base.width : 1;
  const sy = base.height > 0 ? level.height / base.height : 1;
  const x0 = clamp(Math.floor(region.x * sx), 0, Math.max(0, level.width - 1));
  const y0 = clamp(Math.floor(region.y * sy), 0, Math.max(0, level.height - 1));
  const x1 = clamp(Math.ceil((region.x + region.width) * sx), x0 + 1, level.width);
  const y1 = clamp(Math.ceil((region.y + region.height) * sy), y0 + 1, level.height);
  return { x: x0, y: y0, width: x1 - x0, height: y1 - y0 };
}

/**
 * The zarrita selection that reduces an array to one drawable plane.
 *
 * Y, X and C pass through whole (`null`); every other dimension is pinned.
 * Time pins to 0 and Z pins to the **middle** slice rather than 0, because
 * the first slice of a Z-stack is routinely empty or out of focus and an
 * image that opens black reads as a broken import rather than as a choice.
 *
 * With *region* set (already mapped onto this level by `regionAtLevel`), Y and
 * X become ranges instead. A range is returned as a plain `[start, stop)`
 * tuple rather than as a `zarrita.slice`, so this module stays free of the
 * Zarr library: jest 27 cannot resolve zarrita's `import`-only exports map at
 * all, and the axis arithmetic here is precisely the part that has to stay
 * directly testable. `ngffPyramid` does the one-line conversion.
 */
export function planeSelection(
  shape: number[],
  roles: AxisRoles,
  axes: NgffAxis[],
  region?: PixelRegion | null,
): (number | null | AxisRange)[] {
  const selection: (number | null | AxisRange)[] = shape.map(() => null);
  for (const d of roles.indexed) {
    const name = (axes[d]?.name || '').toLowerCase();
    const size = Math.max(1, shape[d]);
    selection[d] = name === 'z' ? Math.floor(size / 2) : 0;
  }
  if (region) {
    selection[roles.y] = [region.y, region.y + region.height];
    selection[roles.x] = [region.x, region.x + region.width];
  }
  return selection;
}

/**
 * Split a fetched plane into one band per channel, in the layout
 * `rastersToRgba` expects.
 *
 * *shape* and *stride* are what zarrita returns after the selection has
 * dropped the pinned dimensions, so the channel axis is wherever it ended up
 * and is located by counting how many pinned dimensions preceded it. Reading
 * through the returned stride rather than assuming C-contiguity is what makes
 * this correct for a transposed store.
 *
 * *maxBands* caps the copy. The default of 3 is all `rastersToRgba` reads, so
 * a 40-channel store does not pay to copy 37 planes it will discard. The
 * materialisation path raises it to 4, which is as wide as the OME-TIFF
 * profile goes; the broker refuses anything wider before it gets here, so no
 * caller can reach a silent truncation by raising this alone.
 */
export function chunkToBands(
  data: ArrayLike<number>,
  shape: number[],
  stride: number[],
  channelAxis: number | null,
  maxBands = 3,
): ArrayLike<number>[] {
  if (shape.length === 2) {
    return [readPlane(data, shape, stride, [0, 1], -1, 0)];
  }
  if (shape.length !== 3 || channelAxis === null) {
    throw new Error(`Unsupported OME-Zarr plane shape [${shape.join(', ')}]`);
  }
  const spatial = [0, 1, 2].filter((d) => d !== channelAxis);
  const count = shape[channelAxis];
  const bands: ArrayLike<number>[] = [];
  for (let ch = 0; ch < Math.min(count, maxBands); ch++) {
    bands.push(readPlane(data, shape, stride, spatial, channelAxis, ch));
  }
  return bands;
}

/**
 * Copy one 2-D plane out of a strided buffer.
 *
 * The output keeps the **input's** typed-array kind, which is load-bearing
 * rather than tidy: `rastersToRgba` passes `Uint8Array` and `Uint8ClampedArray`
 * through unscaled and min/max stretches everything else. Widening an 8-bit
 * store to `Float64Array` here would silently contrast-stretch an image that
 * the TIFF and PNG paths render as-is, so the same picture would look
 * different depending on where it was stored.
 */
function readPlane(
  data: ArrayLike<number>,
  shape: number[],
  stride: number[],
  spatial: number[],
  pinnedAxis: number,
  pinnedIndex: number,
): ArrayLike<number> {
  const [yd, xd] = spatial;
  const height = shape[yd];
  const width = shape[xd];
  const base = pinnedAxis >= 0 ? pinnedIndex * stride[pinnedAxis] : 0;
  const pixels = height * width;

  // Contiguous row-major run: hand back a view instead of copying. This is
  // the common case (a single-channel level, or the C axis outermost).
  if (stride[xd] === 1 && stride[yd] === width && isTypedArray(data)) {
    return data.subarray(base, base + pixels) as unknown as ArrayLike<number>;
  }

  const out = isTypedArray(data)
    ? (new (data.constructor as Float32ArrayConstructor)(pixels) as ArrayLike<number> as {
        [i: number]: number;
        length: number;
      })
    : new Float64Array(pixels);
  for (let row = 0; row < height; row++) {
    const rowBase = base + row * stride[yd];
    for (let col = 0; col < width; col++) {
      out[row * width + col] = data[rowBase + col * stride[xd]];
    }
  }
  return out as ArrayLike<number>;
}

/** Bytes per sample, keyed by the dtype's kind-and-width suffix. */
const DTYPE_ITEMSIZE: Record<string, number> = {
  b1: 1, i1: 1, u1: 1,
  i2: 2, u2: 2, f2: 2,
  i4: 4, u4: 4, f4: 4,
  i8: 8, u8: 8, f8: 8,
};

/**
 * Bytes per sample for a Zarr dtype in either spelling, `0` when unknown.
 *
 * Both spellings reach the frontend: a v2 store says `"<u2"` and a v3 one
 * says `"uint16"`, and the broker's probe passes through whichever the store
 * used. Reducing both to a kind-and-width suffix is what
 * `broker_core.normalise_ngff_dtype` does, and the two have to agree, because
 * a patch this function calls small and the broker calls too large would be
 * offered in the picker and then refused on the first annotation.
 */
export function dtypeItemsize(dtype: string | null | undefined): number {
  const raw = (dtype || '').toLowerCase().replace(/^[<>|=]/, '');
  if (raw === 'bool') return 1;
  const named = raw.match(/^(u?int|float)(\d+)$/);
  const kinds: Record<string, string> = { int: 'i', uint: 'u', float: 'f' };
  const suffix = named ? `${kinds[named[1]]}${Number(named[2]) / 8}` : raw;
  return DTYPE_ITEMSIZE[suffix] || 0;
}

/**
 * Decoded size of one full-resolution read, in bytes, or `0` when the dtype
 * is not one we recognise.
 *
 * A **lower bound**, matching `broker_core.materialisation_bytes` term for
 * term: a store with no omero metadata reports no channel names and counts as
 * one channel. Zero means "no opinion" and must not be shown as "0 MB".
 */
export function materialiseBytes(
  width: number,
  height: number,
  dtype: string | null | undefined,
  channels?: readonly string[] | null,
): number {
  const itemsize = dtypeItemsize(dtype);
  if (width <= 0 || height <= 0 || itemsize <= 0) return 0;
  return width * height * itemsize * Math.max(1, channels?.length || 0);
}

/**
 * The numpy dtype name for a band, read off the typed array's own kind.
 *
 * Materialisation hands raw bytes to Python, which has to reconstruct the
 * array with `np.frombuffer(..., dtype=...)`. Naming the dtype from the
 * buffer we are actually shipping (rather than from the store's metadata)
 * means the two can never drift: whatever `readPlane` produced is what gets
 * declared.
 *
 * Returns `null` for anything unrecognised, including `BigInt64Array`. A
 * 64-bit integer store is rejected at import time (design §7), so reaching
 * here with one is a bug, not a user's problem, and it must fail loudly
 * rather than be reinterpreted as something narrower.
 */
export function numpyDtypeOf(band: ArrayLike<number>): string | null {
  const name = (band as { constructor?: { name?: string } })?.constructor?.name;
  switch (name) {
    case 'Int8Array':
      return 'int8';
    case 'Uint8Array':
    case 'Uint8ClampedArray':
      return 'uint8';
    case 'Int16Array':
      return 'int16';
    case 'Uint16Array':
      return 'uint16';
    case 'Int32Array':
      return 'int32';
    case 'Uint32Array':
      return 'uint32';
    case 'Float32Array':
      return 'float32';
    case 'Float64Array':
      return 'float64';
    default:
      return null;
  }
}

interface TypedArrayLike {
  readonly constructor: Function;
  readonly length: number;
  subarray(begin: number, end: number): TypedArrayLike;
  [i: number]: number;
}

function isTypedArray(value: unknown): value is TypedArrayLike {
  return ArrayBuffer.isView(value) && !(value instanceof DataView);
}
