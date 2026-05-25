// Service-ID patterns used by the bioimage.io website to talk to the
// production BioEngine workers hosted on the public `bioimage-io` Hypha
// workspace.
//
// Multiple BioEngine workers can be registered on the workspace at the
// same time (e.g. KTH for production, deNBI / TÜBİTAK during onboarding
// or testing). The website pins itself to the KTH worker via a glob on
// the pod client_id:
//
//     <pod-name>:<service-name>
//     ^^^^^^^^^^
//     this part is `bioengine-worker-kth-<replicaset>-<rand>` for KTH
//     pods (and per-app sub-clients inherit the same prefix), so a
//     `bioengine-worker-kth-*` glob on the client_id portion matches
//     KTH and only KTH.
//
// Hypha resolves the glob server-side (verified live, May 2026), so
// callers can pass these strings straight to `server.getService(...)`.
// To re-pin to a different worker, change the prefix here and every
// call site updates in lockstep.

export const BIOIMAGEIO_WORKER_CLIENT_GLOB = 'bioengine-worker-kth-*';

export const BIOIMAGEIO_WORKER_SERVICE_ID =
  `bioimage-io/${BIOIMAGEIO_WORKER_CLIENT_GLOB}:bioengine-worker`;

export const BIOIMAGEIO_MODEL_RUNNER_SERVICE_ID =
  `bioimage-io/${BIOIMAGEIO_WORKER_CLIENT_GLOB}:model-runner`;
