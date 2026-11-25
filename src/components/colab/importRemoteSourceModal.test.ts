/**
 * The channel note shown next to a probed OME-Zarr source.
 *
 * Only the pure copy helper is covered. The modal itself is exercised by
 * `tests/colab-remote-ngff.spec.ts` against a live broker, which is the only
 * place its two-step flow means anything.
 */

import { channelDisplayNote } from './ImportRemoteSourceModal';

describe('channelDisplayNote', () => {
  it('says nothing for the two cases that render as expected', () => {
    // One band is drawn as grey and three become RGB. Both are what someone
    // looking at the store would already assume.
    expect(channelDisplayNote(1)).toBeNull();
    expect(channelDisplayNote(3)).toBeNull();
  });

  it('warns that a second channel is dropped', () => {
    // The failure this exists for: `rastersToRgba` maps fewer than three bands
    // to [b0, b0, b0], so a two-channel store looks like a plain grey image
    // with no sign that half of it is missing.
    expect(channelDisplayNote(2)).toMatch(/two channels/);
    expect(channelDisplayNote(2)).toMatch(/does not show the second/);
  });

  it('counts how many channels a wide store loses', () => {
    expect(channelDisplayNote(7)).toMatch(/7 channels/);
    expect(channelDisplayNote(7)).toMatch(/other 4/);
  });

  it('says nothing when the store names no channels at all', () => {
    // The probe returns an empty list for a store with no omero metadata, and
    // the decode seam then reads the single band it finds.
    expect(channelDisplayNote(0)).toBeNull();
  });
});
