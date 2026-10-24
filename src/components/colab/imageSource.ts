/**
 * The decode seam (colab-c-ometiff-design.md §5).
 *
 * Every place that turns a dataset image URL into pixels used to construct a
 * `new Image()` directly. That works for PNG/JPEG and for nothing else, which
 * is what blocks pyramidal OME-TIFF in the artifact and, later, a remote NGFF
 * source. This module is the one place that decision now lives.
 *
 * The contract is deliberately narrow:
 *
 *   - `getDrawable(level)` returns something you can pass straight to
 *     `ctx.drawImage`, so a caller that wants a scaled canvas never has to
 *     materialise a full-resolution one first. For a browser-native format
 *     the drawable *is* the `HTMLImageElement`, so that path allocates
 *     exactly what it allocated before this module existed.
 *   - `displayUrl()` returns something `<img src>` and OpenLayers'
 *     `ImageStatic` can render. For a browser-native format it is the input
 *     URL, unchanged and un-copied.
 *
 * Dispatch is by URL extension, with **browser decode as the fallback for
 * anything unrecognised**. That matters: the CLAHE path stores its result as
 * a `data:image/png;base64,...` URL and the AI call sites are handed it, so
 * "no extension" has to mean "the browser can read it", which is the truth
 * today and stays the truth after OME-TIFF lands.
 */

import type { PixelRegion } from './ngffLayout';

export interface PyramidLevel {
  width: number;
  height: number;
}

export interface ImageSourceHandle {
  /** Level-0 (full resolution) dimensions. */
  readonly width: number;
  readonly height: number;
  /** Finest first. A single-level source reports exactly one entry. */
  readonly levels: readonly PyramidLevel[];
  /**
   * Index of the smallest level whose long axis is still >= `minLongAxis`,
   * i.e. the cheapest level that can be downsampled to the caller's target
   * without upsampling. Falls back to 0 when the request is finer than the
   * image itself.
   */
  levelForLongAxis(minLongAxis: number): number;
  /**
   * A `CanvasImageSource` for `level` at that level's own dimensions. Pass it
   * to `ctx.drawImage(drawable, 0, 0, w, h)` to resample in one step.
   */
  getDrawable(level?: number): Promise<CanvasImageSource>;
  /**
   * A URL an `<img>` or an OpenLayers `ImageStatic` can render directly.
   *
   * `maxLongAxis` bounds the **returned image**, not merely the level that is
   * decoded: the cheapest level covering the request is chosen and then scaled
   * the rest of the way down if it overshoots. Every consumer should pass one,
   * because level 0 of a remote NGFF store can be gigapixels. A browser-native
   * source ignores it and returns its input URL, as it always did.
   */
  displayUrl(maxLongAxis?: number): Promise<string>;
  /**
   * One level's samples in the source's own dtype, before any display
   * conversion. This is what materialisation encodes (design §8).
   *
   * Optional on purpose. Only a source that has no copy in the artifact needs
   * one made, so only the NGFF reader implements it; asking a local PNG or
   * OME-TIFF for its native samples is a question with no caller.
   */
  readLevelNative?(level: number): Promise<NativePlane>;
  /** Release anything the handle owns (object URLs, open readers). */
  close(): void;
}

/** One level's pixels, one flat row-major plane per channel. */
export interface NativePlane {
  width: number;
  height: number;
  bands: ArrayLike<number>[];
  /** numpy spelling, e.g. `'uint16'`. Every band shares it. */
  dtype: string;
}

export type ImageSourceKind = 'browser' | 'tiff' | 'ngff';

const TIFF_EXTENSIONS = ['.tif', '.tiff'];

/**
 * The largest level this module will rasterise, in pixels.
 *
 * `getDrawable` allocates an RGBA canvas of the level's full dimensions, so
 * 64 megapixels is already a 256 MB allocation, at the edge of what a tab
 * survives. A level above that does not render slowly, it hangs the tab, and a
 * remote whole-slide store can offer one: `import_ngff_image` deliberately
 * imposes no size limit (linking is meant to be free) and the 64 MiB
 * materialisation gate only governs the copy, not the display.
 *
 * Failing here with a message that names the remedy beats freezing. The remedy
 * exists: import a region of the slide instead of the whole of it (design §13
 * step 6).
 */
export const MAX_DISPLAY_PIXELS = 64 * 1024 * 1024;

/**
 * The dimensions `width`/`height` should be drawn at to fit `maxLongAxis`,
 * or `null` when it already fits. Pure, and exported for the test.
 *
 * Needed because picking a pyramid level only gets within a factor of two of a
 * request: `levelForLongAxis` returns the smallest level that still *covers*
 * it, so a 4096 request against a 6000-pixel level yields 6000, which is 2.1x
 * the intended area. On a badly-pyramided store the overshoot is unbounded.
 */
