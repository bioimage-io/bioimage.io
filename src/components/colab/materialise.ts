/**
 * Materialisation: turning a remote OME-Zarr source into a file in the
 * artifact (colab-c-ometiff-design.md §8).
 *
 * A `state: "remote"` image is browsable and annotatable the moment it is
 * linked, because `ngffPyramid` reads the store directly. It is not
 * *trainable*: `get_training_urls` hands out presigned URLs into the
 * artifact, and there is nothing there to point at. Materialisation closes
 * that gap by writing one OME-TIFF, once, the first time someone opens the
 * image to annotate it.
 *
 * The work is split the way it is because of where the code already lives:
 *
 *   - **The read is JS.** The browser already has the store open to draw it,
 *     and `readLevelNative` hands back the same planes before the display
 *     conversion. Re-fetching them in Python would mean a second Zarr client
 *     in Pyodide.
 *   - **The encode is Python.** `public/colab_service.py` already writes the
 *     exact SubIFD-pyramidal OME-TIFF profile the upload path produces, and
 *     it is the file the profile is verified against. A second encoder in JS
 *     would be a second thing to keep in step with §4, so this execs that
 *     module rather than reimplementing it.
 *   - **The PUT is Python too**, straight from the kernel to the presigned
 *     URL. Handing the encoded bytes back out through stdout to PUT them
 *     from JS would base64 the whole file a second time for nothing.
 *
 * Nothing here is on the rendering path. The image is already on screen when
 * this starts, and if it fails the image stays remote and stays annotatable.
 */

import type { ImageSourceHandle, NativePlane } from './imageSource';
import type { MaterialiseResult } from './brokerApi';

export type ExecuteCode = (code: string, callbacks?: any) => Promise<void>;

/**
 * Raw bytes shipped to the kernel per chunk.
 *
 * Each chunk becomes a base64 string inside a Python source string, so it is
 * built, expanded by 4/3, and parsed as source. 3 MiB in is 4 MiB of source,
 * which keeps any single `executeCode` call small enough to stay responsive
 * while still holding the round-trip count to ~22 at the 64 MiB ceiling.
 */
const CHUNK_BYTES = 3 * 1024 * 1024;

/**
 * Where one image's plane is staged inside the kernel's own filesystem.
 *
 * Per stem, not a fixed path. Staging is truncate-then-append over many
 * `executeCode` round trips, and there is one kernel per tab, so two images
 * staged at the same path would interleave their chunks into one file and the
 * second reshape would read the first one's bytes. Nothing downstream could
 * catch that: the broker's phase-2 check verifies the object is a TIFF, and
 * interleaved samples still encode as a perfectly valid TIFF. The manifest
 * would flip to `local` over pixels that are not the source's.
 *
 * The stem is sanitised rather than trusted. It reaches here having passed the
 * broker's `^[A-Za-z0-9._-]+$` check at import, but this builds a filesystem
 * path out of it and must not depend on a check made somewhere else.
 */
export function rawPathFor(stem: string): string {
  const safe = stem.replace(/[^A-Za-z0-9._-]+/g, '_').slice(0, 120) || 'image';
  return `/tmp/materialise-${safe}.raw`;
}

/**
 * Serialises materialisation across the whole tab.
 *
 * Belt to the per-stem path's braces, and it buys something the path alone
 * does not: each run holds a full-resolution plane plus its base64 expansion,
 * up to the broker's 64 MiB ceiling apiece. Two at once is the allocation that
 * kills the tab even when both write to their own file. The kernel is
 * single-threaded anyway, so nothing is lost by waiting.
 *
 * A failed run must not poison the queue, hence the swallowed rejection on the
 * tail: the next caller waits for the previous one to *finish*, not to succeed.
 */
let materialiseQueue: Promise<unknown> = Promise.resolve();

function enqueue<T>(work: () => Promise<T>): Promise<T> {
  const run = materialiseQueue.then(work, work);
  materialiseQueue = run.catch(() => undefined);
  return run;
}

/**
 * The bytes behind one band, as a view rather than a copy.
 *
 * `readPlane` returns either a `subarray` of the fetched chunk or a fresh
 * array, so the byte offset and length have to come from the view itself; a
 * bare `new Uint8Array(band.buffer)` would ship the whole chunk for every
 * channel.
 *
 * Byte order is the platform's, and numpy's default is also the platform's.
 * Both run in the same process here, so they agree by construction. This is
 * the only reason no explicit `<`/`>` prefix is sent with the dtype.
 */
export function bandBytes(band: ArrayLike<number>): Uint8Array {
  const view = band as unknown as ArrayBufferView;
  if (!ArrayBuffer.isView(view)) {
    throw new Error('Cannot materialise: image band is not a typed array.');
  }
  return new Uint8Array(view.buffer, view.byteOffset, view.byteLength);
}

/**
 * base64 for a byte array, in windows small enough not to blow the argument
 * limit of `String.fromCharCode`. Same shape as the kernel's own file writer.
 */
