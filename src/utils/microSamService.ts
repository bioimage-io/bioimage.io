// Service-ID and helpers for the model-finetune (display "BioImageIO
// Fine-tune") Hypha service that backs the annotation UI's box-prompt
// segmentation and μSAM auto pre-segmentation.
//
// The app runs as a BioEngine app on the shared `bioimage-io` workers. Every
// worker that deploys it registers the same `model-finetune` service name
// (e.g. `bioimage-io/bioengine-worker-denbi-...:model-finetune` and
// `bioimage-io/bioengine-worker-kth-...:model-finetune`), and the app is
// published with public `authorized_users {'*':['*']}`, so it is callable
// cross-workspace from any connected server. We therefore resolve the
// *unqualified* workspace name `bioimage-io/model-finetune` rather than
// a single worker's client-scoped id: Hypha's service selector then spreads
// calls across whichever workers are up. This means the UI transparently
// discovers the service on both the KTH and de.NBI workers, and survives
// worker redeploys (the random `:<uid>` suffix in the per-client id changes
// on every restart, an unqualified name does not).
//
// round-29 Phase B (colab-rework-plan.md §29, 2026-08-17): this service was
// renamed from `micro-sam` (0.9.x) to `bioimageio-finetune` (0.10.0) when it
// grew to serve all 6 μSAM generalists (3 LM + 3 EM organelles) for both
// segmentation inference and fine-tuning. The rename is a byte-identical RPC
// contract, so no call-site shape changed, only this constant.
//
// round-31c (2026-08-18): renamed again, `bioimageio-finetune` ->
// `model-finetune`, to pair with `model-runner` and avoid the
// bioimage-io/bioimageio stutter. Again byte-identical, only this constant
// changes. The old service stays registered until every frontend deploy has
// switched, then retires.
//
// Unlike cellpose-finetuning (see utils/cellposeServicePin.ts), this service
// is stateless across replicas for segmentation calls, so there is nothing to
// pin: every call re-resolves a fresh handle (Hypha handles expire after a
// few minutes of inactivity) and load-balances to the least-busy worker.

// Workspace-scoped service name. Deliberately NOT client-qualified so it
// load-balances across every `bioimage-io` worker that registers
// `model-finetune`.
export const MICRO_SAM_SERVICE_ID = 'bioimage-io/model-finetune';

// Model type used for every μSAM call. As of micro-sam 0.7.0 the service
// default flipped to 'vit_l_lm' (DeepBacs zero-shot mean F1 0.229 -> 0.799 vs
// 'vit_b_lm'), so we pin the larger model here. The value must be identical
// across compute_embedding, get_onnx_model, and infer: the in-browser ONNX
// prompt decoder only produces correct masks when it matches the encoder that
// generated the embedding. ('vit_b_lm' is the lighter fallback if ever needed.)
export const MICRO_SAM_MODEL_TYPE = 'vit_l_lm';

/** One selectable μSAM generalist in the Full Image Segmentation model
 *  picker. ``group`` drives which subheader an option renders under.
 *  ``trainableOnT4`` is fine-tuning-specific: serving (segmentation/
 *  annotation) never reads it, only MICRO_SAM_TRAINABLE_MODEL_OPTIONS
 *  filters on it. */
export interface MicroSamModelOption {
  modelType: string;
  group: 'lm' | 'em_organelles';
  label: string;
  trainableOnT4: boolean;
}

/** Human-readable subheader per group, in display order. Only groups that
 *  actually have entries in ``MICRO_SAM_MODEL_OPTIONS`` render, so adding a
 *  new group here has no effect until options for it exist below. */
export const MICRO_SAM_GROUP_LABELS: Record<MicroSamModelOption['group'], string> = {
  lm: 'μSAM: light microscopy',
  em_organelles: 'μSAM: EM organelles',
};

// Phase B (colab-rework-plan.md §29, 2026-08-17): all 6 generalists are now
// served by model-finetune (née bioimageio-finetune) 0.10.0. The selector
// groups by `group` generically, so this array is the single place either
// group's membership is defined.
//
// trainableOnT4: false on both "Large" entries per colab-rework-plan.md §20.2
// and confirmed again on 0.10.0 (round-30, 2026-08-17, keen-puma relaying
// live-kudu's 0.8.5 test): vit_l_* OOMs the deNBI T4 during fine-tuning,
// serving is unaffected. Flip to true here once a backend fix lands. This is
// training-only: the segmentation/annotation selector ignores this flag and
// keeps offering all 6.
export const MICRO_SAM_MODEL_OPTIONS: MicroSamModelOption[] = [
  { modelType: 'vit_t_lm', group: 'lm', label: 'Tiny', trainableOnT4: true },
  { modelType: 'vit_b_lm', group: 'lm', label: 'Base', trainableOnT4: true },
  { modelType: 'vit_l_lm', group: 'lm', label: 'Large (default)', trainableOnT4: false },
  { modelType: 'vit_t_em_organelles', group: 'em_organelles', label: 'Tiny', trainableOnT4: true },
  { modelType: 'vit_b_em_organelles', group: 'em_organelles', label: 'Base', trainableOnT4: true },
  { modelType: 'vit_l_em_organelles', group: 'em_organelles', label: 'Large', trainableOnT4: false },
];

/** Subset of MICRO_SAM_MODEL_OPTIONS safe to offer as a fine-tuning base
 *  model. Use this (not MICRO_SAM_MODEL_OPTIONS) for the Finetune page's
 *  base-model picker; the Full Image Segmentation / annotation picker should
 *  keep using the full list. */
export const MICRO_SAM_TRAINABLE_MODEL_OPTIONS: MicroSamModelOption[] =
  MICRO_SAM_MODEL_OPTIONS.filter((o) => o.trainableOnT4);

/**
 * Resolve a fresh handle to the BioImageIO Fine-tune service. Cheap (one
 * websocket round-trip) so callers re-resolve unconditionally instead of
 * caching, which sidesteps the `Method expired or not found` failure a stale
 * handle would raise.
 *
 * Resolution uses the `select:min:get_load` selector against the unqualified
 * `bioimage-io/model-finetune` name, so when the app is deployed on more
 * than one worker (KTH + de.NBI) each call lands on the least-busy replica.
 * This mirrors how the model-runner resolves across workers (see
 * hooks/useModelRunners.ts). Segmentation calls are stateless across
 * replicas, so load-based selection is safe.
 *
 * @param server A connected hypha-rpc server object.
 * @returns The service proxy.
 * @throws If the service cannot be reached.
 */
export async function resolveMicroSamService(server: any): Promise<any> {
  try {
    return await server.getService(MICRO_SAM_SERVICE_ID, {
      mode: 'select:min:get_load',
    });
  } catch (err) {
    throw new Error(
      `The micro-sam segmentation service is not available (${(err as Error)?.message || err})`,
    );
  }
}
