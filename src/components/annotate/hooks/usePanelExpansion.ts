import { create } from 'zustand';

const TOOLS_KEY = 'bioimage-toolbar-expanded';
const ACTIONS_KEY = 'bioimage-actionpanel-expanded';

function readStored(key: string, fallback: boolean): boolean {
  try {
    const stored = localStorage.getItem(key);
    if (stored !== null) return stored !== 'false';
  } catch {}
  return fallback;
}

const defaultExpanded = typeof window !== 'undefined' && window.innerWidth >= 900;

interface PanelExpansionState {
  toolsExpanded: boolean;
  actionsExpanded: boolean;
  setToolsExpanded: (expanded: boolean, exclusive: boolean) => void;
  setActionsExpanded: (expanded: boolean, exclusive: boolean) => void;
}

/**
 * Shared expand state for the floating tools + actions panels. In portrait
 * they stack top/bottom, and each panel's expanded content can run past
 * half the viewport height, so both expanded at once visually overlap.
 * `exclusive` (passed as the current isPortrait value by the caller)
 * collapses the other panel when one expands; landscape callers pass
 * `false` since the two panels sit on opposite edges with no overlap risk.
 */
export const usePanelExpansion = create<PanelExpansionState>((set) => ({
  toolsExpanded: readStored(TOOLS_KEY, defaultExpanded),
  actionsExpanded: readStored(ACTIONS_KEY, defaultExpanded),
  setToolsExpanded: (expanded, exclusive) => {
    try { localStorage.setItem(TOOLS_KEY, String(expanded)); } catch {}
    set((state) => ({
      toolsExpanded: expanded,
      actionsExpanded: exclusive && expanded ? false : state.actionsExpanded,
    }));
  },
  setActionsExpanded: (expanded, exclusive) => {
    try { localStorage.setItem(ACTIONS_KEY, String(expanded)); } catch {}
    set((state) => ({
      actionsExpanded: expanded,
      toolsExpanded: exclusive && expanded ? false : state.toolsExpanded,
    }));
  },
}));
