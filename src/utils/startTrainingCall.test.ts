import { buildStartTrainingImages, unresolvableCount, TrainingUrlsLike } from './startTrainingCall';
import type { TrainingUrlEntry } from '../components/colab/brokerApi';

const mat = (stem: string): TrainingUrlEntry => ({
  stem, user: 'u', image_url: `https://host/${stem}.png`, geojson_url: `https://host/${stem}.json`,
});
const region = (stem: string): TrainingUrlEntry => ({
  stem,
  user: 'u',
  geojson_url: `https://host/${stem}.json`,
  image_source: {
    kind: 'ngff',
    store_root: `https://host/${stem}.zarr/`,
    multiscale_path: null,
    region: { x: 10, y: 20, width: 256, height: 256 },
    // Level 0 first, named as the store names it. Deliberately 's0' rather
    // than '0': the producer warns the name is the store's own choice.
    dataset_paths: ['s0', 's1'],
    axis_roles: { y: 1, x: 2, c: 0 },
    level0_shape: [3, 2048, 2048],
    axes: ['c', 'y', 'x'],
    planes: null,
  },
});

describe('buildStartTrainingImages', () => {
  it('passes a materialised image as its url and a remote one as its object', () => {
    const urls: TrainingUrlsLike = { train: [mat('a'), region('b')], test: [] };
    const out = buildStartTrainingImages(urls);
    expect(out.train_images[0]).toBe('https://host/a.png');
    expect(typeof out.train_images[1]).toBe('object');
    expect(out.train_images[1]).toMatchObject({ kind: 'ngff', store_root: 'https://host/b.zarr/' });
  });

  // This is the case the previous round could not fail on: it runs the actual
  // construction, so reverting either call site to e.image_url breaks it.
  it('builds BOTH train_images and val_images from a mixed list, with no holes', () => {
    const urls: TrainingUrlsLike = { train: [mat('a'), region('b')], test: [region('c'), mat('d')] };
    const out = buildStartTrainingImages(urls);
    expect(out.train_images).toHaveLength(2);
    expect(out.val_images).toHaveLength(2);
    expect([...out.train_images, ...(out.val_images ?? [])].filter((r) => r === undefined)).toHaveLength(0);
    // val_images specifically: the second call site, which a helper-only test
    // never reached.
    expect(typeof out.val_images![0]).toBe('object');
    expect(out.val_images![1]).toBe('https://host/d.png');
  });

  it('keeps images and labels in the same order, because the backend pairs them positionally', () => {
    const urls: TrainingUrlsLike = { train: [mat('a'), region('b'), mat('c')], test: [] };
    const out = buildStartTrainingImages(urls);
    expect(out.train_labels).toEqual([
      'https://host/a.json', 'https://host/b.json', 'https://host/c.json',
    ]);
    expect(out.train_images[0]).toBe('https://host/a.png');
    expect(out.train_images[2]).toBe('https://host/c.png');
  });

  it('omits the validation keys entirely when there is no test split', () => {
    const out = buildStartTrainingImages({ train: [mat('a')], test: [] });
    expect(out.val_images).toBeUndefined();
    expect(out.val_labels).toBeUndefined();
  });

  it('refuses rather than building a call with an unresolvable row', () => {
    const broken = { stem: 'x', user: 'u', geojson_url: 'g' } as unknown as TrainingUrlEntry;
    const urls: TrainingUrlsLike = { train: [mat('a'), broken], test: [] };
    expect(unresolvableCount(urls)).toBe(1);
    expect(() => buildStartTrainingImages(urls)).toThrow(/neither image_url nor image_source/);
  });

  it('counts unresolvable rows in the test split too', () => {
    const broken = { stem: 'x', user: 'u', geojson_url: 'g' } as unknown as TrainingUrlEntry;
    expect(unresolvableCount({ train: [mat('a')], test: [broken] })).toBe(1);
  });
});
