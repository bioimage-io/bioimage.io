import React from 'react';
import { SplitDoc, SplitSummary } from './brokerApi';

export interface FinetuneViewRow {
  stem: string;
  annotationCount: number;
}

export interface FinetuneViewProps {
  label: string;
  alias: string;
  // Compact listing rows for the split-name dropdown only (broker v0.7.0
  // `list_splits` never returns membership arrays) — full train/test/
  // annotation_counts/checkpoint for the SELECTED split comes separately via
  // `activeSplit` below, fetched by the parent with `getSplit`.
  existingSplits: SplitSummary[];
  splitsLoading: boolean;
  activeSplitName: string | null;
  activeSplit: SplitDoc | null;
  // True while the full doc for `activeSplitName` is being fetched — locked
  // train/test membership isn't known yet, so staging changes or starting
  // training during this window would race against stale (empty) state.
  activeSplitLoading: boolean;
  onSelectSplit: (name: string | null) => void;
  newSplitName: string;
  onNewSplitNameChange: (value: string) => void;
  trainPercent: number;
  onTrainPercentChange: (value: number) => void;
  onAutoDistribute: () => void;
  rows: FinetuneViewRow[];
  assignment: Record<string, 'train' | 'test' | 'unused'>;
  isSaving: boolean;
  saveError: string | null;
  onSaveSplit: () => void;
  modelType: 'vit_t_lm' | 'vit_b_lm';
  onModelTypeChange: (value: 'vit_t_lm' | 'vit_b_lm') => void;
  showAdvanced: boolean;
  onToggleAdvanced: () => void;
  nEpochs: number;
  onNEpochsChange: (value: number) => void;
  nObjectsPerBatch: number;
  onNObjectsPerBatchChange: (value: number) => void;
  patchSize: number;
  onPatchSizeChange: (value: number) => void;
  batchSize: number;
  onBatchSizeChange: (value: number) => void;
  learningRate: number;
  onLearningRateChange: (value: number) => void;
  isStartingTraining: boolean;
  startTrainingError: string | null;
  onStartTraining: () => void;
  showEmptyTestWarning: boolean;
  onDismissEmptyTestWarning: () => void;
  onConfirmStartWithEmptyTest: () => void;
}

const MODEL_OPTIONS: Array<{ value: 'vit_t_lm' | 'vit_b_lm'; label: string }> = [
  { value: 'vit_t_lm', label: 'ViT-Tiny (vit_t_lm)' },
  { value: 'vit_b_lm', label: 'ViT-Base (vit_b_lm)' },
];

const badgeClass = (value: 'train' | 'test' | 'unused') =>
  value === 'train'
    ? 'bg-blue-100 text-blue-700'
    : value === 'test'
    ? 'bg-amber-100 text-amber-700'
    : 'bg-gray-100 text-gray-500';

