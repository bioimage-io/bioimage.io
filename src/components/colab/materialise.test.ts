/**
 * Tests for the materialisation path (`materialise.ts`).
 *
 * Two halves, tested differently.
 *
 * The byte handling (`bandBytes`, `packBands`, `toBase64`) is pure and is
 * tested directly, because it is the part that fails *silently*: pack the
 * bands in the wrong order or ship a view's whole backing buffer instead of
 * its window, and nothing throws. Python reshapes whatever arrives and the
 * OME-TIFF comes out sheared, or comes out fine except that it is somebody
 * else's pixels. Neither is visible until a model has trained on it.
 *
 * The orchestration (`materialiseImage`) is tested against a fake broker and a
 * fake kernel, because what matters there is the *sequence*: nothing may be
 * uploaded before the broker has agreed, and the manifest may only be flipped
 * after the upload. The encode itself is Python and is covered by the
 * annotation-broker's own suite.
 */

import { bandBytes, materialiseImage, packBands, rawPathFor, toBase64 } from './materialise';
import type { MaterialiseService } from './materialise';
import type { ImageSourceHandle, NativePlane } from './imageSource';

function plane(bands: ArrayLike<number>[], width = 2, height = 2, dtype = 'uint8'): NativePlane {
  return { width, height, bands, dtype };
}

describe('bandBytes', () => {
  it('reads a whole typed array', () => {
    expect(Array.from(bandBytes(new Uint8Array([1, 2, 3])))).toEqual([1, 2, 3]);
  });

  it('reads only a subarray view, not its backing buffer', () => {
    // `readPlane` returns a `subarray` whenever the level is contiguous, so
    // this is the common case rather than an exotic one. Taking
    // `view.buffer` alone would ship every channel of the fetched chunk for
    // every band, and Python would then reshape the wrong bytes.
    const backing = new Uint16Array([10, 11, 12, 13, 14, 15]);
    const bytes = bandBytes(backing.subarray(2, 4));
    expect(bytes.length).toBe(4);
    expect(Array.from(new Uint16Array(bytes.buffer, bytes.byteOffset, 2))).toEqual([12, 13]);
  });

  it('preserves the sample width of a 16-bit band', () => {
    expect(bandBytes(new Uint16Array([1, 2, 3])).length).toBe(6);
  });

  it('rejects a plain array rather than shipping garbage', () => {
    expect(() => bandBytes([1, 2, 3])).toThrow(/not a typed array/);
  });
});

describe('packBands', () => {
  it('concatenates bands channel-planar, in order', () => {
    const packed = packBands(
      plane([new Uint8Array([1, 2, 3, 4]), new Uint8Array([5, 6, 7, 8])]),
    );
    expect(Array.from(packed)).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
  });

  it('keeps 16-bit samples byte-for-byte', () => {
    const packed = packBands(plane([new Uint16Array([0x0102, 0x0304])], 2, 1, 'uint16'));
    // Value-level rather than byte-level, so this passes on either endianness:
    // numpy's default order is the platform's too, which is the whole reason
    // no explicit byte-order prefix is sent with the dtype.
    expect(Array.from(new Uint16Array(packed.buffer, packed.byteOffset, 2))).toEqual([
      0x0102, 0x0304,
    ]);
  });

  it('returns an empty buffer for a plane with no bands', () => {
    expect(packBands(plane([])).length).toBe(0);
  });
});

describe('toBase64', () => {
  it('round-trips through atob', () => {
    const bytes = new Uint8Array([0, 1, 127, 128, 254, 255]);
    const back = atob(toBase64(bytes));
    expect(Array.from(back).map((c) => c.charCodeAt(0))).toEqual(Array.from(bytes));
  });

  it('round-trips a payload longer than one fromCharCode window', () => {
    // The 8192-byte window is the reason this function is not a one-liner:
    // spreading a 100k-element array into `String.fromCharCode` overflows the
    // argument limit and throws. Test past the boundary, not at it.
    const bytes = new Uint8Array(20000);
    for (let i = 0; i < bytes.length; i++) bytes[i] = i % 256;
    const back = atob(toBase64(bytes));
    expect(back.length).toBe(bytes.length);
    expect(back.charCodeAt(19999)).toBe(19999 % 256);
  });

  it('encodes an empty buffer as an empty string', () => {
    expect(toBase64(new Uint8Array(0))).toBe('');
  });
});

