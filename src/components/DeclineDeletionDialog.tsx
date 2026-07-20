import React, { useEffect, useRef, useState } from 'react';
import { declineDeletion } from '../utils/deletionRequest';
import { RoleUser } from '../utils/roles';

interface DeclineDeletionDialogProps {
  artifact: any;
  artifactManager: any;
  user: RoleUser;
  onClose: () => void;
  onDeclined?: () => void;
}

/**
 * Modal for declining a pending deletion request. A non-empty reason is REQUIRED
 * — it is appended to the comment thread so the requester sees why the request
 * was denied. On submit it drops the staged `manifest.request_deletion` flag.
 */
const DeclineDeletionDialog: React.FC<DeclineDeletionDialogProps> = ({
  artifact,
  artifactManager,
  user,
  onClose,
  onDeclined,
}) => {
  const [reason, setReason] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    textareaRef.current?.focus();
  }, []);

  const trimmed = reason.trim();
  const canSubmit = trimmed.length > 0 && !submitting;

  const handleSubmit = async () => {
    if (!canSubmit) return;
    setSubmitting(true);
    setError(null);
    try {
      await declineDeletion(artifactManager, artifact, trimmed, user);
      onDeclined?.();
      onClose();
    } catch (e: any) {
      console.error('Decline deletion failed:', e);
      setError(e?.message || 'Failed to decline deletion request.');
    } finally {
      setSubmitting(false);
    }
  };

  const modelName = artifact?.manifest?.name || artifact?.id?.split('/').pop() || 'this model';

  return (
    <div
      className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-50 animate-fadeIn"
      onClick={onClose}
    >
      <div
        className="bg-white rounded-2xl shadow-lg max-w-md w-full mx-4 border border-gray-200 animate-scaleIn"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="p-6 border-b border-gray-200/70">
          <div className="flex items-center">
            <div className="w-10 h-10 bg-blue-100 rounded-xl flex items-center justify-center mr-3">
              <svg className="w-6 h-6 text-blue-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 10h10a8 8 0 018 8v2M3 10l6 6m-6-6l6-6" />
              </svg>
            </div>
            <h3 className="text-lg font-semibold text-gray-800">Decline deletion request</h3>
          </div>
        </div>

        <div className="p-6 space-y-4">
          <p className="text-sm text-gray-600">
            This declines the deletion request for <span className="font-medium text-gray-800">{modelName}</span> and
            keeps the model. The reason is added to the comment thread so the requester sees why.
          </p>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">
              Reason for declining <span className="text-red-500">*</span>
            </label>
            <textarea
              ref={textareaRef}
              className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500 min-h-[96px] resize-y"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="Explain why this deletion request is being declined (e.g. model is still in use, request lacks justification)…"
              disabled={submitting}
            />
            <p className="mt-1 text-xs text-gray-500">A reason is required — it is shared with the requester.</p>
          </div>

          {error && (
            <div className="p-3 bg-red-50 border border-red-200 rounded-lg">
              <p className="text-red-600 text-sm">{error}</p>
            </div>
          )}
        </div>

        <div className="p-6 pt-0 flex justify-end space-x-3">
          <button
            type="button"
            onClick={onClose}
            disabled={submitting}
            className="px-5 py-2.5 text-gray-600 bg-white border border-gray-200 rounded-xl hover:bg-gray-50 disabled:opacity-50 transition-colors duration-150"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={handleSubmit}
            disabled={!canSubmit}
            className="px-5 py-2.5 bg-blue-600 text-white rounded-xl hover:bg-blue-700 disabled:bg-gray-300 disabled:cursor-not-allowed transition-colors duration-150"
          >
            {submitting ? 'Declining…' : 'Decline deletion request'}
          </button>
        </div>
      </div>
    </div>
  );
};

export default DeclineDeletionDialog;