export function fitLongAxis(
  width: number,
  height: number,
  maxLongAxis: number,
): { width: number; height: number } | null {
  const longAxis = Math.max(width, height);
  if (!(maxLongAxis > 0) || longAxis <= maxLongAxis) return null;
  const scale = maxLongAxis / longAxis;
  return {
    width: Math.max(1, Math.round(width * scale)),
    height: Math.max(1, Math.round(height * scale)),
  };
}

/**
 * How to open an image.
 *
 * A bare string keeps every pre-existing caller working and dispatches on the
 * extension. The object form is for a remote NGFF store, which cannot be
 * identified from a URL with any confidence: `omezarr-view` serves its stores
 * from `/zarr/{id}/` and a plain bucket may use any path at all, so there is
 * no suffix to key on. The broker's `get_image_url` already returns a
 * discriminated union for exactly this reason (design §6), so the caller knows
 * the kind and passes it rather than making this module guess.
 */
export type ImageSourceRef =
  | string
  | {
      kind: 'ngff';
      storeRoot: string;
      multiscalePath?: string;
      /**
       * A rectangle of the store, in level-0 coordinates, for a whole-slide
       * source imported as a patch (design §13 step 6). The handle then
       * reports the patch's dimensions and reads only its pixels, so a
       * gigapixel slide costs the same as the crop taken out of it.
       */
      region?: PixelRegion | null;
    };

/**
 * Classify a URL by extension. Pure, and exported for the test.
 *
 * `data:` and `blob:` are always browser-decodable by construction (we only
 * ever mint them from a canvas), so they short-circuit ahead of any suffix
 * check.
 *
 * `.zarr` is recognised as a convenience for a store root a user pasted, but
 * it is not the primary route to NGFF and must not be treated as one: most
 * real store roots do not end in `.zarr`. Use the object form of
 * `ImageSourceRef` when the kind is known.
 */
export function sourceKindForUrl(url: string): ImageSourceKind {
  const scheme = url.slice(0, url.indexOf(':') + 1).toLowerCase();
  if (scheme === 'data:' || scheme === 'blob:') return 'browser';
  // Presigned S3 URLs carry a long query string; the extension is on the
  // path, which is also how `model-finetune` decides what it can read.
  const path = url.split('#')[0].split('?')[0].toLowerCase();
  const bare = path.endsWith('/') ? path.slice(0, -1) : path;
  if (bare.endsWith('.zarr')) return 'ngff';
  return TIFF_EXTENSIONS.some((ext) => bare.endsWith(ext)) ? 'tiff' : 'browser';
}

/** Pure core of `ImageSourceHandle.levelForLongAxis`; exported for the test. */
export function pickLevelForLongAxis(levels: readonly PyramidLevel[], minLongAxis: number): number {
  for (let i = levels.length - 1; i > 0; i--) {
    if (Math.max(levels[i].width, levels[i].height) >= minLongAxis) return i;
  }
  return 0;
}

/**
 * The pre-existing path, unchanged in substance: hand the URL to the browser
 * and let it decode. One level, no pyramid, and `displayUrl` is the input.
 */
class BrowserImageSource implements ImageSourceHandle {
  readonly width: number;
  readonly height: number;
  readonly levels: readonly PyramidLevel[];

  constructor(private readonly url: string, private readonly img: HTMLImageElement) {
    this.width = img.naturalWidth;
    this.height = img.naturalHeight;
    this.levels = [{ width: this.width, height: this.height }];
  }

  levelForLongAxis(): number {
    return 0;
  }

  async getDrawable(): Promise<CanvasImageSource> {
    return this.img;
  }

  async displayUrl(): Promise<string> {
    return this.url;
  }

  close(): void {
    // The browser owns the decoded bitmap; dropping the element is enough.
  }
}

function loadHtmlImage(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('Failed to load image'));
    img.src = url;
  });
}

export async function openImageSource(ref: ImageSourceRef): Promise<ImageSourceHandle> {
  if (typeof ref !== 'string') {
    const { openNgffPyramid } = await import('./ngffPyramid');
    return new PyramidImageSource(
      await openNgffPyramid(ref.storeRoot, ref.multiscalePath, ref.region),
    );
  }
  const kind = sourceKindForUrl(ref);
  if (kind === 'tiff') {
    const { openOmeTiffPyramid } = await import('./omeTiffPyramid');
    return new PyramidImageSource(await openOmeTiffPyramid(ref));
  }
  if (kind === 'ngff') {
    const { openNgffPyramid } = await import('./ngffPyramid');
    return new PyramidImageSource(await openNgffPyramid(ref));
  }
  return new BrowserImageSource(ref, await loadHtmlImage(ref));
}

