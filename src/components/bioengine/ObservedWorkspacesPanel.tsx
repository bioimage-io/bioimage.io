import React, { useState } from 'react';
import WorkspaceStatusDot, { WorkspaceLoadStatus } from './WorkspaceStatusDot';
import RefreshButton from './RefreshButton';

/**
 * The observed-workspace list shared by the three BioEngine admin surfaces:
 * the apps page, worker admin, and the dashboard's Available BioEngine Apps.
 *
 * All three watch the SAME saved set of workspaces and differ only in what each
 * workspace is filled with (worker cards, app cards, selectable app ids). They
 * had each grown their own pill markup, add form and refresh control, which
 * drifted: different colours for the same state, different refresh icons, a
 * status dot in one place and not another.
 *
 * THE STATUS LIVES HERE AND ONLY HERE. Each pill carries its workspace's load
 * state, so the per-workspace sections below must not repeat it: the same fact
 * rendered twice invites the two to disagree, and a reader then has to work out
 * which one is stale.
 */
interface ObservedWorkspacesPanelProps {
  workspaces: string[];
  /** Workspaces the user cannot remove (defaults, the worker's own, their own). */
  pinned?: string[];
  statusOf?: (ws: string) => WorkspaceLoadStatus;
  /** Items found in a workspace. Drives the pill's green-vs-grey and its count. */
  countOf?: (ws: string) => number | null;
  /** What is being counted, e.g. "worker" or "app". */
  noun?: string;
  onAdd: (ws: string) => void;
  onRemove: (ws: string) => void;
  onRefresh: () => void;
  refreshing?: boolean;
  /**
   * Selection mode (the dashboard shows one workspace at a time). When set, a
   * pill is clickable and the active one is highlighted. Omit for the pages
   * that render every workspace at once.
   */
  activeWorkspace?: string;
  onSelect?: (ws: string) => void;
  /** Optional line above the pills, e.g. explaining single-select. */
  hint?: string;
  title?: string;
  className?: string;
}

const ObservedWorkspacesPanel: React.FC<ObservedWorkspacesPanelProps> = ({
  workspaces,
  pinned = [],
  statusOf,
  countOf,
  noun = 'item',
  onAdd,
  onRemove,
  onRefresh,
  refreshing = false,
  activeWorkspace,
  onSelect,
  hint,
  title = 'Observed Workspaces',
  className = '',
}) => {
  const [input, setInput] = useState('');
  const selectable = typeof onSelect === 'function';

  const submit = () => {
    const ws = input.trim();
    if (!ws) return;
    onAdd(ws);
    setInput('');
  };

  return (
    <div className={className}>
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-base font-semibold text-gray-800">{title}</h3>
      </div>

      {hint && <p className="text-xs text-gray-600 mb-2">{hint}</p>}

      <div className="flex flex-wrap gap-2 mb-3">
        {workspaces.map(ws => {
          const isPinned = pinned.includes(ws);
          const isActive = selectable && ws === activeWorkspace;
          const count = countOf ? countOf(ws) : null;
          return (
            <span
              key={ws}
              {...(selectable
                ? {
                    role: 'button',
                    tabIndex: 0,
                    onClick: () => onSelect!(ws),
                    onKeyDown: (e: React.KeyboardEvent) => {
                      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onSelect!(ws); }
                    },
                    'aria-pressed': isActive,
                  }
                : {})}
              className={[
                'group inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium border transition-colors',
                selectable ? 'cursor-pointer' : '',
                isActive
                  ? 'bg-blue-600 border-blue-600 text-white'
                  : 'bg-white border-gray-300 text-gray-700 hover:border-gray-400',
              ].filter(Boolean).join(' ')}
              title={isPinned ? `${ws} (cannot be removed)` : ws}
            >
              <WorkspaceStatusDot status={statusOf?.(ws)} count={count} noun={noun} />
              <span className="font-mono">{ws}</span>
              {typeof count === 'number' && (
                <span className={isActive ? 'text-blue-100' : 'text-gray-400'}>
                  {count}
                </span>
              )}
              {!isPinned && (
                <button
                  type="button"
                  onClick={e => { e.stopPropagation(); onRemove(ws); }}
                  title={`Remove ${ws}`}
                  className={`ml-0.5 transition-colors ${
                    isActive ? 'text-blue-200 hover:text-white' : 'text-gray-400 hover:text-red-500'
                  }`}
                >
                  <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>
              )}
            </span>
          );
        })}
      </div>

      <div className="flex gap-2">
        <input
          value={input}
          onChange={e => setInput(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); submit(); } }}
          placeholder="Add workspace name..."
          aria-label="Workspace name to add"
          className="flex-1 min-w-0 px-3 py-1.5 text-xs border border-gray-300 rounded-lg focus:ring-1 focus:ring-blue-500 focus:border-blue-500"
        />
        {/* Add and Refresh share a width so the pair reads as one control
            group rather than two unrelated buttons of accidental sizes. */}
        <button
          type="button"
          onClick={submit}
          disabled={!input.trim()}
          className="w-24 px-3 py-1.5 text-xs font-medium bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
        >
          Add
        </button>
        <RefreshButton onClick={onRefresh} busy={refreshing} className="w-24" />
      </div>
    </div>
  );
};

export default ObservedWorkspacesPanel;
