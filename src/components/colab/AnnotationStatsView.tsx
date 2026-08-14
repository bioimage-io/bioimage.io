import React from 'react';
import { DatasetImage } from './datasetApi';

export interface AnnotationStatsViewProps {
  images: DatasetImage[];
  stats: Record<string, number>;
  label: string;
}

// Per-image annotation-instance breakdown for the selected label: every
// image gets a row (including zero-count ones), unlike LabelStatsChart's
// capped-at-8 sorted summary. Axis max is the highest per-image count + 1,
// so even the busiest image's bar stops short of the far edge.
const AnnotationStatsView: React.FC<AnnotationStatsViewProps> = ({ images, stats, label }) => {
  const rows = images
    .map((img) => ({ stem: img.stem, count: stats[img.stem] ?? 0 }))
    .sort((a, b) => b.count - a.count || a.stem.localeCompare(b.stem));
  const axisMax = rows.reduce((m, r) => Math.max(m, r.count), 0) + 1;

  if (rows.length === 0) {
    return <p className="text-sm text-gray-400 text-center py-8">No images to show stats for.</p>;
  }

  return (
    <div className="w-full h-full overflow-y-auto px-1 py-2">
      <p className="text-xs font-medium text-gray-500 uppercase tracking-wide mb-2">
        Instances per image &middot; {label}
      </p>
      <div className="space-y-1.5">
        {rows.map(({ stem, count }) => (
          <div key={stem} className="flex items-center gap-2">
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
