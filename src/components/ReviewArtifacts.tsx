import React, { useState, useEffect } from 'react';
import { useHyphaStore } from '../store/hyphaStore';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { RiLoginBoxLine } from 'react-icons/ri';
import { ArrowPathIcon } from '@heroicons/react/24/outline';
import { Dialog, Transition, Switch, Listbox } from '@headlessui/react';
import { Fragment } from 'react';
import { ExclamationTriangleIcon, CheckCircleIcon } from '@heroicons/react/24/outline';
import { EllipsisVerticalIcon, TrashIcon } from '@heroicons/react/24/outline';
import { Menu } from '@headlessui/react';
import { resolveHyphaUrl } from '../utils/urlHelpers';
import { InformationCircleIcon, ChevronDownIcon, ChevronUpIcon } from '@heroicons/react/24/outline';
import StatusBadge from './StatusBadge';
import { Pagination } from './ArtifactGrid';
import ContentCopyIcon from '@mui/icons-material/ContentCopy';
import { IconButton, Tooltip } from '@mui/material';
import SearchBar from './SearchBar';
import { getIsReviewer, getIsCollectionAdmin, fetchCollectionOwners, isPublished } from '../utils/roles';
import { getDeletionRequest } from '../utils/deletionRequest';
import RequestDeletionDialog from './RequestDeletionDialog';
import DeclineDeletionDialog from './DeclineDeletionDialog';

// Define view mode type for the dropdown. 'deletion' is admin-only.
type ViewMode = 'published' | 'staging' | 'pending' | 'deletion';

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
  staging?: any[];
}

