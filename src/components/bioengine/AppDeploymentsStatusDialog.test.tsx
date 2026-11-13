import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import AppDeploymentsStatusDialog from './AppDeploymentsStatusDialog';
import liveAppStatus from './__fixtures__/live-0_16_96-app-status.json';

// myco #0063: get_app_status gained a PER-DEPLOYMENT max_ongoing_requests in
// bioengine 0.16.96 (PR #298 / issue #0323). It is a different limit from the
// instance-wide one the deploy dialog sets, and three live KTH apps disagreed
// with the top-level number in both directions before the fix: omezarr-view
// declared 32 and reported 10, annotation-broker declared 20 and reported 10,
// model-runner declared 10 and reported 150.
//
// The three states this payload can be in must render three different ways:
//   present int  -> the cap
//   present null -> "not reported" (ProxyDeployment has no decorator; an unset
//                   or non-integral cap resolves to null upstream)
//   key absent   -> nothing at all (worker predates 0.16.96, which is the
//                   common case: the setup wizard still hands out 0.16.92)
//
// The null case and the absent case asserting DIFFERENT output is the point. A
// test that only proved "nothing crashes" would also pass on a build that
// rendered both as 0, and 0 reads as "accepts no requests".

const LIMIT_HEADING = /Per-replica request limit/i;

const openWith = (deployments: Record<string, any>) => {
  const fetchApplicationStatus = jest.fn().mockResolvedValue({ deployments });
  render(
    <AppDeploymentsStatusDialog
      isOpen
      onClose={() => {}}
      applicationId="test-app"
      fetchApplicationStatus={fetchApplicationStatus}
    />,
  );
  return fetchApplicationStatus;
};

const deployment = (extra: Record<string, any>) => ({
  status: 'RUNNING',
  replica_states: { RUNNING: 1 },
  ...extra,
});

describe('per-deployment max_ongoing_requests', () => {
  it('renders the declared cap for each deployment that reports one', async () => {
    const fetchApplicationStatus = openWith({
      // The three live apps from the upstream measurement, used as fixtures.
      OmezarrView: deployment({ max_ongoing_requests: 32 }),
      AnnotationBroker: deployment({ max_ongoing_requests: 20 }),
      ModelRunner: deployment({ max_ongoing_requests: 10 }),
    });

    await waitFor(() => expect(fetchApplicationStatus).toHaveBeenCalled());

    expect(await screen.findByText('32 concurrent')).toBeInTheDocument();
    expect(screen.getByText('20 concurrent')).toBeInTheDocument();
    expect(screen.getByText('10 concurrent')).toBeInTheDocument();
    expect(screen.getAllByText(LIMIT_HEADING)).toHaveLength(3);
  });

  it('renders a present null as not-reported rather than as a number', async () => {
    openWith({
      // ProxyDeployment has no decorator, so the worker resolves it to null.
      ProxyDeployment: deployment({ max_ongoing_requests: null }),
    });

    expect(await screen.findByText(LIMIT_HEADING)).toBeInTheDocument();
    expect(screen.getByText('Not reported')).toBeInTheDocument();
    expect(screen.queryByText(/concurrent$/)).not.toBeInTheDocument();
  });

  it('renders nothing at all when the worker omits the key', async () => {
    const fetchApplicationStatus = openWith({
      // A worker older than 0.16.96. Gating on key presence rather than on a
      // version compare is what makes this case work without the frontend
      // knowing the release boundary.
      LegacyDeployment: deployment({}),
    });

    await waitFor(() => expect(fetchApplicationStatus).toHaveBeenCalled());
    // The deployment itself must still render, so a missing heading below is
    // about the cap and not about the dialog having failed to load.
    expect(await screen.findByText('LegacyDeployment')).toBeInTheDocument();

    expect(screen.queryByText(LIMIT_HEADING)).not.toBeInTheDocument();
    expect(screen.queryByText('Not reported')).not.toBeInTheDocument();
  });

  it('does not collapse 0 and null onto the same output', async () => {
    openWith({
      ZeroCap: deployment({ max_ongoing_requests: 0 }),
      NullCap: deployment({ max_ongoing_requests: null }),
    });

    // 0 is a real integer the worker could report. It must not borrow null's
    // wording, and null must not borrow 0's.
    expect(await screen.findByText('0 concurrent')).toBeInTheDocument();
    expect(screen.getByText('Not reported')).toBeInTheDocument();
  });

  // The cases above are hand-built. This one is the payload a real 0.16.96 worker
  // returned, captured by notes/capture-0063-payload.py and committed under
  // __fixtures__ with its service id and version. It is the difference between
  // "the component handles the shape we think the worker sends" and "the component
  // handles the shape the worker sends".
  it('renders the live 0.16.96 payload, with every cap distinct from the instance-wide limit', async () => {
    const { deployments, max_ongoing_requests: instanceWide } = liveAppStatus as any;

    // The fixture only discriminates if the per-deployment numbers differ from the
    // top-level one. Assert that here rather than trusting it, so a future re-capture
    // against a worker whose numbers happen to coincide fails loudly instead of
    // quietly becoming a test that passes on the bug.
    expect(instanceWide).toBe(10);
    const caps = Object.values(deployments).map((d: any) => d.max_ongoing_requests);
    expect(caps).toEqual(expect.arrayContaining([20, 5, 5, 5, null]));
    caps.filter((c) => c !== null).forEach((c) => expect(c).not.toBe(instanceWide));

    const fetchApplicationStatus = openWith(deployments);
    await waitFor(() => expect(fetchApplicationStatus).toHaveBeenCalled());

    // EntryDeployment declared 20, the three runtimes declared 5 each.
    expect(await screen.findByText('20 concurrent')).toBeInTheDocument();
    expect(screen.getAllByText('5 concurrent')).toHaveLength(3);
    // ProxyDeployment has no decorator, so the worker reports null for it.
    expect(screen.getByText('Not reported')).toBeInTheDocument();
    // All five deployments carry the key, so all five render the heading.
    expect(screen.getAllByText(LIMIT_HEADING)).toHaveLength(5);
    // The instance-wide 10 must not leak into any deployment row. A build that
    // echoed the top-level number would show it five times.
    expect(screen.queryByText('10 concurrent')).not.toBeInTheDocument();
  });

  it('does not coerce a bool into a cap', async () => {
    openWith({
      // The worker excludes bools via isinstance(limit, bool), so true should
      // never arrive. If it does, it must not render as "1 concurrent".
      BoolCap: deployment({ max_ongoing_requests: true as any }),
    });

    expect(await screen.findByText(LIMIT_HEADING)).toBeInTheDocument();
    expect(screen.getByText('Not reported')).toBeInTheDocument();
    expect(screen.queryByText('1 concurrent')).not.toBeInTheDocument();
  });
});
