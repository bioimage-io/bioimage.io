import React, { useEffect, useState } from 'react';

export interface FinetuneViewRow {
  stem: string;
  annotationCount: number;
}

export interface FinetuneViewProps {
  label: string;
  rows: FinetuneViewRow[];
}

type Assignment = 'train' | 'test' | 'unused';

const DEFAULT_TRAIN_PERCENT = 80;

// colab-rework-plan.md §23.2: shown in place of the Labels box once a
// finetune view is open. Broker v0.7.0's create_split/update_split RPCs
// aren't wired yet (blocked on a separate deployment ping from keen-puma),
// so this stage is entirely local React state and "Create split" stays
// disabled until that lands.
const FinetuneView: React.FC<FinetuneViewProps> = ({ label, rows }) => {
  const [splitName, setSplitName] = useState('default');
  const [trainPercent, setTrainPercent] = useState(DEFAULT_TRAIN_PERCENT);
  const [assignment, setAssignment] = useState<Record<string, Assignment>>({});

  // Keep assignment in sync with the current row set: preserve existing
  // choices, default any newly-annotated stem to unused.
  useEffect(() => {
    setAssignment((prev) => {
      const next: Record<string, Assignment> = {};
      for (const row of rows) {
        next[row.stem] = prev[row.stem] ?? 'unused';
      }
      return next;
    });
  }, [rows]);

  const setStemAssignment = (stem: string, value: Assignment) => {
    setAssignment((prev) => ({ ...prev, [stem]: value }));
  };

  const autoDistribute = () => {
    const shuffled = [...rows].sort(() => Math.random() - 0.5);
    const trainCount = Math.round((shuffled.length * trainPercent) / 100);
    const next: Record<string, Assignment> = {};
    shuffled.forEach((row, i) => {
      next[row.stem] = i < trainCount ? 'train' : 'test';
    });
    setAssignment(next);
  };

  const trainCount = rows.filter((r) => assignment[r.stem] === 'train').length;
  const testCount = rows.filter((r) => assignment[r.stem] === 'test').length;
  const unusedCount = rows.length - trainCount - testCount;

  const cycleAssignment = (current: Assignment): Assignment =>
    current === 'unused' ? 'train' : current === 'train' ? 'test' : 'unused';

  const badgeClass = (value: Assignment) =>
    value === 'train'
      ? 'bg-blue-100 text-blue-700'
      : value === 'test'
      ? 'bg-amber-100 text-amber-700'
      : 'bg-gray-100 text-gray-500';

  return (
    <div className="bg-white rounded-2xl border border-gray-200 p-4 h-full flex flex-col">
      <div className="mb-3 shrink-0">
        <h3 className="text-sm font-semibold text-gray-900">Split builder</h3>
        <p className="text-xs text-gray-400 mt-0.5">{label}</p>
      </div>

      <div className="mb-3 shrink-0 space-y-1.5">
        <label className="block text-xs font-medium text-gray-500">Split name</label>
        <input
          type="text"
          value={splitName}
          onChange={(e) => setSplitName(e.target.value)}
          className="w-full px-3 py-1.5 text-sm border border-gray-300 rounded-lg focus:ring-2 focus:ring-purple-500 focus:border-purple-500"
        />
      </div>

      <div className="mb-3 shrink-0">
        <label className="block text-xs font-medium text-gray-500 mb-1">
          Train percentage: {trainPercent}%
        </label>
        <div className="flex items-center gap-2">
          <input
            type="range"
            min={0}
            max={100}
            step={5}
            value={trainPercent}
            onChange={(e) => setTrainPercent(Number(e.target.value))}
            className="flex-1"
          />
          <button
            onClick={autoDistribute}
            disabled={rows.length === 0}
            className="px-3 py-1.5 bg-white border border-gray-200 rounded-lg hover:border-purple-300 hover:bg-purple-50 text-xs font-medium text-gray-700 transition-colors disabled:opacity-50 shrink-0"
          >
            Auto-distribute
          </button>
        </div>
      </div>

      <div className="mb-2 shrink-0 flex items-center gap-3 text-xs text-gray-500">
        <span>{trainCount} train</span>
        <span>{testCount} test</span>
        <span>{unusedCount} unused</span>
      </div>

      <div className="flex-1 min-h-0 overflow-y-auto border-t border-gray-100 pt-2">
        {rows.length === 0 ? (
          <p className="text-xs text-gray-400 text-center py-4">No annotated images yet for this label.</p>
        ) : (
          <ul className="space-y-1">
            {rows.map((row) => {
              const value = assignment[row.stem] ?? 'unused';
              return (
                <li key={row.stem} className="flex items-center justify-between gap-2 text-sm">
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-gray-700">{row.stem}</p>
                    <p className="text-xs text-gray-400">{row.annotationCount} annotation(s)</p>
                  </div>
                  <button
                    onClick={() => setStemAssignment(row.stem, cycleAssignment(value))}
                    className={`px-2.5 py-1 rounded-full text-xs font-medium capitalize transition-colors shrink-0 ${badgeClass(value)}`}
                    title="Click to cycle: train, test, unused"
                  >
                    {value}
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </div>

      <div className="mt-3 pt-3 border-t border-gray-100 shrink-0">
        <button
          disabled
          title="Saving splits requires a broker update that hasn't been deployed yet."
          className="w-full px-3.5 py-2 bg-gray-100 text-gray-400 rounded-lg text-sm font-medium cursor-not-allowed"
        >
          Create split
        </button>
        <p className="mt-1.5 text-xs text-gray-400 text-center">Split saving is not available yet.</p>
      </div>
    </div>
  );
};

export default FinetuneView;
