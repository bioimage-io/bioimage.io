import { create } from 'zustand';
import { MICRO_SAM_MODEL_TYPE, MICRO_SAM_MODEL_OPTIONS } from '../utils/microSamService';

export type AnnotationTool = 'move' | 'select' | 'polygon' | 'cutter' | 'eraser' | 'expander' | 'sambox';

export interface Label {
  id: string;
  name: string;
  color: string;
}

const DEFAULT_LABELS: Label[] = [
  { id: 'cell', name: 'Cell', color: '#0084ff' },
  { id: 'nucleus', name: 'Nucleus', color: '#fa3c4c' },
  { id: 'background', name: 'Background', color: '#44bec7' },
];

/** Snapshot of vector source state for undo */
export interface UndoSnapshot {
  geojson: string;
}

const MAX_UNDO = 10;

// Round 33: brush painting mode. 'lasso' is the existing freehand-outline
// behavior for the polygon/expander/eraser tools; 'brush' swaps it for a
// circular painting cursor performing the same new/add/remove mask ops.
export type DrawMode = 'lasso' | 'brush';

export const MIN_BRUSH_RADIUS = 5;
export const MAX_BRUSH_RADIUS = 150;
export const BRUSH_RADIUS_STEP = 5;
const DEFAULT_BRUSH_RADIUS = 20;

function clampBrushRadius(radius: number): number {
  return Math.min(MAX_BRUSH_RADIUS, Math.max(MIN_BRUSH_RADIUS, radius));
}

const DRAW_MODE_STORAGE_KEY = 'bioimage-annotation-draw-mode';
const BRUSH_RADIUS_STORAGE_KEY = 'bioimage-annotation-brush-radius';
const SAMBOX_MODEL_STORAGE_KEY = 'bioimage-annotation-sambox-model-type';

const SAMBOX_MODEL_TYPES = MICRO_SAM_MODEL_OPTIONS.map((o) => o.modelType);

function readStoredSamBoxModelType(): string {
  try {
    const raw = window.localStorage.getItem(SAMBOX_MODEL_STORAGE_KEY);
    if (raw && SAMBOX_MODEL_TYPES.includes(raw)) return raw;
    return MICRO_SAM_MODEL_TYPE;
  } catch {
    return MICRO_SAM_MODEL_TYPE;
  }
}

function persistSamBoxModelType(modelType: string) {
  try {
    window.localStorage.setItem(SAMBOX_MODEL_STORAGE_KEY, modelType);
  } catch {
    // localStorage unavailable (private mode); falls back to session-only.
  }
}

function readStoredDrawMode(): DrawMode {
  try {
    const raw = window.localStorage.getItem(DRAW_MODE_STORAGE_KEY);
    if (raw === 'lasso') return 'lasso';
    return 'brush';
  } catch {
    return 'brush';
  }
}

function persistDrawMode(mode: DrawMode) {
  try {
    window.localStorage.setItem(DRAW_MODE_STORAGE_KEY, mode);
  } catch {
    // localStorage unavailable (private mode); falls back to session-only.
  }
}

function readStoredBrushRadius(): number {
  try {
    const raw = window.localStorage.getItem(BRUSH_RADIUS_STORAGE_KEY);
    if (raw === null) return DEFAULT_BRUSH_RADIUS;
    const n = Number(raw);
    return Number.isFinite(n) ? clampBrushRadius(n) : DEFAULT_BRUSH_RADIUS;
  } catch {
    return DEFAULT_BRUSH_RADIUS;
  }
}

function persistBrushRadius(radius: number) {
  try {
    window.localStorage.setItem(BRUSH_RADIUS_STORAGE_KEY, String(radius));
  } catch {
    // localStorage unavailable (private mode); falls back to session-only.
  }
}

// Round 33: mask color is a single hue applied uniformly to every mask
// (existing + future), saturation/lightness held fixed. The default hue
// matches the previous default mask color (#0084ff) so nothing changes
// visually until a user opens the mask color dialog.
export const DEFAULT_MASK_HUE = 209;
export const MASK_COLOR_SATURATION = 100;
export const MASK_COLOR_LIGHTNESS = 50;

const MASK_HUE_STORAGE_KEY = 'bioimage-annotation-mask-hue';

function readStoredMaskHue(): number {
  try {
    const raw = window.localStorage.getItem(MASK_HUE_STORAGE_KEY);
    if (raw === null) return DEFAULT_MASK_HUE;
    const n = Number(raw);
    return Number.isFinite(n) ? Math.min(360, Math.max(0, n)) : DEFAULT_MASK_HUE;
  } catch {
    return DEFAULT_MASK_HUE;
  }
}

function persistMaskHue(hue: number) {
  try {
    window.localStorage.setItem(MASK_HUE_STORAGE_KEY, String(hue));
  } catch {
    // localStorage unavailable (private mode); the in-memory value still
    // applies for the rest of this session, it just won't survive reload.
  }
}

/** HSL (hue in degrees, saturation/lightness in percent) -> `#rrggbb`. */
export function hslToHex(h: number, s: number, l: number): string {
  const sat = s / 100;
  const light = l / 100;
  const k = (n: number) => (n + h / 30) % 12;
  const a = sat * Math.min(light, 1 - light);
  const f = (n: number) => light - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)));
  const toHex = (n: number) => Math.round(f(n) * 255).toString(16).padStart(2, '0');
  return `#${toHex(0)}${toHex(8)}${toHex(4)}`;
}

