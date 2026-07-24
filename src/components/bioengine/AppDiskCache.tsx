import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import ErrorDialog from './ErrorDialog';

interface AppDirectoryEntry {
  name: string;
  application_id: string | null;
  path: string;
  is_running: boolean;
  size_bytes: number;
  last_used_unix: number | null;
  node_id: string;
}

interface AppDiskCacheProps {
  serviceId: string;
  server: any;
  isLoggedIn: boolean;
  // Changes whenever the parent's deployed-app set changes (deploy / undeploy /
  // status flip). The cache list refetches on every change, which keeps the
  // "Status" column honest without running its own auto-poll loop — the
  // worker's list_app_directories fans out to every Ray node on per-node FS
  // topologies, so we avoid a tight polling cadence.
  refreshKey?: string;
  // {node_id -> "Head Node (...)" | "Worker Node N (...)"} from the parent's
  // cluster view, so the (rare, per-node FS) Node column matches the cluster
  // section's numbering. May be empty.
  nodeLabels?: Record<string, string>;
}

type SortColumn = 'application_id' | 'size_bytes' | 'last_used_unix';
type SortDirection = 'asc' | 'desc';

const formatBytes = (bytes: number): string => {
  if (!bytes || bytes < 0) return '0 B';
  if (bytes < 1024) return `${bytes} B`;
  const units = ['KB', 'MB', 'GB', 'TB'];
  let value = bytes / 1024;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  // 1 decimal place once we get into MB+; KB stays as integer for compactness.
  const formatted = unit === 0 ? Math.round(value).toString() : value.toFixed(1);
  return `${formatted} ${units[unit]}`;
};

const formatRelativeTime = (unixSeconds: number | null, nowMs: number): string => {
  if (!unixSeconds) return '-';
  const diffSec = Math.max(0, (nowMs - unixSeconds * 1000) / 1000);
  if (diffSec < 60) return `${Math.floor(diffSec)}s ago`;
  if (diffSec < 3600) return `${Math.floor(diffSec / 60)}m ago`;
  if (diffSec < 86400) return `${Math.floor(diffSec / 3600)}h ago`;
  if (diffSec < 86400 * 30) return `${Math.floor(diffSec / 86400)}d ago`;
  if (diffSec < 86400 * 365) return `${Math.floor(diffSec / (86400 * 30))}mo ago`;
  return `${Math.floor(diffSec / (86400 * 365))}y ago`;
};

