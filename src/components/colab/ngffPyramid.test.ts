/**
 * The NGFF reader driven end to end, with zarrita faked and nothing else.
 *
 * `ngffLayout.ts` is pure and heavily tested on its own, which left a gap this
 * file closes: every one of those functions can be right while the reader that
 * composes them is wrong, because the composition is where the channel axis is
 * located, where the selection is built, and where the truncation guard is
 * either called or not. A reviewer found exactly that, so the cases here run
 * the real `openNgffPyramid` and fake only the I/O.
 *
 * What is faked: `FetchStore`, `open`, `get` and `slice`. What is NOT faked:
 * `parseMultiscales`, `axisRoles`, `levelDims`, `orderPyramidLevels`,
 * `planeSelection`, `chunkToBands`, `assertNoChannelTruncation` and the
 * channel-axis arithmetic in `readBands`.
 *
 * The fake `get` is a real strided reader rather than a stub returning a fixed
 * buffer: it honours the pins and slices it is given and drops the pinned
 * dimensions, which is the behaviour the reader's channel-axis arithmetic
 * depends on. A stub that ignored the selection would make these cases pass
 * for a reader that built the wrong one.
 */

const mockZarr: { open?: (...a: any[]) => any; get?: (...a: any[]) => any } = {};

jest.mock('zarrita', () => ({
  FetchStore: function FetchStore(this: any, storeRoot: string) {
    this.storeRoot = storeRoot;
  },
  slice: (start: number, stop: number) => ({ kind: 'slice', start, stop }),
  open: (...args: any[]) => mockZarr.open!(...args),
  get: (...args: any[]) => mockZarr.get!(...args),
}));

// eslint-disable-next-line import/first
import { openNgffPyramid } from './ngffPyramid';

type Axis = { name: string; type?: string };

/** One array's worth of a store: its shape and the value at each index. */
interface FakeArray {
  shape: number[];
  valueAt: (index: number[]) => number;
}

/**
 * Read a selection out of a fake array, C-contiguous, pinned dimensions gone.
 *
 * This is the part that makes the test meaningful. `readBands` works out where
 * the channel axis ended up by counting how many pinned dimensions preceded
 * it, so a reader that pinned the channel axis by mistake gets a plane of the
 * wrong rank here rather than a quietly identical answer.
 */
function readSelection(array: FakeArray, selection: any[]) {
  const ranges = selection.map((entry, dim) => {
    if (typeof entry === 'number') return { pinned: true, items: [entry] };
    if (entry && typeof entry === 'object' && entry.kind === 'slice') {
      const items: number[] = [];
      for (let i = entry.start; i < entry.stop; i++) items.push(i);
      return { pinned: false, items };
    }
    return { pinned: false, items: Array.from({ length: array.shape[dim] }, (_, i) => i) };
  });

  const kept = ranges.map((range, dim) => ({ range, dim })).filter(({ range }) => !range.pinned);
  const shape = kept.map(({ range }) => range.items.length);
  const stride: number[] = [];
  let acc = 1;
  for (let d = shape.length - 1; d >= 0; d--) {
    stride[d] = acc;
    acc *= shape[d];
  }

  const count = shape.reduce((a, b) => a * b, 1);
  const data = new Uint8Array(count);
  for (let flat = 0; flat < count; flat++) {
    let rest = flat;
    const full = ranges.map((range) => (range.pinned ? range.items[0] : 0));
    kept.forEach(({ dim }, k) => {
      const here = Math.floor(rest / stride[k]);
      rest -= here * stride[k];
      full[dim] = ranges[dim].items[here];
    });
    data[flat] = array.valueAt(full);
  }
  return { data, shape, stride };
}

/** Install a fake store with the given axes and levels, and return the opener. */
function installStore(axes: Axis[], arrays: FakeArray[]) {
  const attrs = {
    multiscales: [
      {
        axes,
        datasets: arrays.map((_, i) => ({ path: String(i) })),
      },
    ],
  };
  mockZarr.open = async (location: any, opts: any) => {
    if (opts?.kind === 'group') {
      return { attrs, resolve: (path: string) => ({ path }) };
    }
    const array = arrays[Number(location.path)];
    if (!array) throw new Error(`no array at ${location.path}`);
    return { shape: array.shape, path: location.path };
  };
  mockZarr.get = async (array: any, selection: any[]) =>
    readSelection(arrays[Number(array.path)], selection);
}

const CYX: Axis[] = [
  { name: 'c', type: 'channel' },
  { name: 'y', type: 'space' },
  { name: 'x', type: 'space' },
];

/** `channels` planes of 4x4, where every pixel of channel k reads k + 1. */
const wideArray = (channels: number): FakeArray => ({
  shape: [channels, 4, 4],
  valueAt: (index) => index[0] + 1,
});

