import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useHyphaStore } from '../store/hyphaStore';
import { getIsCollectionAdmin, fetchCollectionOwners, isPublished } from '../utils/roles';
import { DeletionRequest, getDeletionRequest } from '../utils/deletionRequest';

const COLLECTION_ID = 'bioimage-io/bioimage.io';

interface Row {
  id: string;
  name: string;
  request: DeletionRequest | null; // set => marked for deletion
  published: boolean;
  orphan: boolean; // dead row: no committed version AND no active staging session
}

/**
 * Site-admin-only page for finalizing model deletions. Lists models that
 * uploaders/reviewers marked for deletion (manifest.request_deletion) plus
 * empty versionless orphan artifacts. Deleting requires typing the model id.
 */
const DeletionRequests: React.FC = () => {
  const { artifactManager, user, isLoggedIn, server } = useHyphaStore();

  // null = still resolving; false = logged in but not a collection admin.
  const [isAdmin, setIsAdmin] = useState<boolean | null>(null);
  const [loading, setLoading] = useState(true);
  const [rows, setRows] = useState<Row[]>([]);
  const [error, setError] = useState<string | null>(null);

  // Finalize-delete dialog state.
  const [target, setTarget] = useState<Row | null>(null);
  const [confirmText, setConfirmText] = useState('');
  const [deleting, setDeleting] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (!isLoggedIn || !user || !server) {
        if (!cancelled) setIsAdmin(false);
        return;
      }
      const owners = await fetchCollectionOwners(server);
      if (!cancelled) setIsAdmin(getIsCollectionAdmin(user, owners));
    })();
    return () => { cancelled = true; };
  }, [user, isLoggedIn, server]);

  const loadRows = useCallback(async () => {
    if (!artifactManager) return;
    setLoading(true);
    setError(null);
    try {
      // Deletion marks live on the STAGED manifest, and orphans are versionless
      // staged children — so read the staged children individually (same pattern
      // the review badge uses; staged manifests aren't keyword-indexed).
      const resp = await artifactManager.list({
        parent_id: COLLECTION_ID,
        stage: true,
        limit: 1000,
        pagination: true,
        _rkwargs: true,
      });
      const items: any[] = resp?.items ?? [];
      const reads = await Promise.all(
        items.map(async (a: any) => {
          try {
            return await artifactManager.read({ artifact_id: a.id, stage: true, _rkwargs: true });
          } catch {
            return null;
          }
        })
      );

      const next: Row[] = [];
      for (const art of reads) {
        if (!art) continue;
        const request = getDeletionRequest(art);
        // A genuine orphan is a dead row: no committed version AND no active
        // staging session. A versionless artifact that IS staging is a pending
        // upload-in-progress (someone's unsubmitted/under-review work), NOT an
        // orphan — do not surface it here as deletable.
        const orphan = !isPublished(art) && !art.staging;
        if (!request && !orphan) continue;
        next.push({
          id: art.id,
          name: art.manifest?.name || art.id.split('/').pop() || art.id,
          request,
          published: isPublished(art),
          orphan,
        });
      }
      // Marked-for-deletion first, then orphans; most recent request on top.
      next.sort((a, b) => {
        if (!!a.request !== !!b.request) return a.request ? -1 : 1;
        return (b.request?.requested_at || 0) - (a.request?.requested_at || 0);
      });
      setRows(next);
    } catch (err) {
      console.error('Error loading deletion requests:', err);
      setError('Failed to load deletion requests.');
    } finally {
      setLoading(false);
    }
  }, [artifactManager]);

  useEffect(() => {
    if (isAdmin) loadRows();
  }, [isAdmin, loadRows]);

  const shortId = (id: string) => id.split('/').pop() || id;
  const confirmMatches = target && confirmText.trim() === shortId(target.id);

  const handleFinalize = async () => {
    if (!target || !artifactManager || !confirmMatches) return;
    setDeleting(true);
    setError(null);
    try {
      await artifactManager.delete({
        artifact_id: target.id,
        delete_files: true,
        recursive: true,
        _rkwargs: true,
      });
      setTarget(null);
      setConfirmText('');
      await loadRows();
    } catch (err: any) {
      console.error('Error deleting artifact:', err);
      setError(`Failed to delete ${shortId(target.id)}: ${err?.message || err}`);
    } finally {
      setDeleting(false);
    }
  };

  if (isAdmin === null) {
    return (
      <div className="flex items-center justify-center h-[60vh] bg-gray-50">
        <div className="w-8 h-8 border-2 border-gray-300 border-t-blue-600 rounded-full animate-spin" />
      </div>
    );
  }

  if (!isAdmin) {
    return (
      <div className="flex flex-col items-center justify-center h-[60vh] text-center px-6">
        <div className="w-12 h-12 bg-red-100 rounded-xl flex items-center justify-center mb-4">
          <svg className="w-6 h-6 text-red-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
          </svg>
        </div>
        <h2 className="text-xl font-semibold text-gray-800">Admin access required</h2>
        <p className="text-gray-500 mt-2 max-w-md">
          Only collection admins can finalize deletions. If you requested a deletion, an admin will
          review and action it.
        </p>
      </div>
    );
  }

  const requests = rows.filter((r) => r.request);
  const orphans = rows.filter((r) => !r.request && r.orphan);

  return (
    <div className="max-w-4xl mx-auto px-4 py-8">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-semibold text-gray-900">Deletion Requests</h1>
          <p className="text-sm text-gray-500 mt-1">
            Finalize model deletions requested by uploaders and reviewers, and clean up empty
            orphaned artifacts.
          </p>
        </div>
        <button
          onClick={loadRows}
          disabled={loading}
          className="px-3 py-2 text-sm text-gray-600 bg-white border border-gray-200 rounded-lg hover:bg-gray-50 disabled:opacity-50"
        >
          {loading ? 'Refreshing…' : 'Refresh'}
        </button>
      </div>

      {error && (
        <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded-lg text-sm text-red-700">{error}</div>
      )}

      {loading ? (
        <div className="flex justify-center py-16">
          <div className="w-8 h-8 border-2 border-gray-300 border-t-blue-600 rounded-full animate-spin" />
        </div>
      ) : (
        <>
          {/* Requested deletions */}
          <section className="mb-10">
            <h2 className="text-sm font-semibold text-gray-700 uppercase tracking-wide mb-3">
              Requested deletions ({requests.length})
            </h2>
            {requests.length === 0 ? (
              <p className="text-sm text-gray-400">No models are currently marked for deletion.</p>
            ) : (
              <ul className="space-y-3">
                {requests.map((r) => (
                  <li key={r.id} className="bg-white border border-gray-200 rounded-xl p-4">
                    <div className="flex items-start justify-between gap-4">
                      <div className="min-w-0">
                        <div className="flex items-center gap-2">
                          <Link to={`/artifacts/${encodeURIComponent(shortId(r.id))}`} className="font-medium text-gray-900 hover:underline truncate">
                            {r.name}
                          </Link>
                          <span className="text-xs font-mono text-gray-400">{shortId(r.id)}</span>
                          {r.published && (
                            <span className="text-xs px-1.5 py-0.5 rounded bg-green-50 text-green-700">published</span>
                          )}
                        </div>
                        <p className="text-sm text-gray-700 mt-1 break-words">
                          <span className="font-medium">Reason:</span> {r.request?.reason}
                        </p>
                        <p className="text-xs text-gray-400 mt-1">
                          Requested by {r.request?.requested_by_email || r.request?.requested_by}
                        </p>
                      </div>
                      <button
                        onClick={() => { setTarget(r); setConfirmText(''); }}
                        className="flex-shrink-0 px-3 py-2 text-sm font-medium text-white bg-red-600 rounded-lg hover:bg-red-700"
                      >
                        Delete
                      </button>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </section>

          {/* Orphaned artifacts */}
          <section>
            <h2 className="text-sm font-semibold text-gray-700 uppercase tracking-wide mb-3">
              Orphaned artifacts ({orphans.length})
            </h2>
            <p className="text-xs text-gray-400 mb-3">
              Dead rows with no committed version and no active staging session: abandoned or broken
              artifacts. (Versionless uploads that are still staged are pending submissions, not orphans,
              and are not listed here.)
            </p>
            {orphans.length === 0 ? (
              <p className="text-sm text-gray-400">No orphaned artifacts found.</p>
            ) : (
              <ul className="space-y-2">
                {orphans.map((r) => (
                  <li key={r.id} className="bg-white border border-gray-200 rounded-lg px-4 py-3 flex items-center justify-between gap-4">
                    <span className="font-mono text-sm text-gray-600 truncate">{shortId(r.id)}</span>
                    <button
                      onClick={() => { setTarget(r); setConfirmText(''); }}
                      className="flex-shrink-0 px-3 py-1.5 text-sm font-medium text-red-600 border border-red-200 rounded-lg hover:bg-red-50"
                    >
                      Delete
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </>
      )}

      {/* Finalize-delete confirmation (type the model id) */}
      {target && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-50 animate-fadeIn" onClick={() => !deleting && setTarget(null)}>
          <div className="bg-white rounded-2xl shadow-lg max-w-md w-full mx-4 border border-gray-200 animate-scaleIn" onClick={(e) => e.stopPropagation()}>
            <div className="p-6 border-b border-gray-200/70">
              <h3 className="text-lg font-semibold text-gray-800">Delete permanently</h3>
            </div>
            <div className="p-6 space-y-4">
              <div className="p-4 bg-red-50 border border-red-200 rounded-lg text-sm text-red-800">
                This permanently deletes <span className="font-medium">{target.name}</span> and all its
                files. This cannot be undone.
                {target.published && ' It will be removed from the public Model Zoo, which may break links.'}
              </div>
              {!target.request && !target.published ? null : !target.request ? (
                <p className="text-sm text-amber-700">This model has no deletion request on file.</p>
              ) : null}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Type the model ID to confirm
                </label>
                <div className="mb-2 p-2 bg-gray-100 rounded text-xs font-mono select-all break-all">{shortId(target.id)}</div>
                <input
                  type="text"
                  autoFocus
                  className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-red-500 focus:border-red-500"
                  value={confirmText}
                  onChange={(e) => setConfirmText(e.target.value)}
                  placeholder={shortId(target.id)}
                  disabled={deleting}
                />
              </div>
            </div>
            <div className="p-6 pt-0 flex justify-end space-x-3">
              <button
                onClick={() => setTarget(null)}
                disabled={deleting}
                className="px-5 py-2.5 text-gray-600 bg-white border border-gray-200 rounded-xl hover:bg-gray-50 disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                onClick={handleFinalize}
                disabled={!confirmMatches || deleting}
                className="px-5 py-2.5 bg-red-600 text-white rounded-xl hover:bg-red-700 disabled:bg-gray-300 disabled:cursor-not-allowed"
              >
                {deleting ? 'Deleting…' : 'Delete permanently'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default DeletionRequests;
