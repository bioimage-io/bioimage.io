/**
 * The catalogue of base models the fine-tuning UI can offer, across BOTH
 * backends served by `bioimage-io/model-finetune`: micro-sam (`vit_*`) and
 * Cellpose (`cpsam`, `cpdino*`).
 *
 * Why this is separate from `MICRO_SAM_MODEL_OPTIONS`
 * ---------------------------------------------------
 * That list is an INFERENCE list. It drives the box-prompt picker and the
 * auto-segmentation picker, both of which need a μSAM encoder whose embeddings
 * the in-browser ONNX decoder can consume. The Cellpose types are trainable but
 * have no such decoder, so adding them there would offer segmentation models
 * that cannot segment. Training is the only surface where the two families
 * belong in one picker, so the two catalogues stay separate on purpose.
 *
 * Where the list comes from
 * -------------------------
 * From `get_training_capabilities()`, not from here. The backend already
 * reports every trainable `model_type` with its `backend`, so a model added
 * server-side shows up without a frontend release. This module supplies only
 * what the API does not carry: the display label, which subheader an entry
 * sits under, and the order. An unknown `model_type` still renders, grouped by
 * its backend and labelled with its raw id, rather than being silently dropped.
 *
 * model-finetune 0.15.0 will add additive `family` and `size` keys to the
 * capabilities response. When that rolls, PRESENTATION below can be deleted and
 * the group/label derived from those fields instead.
 */
import { TrainingCapabilities } from './trainingCapabilities';

export interface TrainingModelOption {
  modelType: string;
  /** 'microsam' | 'cellpose' today. Treat as an open string set. */
  backend: string;
  /** Subheader key this entry renders under. */
  group: string;
  label: string;
}

/** Subheader text per group, and the order groups render in. */
export const TRAINING_GROUP_LABELS: Record<string, string> = {
  lm: 'μSAM: light microscopy',
  em_organelles: 'μSAM: EM organelles',
  cellpose: 'Cellpose',
};

/** Group render order. Groups not listed here follow, in first-seen order. */
const GROUP_ORDER = ['lm', 'em_organelles', 'cellpose'];

/**
 * Display metadata for the model types we know about, in the order they should
 * appear within their group. Presentation only: nothing here decides whether a
 * model is offered or trainable, that is the backend's call.
 */
const PRESENTATION: Record<string, { group: string; label: string }> = {
  vit_t_lm: { group: 'lm', label: 'Tiny' },
  vit_b_lm: { group: 'lm', label: 'Base' },
  vit_l_lm: { group: 'lm', label: 'Large' },
  vit_t_em_organelles: { group: 'em_organelles', label: 'Tiny' },
  vit_b_em_organelles: { group: 'em_organelles', label: 'Base' },
  vit_l_em_organelles: { group: 'em_organelles', label: 'Large' },
  cpsam: { group: 'cellpose', label: 'Cellpose-SAM' },
  cpdino: { group: 'cellpose', label: 'Cellpose-DINO' },
  'cpdino-vitb': { group: 'cellpose', label: 'Cellpose-DINO (ViT-B)' },
};

/** Order within a group for the known types, so the API's order does not leak. */
const PRESENTATION_ORDER = Object.keys(PRESENTATION);

/**
 * The catalogue to fall back on when capabilities are unavailable (trainer
 * down, still loading, or the call failed). Offering everything is the right
 * failure mode: `start_training` rejects an unfit model with a message naming
 * the shortfall, so an over-permissive picker costs one click, whereas an empty
 * one is a dead end the user cannot argue with.
 */
const FALLBACK_BACKENDS: Record<string, string> = {
  vit_t_lm: 'microsam',
  vit_b_lm: 'microsam',
  vit_l_lm: 'microsam',
  vit_t_em_organelles: 'microsam',
  vit_b_em_organelles: 'microsam',
  vit_l_em_organelles: 'microsam',
  cpsam: 'cellpose',
  cpdino: 'cellpose',
  'cpdino-vitb': 'cellpose',
};

const toOption = (modelType: string, backend: string): TrainingModelOption => {
  const meta = PRESENTATION[modelType];
  return {
    modelType,
    backend,
    group: meta?.group ?? backend,
    label: meta?.label ?? modelType,
  };
};

