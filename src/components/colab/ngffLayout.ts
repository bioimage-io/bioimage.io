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

/** The axis type OME-NGFF gives the channel dimension. */
const NGFF_CHANNEL_AXIS_TYPE = 'channel';

/**
 * One axis's declared type, normalised the way the service normalises it, or
 * `null` for "not declared".
 *
 * MIRRORS `str(a["type"]).lower() if a["type"] else None`, which the service
 * applies while PARSING, before its resolver ever sees a type. A review caught
 * me comparing the raw string: I had checked my rule against the service's
 * resolver alone and not against parse-then-resolve, so a store typed
 * `"Channel"` gave the service a channel axis and gave this browser none. The
 * trainer would have read those channels while the viewer pinned the axis and
 * drew single-channel planes, which is the annotate-one-train-on-another split
 * this whole change exists to prevent.
 *
 * Python's truthiness is mirrored too, not just the lowercasing: an empty
 * string, a zero, a false, an empty list and an empty dict are all "not
 * declared" there, and only `null`/`undefined` would be here by default. A
 * NON-EMPTY non-string is "declared" in both, which is the part that matters;
 * the string it stringifies to differs between the two languages and cannot
 * matter, because nothing but the literal `channel` is ever compared equal.
 */
function declaredAxisType(raw: unknown): string | null {
  if (raw === null || raw === undefined) return null;
  if (typeof raw === 'string') return raw === '' ? null : raw.toLowerCase();
  if (typeof raw === 'number') return raw === 0 || Number.isNaN(raw) ? null : String(raw).toLowerCase();
  if (typeof raw === 'boolean') return raw ? 'true' : null;
  if (Array.isArray(raw)) return raw.length === 0 ? null : 'declared';
  if (typeof raw === 'object') return Object.keys(raw as object).length === 0 ? null : 'declared';
  return String(raw).toLowerCase();
}

/**
 * The channel axis index, by TYPE where any type is declared, by NAME only
 * where none is. `-1` when there is no channel axis.
 *
 * MIRRORS `ngff_channel_axis` in the service's `broker_core.py`, deliberately
 * and including the normalisation the service applies BEFORE its resolver
 * runs: see `declaredAxisType`. The viewer and the trainer both take their
 * channel axis from an answer shaped like this one, and the whole point of
 * this change is that they agree. My first version compared the raw string,
 * having checked the resolver without its parse step, and a review measured
 * the divergence that produced on a store typed `"Channel"`.
 *
 * THE TYPE IS THE AUTHORITY AND THE NAME IS THE FALLBACK, and the fallback is
 * reached only when the store declares NO types at all. Nothing in the spec
 * requires a channel axis to be called `c`, so reading only the name reported
 * a store that called it `ch` as having none.
 *
 * "Where no type is declared" is the condition, and "where no axis is typed
 * `channel`" is NOT. A review of the broker's half measured the difference and
 * it is the whole rule: under the looser condition a store declaring every
 * axis `space`, which says in terms that it has no channels, still had its
 * `c`-named SPATIAL axis reported as channels. A declared type that is not
 * `channel` is an answer, not a gap.
 *
 * A store that types only SOME of its axes counts as type-declaring. That is
 * the strict reading, and its cost is that such a store reports no channel
 * axis, which makes a multichannel crop REFUSE: loud and visible. The cost of
 * the lax reading is reporting a spatial axis as channels, which is silent and
 * gives the viewer and the trainer the same wrong answer. A refusal is the one
 * to prefer.
 *
 * MORE THAN ONE axis typed `channel` is REFUSED rather than guessed. The spec
 * allows at most one, so such a store is malformed, and picking the first
 * would be the silent wrong answer this function exists to stop.
 */
