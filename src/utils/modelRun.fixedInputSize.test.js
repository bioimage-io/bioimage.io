// Regression tests for #0259: every fixed-input-size model in the Zoo fails its own
// "Test Run Model" in the browser.
//
// The discriminator is NOT fixed-vs-flexible and NOT old-vs-new RDF format. It is whether a
// space axis spells its extent as a plain integer (`size: 256`, a fixed axis) or as a dict
// (`size: {min: 64, step: 16}`, a flexible one). getMinShape/getStepShape test `axis.size.min`
// and `axis.size.step`, which are both `undefined` on a number, so a fixed axis silently
// falls through to the `return 1` default.
//
// The specs below were fetched live from hypha.aicell.io/bioimage-io/artifacts/<id> on
// 2026-11-06 and trimmed to the fields these functions read.

import {
  getMinShape,
  getStepShape,
  getHalo,
  ModelRunnerEngine,
} from './modelRun';
import { ImgPadder, parseAxes, tfjsToImJoy } from './imgProcess';
import * as tf from '@tensorflow/tfjs-core';

// --- fixtures: real specs, fetched 2026-11-06 ------------------------------------------

// playful-scorpion, format_version 0.5.12. Fixed 256x256, output halo 32.
const FIXED_INPUT = {
  shape: null,
  axes: [
    { type: 'batch', size: 1 },
    { type: 'channel', channel_names: ['channel0', 'channel1', 'channel2'] },
    { size: 256, id: 'y', type: 'space' },
    { size: 256, id: 'x', type: 'space' },
  ],
};
const FIXED_OUTPUT = {
  halo: null,
  axes: [
    { type: 'batch', size: 1 },
    { type: 'channel', channel_names: ['F', 'Gv', 'Gh'] },
    { halo: 32, size: { tensor_id: 'input0', axis_id: 'y', offset: 0 }, id: 'y', type: 'space', scale: 1 },
    { halo: 32, size: { tensor_id: 'input0', axis_id: 'x', offset: 0 }, id: 'x', type: 'space', scale: 1 },
  ],
};

// affable-shark, format_version 0.5.7. Flexible min 64 step 16, output halo 16.
// This is the discrimination control: it runs correctly today and must keep doing so.
const FLEXIBLE_INPUT = {
  shape: null,
  axes: [
    { type: 'batch' },
    { id: 'channel', type: 'channel', channel_names: ['channel0'] },
    { size: { min: 64, step: 16 }, id: 'y', type: 'space', scale: 1 },
    { size: { min: 64, step: 16 }, id: 'x', type: 'space', scale: 1 },
  ],
};
const FLEXIBLE_OUTPUT = {
  halo: null,
  axes: [
    { type: 'batch' },
    { id: 'channel', type: 'channel', channel_names: ['channel0', 'channel1'] },
    { halo: 16, size: { tensor_id: 'input0', axis_id: 'y', offset: 0 }, id: 'y', type: 'space', scale: 1 },
    { halo: 16, size: { tensor_id: 'input0', axis_id: 'x', offset: 0 }, id: 'x', type: 'space', scale: 1 },
  ],
};

// An old-format fixed-size spec. `step: 0` is how 0.4.x spelled "this axis is fixed", which is
// why ImgPadder already branches on `step[d] === 0`.
const OLD_FORMAT_FIXED_INPUT = {
  axes: 'bcyx',
  shape: { min: [1, 1, 256, 256], step: [0, 0, 0, 0] },
};

const engineWith = (input, output) => {
  const engine = new ModelRunnerEngine();
  engine.rdf = { inputs: [input], outputs: [output] };
  return engine;
};

// --- the axis-extent readers ----------------------------------------------------------

describe('getMinShape / getStepShape on a fixed integer axis size', () => {
  test('reads a fixed space extent as its actual size, not as 1', () => {
    expect(getMinShape(FIXED_INPUT)).toEqual([1, 3, 256, 256]);
  });

  test('reports step 0 on a fixed axis, the encoding that means "no flexibility"', () => {
    expect(getStepShape(FIXED_INPUT)).toEqual([1, 1, 0, 0]);
  });

  test('control: a flexible dict extent is read correctly (passes before the fix too)', () => {
    expect(getMinShape(FLEXIBLE_INPUT)).toEqual([1, 1, 64, 64]);
    expect(getStepShape(FLEXIBLE_INPUT)).toEqual([1, 1, 16, 16]);
  });

  test('control: old-format fixed shape still reads straight off shape.min/.step', () => {
    expect(getMinShape(OLD_FORMAT_FIXED_INPUT)).toEqual([1, 1, 256, 256]);
    expect(getStepShape(OLD_FORMAT_FIXED_INPUT)).toEqual([0, 0, 0, 0]);
  });

  test('axes parse to bcyx for both, so min/step indices line up with the axis string', () => {
    expect(parseAxes(FIXED_INPUT)).toBe('bcyx');
    expect(parseAxes(FLEXIBLE_INPUT)).toBe('bcyx');
  });
});

