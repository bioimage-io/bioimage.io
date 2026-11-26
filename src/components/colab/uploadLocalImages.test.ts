import { summariseUploads, uploadLocalImages, UploadOutcome } from './uploadLocalImages';

/**
 * Putting a picked file into a dataset on a browser that cannot mount a folder.
 *
 * The cases are mostly about what must NOT happen, because this route writes
 * to somebody's dataset and every wrong answer costs them something real: an
 * overwritten image takes its annotations with it, a PUT reported as success
 * leaves an entry with no bytes behind it, and one bad file in a picked batch
 * must not lose the uploads that worked.
 *
 * The broker's own rules are not re-tested here. That it refuses a path, an
 * unknown extension or a taken stem is its business and is covered on its
 * side; what is covered here is that this client ASKS in the right order,
 * sends the body the one way the presigned URL accepts, and reports each
 * outcome as what it was.
 */

jest.mock('./brokerApi', () => ({
  ...jest.requireActual('./brokerApi'),
  startLocalImageUpload: jest.fn(),
  finishLocalImageUpload: jest.fn(),
}));

const { startLocalImageUpload, finishLocalImageUpload } = jest.requireMock('./brokerApi');

/** A File with a real `arrayBuffer`, which jsdom's does not always provide. */
const fileOf = (name: string, size = 1024): File => {
  const file = new File([new Uint8Array(size)], name, { type: 'image/png' });
  Object.defineProperty(file, 'size', { value: size });
  Object.defineProperty(file, 'arrayBuffer', {
    value: async () => new ArrayBuffer(size),
  });
  return file;
};

const START_OK = {
  already: false,
  stem: 'scan01',
  path: 'images/scan01.png',
  put_url: 'https://storage.invalid/put/scan01.png?sig=abc',
  max_bytes: 64 * 1024 * 1024,
  mint_id: 'mint-1',
};

let put: jest.Mock;

beforeEach(() => {
  jest.clearAllMocks();
  put = jest.fn().mockResolvedValue({ ok: true, status: 200 });
  startLocalImageUpload.mockResolvedValue(START_OK);
  finishLocalImageUpload.mockResolvedValue({ stem: 'scan01', path: 'images/scan01.png' });
});

const run = (files: File[], extra = {}) =>
  uploadLocalImages({ server: {}, artifactId: 'bioimage-io/x', files, put, ...extra });

