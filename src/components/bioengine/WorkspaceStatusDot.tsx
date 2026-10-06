import React from 'react';

/**
 * Load state of one observed workspace, shown as a dot before its name.
 *
 * Shared by the worker-admin chips and the apps page so the same colour means
 * the same thing on both. The distinction that matters, and the reason grey is
 * not simply "nothing": a workspace that answered and holds nothing is settled
 * information, while a workspace that has not answered yet is not. Collapsing
 * those two reads as "empty" when the truth is "unknown".
 */
export type WorkspaceLoadStatus = 'loading' | 'loaded' | 'error' | undefined;

interface WorkspaceStatusDotProps {
  status: WorkspaceLoadStatus;
  /** Items found. Drives green (has some) vs grey (answered, none). */
  count?: number | null;
  /** Noun for the title text, e.g. "worker" or "app". */
  noun?: string;
}

const WorkspaceStatusDot: React.FC<WorkspaceStatusDotProps> = ({ status, count, noun = 'item' }) => {
  if (status === 'loading') {
    return (
      <div
        className="w-2.5 h-2.5 border border-gray-400 border-t-transparent rounded-full animate-spin flex-shrink-0"
        title="Looking..."
      />
    );
  }
  if (status === 'error') {
    return <div className="w-2.5 h-2.5 rounded-full bg-red-400 flex-shrink-0" title="Could not be reached" />;
  }
  if (status === 'loaded') {
    const has = typeof count === 'number' && count > 0;
    return (
      <div
        className={`w-2.5 h-2.5 rounded-full flex-shrink-0 ${has ? 'bg-green-500' : 'bg-gray-400'}`}
        title={has ? `${count} ${noun}${count === 1 ? '' : 's'}` : `No ${noun}s found`}
      />
    );
  }
  // Not yet asked. Lighter than the answered-and-empty grey on purpose.
  return <div className="w-2.5 h-2.5 rounded-full bg-gray-300 flex-shrink-0" title="Not checked yet" />;
};

export default WorkspaceStatusDot;
