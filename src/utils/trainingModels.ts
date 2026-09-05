/**
 * The catalogue of base models the fine-tuning UI can offer, across BOTH
 * backends served by `bioimage-io/model-finetune` (micro-sam `vit_*` and
 * Cellpose `cpsam` / `cpdino*`), plus the parameter form for a chosen model.
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
 * Everything comes from the backend
 * ---------------------------------
 * `get_training_capabilities()` reports every model with its `backend`,
 * `family` and `size`, and every tunable parameter with its type, default and
 * bounds. So a model or a knob added server-side shows up without a frontend
 * release, and this module is an ADAPTER, not a catalogue: it turns those
 * fields into group keys, button labels and form fields.
 *
 * The static tables below exist for exactly two situations, and are never
 * consulted when the live answer is available:
 *
 *  - capabilities are missing entirely (trainer down, still loading, call
 *    failed), where offering the known catalogue beats an empty picker;
 *  - the resolved replica is still on model-finetune 0.14.0, which reports
 *    neither `family`/`size` nor `parameters`. Workers upgrade one site at a
 *    time and the UI resolves an unqualified service id, so a request can land
 *    on either version until every site has rolled.
 */
import { TrainingCapabilities, TrainingParameterInfo } from './trainingCapabilities';

export interface TrainingModelOption {
  modelType: string;
  /** 'microsam' | 'cellpose' today. Treat as an open string set. */
  backend: string;
  /** Subheader key this entry renders under, from the backend's `family`. */
  group: string;
  label: string;
  /** 'tiny' | 'base' | 'large' | 'huge', when the backend reports one. */
  size?: string;
}

/** Subheader text per group. Unknown groups fall back to their raw key. */
export const TRAINING_GROUP_LABELS: Record<string, string> = {
  lm: 'μSAM: light microscopy',
  em_organelles: 'μSAM: EM organelles',
  sam: 'μSAM: Segment Anything',
  cpsam: 'Cellpose-SAM',
  cpdino: 'Cellpose-DINO',
  // Only reachable on a 0.14.0 replica, which reports no `family`.
  cellpose: 'Cellpose',
};

/** Group render order. Groups not listed here follow, in first-seen order. */
const GROUP_ORDER = ['lm', 'em_organelles', 'sam', 'cpsam', 'cpdino', 'cellpose'];

/** Button text per size, and the order sizes render in within a group. */
const SIZE_LABELS: Record<string, string> = {
  tiny: 'Tiny',
  base: 'Base',
  large: 'Large',
  huge: 'Huge',
};
const SIZE_ORDER = ['tiny', 'base', 'large', 'huge'];

/**
 * Group and label for the model types a 0.14.0 replica reports without them.
 * Presentation only: nothing here decides whether a model is offered or
 * trainable, that is the backend's call.
 */
const FALLBACK_PRESENTATION: Record<string, { group: string; label: string; backend: string }> = {
  vit_t_lm: { group: 'lm', label: 'Tiny', backend: 'microsam' },
  vit_b_lm: { group: 'lm', label: 'Base', backend: 'microsam' },
  vit_l_lm: { group: 'lm', label: 'Large', backend: 'microsam' },
  vit_t_em_organelles: { group: 'em_organelles', label: 'Tiny', backend: 'microsam' },
  vit_b_em_organelles: { group: 'em_organelles', label: 'Base', backend: 'microsam' },
  vit_l_em_organelles: { group: 'em_organelles', label: 'Large', backend: 'microsam' },
  cpsam: { group: 'cellpose', label: 'Cellpose-SAM', backend: 'cellpose' },
  cpdino: { group: 'cellpose', label: 'Cellpose-DINO', backend: 'cellpose' },
  'cpdino-vitb': { group: 'cellpose', label: 'Cellpose-DINO (ViT-B)', backend: 'cellpose' },
};

/**
 * The catalogue to fall back on when capabilities are unavailable (trainer
 * down, still loading, or the call failed). Offering everything is the right
 * failure mode: `start_training` rejects an unfit model with a message naming
 * the shortfall, so an over-permissive picker costs one click, whereas an empty
 * one is a dead end the user cannot argue with.
 */
const FALLBACK_ORDER = Object.keys(FALLBACK_PRESENTATION);

