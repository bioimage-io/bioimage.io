import React, { useEffect, useRef, useState } from 'react';
import { requestDeletion } from '../utils/deletionRequest';
import { RoleUser } from '../utils/roles';

interface RequestDeletionDialogProps {
  artifact: any;
  artifactManager: any;
  user: RoleUser;
  onClose: () => void;
  onRequested?: () => void;
}

/**
 * Modal for marking a model for deletion. A non-empty reason is REQUIRED — the
 * request is invalid without one. On submit it stages `manifest.request_deletion`
 * and appends the reason to the comment thread; a site-admin finalizes the
 * actual delete later on the Deletion Request page.
 */
const RequestDeletionDialog: React.FC<RequestDeletionDialogProps> = ({
  artifact,
  artifactManager,
  user,
  onClose,
  onRequested,
}) => {
  const [reason, setReason] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    // Focus the reason field so the required input is immediately actionable.
    textareaRef.current?.focus();
  }, []);

  const trimmed = reason.trim();
  const canSubmit = trimmed.length > 0 && !submitting;

  const handleSubmit = async () => {
    if (!canSubmit) return;
    setSubmitting(true);
    setError(null);
    try {
      await requestDeletion(artifactManager, artifact, trimmed, user);
      onRequested?.();
      onClose();
    } catch (e: any) {
      console.error('Deletion request failed:', e);
      setError(e?.message || 'Failed to request deletion.');
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
            <div className="w-10 h-10 bg-amber-100 rounded-xl flex items-center justify-center mr-3">
              <svg className="w-6 h-6 text-amber-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
              </svg>
            </div>
            <h3 className="text-lg font-semibold text-gray-800">Request deletion</h3>
          </div>
        </div>

        <div className="p-6 space-y-4">
          <p className="text-sm text-gray-600">
            This marks <span className="font-medium text-gray-800">{modelName}</span> for deletion and
            notifies collection admins, who finalize the removal. The model is not deleted now.
          </p>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">
              Reason for deletion <span className="text-red-500">*</span>
            </label>
            <textarea
              ref={textareaRef}
              className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-amber-500 focus:border-amber-500 min-h-[96px] resize-y"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="Explain why this model should be deleted (e.g. duplicate upload, broken weights, superseded by a newer version)…"
              disabled={submitting}
            />
            <p className="mt-1 text-xs text-gray-500">A reason is required — the request is invalid without one.</p>
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
            className="px-5 py-2.5 bg-amber-600 text-white rounded-xl hover:bg-amber-700 disabled:bg-gray-300 disabled:cursor-not-allowed transition-colors duration-150"
          >
            {submitting ? 'Requesting…' : 'Request deletion'}
          </button>
        </div>
      </div>
    </div>
  );
};

export default RequestDeletionDialog;
