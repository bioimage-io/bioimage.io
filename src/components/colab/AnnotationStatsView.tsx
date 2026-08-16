import React, { useEffect, useRef } from 'react';
import { DatasetImage } from './datasetApi';

export interface AnnotationStatsViewProps {
  images: DatasetImage[];
  stats: Record<string, number>;
  label: string;
  highlightStem?: string | null;
  onSelectStem?: (stem: string) => void;
  loading?: boolean;
}

// Per-image annotation-FILE breakdown for the selected label (count of saved
// png+geojson pairs per image, across all users and timestamps, not mask
// instances inside them): every image gets a row (including zero-count
// ones), unlike LabelStatsChart's capped-at-8 sorted summary. Axis max is
// the highest per-image count, so the busiest image's bar reaches the far
// edge.
const AnnotationStatsView: React.FC<AnnotationStatsViewProps> = ({
  images,
  stats,
  label,
  highlightStem,
  onSelectStem,
  loading,
}) => {
  const rows = images
    .map((img) => ({ stem: img.stem, count: stats[img.stem] ?? 0 }))
    .sort((a, b) => b.count - a.count || a.stem.localeCompare(b.stem));
  const highestCount = rows.reduce((m, r) => Math.max(m, r.count), 0);
  const axisMax = highestCount || 1;

  const rowRefs = useRef<Record<string, HTMLDivElement | null>>({});

  useEffect(() => {
    if (highlightStem) {
      rowRefs.current[highlightStem]?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    }
  }, [highlightStem]);

  if (loading) {
    return (
      <div className="w-full h-full flex items-center justify-center">
        <svg className="w-6 h-6 animate-spin text-purple-600" fill="none" viewBox="0 0 24 24">
          <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
          <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
        </svg>
      </div>
    );
  }

  if (rows.length === 0) {
    return <p className="text-sm text-gray-400 text-center py-8">No images to show stats for.</p>;
  }

  return (
    <div className="w-full h-full overflow-y-auto px-1 py-2">
      <p className="text-xs font-medium text-gray-500 uppercase tracking-wide mb-2">
        Annotation files per image &middot; {label}
      </p>
      <div className="space-y-1.5">
        {rows.map(({ stem, count }) => (
          <div
            key={stem}
            ref={(el) => { rowRefs.current[stem] = el; }}
            onClick={() => onSelectStem?.(stem)}
            className={`flex items-center gap-2 rounded ${onSelectStem ? 'cursor-pointer hover:bg-gray-50' : ''} ${
              stem === highlightStem ? 'bg-purple-50 ring-1 ring-purple-300' : ''
            }`}
          >
            <span className="text-xs text-gray-500 w-28 truncate shrink-0" title={stem}>
              {stem}
            </span>
            <div className="flex-1 bg-gray-100 rounded-full h-1.5">
              <div
                className="bg-blue-400 h-1.5 rounded-full"
                style={{ width: `${(count / axisMax) * 100}%` }}
              />
            </div>
            <span className="text-xs text-gray-400 w-6 text-right shrink-0">{count}</span>
          </div>
        ))}
      </div>
    </div>
  );
};

export default AnnotationStatsView;
