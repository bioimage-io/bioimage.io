/**
 * Translating a broker image URL into something the viewer can open.
 *
 * This is the one place the wire shape is turned into a source ref, so it is
 * also the only place the RECORDED PLANE can reach the page that draws the
 * annotation. A review found the plane threaded all the way through
 * `planeSelection`, `ngffPyramid` and `openImageSource`, and passed by exactly
 * one caller: the import dialog's preview. The annotator opens its image
 * through this function, so a record that stops here never reaches the canvas.
 */

import { imageSourceRefFor, usableRecord } from './brokerApi';

const LEVEL0 = [1, 1, 9, 4096, 4096];


describe('usableRecord', () => {
  // The hole this closes, measured: `level0_shape: []` is TRUTHY, so a check
  // for the field's presence passed an empty shape through as a whole record.
  // `planeAtLevel` then read a missing reference size, defaulted it to one
  // slice, and returned index 8 at a 9-slice level for a recorded slice 4,
  // with nothing reporting it.
  it('accepts a record whose shape can actually answer', () => {
    expect(usableRecord({ z: 4 }, LEVEL0)).toEqual({ planes: { z: 4 }, shape: LEVEL0 });
  });

  it('refuses an EMPTY shape, which is truthy and answers nothing', () => {
    expect(usableRecord({ z: 4 }, [])).toBeNull();
  });

  it('refuses a shape that is not a list of positive whole numbers', () => {
    expect(usableRecord({ z: 4 }, [1, 0, 9] as number[])).toBeNull();
    expect(usableRecord({ z: 4 }, [1, -1, 9] as number[])).toBeNull();
    expect(usableRecord({ z: 4 }, [1, 1.5, 9] as number[])).toBeNull();
    expect(usableRecord({ z: 4 }, ['9'] as unknown as number[])).toBeNull();
    expect(usableRecord({ z: 4 }, null)).toBeNull();
  });

  it('refuses an empty or absent plane mapping', () => {
    expect(usableRecord({}, LEVEL0)).toBeNull();
    expect(usableRecord(null, LEVEL0)).toBeNull();
  });
});

describe('imageSourceRefFor', () => {
  it('passes a materialised image through as its url', () => {
    expect(imageSourceRefFor({ stem: 'a', kind: 'file', read_url: 'https://host/a.png' })).toBe(
      'https://host/a.png',
    );
  });

  it('carries the recorded plane AND the shape it was measured against', () => {
    const ref = imageSourceRefFor({
      stem: 'b',
      kind: 'ngff',
      store_root: 'https://host/b.zarr/',
      multiscale_path: null,
      region: null,
      planes: { z: 4 },
      level0_shape: LEVEL0,
    });
    expect(typeof ref).toBe('object');
    expect(ref).toMatchObject({
      kind: 'ngff',
      storeRoot: 'https://host/b.zarr/',
      planes: { planes: { z: 4 }, shape: LEVEL0 },
    });
  });

  it('carries NOTHING when only half the record arrived', () => {
    // An index without the shape it was measured against cannot be placed on
    // another level, and a shape without an index names no slice. Half a
    // record must not look like a record: `planeAtLevel` would then divide by
    // a reference size it was never given.
    const noShape = imageSourceRefFor({
      stem: 'c',
      kind: 'ngff',
      store_root: 'https://host/c.zarr/',
      planes: { z: 4 },
    }) as any;
    expect(noShape.planes).toBeNull();

    const noPlanes = imageSourceRefFor({
      stem: 'd',
      kind: 'ngff',
      store_root: 'https://host/d.zarr/',
      level0_shape: LEVEL0,
    }) as any;
    expect(noPlanes.planes).toBeNull();
  });

  it('carries nothing when the shape is empty, which is truthy', () => {
    const ref = imageSourceRefFor({
      stem: 'g',
      kind: 'ngff',
      store_root: 'https://host/g.zarr/',
      planes: { z: 4 },
      level0_shape: [],
    }) as any;
    expect(ref.planes).toBeNull();
  });

  it('carries nothing for an EMPTY plane mapping', () => {
    const ref = imageSourceRefFor({
      stem: 'e',
      kind: 'ngff',
      store_root: 'https://host/e.zarr/',
      planes: {},
      level0_shape: LEVEL0,
    }) as any;
    expect(ref.planes).toBeNull();
  });

  it('still works against a broker that sends neither field', () => {
    // Which is every deployed broker today: the fields are written at import
    // but `get_image_url` does not return them yet. The ref is then exactly
    // what it was before, and the pyramid refuses only for the stores where
    // the missing record actually changes which pixels are shown.
    const ref = imageSourceRefFor({
      stem: 'f',
      kind: 'ngff',
      store_root: 'https://host/f.zarr/',
      multiscale_path: 'scale0',
      region: { x: 1, y: 2, width: 3, height: 4 },
    }) as any;
    expect(ref).toEqual({
      kind: 'ngff',
      storeRoot: 'https://host/f.zarr/',
      multiscalePath: 'scale0',
      region: { x: 1, y: 2, width: 3, height: 4 },
      planes: null,
    });
  });
});