const ReviewArtifacts: React.FC = () => {
  const {
    artifactManager,
    user,
    isLoggedIn,
    server,
    reviewArtifactsPage,
    reviewArtifactsTotalItems,
    setReviewArtifactsPage,
    setReviewArtifactsTotalItems,
    setPendingReviewCount,
    itemsPerPage
  } = useHyphaStore();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const [artifacts, setArtifacts] = useState<Artifact[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isApproveDialogOpen, setIsApproveDialogOpen] = useState(false);
  const [isRejectDialogOpen, setIsRejectDialogOpen] = useState(false);
  const [selectedArtifact, setSelectedArtifact] = useState<Artifact | null>(null);
  const [rejectReason, setRejectReason] = useState('');
  const [isDeleteDialogOpen, setIsDeleteDialogOpen] = useState(false);
  const [artifactToDelete, setArtifactToDelete] = useState<Artifact | null>(null);
  const [isGuidelinesOpen, setIsGuidelinesOpen] = useState(false);
  
  // Initialize viewMode from URL parameter or default to 'pending'
  const [viewMode, setViewMode] = useState<ViewMode>(() => {
    const showParam = searchParams.get('show');
    if (showParam === 'published' || showParam === 'staging' || showParam === 'pending' || showParam === 'deletion') {
      return showParam as ViewMode;
    }
    return 'pending';
  });
  const [copiedIds, setCopiedIds] = useState<{[key: string]: boolean}>({});
  const [approveLoading, setApproveLoading] = useState(false);
  const [rejectLoading, setRejectLoading] = useState(false);
  const [deleteLoading, setDeleteLoading] = useState(false);
  // Model marked for deletion via the reviewer flow (opens RequestDeletionDialog).
  // Reviewers cannot delete directly; a site-admin finalizes on the Deletion page.
  const [artifactToRequestDeletion, setArtifactToRequestDeletion] = useState<Artifact | null>(null);
  // Decline-deletion (Deletion Request view): opens DeclineDeletionDialog (requires a reason).
  const [artifactToDeclineDeletion, setArtifactToDeclineDeletion] = useState<Artifact | null>(null);
  // Finalize-delete (Deletion Request view): requires typing the model id.
  const [artifactToFinalize, setArtifactToFinalize] = useState<Artifact | null>(null);
  const [finalizeConfirm, setFinalizeConfirm] = useState('');
  const [finalizeLoading, setFinalizeLoading] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [serverSearchQuery, setServerSearchQuery] = useState('');
  const [acceptLoading, setAcceptLoading] = useState<{[key: string]: boolean}>({});
  // null = still resolving; false = logged in but not a reviewer (guard the page).
  const [isReviewer, setIsReviewer] = useState<boolean | null>(null);
  // Site admin (bioimage-io workspace owner) — gates the Deletion Request view.
  const [isCollectionAdmin, setIsCollectionAdmin] = useState(false);

  // Resource-type filter (the review page spans all types; /models etc. are
  // per-type). 'all' preserves the original all-types behavior.
  const [typeFilter, setTypeFilter] = useState<string>('all');
  const typeOptions = [
    { id: 'all', name: 'All types' },
    { id: 'model', name: 'Models' },
    { id: 'application', name: 'Applications' },
    { id: 'dataset', name: 'Datasets' },
    { id: 'notebook', name: 'Notebooks' }
  ];
  const handleTypeChange = (newType: string) => {
    setTypeFilter(newType);
    setReviewArtifactsPage(1);
  };
  const matchesType = (a: any) => typeFilter === 'all' || a?.type === typeFilter;

  // View mode options for the dropdown. Deletion Request is site-admin only and
  // sits below Pending Review.
  const viewModeOptions = [
    { id: 'published', name: 'Published' },
    { id: 'staging', name: 'Staging' },
    { id: 'pending', name: 'Pending Review' },
    ...(isCollectionAdmin ? [{ id: 'deletion', name: 'Deletion Request' }] : [])
  ];

  // Function to handle view mode changes with URL updates
  const handleViewModeChange = (newMode: ViewMode) => {
    setViewMode(newMode);
    setReviewArtifactsPage(1);
    
    // Update URL parameters
    const newParams = new URLSearchParams(searchParams);
    newParams.set('show', newMode);
    setSearchParams(newParams, { replace: true });
  };

  // Effect to sync URL parameters with view mode
  useEffect(() => {
    const showParam = searchParams.get('show');
    if (showParam !== viewMode) {
      const newParams = new URLSearchParams(searchParams);
      newParams.set('show', viewMode);
      setSearchParams(newParams, { replace: true });
    }
  }, [viewMode, searchParams, setSearchParams]);

  // Resolve reviewer access (guards the page for non-reviewers who navigate
  // to /review directly, since the dropdown link is only hidden, not enforced).
  useEffect(() => {
    let cancelled = false;
    const check = async () => {
      if (!artifactManager || !user) {
        if (!cancelled) setIsReviewer(isLoggedIn ? null : false);
        return;
      }
      try {
        const collection = await artifactManager.read({
          artifact_id: 'bioimage-io/bioimage.io',
          _rkwargs: true,
        });
        if (!cancelled) setIsReviewer(getIsReviewer(user, collection.config));
        // Site-admin (workspace owner) gates the Deletion Request view.
        const owners = server ? await fetchCollectionOwners(server) : [];
        if (!cancelled) setIsCollectionAdmin(getIsCollectionAdmin(user, owners));
      } catch (err) {
        console.error('Error checking reviewer access:', err);
        if (!cancelled) { setIsReviewer(false); setIsCollectionAdmin(false); }
      }
    };
    check();
    return () => { cancelled = true; };
  }, [artifactManager, user, isLoggedIn, server]);

  useEffect(() => {
    if (isLoggedIn && user && isReviewer) {
      loadArtifacts();
    }
  }, [artifactManager, user, isLoggedIn, isReviewer, viewMode, typeFilter, reviewArtifactsPage, serverSearchQuery]);

  // Add debounced server search
  useEffect(() => {
    const timer = setTimeout(() => {
      setServerSearchQuery(searchQuery);
      setReviewArtifactsPage(1);
    }, 500); // 500ms delay before triggering server search

    return () => clearTimeout(timer);
  }, [searchQuery, setReviewArtifactsPage]);

  const loadArtifacts = async () => {
    if (!artifactManager) return;

    try {
      setLoading(true);
      setError(null);

      if (viewMode === 'deletion') {
        // Models marked for deletion (manifest.request_deletion) plus versionless
        // orphan artifacts — read each staged child, same as the pending view.
        const resp = await artifactManager.list({
          parent_id: "bioimage-io/bioimage.io",
          stage: true,
          limit: 1000,
          pagination: true,
          _rkwargs: true
        });
        const items: Artifact[] = resp.items ?? [];
        const reads = await Promise.all(
          items.map(async (a: Artifact) => {
            try { return await artifactManager.read({ artifact_id: a.id, stage: true, _rkwargs: true }); }
            catch { return null; }
          })
        );
        let marked: Artifact[] = (reads.filter(Boolean) as Artifact[]).filter((a: any) => {
          const orphan = !isPublished(a) && !a.staging;
          return (getDeletionRequest(a) || orphan) && matchesType(a);
        });
        if (serverSearchQuery.trim()) {
          const q = serverSearchQuery.trim().toLowerCase();
          marked = marked.filter((a: any) =>
            a.manifest?.name?.toLowerCase().includes(q) || (a.id ?? '').toLowerCase().includes(q));
        }
        // Marked-for-deletion first (most recent request on top), then orphans.
        marked.sort((a: any, b: any) => {
          const ra = getDeletionRequest(a), rb = getDeletionRequest(b);
          if (!!ra !== !!rb) return ra ? -1 : 1;
          return (rb?.requested_at || 0) - (ra?.requested_at || 0);
        });
        setReviewArtifactsTotalItems(marked.length);
        const start = (reviewArtifactsPage - 1) * itemsPerPage;
        setArtifacts(marked.slice(start, start + itemsPerPage));
      } else if (viewMode === 'pending') {
        // Pending-review models must remain staged (not committed) until a
        // curator accepts them. Hypha keyword search only indexes committed
        // manifests, so we list all staged artifacts, read each staged manifest
        // individually, and filter client-side for status='in-review'.
        const stagedResp = await artifactManager.list({
          parent_id: "bioimage-io/bioimage.io",
          stage: true,
          limit: 1000,
          pagination: true,
          _rkwargs: true
        });

        const stagedItems: Artifact[] = stagedResp.items ?? [];

        const stagedReads = await Promise.all(
          stagedItems.map(async (a: Artifact) => {
            try {
              return await artifactManager.read({
                artifact_id: a.id,
                stage: true,
                _rkwargs: true
              });
            } catch {
              return null;
            }
          })
        );

        // Keep the shared dropdown badge in sync: total in-review models
        // (unfiltered by type/search), refreshed whenever the pending view loads
        // — including after an accept / send-to-revision / withdraw-revision.
        setPendingReviewCount(
          stagedReads.filter((a: any) => a?.manifest?.status === 'in-review').length
        );

        // Separate request-review from revision-needed so we can sort them.
        // Request-review items appear first (truly pending); revision items
        // follow so the reviewer can track them and help the developer.
        let reviewPending: Artifact[] = stagedReads.filter(
          (a: any): a is Artifact => a?.manifest?.status === 'in-review' && matchesType(a)
        );
        let revisionNeeded: Artifact[] = stagedReads.filter(
          (a: any): a is Artifact => a?.manifest?.status === 'in-revision' && matchesType(a)
        );

        if (serverSearchQuery.trim()) {
          const q = serverSearchQuery.trim().toLowerCase();
          const matches = (a: Artifact) =>
            a.manifest?.name?.toLowerCase().includes(q) ||
            a.manifest?.description?.toLowerCase().includes(q) ||
            (a.id ?? '').toLowerCase().includes(q);
          reviewPending = reviewPending.filter(matches);
          revisionNeeded = revisionNeeded.filter(matches);
        }

        const pending = [...reviewPending, ...revisionNeeded];

        setReviewArtifactsTotalItems(pending.length);
        const start = (reviewArtifactsPage - 1) * itemsPerPage;
        setArtifacts(pending.slice(start, start + itemsPerPage));
      } else if (viewMode === 'staging') {
        // Staging: models that are already published (>=1 committed version) AND
        // currently have an active staging session. list(stage:true) returns
        // every staged child (incl. versionless drafts and pending-review), so
        // keep only those with a committed version.
        const resp = await artifactManager.list({
          parent_id: "bioimage-io/bioimage.io",
          stage: true,
          limit: 1000,
          pagination: true,
          _rkwargs: true
        });
        let items: Artifact[] = (resp.items ?? []).filter(
          (a: any) => (a.versions?.length ?? 0) > 0 && matchesType(a)
        );
        if (serverSearchQuery.trim()) {
          const q = serverSearchQuery.trim().toLowerCase();
          items = items.filter((a: any) =>
            a.manifest?.name?.toLowerCase().includes(q) ||
            a.manifest?.description?.toLowerCase().includes(q) ||
            (a.id ?? '').toLowerCase().includes(q)
          );
        }
        setReviewArtifactsTotalItems(items.length);
        const start = (reviewArtifactsPage - 1) * itemsPerPage;
        setArtifacts(items.slice(start, start + itemsPerPage));
      } else {
        // Published: committed models that are live in the zoo — status
        // `published` or none (legacy). Exclude the not-yet-approved states
        // (draft / in-review / in-revision) that shouldn't appear as published.
        const keywords: string[] = [];
        if (serverSearchQuery.trim()) keywords.push(serverSearchQuery.trim());

        const response = await artifactManager.list({
          parent_id: "bioimage-io/bioimage.io",
          keywords,
          stage: false,
          limit: 1000,
          pagination: true,
          _rkwargs: true
        });
        const NON_PUBLISHED = ['draft', 'in-review', 'in-revision'];
        const items: Artifact[] = (response.items ?? []).filter(
          (a: any) => !NON_PUBLISHED.includes(a.manifest?.status) && matchesType(a)
        );
        setReviewArtifactsTotalItems(items.length);
        const start = (reviewArtifactsPage - 1) * itemsPerPage;
        setArtifacts(items.slice(start, start + itemsPerPage));
      }
    } catch (err) {
      console.error('Error loading artifacts:', err);
      setError('Failed to load artifacts');
    } finally {
      setLoading(false);
    }
  };

  const handleApprove = async () => {
    if (!selectedArtifact || !artifactManager) return;

    try {
      setApproveLoading(true);
      await artifactManager.approve({
        artifact_id: selectedArtifact.id,
        _rkwargs: true
      });
      
      await loadArtifacts();
      setIsApproveDialogOpen(false);
      setSelectedArtifact(null);
    } catch (err) {
      console.error('Error approving artifact:', err);
      setError('Failed to approve artifact');
    } finally {
      setApproveLoading(false);
    }
  };

  const handleReject = async () => {
    if (!selectedArtifact || !artifactManager) return;

    try {
      setRejectLoading(true);
      await artifactManager.reject({
        artifact_id: selectedArtifact.id,
        reason: rejectReason,
        _rkwargs: true
      });
      
      await loadArtifacts();
      setIsRejectDialogOpen(false);
      setSelectedArtifact(null);
      setRejectReason('');
    } catch (err) {
      console.error('Error rejecting artifact:', err);
      setError('Failed to reject artifact');
    } finally {
      setRejectLoading(false);
    }
  };

  // Discard the staged changes of a PUBLISHED model (reverts to the committed
  // version). Only offered when the model has a committed version — never on a
  // versionless model, where discard would leave an orphan. Whole-model removal
  // goes through the Deletion Request flow instead (reviewers can't delete).
  const handleDiscardStaged = async () => {
    // Temporarily disabled — the Hypha `discard` deletes in-place staged files
    // from the committed version without restoring them (permanent data loss).
    // The menu item is disabled; guard here too so it can never fire.
    console.warn('Discard is temporarily disabled pending a Hypha backend fix.');
    return;
    // eslint-disable-next-line no-unreachable
    if (!artifactToDelete || !artifactManager) return;
    try {
      setDeleteLoading(true);
      await artifactManager.discard({
        artifact_id: artifactToDelete.id,
        _rkwargs: true
      });
      setIsDeleteDialogOpen(false);
      setArtifactToDelete(null);
      try {
        await loadArtifacts();
      } catch (refreshErr) {
        console.error('Error refreshing artifacts after discard:', refreshErr);
        setError('Staged changes were discarded, but refreshing the list failed. Please refresh manually.');
      }
    } catch (err) {
      console.error('Error discarding staged changes:', err);
      setError('Failed to discard staged changes');
    } finally {
      setDeleteLoading(false);
    }
  };

  const handleStatusChange = async (artifact: Artifact, newStatus: string) => {
    try {
      if (!artifact.manifest) return;
      const updatedManifest = { ...artifact.manifest };
      updatedManifest.status = newStatus;

      if (newStatus == "published"){
        // commit the artifact to the model zoo
        await artifactManager.commit({
          artifact_id: artifact.id,
          comment: "Committing artifact to model zoo",
          _rkwargs: true
        });
      } else {
        await artifactManager.edit({
          artifact_id: artifact.id,
          manifest: updatedManifest,
          stage: viewMode === 'published' ? false : true,
          _rkwargs: true
        });
      }
      // Refresh the list
      loadArtifacts();
    } catch (error) {
      console.error('Error updating status:', error);
    }
  };

  const handlePageChange = (page: number) => {
    setReviewArtifactsPage(page);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const pendingReviewCount = viewMode === 'pending'
    ? artifacts.filter(a => a.manifest?.status === 'in-review').length
    : 0;
  const revisionCount = viewMode === 'pending'
    ? artifacts.filter(a => a.manifest?.status === 'in-revision').length
    : 0;

  const handleCopyId = (artifactId: string) => {
    const id = artifactId.split('/').pop() || '';
    navigator.clipboard.writeText(id);
    setCopiedIds(prev => ({ ...prev, [artifactId]: true }));
    setTimeout(() => {
      setCopiedIds(prev => ({ ...prev, [artifactId]: false }));
    }, 2000);
  };

  const handleSearchChange = (query: string) => {
    setSearchQuery(query);
  };

  const handleAccept = async (artifact: Artifact) => {
    if (!artifactManager) return;

    try {
      setAcceptLoading(prev => ({ ...prev, [artifact.id]: true }));
      
      const acceptanceComment = `Accepted by ${user?.id || 'reviewer'}`;

      // List items may not carry `.staging`, so read the authoritative staged
      // state first. Gating the commit on a possibly-absent `artifact.staging`
      // would silently skip publishing and leave the model unaccepted.
      let currentArtifact = artifact;
      try {
        currentArtifact = await artifactManager.read({
          artifact_id: artifact.id,
          stage: true,
          _rkwargs: true
        });
      } catch {
        // Fall back to the list item if the staged read fails.
      }

      // Commit staged changes so the model gets/updates its published version.
      if (currentArtifact.staging) {
        currentArtifact = await artifactManager.commit({
          artifact_id: artifact.id,
          comment: acceptanceComment,
          _rkwargs: true
        });
      }

      // Update manifest status to 'published' using the latest manifest
      await artifactManager.edit({
        artifact_id: artifact.id,
        manifest: {
          ...currentArtifact.manifest,
          status: 'published'
        },
        _rkwargs: true
      });

      // Flip the model's test report to `type: "published-model"` so it appears
      // in the public grid immediately (the grid filters on that type). The
      // model-runner sets this when it writes the report; doing it here avoids
      // waiting for the next test run. Best-effort: a model may have no report yet.
      const shortId = artifact.id.split('/').pop();
      try {
        await artifactManager.edit({
          artifact_id: `bioimage-io/test-report-${shortId}`,
          type: 'published-model',
          _rkwargs: true
        });
      } catch (reportErr) {
        console.warn(`Could not flip test-report type for ${shortId} (no report yet?):`, reportErr);
      }

      // Refresh the list
      await loadArtifacts();
    } catch (error) {
      console.error('Error accepting artifact:', error);
      setError(`Failed to accept artifact: ${(error as any)?.message || error}`);
    } finally {
      setAcceptLoading(prev => ({ ...prev, [artifact.id]: false }));
    }
  };

  // Move an in-revision model back to in-review (undo a revision request).
  const handleWithdrawRevision = async (artifact: Artifact) => {
    if (!artifactManager || !artifact.manifest) return;
    try {
      await artifactManager.edit({
        artifact_id: artifact.id,
        manifest: { ...artifact.manifest, status: 'in-review' },
        stage: true,
        _rkwargs: true
      });
      await loadArtifacts();
    } catch (err) {
      console.error('Error withdrawing revision:', err);
      setError('Failed to withdraw revision');
    }
  };

  // Finalize a deletion (Deletion Request view). Requires typing the model id.
  const handleFinalizeDelete = async () => {
    if (!artifactToFinalize || !artifactManager) return;
    const shortId = artifactToFinalize.id.split('/').pop() || '';
    if (finalizeConfirm.trim() !== shortId) {
      setError('ID confirmation does not match. Deletion cancelled.');
      return;
    }
    setFinalizeLoading(true);
    setError(null);
    try {
      await artifactManager.delete({
        artifact_id: artifactToFinalize.id,
        delete_files: true,
        recursive: true,
        _rkwargs: true
      });
      // Also remove the model's test report so it doesn't linger as an orphan in
      // the test-reports collection. Best-effort: a model may have no report.
      try {
        await artifactManager.delete({
          artifact_id: `bioimage-io/test-report-${shortId}`,
          delete_files: true,
          recursive: true,
          _rkwargs: true
        });
      } catch (reportErr) {
        console.warn(`No test report to delete for ${shortId} (or deletion failed):`, reportErr);
      }
      setArtifactToFinalize(null);
      setFinalizeConfirm('');
      await loadArtifacts();
    } catch (err: any) {
      console.error('Error deleting artifact:', err);
      setError(`Failed to delete ${shortId}: ${err?.message || err}`);
    } finally {
      setFinalizeLoading(false);
    }
  };

  if (!isLoggedIn) {
    return (
      <div className="flex items-center justify-center h-screen bg-gray-50">
        <div className="text-center">
          <div className="mb-4">
            <RiLoginBoxLine className="mx-auto h-12 w-12 text-gray-400" />
          </div>
          <h2 className="text-xl font-semibold text-gray-900 mb-2">
            Admin Access Required
          </h2>
          <p className="text-gray-500 mb-4">
            Please login with admin credentials to review artifacts
          </p>
        </div>
      </div>
    );
  }

  // Logged in but access not yet resolved: avoid flashing the page.
  if (isReviewer === null) {
    return (
      <div className="flex items-center justify-center h-screen bg-gray-50">
        <ArrowPathIcon className="h-8 w-8 text-gray-400 animate-spin" />
      </div>
    );
  }

  // Logged in but not a reviewer: block access (the dropdown link is only hidden).
  if (!isReviewer) {
    return (
      <div className="flex items-center justify-center h-screen bg-gray-50">
        <div className="text-center">
          <div className="mb-4">
            <ExclamationTriangleIcon className="mx-auto h-12 w-12 text-gray-400" />
          </div>
          <h2 className="text-xl font-semibold text-gray-900 mb-2">
            Reviewer Access Required
          </h2>
          <p className="text-gray-500 mb-4">
            Your account is not a reviewer of the BioImage Model Zoo.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className={`flex flex-col bg-white`}>
      <div className={`bg-white border-b border-gray-200`}>
        <div className="py-6 max-w-screen-lg mx-auto">
          <div className="flex justify-between items-center">
            <h1 className="text-2xl font-semibold text-gray-900">
              {viewMode === 'published' ? "Manage Published Artifacts" :
               viewMode === 'staging' ? "Review Staged Artifacts" :
               viewMode === 'deletion' ? "Deletion Requests" :
               "Review Pending Artifacts"}
            </h1>
            <div className="flex items-center space-x-4">
              <div className="relative w-44">
                <Listbox value={typeFilter} onChange={handleTypeChange}>
                  <div className="relative mt-1">
                    <Listbox.Button className="relative w-full cursor-default rounded-lg bg-white py-2 pl-3 pr-10 text-left border border-gray-300 focus:outline-none focus-visible:border-blue-500 focus-visible:ring-2 sm:text-sm">
                      <span className="block truncate">
                        {typeOptions.find(o => o.id === typeFilter)?.name}
                      </span>
                      <span className="pointer-events-none absolute inset-y-0 right-0 flex items-center pr-2">
                        <ChevronDownIcon className="h-5 w-5 text-gray-400" aria-hidden="true" />
                      </span>
                    </Listbox.Button>
                    <Transition as={Fragment} leave="transition ease-in duration-100" leaveFrom="opacity-100" leaveTo="opacity-0">
                      <Listbox.Options className="absolute mt-1 max-h-60 w-full overflow-auto rounded-md bg-white py-1 text-base shadow-lg ring-1 ring-black ring-opacity-5 focus:outline-none sm:text-sm z-10">
                        {typeOptions.map((option) => (
                          <Listbox.Option
                            key={option.id}
                            className={({ active }) =>
                              `relative cursor-default select-none py-2 pl-10 pr-4 ${active ? 'bg-blue-100 text-blue-900' : 'text-gray-900'}`
                            }
                            value={option.id}
                          >
                            {({ selected }) => (
                              <>
                                <span className={`block truncate ${selected ? 'font-medium' : 'font-normal'}`}>{option.name}</span>
                                {selected ? (
                                  <span className="absolute inset-y-0 left-0 flex items-center pl-3 text-blue-600">
                                    <CheckCircleIcon className="h-5 w-5" aria-hidden="true" />
                                  </span>
                                ) : null}
                              </>
                            )}
                          </Listbox.Option>
                        ))}
                      </Listbox.Options>
                    </Transition>
                  </div>
                </Listbox>
              </div>
              <div className="relative w-64">
                <Listbox value={viewMode} onChange={handleViewModeChange}>
                  <div className="relative mt-1">
                    <Listbox.Button className="relative w-full cursor-default rounded-lg bg-white py-2 pl-3 pr-10 text-left border border-gray-300 focus:outline-none focus-visible:border-blue-500 focus-visible:ring-2 focus-visible:ring-white focus-visible:ring-opacity-75 focus-visible:ring-offset-2 focus-visible:ring-offset-blue-300 sm:text-sm">
                      <span className="block truncate">
                        {viewModeOptions.find(option => option.id === viewMode)?.name}
                      </span>
                      <span className="pointer-events-none absolute inset-y-0 right-0 flex items-center pr-2">
                        <ChevronDownIcon
                          className="h-5 w-5 text-gray-400"
                          aria-hidden="true"
                        />
                      </span>
                    </Listbox.Button>
                    <Transition
                      as={Fragment}
                      leave="transition ease-in duration-100"
                      leaveFrom="opacity-100"
                      leaveTo="opacity-0"
                    >
                      <Listbox.Options className="absolute mt-1 max-h-60 w-full overflow-auto rounded-md bg-white py-1 text-base shadow-lg ring-1 ring-black ring-opacity-5 focus:outline-none sm:text-sm z-10">
                        {viewModeOptions.map((option) => (
                          <Listbox.Option
                            key={option.id}
                            className={({ active }) =>
                              `relative cursor-default select-none py-2 pl-10 pr-4 ${
                                active ? 'bg-blue-100 text-blue-900' : 'text-gray-900'
                              }`
                            }
                            value={option.id}
                          >
                            {({ selected }) => (
                              <>
                                <span
                                  className={`block truncate ${
                                    selected ? 'font-medium' : 'font-normal'
                                  }`}
                                >
                                  {option.name}
                                </span>
                                {selected ? (
                                  <span className="absolute inset-y-0 left-0 flex items-center pl-3 text-blue-600">
                                    <CheckCircleIcon className="h-5 w-5" aria-hidden="true" />
                                  </span>
                                ) : null}
                              </>
                            )}
                          </Listbox.Option>
                        ))}
                      </Listbox.Options>
                    </Transition>
                  </div>
                </Listbox>
              </div>
              
              <button
                onClick={loadArtifacts}
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

          {/* Info Box with Collapsible Guidelines */}
          {viewMode !== 'deletion' && (viewMode !== 'published' || artifacts.length > 0) && (
            <div className="mt-4 bg-blue-50 border border-blue-200 rounded-lg p-4">
              <div className="flex">
                <div className="flex-shrink-0">
                  <InformationCircleIcon className="h-5 w-5 text-blue-400" aria-hidden="true" />
                </div>
                <div className="ml-3 w-full">
                  <h3 className="text-sm font-medium text-blue-800">
                    {viewMode === 'published' ? 
                      "Managing Published Models in the Model Zoo" : 
                      "Privileged Reviewer Access"}
                  </h3>
                  <div className="mt-2 text-sm text-blue-700">
                  {viewMode === 'pending' && (pendingReviewCount > 0 || revisionCount > 0) && (
                    <p className="mt-1">
                      {pendingReviewCount > 0 && (
                        <>{pendingReviewCount} item{pendingReviewCount !== 1 ? 's' : ''} awaiting review{revisionCount > 0 ? ', ' : '.'}</>
                      )}
                      {revisionCount > 0 && (
                        <>{revisionCount} item{revisionCount !== 1 ? 's' : ''} waiting for revision.</>
                      )}
                    </p>
                  )}
                    <p className="mt-1">
                      {viewMode === 'published' ? 
                        "As a privileged reviewer, you can edit and manage all published models in the BioImage Model Zoo. Any changes made will be immediately visible to users." : 
                        "As a privileged reviewer, your role is crucial in maintaining the quality and reliability of the BioImage Model Zoo. Please review each submission carefully according to our guidelines."}
                    </p>
                  </div>

                  {/* Collapsible Guidelines Section - Only show for non-published artifacts */}
                  {viewMode !== 'published' && (
                    <div className="mt-4 border-t border-blue-200 pt-4">
                      <button
                        className="w-full flex justify-between items-center text-left text-sm font-medium text-blue-800"
                        onClick={() => setIsGuidelinesOpen(!isGuidelinesOpen)}
                      >
                        <span>Review Guidelines</span>
                        {isGuidelinesOpen ? (
                          <ChevronUpIcon className="h-5 w-5 text-blue-500" />
                        ) : (
                          <ChevronDownIcon className="h-5 w-5 text-blue-500" />
                        )}
                      </button>
                      
                      <div className={`${isGuidelinesOpen ? 'block' : 'hidden'} overflow-hidden`}>
                        <div className="mt-4 text-sm text-blue-700">
                          <div className="space-y-4">
                            <div>
                              <h4 className="font-medium text-blue-800">1. Basic Information Completeness</h4>
                              <ul className="mt-1 list-disc list-inside space-y-1">
                                <li>Name is descriptive and follows convention (e.g., "3D UNet Arabidopsis Apical Stem Cells")</li>
                                <li>Authors and maintainers are properly listed with contact information</li>
                                <li>License is specified (e.g., MIT, Apache)</li>
                                <li>Proper citation information is included with DOI/URL</li>
                                <li>Tags are relevant and help in model discovery (e.g., "3d", "unet", "semantic-segmentation")</li>
                              </ul>
                            </div>
                            
                            <div>
                              <h4 className="font-medium text-blue-800">2. Documentation Quality</h4>
                              <ul className="mt-1 list-disc list-inside space-y-1">
                                <li>Description clearly explains:
                                  <ul className="ml-6 list-circle">
                                    <li>Model's purpose and use case</li>
                                    <li>Input data requirements (e.g., "confocal images of Arabidopsis thaliana")</li>
                                    <li>Expected results and output format</li>
                                  </ul>
                                </li>
                                <li>Documentation includes:
                                  <ul className="ml-6 list-circle">
                                    <li>Step-by-step usage instructions</li>
                                    <li>Input data specifications (e.g., voxel size, dimensions)</li>
                                    <li>Example workflow or notebook</li>
                                  </ul>
                                </li>
                              </ul>
                            </div>

                            <div>
                              <h4 className="font-medium text-blue-800">3. Technical Requirements</h4>
                              <ul className="mt-1 list-disc list-inside space-y-1">
                                <li>Input/Output specifications are complete:
                                  <ul className="ml-6 list-circle">
                                    <li>Correct axes information (e.g., "bczyx")</li>
                                    <li>Data types and ranges</li>
                                    <li>Shape requirements</li>
                                  </ul>
                                </li>
                                <li>Sample data is provided:
                                  <ul className="ml-6 list-circle">
                                    <li>Test inputs and outputs</li>
                                    <li>Sample images for verification</li>
                                    <li>Cover images showing input/output examples</li>
                                  </ul>
                                </li>
                                <li>Model weights and architecture are properly specified</li>
                              </ul>
                            </div>

                            <div>
                              <h4 className="font-medium text-blue-800">4. Visual Presentation</h4>
                              <ul className="mt-1 list-disc list-inside space-y-1">
                                <li>Cover images:
                                  <ul className="ml-6 list-circle">
                                    <li>Show clear input/output examples</li>
                                    <li>Are of good quality and representative</li>
                                    <li>Include scale bars where applicable</li>
                                  </ul>
                                </li>
                                <li>Icons and badges are appropriate and informative</li>
                                <li>Visual documentation helps understand the model's function</li>
                              </ul>
                            </div>

                            <div>
                              <h4 className="font-medium text-blue-800">5. Ethical & Scientific Standards</h4>
                              <ul className="mt-1 list-disc list-inside space-y-1">
                                <li>Training data is properly cited and credited</li>
                                <li>Model limitations and assumptions are clearly stated</li>
                                <li>Performance metrics and validation methods are documented</li>
                                <li>Potential biases or limitations are disclosed</li>
                                <li>Compliance with data privacy and sharing guidelines</li>
                              </ul>
                            </div>

                            <div className="bg-blue-100 p-3 rounded-md mt-4">
                              <h4 className="font-medium text-blue-800">Review Checklist</h4>
                              <p className="text-blue-700 text-sm mt-1">Before approving, ensure:</p>
                              <ul className="mt-2 space-y-1 text-blue-700 text-sm">
                                <li>✓ All required fields in RDF are completed</li>
                                <li>✓ Documentation is clear for non-expert users</li>
                                <li>✓ Sample data works as expected</li>
                                <li>✓ Visual materials are informative</li>
                                <li>✓ Scientific citations are proper</li>
                              </ul>
                            </div>
                          </div>
                        </div>
                      </div>
                    </div>
                  )}
                </div>
              </div>
            </div>
          )}
        </div>
      </div>

      <div className="p-6">
        <div className="max-w-screen-lg mx-auto">
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
              <CheckCircleIcon className="h-12 w-12 text-green-500 mb-4" />
              <p>No {viewMode === 'published' ? "published artifacts found" : "artifacts waiting for review"}</p>
            </div>
          ) : (
            <div className="bg-white shadow overflow-hidden sm:rounded-md">
              {/* Section header for pending-review view */}
              {viewMode === 'pending' && artifacts.some(a => a.manifest?.status === 'in-review') && (
                <div className="px-6 pt-4 pb-2">
                  <h2 className="text-sm font-semibold text-gray-500 uppercase tracking-wide">
                    Awaiting Review
                  </h2>
                </div>
              )}
              <ul role="list" className="space-y-6">
                {artifacts.map((artifact, index) => {
                  const isFirstRevision =
                    viewMode === 'pending' &&
                    artifact.manifest?.status === 'in-revision' &&
                    (index === 0 || artifacts[index - 1]?.manifest?.status !== 'in-revision');
                  return (
                  <React.Fragment key={artifact.id}>
                    {isFirstRevision && (
                      <li className="px-6 pt-4 pb-2 border-t-2 border-orange-200 bg-orange-50">
                        <h2 className="text-sm font-semibold text-orange-600 uppercase tracking-wide">
                          Needs Revision
                        </h2>
                        <p className="text-xs text-orange-500 mt-0.5">
                          These models have been sent back to the developer. Review progress and provide guidance.
                        </p>
                      </li>
                    )}
                  <li className={`py-2 ${index !== artifacts.length - 1 ? 'border-b border-gray-200 pb-6' : ''}`}>
                    <div className="px-4 py-6 sm:px-6 min-h-[300px]">
                      <div className="flex items-center justify-between">
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center justify-between mb-2">
                            <div className="space-y-2">
                              <div className="flex items-center gap-2">
                                {artifact.manifest?.id_emoji && (
                                  <span className="text-xl">{artifact.manifest.id_emoji}</span>
                                )}
                                <h3 className="text-lg font-medium text-gray-900 truncate">
                                  {artifact.manifest?.name || artifact.alias}
                                </h3>
                              </div>

                              <div className="flex items-center gap-1 text-xs text-gray-500">
                                <div className="flex items-center gap-1 bg-gray-50 rounded-md px-2 py-1">
                                  <span className="font-medium">ID:</span>
                                  <code className="font-mono">{artifact.id.split('/').pop()}</code>
                                  <Tooltip title="Copy ID" placement="top">
                                    <IconButton
                                      onClick={(e) => {
                                        e.stopPropagation();
                                        handleCopyId(artifact.id);
                                      }}
                                      size="small"
                                      className="ml-1 text-gray-400 hover:text-gray-600"
                                      sx={{ padding: '2px' }}
                                    >
                                      <ContentCopyIcon sx={{ fontSize: 14 }} />
                                    </IconButton>
                                  </Tooltip>
                                  {copiedIds[artifact.id] && (
                                    <span className="text-green-600 ml-1">Copied!</span>
                                  )}
                                </div>
                              </div>
                            </div>
                          </div>
                          <div className="flex items-center gap-2">
                              <StatusBadge status={artifact.manifest?.status} size="small" />
                            </div>
                          <p className="mt-1 text-sm text-gray-500">
                            Submitted by: {(() => {
                              // manifest.uploader (email + optional name) is far more
                              // human-readable than the opaque created_by id (which can
                              // even be a session id). Fall back to created_by when the
                              // uploader block is absent (~4/53 staged models).
                              const up = artifact.manifest?.uploader;
                              const email = up?.email;
                              const name = up?.name;
                              if (email && name) return `${name} <${email}>`;
                              return email || name || artifact.created_by;
                            })()}
                          </p>
                          <p className="mt-1 text-sm text-gray-500">
                            {artifact.manifest?.description || 'No description'}
                          </p>
                          <div className="mt-2 flex flex-wrap gap-2">
                            {artifact.manifest?.tags?.map((tag: string) => (
                              <span key={tag} className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-blue-100 text-blue-800">
                                {tag}
                              </span>
                            ))}
                          </div>
                          
                          {artifact.manifest?.covers && artifact.manifest.covers.length > 0 && (
                            <div className="mt-3 flex gap-2 overflow-x-auto">
                              {artifact.manifest.covers.slice(0, 3).map((cover: any, index: number) => (
                                <div 
                                  key={index}
                                  className="flex-shrink-0 w-24 h-24 rounded-lg overflow-hidden border border-gray-200"
                                >
                                  <img
                                    src={resolveHyphaUrl(cover, artifact.id)}
                                    alt={`Cover ${index + 1}`}
                                    className="w-full h-full object-cover"
                                  />
                                </div>
                              ))}
                            </div>
                          )}

                          {/* Deletion view: show the request reason + requester below the thumbnails. */}
                          {viewMode === 'deletion' && (
                            artifact.manifest?.request_deletion ? (
                              <div className="mt-3 rounded-lg border border-red-200 bg-red-50 p-3">
                                <p className="text-sm text-red-800">
                                  <span className="font-medium">Deletion requested:</span> {artifact.manifest.request_deletion.reason}
                                </p>
                                <p className="text-xs text-red-500 mt-1">
                                  Requested by {artifact.manifest.request_deletion.requested_by_email || artifact.manifest.request_deletion.requested_by}
                                </p>
                              </div>
                            ) : (
                              <div className="mt-3 rounded-lg border border-gray-200 bg-gray-50 p-3">
                                <p className="text-sm text-gray-600">Orphaned artifact: no committed version.</p>
                              </div>
                            )
                          )}
                        </div>
                        <div className="flex gap-2 items-center">
                          <button
                            onClick={() => {
                              const back = encodeURIComponent('/review?show=' + viewMode);
                              // Published: open the editor. Staging: open the staged
                              // editor (Edit, not Review). Pending & Deletion: open on
                              // the review tab of the staged editor to inspect it.
                              const path = viewMode === 'published'
                                ? `/edit/${encodeURIComponent(artifact.id)}?from=${back}`
                                : (viewMode === 'pending' || viewMode === 'deletion')
                                  ? `/edit/${encodeURIComponent(artifact.id)}/stage?tab=review&from=${back}`
                                  : `/edit/${encodeURIComponent(artifact.id)}/stage?from=${back}`;
                              navigate(path);
                            }}
                            className="inline-flex items-center px-3 py-2 border border-transparent text-sm leading-4 font-medium rounded-md text-white bg-blue-600 hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500"
                          >
                            {viewMode === 'pending' || viewMode === 'deletion' ? "Review" : "Edit"}
                          </button>
                          
                          <Menu as="div" className="relative">
                            <Menu.Button className="inline-flex items-center p-2 border border-gray-300 rounded-md text-gray-400 hover:text-gray-500 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500">
                              <EllipsisVerticalIcon className="h-5 w-5" />
                            </Menu.Button>
                            <Transition
                              as={Fragment}
                              enter="transition ease-out duration-100"
                              enterFrom="transform opacity-0 scale-95"
                              enterTo="transform opacity-100 scale-100"
                              leave="transition ease-in duration-75"
                              leaveFrom="transform opacity-100 scale-100"
                              leaveTo="transform opacity-0 scale-95"
                            >
                              <Menu.Items className="absolute right-0 z-10 mt-2 w-52 origin-top-right rounded-md bg-white py-1 shadow-lg ring-1 ring-black ring-opacity-5 focus:outline-none">
                                {(() => {
                                  const status = artifact.manifest?.status;
                                  const published = (artifact.versions?.length ?? 0) > 0;
                                  const hasDeletionReq = !!artifact.manifest?.request_deletion;
                                  // Discard: only staged edits on a published model (the Staging view).
                                  const canDiscard = viewMode === 'staging';
                                  // Commit the staged version: "Accept staged changes" in the Staging
                                  // view; "Publish model" for an in-review submission. NOT for
                                  // in-revision models (they go back to in-review first).
                                  const canAccept = viewMode === 'staging' || (viewMode === 'pending' && status === 'in-review');
                                  const inStaging = !!(artifact as any).staging;
                                  // Request deletion: published models (Published view) or versionless
                                  // in-review/in-revision models. Not in the Staging view at all. In the
                                  // Published view it's disabled while the model has a staging session —
                                  // the request would share that staging and be wiped by a discard.
                                  const canRequestDeletion = !hasDeletionReq &&
                                    (viewMode === 'published' ||
                                     (viewMode === 'pending' && (status === 'in-review' || status === 'in-revision')));
                                  const requestDeletionDisabled = viewMode === 'published' && inStaging;
                                  const stagingTip = 'This model is currently in staging mode. Discard or commit the changes before requesting a deletion.';
                                  // Withdraw deletion request: published + in-review/in-revision; disabled while a
                                  // published model is in staging (can't cleanly commit the withdrawal).
                                  const canWithdrawDeletion = hasDeletionReq &&
                                    (published || status === 'in-review' || status === 'in-revision');
                                  const withdrawDisabled = viewMode === 'staging';
                                  // canAccept is true for pending (and staging), so it already
                                  // covers "are there action buttons above the deletion items".
                                  const showDivider = (canAccept || canDiscard) &&
                                    (canRequestDeletion || canWithdrawDeletion);
                                  const item = 'flex w-full items-center px-4 py-2 text-sm';
                                  return (
                                    <>
                                      {viewMode === 'pending' && (
                                        <Menu.Item>
                                          {({ active }) => (
                                            status === 'in-revision' ? (
                                              <button onClick={() => handleWithdrawRevision(artifact)}
                                                className={`${active ? 'bg-gray-100' : ''} ${item} text-gray-700`}>
                                                Withdraw Revision
                                              </button>
                                            ) : (
                                              <button onClick={() => handleStatusChange(artifact, 'in-revision')}
                                                className={`${active ? 'bg-gray-100' : ''} ${item} text-gray-700`}>
                                                Request Revision
                                              </button>
                                            )
                                          )}
                                        </Menu.Item>
                                      )}
                                      {canAccept && (
                                        <Menu.Item>
                                          {({ active }) => (
                                            <button onClick={() => handleAccept(artifact)} disabled={acceptLoading[artifact.id]}
                                              className={`${active ? 'bg-gray-100' : ''} ${item} text-gray-700 ${acceptLoading[artifact.id] ? 'opacity-50 cursor-not-allowed' : ''}`}>
                                              {acceptLoading[artifact.id] ? (
                                                <div className="flex items-center">
                                                  <svg className="animate-spin -ml-1 mr-2 h-4 w-4 text-gray-700" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                                                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                                                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                                                  </svg>
                                                  {viewMode === 'staging' ? 'Accepting...' : 'Publishing...'}
                                                </div>
                                              ) : (viewMode === 'staging' ? "Accept staged changes" : "Publish model")}
                                            </button>
                                          )}
                                        </Menu.Item>
                                      )}
                                      {canDiscard && (
                                        <Menu.Item disabled>
                                          {() => (
                                            // Temporarily disabled: Hypha `discard` deletes in-place
                                            // staged files from the committed version without restoring
                                            // them (permanent data loss). Re-enable once the backend is fixed.
                                            <Tooltip title="Temporarily disabled: discarding staged edits can delete committed files due to a Hypha bug. Re-enabled once the backend is fixed." placement="left" arrow>
                                              <span className={`${item} text-gray-400 opacity-50 cursor-not-allowed`}>
                                                Discard staged changes
                                              </span>
                                            </Tooltip>
                                          )}
                                        </Menu.Item>
                                      )}
                                      {showDivider && <div className="border-t border-gray-100" />}
                                      {canRequestDeletion && (
                                        <Menu.Item disabled={requestDeletionDisabled}>
                                          {({ active }) => (
                                            requestDeletionDisabled ? (
                                              <Tooltip title={stagingTip} placement="left" arrow>
                                                <span className={`${item} text-red-600 opacity-50 cursor-not-allowed`}>
                                                  Request deletion
                                                </span>
                                              </Tooltip>
                                            ) : (
                                              <button onClick={() => setArtifactToRequestDeletion(artifact)}
                                                className={`${active ? 'bg-gray-100' : ''} ${item} text-red-600`}>
                                                Request deletion
                                              </button>
                                            )
                                          )}
                                        </Menu.Item>
                                      )}
                                      {viewMode === 'deletion' && (
                                        <Menu.Item>
                                          {({ active }) => (
                                            <button onClick={() => { setArtifactToFinalize(artifact); setFinalizeConfirm(''); }}
                                              className={`${active ? 'bg-gray-100' : ''} ${item} text-red-600`}>
                                              {hasDeletionReq ? 'Accept deletion request' : 'Delete permanently'}
                                            </button>
                                          )}
                                        </Menu.Item>
                                      )}
                                      {canWithdrawDeletion && (
                                        <Menu.Item disabled={withdrawDisabled}>
                                          {({ active }) => (
                                            withdrawDisabled ? (
                                              <Tooltip title={stagingTip} placement="left" arrow>
                                                <span className={`${item} text-gray-700 opacity-50 cursor-not-allowed`}>
                                                  Decline deletion request
                                                </span>
                                              </Tooltip>
                                            ) : (
                                              <button onClick={() => setArtifactToDeclineDeletion(artifact)}
                                                className={`${active ? 'bg-gray-100' : ''} ${item} text-gray-700`}>
                                                Decline deletion request
                                              </button>
                                            )
                                          )}
                                        </Menu.Item>
                                      )}
                                    </>
                                  );
                                })()}
                              </Menu.Items>
                            </Transition>
                          </Menu>
                        </div>
                      </div>
                    </div>
                  </li>
                  </React.Fragment>
                  );
                })}
              </ul>
            </div>
          )}
        </div>
      </div>

      {/* Approve Dialog */}
      <Transition.Root show={isApproveDialogOpen} as={Fragment}>
        <Dialog as="div" className="relative z-10" onClose={setIsApproveDialogOpen}>
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
              <Dialog.Panel className="relative transform overflow-hidden rounded-lg bg-white px-4 pb-4 pt-5 text-left shadow-xl transition-all sm:my-8 sm:w-full sm:max-w-lg sm:p-6">
                <div className="sm:flex sm:items-start">
                  <div className="mx-auto flex h-12 w-12 flex-shrink-0 items-center justify-center rounded-full bg-green-100 sm:mx-0 sm:h-10 sm:w-10">
                    <CheckCircleIcon className="h-6 w-6 text-green-600" />
                  </div>
                  <div className="mt-3 text-center sm:ml-4 sm:mt-0 sm:text-left">
                    <Dialog.Title as="h3" className="text-base font-semibold leading-6 text-gray-900">
                      Approve Artifact
                    </Dialog.Title>
                    <div className="mt-2">
                      <p className="text-sm text-gray-500">
                        Are you sure you want to approve this artifact? This will publish the staged version.
                      </p>
                    </div>
                  </div>
                </div>
                <div className="mt-5 sm:mt-4 sm:flex sm:flex-row-reverse">
                  <button
                    type="button"
                    className={`inline-flex w-full justify-center rounded-md ${approveLoading ? 'bg-green-400' : 'bg-green-600 hover:bg-green-500'} px-3 py-2 text-sm font-semibold text-white shadow-sm sm:ml-3 sm:w-auto ${approveLoading ? 'cursor-not-allowed' : ''}`}
                    onClick={handleApprove}
                    disabled={approveLoading}
                  >
                    {approveLoading ? (
                      <div className="flex items-center">
                        <svg className="animate-spin -ml-1 mr-2 h-4 w-4 text-white" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                          <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                          <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                        </svg>
                        Approving...
                      </div>
                    ) : "Approve"}
                  </button>
                  <button
                    type="button"
                    className="mt-3 inline-flex w-full justify-center rounded-md bg-white px-3 py-2 text-sm font-semibold text-gray-900 shadow-sm ring-1 ring-inset ring-gray-300 hover:bg-gray-50 sm:mt-0 sm:w-auto"
                    onClick={() => setIsApproveDialogOpen(false)}
                    disabled={approveLoading}
                  >
                    Cancel
                  </button>
                </div>
              </Dialog.Panel>
            </div>
          </div>
        </Dialog>
      </Transition.Root>

      {/* Reject Dialog */}
      <Transition.Root show={isRejectDialogOpen} as={Fragment}>
        <Dialog as="div" className="relative z-10" onClose={setIsRejectDialogOpen}>
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
              <Dialog.Panel className="relative transform overflow-hidden rounded-lg bg-white px-4 pb-4 pt-5 text-left shadow-xl transition-all sm:my-8 sm:w-full sm:max-w-lg sm:p-6">
                <div className="sm:flex sm:items-start">
                  <div className="mx-auto flex h-12 w-12 flex-shrink-0 items-center justify-center rounded-full bg-red-100 sm:mx-0 sm:h-10 sm:w-10">
                    <ExclamationTriangleIcon className="h-6 w-6 text-red-600" />
                  </div>
                  <div className="mt-3 text-center sm:ml-4 sm:mt-0 sm:text-left w-full">
                    <Dialog.Title as="h3" className="text-base font-semibold leading-6 text-gray-900">
                      Reject Artifact
                    </Dialog.Title>
                    <div className="mt-2">
                      <textarea
                        rows={4}
                        className="block w-full rounded-md border-0 py-1.5 text-gray-900 shadow-sm ring-1 ring-inset ring-gray-300 placeholder:text-gray-400 focus:ring-2 focus:ring-inset focus:ring-blue-600 sm:text-sm sm:leading-6"
                        placeholder="Please provide a reason for rejection..."
                        value={rejectReason}
                        onChange={(e) => setRejectReason(e.target.value)}
                        disabled={rejectLoading}
                      />
                    </div>
                  </div>
                </div>
                <div className="mt-5 sm:mt-4 sm:flex sm:flex-row-reverse">
                  <button
                    type="button"
                    className={`inline-flex w-full justify-center rounded-md ${rejectLoading ? 'bg-red-400' : 'bg-red-600 hover:bg-red-500'} px-3 py-2 text-sm font-semibold text-white shadow-sm sm:ml-3 sm:w-auto ${rejectLoading || !rejectReason.trim() ? 'cursor-not-allowed' : ''}`}
                    onClick={handleReject}
                    disabled={rejectLoading || !rejectReason.trim()}
                  >
                    {rejectLoading ? (
                      <div className="flex items-center">
                        <svg className="animate-spin -ml-1 mr-2 h-4 w-4 text-white" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                          <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                          <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                        </svg>
                        Rejecting...
                      </div>
                    ) : "Reject"}
                  </button>
                  <button
                    type="button"
                    className="mt-3 inline-flex w-full justify-center rounded-md bg-white px-3 py-2 text-sm font-semibold text-gray-900 shadow-sm ring-1 ring-inset ring-gray-300 hover:bg-gray-50 sm:mt-0 sm:w-auto"
                    onClick={() => {
                      setIsRejectDialogOpen(false);
                      setRejectReason('');
                    }}
                    disabled={rejectLoading}
                  >
                    Cancel
                  </button>
                </div>
              </Dialog.Panel>
            </div>
          </div>
        </Dialog>
      </Transition.Root>

      {/* Discard Staged Changes Confirmation Dialog */}
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
              <Dialog.Panel className="relative transform overflow-hidden rounded-lg bg-white px-4 pb-4 pt-5 text-left shadow-xl transition-all sm:my-8 sm:w-full sm:max-w-lg sm:p-6">
                <div className="sm:flex sm:items-start">
                  <div className="mx-auto flex h-12 w-12 flex-shrink-0 items-center justify-center rounded-full bg-amber-100 sm:mx-0 sm:h-10 sm:w-10">
                    <ExclamationTriangleIcon className="h-6 w-6 text-amber-600" />
                  </div>
                  <div className="mt-3 text-center sm:ml-4 sm:mt-0 sm:text-left">
                    <Dialog.Title as="h3" className="text-base font-semibold leading-6 text-gray-900">
                      Discard staged changes
                    </Dialog.Title>
                    <div className="mt-2">
                      <p className="text-sm text-gray-500">
                        This reverts the model to its last published version, discarding the staged
                        edits under review. The published model itself is not removed.
                      </p>
                    </div>
                  </div>
                </div>
                <div className="mt-5 sm:mt-4 sm:flex sm:flex-row-reverse">
                  <button
                    type="button"
                    className={`inline-flex w-full justify-center rounded-md ${deleteLoading ? 'bg-amber-400' : 'bg-amber-600 hover:bg-amber-500'} px-3 py-2 text-sm font-semibold text-white shadow-sm sm:ml-3 sm:w-auto ${
                      deleteLoading ? 'cursor-not-allowed opacity-60' : ''
                    }`}
                    onClick={handleDiscardStaged}
                    disabled={deleteLoading}
                  >
                    {deleteLoading ? (
                      <div className="flex items-center">
                        <svg className="animate-spin -ml-1 mr-2 h-4 w-4 text-white" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                          <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                          <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                        </svg>
                        Discarding...
                      </div>
                    ) : "Discard changes"}
                  </button>
                  <button
                    type="button"
                    className="mt-3 inline-flex w-full justify-center rounded-md bg-white px-3 py-2 text-sm font-semibold text-gray-900 shadow-sm ring-1 ring-inset ring-gray-300 hover:bg-gray-50 sm:mt-0 sm:w-auto"
                    onClick={() => {
                      setIsDeleteDialogOpen(false);
                      setArtifactToDelete(null);
                    }}
                    disabled={deleteLoading}
                  >
                    Cancel
                  </button>
                </div>
              </Dialog.Panel>
            </div>
          </div>
        </Dialog>
      </Transition.Root>

      {/* Request Deletion Dialog (reviewer marks a model; site-admin finalizes) */}
      {artifactToRequestDeletion && user && (
        <RequestDeletionDialog
          artifact={artifactToRequestDeletion}
          artifactManager={artifactManager}
          user={user}
          onClose={() => setArtifactToRequestDeletion(null)}
          onRequested={() => { loadArtifacts(); }}
        />
      )}

      {/* Decline Deletion Dialog (deletion view: keep the model, reason to comments) */}
      {artifactToDeclineDeletion && user && (
        <DeclineDeletionDialog
          artifact={artifactToDeclineDeletion}
          artifactManager={artifactManager}
          user={user}
          onClose={() => setArtifactToDeclineDeletion(null)}
          onDeclined={() => { loadArtifacts(); }}
        />
      )}

      {/* Accept Deletion Request Dialog — permanently delete; requires typing the id */}
      <Transition.Root show={!!artifactToFinalize} as={Fragment}>
        <Dialog as="div" className="relative z-10" onClose={() => { if (!finalizeLoading) { setArtifactToFinalize(null); setFinalizeConfirm(''); } }}>
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
              <Dialog.Panel className="relative transform overflow-hidden rounded-lg bg-white px-4 pb-4 pt-5 text-left shadow-xl transition-all sm:my-8 sm:w-full sm:max-w-lg sm:p-6">
                <div className="sm:flex sm:items-start">
                  <div className="mx-auto flex h-12 w-12 flex-shrink-0 items-center justify-center rounded-full bg-red-100 sm:mx-0 sm:h-10 sm:w-10">
                    <TrashIcon className="h-6 w-6 text-red-600" />
                  </div>
                  <div className="mt-3 text-center sm:ml-4 sm:mt-0 sm:text-left w-full">
                    <Dialog.Title as="h3" className="text-base font-semibold leading-6 text-gray-900">
                      Accept deletion request
                    </Dialog.Title>
                    <div className="mt-2 space-y-3">
                      <p className="text-sm text-gray-500">
                        This permanently deletes the model and all of its files. This cannot be undone.
                        Type the model id{' '}
                        <span className="font-mono font-semibold text-gray-700">
                          {artifactToFinalize?.id?.split('/').pop()}
                        </span>{' '}
                        to confirm.
                      </p>
                      <input
                        type="text"
                        value={finalizeConfirm}
                        onChange={(e) => setFinalizeConfirm(e.target.value)}
                        placeholder="Enter model id"
                        disabled={finalizeLoading}
                        className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-red-500 focus:border-red-500 font-mono text-sm"
                      />
                    </div>
                  </div>
                </div>
                <div className="mt-5 sm:mt-4 sm:flex sm:flex-row-reverse">
                  <button
                    type="button"
                    className={`inline-flex w-full justify-center rounded-md px-3 py-2 text-sm font-semibold text-white shadow-sm sm:ml-3 sm:w-auto ${
                      finalizeConfirm.trim() === (artifactToFinalize?.id?.split('/').pop() || '') && !finalizeLoading
                        ? 'bg-red-600 hover:bg-red-500'
                        : 'bg-red-300 cursor-not-allowed'
                    }`}
                    onClick={handleFinalizeDelete}
                    disabled={finalizeLoading || finalizeConfirm.trim() !== (artifactToFinalize?.id?.split('/').pop() || '')}
                  >
                    {finalizeLoading ? 'Deleting…' : 'Delete permanently'}
                  </button>
                  <button
                    type="button"
                    className="mt-3 inline-flex w-full justify-center rounded-md bg-white px-3 py-2 text-sm font-semibold text-gray-900 shadow-sm ring-1 ring-inset ring-gray-300 hover:bg-gray-50 sm:mt-0 sm:w-auto"
                    onClick={() => { setArtifactToFinalize(null); setFinalizeConfirm(''); }}
                    disabled={finalizeLoading}
                  >
                    Cancel
                  </button>
                </div>
              </Dialog.Panel>
            </div>
          </div>
        </Dialog>
      </Transition.Root>

      {artifacts.length > 0 && (
        <div className="mt-6 max-w-screen-lg mx-auto">
          <Pagination
            currentPage={reviewArtifactsPage}
            totalPages={Math.ceil(reviewArtifactsTotalItems / itemsPerPage)}
            totalItems={reviewArtifactsTotalItems}
            onPageChange={handlePageChange}
          />
        </div>
      )}
    </div>
  );
};

export default ReviewArtifacts; 