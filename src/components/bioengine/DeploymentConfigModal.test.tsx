import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import DeploymentConfigModal from './DeploymentConfigModal';
import { useHyphaStore } from '../../store/hyphaStore';

jest.mock('../../store/hyphaStore');

// svamp #0053: the version box is prefilled with whatever is currently running, so
// the default action on a running app redeploys that version even when the artifact
// has published newer code. The worker cannot warn about it: it reports the deploy as
// the version that was asked for, because it was asked for. This dialog is the only
// place that can catch it, and it needs the artifact's head version to do so.
//
// No live app is ever guaranteed to be behind its artifact (all five were at head when
// this was written), so the positive case has to be driven from a mock.

const mockStore = (headVersions: string[] | null) => {
  const read = jest.fn().mockResolvedValue(
    headVersions === null
      ? {}
      : { versions: headVersions.map(v => ({ version: v })) },
  );
  (useHyphaStore as unknown as jest.Mock).mockReturnValue({
    isLoggedIn: true,
    server: { getService: jest.fn().mockResolvedValue({ read }) },
  });
  return read;
};

const RUNNING = {
  'model-runner': { status: 'RUNNING', version: '2.10.4', artifact_id: 'bioimage-io/model-runner' },
};

const open = (props: Partial<React.ComponentProps<typeof DeploymentConfigModal>> = {}) =>
  render(
    <DeploymentConfigModal
      isOpen
      onClose={() => {}}
      onDeploy={() => {}}
      artifactId="bioimage-io/model-runner"
      initialMode={null}
      bioengineApps={RUNNING}
      initialApplicationId="model-runner"
      {...props}
    />,
  );

afterEach(() => jest.resetAllMocks());

describe('DeploymentConfigModal version staleness', () => {
  it('warns when the running version is behind the artifact head', async () => {
    mockStore(['2.10.3', '2.10.4', '2.10.5']);
    open();
    // prefilled with what is running
    expect(await screen.findByDisplayValue('2.10.4')).toBeInTheDocument();
    // and told that the artifact has moved on
    await waitFor(() => expect(screen.getByText(/has since published/)).toBeInTheDocument());
    expect(screen.getByRole('button', { name: 'Use 2.10.5' })).toBeInTheDocument();
  });

  it('offers a one-click way to take the newer version', async () => {
    mockStore(['2.10.4', '2.10.5']);
    open();
    const take = await screen.findByRole('button', { name: 'Use 2.10.5' });
    await userEvent.click(take);
    expect(await screen.findByDisplayValue('2.10.5')).toBeInTheDocument();
    // once taken, the warning has nothing left to say
    await waitFor(() => expect(screen.queryByText(/has since published/)).toBeNull());
  });

  it('stays silent when the running version IS the head', async () => {
    mockStore(['2.10.3', '2.10.4']);
    open();
    expect(await screen.findByDisplayValue('2.10.4')).toBeInTheDocument();
    await waitFor(() => expect(screen.queryByText(/has since published/)).toBeNull());
  });

  it('stays silent on a fresh deployment, where blank already means latest', async () => {
    mockStore(['2.10.4', '2.10.5']);
    open({ bioengineApps: {}, initialApplicationId: undefined });
    await waitFor(() => expect(screen.queryByText(/has since published/)).toBeNull());
  });

  // Advisory, so a failed read must not block or alter the deploy path.
  it('stays silent when the artifact read fails', async () => {
    (useHyphaStore as unknown as jest.Mock).mockReturnValue({
      isLoggedIn: true,
      server: { getService: jest.fn().mockRejectedValue(new Error('no artifact manager')) },
    });
    open();
    expect(await screen.findByDisplayValue('2.10.4')).toBeInTheDocument();
    await waitFor(() => expect(screen.queryByText(/has since published/)).toBeNull());
  });

  it('stays silent when the artifact reports no versions', async () => {
    mockStore(null);
    open();
    expect(await screen.findByDisplayValue('2.10.4')).toBeInTheDocument();
    await waitFor(() => expect(screen.queryByText(/has since published/)).toBeNull());
  });
});