describe('rawPathFor', () => {
  it('gives two stems two different staging files', () => {
    // The whole point: one shared path lets two concurrent runs interleave
    // their bytes into one file, and the broker's TIFF signature check cannot
    // see that.
    expect(rawPathFor('a')).not.toBe(rawPathFor('b'));
  });

  it('keeps the path inside /tmp whatever the stem contains', () => {
    expect(rawPathFor('../../etc/passwd').slice(5)).not.toContain('/');
    expect(rawPathFor('a b/c')).toBe('/tmp/materialise-a_b_c.raw');
  });

  it('bounds the length and names an empty stem', () => {
    expect(rawPathFor('x'.repeat(400)).length).toBeLessThan(160);
    expect(rawPathFor('')).toBe('/tmp/materialise-image.raw');
  });
});

// --- materialiseImage -----------------------------------------------------

/**
 * A broker double that records the call sequence.
 *
 * Overrides are wrapped rather than substituted, so a test that changes what
 * `startMaterialiseImage` *returns* still gets it recorded. Spreading them in
 * flat would silently drop the bookkeeping and make an assertion about the
 * sequence pass for the wrong reason.
 */
function fakeService(overrides: Partial<MaterialiseService> = {}) {
  const calls: string[] = [];
  const start = overrides.startMaterialiseImage
    ?? (async () => ({
      already: false as const,
      stem: 'a',
      path: 'images/a.tif',
      put_url: 'https://s3/put',
      max_bytes: 1024,
    }));
  const finish = overrides.finishMaterialiseImage ?? (async () => ({ already: false }));
  const service: MaterialiseService = {
    startMaterialiseImage: (stem) => {
      calls.push('start');
      return start(stem);
    },
    finishMaterialiseImage: (stem, levels) => {
      calls.push('finish');
      return finish(stem, levels);
    },
  };
  return { service, calls };
}

function fakeHandle(native?: () => Promise<NativePlane>): ImageSourceHandle {
  return {
    width: 2,
    height: 2,
    levels: [{ width: 2, height: 2 }],
    levelForLongAxis: () => 0,
    getDrawable: async () => ({} as CanvasImageSource),
    displayUrl: async () => 'blob:x',
    ...(native ? { readLevelNative: native } : {}),
    close: () => {},
  };
}

/** A kernel that answers the level-count probe and records what it ran. */
function fakeKernel() {
  const ran: string[] = [];
  const executeCode = async (code: string, callbacks?: any) => {
    ran.push(code);
    if (code.includes('MATERIALISE_LEVELS')) {
      callbacks?.onOutput?.({ type: 'stream', content: 'MATERIALISE_LEVELS=3\n' });
    }
  };
  return { ran, executeCode };
}

