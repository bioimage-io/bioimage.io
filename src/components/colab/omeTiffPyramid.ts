/**
 * The SubIFD pyramid shim (colab-c-ometiff-design.md §4).
 *
 * geotiff.js cannot see a SubIFD pyramid on its own. Given an OME-TIFF whose
 * levels 1..n hang off IFD 0 as SubIFDs (the Bio-Formats convention, and the
 * profile §4 fixes for us), `getImageCount()` reports 1 and any level request
 * *silently returns full resolution* instead of erroring. The silence is the
 * dangerous part: measured 1143 ms against 55 ms for the right level, with no
 * signal that anything went wrong.
 *
 * The fix is to walk `fileDirectory.SubIFDs` ourselves and construct a
 * `GeoTIFFImage` per offset, which is what Viv's OME-TIFF loader does. It is
 * about thirty lines and it is ours to maintain, hence this file and its test.
 *
 * Everything that does not need a decoded pixel is a pure function below, so
 * the level maths and the band handling are testable without a TIFF.
 */

import { GeoTIFFImage, fromUrl } from 'geotiff';
import type { DecodedPyramid, PyramidLevel } from './imageSource';

interface LevelEntry extends PyramidLevel {
  image: GeoTIFFImage;
}

/**
 * Order levels finest-first and drop any that is not strictly smaller than
 * the one before it.
 *
 * SubIFD order is a convention, not a guarantee, and a writer that emits a
 * duplicate or an out-of-order level would otherwise make `levelForLongAxis`
 * pick nonsense. Sorting by area costs nothing and means a coarsest-first
 * file still reads correctly.
 */
export function orderPyramidLevels<T extends PyramidLevel>(levels: T[]): T[] {
  const sorted = [...levels].sort((a, b) => b.width * b.height - a.width * a.height);
  const kept: T[] = [];
  for (const level of sorted) {
    const previous = kept[kept.length - 1];
    if (previous && level.width >= previous.width && level.height >= previous.height) continue;
    kept.push(level);
  }
  return kept;
}

/**
 * Normalise however many bands the file has into RGBA bytes.
 *
 * The profile allows uint8, uint16 and float32; `ImageData` is uint8 only, so
 * anything wider is min/max stretched per plane (a flat channel must not drag
 * the others toward zero). This is display-only, and it is not a new loss:
 * every AI call site already downsamples to uint8 RGB in the browser before
 * sending pixels (design F4), and today's artifact is 8-bit PNG anyway.
 *
 * One band is replicated across R/G/B; three or more takes the first three
 * and ignores the rest.
 */
export function rastersToRgba(
  bands: ArrayLike<number>[],
  width: number,
  height: number,
): Uint8ClampedArray {
  if (bands.length === 0) throw new Error('OME-TIFF level decoded to zero bands');
  const pixels = width * height;
  const out = new Uint8ClampedArray(pixels * 4);
  const planes = bands.length >= 3 ? [bands[0], bands[1], bands[2]] : [bands[0], bands[0], bands[0]];

  const scales = planes.map((plane) => {
    if (plane instanceof Uint8Array || plane instanceof Uint8ClampedArray) {
      return { min: 0, factor: 1 };
    }
    let min = Infinity;
    let max = -Infinity;
    for (let i = 0; i < pixels; i++) {
      const v = plane[i];
      if (v < min) min = v;
      if (v > max) max = v;
    }
    if (!isFinite(min) || !isFinite(max) || max === min) return { min: 0, factor: 1 };
    return { min, factor: 255 / (max - min) };
  });

  for (let i = 0; i < pixels; i++) {
    out[i * 4] = (planes[0][i] - scales[0].min) * scales[0].factor;
    out[i * 4 + 1] = (planes[1][i] - scales[1].min) * scales[1].factor;
    out[i * 4 + 2] = (planes[2][i] - scales[2].min) * scales[2].factor;
    out[i * 4 + 3] = 255;
  }
  return out;
}

/**
 * Build the `GeoTIFFImage` for one SubIFD offset.
 *
 * This mirrors `GeoTIFF.getImage` exactly (geotiff 3.0.5, `geotiff.js:458`),
 * which is the only way in: the public `getImage(n)` walks the top-level IFD
 * chain via `requestIFD`, and a SubIFD is deliberately not part of that chain.
 *
 * `tiff.parser.parseFileDirectoryAt` and the `GeoTIFFImage` constructor arity
 * are both internal contracts, and both changed between geotiff 2 and 3 (v2
 * took `(fileDirectory, geoKeys, dataView, littleEndian, cache, source)` and
 * exposed `parseFileDirectoryAt` on the `GeoTIFF` itself). So this is the
 * function that breaks on an upgrade. It breaks loudly, which is the point of
 * not letting the library guess.
 */
async function imageAtSubIfd(tiff: any, offset: number): Promise<GeoTIFFImage> {
  const ifd = await tiff.parser.parseFileDirectoryAt(offset);
  return new (GeoTIFFImage as any)(ifd, tiff.littleEndian, tiff.cache, tiff.source);
}

/**
 * Read IFD 0's `SubIFDs` tag.
 *
 * `SubIFDs` is an array tag and not marked eager, so it arrives deferred and
 * the synchronous `getValue` throws on it. `loadValue` is the accessor that
 * resolves a deferred field, and returns the actualized one unchanged when it
 * is not deferred.
 */
async function readSubIfdOffsets(fileDirectory: any): Promise<number[]> {
  if (!fileDirectory?.hasTag?.('SubIFDs')) return [];
  const value = await fileDirectory.loadValue('SubIFDs');
  if (value === undefined || value === null) return [];
  return Array.from(typeof value === 'number' ? [value] : value);
}

/**
 * Open `url` and expose its pyramid levels.
 *
 * Level 0 is IFD 0. Levels 1..n come from IFD 0's `SubIFDs` tag when present.
 * When it is absent the file is treated as single-level rather than falling
 * back to page order: plain IFD pages are ambiguous with a multi-page TIFF
 * stack (§4), and guessing wrong means annotating the wrong pixels.
 */
export async function openOmeTiffPyramid(url: string): Promise<DecodedPyramid> {
  const tiff = await fromUrl(url);
  const level0 = await tiff.getImage(0);

  const subIfdOffsets = await readSubIfdOffsets((level0 as any).fileDirectory);
  const images: GeoTIFFImage[] = [level0];
  for (const offset of subIfdOffsets) {
    images.push(await imageAtSubIfd(tiff, offset));
  }

  const levels = orderPyramidLevels(
    images.map<LevelEntry>((image) => ({
      image,
      width: image.getWidth(),
      height: image.getHeight(),
    })),
  );

  return {
    levels: levels.map(({ width, height }) => ({ width, height })),

    async readLevelAsImageData(level: number): Promise<ImageData> {
      const target = levels[level];
      if (!target) throw new Error(`OME-TIFF has no level ${level}`);
      // `interleave: false` gives one typed array per sample, which is what
      // `rastersToRgba` expects and what avoids a second interleave pass.
      const rasters = await target.image.readRasters({ interleave: false });
      const bands = (Array.isArray(rasters) ? rasters : [rasters]) as unknown as ArrayLike<number>[];
      return new ImageData(rastersToRgba(bands, target.width, target.height), target.width, target.height);
    },

    close(): void {
      // No-op for an HTTP source, but a file source holds a descriptor.
      tiff.close();
    },
  };
}
