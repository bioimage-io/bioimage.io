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

// Dev/staging switch. deNBI now runs the v1.15.2 async API as its
// PRODUCTION model-runner (the KTH "model-runner-dev" app was torn down,
// July 2026), so dev mode no longer swaps in a separate alias — it just
// promotes the existing deNBI model-runner to the default site.
// Set REACT_APP_MODEL_RUNNER_DEV=true to activate (see playwright.config.ts).
export const MODEL_RUNNER_DEV_MODE =
  process.env.REACT_APP_MODEL_RUNNER_DEV === 'true';

// Worker-admin service id (KTH is the canonical production worker).
export const BIOIMAGEIO_WORKER_CLIENT_GLOB = BIOIMAGEIO_KTH_WORKER_CLIENT_GLOB;
export const BIOIMAGEIO_WORKER_SERVICE_ID =
  `bioimage-io/${BIOIMAGEIO_WORKER_CLIENT_GLOB}:bioengine-worker`;

// Back-compat: existing callers default to KTH. New code should pick
// per-site via useModelRunners().
export const BIOIMAGEIO_MODEL_RUNNER_SERVICE_ID = BIOIMAGEIO_KTH_MODEL_RUNNER_SERVICE_ID;

export type RunnerSite = 'kth' | 'denbi';

const KTH_SITE = {
  id: 'kth' as const,
  label: 'KTH',
  serviceId: BIOIMAGEIO_KTH_MODEL_RUNNER_SERVICE_ID,
};
const DENBI_SITE = {
  id: 'denbi' as const,
  label: MODEL_RUNNER_DEV_MODE ? 'deNBI (dev)' : 'deNBI',
  serviceId: BIOIMAGEIO_DENBI_MODEL_RUNNER_SERVICE_ID,
};

// In dev mode, deNBI (v1.15.2 async API) is the default site; KTH
// (v1.14.0 sync) stays selectable as the second entry. Production keeps
// KTH as the default.
export const RUNNER_SITES: Array<{ id: RunnerSite; label: string; serviceId: string }> =
  MODEL_RUNNER_DEV_MODE ? [DENBI_SITE, KTH_SITE] : [KTH_SITE, DENBI_SITE];
