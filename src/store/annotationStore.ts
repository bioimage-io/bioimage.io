import { create } from 'zustand';

export type AnnotationTool = 'move' | 'select' | 'polygon' | 'cutter' | 'eraser' | 'expander';

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
}));
