import React, { useEffect, useState } from 'react';
import {
  DatasetLabelRef,
  discoverLabels,
  getAnnotatedStems,
  pLimit,
} from './datasetApi';

// F4a (colab-rework-plan.md): shared by the landing page (F2, annotator/public
// "Open" on a shared dataset) and the dataset overview's provisional
// owner/manager annotation entry (F4). Reads labels directly through
// datasetApi + withStageRetry against the artifact-manager, not the broker:
// once a dataset appears in "shared with you" the broker has already granted
// read access, so a direct read always succeeds and sidesteps broker
// round-trips for something this simple.
export interface LabelSelectDialogProps {
  artifactManager: any;
  artifactId: string;
  role?: 'owner' | 'manager' | 'annotator' | 'public' | 'none';
  onClose: () => void;
  onSelect: (label: string) => void;
  canCreateLabel?: boolean;
  onCreateLabel?: () => void;
}

const LabelSelectDialog: React.FC<LabelSelectDialogProps> = ({
  artifactManager,
  artifactId,
  role,
  onClose,
  onSelect,
  canCreateLabel = false,
  onCreateLabel,
}) => {
  const [labels, setLabels] = useState<DatasetLabelRef[] | null>(null);
  const [counts, setCounts] = useState<Record<string, number>>({});
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;

    (async () => {
      try {
        const found = await discoverLabels(artifactManager, artifactId);
        if (!active) return;
        setLabels(found);

        const limit = pLimit(4);
        await Promise.all(
          found.map((label) =>
            limit(async () => {
              try {
                const stems = await getAnnotatedStems(artifactManager, artifactId, label.name);
                if (active) {
                  setCounts((prev) => ({ ...prev, [label.name]: stems.size }));
                }
              } catch {
                // best-effort count, leave the label without one
              }
            }),
          ),
        );
      } catch (err) {
        if (active) setError((err as Error).message || 'Failed to load labels.');
      }
    })();

    return () => {
      active = false;
    };
  }, [artifactManager, artifactId]);

  return (
    <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-50" onClick={onClose}>
      <div
        className="bg-white rounded-2xl shadow-lg max-w-sm w-full mx-4 max-h-[80vh] flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="p-5 border-b border-gray-200 flex items-center justify-between">
          <h2 className="text-base font-semibold text-gray-900">Choose a label</h2>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 transition-colors">
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        <div className="p-5 overflow-y-auto space-y-2">
          {error && (
            <div className="p-3 bg-red-50 border border-red-200 rounded-lg text-sm text-red-600">{error}</div>
          )}

          {!error && labels === null && (
            <div className="flex items-center justify-center py-6">
              <svg className="w-6 h-6 animate-spin text-purple-600" fill="none" viewBox="0 0 24 24">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
              </svg>
            </div>
          )}

          {labels !== null && labels.length === 0 && (
            <div className="text-center py-6">
              <p className="text-sm text-gray-500 mb-3">No labels have been created for this dataset yet.</p>
              {canCreateLabel && onCreateLabel ? (
                <button
                  onClick={onCreateLabel}
                  className="px-4 py-2 bg-purple-600 text-white rounded-lg hover:bg-purple-700 text-sm font-medium transition-colors"
                >
                  Create label
                </button>
              ) : (
                <p className="text-xs text-gray-400">
                  {role === 'owner' || role === 'manager'
                    ? 'Open the dataset overview to create one.'
                    : 'Ask the dataset owner to create one.'}
                </p>
              )}
            </div>
          )}

          {labels !== null &&
            labels.map((label) => (
              <button
                key={label.name}
                onClick={() => onSelect(label.name)}
                className="w-full text-left px-4 py-3 rounded-xl border border-gray-200 hover:border-purple-400 hover:bg-purple-50 transition-colors flex items-center justify-between gap-3"
              >
                <div className="min-w-0">
                  <div className="font-medium text-gray-900 truncate">{label.name}</div>
                  {label.description && (
                    <div className="text-xs text-gray-500 truncate">{label.description}</div>
                  )}
                </div>
                <span className="text-xs text-gray-400 shrink-0">
                  {counts[label.name] !== undefined ? `${counts[label.name]} annotated` : ''}
                </span>
              </button>
            ))}
        </div>
      </div>
    </div>
  );
};

export default LabelSelectDialog;
