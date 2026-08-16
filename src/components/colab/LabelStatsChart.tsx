import React from 'react';

export interface LabelStatsChartProps {
  totalImages: number;
  annotatedCount: number;
  stats: Record<string, number>;
}

// Dependency-free Tailwind bars (colab-rework-plan.md F4, prior plan Commit
// 7): overall annotated/total progress plus a per-image count breakdown for
// the selected label. Not currently rendered anywhere.
const LabelStatsChart: React.FC<LabelStatsChartProps> = ({ totalImages, annotatedCount, stats }) => {
  const entries = Object.entries(stats)
    .sort(([, a], [, b]) => b - a)
    .slice(0, 8);
  const max = entries.reduce((m, [, count]) => Math.max(m, count), 0) || 1;
  const progress = totalImages > 0 ? Math.round((annotatedCount / totalImages) * 100) : 0;

  return (
    <div className="bg-white rounded-2xl border border-gray-200 p-4">
      <h3 className="text-sm font-semibold text-gray-900 mb-3">Progress</h3>

      <div className="mb-4">
        <div className="flex items-center justify-between text-xs text-gray-500 mb-1">
          <span>
            {annotatedCount} of {totalImages} images annotated
          </span>
          <span>{progress}%</span>
        </div>
        <div className="w-full bg-gray-100 rounded-full h-2">
          <div
            className="bg-gradient-to-r from-purple-500 to-pink-500 h-2 rounded-full transition-all duration-300"
            style={{ width: `${progress}%` }}
          />
        </div>
      </div>

      {entries.length > 0 && (
        <div className="space-y-1.5">
          <p className="text-xs font-medium text-gray-500 uppercase tracking-wide mb-1">Instances per image</p>
          {entries.map(([stem, count]) => (
            <div key={stem} className="flex items-center gap-2">
              <span className="text-xs text-gray-500 w-20 truncate shrink-0" title={stem}>
                {stem}
              </span>
              <div className="flex-1 bg-gray-100 rounded-full h-1.5">
                <div
                  className="bg-blue-400 h-1.5 rounded-full"
                  style={{ width: `${Math.max(4, Math.round((count / max) * 100))}%` }}
                />
              </div>
              <span className="text-xs text-gray-400 w-6 text-right shrink-0">{count}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};

export default LabelStatsChart;
