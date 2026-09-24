/**
 * The NGFF (OME-Zarr) reader (colab-c-ometiff-design.md §5, §7).
 *
 * A `state: "remote"` manifest entry points at a Zarr store that we have never
 * copied. This module turns that store root into the same `DecodedPyramid`
 * that `omeTiffPyramid` produces, which is what lets a remote image be
 * browsed and annotated with no materialisation step and no second display
 * path.
 *
 * The Zarr I/O itself is `zarrita`, not ours: it already speaks v2 and v3,
 * ships blosc/zstd/lz4/gzip/zlib, and arrived in the tree transitively via
 * `ol` -- the same route as geotiff.js. The NGFF layout logic on top of it
 * lives in `ngffLayout.ts`, which is pure and tested; this file is the thin
 * I/O shell around it.
 */

import { FetchStore, get, open, slice } from 'zarrita';
import { orderPyramidLevels, rastersToRgba } from './omeTiffPyramid';
import {
  axisRoles,
  chunkToBands,
  levelDims,
  numpyDtypeOf,
  parseMultiscales,
  planeSelection,
  regionAtLevel,
} from './ngffLayout';
import type { AxisRange, PixelRegion } from './ngffLayout';
import type { DecodedPyramid, NativePlane } from './imageSource';

/**
 * How many channels materialisation may copy. Matches the broker's
 * `MAX_MATERIALISE_CHANNELS`, which refuses a wider source before the browser
 * ever opens it, so this is a backstop rather than a policy.
 */
const MAX_MATERIALISE_BANDS = 4;

/**
 * Open an NGFF store root and expose its pyramid levels.
 *
 * `storeRoot` must be the group that holds `multiscales`, with a trailing
 * slash or without. Any credential has to already be **in the path** rather
 * than in a query string: a Zarr client builds every chunk URL by appending
 * the key to the root, so `?token=` would land before the key and each chunk
 * would 404 (design §7). Resolving that form is the broker's job.
 */
export async function openNgffPyramid(
  storeRoot: string,
  multiscalePath?: string,
  /**
   * A rectangle of the store, in **level-0 coordinates** (design §13 step 6).
   *
   * Given one, this handle *is* the patch: `levels` reports the crop's
   * dimensions, every read is sliced to it, and nothing downstream — the
   * viewer, the display rasteriser, materialisation — has to know the slide
   * it came out of is larger. That is what lets a gigapixel source be
   * annotated and copied through exactly the same path as a small one.
   */
  region?: PixelRegion | null,
): Promise<DecodedPyramid> {
  const store = new FetchStore(storeRoot.endsWith('/') ? storeRoot.slice(0, -1) : storeRoot);
  const group = await open(store, { kind: 'group' });
  const { datasetPaths, axes } = parseMultiscales(group.attrs, multiscalePath);

  const arrays = await Promise.all(
    datasetPaths.map((path) => open(group.resolve(path), { kind: 'array' })),
  );

  const roles = axisRoles(axes, arrays[0].shape.length);
  const levels = orderPyramidLevels(
    arrays.map((array) => ({ array, ...levelDims(array.shape, roles) })),
  );
  // The full extent of the finest level, which is the coordinate system the
  // region is expressed in. Read after ordering, because `datasets[]` order is
  // only a convention and level 0 is whichever array is largest.
  const base = { width: levels[0].width, height: levels[0].height };
  /** *region* on one level's own grid, or null when the whole level is wanted. */
  const cropAt = (target: { width: number; height: number }) =>
    region ? regionAtLevel(region, base, target) : null;

  /** One level's channel planes, in the store's own dtype. */
  async function readBands(level: number, maxBands?: number) {
    const target = levels[level];
    if (!target) throw new Error(`OME-Zarr store has no level ${level}`);

    const array = target.array;
    // Each level is its own array and may have its own rank in a
    // non-conforming store, so roles are resolved per level rather than
    // once from level 0.
    const levelRoles = axisRoles(axes, array.shape.length);
    const crop = cropAt(target);
    const selection = planeSelection(array.shape, levelRoles, axes, crop).map((s) =>
      Array.isArray(s) ? slice((s as AxisRange)[0], (s as AxisRange)[1]) : s,
    );
    const chunk = await get(array as any, selection as any);

    // The selection dropped the pinned dimensions, so the channel axis has
    // moved down by however many pinned dimensions sat in front of it.
    const channelAxis =
      levelRoles.c === null
        ? null
        : levelRoles.c - levelRoles.indexed.filter((d) => d < levelRoles.c!).length;

    const bands = chunkToBands(
      chunk.data as unknown as ArrayLike<number>,
      chunk.shape,
      chunk.stride,
      channelAxis,
      maxBands,
    );
    // The crop's dimensions, not the level's: `bands` holds exactly what the
    // selection returned, and handing back the level's size would make every
    // consumer index past the end of the buffer.
    return {
      bands,
      width: crop ? crop.width : target.width,
      height: crop ? crop.height : target.height,
    };
  }

  return {
    // Reported as the patch, so `levelForLongAxis`, the OpenLayers extent and
    // the materialisation size check all reason about what is actually
    // readable here rather than about the slide behind it.
    levels: levels.map((level) => {
      const crop = cropAt(level);
      return crop
        ? { width: crop.width, height: crop.height }
        : { width: level.width, height: level.height };
    }),

    async readLevelAsImageData(level: number): Promise<ImageData> {
      const { bands, width, height } = await readBands(level);
      return new ImageData(rastersToRgba(bands, width, height), width, height);
    },

    /**
     * The same planes `readLevelAsImageData` draws, but *before* the contrast
     * stretch and the 8-bit RGBA conversion.
     *
     * Materialisation cannot use the display path's output: an OME-TIFF whose
     * pixels are a display rendering rather than the source's samples would
     * make the artifact a lossy derivative of the store it claims to copy,
     * and a model trained on it would learn the stretch. So this returns the
     * store's own dtype and its own values, untouched.
     */
    async readLevelNative(level: number): Promise<NativePlane> {
      const { bands, width, height } = await readBands(level, MAX_MATERIALISE_BANDS);
      const dtype = numpyDtypeOf(bands[0]);
      if (!dtype) {
        throw new Error(
          'This OME-Zarr store uses a sample type the annotator cannot copy.',
        );
      }
      return { width, height, bands, dtype };
    },

    close(): void {
      // `FetchStore` holds no handle and zarrita caches nothing across
      // instances, so dropping the reference is the whole of it.
    },
  };
}