describe('materialiseImage', () => {
  const originalFetch = global.fetch;

  beforeEach(() => {
    // `prepareKernel` fetches colab_service.py to exec it. Its contents do not
    // matter here: the fake kernel does not run Python.
    (global as any).fetch = jest.fn(async () => ({ text: async () => '# colab_service' }));
  });

  afterEach(() => {
    (global as any).fetch = originalFetch;
  });

  it('skips a source with no native read without asking the broker', async () => {
    const { service, calls } = fakeService();
    const outcome = await materialiseImage({
      service,
      handle: fakeHandle(),
      stem: 'a',
      executeCode: fakeKernel().executeCode,
      publicUrl: '',
    });
    expect(outcome).toEqual({ status: 'skipped', reason: expect.stringContaining('already has a copy') });
    // The important half: a local image must not open a stage on the artifact
    // just to be told it is already local.
    expect(calls).toEqual([]);
  });

  it('stops at "already" without reading a single pixel', async () => {
    const read = jest.fn();
    const { service, calls } = fakeService({
      startMaterialiseImage: async () => ({ already: true as const, stem: 'a', path: 'images/a.tif' }),
    });
    const outcome = await materialiseImage({
      service,
      handle: fakeHandle(read as any),
      stem: 'a',
      executeCode: fakeKernel().executeCode,
      publicUrl: '',
    });
    expect(outcome).toEqual({ status: 'already' });
    expect(read).not.toHaveBeenCalled();
    expect(calls).not.toContain('finish');
  });

  it('reads, uploads and reports the level count on the happy path', async () => {
    const { service, calls } = fakeService();
    const kernel = fakeKernel();
    const outcome = await materialiseImage({
      service,
      handle: fakeHandle(async () => plane([new Uint8Array([1, 2, 3, 4])])),
      stem: 'a',
      executeCode: kernel.executeCode,
      publicUrl: '',
    });
    expect(outcome).toEqual({ status: 'done', levels: 3 });
    expect(calls).toEqual(['start', 'finish']);
    expect(kernel.ran.join('\n')).toContain('https://s3/put');
  });

  it('passes the plane dtype and shape through to numpy', async () => {
    const { service } = fakeService();
    const kernel = fakeKernel();
    await materialiseImage({
      service,
      handle: fakeHandle(async () =>
        plane([new Uint16Array([1, 2, 3, 4, 5, 6]), new Uint16Array([7, 8, 9, 10, 11, 12])], 3, 2, 'uint16'),
      ),
      stem: 'a',
      executeCode: kernel.executeCode,
      publicUrl: '',
    });
    const encode = kernel.ran.find((c) => c.includes('MATERIALISE_LEVELS'))!;
    expect(encode).toContain('dtype="uint16"');
    // (C, H, W): the layout packBands actually produced, not YXC. The Python
    // transposes it explicitly rather than letting `normalise_axes` guess.
    expect(encode).toContain('reshape((2, 2, 3))');
  });

  it('refuses to upload a plane larger than the broker allowed', async () => {
    const { service, calls } = fakeService({
      startMaterialiseImage: async () => ({
        already: false as const, stem: 'a', path: 'images/a.tif', put_url: 'https://s3/put', max_bytes: 4,
      }),
    });
    const kernel = fakeKernel();
    const outcome = await materialiseImage({
      service,
      handle: fakeHandle(async () => plane([new Uint8Array(64)], 8, 8)),
      stem: 'a',
      executeCode: kernel.executeCode,
      publicUrl: '',
    });
    expect(outcome.status).toBe('skipped');
    // Nothing ran and nothing was committed: the minted PUT url is simply
    // never used, which leaves no trace in the artifact's file listing.
    expect(kernel.ran).toEqual([]);
    expect(calls).toEqual(['start']);
  });

  it('does not flip the manifest when the kernel raises', async () => {
    const { service, calls } = fakeService();
    const executeCode = async (code: string, callbacks?: any) => {
      if (code.includes('MATERIALISE_LEVELS')) {
        callbacks?.onOutput?.({ type: 'error', content: 'Upload rejected with HTTP 403' });
      }
    };
    await expect(
      materialiseImage({
        service,
        handle: fakeHandle(async () => plane([new Uint8Array([1, 2, 3, 4])])),
        stem: 'a',
        executeCode,
        publicUrl: '',
      }),
    ).rejects.toThrow(/403/);
    expect(calls).toEqual(['start']);
  });

  it('does not flip the manifest when the kernel reports no pyramid', async () => {
    // Silent-success guard: an `executeCode` that resolves without printing
    // the marker means the cell never reached the end, and treating that as a
    // finished copy is how the manifest starts pointing at a partial file.
    const { service, calls } = fakeService();
    await expect(
      materialiseImage({
        service,
        handle: fakeHandle(async () => plane([new Uint8Array([1, 2, 3, 4])])),
        stem: 'a',
        executeCode: async () => {},
        publicUrl: '',
      }),
    ).rejects.toThrow(/did not report a pyramid/);
    expect(calls).toEqual(['start']);
  });

  it('runs one materialisation at a time', async () => {
    // Two annotators opening two images at once is the ordinary case, not an
    // exotic one: the single Pyodide kernel behind `executeCode` has one
    // filesystem and one `_arr`, so the second run has to wait for the first
    // to finish rather than write over it mid-flight.
    const { service, calls } = fakeService();
    let releaseFirst = () => {};
    const gate = new Promise<void>((resolve) => {
      releaseFirst = resolve;
    });
    let reads = 0;
    const handle = fakeHandle(async () => {
      reads += 1;
      if (reads === 1) await gate;
      return plane([new Uint8Array([1, 2, 3, 4])]);
    });
    const kernel = fakeKernel();
    const first = materialiseImage({
      service, handle, stem: 'a', executeCode: kernel.executeCode, publicUrl: '',
    });
    const second = materialiseImage({
      service, handle, stem: 'b', executeCode: kernel.executeCode, publicUrl: '',
    });

    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(calls).toEqual(['start']);

    releaseFirst();
    await Promise.all([first, second]);
    expect(calls).toEqual(['start', 'finish', 'start', 'finish']);
  });

  it('reports "already" when another annotator won the race', async () => {
    const { service } = fakeService({
      finishMaterialiseImage: async () => ({ already: true }),
    });
    const outcome = await materialiseImage({
      service,
      handle: fakeHandle(async () => plane([new Uint8Array([1, 2, 3, 4])])),
      stem: 'a',
      executeCode: fakeKernel().executeCode,
      publicUrl: '',
    });
    expect(outcome).toEqual({ status: 'already' });
  });
});
