import React, { useState } from 'react';

interface ShareModalProps {
  annotationURL: string;
  label: string;
  dataArtifactId: string | null;
  setShowShareModal: (show: boolean) => void;
  cellposeModel?: string;
  onCellposeModelChange?: (model: string) => void;
  availableModels?: { id: string; name: string }[];
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

const ShareModal: React.FC<ShareModalProps> = ({
  annotationURL,
  label,
  dataArtifactId,
  setShowShareModal,
  cellposeModel = 'Base',
  onCellposeModelChange,
  availableModels,
}) => {
  const [showInstructions, setShowInstructions] = useState(false);

  const sessionURL = dataArtifactId
    ? `${window.location.origin}${window.location.pathname}#/colab/${dataArtifactId}`
    : null;

  // Default models: Base + any available finetuned models
  const models = availableModels && availableModels.length > 0
    ? availableModels
    : [{ id: 'Base', name: 'Base (Cellpose-SAM)' }];

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
              <h3 className="text-lg font-semibold text-gray-800">Share Annotation Session</h3>
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
            {/* Annotation Label */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1.5">Annotation Label</label>
              <span className="px-3 py-1.5 bg-green-100 text-green-800 rounded-full text-sm font-medium">
                {label}
              </span>
            </div>

            {/* Cellpose Model Selection */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1.5">Cellpose Model for Pre-segmentation</label>
              <select
                value={cellposeModel}
                onChange={(e) => onCellposeModelChange?.(e.target.value)}
                className="w-full px-4 py-2.5 border border-gray-300 rounded-lg bg-white text-sm focus:outline-none focus:ring-2 focus:ring-purple-500"
              >
                {models.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.name}
                  </option>
                ))}
              </select>
              <p className="text-xs text-gray-500 mt-1">
                The model used for AI-assisted segmentation in the annotation interface.
              </p>
            </div>

            {/* Annotation URL */}
            <URLField
              label="Annotation URL"
              url={annotationURL}
              qrLabel="Annotation URL"
            />

            {/* Session Resume URL */}
            {sessionURL && (
              <URLField
                label="Session Resume URL"
                url={sessionURL}
                qrLabel="Session URL"
              />
            )}

            {/* Instructions - Collapsible */}
            <div className="border border-blue-200 rounded-lg overflow-hidden">
              <button
                onClick={() => setShowInstructions(!showInstructions)}
                className="w-full p-3 bg-blue-50 hover:bg-blue-100 transition-colors flex items-center justify-between"
              >
                <div className="flex items-center">
                  <svg className="w-4 h-4 text-blue-600 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                  </svg>
                  <p className="text-sm font-semibold text-blue-800">How to use</p>
                </div>
                <svg
                  className={`w-4 h-4 text-blue-600 transition-transform ${showInstructions ? 'rotate-180' : ''}`}
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                </svg>
              </button>
              {showInstructions && (
                <div className="p-4 bg-blue-50 border-t border-blue-200">
                  <ul className="text-sm text-blue-700 space-y-1">
                    <li>• <strong>Annotation URL:</strong> Share with collaborators to annotate together in real-time</li>
                    {sessionURL && <li>• <strong>Session Resume URL:</strong> Use to resume this session later</li>}
                    <li>• Annotations are saved to the cloud automatically</li>
                    <li>• <strong>Important:</strong> Keep this browser tab open while collaborators use the Annotation URL</li>
                  </ul>
                </div>
              )}
            </div>
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
          <a
            href={annotationURL}
            target="_blank"
            rel="noopener noreferrer"
            className="px-6 py-2.5 bg-gradient-to-r from-purple-600 to-pink-600 text-white rounded-xl hover:from-purple-700 hover:to-pink-700 shadow-sm hover:shadow-md transition-all duration-200 font-medium"
          >
            Open in New Tab
          </a>
        </div>
      </div>
    </div>
  );
};

export default ShareModal;
