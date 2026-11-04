import { orderPyramidLevels, rastersToRgba } from './omeTiffPyramid';

describe('orderPyramidLevels', () => {
  it('orders finest first', () => {
    const out = orderPyramidLevels([
      { width: 512, height: 256 },
      { width: 2048, height: 1024 },
      { width: 1024, height: 512 },
    ]);
    expect(out.map((l) => l.width)).toEqual([2048, 1024, 512]);
  });

  it('drops a duplicate level', () => {
    const out = orderPyramidLevels([
      { width: 1024, height: 512 },
      { width: 1024, height: 512 },
      { width: 512, height: 256 },
    ]);
    expect(out.map((l) => l.width)).toEqual([1024, 512]);
  });

  it('keeps a level that shrinks on only one axis', () => {
    const out = orderPyramidLevels([
      { width: 1000, height: 1000 },
      { width: 1000, height: 500 },
    ]);
    expect(out).toHaveLength(2);
  });

  it('preserves the carried payload', () => {
    const out = orderPyramidLevels([
      { width: 256, height: 256, tag: 'small' },
      { width: 512, height: 512, tag: 'big' },
    ]);
    expect(out.map((l) => l.tag)).toEqual(['big', 'small']);
  });
});

describe('rastersToRgba', () => {
  it('replicates a single band across R/G/B and sets alpha opaque', () => {
    const out = rastersToRgba([new Uint8Array([0, 255])], 2, 1);
    expect(Array.from(out)).toEqual([0, 0, 0, 255, 255, 255, 255, 255]);
  });

  it('passes uint8 through without stretching', () => {
    const out = rastersToRgba([new Uint8Array([10, 20])], 2, 1);
    expect(out[0]).toBe(10);
    expect(out[4]).toBe(20);
  });

  it('min/max stretches uint16 to the full 8-bit range', () => {
    const out = rastersToRgba([new Uint16Array([1000, 3000, 5000])], 3, 1);
    expect(out[0]).toBe(0);
    expect(out[8]).toBe(255);
    expect(out[4]).toBeGreaterThan(120);
    expect(out[4]).toBeLessThan(136);
  });

  it('stretches each plane independently so a flat channel stays flat', () => {
    const out = rastersToRgba(
      [new Uint16Array([0, 1000]), new Uint16Array([7, 7]), new Uint16Array([500, 1500])],
      2,
      1,
    );
    expect(out[0]).toBe(0);
    expect(out[4]).toBe(255);
    // A constant plane has no range to stretch; it must not become 255/0
    // noise, it must pass through.
    expect(out[1]).toBe(7);
    expect(out[5]).toBe(7);
  });

  it('takes the first three bands and ignores the rest', () => {
    const out = rastersToRgba(
      [new Uint8Array([1]), new Uint8Array([2]), new Uint8Array([3]), new Uint8Array([4])],
      1,
      1,
    );
    expect(Array.from(out)).toEqual([1, 2, 3, 255]);
  });

  it('handles a two-band file by replicating the first', () => {
    const out = rastersToRgba([new Uint8Array([9]), new Uint8Array([200])], 1, 1);
    expect(Array.from(out)).toEqual([9, 9, 9, 255]);
  });

  it('survives a NaN-only float plane instead of emitting garbage', () => {
    const out = rastersToRgba([new Float32Array([NaN, NaN])], 2, 1);
    expect(out[0]).toBe(0);
    expect(out[3]).toBe(255);
  });

  it('rejects a level that decoded to no bands', () => {
    expect(() => rastersToRgba([], 1, 1)).toThrow(/zero bands/);
  });
});
