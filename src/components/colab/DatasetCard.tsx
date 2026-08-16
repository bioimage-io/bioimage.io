import React from 'react';
import { LABEL_PALETTE } from './ImagePreview';
import { BrokerRole } from './brokerApi';
import { formatDatasetDescription } from './datasetApi';

export interface DatasetCardLabel {
  name: string;
  description?: string;
}

export interface DatasetCardProps {
  name: string;
  description?: string;
  role?: BrokerRole;
  labels: DatasetCardLabel[];
  labelsLoading?: boolean;
  labelCounts?: Record<string, number>;
  onOpen: () => void;
}

const ROLE_STYLES: Record<string, string> = {
  owner: 'bg-purple-100 text-purple-700',
  manager: 'bg-blue-100 text-blue-700',
  annotator: 'bg-green-100 text-green-700',
  public: 'bg-gray-100 text-gray-600',
};

const rgb = ([r, g, b]: [number, number, number]) => `rgb(${r}, ${g}, ${b})`;

// F2 landing card (colab-rework-plan.md): every role gets exactly one "Open"
// button here, regardless of what happens after the click (owner/manager go
// straight to the dataset, annotators are routed through LabelSelectDialog by
// the caller) — the corrected design explicitly rules out a second,
// role-conditional entry point on the card itself.
const DatasetCard: React.FC<DatasetCardProps> = ({
  name,
  description,
  role,
  labels,
  labelsLoading,
  labelCounts,
  onOpen,
}) => {
  return (
    <div className="bg-white rounded-2xl border border-gray-200 hover:border-purple-300 hover:shadow-md transition-all p-5 flex flex-col gap-3">
      <div className="flex items-start justify-between gap-2">
        <h3 className="font-semibold text-gray-900 truncate" title={name}>
          {name}
        </h3>
        {role && role !== 'none' && (
          <span className={`shrink-0 text-xs font-medium px-2 py-0.5 rounded-full ${ROLE_STYLES[role] || ROLE_STYLES.public}`}>
            {role}
          </span>
        )}
      </div>

      <p className="text-sm text-gray-500 line-clamp-2">{formatDatasetDescription(description)}</p>

      <div className="flex flex-wrap gap-1.5 min-h-[1.5rem]">
        {labelsLoading ? (
          <>
            <span className="h-5 w-16 rounded-full bg-gray-100 animate-pulse" />
            <span className="h-5 w-20 rounded-full bg-gray-100 animate-pulse" />
          </>
        ) : labels.length === 0 ? (
          <span className="text-xs text-gray-400">No labels yet</span>
        ) : (
          labels.map((label, i) => (
            <span
              key={label.name}
              className="text-xs font-medium px-2 py-0.5 rounded-full text-white"
              style={{ backgroundColor: rgb(LABEL_PALETTE[i % LABEL_PALETTE.length]) }}
            >
              {label.name}
              {labelCounts && labelCounts[label.name] !== undefined ? ` · ${labelCounts[label.name]}` : ''}
            </span>
          ))
        )}
      </div>

      <button
        onClick={onOpen}
        className="mt-1 w-full px-4 py-2 bg-purple-50 text-purple-700 rounded-lg hover:bg-purple-100 font-medium text-sm transition-colors"
      >
        Open
      </button>
    </div>
  );
};

export default DatasetCard;
