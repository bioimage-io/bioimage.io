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

// Dev/staging model-runner (v1.15.0+). Override the KTH service ID for
// Playwright tests and local dev without touching the production path.
// Set VITE_MODEL_RUNNER_DEV=true to activate (see playwright.config.ts).
//
// The dev app registers as application_id="model-runner-dev" on Hypha,
// which creates the workspace-scoped alias below. The pod-hash-qualified
// form (bioimage-io/bioengine-worker-kth-<hash>:model-runner-dev) also
// works but rotates on helm upgrades — use the alias instead.
export const BIOIMAGEIO_KTH_MODEL_RUNNER_DEV_SERVICE_ID = 'bioimage-io/model-runner-dev';

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

export const RUNNER_SITES: Array<{ id: RunnerSite; label: string; serviceId: string }> = [
  {
    id: 'kth',
    label: MODEL_RUNNER_DEV_MODE ? 'KTH (dev)' : 'KTH',
    serviceId: MODEL_RUNNER_DEV_MODE
      ? BIOIMAGEIO_KTH_MODEL_RUNNER_DEV_SERVICE_ID
      : BIOIMAGEIO_KTH_MODEL_RUNNER_SERVICE_ID,
  },
  { id: 'denbi', label: 'deNBI', serviceId: BIOIMAGEIO_DENBI_MODEL_RUNNER_SERVICE_ID },
];
