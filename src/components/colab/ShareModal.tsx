import React, { useMemo, useState } from 'react';
import { AccessRequest, BrokerRole, DatasetWithRole, dismissAccessRequest, setRole } from './brokerApi';
import { buildAnnotateQuery } from './datasetApi';
import SharingPanel from './SharingPanel';

interface ShareModalProps {
  server: any;
  artifactId: string;
  role: BrokerRole;
  dataset: DatasetWithRole;
  initialLabel?: string | null;
  cellposeModel?: string;
  onChanged: () => void;
  setShowShareModal: (show: boolean) => void;
}

const QR_SIZE = 200;

/** Collapsible QR code section */
const QRCodeSection: React.FC<{ url: string; label: string }> = ({ url, label }) => {
  const [expanded, setExpanded] = useState(false);
  const qrUrl = `https://api.qrserver.com/v1/create-qr-code/?size=${QR_SIZE}x${QR_SIZE}&data=${encodeURIComponent(url)}`;

  return (
    <div className="mt-2">
      <button
        onClick={() => setExpanded(!expanded)}
        className="text-sm text-purple-600 hover:text-purple-800 transition-colors flex items-center gap-1"
      >
        <svg
          className={`w-4 h-4 transition-transform ${expanded ? 'rotate-180' : ''}`}
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
        >
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
        </svg>
        {expanded ? 'Hide' : 'Show'} QR Code
      </button>
      {expanded && (
        <div className="flex justify-center mt-2">
          <div className="bg-white p-3 rounded-lg border border-gray-200 shadow-sm">
            <img
              src={qrUrl}
              alt={`QR Code for ${label}`}
              className="w-48 h-48"
              onError={(e) => {
                (e.target as HTMLImageElement).alt = 'QR code could not be generated';
              }}
            />
          </div>
        </div>
      )}
    </div>
  );
};

/** Copy icon SVG */
const CopyIcon: React.FC<{ copied: boolean }> = ({ copied }) =>
  copied ? (
    <svg className="w-5 h-5 text-green-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
    </svg>
  ) : (
    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth={2}
        d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z"
      />
    </svg>
  );

/** URL field with copy button */
const URLField: React.FC<{
  label: string;
  url: string;
  qrLabel: string;
}> = ({ label, url, qrLabel }) => {
  const [feedback, setFeedback] = useState('Copy');

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(url);
      setFeedback('Copied!');
      setTimeout(() => setFeedback('Copy'), 2000);
    } catch {
      setFeedback('Failed');
      setTimeout(() => setFeedback('Copy'), 2000);
    }
  };

  return (
    <div>
      <label className="block text-sm font-medium text-gray-700 mb-1.5">{label}</label>
      <div className="relative">
        <input
          type="text"
          value={url}
          readOnly
          className="w-full px-4 py-2.5 pr-12 border border-gray-300 rounded-lg bg-gray-50 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-purple-500"
        />
        <button
          onClick={handleCopy}
          className="absolute right-2 top-1/2 transform -translate-y-1/2 p-1.5 text-gray-500 hover:text-purple-600 transition-colors"
          title="Copy URL"
        >
          <CopyIcon copied={feedback === 'Copied!'} />
        </button>
      </div>
      <QRCodeSection url={url} label={qrLabel} />
    </div>
  );
};

/**
 * One pending access request: pre-filled email, a role picker, and
 * Add/Dismiss actions. Add grants the role via `setRole`, which clears the
 * request server-side too, so a plain `onChanged()` after either action is
 * enough to make the row disappear.
 */
const AccessRequestRow: React.FC<{
  server: any;
  artifactId: string;
  request: AccessRequest;
  isOwner: boolean;
  onChanged: () => void;
}> = ({ server, artifactId, request, isOwner, onChanged }) => {
  const defaultRole = request.requested_role === 'manager' && isOwner ? 'manager' : 'annotator';
  const [selectedRole, setSelectedRole] = useState<'manager' | 'annotator'>(defaultRole);
  const [busy, setBusy] = useState<'add' | 'dismiss' | null>(null);
  const [error, setError] = useState<string | null>(null);

  const handleAdd = async () => {
    setBusy('add');
    setError(null);
    try {
      await setRole(server, artifactId, { email: request.email }, selectedRole);
      onChanged();
    } catch (err) {
      setError((err as Error).message || 'Failed to grant access.');
      setBusy(null);
    }
  };

  const handleDismiss = async () => {
    setBusy('dismiss');
    setError(null);
    try {
      await dismissAccessRequest(server, artifactId, { email: request.email });
      onChanged();
    } catch (err) {
      setError((err as Error).message || 'Failed to dismiss request.');
      setBusy(null);
    }
  };

  return (
    <li className="py-2">
      <div className="flex items-center gap-2">
        <span className="flex-1 min-w-0 truncate text-sm text-gray-800">{request.email}</span>
        <select
          value={selectedRole}
          onChange={(e) => setSelectedRole(e.target.value as 'manager' | 'annotator')}
          disabled={!!busy}
          className="px-2 py-1.5 text-sm border border-gray-300 rounded-lg"
        >
          <option value="annotator">Annotator</option>
          {isOwner && <option value="manager">Manager</option>}
        </select>
        <button
          onClick={handleAdd}
          disabled={!!busy}
          className="px-3 py-1.5 bg-purple-600 text-white rounded-lg hover:bg-purple-700 disabled:bg-gray-300 text-sm font-medium transition-colors shrink-0"
        >
          {busy === 'add' ? 'Adding...' : 'Add'}
        </button>
        <button
          onClick={handleDismiss}
          disabled={!!busy}
          className="text-xs text-gray-400 hover:text-red-600 transition-colors shrink-0"
        >
          {busy === 'dismiss' ? 'Dismissing...' : 'Dismiss'}
        </button>
      </div>
      {error && <p className="mt-1 text-xs text-red-600">{error}</p>}
    </li>
  );
};