export function ngffChannelAxis(axes: NgffAxis[]): number {
  const types = axes.map((a) => declaredAxisType(a.type));
  const typed: number[] = [];
  types.forEach((t, i) => {
    if (t === NGFF_CHANNEL_AXIS_TYPE) typed.push(i);
  });
  if (typed.length > 1) {
    const named = typed.map((i) => `"${axes[i].name}"`).join(', ');
    throw new Error(
      `This OME-Zarr store declares ${typed.length} axes of type 'channel' (${named}). `
      + 'OME-NGFF allows at most one, so which dimension holds the channels cannot be '
      + "decided. Fix the store's axis metadata.",
    );
  }
  if (typed.length === 1) return typed[0];
  // The store declares types and none of them is `channel`. That is an answer:
  // it has no channel axis, and the name is not consulted.
  if (types.some((t) => t !== null)) return -1;
  // No types at all. `axes` was optional before OME-NGFF v0.4 and the order
  // was a convention about names, so the name is the only evidence there is.
  const names = axes.map((a) => (a.name || '').toLowerCase());
  return names.indexOf('c');
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
  // By type where any is declared, by name only where none is, and REFUSING a
  // store that declares two channel axes. See `ngffChannelAxis`, which mirrors
  // the broker's function of the same shape so the viewer and the trainer
  // cannot disagree about which dimension holds the channels.
  let c = ngffChannelAxis(axes);

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
 * A plane recorded against ONE reference level, with that level's shape.
 *
 * Both halves are needed together. An index alone cannot be placed on another
 * level: "z index 4" means one slice out of nine on level 0 and a different
 * slice out of four on a level that halved z, so the size it was measured
 * against travels with it.
 *
 * `shape` is the broker's `level0_shape`, which is the shape of
 * `dataset_paths[0]`. That is also the array the TRAINING reader opens as
 * level 0, so deriving from it makes the viewer agree with what training will
 * actually read. It is deliberately not "the largest level": this module
 * orders levels by size because `datasets[]` order is only a convention, and
 * on a store that lists its datasets coarsest-first those two rules disagree
 * about which level is level 0. Following the broker keeps the record, the
 * display and the training read on one definition.
 */
export interface RecordedPlanes {
  /** Axis NAME to index, as recorded at import. */
  planes: Record<string, number>;
  /** Shape of the level those indices were measured against. */
  shape: number[];
}

/**
 * Where a recorded plane lands on the level being read, or `null` when the
 * record says nothing about this axis.
 *
 * The same proportional mapping `regionAtLevel` does for y and x, applied to
 * an indexed axis. Identity whenever the axis is not resampled, which is every
 * store that pyramids only in y and x, so the common case is untouched.
 *
 * Both directions work. If the reference level is the COARSER one, the ratio
 * is above 1 and the index scales up, which is what a store listing its
 * datasets coarsest-first needs.
 */
export function planeAtLevel(
  recorded: RecordedPlanes | null | undefined,
  axisName: string,
  dim: number,
  levelSize: number,
  /**
   * The rank of the array being read. Checked HERE, at the point of use, and
   * not only in `assertPlaneIsResolvable`: that function returns early when no
   * axis is resampled, so on a pyramid that resamples nothing a malformed
   * record reached the selection unexamined and produced slice 0 for a
   * recorded slice 4, silently. A guard that runs after an early return is not
   * a guard for the path that took it.
   *
   * Optional only so existing callers that cannot know the rank keep
   * compiling; every caller in this module passes it.
   */
  rank?: number,
): number | null {
  if (!recorded) return null;
  // A record of the wrong rank describes some other layout, and reading it at
  // this dimension answers for whichever axis happens to sit there.
  if (typeof rank === 'number' && (recorded.shape?.length ?? -1) !== rank) return null;
  const entry = Object.entries(recorded.planes || {}).find(
    ([name]) => name.toLowerCase() === axisName,
  );
  if (!entry) return null;
  const index = entry[1];
  if (typeof index !== 'number' || !Number.isFinite(index)) return null;

  // NO DEFAULT for the reference size, and that is the whole point of this
  // line. It used to read `Number(recorded.shape?.[dim]) || 1`, so a record
  // whose shape was empty or of the wrong rank silently became "one slice at
  // this axis", and the mapping then returned index 8 of 9 for a recorded
  // slice 4. A wrong slice with no error is the exact failure this module
  // exists to prevent, so an unusable reference yields NO ANSWER and the
  // caller refuses instead.
  const reference = recorded.shape?.[dim];
  if (typeof reference !== 'number' || !Number.isInteger(reference) || reference < 1) return null;
  const referenceSize = reference;
  const size = Math.max(1, levelSize);
  if (referenceSize === size) return clamp(Math.floor(index), 0, size - 1);

  // The rounding DIFFERS BY DIRECTION, and picking one for both is wrong in
  // the other. Write the recorded slice as the half-open range
  // [index, index + 1) in reference coordinates, which in this level's
  // coordinates is [index*s/r, (index+1)*s/r).
  //
  //  - target COARSER (s < r): one slice here stands for several reference
  //    slices, so the honest pick is the slice whose range CONTAINS the
  //    recorded one. That is the floor. Measured: 9 reference slices down to
  //    4, recorded 4, floor gives 1, whose range 2.25 to 4.5 contains 4. The
  //    ceiling gives 2, whose range 4.5 to 6.75 does not.
  //  - target FINER (s > r): the recorded slice spans several slices here, so
  //    the pick must be INSIDE it. That is the ceiling. Measured: 4 reference
  //    slices up to 9, recorded 1, the ceiling gives 3, which sits at
  //    reference 1.33, inside slice 1. The floor gives 2, which sits at
  //    reference 0.89 and so shows a slice the record does not name.
  const scaled = (index * size) / referenceSize;
  return clamp(size < referenceSize ? Math.floor(scaled) : Math.ceil(scaled), 0, size - 1);
}

/**
 * The indexed axes whose size DIFFERS between levels, by name.
 *
 * These are the axes for which "which slice am I showing" has no single
 * answer across a pyramid: level 0's slice 4 of 9 and level 1's slice 4 of 4
 * are different pixels. For every other axis a plane index means the same
 * thing at every level, which is why a store pyramided only in y and x needs
 * none of this.
 *
 * Exported so the reader can REFUSE on one rather than guess, and so that
 * refusal can be tested without a store.
 */
export function resampledIndexedAxes(
  shapes: number[][],
  roles: AxisRoles,
  axes: NgffAxis[],
): string[] {
  const out: string[] = [];
  for (const d of roles.indexed) {
    const sizes = new Set(shapes.map((shape) => Math.max(1, shape[d] ?? 1)));
    if (sizes.size > 1) out.push(axes[d]?.name || `axis ${d}`);
  }
  return out;
}

/**
 * Refuse to draw a multi-plane pyramid whose plane nobody recorded.
 *
 * The case this exists for, and it is the row's own defect wearing its last
 * disguise: a store that downsamples z, opened WITHOUT the plane recorded at
 * import. Every level then pins its own middle slice, the annotation is drawn
 * on one slice, the record names another, and the run still reports success
 * having paired polygons with different pixels. Nothing downstream can notice,
 * which is exactly why this has to be said here.
 *
 * It is deliberately narrow. With a record, the plane is derived and there is
 * nothing to refuse. Without one, it fires only when an indexed axis is
 * actually resampled, so every store pyramided in y and x alone, which is
 * almost all of them, opens exactly as before.
 */
export function assertPlaneIsResolvable(
  shapes: number[][],
  roles: AxisRoles,
  axes: NgffAxis[],
  recorded?: RecordedPlanes | null,
): void {
  const resampled = resampledIndexedAxes(shapes, roles, axes);
  if (resampled.length === 0) return;
  // A record counts only if it RESOLVES on every axis that is resampled, at
  // every level. "A record is present" was the wrong test: a shape of the
  // wrong rank, or an empty one, is present and names nothing, and under the
  // old reading it both skipped this refusal and silently produced an index.
  // So the question asked here is the one that matters, which is whether the
  // record can actually answer for the axes that need answering.
  // The rank is NOT re-checked here. `planeAtLevel` refuses a record of the
  // wrong rank at the point of use, so the resolvability probe below already
  // answers false for one, and a second copy of the rule here was decoration:
  // a mutation that removed it changed nothing, which is how it was found.
  if (recorded && Object.keys(recorded.planes || {}).length > 0) {
    const resolvesEverywhere = roles.indexed.every((d) => {
      const name = (axes[d]?.name || '').toLowerCase();
      if (!resampled.some((axis) => axis.toLowerCase() === name)) return true;
      return shapes.every(
        (shape) => planeAtLevel(recorded, name, d, Math.max(1, shape[d] ?? 1), shape.length) !== null,
      );
    });
    if (resolvesEverywhere) return;
  }
  throw new Error(
    `This source's ${resampled.join(' and ')} axis is sampled differently at each ` +
      'resolution, and no usable slice was recorded for it, so there is no way to tell ' +
      'which slice an annotation would be drawn on. Re-import the source with a service ' +
      'that records the slice (annotation broker v0.12.6 or newer).',
  );
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
 *
 * *recorded* OVERRIDES the middle-slice rule, and that is what keeps the
 * viewer and the saved record describing the same pixels. The record is made
 * once, against the store's reference level, and every level then DERIVES its
 * own index from it with `planeAtLevel` below. Without this the two were
 * computed independently: the record from level 0, the drawing from whichever
 * level the canvas asked for, and on a pyramid that downsamples z those are
 * different slices. That is this module's own defect one level down, and it
 * was invisible to a test that computed both from the same shape.
 */
export function planeSelection(
  shape: number[],
  roles: AxisRoles,
  axes: NgffAxis[],
  region?: PixelRegion | null,
  recorded?: RecordedPlanes | null,
): (number | null | AxisRange)[] {
  const selection: (number | null | AxisRange)[] = shape.map(() => null);
  for (const d of roles.indexed) {
    const name = (axes[d]?.name || '').toLowerCase();
    const size = Math.max(1, shape[d]);
    const fromRecord = planeAtLevel(recorded, name, d, size, shape.length);
    selection[d] = fromRecord !== null ? fromRecord : name === 'z' ? Math.floor(size / 2) : 0;
  }
  if (region) {
    selection[roles.y] = [region.y, region.y + region.height];
    selection[roles.x] = [region.x, region.x + region.width];
  }
  return selection;
}

/**
 * Which slice of each non-spatial axis the viewer is DISPLAYING, by axis name.
 *
 * This is the record that makes a region annotation on a z-stack or a time
 * series trainable at all. `planeSelection` above pins z to the middle slice,
 * so an annotation drawn on a 9-slice stack describes slice 4; the training
 * reader, given no plane, used to read slice 0. Nothing downstream could
 * notice: the mask rasterises non-empty, the shapes agree, and the run reaches
 * COMPLETED having paired the polygons with a different slice's pixels. The
 * reader now refuses rather than assuming 0, which turns a silently wrong
 * model into a legible error, and this function is what supplies the missing
 * answer.
 *
 * DERIVED FROM `planeSelection`, deliberately, rather than reimplementing the
 * middle-slice rule. The record has to say what the viewer SHOWS, and two
 * copies of that rule would be one copy and one slowly-diverging claim. Read
 * the indices back out of the same array the reads are sliced with and they
 * cannot disagree.
 *
 * `undefined` rather than `{}` when there is nothing to record, because an
 * absent plane and an empty one must not mean two different things to the
 * broker, which normalises `{}` to "none given" for the same reason.
 *
 * SINGLETON axes are omitted. Index 0 of a one-element axis is the only slice
 * it has, so recording it tells a reader nothing it could act on, and the
 * reader only ever asks about an axis larger than one. That also keeps a plain
 * 2-D store recording no plane at all, exactly as before this existed.
 *
 * Only Y, X and C are excluded, via `roles.indexed`, and that matches what the
 * broker will accept: it REFUSES a plane naming y, x or the channel axis,
 * because y and x are the crop and the channel axis is read whole, so such a
 * record would say one thing while training did another.
 */
export function displayedPlanes(
  shape: number[],
  roles: AxisRoles,
  axes: NgffAxis[],
): Record<string, number> | undefined {
  const selection = planeSelection(shape, roles, axes);
  const planes: Record<string, number> = {};
  const seen = new Set<string>();

  for (const d of roles.indexed) {
    if (Math.max(1, shape[d]) <= 1) continue;
    const name = (axes[d]?.name || '').trim();
    if (!name) {
      throw new Error(
        `This source's axis ${d} has ${shape[d]} slices but no name, so which ` +
          'slice an annotation was drawn on cannot be recorded. Training refuses ' +
          'a source with an unrecorded plane rather than guessing one.',
      );
    }
    // Two non-singleton axes sharing a name cannot both be described by a
    // mapping keyed on names: one would overwrite the other, and the record
    // would then name a slice of an axis nobody meant. Pathological metadata
    // rather than a layout anyone writes on purpose, but it is cheaper to
    // refuse it here than to let it choose a slice by key collision.
    if (seen.has(name)) {
      throw new Error(
        `This source names more than one axis ${name}, so a plane cannot say ` +
          'which of them a slice index belongs to.',
      );
    }
    seen.add(name);

    const index = selection[d];
    if (typeof index !== 'number') {
      // Not reachable while `planeSelection` pins every axis in
      // `roles.indexed` to a number, which it does on the line above. It is
      // here because that coupling is exactly what this function depends on:
      // were a range or a null ever to appear at a pinned axis, the
      // alternative to this throw is writing a non-index into the record and
      // discovering it as a training failure much later.
      throw new Error(
        `This source's axis ${name} is displayed as a range rather than one ` +
          'slice, so a single plane index cannot describe it.',
      );
    }
    planes[name] = index;
  }

  return Object.keys(planes).length > 0 ? planes : undefined;
}

/**
 * The layout a broker probe reports, as much of it as a plane needs.
 *
 * Structural on purpose: this module stays free of the broker client, which is
 * what lets its arithmetic be unit-tested without a server. Every field is
 * optional because a broker older than v0.12.6 reports none of them.
 */
export interface ProbeLayout {
  /** Axis NAMES in the store's own order. */
  axes?: string[] | null;
  /** Role to axis INDEX. */
  axis_roles?: { y: number; x: number; c: number | null } | null;
  /** Level 0's dimensions, in the store's own axis order. */
  level0_shape?: number[] | null;
}

/**
 * `displayedPlanes` for what a probe reported, or `undefined` when the probe
 * did not describe its layout.
 *
 * The roles come from the PROBE rather than from this module's own
 * `axisRoles`, so the axis set a plane may name is the same one the broker
 * validates against. If the two disagreed about which axis is the channel, a
 * record this side thought legal would be refused there, and the import would
 * fail on a store that is perfectly importable.
 *
 * An old broker yields `undefined` rather than an error. Without axis names
 * and a shape there is no way to tell a z-stack from a 2-D image here, so
 * there is nothing to refuse on; such a source records no plane and the
 * training reader refuses it then, which is where the information to refuse
 * on exists. That is also the behaviour every import had before this.
 */
export function displayedPlanesForProbe(
  layout: ProbeLayout | null | undefined,
): Record<string, number> | undefined {
  const names = layout?.axes;
  const shape = layout?.level0_shape;
  const probeRoles = layout?.axis_roles;
  if (!Array.isArray(names) || !Array.isArray(shape) || !probeRoles) return undefined;
  if (names.length !== shape.length) return undefined;

  const { y, x, c } = probeRoles;
  const indexed: number[] = [];
  for (let d = 0; d < shape.length; d++) {
    if (d !== y && d !== x && d !== c) indexed.push(d);
  }
  return displayedPlanes(
    shape,
    { y, x, c: typeof c === 'number' ? c : null, indexed },
    names.map((name) => ({ name: String(name) })),
  );
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
 * profile goes.
 *
 * The cap is SILENT by design, which is correct for display and dangerous for
 * materialisation. A review found that the comment here used to claim the
 * broker refuses anything wider before it gets here, so no caller could reach
 * a silent truncation. That is not a safe thing to rely on: the size check
 * counts a store with no omero metadata as ONE channel, so a 10-channel store
 * without that block passes it and arrives anyway. The materialisation caller
 * therefore checks for itself, with `assertNoChannelTruncation` below.
 */
/**
 * Refuse a materialisation that would quietly drop channels.
 *
 * `chunkToBands` caps the bands it returns, so a copy of a wider store would
 * be a subset of it while claiming to be a copy. A model trained on that
 * artifact would learn from fewer channels than the source has, and nothing
 * anywhere would say so. Refusing is the only honest option, and it is checked
 * against the ARRAY SHAPE rather than omero metadata, which undercounts.
 *
 * The message names a remedy the page can actually carry out. It used to
 * offer "a region or a channel subset", and neither was true: a region keeps
 * every channel, so it changes nothing here, and there is no channel-subset
 * control anywhere in the annotator. Naming a control that was never built
 * sends the reader hunting for it.
 *
 * Separate from the caller so it can also be tested without standing up a
 * zarr store. `ngffPyramid.test.ts` covers the other half, driving a wide
 * store through the reader into this guard, because every function here can
 * be right while the composition that reaches them is wrong.
 */
export function assertNoChannelTruncation(
  storeChannels: number,
  bandCount: number,
  maxBands: number,
): void {
  if (!Number.isFinite(storeChannels) || storeChannels <= bandCount) return;
  throw new Error(
    `This OME-Zarr store has ${storeChannels} channels, and the annotator can copy at most `
    + `${maxBands}, so a copy would be missing channels the original has. Importing a region `
    + 'does not change that, because a region keeps every channel. To train on these pixels, '
    + `link a store written with at most ${maxBands} channels.`,
  );
}

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
  return DTYPE_ITEMSIZE[dtypeSuffix(dtype)] || 0;
}

/** Both dtype spellings reduced to their kind-and-width suffix, e.g. `"u2"`. */
function dtypeSuffix(dtype: string | null | undefined): string {
  const raw = (dtype || '').toLowerCase().replace(/^[<>|=]/, '');
  if (raw === 'bool') return 'b1';
  const named = raw.match(/^(u?int|float)(\d+)$/);
  const kinds: Record<string, string> = { int: 'i', uint: 'u', float: 'f' };
  return named ? `${kinds[named[1]]}${Number(named[2]) / 8}` : raw;
}

/** How each dtype is said out loud, in the ImageJ idiom a biologist reads. */
const DTYPE_LABEL: Record<string, string> = {
  b1: 'binary',
  u1: '8-bit', i1: '8-bit signed',
  u2: '16-bit', i2: '16-bit signed',
  u4: '32-bit', i4: '32-bit signed',
  u8: '64-bit', i8: '64-bit signed',
  f2: '16-bit float', f4: '32-bit float', f8: '64-bit float',
};

/**
 * A dtype as a phrase to show a user, e.g. `"<u2"` and `"uint16"` both as
 * `"16-bit"`.
 *
 * Neither spelling the stores use is meant for human eyes: `"<u2"` is numpy's
 * little-endian-unsigned-2-byte notation, which says nothing to a microscopist
 * reading "271 x 275 pixels, 3 levels, <u2". Unsigned is the unmarked case
 * here because it is what imaging data almost always is, matching how ImageJ
 * names the same thing.
 *
 * Anything unrecognised is returned as it arrived rather than dropped: a store
 * with an exotic dtype should still show *something*, and a blank where the
 * depth belongs would read as a bug.
 */
export function describeDtype(dtype: string | null | undefined): string {
  const raw = (dtype || '').trim();
  return DTYPE_LABEL[dtypeSuffix(raw)] || raw;
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