const toOption = (m: {
  model_type: string;
  backend?: string;
  family?: string;
  size?: string;
}): TrainingModelOption => {
  const fallback = FALLBACK_PRESENTATION[m.model_type];
  const backend = m.backend ?? fallback?.backend ?? 'microsam';
  const sizeLabel = m.size ? SIZE_LABELS[m.size] ?? m.size : undefined;
  return {
    modelType: m.model_type,
    backend,
    // Without a family (0.14.0) the static map answers, and an unknown type
    // still renders under its backend rather than being silently dropped.
    group: m.family ?? fallback?.group ?? backend,
    label: sizeLabel ?? fallback?.label ?? m.model_type,
    size: m.size,
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
    ? caps.models.map(toOption)
    : FALLBACK_ORDER.map((t) => toOption({ model_type: t }));

  const groups: string[] = [];
  for (const key of GROUP_ORDER) {
    if (source.some((o) => o.group === key)) groups.push(key);
  }
  for (const option of source) {
    if (!groups.includes(option.group)) groups.push(option.group);
  }

  // Smallest first, so the entry most likely to fit the GPU leads. A model with
  // no size sorts last, and Array.sort is stable, so those keep the order the
  // backend sent them in.
  const rank = (option: TrainingModelOption) => {
    const i = option.size ? SIZE_ORDER.indexOf(option.size) : -1;
    return i === -1 ? SIZE_ORDER.length : i;
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
 * Does the resolved replica understand `start_training(init_checkpoint=...)`?
 *
 * There is no dedicated flag for it, so this keys off `parameters`: the two
 * shipped together in model-finetune 0.15.0, and the whole point is to avoid
 * offering a checkpoint source that a 0.14.0 replica would reject. When
 * capabilities are missing we answer false, because this gates an extra option
 * rather than the whole picker, so the safe default is to leave it out.
 */
export function supportsInitCheckpoint(caps: TrainingCapabilities | null): boolean {
  return Array.isArray(caps?.parameters);
}

/** One field of the training-parameter form. */
export interface TrainingParamSpec {
  name: string;
  label: string;
  /** Backends this parameter is accepted by. */
  appliesTo: string[];
  type: 'integer' | 'number';
  /** `null` means the backend picks it, so the field renders empty. */
  default: number | null;
  min?: number | null;
  max?: number | null;
  step?: number;
  help?: string;
}

/**
 * What a 0.14.0 replica accepts. Superseded by `capabilities.parameters` the
 * moment the replica reports it.
 */
const FALLBACK_PARAM_SPECS: TrainingParamSpec[] = [
  { name: 'n_epochs', label: 'Epochs', appliesTo: ['microsam', 'cellpose'], type: 'integer', default: 5, min: 1, step: 1 },
  { name: 'batch_size', label: 'Batch size', appliesTo: ['microsam', 'cellpose'], type: 'integer', default: 1, min: 1, step: 1 },
  { name: 'learning_rate', label: 'Learning rate', appliesTo: ['microsam', 'cellpose'], type: 'number', default: 1e-5, min: 0, step: 0.00001 },
  {
    name: 'n_objects_per_batch',
    label: 'Objects per batch',
    appliesTo: ['microsam'],
    type: 'integer',
    default: 8,
    min: 1,
    step: 1,
    help: 'How many annotated objects each training step samples.',
  },
  {
    name: 'patch_size',
    label: 'Patch size',
    appliesTo: ['microsam'],
    type: 'integer',
    default: 512,
    min: 16,
    step: 1,
    help: 'Edge length of the crops cut from each image.',
  },
  {
    name: 'diam_mean',
    label: 'Mean diameter',
    appliesTo: ['cellpose'],
    type: 'number',
    default: 30,
    min: 0,
    step: 0.1,
    help: 'Typical object diameter in pixels, in the images you annotated.',
  },
];

/** Field text for the parameter names whose snake_case does not read well. */
const PARAM_LABELS: Record<string, string> = {
  n_epochs: 'Epochs',
  batch_size: 'Batch size',
  learning_rate: 'Learning rate',
  val_fraction: 'Validation fraction',
  n_samples: 'Samples per epoch',
  n_objects_per_batch: 'Objects per batch',
  patch_size: 'Patch size',
  diam_mean: 'Mean diameter',
};

const labelForParam = (name: string): string =>
  PARAM_LABELS[name] ?? name.replace(/_/g, ' ').replace(/^./, (c) => c.toUpperCase());

/**
 * Adapt the backend's own prose for the UI.
 *
 * Two things have to go. The "micro-sam only:" / "cellpose only (...):"
 * prefixes are redundant here because the form already renders only the
 * parameters that apply to the chosen model. And the dashes and semicolons the
 * Python docstrings use are banned in the site's user-visible copy, so they are
 * rewritten into commas and sentences rather than passed through.
 */
const cleanParamDescription = (text?: string): string | undefined => {
  if (!text) return undefined;
  const cleaned = text
    .replace(/^[a-z0-9 \-/()]{0,40}only[a-z0-9 \-/()]{0,20}:\s*/i, '')
    .replace(/\s*[–—]\s*/g, ', ')
    .replace(/;\s+(\w)/g, (_m, c: string) => `. ${c.toUpperCase()}`)
    .trim();
  if (!cleaned) return undefined;
  return cleaned.replace(/^./, (c) => c.toUpperCase());
};

/** A sensible arrow-key increment for a field the backend only typed. */
const stepForParam = (type: string, def: number | null): number => {
  if (type === 'integer') return 1;
  const magnitude = def ?? 1;
  if (magnitude > 0 && magnitude < 0.001) return 0.00001;
  if (magnitude < 1) return 0.05;
  return 0.1;
};

const toParamSpec = (p: TrainingParameterInfo): TrainingParamSpec => {
  const type = p.type === 'integer' ? 'integer' : 'number';
  return {
    name: p.name,
    label: labelForParam(p.name),
    appliesTo: p.applies_to ?? [],
    type,
    default: p.default ?? null,
    min: p.min ?? null,
    max: p.max ?? null,
    step: stepForParam(type, p.default ?? null),
    help: cleanParamDescription(p.description),
  };
};

/**
 * The parameters one backend accepts, in the order the backend listed them.
 *
 * @param caps    Live capabilities, or null while loading or after a failure.
 * @param backend The chosen model's backend, or undefined when it is not
 *                resolved yet, in which case every parameter is returned so
 *                the caller can tell "no fields" from "not known yet".
 */
export function trainingParamsFor(
  caps: TrainingCapabilities | null,
  backend: string | undefined,
): TrainingParamSpec[] {
  const specs = caps?.parameters?.length
    ? caps.parameters.map(toParamSpec)
    : FALLBACK_PARAM_SPECS;
  if (!backend) return specs;
  return specs.filter((p) => p.appliesTo.includes(backend));
}

/**
 * Seed the form from the specs. Values are strings so a field can be left
 * empty, which is how a parameter with no default ("auto") is expressed: an
 * empty field is omitted from the call and the backend decides.
 */
export function defaultTrainingParams(specs: TrainingParamSpec[]): Record<string, string> {
  const out: Record<string, string> = {};
  specs.forEach((spec) => {
    out[spec.name] = spec.default == null ? '' : String(spec.default);
  });
  return out;
}

/**
 * Turn the form's strings into `start_training` kwargs, enforcing the bounds
 * the backend reported. Empty fields are dropped rather than sent as zero.
 *
 * @returns The kwargs to spread into the call, or an error naming the first
 *          field that is out of range.
 */
export function validateTrainingParams(
  specs: TrainingParamSpec[],
  values: Record<string, string>,
): { values: Record<string, number>; error: string | null } {
  const out: Record<string, number> = {};
  for (const spec of specs) {
    const raw = (values[spec.name] ?? '').trim();
    if (!raw) continue;
    const parsed = Number(raw);
    if (!Number.isFinite(parsed)) {
      return { values: out, error: `${spec.label} must be a number.` };
    }
    if (spec.type === 'integer' && !Number.isInteger(parsed)) {
      return { values: out, error: `${spec.label} must be a whole number.` };
    }
    if (spec.min != null && parsed < spec.min) {
      return { values: out, error: `${spec.label} must be at least ${spec.min}.` };
    }
    if (spec.max != null && parsed > spec.max) {
      return { values: out, error: `${spec.label} must be at most ${spec.max}.` };
    }
    out[spec.name] = parsed;
  }
  return { values: out, error: null };
}
