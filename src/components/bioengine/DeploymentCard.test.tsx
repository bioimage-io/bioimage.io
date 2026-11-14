import React from 'react';
import { render, screen } from '@testing-library/react';
import '@testing-library/jest-dom';
import DeploymentCard from './DeploymentCard';
import DeployedBioEngineApps from './DeployedBioEngineApps';
import shortfallFixture from './__fixtures__/shortfall-0_16_108.json';

// The worker reports `resource_shortfall` only when no single node had room for a
// deploy it accepted anyway. Such an app sits at NOT_STARTED, which the card
// otherwise paints in the same neutral grey as every state it does not recognise,
// so these tests are the difference between "waiting to start" and "will never
// start" being distinguishable at all.
//
// Three input states and only two renderings: an OLDER worker omits the key, a
// current worker sends `null` whenever a node had room, and both must look exactly
// like they do today. Only the object form draws anything.

const PANEL_HEADING = /No single node had room for this app/i;

// Strip the fixture's documentation block; the worker never sends it.
const { _comment, ...SHORTFALL } = shortfallFixture as any;

const baseDeployment = {
  artifact_id: 'demo/stuck-app',
  application_id: 'stuck-app',
  deployment_name: 'stuck-app',
  display_name: 'Stuck App',
  status: 'NOT_STARTED',
  resources: { num_cpus: 8, num_gpus: 2, memory: 34359738368 },
};

const renderCard = (extra: Record<string, unknown>) =>
  render(<DeploymentCard deployment={{ ...baseDeployment, ...extra } as any} />);

describe('DeploymentCard resource_shortfall', () => {
  it('names the shortfall when the worker reports one', () => {
    renderCard({ resource_shortfall: SHORTFALL });
    expect(screen.getByText(PANEL_HEADING)).toBeInTheDocument();
  });

  it('renders requested against the free capacity of each node', () => {
    renderCard({ resource_shortfall: SHORTFALL });

    // Requested, in the same units the resource pills use.
    expect(screen.getByText(/Requested:/i).parentElement).toHaveTextContent(
      '8 CPUs, 2 GPUs, 32.0 GB',
    );

    // Both nodes appear, each with what it actually has free. Node ids are
    // truncated for width, so match on the prefix the card shows.
    expect(screen.getByText(/a1b2c3d4e5f6/)).toBeInTheDocument();
    expect(screen.getByText(/b2c3d4e5f678/)).toBeInTheDocument();

    const nodeLines = screen.getAllByRole('listitem');
    expect(nodeLines).toHaveLength(2);
    nodeLines.forEach((line) => {
      expect(line).toHaveTextContent('4 CPUs, 1 GPU, 16.0 GB');
    });
  });

  // The fixture's cluster_free equals requested exactly. A card that presented it
  // as available capacity would be telling the reader the app can be placed, at the
  // moment it provably cannot. Admission is per node.
  it('does not present cluster_free as room to run', () => {
    const { container } = renderCard({ resource_shortfall: SHORTFALL });
    expect(container.textContent).toMatch(/does not mean this app can be placed/i);
    expect(container.textContent).toMatch(/has to fit on one node/i);
  });

  it('renders nothing extra when the key is null', () => {
    renderCard({ resource_shortfall: null });
    expect(screen.queryByText(PANEL_HEADING)).not.toBeInTheDocument();
  });

  it('renders nothing extra when the key is absent, as on an older worker', () => {
    renderCard({});
    expect(screen.queryByText(PANEL_HEADING)).not.toBeInTheDocument();
  });

  // The row's requirement is that absent and null render "exactly as they do
  // today", which is stronger than each merely hiding the panel: they must agree
  // with each other byte for byte. A future edit that branched on key presence
  // and rendered, say, "unknown" for one of them would pass the two tests above
  // and fail this one.
  it('renders a null key and an absent key identically', () => {
    const { container: withNull, unmount } = renderCard({ resource_shortfall: null });
    const nullHtml = withNull.innerHTML;
    unmount();

    const { container: withAbsent } = renderCard({});
    expect(withAbsent.innerHTML).toBe(nullHtml);
  });

  // A node with nothing free is the most informative line on the panel, and is
  // exactly what a truthiness test would drop. Guards the `typeof === 'number'`
  // check in describeResourceSet.
  it('still prints a node that has zero free resources', () => {
    renderCard({
      resource_shortfall: {
        ...SHORTFALL,
        free_per_node: {
          emptynode0001: { num_cpus: 0, num_gpus: 0, memory: 0 },
        },
      },
    });
    expect(screen.getByRole('listitem')).toHaveTextContent('0 CPUs, 0 GPUs, 0 MB');
  });

  // Degenerate but reachable: the worker builds `requested` from the app manifest,
  // so a manifest naming none of the three keys yields an empty object. Rendering
  // an empty string there would read as "requested nothing".
  it('says so rather than printing blank when a resource set is empty', () => {
    renderCard({ resource_shortfall: { ...SHORTFALL, requested: {} } });
    expect(screen.getByText(/Requested:/i).parentElement).toHaveTextContent('not reported');
  });
});

// The tests above hand the card its prop directly, which cannot see the two
// reshaping steps between `get_app_status` and that prop. Both are spreads today
// (`{...app, <overrides>}` in BioEngineWorker, `{artifact_id: key, ...value}`
// here), so an additive key rides through untouched -- but that is a property of
// the current code, not a guarantee, and a future refactor to a named allowlist
// would drop the field while every card-level test above stayed green.
describe('the shortfall survives the dashboard reshaping get_app_status', () => {
  const statusPayload = (appEntry: Record<string, unknown>) => ({
    bioengine_apps: {
      'stuck-app': {
        application_id: 'stuck-app',
        deployment_name: 'stuck-app',
        display_name: 'Stuck App',
        status: 'NOT_STARTED',
        ...appEntry,
      },
    },
  });

  it('names the shortfall when the dashboard is pointed at a payload carrying one', () => {
    render(
      <DeployedBioEngineApps
        status={statusPayload({ resource_shortfall: SHORTFALL })}
        onUndeployArtifact={() => {}}
      />,
    );
    expect(screen.getByText(PANEL_HEADING)).toBeInTheDocument();
    expect(screen.getAllByRole('listitem')).toHaveLength(2);
  });

  it('draws no panel when the payload omits the key, as an older worker does', () => {
    render(
      <DeployedBioEngineApps status={statusPayload({})} onUndeployArtifact={() => {}} />,
    );
    expect(screen.queryByText(PANEL_HEADING)).not.toBeInTheDocument();
  });
});