// --- the padder, which is what actually has to produce a 256 px tensor ----------------

describe('ImgPadder on a fixed-size model', () => {
  const padderFor = (input) =>
    new ImgPadder(undefined, getMinShape(input), getStepShape(input), 0);

  test('pads an undersized image UP to the fixed extent', () => {
    expect(padderFor(FIXED_INPUT).getPaddedShape([1, 3, 200, 200]))
      .toEqual([1, 3, 256, 256]);
  });

  test('an already-correct image is left exactly at the fixed extent', () => {
    expect(padderFor(FIXED_INPUT).getPaddedShape([1, 3, 256, 256]))
      .toEqual([1, 3, 256, 256]);
  });

  test('an oversized image resolves to the fixed extent, not passed through', () => {
    // This is the defect in its purest form: before the fix the padded shape came back as the
    // INPUT size, so an oversized image was submitted untouched and the model asserted on it.
    // Returning the fixed extent is what makes the oversize case detectable at all; pad()
    // cannot shrink, so runTiles has to tile instead. See the tiling block below.
    expect(padderFor(FIXED_INPUT).getPaddedShape([1, 3, 320, 320]))
      .toEqual([1, 3, 256, 256]);
  });

  test('old-format fixed model gets the same treatment', () => {
    expect(padderFor(OLD_FORMAT_FIXED_INPUT).getPaddedShape([1, 1, 300, 300]))
      .toEqual([1, 1, 256, 256]);
  });

  test('control: a flexible model still rounds up to min + k*step', () => {
    // 100 -> ceil((100-64)/16)*16 + 64 = 48 + 64 = 112
    expect(padderFor(FLEXIBLE_INPUT).getPaddedShape([1, 1, 100, 100]))
      .toEqual([1, 1, 112, 112]);
  });

  test('control: a flexible model leaves an exact multiple alone', () => {
    expect(padderFor(FLEXIBLE_INPUT).getPaddedShape([1, 1, 80, 80]))
      .toEqual([1, 1, 80, 80]);
  });
});

// --- tile geometry --------------------------------------------------------------------

describe('default tile geometry', () => {
  test('a fixed-size model tiles at exactly its fixed extent, not 4x the min', () => {
    // getDefaultTileSizes multiplies the min by 4 on x and y. That is right for a flexible
    // model and wrong for a fixed one, where the only tile the model accepts is 256.
    const tiles = engineWith(FIXED_INPUT, FIXED_OUTPUT).getDefaultTileSizes();
    expect(tiles.y).toBe(256);
    expect(tiles.x).toBe(256);
  });

  test('control: a flexible model still gets 4x its min', () => {
    const tiles = engineWith(FLEXIBLE_INPUT, FLEXIBLE_OUTPUT).getDefaultTileSizes();
    expect(tiles.y).toBe(256); // 4 * 64
    expect(tiles.x).toBe(256);
  });

  test('a fixed-size model takes no tile overlap, because the tile cannot grow', () => {
    // 2*halo would be 64 here. Overlap only shifts tile starts, so it does not break the
    // fixed extent, but it makes neighbouring tiles overlap for no reachable benefit: the
    // model's halo cannot be honoured when the tile size is already pinned to the input size.
    const overlaps = engineWith(FIXED_INPUT, FIXED_OUTPUT).getDefaultTileOverlaps();
    expect(overlaps.y).toBe(0);
    expect(overlaps.x).toBe(0);
  });

  test('control: a flexible model still gets 2*halo overlap on its space axes only', () => {
    // Also pins the indexing: getHalo pads non-space axes with 0, so halo[i] lines up with
    // the i-th character of "bcyx" and b/c get 0 rather than inheriting a space-axis halo.
    const overlaps = engineWith(FLEXIBLE_INPUT, FLEXIBLE_OUTPUT).getDefaultTileOverlaps();
    expect(overlaps).toEqual({ b: 0, c: 0, y: 32, x: 32 });
  });
});