export function toBase64(bytes: Uint8Array): string {
  let binary = '';
  const window = 8192;
  for (let i = 0; i < bytes.length; i += window) {
    binary += String.fromCharCode(...Array.from(bytes.subarray(i, i + window)));
  }
  return btoa(binary);
}

/**
 * Concatenate a plane's bands into one buffer, channel-planar.
 *
 * Planar rather than interleaved because that is the layout numpy can
 * `reshape` into `(C, H, W)` with no copy, and `normalise_axes` in
 * `colab_service.py` already knows how to transpose a leading channel axis to
 * trailing. Interleaving here would mean interleaving correctly for every
 * dtype width, for no gain.
 */
export function packBands(plane: NativePlane): Uint8Array {
  const parts = plane.bands.map(bandBytes);
  const total = parts.reduce((sum, p) => sum + p.length, 0);
  const out = new Uint8Array(total);
  let at = 0;
  for (const part of parts) {
    out.set(part, at);
    at += part.length;
  }
  return out;
}

/** Run one snippet, collecting stdout and turning a Python error into a throw. */
async function runPython(executeCode: ExecuteCode, code: string): Promise<string> {
  let out = '';
  let failure: string | null = null;
  await executeCode(code, {
    onOutput: (output: any) => {
      if (output?.type === 'error') {
        failure = output.content || output.short_content || 'Unknown Python error';
      } else if (typeof output?.content === 'string') {
        out += output.content;
      }
    },
  });
  if (failure) throw new Error(failure);
  return out;
}

/**
 * Install `tifffile` and exec the shared encoder into the kernel.
 *
 * Lazy on purpose. Materialisation happens at most once per remote image and
 * most sessions never trigger it at all, so this must not join the packages
 * every annotator pays for on page load.
 */
async function prepareKernel(executeCode: ExecuteCode, publicUrl: string): Promise<void> {
  await runPython(
    executeCode,
    `
import micropip
await micropip.install(['numpy', 'tifffile==2024.7.24'])
print('materialise: packages ready')
`,
  );
  const serviceCode = await (await fetch(`${publicUrl}/colab_service.py`)).text();
  await runPython(executeCode, serviceCode);
}

/**
 * Encode *plane* as an OME-TIFF in the kernel and PUT it to *putUrl*.
 *
 * Returns the number of pyramid levels written, which is what the broker
 * records on the manifest entry so a later reader knows what it is opening.
 *
 * The PUT body goes up bare, with no `Content-Type`: the presigned SigV2
 * signature covers that header, so setting it is a 403 rather than a
 * mislabelled object.
 */
export async function encodeAndUploadOmeTiff(
  /** Names the staging file, so two images never share one. */
  stem: string,
  plane: NativePlane,
  /** `packBands(plane)`. Passed in rather than recomputed: at the 64 MiB
   *  ceiling this is the single largest allocation on the page. */
  packed: Uint8Array,
  putUrl: string,
  executeCode: ExecuteCode,
  publicUrl: string,
  onProgress?: (fraction: number) => void,
): Promise<number> {
  await prepareKernel(executeCode, publicUrl);

  const rawPath = rawPathFor(stem);
  await runPython(
    executeCode,
    `
import base64, os
open(${JSON.stringify(rawPath)}, 'wb').close()
print('materialise: staging %d bytes' % ${packed.length})
`,
  );

  for (let at = 0; at < packed.length; at += CHUNK_BYTES) {
    const chunk = toBase64(packed.subarray(at, at + CHUNK_BYTES));
    await runPython(
      executeCode,
      `
with open(${JSON.stringify(rawPath)}, 'ab') as _f:
    _f.write(base64.b64decode('${chunk}'))
`,
    );
    onProgress?.(Math.min(1, (at + CHUNK_BYTES) / packed.length));
  }

  const channels = plane.bands.length;
  // The transpose is spelled out rather than left to `normalise_axes`, which
  // guesses a leading channel axis from the shape and would guess wrong on a
  // narrow image (its test is `shape[0] < shape[1]`). Here the layout is known
  // exactly, because this code packed it. Only the trailing-singleton squeeze
  // is borrowed, so a one-channel image round-trips as 2-D.
  //
  // `ascontiguousarray` is not cosmetic: `frombuffer` hands back a read-only
  // view, and the pyramid builder writes into its levels.
  //
  // `_pyfetch` resolves once the object is stored, so a non-2xx here means the
  // bytes did not land and the manifest must not be flipped. The broker
  // re-checks independently in phase 2; this is the early, specific failure.
  //
  // The pyramid is built once and handed to `encode_ome_tiff_levels`. Calling
  // `encode_ome_tiff` and counting `build_pyramid` separately would box-average
  // every level twice, in WebAssembly, for a number the encoder already has.
  const output = await runPython(
    executeCode,
    `
import numpy as np
with open(${JSON.stringify(rawPath)}, 'rb') as _f:
    _raw = _f.read()
_arr = np.frombuffer(_raw, dtype=${JSON.stringify(plane.dtype)})
_arr = _arr.reshape((${channels}, ${plane.height}, ${plane.width}))
_arr = np.ascontiguousarray(np.transpose(_arr, (1, 2, 0)))
if _arr.shape[2] == 1:
    _arr = _arr[:, :, 0]
del _raw
_pyramid = build_pyramid(_arr)
_levels = len(_pyramid)
_body = encode_ome_tiff_levels(_pyramid)
del _pyramid
_resp = await _pyfetch(${JSON.stringify(putUrl)}, method='PUT', body=_body)
if _resp.status >= 300:
    raise RuntimeError('Upload rejected with HTTP %d' % _resp.status)
del _body, _arr
os.remove(${JSON.stringify(rawPath)})
print('MATERIALISE_LEVELS=%d' % _levels)
`,
  );

  const levels = /MATERIALISE_LEVELS=(\d+)/.exec(output);
  if (!levels) {
    throw new Error('The kernel did not report a pyramid; the copy was not written.');
  }
  return Number(levels[1]);
}