// colab-rework-plan.md §23.2/§23.4: shown in place of the Labels box once a
// finetune view is open. This panel is purely presentational now, all
// split-authoring and training-start state is lifted into DatasetOverview
// (which also owns the left image list and its per-row assignment badges,
// see FinetuneView's sibling `renderFinetuneBadge` there) so the two panels
// can share one `assignment` map. No image list is rendered here (§23.4
// item 3 moved it to the left panel) — this panel only holds split
// selection, the name/percentage/tally/create controls, and the
// training-start form.
const FinetuneView: React.FC<FinetuneViewProps> = ({
  label,
  alias,
  existingSplits,
  splitsLoading,
  activeSplitName,
  activeSplit,
  activeSplitLoading,
  onSelectSplit,
  newSplitName,
  onNewSplitNameChange,
  trainPercent,
  onTrainPercentChange,
  onAutoDistribute,
  rows,
  assignment,
  isSaving,
  saveError,
  onSaveSplit,
  modelType,
  onModelTypeChange,
  showAdvanced,
  onToggleAdvanced,
  nEpochs,
  onNEpochsChange,
  nObjectsPerBatch,
  onNObjectsPerBatchChange,
  patchSize,
  onPatchSizeChange,
  batchSize,
  onBatchSizeChange,
  learningRate,
  onLearningRateChange,
  isStartingTraining,
  startTrainingError,
  onStartTraining,
  showEmptyTestWarning,
  onDismissEmptyTestWarning,
  onConfirmStartWithEmptyTest,
}) => {
  const isNewSplit = activeSplitName === null;

  const lockedTrainCount = activeSplit?.train.length ?? 0;
  const lockedTestCount = activeSplit?.test.length ?? 0;
  const stagedTrainCount = rows.filter((r) => assignment[r.stem] === 'train').length;
  const stagedTestCount = rows.filter((r) => assignment[r.stem] === 'test').length;
  const stagedUnusedCount = rows.filter((r) => (assignment[r.stem] ?? 'unused') === 'unused').length;
  const trainCount = lockedTrainCount + stagedTrainCount;
  const testCount = lockedTestCount + stagedTestCount;

  const hasStagedChanges = stagedTrainCount > 0 || stagedTestCount > 0;
  const saveDisabled =
    isSaving ||
    (!isNewSplit && activeSplitLoading) ||
    (!isNewSplit && !hasStagedChanges) ||
    (isNewSplit && stagedTrainCount === 0);

  const isCheckpointed = !!activeSplit?.checkpoint;
  const trainPoolEmpty = trainCount === 0;

  return (
    <div className="bg-white rounded-2xl border border-gray-200 p-4 h-full flex flex-col overflow-y-auto">
      <div className="mb-3 shrink-0 flex items-start justify-between gap-2">
        <div>
          <h3 className="text-sm font-semibold text-gray-900">Split builder</h3>
          <p className="text-xs text-gray-400 mt-0.5">
            Assign images from the list on the left, then create a split for "{label}".
          </p>
        </div>
        <a
          href={`/#/colab/${alias}/finetune`}
          className="text-xs font-medium text-purple-600 hover:text-purple-700 shrink-0 whitespace-nowrap"
        >
          Training sessions
        </a>
      </div>

      <div className="mb-3 shrink-0 space-y-1.5">
        <label className="block text-xs font-medium text-gray-500">Split</label>
        <select
          value={activeSplitName ?? '__new__'}
          onChange={(e) => onSelectSplit(e.target.value === '__new__' ? null : e.target.value)}
          disabled={splitsLoading}
          className="w-full px-3 py-1.5 text-sm border border-gray-300 rounded-lg focus:ring-2 focus:ring-purple-500 focus:border-purple-500 disabled:opacity-50"
        >
          <option value="__new__">+ New split</option>
          {existingSplits.map((s) => (
            <option key={s.name} value={s.name}>
              {s.name}
              {s.checkpoint ? ' (trained)' : ''}
            </option>
          ))}
        </select>
        {isNewSplit && (
          <input
            type="text"
            value={newSplitName}
            onChange={(e) => onNewSplitNameChange(e.target.value)}
            placeholder="Split name"
            className="w-full px-3 py-1.5 text-sm border border-gray-300 rounded-lg focus:ring-2 focus:ring-purple-500 focus:border-purple-500"
          />
        )}
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
            onChange={(e) => onTrainPercentChange(Number(e.target.value))}
            className="flex-1"
          />
          <button
            onClick={onAutoDistribute}
            disabled={stagedUnusedCount === 0}
            className="px-3 py-1.5 bg-white border border-gray-200 rounded-lg hover:border-purple-300 hover:bg-purple-50 text-xs font-medium text-gray-700 transition-colors disabled:opacity-50 shrink-0"
          >
            Auto-distribute
          </button>
        </div>
      </div>

      <div className="mb-3 shrink-0 flex items-center gap-3 text-xs text-gray-500">
        <span className={`px-2 py-0.5 rounded-full ${badgeClass('train')}`}>{trainCount} train</span>
        <span className={`px-2 py-0.5 rounded-full ${badgeClass('test')}`}>{testCount} test</span>
        <span className={`px-2 py-0.5 rounded-full ${badgeClass('unused')}`}>{stagedUnusedCount} unused</span>
      </div>

      {saveError && (
        <p className="mb-3 shrink-0 text-sm text-red-600 bg-red-50 border border-red-100 rounded-lg px-3 py-2">
          {saveError}
        </p>
      )}

      <div className="mb-4 shrink-0">
        <button
          onClick={onSaveSplit}
          disabled={saveDisabled}
          className="w-full px-3.5 py-2 bg-gradient-to-r from-purple-600 to-pink-600 text-white rounded-lg hover:from-purple-700 hover:to-pink-700 text-sm font-medium shadow-sm transition-all disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
        >
          {isSaving && (
            <svg className="animate-spin w-4 h-4" viewBox="0 0 24 24" fill="none">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
            </svg>
          )}
          {isNewSplit ? 'Create split' : 'Extend split'}
        </button>
      </div>

      <div className="pt-3 border-t border-gray-100">
        {isCheckpointed ? (
          <div className="rounded-lg bg-amber-50 border border-amber-100 px-3 py-2.5 text-xs text-amber-800">
            This split was already used to train <span className="font-medium">{activeSplit!.checkpoint!.model_type}</span>{' '}
            (session <span className="font-mono">{activeSplit!.checkpoint!.session_id}</span>). Continued
            fine-tuning from a checkpoint isn't supported by the training backend yet. Start a new split to train
            again.
          </div>
        ) : (
          <>
            <label className="block text-xs font-medium text-gray-500 mb-1.5">Base model</label>
            <div className="flex gap-2 mb-3">
              {MODEL_OPTIONS.map((opt) => (
                <button
                  key={opt.value}
                  onClick={() => onModelTypeChange(opt.value)}
                  className={`flex-1 px-3 py-2 rounded-lg text-xs font-medium border transition-colors ${
                    modelType === opt.value
                      ? 'bg-purple-50 border-purple-300 text-purple-700'
                      : 'bg-white border-gray-200 text-gray-600 hover:border-purple-200'
                  }`}
                >
                  {opt.label}
                </button>
              ))}
            </div>

            <button
              onClick={onToggleAdvanced}
              className="text-xs font-medium text-gray-500 hover:text-gray-700 mb-2"
            >
              {showAdvanced ? 'Hide advanced parameters' : 'Show advanced parameters'}
            </button>

            {showAdvanced && (
              <div className="grid grid-cols-2 gap-2 mb-3">
                <label className="text-xs text-gray-500">
                  Epochs
                  <input
                    type="number"
                    value={nEpochs}
                    onChange={(e) => onNEpochsChange(Number(e.target.value))}
                    className="mt-0.5 w-full px-2 py-1 text-sm border border-gray-300 rounded-lg"
                  />
                </label>
                <label className="text-xs text-gray-500">
                  Objects/batch
                  <input
                    type="number"
                    value={nObjectsPerBatch}
                    onChange={(e) => onNObjectsPerBatchChange(Number(e.target.value))}
                    className="mt-0.5 w-full px-2 py-1 text-sm border border-gray-300 rounded-lg"
                  />
                </label>
                <label className="text-xs text-gray-500">
                  Patch size
                  <input
                    type="number"
                    value={patchSize}
                    onChange={(e) => onPatchSizeChange(Number(e.target.value))}
                    className="mt-0.5 w-full px-2 py-1 text-sm border border-gray-300 rounded-lg"
                  />
                </label>
                <label className="text-xs text-gray-500">
                  Batch size
                  <input
                    type="number"
                    value={batchSize}
                    onChange={(e) => onBatchSizeChange(Number(e.target.value))}
                    className="mt-0.5 w-full px-2 py-1 text-sm border border-gray-300 rounded-lg"
                  />
                </label>
                <label className="text-xs text-gray-500 col-span-2">
                  Learning rate
                  <input
                    type="number"
                    step="0.00001"
                    value={learningRate}
                    onChange={(e) => onLearningRateChange(Number(e.target.value))}
                    className="mt-0.5 w-full px-2 py-1 text-sm border border-gray-300 rounded-lg"
                  />
                </label>
              </div>
            )}

            {startTrainingError && (
              <p className="mb-2 text-sm text-red-600 bg-red-50 border border-red-100 rounded-lg px-3 py-2">
                {startTrainingError}
              </p>
            )}

            <button
              onClick={onStartTraining}
              disabled={isStartingTraining || isNewSplit || activeSplitLoading || trainPoolEmpty}
              title={
                isNewSplit
                  ? 'Create the split first.'
                  : activeSplitLoading
                  ? 'Loading split details...'
                  : trainPoolEmpty
                  ? 'This split has no training images yet.'
                  : undefined
              }
              className="w-full px-3.5 py-2 bg-gradient-to-r from-emerald-600 to-teal-600 text-white rounded-lg hover:from-emerald-700 hover:to-teal-700 text-sm font-medium shadow-sm transition-all disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
            >
              {isStartingTraining && (
                <svg className="animate-spin w-4 h-4" viewBox="0 0 24 24" fill="none">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                </svg>
              )}
              Start training
            </button>
          </>
        )}
      </div>

      {showEmptyTestWarning && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-50 animate-fadeIn p-4">
          <div className="bg-white rounded-2xl shadow-lg max-w-sm w-full border border-gray-100">
            <div className="p-6">
              <h3 className="text-base font-semibold text-gray-900 mb-1">Test split is empty</h3>
              <p className="text-sm text-gray-500">
                {trainCount === 1
                  ? 'This split has a single training image and no held-out test image. Validation will reuse the training image. Start anyway?'
                  : 'Training will fall back to an internal validation slice instead of your held-out images. Start anyway?'}
              </p>
            </div>
            <div className="px-6 py-4 border-t border-gray-100 flex justify-end gap-2">
              <button
                onClick={onDismissEmptyTestWarning}
                className="px-3.5 py-2 text-sm font-medium text-gray-500 hover:text-gray-700 transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={onConfirmStartWithEmptyTest}
                className="px-3.5 py-2 bg-gradient-to-r from-emerald-600 to-teal-600 text-white rounded-lg hover:from-emerald-700 hover:to-teal-700 text-sm font-medium shadow-sm transition-all"
              >
                Start anyway
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default FinetuneView;
