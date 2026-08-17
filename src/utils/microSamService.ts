// Service-ID and helpers for the micro-sam (μSAM) Hypha service that backs the
// annotation UI's box-prompt segmentation and μSAM auto pre-segmentation.
//
// The μSAM app runs as a BioEngine app on the shared `bioimage-io` workers.
// Every worker that deploys it registers the same `micro-sam` service name
// (e.g. `bioimage-io/bioengine-worker-denbi-...:micro-sam` and
// `bioimage-io/bioengine-worker-kth-...:micro-sam`), and the app is published
// with public `authorized_users {'*':['*']}`, so it is callable cross-workspace
// from any connected server. We therefore resolve the *unqualified* workspace
// name `bioimage-io/micro-sam` rather than a single worker's client-scoped id:
// Hypha's service selector then spreads calls across whichever workers are up.
// This means the UI transparently discovers micro-sam on both the KTH and
// de.NBI workers, and survives worker redeploys (the random `:<uid>` suffix in
// the per-client id changes on every restart, an unqualified name does not).
//
// Unlike cellpose-finetuning (see utils/cellposeServicePin.ts), μSAM is
// stateless across replicas, so there is nothing to pin: every call re-resolves
// a fresh handle (Hypha handles expire after a few minutes of inactivity) and
// load-balances to the least-busy worker.

// Workspace-scoped μSAM service name. Deliberately NOT client-qualified so it
// load-balances across every `bioimage-io` worker that registers `micro-sam`.
export const MICRO_SAM_SERVICE_ID = 'bioimage-io/micro-sam';

// Model type used for every μSAM call. As of micro-sam 0.7.0 the service
// default flipped to 'vit_l_lm' (DeepBacs zero-shot mean F1 0.229 -> 0.799 vs
// 'vit_b_lm'), so we pin the larger model here. The value must be identical
// across compute_embedding, get_onnx_model, and infer: the in-browser ONNX
// prompt decoder only produces correct masks when it matches the encoder that
// generated the embedding. ('vit_b_lm' is the lighter fallback if ever needed.)
export const MICRO_SAM_MODEL_TYPE = 'vit_l_lm';

/** One selectable μSAM generalist in the Full Image Segmentation model
 *  picker. ``group`` drives which subheader an option renders under. */
export interface MicroSamModelOption {
  modelType: string;
  group: 'lm' | 'em_organelles';
  label: string;
}

/** Human-readable subheader per group, in display order. Only groups that
 *  actually have entries in ``MICRO_SAM_MODEL_OPTIONS`` render, so adding a
 *  new group here has no effect until options for it exist below. */
export const MICRO_SAM_GROUP_LABELS: Record<MicroSamModelOption['group'], string> = {
  lm: 'μSAM: light microscopy',
  em_organelles: 'μSAM: EM organelles',
};

// Phase A (colab-rework-plan.md §29, live-kudu confirmed 2026-08-17): the
// current prod service (0.9.1) only accepts the 3 LM generalists here; the
// EM organelle trio (vit_t_em_organelles / vit_b_em_organelles /
// vit_l_em_organelles) is rejected by its pydantic model_type whitelist.
// Phase B appends those 3 entries once bioimageio-finetune is live, e.g.:
//   { modelType: 'vit_t_em_organelles', group: 'em_organelles', label: 'Tiny' },
//   { modelType: 'vit_b_em_organelles', group: 'em_organelles', label: 'Base' },
//   { modelType: 'vit_l_em_organelles', group: 'em_organelles', label: 'Large' },
// The selector groups by `group` generically, so appending is the only
// change needed here to make the EM subheader appear.
export const MICRO_SAM_MODEL_OPTIONS: MicroSamModelOption[] = [
  { modelType: 'vit_t_lm', group: 'lm', label: 'Tiny' },
  { modelType: 'vit_b_lm', group: 'lm', label: 'Base' },
  { modelType: 'vit_l_lm', group: 'lm', label: 'Large (default)' },
];

/**
 * Resolve a fresh handle to the μSAM service. Cheap (one websocket round-trip)
 * so callers re-resolve unconditionally instead of caching, which sidesteps the
 * `Method expired or not found` failure a stale handle would raise.
 *
 * Resolution uses the `select:min:get_load` selector against the unqualified
 * `bioimage-io/micro-sam` name, so when the app is deployed on more than one
 * worker (KTH + de.NBI) each call lands on the least-busy replica. This mirrors
 * how the model-runner resolves across workers (see hooks/useModelRunners.ts).
 * μSAM is stateless across replicas, so load-based selection is safe.
 *
 * @param server A connected hypha-rpc server object.
 * @returns The μSAM service proxy.
 * @throws If the service cannot be reached.
 */
export async function resolveMicroSamService(server: any): Promise<any> {
  try {
    return await server.getService(MICRO_SAM_SERVICE_ID, {
      mode: 'select:min:get_load',
    });
  } catch (err) {
    throw new Error(
      `micro-sam service is not available (${(err as Error)?.message || err})`,
    );
  }
}
