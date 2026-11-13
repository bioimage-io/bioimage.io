import React from 'react';
import { render, screen, waitFor, within } from '@testing-library/react';
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
//   present null -> "not reported", with wording that depends on WHY it is null
//   key absent   -> nothing at all (worker predates 0.16.96, which is the
//                   common case: the setup wizard still hands out 0.16.92)
//
// The null case and the absent case asserting DIFFERENT output is the point. A
// test that only proved "nothing crashes" would also pass on a build that
// rendered both as 0, and 0 reads as "accepts no requests".
//
// Null itself arrives two ways, which the reviewer refused an earlier head over
// (polar-shark-grvryd on PR #139 at b887abf). ProxyDeployment is NOT a
// deployment without a decorator: apps/proxy_deployment.py:125 declares
// max_ongoing_requests=10, and apps/manager.py:1112 short-circuits on the name
// before reading deployment_config, so the worker has the number and withholds
// it on purpose — its docstring says the top-level field is the bound that
// governs client calls. Telling that row "no limit, so Ray Serve applies its own
// default" is false on both halves and inverts what bounds the proxy. The other
// way null arrives, an unset or non-integral cap on a user deployment, is where
// that sentence is correct.

const LIMIT_HEADING = /Per-replica request limit/i;
const GENERIC_NULL_TEXT = /Ray Serve applies its own default/i;
const PROXY_NULL_TEXT = /governed by the instance-wide limit/i;

// Each deployment renders as one rounded-xl card with its name in an h4, so a
// per-row assertion is possible. Without it, "the proxy row lacks the generic
// sentence" would also be satisfied by that row not rendering at all.
const rowFor = (name: string): HTMLElement => {
  const row = screen.getByText(name).closest('div.rounded-xl');
  if (!row) throw new Error(`no deployment card found for ${name}`);
  return row as HTMLElement;
};

const openWith = (deployments: Record<string, any>, topLevel: Record<string, any> = {}) => {
  // topLevel is spread FIRST so a caller cannot accidentally replace deployments,
  // and it exists so the instance-wide max_ongoing_requests can be present in the
  // payload. An absence assertion on "10 concurrent" is otherwise satisfied by the
  // number never having been in the data.
  const fetchApplicationStatus = jest.fn().mockResolvedValue({ ...topLevel, deployments });
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
      // The worker short-circuits on this name and returns null for it.
      ProxyDeployment: deployment({ max_ongoing_requests: null }),
    });

    expect(await screen.findByText(LIMIT_HEADING)).toBeInTheDocument();
    expect(screen.getByText('Not reported')).toBeInTheDocument();
    expect(screen.queryByText(/concurrent$/)).not.toBeInTheDocument();
  });

  it('words the two ways a null arrives differently, per row', async () => {
    openWith({
      ProxyDeployment: deployment({ max_ongoing_requests: null }),
      UnsetCap: deployment({ max_ongoing_requests: null }),
    });

    expect(await screen.findByText(PROXY_NULL_TEXT)).toBeInTheDocument();

    // The proxy row says what actually bounds it and must NOT claim it is
    // running on a Ray Serve default.
    const proxy = within(rowFor('ProxyDeployment'));
    expect(proxy.getByText(PROXY_NULL_TEXT)).toBeInTheDocument();
    expect(proxy.queryByText(GENERIC_NULL_TEXT)).not.toBeInTheDocument();

    // Paired presence on a non-proxy null, so deleting the sentence everywhere
    // does not satisfy the absence above. Both halves are needed: the absence
    // alone also passes on a build that drops the proxy card.
    const unset = within(rowFor('UnsetCap'));
    expect(unset.getByText(GENERIC_NULL_TEXT)).toBeInTheDocument();
    expect(unset.queryByText(PROXY_NULL_TEXT)).not.toBeInTheDocument();

    // Both rows still report the state itself the same way.
    expect(screen.getAllByText('Not reported')).toHaveLength(2);
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

    // The instance-wide number is passed through, so the absence assertion at the
    // end of this case is about the component and not about missing data.
    const fetchApplicationStatus = openWith(deployments, { max_ongoing_requests: instanceWide });
    await waitFor(() => expect(fetchApplicationStatus).toHaveBeenCalled());

    // EntryDeployment declared 20, the three runtimes declared 5 each.
    expect(await screen.findByText('20 concurrent')).toBeInTheDocument();
    expect(screen.getAllByText('5 concurrent')).toHaveLength(3);
    // The worker withholds the proxy's own cap, so this row reads as not reported
    // and must point at the instance-wide limit rather than at a Serve default.
    expect(screen.getByText('Not reported')).toBeInTheDocument();
    const liveProxy = within(rowFor('ProxyDeployment'));
    expect(liveProxy.getByText(PROXY_NULL_TEXT)).toBeInTheDocument();
    expect(liveProxy.queryByText(GENERIC_NULL_TEXT)).not.toBeInTheDocument();
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