// --- getHalo indexing -----------------------------------------------------------------

// --- end to end through runTiles, with the model call stubbed -------------------------
//
// These are the ones that bear on the issue's actual criterion. The model is stubbed as an
// identity function, so what is under test is the geometry: that every tensor handed to the
// model is exactly the extent it declared, and that the merged result still covers the whole
// image the user supplied.

describe('runTiles on a fixed-size model, with the tiling checkbox OFF (the UI default)', () => {
  beforeAll(async () => {
    await tf.ready();
  });

  // Returns the shapes the model was asked to run, plus the final output shape.
  const runWith = async (input, output, imgShape, enableTiling = false) => {
    const engine = engineWith(input, output);
    const submitted = [];
    engine.submitTensor = async (tensor) => {
      submitted.push(tensor.shape.slice());
      return tfjsToImJoy(tensor, false, 'float32');
    };
    const result = await engine.runTiles(
      tf.ones(imgShape),
      input,
      output,
      engine.getDefaultTileSizes(),
      engine.getDefaultTileOverlaps(),
      undefined,
      () => {},
      enableTiling
    );
    return { submitted, shape: result.shape };
  };

  test('an OVERSIZED image is tiled rather than rejected, and every tile is exactly 256', async () => {
    // This is the defect as a visitor meets it: before the fix the whole 320x320 tensor went
    // to the model untouched and it asserted "Input height (320) doesn't match model (256)".
    const { submitted, shape } = await runWith(FIXED_INPUT, FIXED_OUTPUT, [1, 3, 320, 320]);
    expect(submitted.length).toBeGreaterThan(1);
    submitted.forEach((s) => expect(s).toEqual([1, 3, 256, 256]));
    // and the user gets a mask covering the whole image they supplied, not a crop of it
    expect(shape).toEqual([1, 3, 320, 320]);
  });

  test('an UNDERSIZED image is padded up to 256 in a single run, not tiled', async () => {
    const { submitted, shape } = await runWith(FIXED_INPUT, FIXED_OUTPUT, [1, 3, 200, 200]);
    expect(submitted).toEqual([[1, 3, 256, 256]]);
    expect(shape).toEqual([1, 3, 200, 200]);
  });

  test('an exactly-256 image still runs once, with no tiling', async () => {
    const { submitted, shape } = await runWith(FIXED_INPUT, FIXED_OUTPUT, [1, 3, 256, 256]);
    expect(submitted).toEqual([[1, 3, 256, 256]]);
    expect(shape).toEqual([1, 3, 256, 256]);
  });

  test('control: a FLEXIBLE model is NOT forced into tiling and still runs whole', async () => {
    // The discrimination control for this fix. Forcing tiling for every model would satisfy
    // the issue's criterion while silently changing how every flexible model in the Zoo runs.
    const { submitted, shape } = await runWith(FLEXIBLE_INPUT, FLEXIBLE_OUTPUT, [1, 1, 320, 320]);
    expect(submitted).toEqual([[1, 1, 320, 320]]);
    expect(shape).toEqual([1, 1, 320, 320]);
  });

  test('control: a flexible model whose size is not a step multiple is padded, still once', async () => {
    // 100 -> 112, i.e. min 64 + 3*16, then cropped back to 100.
    const { submitted, shape } = await runWith(FLEXIBLE_INPUT, FLEXIBLE_OUTPUT, [1, 1, 100, 100]);
    expect(submitted).toEqual([[1, 1, 112, 112]]);
    expect(shape).toEqual([1, 1, 100, 100]);
  });
});

describe('getHalo', () => {
  test('returns one entry per axis, zero-filled on non-space axes', () => {
    // Recorded because a peer diagnosis held that getHalo returns one entry per SPACE axis
    // (length 2) and is therefore misindexed by its caller. It does not: the new-format branch
    // pushes 0 for every non-space axis, so the result is full length and correctly aligned.
    expect(getHalo(FIXED_OUTPUT)).toEqual([0, 0, 32, 32]);
    expect(getHalo(FLEXIBLE_OUTPUT)).toEqual([0, 0, 16, 16]);
  });
});