const AccessRequestsSection: React.FC<{
  server: any;
  artifactId: string;
  role: BrokerRole;
  requests: AccessRequest[];
  onChanged: () => void;
}> = ({ server, artifactId, role, requests, onChanged }) => {
  if (requests.length === 0) return null;
  const isOwner = role === 'owner';
  return (
    <div className="bg-white rounded-2xl border border-gray-200 p-4">
      <h3 className="text-sm font-semibold text-gray-900 mb-1">Pending access requests</h3>
      <p className="text-xs text-gray-500 mb-2">
        Add grants the selected role and clears the request. Dismiss clears it without granting access.
      </p>
      <ul className="divide-y divide-gray-100">
        {requests.map((req) => (
          <AccessRequestRow
            key={req.id || req.email}
            server={server}
            artifactId={artifactId}
            request={req}
            isOwner={isOwner}
            onChanged={onChanged}
          />
        ))}
      </ul>
    </div>
  );
};

const ShareModal: React.FC<ShareModalProps> = ({
  server,
  artifactId,
  role,
  dataset,
  initialLabel,
  cellposeModel,
  onChanged,
  setShowShareModal,
}) => {
  const labels = dataset.labels ?? [];
  const [selectedLabel, setSelectedLabel] = useState<string>(
    (initialLabel && labels.some((l) => l.name === initialLabel) ? initialLabel : labels[0]?.name) ?? '',
  );

  const annotationURL = useMemo(
    () =>
      selectedLabel
        ? `${window.location.origin}/colab/annotate?${buildAnnotateQuery(artifactId, selectedLabel, cellposeModel)}`
        : '',
    [artifactId, selectedLabel, cellposeModel],
  );

  return (
    <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-50 animate-fadeIn p-4">
      <div className="bg-white/95 backdrop-blur-md rounded-2xl shadow-lg max-w-2xl w-full max-h-[90vh] border border-white/20 flex flex-col">
        {/* Header */}
        <div className="p-6 border-b border-gray-200/50 flex-shrink-0">
          <div className="flex items-center justify-between">
            <div className="flex items-center">
              <div className="w-10 h-10 bg-gradient-to-r from-purple-500 to-pink-500 rounded-xl flex items-center justify-center mr-3">
                <svg className="w-5 h-5 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M8.684 13.342C8.886 12.938 9 12.482 9 12c0-.482-.114-.938-.316-1.342m0 2.684a3 3 0 110-2.684m0 2.684l6.632 3.316m-6.632-6l6.632-3.316m0 0a3 3 0 105.367-2.684 3 3 0 00-5.367 2.684zm0 9.316a3 3 0 105.368 2.684 3 3 0 00-5.368-2.684z"
                  />
                </svg>
              </div>
              <h3 className="text-lg font-semibold text-gray-800">Share Dataset</h3>
            </div>
            <button
              onClick={() => setShowShareModal(false)}
              className="text-gray-400 hover:text-gray-600 transition-colors"
            >
              <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>
        </div>

        {/* Scrollable Content */}
        <div className="overflow-y-auto flex-1">
          <div className="p-6 space-y-5">
            <SharingPanel server={server} artifactId={artifactId} role={role} dataset={dataset} onChanged={onChanged} />

            <AccessRequestsSection
              server={server}
              artifactId={artifactId}
              role={role}
              requests={dataset.access_requests ?? []}
              onChanged={onChanged}
            />

            {labels.length > 0 ? (
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1.5">Annotation Label</label>
                <select
                  value={selectedLabel}
                  onChange={(e) => setSelectedLabel(e.target.value)}
                  className="px-3 py-1.5 text-sm border border-gray-300 rounded-lg focus:ring-2 focus:ring-purple-500 focus:border-purple-500"
                >
                  {labels.map((l) => (
                    <option key={l.name} value={l.name}>
                      {l.name}
                    </option>
                  ))}
                </select>

                <div className="mt-3">
                  <URLField label="Annotation URL" url={annotationURL} qrLabel={selectedLabel} />
                </div>
                <p className="mt-2 text-xs text-gray-500">
                  Share this link with collaborators to annotate together. Annotations are saved to the cloud
                  automatically.
                </p>
              </div>
            ) : (
              <p className="text-xs text-gray-500">Create a label first to get a shareable annotation link.</p>
            )}
          </div>
        </div>

        {/* Footer */}
        <div className="p-6 pt-0 border-t border-gray-200/50 flex justify-end space-x-3 flex-shrink-0">
          <button
            onClick={() => setShowShareModal(false)}
            className="px-6 py-2.5 bg-gray-100 text-gray-700 rounded-xl hover:bg-gray-200 transition-all duration-200 font-medium"
          >
            Close
          </button>
          {annotationURL && (
            <a
              href={annotationURL}
              className="px-6 py-2.5 bg-gradient-to-r from-purple-600 to-pink-600 text-white rounded-xl hover:from-purple-700 hover:to-pink-700 shadow-sm hover:shadow-md transition-all duration-200 font-medium"
            >
              Open Annotation UI
            </a>
          )}
        </div>
      </div>
    </div>
  );
};

export default ShareModal;
