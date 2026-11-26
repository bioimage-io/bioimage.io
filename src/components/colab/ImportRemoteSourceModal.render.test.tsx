/**
 * The import dialog rendered against a probe shaped like the service's.
 *
 * The pure copy helper next door is covered on its own. This file exists
 * because the component did something no test of a helper could see: a store
 * with no omero metadata made the broker answer `channels: null`, two
 * unguarded `probe.channels.length` reads threw during render, and React
 * unmounted the whole tree. Measured in Chromium: the dialog count went to 0
 * and `document.body` innerText to length 0, sampled every five seconds for
 * thirty, with no error anywhere on screen.
 *
 * The type said `string[]`, so nothing warned. That is the gap: a probe
 * fixture here is the cheapest place to keep the component honest about what
 * the service actually sends.
 */

import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import ImportRemoteSourceModal from './ImportRemoteSourceModal';

jest.mock('./brokerApi', () => ({
  ...jest.requireActual('./brokerApi'),
  probeNgffSource: jest.fn(),
  importNgffImage: jest.fn(),
}));
// The preview opens the store in the browser, which jsdom cannot do. Failing
// it is the realistic case anyway, and the dialog is built to survive it: the
// note says so and the import stays available.
jest.mock('./imageSource', () => ({
  ...jest.requireActual('./imageSource'),
  openImageSource: jest.fn().mockRejectedValue(new Error('no preview in jsdom')),
}));

const { probeNgffSource } = jest.requireMock('./brokerApi');

/** A real probe document, trimmed, for a tczyx store with no omero block. */
const PROBE_NO_OMERO = {
  store_root: 'https://host/zstack.zarr/',
  multiscale_path: null,
  width: 256,
  height: 256,
  dtype: '|u1',
  // NULL, not []. This is the field the service sends and the component used
  // to assume could not be.
  channels: null,
  levels: 2,
  content_hint: 'c4c7ffe2e18d6bb8',
  stem: 'zstack',
  max_materialise_bytes: 67108864,
  dataset_paths: ['s0', 's1'],
  axes: ['t', 'c', 'z', 'y', 'x'],
  axis_roles: { y: 3, x: 4, c: 1 },
  level0_shape: [1, 1, 9, 256, 256],
};

const setup = () =>
  render(
    <ImportRemoteSourceModal
      server={{}}
      artifactId="bioimage-io/annotation-abc"
      onClose={jest.fn()}
      onImported={jest.fn()}
    />,
  );

const probeTheUrl = async () => {
  await userEvent.type(screen.getByLabelText(/store url/i), 'https://host/zstack.zarr/');
  await userEvent.click(screen.getByRole('button', { name: /check source/i }));
};

beforeEach(() => {
  jest.clearAllMocks();
  probeNgffSource.mockResolvedValue(PROBE_NO_OMERO);
});

describe('ImportRemoteSourceModal, probed', () => {
  it('survives a store that names NO channels, and says so', async () => {
    setup();
    await probeTheUrl();
    await waitFor(() => expect(screen.getByText(/256 x 256 pixels/)).toBeInTheDocument());
    expect(screen.getByText(/no channel names in the store/i)).toBeInTheDocument();
    // Still usable: the dialog is the first step of the flow, so a store like
    // this must not be a dead end.
    expect(screen.getByRole('button', { name: /^link image$/i })).toBeInTheDocument();
  });

  it('names the channels when the store HAS them', async () => {
    // The control. Without it, the case above would pass just as well if the
    // fix had stopped reading the names at all.
    probeNgffSource.mockResolvedValue({ ...PROBE_NO_OMERO, channels: ['DAPI', 'GFP', 'RFP'] });
    setup();
    await probeTheUrl();
    await waitFor(() => expect(screen.getByText('DAPI, GFP, RFP')).toBeInTheDocument());
    expect(screen.queryByText(/no channel names in the store/i)).toBeNull();
  });

  it('still says which slice a multi-plane store will be annotated on', async () => {
    // The plane note is computed from the same probe, so a crash while
    // rendering the channel line took this with it.
    setup();
    await probeTheUrl();
    await waitFor(() => expect(screen.getByText(/z slice 4 of 9/)).toBeInTheDocument());
    expect(screen.getByText(/recorded with the import so training reads the same slice/i)).toBeInTheDocument();
  });
});
