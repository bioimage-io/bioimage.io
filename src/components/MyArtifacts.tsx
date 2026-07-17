import React, { useState, useEffect } from 'react';
import { useHyphaStore } from '../store/hyphaStore';
import { getIsReviewer } from '../utils/roles';
import Upload from './Upload';
import { Link, useNavigate } from 'react-router-dom';
import { RiLoginBoxLine } from 'react-icons/ri';
import { ArrowPathIcon } from '@heroicons/react/24/outline';
import { Switch } from '@headlessui/react';
import MyArtifactCard from './MyArtifactCard';
import { Dialog, Transition } from '@headlessui/react';
import { Fragment } from 'react';
import { ExclamationTriangleIcon } from '@heroicons/react/24/outline';
import { InformationCircleIcon } from '@heroicons/react/24/outline';
import { Pagination } from './ArtifactGrid';
import SearchBar from './SearchBar';
import BookmarkedArtifacts from './BookmarkedArtifacts';
import { HYPHA_SERVER_URL } from '../config/hypha';

interface Artifact {
  id: string;
  alias: string;
  manifest: any;
  type: string;
  created_by: string;
  versions: Array<{
    version: string;
    comment: string;
    created_at: number;
  }>;
  staging?: any;
  /** Populated by loadArtifacts when a staged version exists; holds the staged manifest's status. */
  _stagedStatus?: string | null;
  /** True when the artifact exists only as a staged version (no committed releases). */
  _stagedOnly?: boolean;
}

