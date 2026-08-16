import { useCallback, useMemo, useSyncExternalStore } from 'react';

/** Workspaces the user added by hand, shared by the worker discovery list and
 *  the app list on the worker dashboard. Only the manually added ones live
 *  here: each screen pins its own defaults (the public workspace, the logged-in
 *  user's workspace, the worker's workspace) and those are never stored. */
const STORAGE_KEY = 'bioengine-observed-workspaces';

export const DEFAULT_PUBLIC_WORKSPACE = 'bioimage-io';

// Module-level cache so every mounted consumer reads the same array instance
// (useSyncExternalStore compares snapshots by reference) and sees each other's
// additions without a reload.
let cachedWorkspaces: string[] | null = null;
const listeners = new Set<() => void>();

const readWorkspaces = (): string[] => {
  if (cachedWorkspaces) return cachedWorkspaces;
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    const parsed = stored ? JSON.parse(stored) : [];
    cachedWorkspaces = Array.isArray(parsed) ? parsed.filter((w): w is string => typeof w === 'string') : [];
  } catch {
    cachedWorkspaces = [];
  }
  return cachedWorkspaces;
};

const writeWorkspaces = (next: string[]): void => {
  cachedWorkspaces = next;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
  } catch (err) {
    // A full or blocked storage only costs persistence, not the session.
    console.error('Failed to persist observed workspaces:', err);
  }
  listeners.forEach(listener => listener());
};

const subscribe = (listener: () => void): (() => void) => {
  listeners.add(listener);
  // Another tab writing the same key: drop the cache so the next read reloads.
  const onStorage = (event: StorageEvent) => {
    if (event.key === STORAGE_KEY) {
      cachedWorkspaces = null;
      listeners.forEach(l => l());
    }
  };
  window.addEventListener('storage', onStorage);
  return () => {
    listeners.delete(listener);
    window.removeEventListener('storage', onStorage);
  };
};

export interface ObservedWorkspaces {
  /** Pinned workspaces first, then the stored ones, deduplicated. */
  observedWorkspaces: string[];
  /** Only the manually added ones, in the order they were added. */
  customWorkspaces: string[];
  isPinned: (workspace: string) => boolean;
  /** Adds a workspace unless it is blank, pinned, or already stored. */
  addWorkspace: (workspace: string) => void;
  /** Pinned workspaces cannot be removed. */
  removeWorkspace: (workspace: string) => void;
}

export function useObservedWorkspaces(pinned: string[]): ObservedWorkspaces {
  const customWorkspaces = useSyncExternalStore(subscribe, readWorkspaces, readWorkspaces);

  // Pinned entries are dropped from the stored list on read rather than on
  // write: which workspaces are pinned depends on the screen and on who is
  // logged in, so the same stored entry can be pinned in one place and a
  // manual addition in another.
  const observedWorkspaces = useMemo(() => {
    const all = pinned.filter(Boolean);
    for (const workspace of customWorkspaces) {
      if (!all.includes(workspace)) all.push(workspace);
    }
    return all;
  }, [pinned, customWorkspaces]);

  const isPinned = useCallback(
    (workspace: string) => pinned.includes(workspace),
    [pinned]
  );

  const addWorkspace = useCallback((workspace: string) => {
    const trimmed = workspace.trim();
    if (!trimmed) return;
    const stored = readWorkspaces();
    if (stored.includes(trimmed)) return;
    writeWorkspaces([...stored, trimmed]);
  }, []);

  const removeWorkspace = useCallback((workspace: string) => {
    if (pinned.includes(workspace)) return;
    const stored = readWorkspaces();
    if (!stored.includes(workspace)) return;
    writeWorkspaces(stored.filter(w => w !== workspace));
  }, [pinned]);

  return { observedWorkspaces, customWorkspaces, isPinned, addWorkspace, removeWorkspace };
}