describe('uploadLocalImages', () => {
  it('mints, PUTs and finishes, in that order, with the mint id', async () => {
    const outcomes = await run([fileOf('scan01.png')]);
    expect(outcomes).toEqual([{ status: 'uploaded', filename: 'scan01.png', stem: 'scan01' }]);
    expect(startLocalImageUpload).toHaveBeenCalledWith({}, 'bioimage-io/x', 'scan01.png');
    expect(put).toHaveBeenCalledWith(START_OK.put_url, expect.any(ArrayBuffer));
    // The finish is worthless without the id: the broker refuses it and
    // changes nothing, so a client that omitted it would leave every upload
    // unfinished while reporting success.
    expect(finishLocalImageUpload).toHaveBeenCalledWith({}, 'bioimage-io/x', 'scan01.png', 'mint-1');
  });

  it('sends the body as an ArrayBuffer, never the File', async () => {
    // The presigned signature covers Content-Type, so setting one is a 403.
    // `fetch` sets it for a Blob body that carries a type, and a File from a
    // picker does carry one, so handing the File straight to fetch would fail
    // every upload with a refusal that looks like a permissions problem.
    await run([fileOf('scan01.png')]);
    const [, body] = put.mock.calls[0];
    expect(body).toBeInstanceOf(ArrayBuffer);
    expect(body).not.toBeInstanceOf(Blob);
  });

  it('does NOT report success when the PUT was refused', async () => {
    put.mockResolvedValue({ ok: false, status: 403 });
    const outcomes = await run([fileOf('scan01.png')]);
    expect(outcomes[0]).toEqual({
      status: 'failed',
      filename: 'scan01.png',
      reason: 'upload refused (403)',
    });
    // And it does not finish an upload whose bytes never landed.
    expect(finishLocalImageUpload).not.toHaveBeenCalled();
  });

  it('reports a taken stem as ALREADY, and uploads nothing', async () => {
    // The dataset already has that name. Overwriting it would orphan the
    // annotations drawn on the image that is there, so this is a report, not
    // a retry.
    startLocalImageUpload.mockResolvedValue({
      already: true,
      stem: 'scan01',
      path: 'images/scan01.png',
    });
    const outcomes = await run([fileOf('scan01.png')]);
    expect(outcomes[0]).toEqual({ status: 'already', filename: 'scan01.png', stem: 'scan01' });
    expect(put).not.toHaveBeenCalled();
    expect(finishLocalImageUpload).not.toHaveBeenCalled();
  });

  it('refuses an oversized file BEFORE sending it', async () => {
    const outcomes = await run([fileOf('huge.png', 200 * 1024 * 1024)]);
    expect(outcomes[0].status).toBe('skipped');
    expect((outcomes[0] as any).reason).toMatch(/over the 64 MB limit/);
    // The broker enforces the same ceiling after the bytes land, which costs
    // an upload and a deletion. Knowing it here means neither happens.
    expect(put).not.toHaveBeenCalled();
  });

  it('skips a file the broker could not take, without asking', async () => {
    const outcomes = await run([fileOf('notes.pdf')]);
    expect(outcomes[0].status).toBe('skipped');
    expect((outcomes[0] as any).reason).toMatch(/\.png, \.jpg/);
    expect(startLocalImageUpload).not.toHaveBeenCalled();
  });

  it('keeps going after one file fails, and reports each outcome', async () => {
    // A picker returns whatever was selected. Failing the batch on the first
    // bad file would lose the uploads that worked, which is the opposite of
    // what the user asked for.
    startLocalImageUpload
      .mockResolvedValueOnce(START_OK)
      .mockRejectedValueOnce(new Error('broker unreachable'))
      .mockResolvedValueOnce({ ...START_OK, stem: 'scan03' });
    finishLocalImageUpload
      .mockResolvedValueOnce({ stem: 'scan01', path: 'images/scan01.png' })
      .mockResolvedValueOnce({ stem: 'scan03', path: 'images/scan03.png' });

    const outcomes = await run([
      fileOf('scan01.png'),
      fileOf('scan02.png'),
      fileOf('scan03.png'),
    ]);
    expect(outcomes.map((o) => o.status)).toEqual(['uploaded', 'failed', 'uploaded']);
    expect((outcomes[1] as any).reason).toBe('broker unreachable');
  });

  it('uploads ONE AT A TIME, not in parallel', async () => {
    // Each mint reconciles the dataset's whole image listing to answer "is
    // this stem taken?". Several at once would race that question, which is
    // the race the broker's no-overwrite check exists to lose safely rather
    // than one worth creating here.
    const inFlight: number[] = [];
    let current = 0;
    put.mockImplementation(async () => {
      current += 1;
      inFlight.push(current);
      await new Promise((r) => setTimeout(r, 1));
      current -= 1;
      return { ok: true, status: 200 };
    });
    await run([fileOf('a.png'), fileOf('b.png'), fileOf('c.png')]);
    expect(Math.max(...inFlight)).toBe(1);
  });

  it('sends the BASENAME for a directory pick, where the folder is in webkitRelativePath', async () => {
    // The real shape, which a review corrected me on: a browser puts the
    // folder in `webkitRelativePath` and leaves `name` as the basename. The
    // first version of this case fed a File whose `.name` held a slash, which
    // no browser produces, so it covered an input that cannot happen.
    const picked = fileOf('scan01.png');
    Object.defineProperty(picked, 'webkitRelativePath', { value: 'plate1/scan01.png' });
    await run([picked]);
    expect(startLocalImageUpload).toHaveBeenCalledWith({}, 'bioimage-io/x', 'scan01.png');
  });

  it('still strips a path if one ever arrives in the name', async () => {
    // Defensive, and kept because the service REFUSES a path rather than
    // taking its basename: the cost of being wrong is a refused upload the
    // user cannot explain.
    await run([fileOf('plate1/scan01.png')]);
    expect(startLocalImageUpload).toHaveBeenCalledWith({}, 'bioimage-io/x', 'scan01.png');
  });

  it('reports progress per file', async () => {
    const onProgress = jest.fn();
    await run([fileOf('a.png'), fileOf('b.png')], { onProgress });
    expect(onProgress).toHaveBeenCalledTimes(2);
    expect(onProgress).toHaveBeenLastCalledWith(2, 2, expect.objectContaining({ status: 'uploaded' }));
  });
});

describe('summariseUploads', () => {
  const outcome = (status: UploadOutcome['status'], filename = 'x.png'): UploadOutcome =>
    ({ status, filename, stem: 'x', reason: 'r' } as UploadOutcome);

  it('names only what happened', () => {
    // Three zeroes reported at somebody who picked three files and got three
    // images is noise, so the other categories appear only when they are not
    // zero.
    expect(summariseUploads([outcome('uploaded'), outcome('uploaded')])).toBe('2 images added.');
  });

  it('counts each category when there is one', () => {
    const line = summariseUploads([
      outcome('uploaded'),
      outcome('already'),
      outcome('skipped'),
      outcome('failed'),
    ]);
    expect(line).toBe('1 image added, 1 already in the dataset, 1 skipped, 1 failed.');
  });

  it('says nothing was added rather than going silent', () => {
    expect(summariseUploads([outcome('failed')])).toBe('0 images added, 1 failed.');
  });
});