const AppDiskCache: React.FC<AppDiskCacheProps> = ({
  serviceId,
  server,
  isLoggedIn,
  refreshKey,
  nodeLabels,
}) => {
  const [entries, setEntries] = useState<AppDirectoryEntry[]>([]);
  const [loading, setLoading] = useState<boolean>(false);
  const [hasLoaded, setHasLoaded] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);
  const [clearingKey, setClearingKey] = useState<string | null>(null);
  const [confirmEntry, setConfirmEntry] = useState<AppDirectoryEntry | null>(null);
  // Only success toasts go here — failures route to ErrorDialog so a long
  // stack trace stays readable.
  const [toast, setToast] = useState<{ text: string } | null>(null);
  const [clearError, setClearError] = useState<{ subtitle: string; message: string } | null>(null);
  const [sortColumn, setSortColumn] = useState<SortColumn>('last_used_unix');
  const [sortDirection, setSortDirection] = useState<SortDirection>('desc');
  const [now, setNow] = useState<number>(Date.now());

  const fetchInFlight = useRef<boolean>(false);
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Tick once a minute so the "Last used" relative labels stay fresh without
  // refetching the list. Cache mtimes change rarely; we don't need 1s ticks.
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 60_000);
    return () => clearInterval(t);
  }, []);

  const fetchEntries = useCallback(
    async (showSpinner: boolean) => {
      if (!serviceId || !isLoggedIn || !server) return;
      if (fetchInFlight.current) return;
      fetchInFlight.current = true;
      if (showSpinner) setLoading(true);
      try {
        const worker = await server.getService(serviceId, { mode: 'random' });
        const result: AppDirectoryEntry[] = await worker.list_app_directories();
        // The worker already sorts by (name, node_id); our table re-sorts in
        // the render, so we just take the raw list.
        setEntries(Array.isArray(result) ? result : []);
        setError(null);
        setHasLoaded(true);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        setError(`Failed to load app cache: ${msg}`);
      } finally {
        if (showSpinner) setLoading(false);
        fetchInFlight.current = false;
      }
    },
    [serviceId, isLoggedIn, server],
  );

  // Refresh whenever the parent's app status changes (deploy / undeploy is
  // the main reason an app's is_running flag flips), but ONLY after the
  // operator has loaded the list at least once. list_app_directories fans
  // out to every Ray node on per-node FS topologies and is genuinely
  // expensive, so we never auto-load on mount — the operator has to opt
  // in by clicking the load button.
  useEffect(() => {
    if (!hasLoaded) return;
    fetchEntries(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [serviceId, isLoggedIn, refreshKey]);

  // Multi-node only matters in the per-node FS topology. KTH (shared FS)
  // returns every entry tagged with the same node id — hide the column in
  // that case to keep the table clean. We probe distinct node ids in the
  // current result set rather than asking the worker's topology hint, which
  // keeps the UI honest even if the topology classification changes.
  const isMultiNode = useMemo(() => {
    const ids = new Set<string>();
    for (const e of entries) {
      if (e?.node_id) ids.add(e.node_id);
      if (ids.size > 1) return true;
    }
    return false;
  }, [entries]);

  const sortedEntries = useMemo(() => {
    const copy = [...entries];
    const dir = sortDirection === 'asc' ? 1 : -1;
    copy.sort((a, b) => {
      if (sortColumn === 'application_id') {
        const av = (a.application_id ?? a.name ?? '').toLowerCase();
        const bv = (b.application_id ?? b.name ?? '').toLowerCase();
        if (av === bv) return 0;
        return av < bv ? -1 * dir : 1 * dir;
      }
      if (sortColumn === 'size_bytes') {
        return ((a.size_bytes ?? 0) - (b.size_bytes ?? 0)) * dir;
      }
      // last_used_unix; treat null as the oldest possible value so it lands
      // at the end on DESC and at the top on ASC.
      const av = a.last_used_unix ?? -Infinity;
      const bv = b.last_used_unix ?? -Infinity;
      return (av - bv) * dir;
    });
    return copy;
  }, [entries, sortColumn, sortDirection]);

  const totals = useMemo(() => {
    const totalBytes = entries.reduce((sum, e) => sum + (e.size_bytes ?? 0), 0);
    const runningCount = entries.filter(e => e.is_running).length;
    return { totalBytes, runningCount };
  }, [entries]);

  const handleSort = (column: SortColumn) => {
    if (sortColumn === column) {
      setSortDirection(d => (d === 'asc' ? 'desc' : 'asc'));
    } else {
      setSortColumn(column);
      // Sensible default per column: size and last_used start descending
      // (biggest / most recent first), id starts ascending (A→Z).
      setSortDirection(column === 'application_id' ? 'asc' : 'desc');
    }
  };

  const showToast = (text: string) => {
    setToast({ text });
    if (toastTimer.current) clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(null), 4000);
  };

  useEffect(() => () => {
    if (toastTimer.current) clearTimeout(toastTimer.current);
  }, []);

  const handleConfirmClear = async () => {
    if (!confirmEntry) return;
    const entry = confirmEntry;
    // application_id may be null on legacy / unrecognised dirs — fall back to
    // the bare directory name. The worker accepts both: it first probes
    // `<worker-workspace>-<id>`, then falls back to `<id>` (see
    // bioengine/apps/manager.py:1494-1498).
    const key = entry.application_id ?? entry.name;
    setConfirmEntry(null);
    setClearingKey(key);
    try {
      const worker = await server.getService(serviceId, { mode: 'random' });
      const result = await worker.clear_app_directory({
        application_id: key,
        _rkwargs: true,
      });
      const deletedCount = Array.isArray(result?.deleted_on) ? result.deleted_on.length : 0;
      const noun = deletedCount === 1 ? 'directory' : 'directories';
      showToast(`Cleared ${deletedCount} ${noun} for ${key}`);
      // Optimistic update — hide the cleared row(s) immediately so the
      // operator doesn't see the just-deleted cache lingering until the
      // next manual refresh. The worker raises ValueError when nothing
      // was actually deleted, so reaching this branch guarantees at
      // least one on-disk directory is gone. On multi-node FS, when
      // `deleted_on` lists specific nodes, we drop rows by (key, node);
      // otherwise we drop every row that matches the key.
      setEntries(prev => {
        const deletedNodes = new Set<string>(
          Array.isArray(result?.deleted_on) ? result.deleted_on : [],
        );
        return prev.filter(e => {
          const eKey = e.application_id ?? e.name;
          if (eKey !== key) return true;
          // Same key — drop if this specific node was in deleted_on, or
          // if the worker returned no deleted_on list (treat as "all").
          if (deletedNodes.size === 0) return false;
          return !deletedNodes.has(e.node_id);
        });
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setClearError({ subtitle: key, message: msg });
    } finally {
      setClearingKey(null);
    }
  };

  const sortIcon = (column: SortColumn) => {
    if (sortColumn !== column) {
      return (
        <svg className="w-3 h-3 opacity-30" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 9l4-4 4 4m0 6l-4 4-4-4" />
        </svg>
      );
    }
    return sortDirection === 'asc' ? (
      <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 15l7-7 7 7" />
      </svg>
    ) : (
      <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
      </svg>
    );
  };

  // Header button label flips from primary "Load app cache" (before first
  // load) to a quieter "Refresh" once we have data. Mirrors the visual
  // weight to the action: the first fetch is an explicit opt-in, the
  // subsequent ones are housekeeping.
  const loadButtonLabel = !hasLoaded
    ? (loading ? 'Loading...' : 'Load app cache')
    : (loading ? 'Refreshing' : 'Refresh');

  return (
    <div className="mb-8" style={{ animation: 'cacheFadeIn 220ms cubic-bezier(0.23, 1, 0.32, 1)' }}>
      <style>{`
        @keyframes cacheFadeIn {
          from { opacity: 0; transform: translateY(6px); }
          to   { opacity: 1; transform: translateY(0); }
        }
        .cache-press { transition: transform 160ms cubic-bezier(0.23, 1, 0.32, 1); }
        .cache-press:active:not(:disabled) { transform: scale(0.97); }
        .cache-row { transition: background-color 150ms ease-out; }
      `}</style>

      {/* Section divider — mirrors the trailing border at the end of
          DeployedBioEngineApps (line 203) so each major section on the
          worker dashboard is visually separated. Rendered as the first
          child here so it only appears when the cache section actually
          renders (admin + bioengine >= 0.11.6). */}
      <div className="border-t border-gray-200 my-6" />

      <div className="flex justify-between items-center mb-6">
        <div className="flex items-center">
          <div className="w-10 h-10 bg-gradient-to-r from-slate-500 to-slate-600 rounded-xl flex items-center justify-center mr-3">
            <svg className="w-5 h-5 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 7v10c0 2 1 3 3 3h10c2 0 3-1 3-3V7M4 7c0-2 1-3 3-3h10c2 0 3 1 3 3M4 7h16M9 11h6M9 15h6" />
            </svg>
          </div>
          <div>
            <h3 className="text-lg font-semibold text-gray-800">App Disk Cache</h3>
            <p className="text-xs text-gray-500">
              Working directories on the Ray actor pods. Stop an app before clearing its cache.
            </p>
          </div>
        </div>
        <button
          onClick={() => fetchEntries(true)}
          disabled={loading}
          className={`cache-press inline-flex items-center px-3 py-1.5 text-sm font-medium rounded-lg border disabled:opacity-60 disabled:cursor-not-allowed ${
            !hasLoaded
              ? 'border-blue-600 bg-blue-600 text-white hover:bg-blue-700 hover:border-blue-700 disabled:bg-blue-400 disabled:border-blue-400'
              : 'border-gray-200 bg-white text-gray-700 hover:bg-gray-50'
          }`}
        >
          <svg
            className={`w-4 h-4 mr-1.5 ${loading ? 'animate-spin' : ''}`}
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            {!hasLoaded && !loading ? (
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 14l-7 7m0 0l-7-7m7 7V3" />
            ) : (
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v6h6M20 20v-6h-6M5.07 9A8 8 0 0119 9M19 15a8 8 0 01-13.93 0" />
            )}
          </svg>
          {loadButtonLabel}
        </button>
      </div>

      {error && (
        <div className="mb-4 p-4 bg-red-50 border border-red-200 rounded-lg flex justify-between items-start">
          <div className="flex">
            <svg className="w-5 h-5 text-red-400 mr-2 mt-0.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
            <div>
              <h4 className="text-sm font-medium text-red-800">Cache list error</h4>
              <p className="text-sm text-red-700 mt-1">{error}</p>
            </div>
          </div>
          <button
            onClick={() => setError(null)}
            className="text-red-400 hover:text-red-600"
            aria-label="Dismiss error"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>
      )}

      <div className="bg-white/80 backdrop-blur-sm rounded-2xl shadow-sm border border-white/20">
        {!hasLoaded && loading ? (
          <div className="flex flex-col items-center justify-center py-12 text-gray-600">
            <div className="w-8 h-8 border-2 border-gray-200 border-t-blue-600 rounded-full animate-spin mb-3" />
            <p className="text-sm">Loading cache entries...</p>
          </div>
        ) : !hasLoaded ? (
          // First-visit empty state. Listing the cache fans out a Ray task
          // per node on per-node FS topologies, so we don't fetch on mount —
          // the operator has to opt in via the header button above.
          <div className="py-12 text-center text-sm text-gray-500">
            Cache is not loaded yet. Click <span className="font-medium text-gray-700">Load app cache</span> to query the worker.
          </div>
        ) : entries.length === 0 ? (
          <div className="py-12 text-center text-sm text-gray-500">
            No cached app directories on this worker.
          </div>
        ) : (
          <>
            <div className="px-5 py-3 border-b border-gray-100 flex flex-wrap gap-4 items-center text-xs text-gray-600">
              <span>
                <span className="font-semibold text-gray-800">{entries.length}</span>{' '}
                {entries.length === 1 ? 'entry' : 'entries'}
              </span>
              <span>
                Total size{' '}
                <span className="font-semibold text-gray-800">{formatBytes(totals.totalBytes)}</span>
              </span>
              <span>
                Running{' '}
                <span className="font-semibold text-gray-800">{totals.runningCount}</span>
              </span>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-gray-50 text-xs uppercase tracking-wide text-gray-500">
                  <tr>
                    <th className="text-left px-5 py-2.5 font-medium">
                      <button
                        onClick={() => handleSort('application_id')}
                        className="cache-press inline-flex items-center gap-1.5 hover:text-gray-700"
                      >
                        Application ID
                        {sortIcon('application_id')}
                      </button>
                    </th>
                    <th className="text-right px-5 py-2.5 font-medium">
                      <button
                        onClick={() => handleSort('size_bytes')}
                        className="cache-press inline-flex items-center gap-1.5 hover:text-gray-700"
                      >
                        Size
                        {sortIcon('size_bytes')}
                      </button>
                    </th>
                    <th className="text-left px-5 py-2.5 font-medium">
                      <button
                        onClick={() => handleSort('last_used_unix')}
                        className="cache-press inline-flex items-center gap-1.5 hover:text-gray-700"
                      >
                        Last used
                        {sortIcon('last_used_unix')}
                      </button>
                    </th>
                    <th className="text-left px-5 py-2.5 font-medium">Status</th>
                    {isMultiNode && (
                      <th className="text-left px-5 py-2.5 font-medium">Node</th>
                    )}
                    <th className="text-right px-5 py-2.5 font-medium">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {sortedEntries.map((entry) => {
                    const idLabel = entry.application_id ?? entry.name;
                    const rowKey = `${entry.node_id}::${entry.name}`;
                    const isClearing = clearingKey === (entry.application_id ?? entry.name);
                    const nodeLabel =
                      isMultiNode
                        ? nodeLabels?.[entry.node_id] ?? entry.node_id.slice(0, 8)
                        : null;
                    return (
                      <tr
                        key={rowKey}
                        className="cache-row border-t border-gray-100 hover:bg-gray-50"
                      >
                        <td className="px-5 py-2.5 align-middle">
                          <div className="font-mono text-gray-900 break-all">{idLabel}</div>
                          {!entry.application_id && (
                            <div className="text-[10px] text-gray-400 mt-0.5">
                              legacy / unprefixed directory
                            </div>
                          )}
                        </td>
                        <td className="px-5 py-2.5 text-right tabular-nums text-gray-800 whitespace-nowrap">
                          {formatBytes(entry.size_bytes)}
                        </td>
                        <td
                          className="px-5 py-2.5 text-gray-700 whitespace-nowrap"
                          title={
                            entry.last_used_unix
                              ? new Date(entry.last_used_unix * 1000).toLocaleString()
                              : 'No files in cache'
                          }
                        >
                          {formatRelativeTime(entry.last_used_unix, now)}
                        </td>
                        <td className="px-5 py-2.5">
                          {entry.is_running ? (
                            <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-green-50 text-green-700 border border-green-200">
                              <span className="w-1.5 h-1.5 rounded-full bg-green-500 mr-1.5" />
                              Running
                            </span>
                          ) : (
                            <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-gray-50 text-gray-600 border border-gray-200">
                              Idle
                            </span>
                          )}
                        </td>
                        {isMultiNode && (
                          <td
                            className="px-5 py-2.5 font-mono text-xs text-gray-600 whitespace-nowrap"
                            title={entry.node_id}
                          >
                            {nodeLabel}
                          </td>
                        )}
                        <td className="px-5 py-2.5 text-right">
                          <button
                            onClick={() => setConfirmEntry(entry)}
                            disabled={entry.is_running || isClearing}
                            title={
                              entry.is_running
                                ? 'Stop the app first'
                                : `Delete ${entry.path}`
                            }
                            className={`cache-press inline-flex items-center px-2.5 py-1 text-xs font-medium rounded-md border ${
                              entry.is_running || isClearing
                                ? 'bg-gray-50 text-gray-400 border-gray-200 cursor-not-allowed'
                                : 'bg-white text-red-700 border-red-200 hover:bg-red-50 hover:border-red-300'
                            }`}
                          >
                            {isClearing ? (
                              <>
                                <svg className="w-3.5 h-3.5 mr-1 animate-spin" fill="none" viewBox="0 0 24 24">
                                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                                </svg>
                                Clearing
                              </>
                            ) : (
                              <>
                                <svg className="w-3.5 h-3.5 mr-1" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6M1 7h22M8 7V5a2 2 0 012-2h4a2 2 0 012 2v2" />
                                </svg>
                                Clear
                              </>
                            )}
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </>
        )}
      </div>

      {confirmEntry && (
        <div
          className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center z-50 p-4"
          style={{ animation: 'cacheFadeIn 180ms cubic-bezier(0.23, 1, 0.32, 1)' }}
        >
          <div className="bg-white rounded-xl shadow-xl w-full max-w-md">
            <div className="px-5 py-4 border-b border-gray-100">
              <h4 className="text-base font-semibold text-gray-800">Clear cached directory?</h4>
            </div>
            <div className="px-5 py-4 text-sm text-gray-700 space-y-3">
              <p>
                This deletes <code className="px-1 py-0.5 bg-gray-100 rounded font-mono text-xs break-all">{confirmEntry.path}</code> on
                {' '}
                {isMultiNode ? 'every node where it exists' : 'the Ray actor pod'}.
                The next deploy of this app will rebuild the cache.
              </p>
              <p className="text-xs text-gray-500">
                Application ID: <span className="font-mono">{confirmEntry.application_id ?? confirmEntry.name}</span>
                {' · '}
                Size: <span className="font-mono">{formatBytes(confirmEntry.size_bytes)}</span>
              </p>
            </div>
            <div className="px-5 py-3 border-t border-gray-100 flex justify-end gap-2">
              <button
                onClick={() => setConfirmEntry(null)}
                className="cache-press px-3 py-1.5 text-sm font-medium rounded-lg border border-gray-300 bg-white text-gray-700 hover:bg-gray-50"
              >
                Cancel
              </button>
              <button
                onClick={handleConfirmClear}
                className="cache-press px-3 py-1.5 text-sm font-medium rounded-lg bg-red-600 text-white hover:bg-red-700"
              >
                Clear directory
              </button>
            </div>
          </div>
        </div>
      )}

      {toast && (
        <div
          className="fixed bottom-6 right-6 z-50"
          style={{ animation: 'cacheFadeIn 180ms cubic-bezier(0.23, 1, 0.32, 1)' }}
        >
          <div className="px-4 py-3 rounded-lg shadow-lg border text-sm flex items-start gap-2 max-w-sm bg-white border-green-200 text-green-800">
            <svg className="w-4 h-4 mt-0.5 text-green-500 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
            </svg>
            <span className="break-all">{toast.text}</span>
            <button
              onClick={() => setToast(null)}
              className="ml-2 text-gray-400 hover:text-gray-600"
              aria-label="Dismiss"
            >
              <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>
        </div>
      )}

      <ErrorDialog
        open={!!clearError}
        title="Cache delete failed"
        subtitle={clearError?.subtitle}
        message={clearError?.message ?? ''}
        onClose={() => setClearError(null)}
      />
    </div>
  );
};

export default AppDiskCache;