const MyArtifacts: React.FC = () => {
  const { 
    artifactManager, 
    user, 
    isLoggedIn, 
    server,
    myArtifactsPage,
    myArtifactsTotalItems,
    setMyArtifactsPage,
    setMyArtifactsTotalItems,
    itemsPerPage 
  } = useHyphaStore();
  const [artifacts, setArtifacts] = useState<Artifact[]>([]);
  const [selectedArtifact, setSelectedArtifact] = useState<Artifact | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showStagedOnly, setShowStagedOnly] = useState(false);
  const [isDeleteDialogOpen, setIsDeleteDialogOpen] = useState(false);
  const [artifactToDelete, setArtifactToDelete] = useState<Artifact | null>(null);
  const [isReviewer, setIsReviewer] = useState(false);
  const [deleteLoading, setDeleteLoading] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [serverSearchQuery, setServerSearchQuery] = useState('');
  const navigate = useNavigate();

  useEffect(() => {
    if (isLoggedIn && user) {
      loadArtifacts();
      checkAdminStatus();
    }
  }, [artifactManager, user, isLoggedIn, showStagedOnly, myArtifactsPage, serverSearchQuery]);

  // Add debounced server search
  useEffect(() => {
    const timer = setTimeout(() => {
      setServerSearchQuery(searchQuery);
      setMyArtifactsPage(1);
    }, 500); // 500ms delay before triggering server search

    return () => clearTimeout(timer);
  }, [searchQuery, setMyArtifactsPage]);

  const loadArtifacts = async (attempt = 0) => {
    // Read the connection straight from the store rather than the render
    // closure so that, after a reconnect, the retry uses the freshly rebuilt
    // artifactManager instead of the stale one that just failed.
    const am = useHyphaStore.getState().artifactManager;
    const currentUser = useHyphaStore.getState().user;
    if (!am || !currentUser) return;

    try {
      setLoading(true);

      // We treat "my artifacts" as the union of two sets:
      //   (a) artifacts I created    -> filters.created_by == user.id
      //   (b) artifacts I uploaded   -> manifest.uploader.email == user.email
      // Hypha's nested-filter on manifest fields is unreliable, but the
      // full-text `keywords` index does cover manifest.uploader.email,
      // so we issue both queries in parallel and post-filter (b) to drop
      // any keyword matches that aren't actually uploader-email matches.
      // We then merge by id and paginate the merged list client-side.
      const baseKeywords: string[] = [];
      if (serverSearchQuery.trim()) baseKeywords.push(serverSearchQuery.trim());

      // _rkwargs: true tells the JS hypha-rpc client to treat this object as
      // kwargs (it strips the marker before the wire-send — see hypha-rpc
      // websocket.js around line 1153).
      const listOpts = {
        parent_id: "bioimage-io/bioimage.io",
        stage: showStagedOnly ? "stage" : "all",
        limit: 100,  // grab a wide page; client-side paginates the merged result
        _rkwargs: true,
      } as const;

      // When showing "All Versions" we also need the staged manifests to:
      // (a) include staged-only artifacts that stage=all misses entirely
      // (b) surface the staged manifest's review status (e.g. request-review)
      //     for dual artifacts whose committed manifest has no status field
      const stagedOpts = !showStagedOnly ? {
        parent_id: "bioimage-io/bioimage.io",
        stage: "stage",
        limit: 100,
        _rkwargs: true,
      } as const : null;

      const [createdRes, uploadedRes, stagedCreatedRes, stagedUploadedRes] = await Promise.all([
        am.list({
          ...listOpts,
          filters: { created_by: currentUser.id },
          keywords: baseKeywords,
        }),
        currentUser.email
          ? am.list({
              ...listOpts,
              keywords: [...baseKeywords, currentUser.email],
            })
          : Promise.resolve([]),
        stagedOpts
          ? am.list({ ...stagedOpts, filters: { created_by: currentUser.id }, keywords: baseKeywords })
          : Promise.resolve([]),
        stagedOpts && currentUser.email
          ? am.list({ ...stagedOpts, keywords: [...baseKeywords, currentUser.email] })
          : Promise.resolve([]),
      ]);

      // Post-filter (b): keywords-by-email returns anything mentioning the
      // string, so verify the uploader email is exact and the manifest is
      // ours, not the bot's, before counting an artifact as "uploaded by me".
      const userEmail = currentUser.email?.toLowerCase();
      const isMine = (a: any) =>
        a?.created_by === currentUser.id ||
        (userEmail && a?.manifest?.uploader?.email?.toLowerCase() === userEmail);

      const byId: Record<string, any> = {};
      for (const a of [...(createdRes || []), ...(uploadedRes || [])]) {
        if (a?.id && isMine(a)) byId[a.id] = a;
      }

      // Merge staged data: enrich dual artifacts with staged status and add
      // staged-only artifacts that stage=all missed entirely.
      for (const a of [...(stagedCreatedRes || []), ...(stagedUploadedRes || [])]) {
        if (!a?.id || !isMine(a)) continue;
        if (byId[a.id]) {
          byId[a.id] = { ...byId[a.id], staging: byId[a.id].staging ?? true };
        } else {
          // Staged-only artifact: stage=all returned nothing for it.
          // Mark it explicitly so the card shows the "Staged" badge.
          byId[a.id] = { ...a, staging: true, _stagedOnly: true };
        }
      }

      // list() returns committed manifests even when stage:"stage" is set —
      // staged manifest content is only available via read(stage:true).
      // Batch-read staged manifests for all items with an open staging session
      // so the card can show the correct review status (e.g. request-review).
      const stagingIds = Object.keys(byId).filter(id =>
        showStagedOnly || !!(byId[id].staging || byId[id]._stagedOnly)
      );
      if (stagingIds.length > 0) {
        const stagedReads = await Promise.all(
          stagingIds.map(async (id) => {
            try {
              const detail = await am.read({ artifact_id: id, stage: true, _rkwargs: true });
              return [id, detail?.manifest?.status ?? null] as [string, string | null];
            } catch {
              return [id, null] as [string, string | null];
            }
          })
        );
        for (const [id, stagedStatus] of stagedReads) {
          if (byId[id]) byId[id] = { ...byId[id], _stagedStatus: stagedStatus };
        }
      }

      const merged = Object.values(byId).sort((x: any, y: any) =>
        (y.last_modified ?? y.created_at ?? 0) - (x.last_modified ?? x.created_at ?? 0)
      );

      const start = (myArtifactsPage - 1) * itemsPerPage;
      setArtifacts(merged.slice(start, start + itemsPerPage) as Artifact[]);
      setMyArtifactsTotalItems(merged.length);
      setError(null);
    } catch (err) {
      console.error('Error loading artifacts:', err);
      // A dropped/stale Hypha socket surfaces here as an RPC error. On the
      // first failure, try one guarded reconnection with the cached token and
      // reload once. If reconnection fails, the store logs the user out and
      // the "Login Required" screen replaces this view (no stuck error card).
      if (attempt === 0) {
        const reconnected = await useHyphaStore.getState().attemptReconnect();
        if (reconnected && useHyphaStore.getState().isLoggedIn) {
          return await loadArtifacts(1);
        }
        if (useHyphaStore.getState().isLoggedIn) {
          setError('Failed to load artifacts');
        }
      } else {
        setError('Failed to load artifacts');
      }
    } finally {
      setLoading(false);
    }
  };

  const checkAdminStatus = async () => {
    if (!artifactManager || !user) return;

    try {
      const collection = await artifactManager.read({
        artifact_id: 'bioimage-io/bioimage.io',
        _rkwargs: true
      });
      if (user) {
        setIsReviewer(getIsReviewer(user, collection.config));
      }
    } catch (error) {
      console.error('Error checking reviewer status:', error);
      setIsReviewer(false);
    }
  };

  const handleDeleteArtifact = async () => {
    if (!artifactToDelete || !artifactManager) return;

    try {
      setDeleteLoading(true);

      // Check if the artifact has any published versions
      const hasPublishedVersions = artifactToDelete.versions && artifactToDelete.versions.length > 0;

      if (hasPublishedVersions) {
        // Artifact has published versions - only discard the staged changes
        await artifactManager.discard({
          artifact_id: artifactToDelete.id,
          _rkwargs: true
        });
      } else {
        // Artifact has no published versions - delete it entirely
        await artifactManager.delete({
          artifact_id: artifactToDelete.id,
          delete_files: true,
          recursive: true,
          _rkwargs: true
        });
      }
      
      // Refresh the artifacts list
      loadArtifacts();
      setIsDeleteDialogOpen(false);
      setArtifactToDelete(null);
    } catch (err) {
      console.error('Error deleting artifact:', err);
      setError('Failed to delete artifact');
    } finally {
      setDeleteLoading(false);
    }
  };

  const handlePageChange = (page: number) => {
    setMyArtifactsPage(page);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const handleSearchChange = (query: string) => {
    setSearchQuery(query);
  };

  if (selectedArtifact) {
    return (
      <Upload 
        artifactId={selectedArtifact.id}
      />
    );
  }

  if (!isLoggedIn) {
    return (
      <div className="flex items-center justify-center h-screen bg-gray-50">
        <div className="text-center">
          <div className="mb-4">
            <RiLoginBoxLine className="mx-auto h-12 w-12 text-gray-400" />
          </div>
          <h2 className="text-xl font-semibold text-gray-900 mb-2">
            Login Required
          </h2>
          <p className="text-gray-500 mb-4">
            Please login to view your uploaded models
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col min-h-screen">
      {/* Reviewer Info Box */}
      {isReviewer && (
        <div className="bg-blue-50 border-l-4 border-blue-400 p-4 mb-4 mx-4 mt-4">
          <div className="flex">
            <div className="flex-shrink-0">
              <InformationCircleIcon className="h-5 w-5 text-blue-400" aria-hidden="true" />
            </div>
            <div className="ml-3 flex-1 md:flex md:justify-between items-center">
              <p className="text-sm text-blue-700">
                Hey there! As a distinguished member of the BioImage Model Zoo, you have the privilege to review and manage artifacts uploaded by the community.
              </p>
              <p className="mt-3 text-sm md:mt-0 md:ml-6">
                <button
                  onClick={() => navigate('/review')}
                  className="whitespace-nowrap font-medium text-white bg-blue-600 hover:bg-blue-700 px-4 py-2 rounded-md"
                >
                  Go to Review Page
                </button>
              </p>
            </div>
          </div>
        </div>
      )}

      {/* Main Content Area */}
      <div className="bg-white border-b border-gray-200">
        <div className="p-6">
          <div className="flex justify-between items-center">
            <h1 className="text-2xl font-semibold text-gray-900">
              My Artifacts
            </h1>
            <div className="flex items-center space-x-4">
              <div className="flex items-center">
                <Switch
                  checked={showStagedOnly}
                  onChange={setShowStagedOnly}
                  className={`${
                    showStagedOnly ? 'bg-blue-600' : 'bg-gray-200'
                  } relative inline-flex h-6 w-11 items-center rounded-full transition-colors focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2`}
                >
                  <span className="sr-only">Show staged artifacts only</span>
                  <span
                    className={`${
                      showStagedOnly ? 'translate-x-6' : 'translate-x-1'
                    } inline-block h-4 w-4 transform rounded-full bg-white transition-transform`}
                  />
                </Switch>
                <span className="ml-2 text-sm text-gray-600">
                  {showStagedOnly ? 'Staged Only' : 'All Versions'}
                </span>
              </div>
              <button
                onClick={() => loadArtifacts()}
                disabled={loading}
                className={`inline-flex items-center px-3 py-2 border border-gray-300 shadow-sm text-sm leading-4 font-medium rounded-md text-gray-700 bg-white hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500 ${loading ? 'opacity-50 cursor-not-allowed' : ''}`}
              >
                <ArrowPathIcon 
                  className={`-ml-0.5 mr-2 h-4 w-4 ${loading ? 'animate-spin' : ''}`} 
                />
                {loading ? 'Refreshing...' : 'Refresh'}
              </button>
            </div>
          </div>

          {/* Search Bar */}
          <div className="mt-4 max-w-md mx-auto">
            <SearchBar 
              value={searchQuery}
              onSearchChange={handleSearchChange}
              onSearchConfirm={() => {}}
            />
          </div>
        </div>
      </div>

      <div className="flex-1">
        <div className="max-w-screen-lg mx-auto px-4 sm:px-6 lg:px-8 py-6">
          {loading ? (
          <div className="flex flex-col items-center justify-center h-full">
            <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600 mb-4"></div>
            <div className="text-xl font-semibold text-gray-700">Loading artifacts...</div>
          </div>
        ) : error ? (
          <div className="flex items-center justify-center h-full">
            <div className="text-red-500">{error}</div>
          </div>
        ) : artifacts.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full text-gray-500">
            <img 
              src="/static/img/zoo-background.svg" 
              alt="Zoo Background" 
              className="w-100 h-64 mb-8 opacity-50"
            />
            <p className="mb-4">You haven't uploaded any models yet</p>
            <button
              onClick={() => navigate('/upload')}
              className="px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700"
            >
              Upload Your First Model
            </button>
          </div>
        ) : (
          <>
            {/* My Uploaded Artifacts Section Header */}
            <div className="mb-6">
              <div className="flex items-center gap-2 mb-3">
                <svg
                  className="w-8 h-8 text-blue-600"
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12"
                  />
                </svg>
                <h2 className="text-2xl font-light text-gray-900">My Uploaded Artifacts</h2>
                <span className="px-3 py-1 bg-blue-50 text-blue-600 rounded-xl text-sm font-medium">
                  {myArtifactsTotalItems} {myArtifactsTotalItems === 1 ? 'item' : 'items'}
                </span>
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6 max-w-6xl">
              {artifacts.map((artifact) => (
                <div key={artifact.id}>
                  <MyArtifactCard
                    id={artifact.id}
                    title={artifact.manifest?.name || artifact.alias}
                    status={artifact._stagedStatus ?? artifact.manifest?.status}
                    description={artifact.manifest?.description || 'No description'}
                    tags={[
                      `v${artifact.versions?.length || 0}`,
                      ...(artifact.manifest?.tags || [])
                    ]}
                    image={artifact.manifest?.cover || undefined}
                    downloadUrl={`${HYPHA_SERVER_URL}/bioimage-io/artifacts/${artifact.id.split('/').pop()}/create-zip-file`}
                    onEdit={() => navigate(`/edit/${encodeURIComponent(artifact.id)}${(artifact.staging || artifact._stagedOnly) ? '/stage' : ''}`)}
                    onDelete={() => {
                      setArtifactToDelete(artifact);
                      setIsDeleteDialogOpen(true);
                    }}
                    isStaged={!!artifact.staging || !!artifact._stagedOnly}
                    artifactType={artifact.type}
                    isReviewer={isReviewer}
                  />
                </div>
              ))}
            </div>

            {artifacts.length > 0 && (
              <Pagination
                currentPage={myArtifactsPage}
                totalPages={Math.ceil(myArtifactsTotalItems / itemsPerPage)}
                totalItems={myArtifactsTotalItems}
                onPageChange={handlePageChange}
              />
            )}

            {/* Divider and Bookmarks Section */}
            <div className="my-8 border-t border-gray-200"></div>
            <BookmarkedArtifacts searchQuery={searchQuery} />
          </>
        )}
        </div>
      </div>

      <Transition.Root show={isDeleteDialogOpen} as={Fragment}>
        <Dialog as="div" className="relative z-10" onClose={setIsDeleteDialogOpen}>
          <Transition.Child
            as={Fragment}
            enter="ease-out duration-300"
            enterFrom="opacity-0"
            enterTo="opacity-100"
            leave="ease-in duration-200"
            leaveFrom="opacity-100"
            leaveTo="opacity-0"
          >
            <div className="fixed inset-0 bg-gray-500 bg-opacity-75 transition-opacity" />
          </Transition.Child>

          <div className="fixed inset-0 z-10 overflow-y-auto">
            <div className="flex min-h-full items-end justify-center p-4 text-center sm:items-center sm:p-0">
              <Transition.Child
                as={Fragment}
                enter="ease-out duration-300"
                enterFrom="opacity-0 translate-y-4 sm:translate-y-0 sm:scale-95"
                enterTo="opacity-100 translate-y-0 sm:scale-100"
                leave="ease-in duration-200"
                leaveFrom="opacity-100 translate-y-0 sm:scale-100"
                leaveTo="opacity-0 translate-y-4 sm:translate-y-0 sm:scale-95"
              >
                <Dialog.Panel className="relative transform overflow-hidden rounded-lg bg-white px-4 pb-4 pt-5 text-left shadow-xl transition-all sm:my-8 sm:w-full sm:max-w-lg sm:p-6">
                  <div className="sm:flex sm:items-start">
                    <div className="mx-auto flex h-12 w-12 flex-shrink-0 items-center justify-center rounded-full bg-red-100 sm:mx-0 sm:h-10 sm:w-10">
                      <ExclamationTriangleIcon className="h-6 w-6 text-red-600"  />
                    </div>
                    <div className="mt-3 text-center sm:ml-4 sm:mt-0 sm:text-left">
                      <Dialog.Title as="h3" className="text-base font-semibold leading-6 text-gray-900">
                        {artifactToDelete?.versions && artifactToDelete.versions.length > 0 
                          ? 'Remove Staged Changes' 
                          : 'Delete Artifact'}
                      </Dialog.Title>
                      <div className="mt-2">
                        <p className="text-sm text-gray-500">
                          {artifactToDelete?.versions && artifactToDelete.versions.length > 0 
                            ? 'Are you sure you want to remove the staged changes? Any published versions will remain unchanged. This action cannot be undone.'
                            : 'Are you sure you want to delete this artifact? This will permanently delete the artifact and all its files. This action cannot be undone.'}
                        </p>
                      </div>
                    </div>
                  </div>
                  <div className="mt-5 sm:mt-4 sm:flex sm:flex-row-reverse">
                    <button
                      type="button"
                      className="inline-flex w-full justify-center rounded-md bg-red-600 px-3 py-2 text-sm font-semibold text-white shadow-sm hover:bg-red-500 sm:ml-3 sm:w-auto"
                      onClick={handleDeleteArtifact}
                      disabled={deleteLoading}
                    >
                      {deleteLoading ? (
                        <span className="inline-flex items-center">
                          <svg className="animate-spin -ml-1 mr-2 h-4 w-4 text-white" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                          </svg>
                          {artifactToDelete?.versions && artifactToDelete.versions.length > 0 ? 'Removing...' : 'Deleting...'}
                        </span>
                      ) : (artifactToDelete?.versions && artifactToDelete.versions.length > 0 ? 'Remove Staged' : 'Delete')}
                    </button>
                    <button
                      type="button"
                      className="mt-3 inline-flex w-full justify-center rounded-md bg-white px-3 py-2 text-sm font-semibold text-gray-900 shadow-sm ring-1 ring-inset ring-gray-300 hover:bg-gray-50 sm:mt-0 sm:w-auto"
                      onClick={() => {
                        setIsDeleteDialogOpen(false);
                        setArtifactToDelete(null);
                      }}
                    >
                      Cancel
                    </button>
                  </div>
                </Dialog.Panel>
              </Transition.Child>
            </div>
          </div>
        </Dialog>
      </Transition.Root>

    </div>
  );
};

export default MyArtifacts; 