/** The two broker calls this needs, so callers can pass a test double. */
export interface MaterialiseService {
  startMaterialiseImage(stem: string): Promise<MaterialiseResult>;
  finishMaterialiseImage(stem: string, levels: number): Promise<{ already: boolean }>;
}

export interface MaterialiseOptions {
  service: MaterialiseService;
  /** The already-open source. Reused rather than reopened, so the levels the
   *  user is looking at are the levels that get copied. */
  handle: ImageSourceHandle;
  stem: string;
  executeCode: ExecuteCode;
  /** `process.env.PUBLIC_URL`, threaded in so this module stays testable. */
  publicUrl: string;
  onProgress?: (fraction: number) => void;
}

export type MaterialiseOutcome =
  | { status: 'done'; levels: number }
  /** Another annotator got there first, or the image was never remote. */
  | { status: 'already' }
  /** Not attempted, and correctly so. Not an error: the image stays remote,
   *  which means it stays browsable and annotatable. Only training is off. */
  | { status: 'skipped'; reason: string };

/**
 * Write the artifact's own copy of a remote image, once (design §8).
 *
 * The full sequence, and why it is ordered this way:
 *
 *   1. `startMaterialiseImage` decides. The broker owns the "is this already
 *      done, is it small enough, is it narrow enough" questions because the
 *      manifest is the only place that can answer them without a race, and it
 *      reads past its own cache to do so.
 *   2. Read level 0 natively and pack it.
 *   3. Encode and PUT from the kernel.
 *   4. `finishMaterialiseImage` flips the manifest, after the broker has
 *      re-read the object's first bytes for itself.
 *
 * Bailing out between 1 and 3 is safe and leaves no debris: a presigned PUT
 * that is minted and never used does not appear in the artifact's file
 * listing, so the manifest cannot end up describing a file that is not there.
 *
 * Runs one at a time per tab (see `enqueue`). The capability check is the one
 * thing done ahead of the queue: it is a property of the handle, costs
 * nothing, and answers "no" for every image that already lives in the
 * artifact, which is most of them.
 */
export async function materialiseImage(
  opts: MaterialiseOptions,
): Promise<MaterialiseOutcome> {
  // Absent on every source that already lives in the artifact, which is the
  // majority of them. Checking the capability rather than the manifest state
  // keeps this honest if a future format grows a native read.
  if (!opts.handle.readLevelNative) {
    return { status: 'skipped', reason: 'This image already has a copy in the dataset.' };
  }
  return enqueue(() => materialiseOne(opts));
}

async function materialiseOne(opts: MaterialiseOptions): Promise<MaterialiseOutcome> {
  const { service, handle, stem, executeCode, publicUrl, onProgress } = opts;

  const start = await service.startMaterialiseImage(stem);
  if (start.already) return { status: 'already' };

  // Re-checked rather than narrowed across the queue boundary: the caller
  // proved it before enqueuing, but this function has to stand on its own.
  if (!handle.readLevelNative) {
    return { status: 'skipped', reason: 'This image already has a copy in the dataset.' };
  }
  const plane = await handle.readLevelNative(0);
  const packed = packBands(plane);
  if (packed.length > start.max_bytes) {
    // The broker sized this from the dimensions the manifest recorded at
    // import. If the store disagrees with its own metadata, the real bytes
    // win and nothing is uploaded.
    return {
      status: 'skipped',
      reason:
        `'${stem}' is ${Math.round(packed.length / 1024 / 1024)} MB at full ` +
        `resolution, over the ${Math.round(start.max_bytes / 1024 / 1024)} MB ` +
        `the browser can copy. It stays annotatable as a remote image.`,
    };
  }

  const levels = await encodeAndUploadOmeTiff(
    stem,
    plane,
    packed,
    start.put_url,
    executeCode,
    publicUrl,
    onProgress,
  );
  const result = await service.finishMaterialiseImage(stem, levels);
  return result.already ? { status: 'already' } : { status: 'done', levels };
}
