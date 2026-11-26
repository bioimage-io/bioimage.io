import { hasForegroundFeatures, probeTrainForeground } from './trainForeground';

const fc = (n: number) => ({
  type: 'FeatureCollection',
  features: Array.from({ length: n }, (_, i) => ({ type: 'Feature', id: i })),
});

describe('hasForegroundFeatures', () => {
  it('accepts a FeatureCollection that holds at least one feature', () => {
    expect(hasForegroundFeatures(fc(1))).toBe(true);
    expect(hasForegroundFeatures(fc(37))).toBe(true);
  });

  it('rejects a FeatureCollection whose features array is empty', () => {
    // This is the shape the annotator saves when the user drew nothing, and it
    // is the whole point of the check.
    expect(hasForegroundFeatures(fc(0))).toBe(false);
  });

  it('rejects anything that is not a FeatureCollection', () => {
    expect(hasForegroundFeatures({ type: 'Feature' })).toBe(false);
    expect(hasForegroundFeatures({ features: [{}] })).toBe(false);
    expect(hasForegroundFeatures({ type: 'FeatureCollection' })).toBe(false);
    expect(hasForegroundFeatures({ type: 'FeatureCollection', features: 'no' })).toBe(false);
  });

  it('rejects empty inputs rather than throwing on them', () => {
    expect(hasForegroundFeatures(null)).toBe(false);
    expect(hasForegroundFeatures(undefined)).toBe(false);
    expect(hasForegroundFeatures('')).toBe(false);
    expect(hasForegroundFeatures(0)).toBe(false);
  });
});

describe('probeTrainForeground', () => {
  it('reports foreground when one annotation marks something', async () => {
    const r = await probeTrainForeground(['a'], async () => fc(2));
    expect(r).toEqual({ determined: true, anyForeground: true, checked: 1, failed: 0 });
  });

  it('STOPS at the first annotation that marks something', async () => {
    // Without the early exit a 200-image split would pay 200 requests on the
    // common path. Asserting the call count is the only way to see it.
    const seen: string[] = [];
    const r = await probeTrainForeground(
      ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'],
      async (url) => {
        seen.push(url);
        return fc(1);
      },
      { concurrency: 2 },
    );
    expect(r.anyForeground).toBe(true);
    expect(seen).toEqual(['a', 'b']);
  });

  it('reports NO foreground when every annotation read is empty', async () => {
    const r = await probeTrainForeground(['a', 'b', 'c'], async () => fc(0));
    expect(r).toEqual({ determined: true, anyForeground: false, checked: 3, failed: 0 });
  });

  it('is UNDETERMINED when nothing could be read, so the caller cannot refuse', async () => {
    // An expired URL says nothing about whether the annotation marks anything.
    const r = await probeTrainForeground(['a', 'b'], async () => {
      throw new Error('403');
    });
    expect(r.determined).toBe(false);
    expect(r.anyForeground).toBe(false);
    expect(r.failed).toBe(2);
  });

  it('is UNDETERMINED when some reads fail and the rest are empty', async () => {
    const r = await probeTrainForeground(['bad', 'empty'], async (url) => {
      if (url === 'bad') throw new Error('500');
      return fc(0);
    });
    // This case used to expect determined:true, and that expectation was the
    // defect written down as a requirement. One annotation read empty says
    // nothing about the one that could not be read, so claiming "none of them
    // mark any foreground" here asserts something about an annotation nobody
    // looked at. Measured in a browser on a split whose two annotations hold
    // 53 and 65 features, with one request failing: the run was refused and
    // the banner said the annotations were empty.
    expect(r).toEqual({ determined: false, anyForeground: false, checked: 1, failed: 1 });
  });

  it('is undetermined however many empties sit beside ONE failed read', async () => {
    // The direction matters more than the single case: a split of twenty
    // annotations with nineteen empty and one unreadable must still not be
    // called empty, because the unread one is exactly where the foreground
    // would be.
    const urls = ['bad', ...Array.from({ length: 19 }, (_, i) => `empty-${i}`)];
    const r = await probeTrainForeground(urls, async (url) => {
      if (url === 'bad') throw new Error('500');
      return fc(0);
    });
    expect(r.determined).toBe(false);
    expect(r.checked).toBe(19);
    expect(r.failed).toBe(1);
  });

  it('still determines emptiness when EVERY read succeeded', async () => {
    // The control for the two cases above: with nothing failing, an all-empty
    // split is still a determined "no foreground", so the probe has not simply
    // stopped answering.
    const r = await probeTrainForeground(['a', 'b'], async () => fc(0));
    expect(r).toEqual({ determined: true, anyForeground: false, checked: 2, failed: 0 });
  });

  it('finds foreground even when an earlier read failed', async () => {
    const r = await probeTrainForeground(['bad', 'good'], async (url) => {
      if (url === 'bad') throw new Error('500');
      return fc(5);
    });
    expect(r.anyForeground).toBe(true);
    expect(r.failed).toBe(1);
  });

  it('is undetermined for an empty list, so it cannot be confused with "empty"', async () => {
    let called = 0;
    const r = await probeTrainForeground([], async () => {
      called += 1;
      return fc(1);
    });
    expect(r).toEqual({ determined: false, anyForeground: false, checked: 0, failed: 0 });
    expect(called).toBe(0);
  });

  it('batches rather than opening every request at once', async () => {
    let inFlight = 0;
    let peak = 0;
    const r = await probeTrainForeground(
      ['a', 'b', 'c', 'd', 'e'],
      async () => {
        inFlight += 1;
        peak = Math.max(peak, inFlight);
        await Promise.resolve();
        inFlight -= 1;
        return fc(0);
      },
      { concurrency: 2 },
    );
    expect(r.checked).toBe(5);
    expect(peak).toBeLessThanOrEqual(2);
  });
});