/**
 * Build the picker's options from a capabilities response.
 *
 * @param caps The live capabilities, or null while loading or after a failure.
 *             Null yields the static fallback catalogue, never an empty list.
 */
export function buildTrainingModelOptions(
  caps: TrainingCapabilities | null,
): TrainingModelOption[] {
  const source: TrainingModelOption[] = caps?.models?.length
    ? caps.models.map((m) => toOption(m.model_type, m.backend))
    : PRESENTATION_ORDER.map((t) => toOption(t, FALLBACK_BACKENDS[t]));

  const groups: string[] = [];
  for (const key of GROUP_ORDER) {
    if (source.some((o) => o.group === key)) groups.push(key);
  }
  for (const option of source) {
    if (!groups.includes(option.group)) groups.push(option.group);
  }

  const rank = (option: TrainingModelOption) => {
    const i = PRESENTATION_ORDER.indexOf(option.modelType);
    // Unknown types sort after the known ones, keeping the API's own order.
    return i === -1 ? PRESENTATION_ORDER.length : i;
  };

  return groups.flatMap((group) =>
    source.filter((o) => o.group === group).sort((a, b) => rank(a) - rank(b)),
  );
}

/** The distinct groups present in a catalogue, in render order. */
export function trainingGroupsOf(options: TrainingModelOption[]): string[] {
  const seen: string[] = [];
  for (const option of options) {
    if (!seen.includes(option.group)) seen.push(option.group);
  }
  return seen;
}

/** Subheader text for a group, falling back to the raw key for unknown ones. */
export function trainingGroupLabel(group: string): string {
  return TRAINING_GROUP_LABELS[group] ?? group;
}

/** Which backend a model type belongs to, for backend-conditional parameters. */
export function backendOfModel(
  options: TrainingModelOption[],
  modelType: string,
): string | undefined {
  return options.find((o) => o.modelType === modelType)?.backend;
}

/**
 * Which `start_training` parameters apply to which backend.
 *
 * Deliberately one map in one file. model-finetune will derive this from
 * `start_training`'s own Field metadata and return it from
 * `get_training_capabilities` as `{name, applies_to, default, min, max,
 * description}`, at which point the parameter form renders straight from the
 * API and everything below is deleted. Keeping it in a single exported shape
 * means that swap touches this file only, not the form.
 */
export interface TrainingParamSpec {
  name: string;
  label: string;
  /** Backends this parameter is accepted by. */
  appliesTo: string[];
  default: number;
  step?: number;
  help?: string;
}

export const TRAINING_PARAM_SPECS: TrainingParamSpec[] = [
  {
    name: 'n_epochs',
    label: 'Epochs',
    appliesTo: ['microsam', 'cellpose'],
    default: 5,
  },
  {
    name: 'batch_size',
    label: 'Batch size',
    appliesTo: ['microsam', 'cellpose'],
    default: 1,
  },
  {
    name: 'learning_rate',
    label: 'Learning rate',
    appliesTo: ['microsam', 'cellpose'],
    default: 1e-5,
    step: 0.00001,
  },
  {
    name: 'n_objects_per_batch',
    label: 'Objects per batch',
    appliesTo: ['microsam'],
    default: 8,
    help: 'How many annotated objects each training step samples.',
  },
  {
    name: 'patch_size',
    label: 'Patch size',
    appliesTo: ['microsam'],
    default: 512,
    help: 'Edge length of the crops cut from each image.',
  },
  {
    name: 'diam_mean',
    label: 'Mean diameter',
    appliesTo: ['cellpose'],
    default: 30,
    help: 'Typical object diameter in pixels, in the images you annotated.',
  },
];

/** The parameters one backend accepts, in display order. */
export function trainingParamsFor(backend: string | undefined): TrainingParamSpec[] {
  if (!backend) return TRAINING_PARAM_SPECS;
  return TRAINING_PARAM_SPECS.filter((p) => p.appliesTo.includes(backend));
}

/** Every parameter at its default, for seeding the form. */
export function defaultTrainingParams(): Record<string, number> {
  const out: Record<string, number> = {};
  TRAINING_PARAM_SPECS.forEach((p) => {
    out[p.name] = p.default;
  });
  return out;
}
