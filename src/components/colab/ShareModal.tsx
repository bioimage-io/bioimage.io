import React, { useEffect, useMemo, useRef, useState } from 'react';
import QRCode from 'qrcode';
import { AccessRequest, BrokerRole, BrokerUserRef, DatasetWithRole, getDataset, updateSharing } from './brokerApi';
import { buildAnnotateQuery } from './datasetApi';
import SharingPanel, { PendingAdd, userKey } from './SharingPanel';

interface ShareModalProps {
  server: any;
  artifactId: string;
  role: BrokerRole;
  dataset: DatasetWithRole;
  datasetName: string;
  selectedLabel: string;
  onSelectLabel: (label: string) => void;
  onChanged: () => void | Promise<void>;
  setShowShareModal: (show: boolean) => void;
}

// 80% of the previous 200px (colab-rework-plan.md §21 item 4).
const QR_SIZE = 160;
const QR_ENLARGED_SIZE = 320;
// Higher-resolution render used only for the copy/download outputs, independent
// of what's shown on screen.
const QR_EXPORT_SIZE = 512;

// How often the Access requests list is re-polled while the dialog is open
// (colab-rework-plan.md §22 item 3).
const ACCESS_REQUESTS_POLL_MS = 20_000;

const slugify = (value: string) => value.trim().toLowerCase().replace(/\s+/g, '-');

/** Renders a QR code for `url` onto a canvas at `size`, client-side (no external
 * image request), so the copy/download buttons never hit a cross-origin canvas. */
const QRCodeCanvas: React.FC<{ url: string; size: number }> = ({ url, size }) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    if (!canvasRef.current || !url) return;
    QRCode.toCanvas(canvasRef.current, url, { width: size, margin: 1 }).catch(() => {});
  }, [url, size]);

  return <canvas ref={canvasRef} width={size} height={size} />;
};

const renderQrBlob = (url: string): Promise<Blob | null> =>
  new Promise((resolve, reject) => {
    const canvas = document.createElement('canvas');
    QRCode.toCanvas(canvas, url, { width: QR_EXPORT_SIZE, margin: 1 })
      .then(() => canvas.toBlob((blob) => resolve(blob), 'image/png'))
      .catch(reject);
  });

