import React, { useState, useEffect } from 'react';

type DeleteMode = 'label' | 'artifact';

interface DeleteArtifactModalProps {
  setShowDeleteModal: (show: boolean) => void;
  dataArtifactId: string;
  currentLabel: string;
  artifactManager: any;
  onDeleteSuccess: () => void;
  onLabelDeleteSuccess?: (deletedLabel: string) => void;
}

const DeleteArtifactModal: React.FC<DeleteArtifactModalProps> = ({
  setShowDeleteModal,
  dataArtifactId,
  currentLabel,
  artifactManager,
  onDeleteSuccess,
  onLabelDeleteSuccess,
}) => {
  const [mode, setMode] = useState<DeleteMode>('label');
  const [confirmationText, setConfirmationText] = useState('');
  const [isDeleting, setIsDeleting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fileStats, setFileStats] = useState<{ images: number; masks: Record<string, number> } | null>(null);
  const [isLoadingStats, setIsLoadingStats] = useState(true);

  useEffect(() => {
    const fetchStats = async () => {
      if (!artifactManager || !dataArtifactId) return;
      setIsLoadingStats(true);
      try {
        let images = [];
        try {
          images = await artifactManager.list_files({
            artifact_id: dataArtifactId,
            dir_path: 'train_images',
            _rkwargs: true,
          });
        } catch {
          // folder may not exist
        }

        const artifact = await artifactManager.read({
          artifact_id: dataArtifactId,
          _rkwargs: true,
        });

        const labels: string[] = artifact.manifest?.labels || (currentLabel ? [currentLabel] : []);
        const maskCounts: Record<string, number> = {};

        for (const lbl of labels) {
          try {
            const masks = await artifactManager.list_files({
              artifact_id: dataArtifactId,
              dir_path: `masks_${lbl}`,
              _rkwargs: true,
            });
            maskCounts[lbl] = masks.length;
          } catch {
            maskCounts[lbl] = 0;
          }
        }

        setFileStats({ images: images.length, masks: maskCounts });
      } catch (e) {
        console.error('Failed to fetch artifact stats', e);
        setError('Failed to load artifact details.');
      } finally {
        setIsLoadingStats(false);
      }
    };
    fetchStats();
  }, [artifactManager, dataArtifactId, currentLabel]);

  // Reset confirmation text when mode changes
  useEffect(() => {
    setConfirmationText('');
    setError(null);
  }, [mode]);

  const expectedConfirmation = mode === 'label' ? currentLabel : dataArtifactId;
  const isConfirmed = confirmationText === expectedConfirmation;

  const handleDelete = async () => {
    if (!isConfirmed) return;

    setIsDeleting(true);
    setError(null);

    try {
      if (mode === 'artifact') {
        await artifactManager.delete({
          artifact_id: dataArtifactId,
          delete_files: true,
          _rkwargs: true,
        });
        onDeleteSuccess();
        setShowDeleteModal(false);
      } else {
        // Label-only deletion: remove mask files and update manifest
        let maskFiles: any[] = [];
        try {
          maskFiles = await artifactManager.list_files({
            artifact_id: dataArtifactId,
            dir_path: `masks_${currentLabel}`,
            stage: true,
            _rkwargs: true,
          });
        } catch {
          // folder may not exist — that's fine
        }

        for (const f of maskFiles) {
          const filePath = f.name || f.path || f;
          try {
            await artifactManager.remove_file({
              artifact_id: dataArtifactId,
              file_path: typeof filePath === 'string' ? filePath : `masks_${currentLabel}/${filePath}`,
              _rkwargs: true,
            });
          } catch {
            // best-effort per-file removal
          }
        }

        // Update manifest to remove this label
        const artifact = await artifactManager.read({
          artifact_id: dataArtifactId,
          stage: true,
          _rkwargs: true,
        });
        const updatedLabels = (artifact.manifest?.labels || []).filter((l: string) => l !== currentLabel);
        await artifactManager.edit({
          artifact_id: dataArtifactId,
          manifest: { ...artifact.manifest, labels: updatedLabels },
          stage: true,
          _rkwargs: true,
        });

        onLabelDeleteSuccess?.(currentLabel);
        setShowDeleteModal(false);
      }
    } catch (e: any) {
      console.error('Delete failed:', e);
      setError(`Failed to delete: ${e.message}`);
    } finally {
      setIsDeleting(false);
    }
  };

  const labelMaskCount = fileStats?.masks[currentLabel] ?? 0;

  return (
    <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-50 animate-fadeIn">
      <div className="bg-white/95 backdrop-blur-md rounded-2xl shadow-lg max-w-md w-full mx-4 border border-white/20">

        {/* Header */}
        <div className="p-6 border-b border-gray-200/50">
          <div className="flex items-center">
            <div className="w-10 h-10 bg-red-100 rounded-xl flex items-center justify-center mr-3">
              <svg className="w-6 h-6 text-red-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
              </svg>
            </div>
            <h3 className="text-lg font-semibold text-gray-800">
              {mode === 'label' ? `Delete Label "${currentLabel}"` : 'Delete Artifact'}
            </h3>
          </div>
        </div>

        <div className="p-6 space-y-4">

          {/* Mode toggle */}
          <div className="flex rounded-xl overflow-hidden border border-gray-200 text-sm font-medium">
            <button
              type="button"
              onClick={() => setMode('label')}
              className={`flex-1 py-2.5 transition-colors ${
                mode === 'label'
                  ? 'bg-red-600 text-white'
                  : 'bg-white text-gray-600 hover:bg-gray-50'
              }`}
            >
              Delete Label Only
            </button>
            <button
              type="button"
              onClick={() => setMode('artifact')}
              className={`flex-1 py-2.5 border-l border-gray-200 transition-colors ${
                mode === 'artifact'
                  ? 'bg-red-600 text-white'
                  : 'bg-white text-gray-600 hover:bg-gray-50'
              }`}
            >
              Delete Entire Artifact
            </button>
          </div>

          {/* Warning */}
          <div className="p-4 bg-red-50 border border-red-200 rounded-lg">
            <p className="text-sm text-red-800 font-medium">Warning: This action cannot be undone.</p>
            <p className="text-sm text-red-700 mt-1">
              {mode === 'label'
                ? `All ${labelMaskCount} mask${labelMaskCount !== 1 ? 's' : ''} for label "${currentLabel}" will be permanently deleted. Images and other labels are kept.`
                : 'All uploaded images and annotations in this artifact will be permanently deleted.'}
            </p>
          </div>

          {/* Stats */}
          {isLoadingStats ? (
            <div className="flex justify-center py-2">
              <div className="w-6 h-6 border-2 border-gray-300 border-t-purple-600 rounded-full animate-spin" />
            </div>
          ) : fileStats ? (
            <div className="text-sm text-gray-600 space-y-1">
              <p><strong>Content to be deleted:</strong></p>
              <ul className="list-disc list-inside pl-2">
                {mode === 'artifact' && <li>{fileStats.images} remote image{fileStats.images !== 1 ? 's' : ''}</li>}
                {mode === 'label'
                  ? <li>{labelMaskCount} mask{labelMaskCount !== 1 ? 's' : ''} for label "{currentLabel}"</li>
                  : Object.entries(fileStats.masks).map(([lbl, count]) => (
                    <li key={lbl}>{count} mask{count !== 1 ? 's' : ''} for label "{lbl}"</li>
                  ))
                }
              </ul>
            </div>
          ) : null}

          {/* Confirmation input */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">
              {mode === 'label' ? 'Type the label name to confirm' : 'Type the Artifact ID to confirm'}
            </label>
            <div className="mb-2 p-2 bg-gray-100 rounded text-xs font-mono select-all break-all">
              {expectedConfirmation}
            </div>
            <input
              type="text"
              className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-red-500 focus:border-red-500"
              value={confirmationText}
              onChange={(e) => setConfirmationText(e.target.value)}
              placeholder={expectedConfirmation}
              disabled={isDeleting}
            />
          </div>

          {error && (
            <div className="p-3 bg-red-50 border border-red-200 rounded-lg">
              <p className="text-red-600 text-sm">{error}</p>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="p-6 pt-0 border-t border-gray-200/50 flex justify-end space-x-3">
          <button
            type="button"
            onClick={() => setShowDeleteModal(false)}
            disabled={isDeleting}
            className="px-6 py-3 text-gray-600 bg-white border-2 border-gray-200 rounded-xl hover:bg-gray-50 hover:border-gray-300 disabled:opacity-50 shadow-sm hover:shadow-md transition-all duration-200"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={handleDelete}
            disabled={!isConfirmed || isDeleting}
            className="px-6 py-3 bg-red-600 text-white rounded-xl hover:bg-red-700 disabled:bg-gray-400 disabled:cursor-not-allowed flex items-center shadow-sm hover:shadow-md transition-all duration-200"
          >
            {isDeleting ? 'Deleting…' : mode === 'label' ? `Delete Label "${currentLabel}"` : 'Delete Permanently'}
          </button>
        </div>
      </div>
    </div>
  );
};

export default DeleteArtifactModal;
