import React, { useState, useEffect, useRef } from 'react';

interface ShareModalProps {
  annotationURL: string;
  label: string;
  dataArtifactId: string | null;
  setShowShareModal: (show: boolean) => void;
}

const ShareModal: React.FC<ShareModalProps> = ({ annotationURL, label, dataArtifactId, setShowShareModal }) => {
  const [copyFeedback, setCopyFeedback] = useState('Copy URL');
  const [copySessionFeedback, setCopySessionFeedback] = useState('Copy Session URL');
  const qrCodeRef = useRef<HTMLDivElement>(null);

  // Generate session resumption URL - always include full workspace/alias for shareable sessions
  // This ensures the artifact is looked up in the bioimage-io workspace (not user's workspace)
  const sessionURL = dataArtifactId
    ? `${window.location.origin}${window.location.pathname}#/colab/${dataArtifactId}`
    : null;

  useEffect(() => {
    // Generate QR code when modal opens using QR Server API
    if (qrCodeRef.current && annotationURL) {
      // Clear any existing content
      qrCodeRef.current.innerHTML = '';

      // Create QR code using QR Server API (more reliable than loading external library)
      const qrCodeUrl = `https://api.qrserver.com/v1/create-qr-code/?size=256x256&data=${encodeURIComponent(annotationURL)}`;

      const img = document.createElement('img');
      img.src = qrCodeUrl;
      img.alt = 'QR Code for annotation URL';
      img.className = 'w-64 h-64';
      img.onerror = () => {
        // Fallback: show message if QR code generation fails
        qrCodeRef.current!.innerHTML = '<div class="text-gray-500 text-sm text-center p-8">QR code could not be generated</div>';
      };

      qrCodeRef.current.appendChild(img);
    }
  }, [annotationURL]);

  const handleCopyURL = async () => {
    try {
      await navigator.clipboard.writeText(annotationURL);
      setCopyFeedback('Copied!');
      setTimeout(() => setCopyFeedback('Copy URL'), 2000);
    } catch (error) {
      console.error('Failed to copy URL:', error);
      setCopyFeedback('Failed to copy');
      setTimeout(() => setCopyFeedback('Copy URL'), 2000);
    }
  };

  const handleCopySessionURL = async () => {
    if (!sessionURL) return;
    try {
      await navigator.clipboard.writeText(sessionURL);
      setCopySessionFeedback('Copied!');
      setTimeout(() => setCopySessionFeedback('Copy Session URL'), 2000);
    } catch (error) {
      console.error('Failed to copy session URL:', error);
      setCopySessionFeedback('Failed to copy');
      setTimeout(() => setCopySessionFeedback('Copy Session URL'), 2000);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-50 animate-fadeIn">
      <div className="bg-white/95 backdrop-blur-md rounded-2xl shadow-lg max-w-lg w-full mx-4 border border-white/20">
        <div className="p-6 border-b border-gray-200/50">
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

        <div className="p-6 space-y-4">
          {/* Label Info */}
          <div className="text-center mb-2">
            <span className="text-sm text-gray-500">Annotation Label:</span>
            <span className="ml-2 px-3 py-1 bg-green-100 text-green-800 rounded-full text-sm font-medium">
              {label}
            </span>
          </div>

          {/* QR Code */}
          <div className="flex justify-center">
            <div
              ref={qrCodeRef}
              className="bg-white p-4 rounded-lg border-2 border-gray-200 shadow-sm"
            ></div>
          </div>

          {/* Annotation URL */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">Annotation URL</label>
            <div className="relative">
              <input
                type="text"
                value={annotationURL}
                readOnly
                className="w-full px-4 py-3 pr-12 border border-gray-300 rounded-lg bg-gray-50 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-purple-500"
              />
              <button
                onClick={handleCopyURL}
                className="absolute right-2 top-1/2 transform -translate-y-1/2 p-2 text-gray-500 hover:text-purple-600 transition-colors"
                title="Copy URL"
              >
                {copyFeedback === 'Copied!' ? (
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
                )}
              </button>
            </div>
          </div>

          {/* Session Resume URL */}
          {sessionURL && (
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">Session Resume URL (Shareable)</label>
              <div className="relative">
                <input
                  type="text"
                  value={sessionURL}
                  readOnly
                  className="w-full px-4 py-3 pr-12 border border-gray-300 rounded-lg bg-gray-50 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
                <button
                  onClick={handleCopySessionURL}
                  className="absolute right-2 top-1/2 transform -translate-y-1/2 p-2 text-gray-500 hover:text-blue-600 transition-colors"
                  title="Copy Session URL"
                >
                  {copySessionFeedback === 'Copied!' ? (
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
                  )}
                </button>
              </div>
            </div>
          )}

          {/* Instructions */}
          <div className="p-4 bg-blue-50 border border-blue-200 rounded-lg">
            <div className="flex items-start">
              <svg
                className="w-5 h-5 text-blue-600 mr-2 flex-shrink-0 mt-0.5"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
                />
              </svg>
              <div>
                <p className="text-sm font-semibold text-blue-800 mb-1">How to use:</p>
                <ul className="text-sm text-blue-700 space-y-1">
                  <li>• <strong>Annotation URL:</strong> Share with collaborators to annotate together</li>
                  {sessionURL && <li>• <strong>Session Resume URL:</strong> Bookmark or share to resume this session later</li>}
                  <li>• Annotations are saved to the cloud automatically</li>
                  <li>• Keep this browser tab open while collaborators work</li>
                </ul>
              </div>
            </div>
          </div>
        </div>

        <div className="p-6 pt-0 border-t border-gray-200/50 flex justify-end space-x-3">
          <button
            onClick={handleCopyURL}
            className="px-6 py-3 bg-gradient-to-r from-green-600 to-green-700 text-white rounded-xl hover:from-green-700 hover:to-green-800 shadow-sm hover:shadow-md transition-all duration-200 font-medium"
          >
            {copyFeedback}
          </button>
          <a
            href={annotationURL}
            target="_blank"
            rel="noopener noreferrer"
            className="px-6 py-3 bg-gradient-to-r from-purple-600 to-pink-600 text-white rounded-xl hover:from-purple-700 hover:to-pink-700 shadow-sm hover:shadow-md transition-all duration-200 font-medium"
          >
            Open in New Tab
          </a>
        </div>
      </div>
    </div>
  );
};

export default ShareModal;
