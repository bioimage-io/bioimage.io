import { fitLongAxis, pickLevelForLongAxis, sourceKindForUrl } from './imageSource';

describe('sourceKindForUrl', () => {
  it('recognises TIFF by path extension, ignoring the query string', () => {
    expect(sourceKindForUrl('https://s3/x/img.tif')).toBe('tiff');
    expect(sourceKindForUrl('https://s3/x/img.ome.tiff')).toBe('tiff');
    expect(sourceKindForUrl('https://s3/x/img.tif?X-Amz-Signature=abc&x=.png')).toBe('tiff');
    expect(sourceKindForUrl('https://s3/x/IMG.TIFF')).toBe('tiff');
  });

  it('routes browser-decodable formats to the browser', () => {
    expect(sourceKindForUrl('https://s3/x/img.png')).toBe('browser');
    expect(sourceKindForUrl('https://s3/x/img.jpeg?sig=1')).toBe('browser');
  });

  // The CLAHE path stores its result as a data URL and hands it to the AI
  // call sites, so "no extension" has to keep meaning "the browser can read
  // it" rather than becoming an error.
  it('treats data: and blob: URLs as browser-decodable', () => {
    expect(sourceKindForUrl('data:image/png;base64,iVBORw0KGgo=')).toBe('browser');
    expect(sourceKindForUrl('data:image/tiff;base64,SUkqAA==')).toBe('browser');
    expect(sourceKindForUrl('blob:https://bioimage.io/9f0a-1234')).toBe('browser');
  });

  it('falls back to the browser for anything unrecognised', () => {
    expect(sourceKindForUrl('https://s3/x/img')).toBe('browser');
    expect(sourceKindForUrl('')).toBe('browser');
  });

  // A `.tiff` directory name must not make a store root look like a file.
  it('does not match an extension that is only a path segment', () => {
    expect(sourceKindForUrl('https://s3/x.tif/0/0.0')).toBe('browser');
  });
});

describe('pickLevelForLongAxis', () => {
  const levels = [
    { width: 2048, height: 1024 },
    { width: 1024, height: 512 },
    { width: 512, height: 256 },
  ];

  it('picks the smallest level that still covers the request', () => {
    expect(pickLevelForLongAxis(levels, 512)).toBe(2);
    expect(pickLevelForLongAxis(levels, 513)).toBe(1);
    expect(pickLevelForLongAxis(levels, 1024)).toBe(1);
    expect(pickLevelForLongAxis(levels, 1025)).toBe(0);
  });

  it('never upsamples: a request finer than the image returns level 0', () => {
    expect(pickLevelForLongAxis(levels, 4096)).toBe(0);
  });

  it('returns 0 for a single-level source', () => {
    expect(pickLevelForLongAxis([{ width: 300, height: 200 }], 32)).toBe(0);
  });
});

describe('fitLongAxis', () => {
  it('returns null when the image already fits, so no copy is made', () => {
    expect(fitLongAxis(800, 600, 1024)).toBeNull();
    expect(fitLongAxis(1024, 600, 1024)).toBeNull();
  });

  it('scales the long axis to the cap and the short axis with it', () => {
    expect(fitLongAxis(4000, 2000, 1000)).toEqual({ width: 1000, height: 500 });
    expect(fitLongAxis(2000, 4000, 1000)).toEqual({ width: 500, height: 1000 });
  });

  // An extreme aspect ratio must not round the short axis to zero: a canvas of
  // width 0 throws on `toBlob`.
  it('never lets a dimension round down to zero', () => {
    const fit = fitLongAxis(100000, 10, 1000)!;
    expect(fit.width).toBe(1000);
    expect(fit.height).toBe(1);
  });

  it('treats a non-positive cap as no cap at all', () => {
    expect(fitLongAxis(4000, 2000, 0)).toBeNull();
    expect(fitLongAxis(4000, 2000, -1)).toBeNull();
  });
});
