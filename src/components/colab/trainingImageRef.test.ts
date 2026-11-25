import { trainingImageRef, TrainingUrlEntry } from './brokerApi';

const materialised = (stem: string): TrainingUrlEntry => ({
  stem, user: 'u', image_url: `https://host/${stem}.png`, geojson_url: `https://host/${stem}.json`,
});
// The producer's own nine keys. This fixture used to carry `array_path: '0'`,
// which is a key the broker does not emit: level 0 is `dataset_paths[0]`, and
// the store names it, so it is often 's0' rather than '0'. A fixture inventing
// a key documents a contract that does not exist, and neither jest nor the
// production build can catch it (babel strips types, and CRA's type check
// excludes *.test.*), so it is asserted by the standalone strict compile
// recorded on this branch instead.
const region = (stem: string): TrainingUrlEntry => ({
  stem,
  user: 'u',
  image_source: {
    kind: 'ngff',
    store_root: `https://host/${stem}.zarr/`,
    multiscale_path: null,
    region: { x: 10, y: 20, width: 256, height: 256 },
    dataset_paths: ['s0', 's1'],
    axis_roles: { y: 1, x: 2, c: 0 },
    level0_shape: [3, 2048, 2048],
    axes: ['c', 'y', 'x'],
    planes: null,
  },
  geojson_url: `https://host/${stem}.json`,
});

describe('trainingImageRef', () => {
  it('passes a materialised image through as its url', () => {
    expect(trainingImageRef(materialised('a'))).toBe('https://host/a.png');
  });

  it('passes a remote row through as its source OBJECT, not a url', () => {
    const ref = trainingImageRef(region('b'));
    expect(typeof ref).toBe('object');
    expect(ref).toMatchObject({ store_root: 'https://host/b.zarr/', region: { x: 10, width: 256 } });
  });

  // The failure this exists for: a mixed list is exactly what a dataset holding
  // both kinds returns, and reading image_url directly left a hole at the
  // region row's position with nothing to object.
  it('resolves a MIXED list with no undefined and in order', () => {
    const rows = [materialised('a'), region('b'), materialised('c')];
    const refs = rows.map(trainingImageRef);
    expect(refs).toHaveLength(3);
    expect(refs.filter((r) => r === undefined)).toHaveLength(0);
    expect(refs[0]).toBe('https://host/a.png');
    expect(typeof refs[1]).toBe('object');
    expect(refs[2]).toBe('https://host/c.png');
  });

  it('returns undefined for a row carrying neither, so the caller can refuse', () => {
    const broken = { stem: 'x', user: 'u', geojson_url: 'g' } as TrainingUrlEntry;
    expect(trainingImageRef(broken)).toBeUndefined();
  });

  it('prefers the url when a row somehow carries both', () => {
    // OUT OF CONTRACT, and cast deliberately, like the neither-key case above.
    // The union makes a row with both keys unrepresentable, which is the point
    // of the union. The case stays because the type only constrains what this
    // build can WRITE: the object comes off the wire from a broker that may be
    // newer than this page, so the function still has to answer for a shape the
    // types forbid, and "prefers the url" is the answer it gives.
    const both = {
      ...materialised('d'),
      image_source: { store_root: 'https://host/d.zarr/' },
    } as unknown as TrainingUrlEntry;
    expect(trainingImageRef(both)).toBe('https://host/d.png');
  });

  it('treats an empty-string url as absent rather than sending it', () => {
    const empty = { stem: 'e', user: 'u', image_url: '', geojson_url: 'g' } as TrainingUrlEntry;
    expect(trainingImageRef(empty)).toBeUndefined();
  });
});