/** QR code section: click to enlarge for scanning, plus copy-image and download. */
const QRCodeSection: React.FC<{ url: string; label: string; datasetName: string }> = ({ url, label, datasetName }) => {
  const [enlarged, setEnlarged] = useState(false);
  const [copyFeedback, setCopyFeedback] = useState('Copy image');

  const handleCopyImage = async () => {
    try {
      const blob = await renderQrBlob(url);
      if (!blob) throw new Error('Failed to render QR code');
      const ClipboardItemCtor = (window as any).ClipboardItem;
      if (!ClipboardItemCtor) throw new Error('Clipboard image copy is not supported in this browser');
      await navigator.clipboard.write([new ClipboardItemCtor({ 'image/png': blob })]);
      setCopyFeedback('Copied!');
    } catch {
      setCopyFeedback('Failed');
    } finally {
      setTimeout(() => setCopyFeedback('Copy image'), 2000);
    }
  };

  const handleDownload = async () => {
    const blob = await renderQrBlob(url);
    if (!blob) return;
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    const namePart = slugify(datasetName) || 'dataset';
    const labelPart = slugify(label) || 'annotation';
    link.download = `${namePart}-${labelPart}.png`;
    link.click();
    URL.revokeObjectURL(link.href);
  };

  return (
    <div className="mt-3 flex flex-col items-center">
      <button
        type="button"
        onClick={() => setEnlarged(true)}
        className="bg-white p-3 rounded-lg border border-gray-200 shadow-sm hover:shadow-md transition-shadow cursor-zoom-in"
        title="Click to enlarge for scanning"
      >
        <QRCodeCanvas url={url} size={QR_SIZE} />
      </button>
      <div className="mt-2 flex items-center gap-4">
        <button
          onClick={handleCopyImage}
          className="text-xs text-gray-500 hover:text-purple-600 transition-colors"
        >
          {copyFeedback}
        </button>
        <button
          onClick={handleDownload}
          className="text-xs text-gray-500 hover:text-purple-600 transition-colors"
        >
          Download
        </button>
      </div>

      {enlarged && (
        <div
          className="fixed inset-0 bg-black/70 backdrop-blur-sm flex items-center justify-center z-[60] p-4"
          onClick={() => setEnlarged(false)}
        >
          <div
            className="bg-white p-4 rounded-xl shadow-lg cursor-zoom-out"
            onClick={() => setEnlarged(false)}
          >
            <QRCodeCanvas url={url} size={QR_ENLARGED_SIZE} />
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
  inputId: string;
}> = ({ label, url, inputId }) => {
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
      <label htmlFor={inputId} className="block text-sm font-medium text-gray-700 mb-1.5">
        {label}
      </label>
      <div className="relative">
        <input
          id={inputId}
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
    </div>
  );
};

const ShareModal: React.FC<ShareModalProps> = ({
  server,
  artifactId,
  role,
  dataset,
  datasetName,
  selectedLabel,
  onSelectLabel,
  onChanged,
  setShowShareModal,
}) => {
  const labels = dataset.labels ?? [];

  const [pendingAdds, setPendingAdds] = useState<PendingAdd[]>([]);
  const [pendingRemoves, setPendingRemoves] = useState<BrokerUserRef[]>([]);
  const [pendingPublic, setPendingPublic] = useState<boolean | null>(null);
  const [applying, setApplying] = useState(false);
  const [applyError, setApplyError] = useState<string | null>(null);
  const [accessRequests, setAccessRequests] = useState<AccessRequest[]>(dataset.access_requests ?? []);

  // Keep the locally-polled access requests in sync whenever the parent's
  // dataset refetches (e.g. after Apply), without waiting for the next poll
  // tick.
  useEffect(() => {
    setAccessRequests(dataset.access_requests ?? []);
  }, [dataset.access_requests]);

  // Auto-refresh pending access requests while the dialog is open
  // (colab-rework-plan.md §22 item 3), so a new request shows up without
  // closing and reopening the dialog. Scoped to a direct broker call rather
  // than the parent's full onChanged refresh, so it doesn't also trigger the
  // dataset overview's image/label/stats refetches every tick. Owners and
  // managers only: the broker omits access_requests for lower roles.
  useEffect(() => {
    if (role !== 'owner' && role !== 'manager') return;
    const poll = async () => {
      try {
        const d = await getDataset(server, artifactId);
        setAccessRequests(d.access_requests ?? []);
      } catch {
        // transient poll failure, just wait for the next tick
      }
    };
    const id = setInterval(poll, ACCESS_REQUESTS_POLL_MS);
    return () => clearInterval(id);
  }, [server, artifactId, role]);

  const handleStageAdd = (user: BrokerUserRef, addRole: 'manager' | 'annotator') => {
    const key = userKey(user);
    setPendingRemoves((prev) => prev.filter((r) => userKey(r) !== key));
    setPendingAdds((prev) => [...prev.filter((p) => userKey(p.user) !== key), { user, role: addRole }]);
  };

  const handleUndoAdd = (user: BrokerUserRef) => {
    const key = userKey(user);
    setPendingAdds((prev) => prev.filter((p) => userKey(p.user) !== key));
  };

  const handleToggleRemove = (user: BrokerUserRef) => {
    const key = userKey(user);
    setPendingRemoves((prev) =>
      prev.some((r) => userKey(r) === key) ? prev.filter((r) => userKey(r) !== key) : [...prev, user],
    );
  };

  const handleSetPendingPublic = (value: boolean) => {
    setPendingPublic(value === dataset.public ? null : value);
  };

  const hasPendingChanges = pendingAdds.length > 0 || pendingRemoves.length > 0 || pendingPublic !== null;

  const handleApply = async () => {
    if (!hasPendingChanges || applying) return;
    setApplying(true);
    setApplyError(null);
    try {
      await updateSharing(server, artifactId, {
        add: pendingAdds.map(({ user, role: addRole }) => ({ user, role: addRole })),
        remove: pendingRemoves,
        set_public: pendingPublic ?? undefined,
      });
      // Wait for the parent's dataset refetch to land before clearing the
      // pending state: otherwise the checkbox briefly falls back to the
      // stale pre-apply `dataset.public` value for the window between this
      // resolving and the parent's async refresh completing.
      await onChanged();
      setPendingAdds([]);
      setPendingRemoves([]);
      setPendingPublic(null);
      setApplying(false);
    } catch (err) {
      setApplyError((err as Error).message || 'Failed to apply sharing changes.');
    } finally {
      setApplying(false);
    }
  };

  const annotationURL = useMemo(
    () =>
      selectedLabel
        ? `${window.location.origin}${window.location.pathname}#/colab/annotate?${buildAnnotateQuery(artifactId, selectedLabel)}`
        : '',
    [artifactId, selectedLabel],
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
            {labels.length > 0 ? (
              <div>
                <div className="flex items-start gap-3">
                  <div className="shrink-0">
                    <label className="block text-sm font-medium text-gray-700 mb-1.5">Annotation Label</label>
                    <select
                      value={selectedLabel}
                      onChange={(e) => onSelectLabel(e.target.value)}
                      className="px-3 py-2.5 text-sm border border-gray-300 rounded-lg focus:ring-2 focus:ring-purple-500 focus:border-purple-500"
                    >
                      {labels.map((l) => (
                        <option key={l.name} value={l.name}>
                          {l.name}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div className="flex-1 min-w-0">
                    <URLField label="Annotation URL" url={annotationURL} inputId="annotation-url-input" />
                  </div>
                </div>

                <QRCodeSection url={annotationURL} label={selectedLabel} datasetName={datasetName} />

                <p className="mt-2 text-xs text-gray-500 text-center">
                  Share this link with collaborators to annotate together. Annotations are saved to the cloud
                  automatically.
                </p>
              </div>
            ) : (
              <p className="text-xs text-gray-500">Create a label first to get a shareable annotation link.</p>
            )}

            <SharingPanel
              server={server}
              artifactId={artifactId}
              role={role}
              dataset={dataset}
              accessRequests={accessRequests}
              pendingAdds={pendingAdds}
              pendingRemoves={pendingRemoves}
              pendingPublic={pendingPublic}
              applying={applying}
              onStageAdd={handleStageAdd}
              onToggleRemove={handleToggleRemove}
              onUndoAdd={handleUndoAdd}
              onSetPendingPublic={handleSetPendingPublic}
              onAccessRequestDismissed={onChanged}
            />
          </div>
        </div>

        {/* Footer */}
        <div className="p-6 pt-0 border-t border-gray-200/50 flex-shrink-0">
          {applyError && (
            <div className="mb-3 p-2 bg-red-50 border border-red-200 rounded-lg text-xs text-red-600">{applyError}</div>
          )}
          <div className="flex justify-end space-x-3">
            <button
              onClick={() => setShowShareModal(false)}
              className="px-6 py-2.5 bg-gray-100 text-gray-700 rounded-xl hover:bg-gray-200 transition-all duration-200 font-medium"
            >
              Close
            </button>
            <button
              onClick={handleApply}
              disabled={applying || !hasPendingChanges}
              className="px-6 py-2.5 bg-purple-600 text-white rounded-xl hover:bg-purple-700 disabled:bg-gray-300 transition-all duration-200 font-medium flex items-center gap-2"
            >
              {applying && (
                <svg className="w-3.5 h-3.5 animate-spin shrink-0" fill="none" viewBox="0 0 24 24">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                  <path
                    className="opacity-75"
                    fill="currentColor"
                    d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
                  />
                </svg>
              )}
              {applying ? 'Applying, this takes a few seconds' : 'Apply'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

export default ShareModal;