describe('openNgffPyramid, through to the guard', () => {
  afterEach(() => {
    mockZarr.open = undefined;
    mockZarr.get = undefined;
  });

  it('copies a store that fits, keeping each channel distinct', async () => {
    // The control. Without it the refusal below could be coming from any
    // failure in the path rather than from the channel count.
    installStore(CYX, [wideArray(3)]);
    const pyramid = await openNgffPyramid('https://example.invalid/s.zarr');
    const plane = await pyramid.readLevelNative!(0);
    expect(plane.dtype).toBe('uint8');
    expect(plane.width).toBe(4);
    expect(plane.height).toBe(4);
    expect(plane.bands).toHaveLength(3);
    expect(Array.from(plane.bands[0] as Uint8Array)).toEqual(new Array(16).fill(1));
    expect(Array.from(plane.bands[2] as Uint8Array)).toEqual(new Array(16).fill(3));
  });

  it('REFUSES a store with more channels than materialisation can copy', async () => {
    // The guard is unit tested on its own. This is the first case that proves
    // the reader actually reaches it with the store's real channel count,
    // which is the only thing that stops a 10-channel store being copied as a
    // 4-channel one.
    installStore(CYX, [wideArray(10)]);
    const pyramid = await openNgffPyramid('https://example.invalid/s.zarr');
    await expect(pyramid.readLevelNative!(0)).rejects.toThrow(/10 channels/);
    await expect(pyramid.readLevelNative!(0)).rejects.toThrow(/at most 4/);
  });

  it('DRAWS the channels of a store whose channel axis is not named "c"', async () => {
    // The reader, not the resolver. A review found the resolver asserted on
    // its own and the viewer's path never exercised with such a store, which
    // leaves the claim "the viewer draws the multichannel image" resting on
    // an inference across two modules.
    //
    // The fixture is the one that discriminates: a SPATIAL axis called `c`
    // beside a CHANNEL axis called `ch`. A name-only resolver picks the
    // spatial one, pins the real channel axis, and hands back FOUR bands of
    // the wrong dimension; the type-first one picks `ch` and hands back the
    // store's three channels.
    const TRAP: Axis[] = [
      { name: 'c', type: 'space' },
      { name: 'ch', type: 'channel' },
      { name: 'y', type: 'space' },
      { name: 'x', type: 'space' },
    ];
    installStore(TRAP, [
      // 4 spatial `c` slices, 3 channels, 8x8. Every voxel reads as its
      // CHANNEL index plus one, so a band is attributable to one channel.
      { shape: [4, 3, 8, 8], valueAt: (index) => index[1] + 1 },
    ]);
    const pyramid = await openNgffPyramid('https://example.invalid/trap.zarr');
    const plane = await pyramid.readLevelNative!(0);

    expect(plane.bands).toHaveLength(3);
    expect(plane.width).toBe(8);
    expect(plane.height).toBe(8);
    // Each band is one CHANNEL, which is what says the right dimension was
    // read: pinning `ch` instead would make every band identical.
    expect(Array.from(plane.bands[0] as Uint8Array)).toEqual(new Array(64).fill(1));
    expect(Array.from(plane.bands[1] as Uint8Array)).toEqual(new Array(64).fill(2));
    expect(Array.from(plane.bands[2] as Uint8Array)).toEqual(new Array(64).fill(3));
  });

  it('reports the levels it found, largest first', async () => {
    installStore(CYX, [
      { shape: [3, 4, 4], valueAt: (i) => i[0] + 1 },
      { shape: [3, 2, 2], valueAt: (i) => i[0] + 1 },
    ]);
    const pyramid = await openNgffPyramid('https://example.invalid/s.zarr');
    expect(pyramid.levels).toEqual([
      { width: 4, height: 4 },
      { width: 2, height: 2 },
    ]);
  });

  it('reads a region rather than the whole level when given one', async () => {
    // Proves the selection reaches `get` as slices: the fake reader honours
    // them, so a reader that ignored the region would hand back 4x4 here.
    installStore(CYX, [{ shape: [3, 4, 4], valueAt: (i) => i[1] * 4 + i[2] }]);
    const pyramid = await openNgffPyramid('https://example.invalid/s.zarr', undefined, {
      x: 1,
      y: 2,
      width: 2,
      height: 2,
    });
    const plane = await pyramid.readLevelNative!(0);
    expect(plane.width).toBe(2);
    expect(plane.height).toBe(2);
    // Rows 2 and 3, columns 1 and 2 of the 4x4 grid.
    expect(Array.from(plane.bands[0] as Uint8Array)).toEqual([9, 10, 13, 14]);
  });
});
