// Model ids + display labels for the CellposeDINO models served by
// bioimage-io/model-runner (round 38). Unlike μSAM, which groups multiple
// generalists by imaging modality, both DINO entries render under a single
// flat "Cellpose" group in the Full Image Segmentation model picker, next to
// Cellpose-SAM — there is nothing to group by, and no tunable params (see
// CellposeConfigDialog.tsx's isDino-gated control block).
//
// Availability piggybacks on the existing cellposeAvailable probe
// (useHyphaService.ts): both DINO models are served by the same
// bioimage-io/model-runner service id Cellpose-SAM already probes, so there
// is no separate reachability check to wire up.

export interface DinoModelOption {
  modelId: string;
  label: string;
}

export const DINO_MODEL_OPTIONS: DinoModelOption[] = [
  { modelId: 'passionate-bug', label: 'CellposeDINO ViT-B' },
  { modelId: 'famous-sheep', label: 'CellposeDINO ViT-L' },
];