// --- Pyramidal sources ----------------------------------------------------
// OME-TIFF and NGFF differ only in how a level's pixels are fetched. Both
// reduce to "levels, plus ImageData for one of them", so the canvas cache,
// the display-URL rendering and its revocation live here once. Keeping the
// format-specific imports behind `await import` also keeps geotiff.js and
// zarrita out of the main bundle for the PNG-only path.

/** What a format module hands back. Structural, so this file needs neither
 *  geotiff.js's nor zarrita's types. */
export interface DecodedPyramid {
  levels: readonly PyramidLevel[];
  /** RGB-ish `ImageData` for one level, already contrast-mapped to 8 bit. */
  readLevelAsImageData(level: number): Promise<ImageData>;
  /** See `ImageSourceHandle.readLevelNative`. Optional for the same reason. */
  readLevelNative?(level: number): Promise<NativePlane>;
  close(): void;
}

class PyramidImageSource implements ImageSourceHandle {
  readonly width: number;
  readonly height: number;
  readonly levels: readonly PyramidLevel[];
  private readonly canvases = new Map<number, HTMLCanvasElement>();
  /** Keyed by the `maxLongAxis` bound the URL was rendered for, `0` meaning
   *  unbounded. One handle asked for a thumbnail and then for a full-size URL
   *  must not be handed the thumbnail twice. */
  private readonly objectUrls = new Map<number, string>();
  /**
   * Present only when the underlying format implements it, so `if
   * (handle.readLevelNative)` is a real capability check rather than a
   * question that always answers yes and then throws.
   */
  readonly readLevelNative?: (level?: number) => Promise<NativePlane>;

  constructor(private readonly pyramid: DecodedPyramid) {
    this.levels = pyramid.levels;
    this.width = pyramid.levels[0].width;
    this.height = pyramid.levels[0].height;
    const native = pyramid.readLevelNative;
    if (native) this.readLevelNative = (level = 0) => native.call(pyramid, level);
  }

  levelForLongAxis(minLongAxis: number): number {
    return pickLevelForLongAxis(this.levels, minLongAxis);
  }

  async getDrawable(level = 0): Promise<CanvasImageSource> {
    const cached = this.canvases.get(level);
    if (cached) return cached;
    const dims = this.levels[level] ?? this.levels[0];
    if (dims.width * dims.height > MAX_DISPLAY_PIXELS) {
      throw new Error(
        `This image is ${dims.width} by ${dims.height} pixels, too large for `
          + 'the browser to display in one piece. Link a region of the source '
          + 'instead of the whole of it.',
      );
    }
    const imageData = await this.pyramid.readLevelAsImageData(level);
    const canvas = document.createElement('canvas');
    canvas.width = imageData.width;
    canvas.height = imageData.height;
    canvas.getContext('2d')!.putImageData(imageData, 0, 0);
    this.canvases.set(level, canvas);
    return canvas;
  }

  /**
   * OpenLayers and `<img>` cannot read a TIFF or a Zarr store, so the display
   * URL is a PNG rendered from one level. Owned by the handle: `close()`
   * revokes it, and callers must not outlive the handle.
   *
   * The level is level 0 unless the caller caps it, so a caller that only
   * needs a thumbnail never pays to decode a full-resolution pyramid base.
   * The chosen level is then scaled down the rest of the way when it
   * overshoots the cap, because level selection alone only gets within a
   * factor of two of it (see `fitLongAxis`).
   *
   * Cached per cap rather than once per handle, so asking the same handle for
   * a thumbnail and then for a full-size URL returns two different images
   * instead of the thumbnail twice.
   */
  async displayUrl(maxLongAxis?: number): Promise<string> {
    const cap = maxLongAxis && maxLongAxis > 0 ? Math.floor(maxLongAxis) : 0;
    const cached = this.objectUrls.get(cap);
    if (cached) return cached;

    const level = cap ? this.levelForLongAxis(cap) : 0;
    let canvas = (await this.getDrawable(level)) as HTMLCanvasElement;
    const fit = cap ? fitLongAxis(canvas.width, canvas.height, cap) : null;
    if (fit) {
      const scaled = document.createElement('canvas');
      scaled.width = fit.width;
      scaled.height = fit.height;
      scaled.getContext('2d')!.drawImage(canvas, 0, 0, fit.width, fit.height);
      canvas = scaled;
    }
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/png'));
    if (!blob) throw new Error('Failed to render TIFF for display');
    const url = URL.createObjectURL(blob);
    this.objectUrls.set(cap, url);
    return url;
  }

  close(): void {
    for (const url of Array.from(this.objectUrls.values())) URL.revokeObjectURL(url);
    this.objectUrls.clear();
    this.canvases.clear();
    this.pyramid.close();
  }
}