export interface AnnotationState {
  activeTool: AnnotationTool;
  setActiveTool: (tool: AnnotationTool) => void;

  labels: Label[];
  activeLabel: Label;
  setActiveLabel: (label: Label) => void;

  imageUrl: string | null;
  imageWidth: number;
  imageHeight: number;
  setImageInfo: (url: string, width: number, height: number) => void;

  segmentationPending: boolean;
  setSegmentationPending: (pending: boolean) => void;

  isLoading: boolean;
  setIsLoading: (loading: boolean) => void;

  error: string | null;
  setError: (error: string | null) => void;

  undoStack: UndoSnapshot[];
  pushUndo: (snapshot: UndoSnapshot) => void;
  popUndo: () => UndoSnapshot | undefined;
  canUndo: boolean;

  /** Persisted so it survives reload, since it changes the gesture of the
   *  adjacent draw/erase/expand tools and gets flipped often mid-annotation. */
  drawMode: DrawMode;
  setDrawMode: (mode: DrawMode) => void;

  /** Persisted alongside drawMode for the same reason. */
  brushRadius: number;
  setBrushRadius: (radius: number) => void;
  increaseBrushRadius: (step?: number) => void;
  decreaseBrushRadius: (step?: number) => void;

  /** Single hue (0-360) applied to every mask's fill/stroke. Persisted so it
   *  survives reload. */
  maskHue: number;
  setMaskHue: (hue: number) => void;
  resetMaskHue: () => void;

  /** Which of the 6 uSAM generalists the Interactive Segmentation (sambox)
   *  tool uses. Persisted since it's a deliberate, infrequent choice made via
   *  the model-selection dialog, not per-session state. Selecting a model
   *  here downloads nothing; the decoder and embedding are fetched lazily on
   *  first use. */
  samBoxModelType: string;
  setSamBoxModelType: (modelType: string) => void;
}

export const useAnnotationStore = create<AnnotationState>((set, get) => ({
  activeTool: 'move',
  setActiveTool: (tool) => set({ activeTool: tool }),

  labels: DEFAULT_LABELS,
  activeLabel: DEFAULT_LABELS[0],
  setActiveLabel: (label) => set({ activeLabel: label }),

  imageUrl: null,
  imageWidth: 0,
  imageHeight: 0,
  setImageInfo: (url, width, height) => set({ imageUrl: url, imageWidth: width, imageHeight: height }),

  segmentationPending: false,
  setSegmentationPending: (pending) => set({ segmentationPending: pending }),

  isLoading: false,
  setIsLoading: (loading) => set({ isLoading: loading }),

  error: null,
  setError: (error) => set({ error }),

  undoStack: [],
  canUndo: false,
  pushUndo: (snapshot) => set((state) => {
    const stack = [...state.undoStack, snapshot].slice(-MAX_UNDO);
    return { undoStack: stack, canUndo: stack.length > 0 };
  }),
  popUndo: () => {
    const state = get();
    if (state.undoStack.length === 0) return undefined;
    const stack = [...state.undoStack];
    const snapshot = stack.pop()!;
    set({ undoStack: stack, canUndo: stack.length > 0 });
    return snapshot;
  },

  drawMode: readStoredDrawMode(),
  setDrawMode: (mode) => {
    persistDrawMode(mode);
    set({ drawMode: mode });
  },

  brushRadius: readStoredBrushRadius(),
  setBrushRadius: (radius) => {
    const clamped = clampBrushRadius(radius);
    persistBrushRadius(clamped);
    set({ brushRadius: clamped });
  },
  // The runtime typeof guard (not just the default) matters: passing these
  // straight to onClick hands them a MouseEvent as `step`, and
  // radius + event = NaN, which clamp then propagates.
  increaseBrushRadius: (step = BRUSH_RADIUS_STEP) => set((state) => {
    const s = typeof step === 'number' && Number.isFinite(step) ? step : BRUSH_RADIUS_STEP;
    const clamped = clampBrushRadius(state.brushRadius + s);
    persistBrushRadius(clamped);
    return { brushRadius: clamped };
  }),
  decreaseBrushRadius: (step = BRUSH_RADIUS_STEP) => set((state) => {
    const s = typeof step === 'number' && Number.isFinite(step) ? step : BRUSH_RADIUS_STEP;
    const clamped = clampBrushRadius(state.brushRadius - s);
    persistBrushRadius(clamped);
    return { brushRadius: clamped };
  }),

  maskHue: readStoredMaskHue(),
  setMaskHue: (hue) => {
    const clamped = Math.min(360, Math.max(0, hue));
    persistMaskHue(clamped);
    set({ maskHue: clamped });
  },
  resetMaskHue: () => {
    persistMaskHue(DEFAULT_MASK_HUE);
    set({ maskHue: DEFAULT_MASK_HUE });
  },

  samBoxModelType: readStoredSamBoxModelType(),
  setSamBoxModelType: (modelType) => {
    persistSamBoxModelType(modelType);
    set({ samBoxModelType: modelType });
  },
}));
