import React, { useState } from 'react';
import Tooltip from '@mui/material/Tooltip';
import InfoOutlinedIcon from '@mui/icons-material/InfoOutlined';
import { DatasetLabelRef, LabelTotals } from './datasetApi';
import { createLabel } from './brokerApi';
import { LABEL_PALETTE } from './ImagePreview';

export interface LabelManagerProps {
  server: any;
  artifactId: string;
  role: 'owner' | 'manager';
  /** Already sorted by the parent (percentage annotated desc, then total desc). */
  labels: DatasetLabelRef[];
  labelTotals: Record<string, LabelTotals>;
  totalImages: number;
  selectedLabel: string;
  onSelectLabel: (label: string) => void;
  onLabelsChanged: () => void;
  onAnnotateLabel: (label: string) => void;
  onDeleteLabel: (label: string) => void;
}

const rgb = ([r, g, b]: [number, number, number]) => `rgb(${r}, ${g}, ${b})`;

// F4 (colab-rework-plan.md): list/create labels via `broker.create_label`,
// with per-label annotated counts. Each row's inline "Annotate" action jumps
// straight into annotation for that label, skipping LabelSelectDialog (F4a)
// since the label is already explicit here.
const LabelManager: React.FC<LabelManagerProps> = ({
  server,
  artifactId,
  labels,
  labelTotals,
  totalImages,
  selectedLabel,
  onSelectLabel,
  onLabelsChanged,
  onAnnotateLabel,
  onDeleteLabel,
}) => {
  const [showForm, setShowForm] = useState(false);
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleCreate = async () => {
    if (!name.trim()) return;
    setBusy(true);
    setError(null);
    try {
      await createLabel(server, artifactId, name.trim(), description.trim());
      setName('');
      setDescription('');
      setShowForm(false);
      onLabelsChanged();
    } catch (err) {
      setError((err as Error).message || 'Failed to create label.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="bg-white rounded-2xl border border-gray-200 p-4 h-full flex flex-col">
      <div className="flex items-center justify-between mb-3 shrink-0">
        <h3 className="text-sm font-semibold text-gray-900">Labels</h3>
        <button
          onClick={() => setShowForm((s) => !s)}
          className="text-xs font-medium text-purple-600 hover:text-purple-700 transition-colors"
        >
          {showForm ? 'Cancel' : '+ New label'}
        </button>
      </div>

      {showForm && (
        <div className="mb-3 p-3 bg-gray-50 rounded-xl space-y-2 shrink-0">
          <input
            type="text"
            placeholder="Label name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            className="w-full px-3 py-1.5 text-sm border border-gray-300 rounded-lg focus:ring-2 focus:ring-purple-500 focus:border-purple-500"
            autoFocus
          />
          <input
            type="text"
            placeholder="Description (optional)"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            className="w-full px-3 py-1.5 text-sm border border-gray-300 rounded-lg focus:ring-2 focus:ring-purple-500 focus:border-purple-500"
          />
          {error && <p className="text-xs text-red-600">{error}</p>}
          <button
            onClick={handleCreate}
            disabled={busy || !name.trim()}
            className="w-full px-3 py-1.5 bg-purple-600 text-white rounded-lg hover:bg-purple-700 disabled:bg-gray-300 text-sm font-medium transition-colors"
          >
            {busy ? 'Creating...' : 'Create'}
          </button>
        </div>
      )}

      {labels.length === 0 ? (
        <p className="text-sm text-gray-400">No labels yet. Create one to start annotating.</p>
      ) : (
        <div className="space-y-1.5 flex-1 min-h-0 overflow-y-auto -mx-1 px-1">
          {labels.map((label, i) => {
            const totals = labelTotals[label.name];
            const pct = totals && totalImages > 0 ? Math.round((totals.annotatedStems.size / totalImages) * 100) : null;
            return (
              <div
                key={label.name}
                onClick={() => onSelectLabel(label.name)}
                className={`flex items-center justify-between gap-2 px-3 py-2 rounded-lg cursor-pointer transition-colors ${
                  selectedLabel === label.name
                    ? 'bg-purple-50 border border-purple-300'
                    : 'border border-transparent hover:bg-gray-50'
                }`}
              >
                <div className="flex items-center gap-2 min-w-0">
                  <span
                    className="w-2.5 h-2.5 rounded-full shrink-0"
                    style={{ backgroundColor: rgb(LABEL_PALETTE[i % LABEL_PALETTE.length]) }}
                  />
                  <span className="text-sm font-medium text-gray-800 truncate">{label.name}</span>
                  <Tooltip
                    title={label.description?.trim() || 'No description provided'}
                    placement="top"
                    arrow
                  >
                    <InfoOutlinedIcon
                      sx={{ fontSize: '0.9rem', color: 'text.disabled', cursor: 'help', flexShrink: 0 }}
                      onClick={(e) => e.stopPropagation()}
                    />
                  </Tooltip>
                  {totals && (
                    <span className="text-xs text-gray-400 shrink-0">
                      {totals.totalAnnotations} · {pct}%
                    </span>
                  )}
                </div>
                {selectedLabel === label.name && (
                  <div className="flex items-center gap-2 shrink-0">
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        onAnnotateLabel(label.name);
                      }}
                      title={`Annotate ${label.name}`}
                      className="text-xs font-medium text-purple-600 hover:text-purple-700"
                    >
                      Annotate
                    </button>
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        onDeleteLabel(label.name);
                      }}
                      title={`Delete label "${label.name}"`}
                      className="text-gray-300 hover:text-red-500 transition-colors"
                    >
                      <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                      </svg>
                    </button>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
};

export default LabelManager;
