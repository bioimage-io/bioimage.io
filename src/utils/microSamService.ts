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

// Model type used for every μSAM call. As of micro-sam 0.7.0 the service
// default flipped to 'vit_l_lm' (DeepBacs zero-shot mean F1 0.229 -> 0.799 vs
// 'vit_b_lm'), so we pin the larger model here. The value must be identical
// across compute_embedding, get_onnx_model, and infer: the in-browser ONNX
// prompt decoder only produces correct masks when it matches the encoder that
// generated the embedding. ('vit_b_lm' is the lighter fallback if ever needed.)
export const MICRO_SAM_MODEL_TYPE = 'vit_l_lm';

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
