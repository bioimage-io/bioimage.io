// Service-ID and helpers for the micro-sam (μSAM) Hypha service that backs the
// annotation UI's box-prompt segmentation and μSAM auto pre-segmentation.
//
// The service runs on a Europa BioEngine worker and is published with public
// `authorized_users {'*':['*']}`, so it is callable cross-workspace by its
// fully-qualified id from any connected server. Unlike cellpose-finetuning
// (see utils/cellposeServicePin.ts), μSAM is stateless across replicas, so
// there is nothing to pin: every call re-resolves a fresh handle (Hypha
// handles expire after a few minutes of inactivity).

// Fully-qualified μSAM service id (workspace-prefixed so it resolves from the
// user's own workspace connection).
export const MICRO_SAM_SERVICE_ID = 'ws-user-github|49943582/micro-sam';

// The only model type deployed on the live service today.
export const MICRO_SAM_MODEL_TYPE = 'vit_b_lm';

/**
 * Resolve a fresh handle to the μSAM service. Cheap (one websocket round-trip)
 * so callers re-resolve unconditionally instead of caching, which sidesteps the
 * `Method expired or not found` failure a stale handle would raise.
 *
 * @param server A connected hypha-rpc server object.
 * @returns The μSAM service proxy.
 * @throws If the service cannot be reached.
 */
export async function resolveMicroSamService(server: any): Promise<any> {
  try {
    return await server.getService(MICRO_SAM_SERVICE_ID);
  } catch (err) {
    throw new Error(
      `micro-sam service is not available (${(err as Error)?.message || err})`,
    );
  }
}
