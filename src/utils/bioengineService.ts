// Service-ID patterns used by the bioimage.io website to talk to the
// production BioEngine workers hosted on the public `bioimage-io` Hypha
// workspace.
//
// Multiple BioEngine workers can be registered on the workspace at the
// same time. The website pins itself to specific workers via a glob on
// the pod client_id:
//
//     <pod-name>:<service-name>
//     ^^^^^^^^^^
//     this part is `bioengine-worker-<site>-<replicaset>-<rand>` for the
//     site's pods (per-app sub-clients inherit the same prefix), so a
//     `bioengine-worker-<site>-*` glob on the client_id portion matches
//     one site and only that site.
//
// Hypha resolves the glob server-side (verified live, May 2026), so
// callers can pass these strings straight to `server.getService(...)`.

// KTH is the primary production site. deNBI is the secondary backup.
export const BIOIMAGEIO_KTH_WORKER_CLIENT_GLOB = 'bioengine-worker-kth-*';
export const BIOIMAGEIO_DENBI_WORKER_CLIENT_GLOB = 'bioengine-worker-denbi-*';

// Per-site model-runner service ids.
export const BIOIMAGEIO_KTH_MODEL_RUNNER_SERVICE_ID =
  `bioimage-io/${BIOIMAGEIO_KTH_WORKER_CLIENT_GLOB}:model-runner`;
export const BIOIMAGEIO_DENBI_MODEL_RUNNER_SERVICE_ID =
  `bioimage-io/${BIOIMAGEIO_DENBI_WORKER_CLIENT_GLOB}:model-runner`;

// Worker-admin service id (KTH is the canonical production worker).
export const BIOIMAGEIO_WORKER_CLIENT_GLOB = BIOIMAGEIO_KTH_WORKER_CLIENT_GLOB;
export const BIOIMAGEIO_WORKER_SERVICE_ID =
  `bioimage-io/${BIOIMAGEIO_WORKER_CLIENT_GLOB}:bioengine-worker`;

// Back-compat: existing callers default to KTH. New code should pick
// per-site via useModelRunners().
export const BIOIMAGEIO_MODEL_RUNNER_SERVICE_ID = BIOIMAGEIO_KTH_MODEL_RUNNER_SERVICE_ID;

// Workspace-scoped model-runner, deliberately NOT client-qualified so it
// load-balances across every `bioimage-io` worker that registers the app.
// Used by callers that always want "whichever worker is free" rather than a
// user-selected site — currently the Annotate page's Cellpose-SAM path.
// The per-site ids above stay in use for the Run Model site toggle.
export const BIOIMAGEIO_MODEL_RUNNER_UNQUALIFIED_SERVICE_ID = 'bioimage-io/model-runner';

// The Cellpose-3 runner serves the handful of zoo models whose architecture
// needs a Cellpose 3.x runtime; model-runner's own runtime ships Cellpose 4
// and rejects them. Unqualified for the same reason as above.
export const BIOIMAGEIO_CELLPOSE3_RUNNER_SERVICE_ID = 'bioimage-io/cellpose3-runner';

export type RunnerSite = 'kth' | 'denbi';

// KTH is the default runner (RUNNER_SITES[0]); deNBI (v1.15.2 async API)
// is always available as the second selectable site. Users switch via the
// RunnerSiteToggle; there is no build-time dev switch.
export const RUNNER_SITES: Array<{ id: RunnerSite; label: string; serviceId: string }> = [
  {
    id: 'kth',
    label: 'KTH',
    serviceId: BIOIMAGEIO_KTH_MODEL_RUNNER_SERVICE_ID,
  },
  {
    id: 'denbi',
    label: 'deNBI',
    serviceId: BIOIMAGEIO_DENBI_MODEL_RUNNER_SERVICE_ID,
  },
];
