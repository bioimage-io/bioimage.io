import React from 'react';
import { SplitDoc, SplitSummary } from './brokerApi';
import TrainingServicePicker from './TrainingServicePicker';
import {
  buildTrainingModelOptions,
  trainingGroupsOf,
  trainingGroupLabel,
  backendOfModel,
  TrainingModelOption,
} from '../../utils/trainingModels';
import {
  TrainingCapabilities,
  describeTrainingGpu,
  findModelCapability,
  isModelTrainable,
} from '../../utils/trainingCapabilities';

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
  modelType: string;
  onModelTypeChange: (value: string) => void;
  // Live per-model "can this trainer fit it?" verdict from the pinned
  // model-finetune replica. `null` means no verdict yet (still loading, or the
  // call failed), in which case every base model stays selectable and the
  // backend rejects an unfit one with a readable error.
  trainingCapabilities: TrainingCapabilities | null;
  trainingCapabilitiesLoading: boolean;
  // Finished runs on the pinned replica whose checkpoint can be trained on
  // further. `resume_session_id` resolves against that replica's local disk,
  // so this list is by definition replica-scoped.
  resumableSessions: ResumableSession[];
  resumableSessionsLoading: boolean;
  // `null` starts from the base foundation model.
  resumeSessionId: string | null;
  onResumeSessionIdChange: (value: string | null) => void;
  onContinueToTraining: () => void;
}

/** One prior run offered as a starting checkpoint. */
export interface ResumableSession {
  session_id: string;
  model_type?: string;
  label?: string;
  end_time?: number;
  created_at?: number;
}

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
  trainingCapabilities,
  trainingCapabilitiesLoading,
  resumableSessions,
  resumableSessionsLoading,
  resumeSessionId,
  onResumeSessionIdChange,
  onContinueToTraining,
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

  const trainPoolEmpty = trainCount === 0;

  // Resuming locks the architecture: start_training rejects a resume whose
  // model_type differs from the one the checkpoint was trained with, so the
  // picker follows the chosen run rather than letting the two drift apart.
  const resumeSession = resumeSessionId
    ? resumableSessions.find((s) => s.session_id === resumeSessionId) ?? null
    : null;
  const effectiveModelType = resumeSession?.model_type ?? modelType;

  // Every base model the trainer reports, across both backends (micro-sam and
  // Cellpose). Falls back to the static catalogue while capabilities load.
  const modelOptions = buildTrainingModelOptions(trainingCapabilities);
  const modelGroups = trainingGroupsOf(modelOptions);

  // Only explain the greying when there is something greyed out. With no
  // capabilities yet (loading, or the call failed) nothing is disabled, so
  // this is false and the note stays hidden.
  const hasUnfitModel = modelOptions.some(
    (o) => !isModelTrainable(trainingCapabilities, o.modelType),
  );
  // Name the card belonging to the SELECTED model's backend. The two runtimes
  // can sit on different hardware, so quoting one backend's GPU next to the
  // other backend's greyed-out entry would misattribute the shortfall.
  const selectedBackend = backendOfModel(modelOptions, effectiveModelType);
  const trainerGpuLabel = selectedBackend
    ? describeTrainingGpu(trainingCapabilities, selectedBackend)
    : null;

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
        <label className="block text-xs font-medium text-gray-500 mb-1.5">Start from</label>
        <div className="mb-3 flex gap-2">
          <button
            onClick={() => onResumeSessionIdChange(null)}
            className={`flex-1 px-3 py-2 rounded-lg text-xs font-medium border transition-[background-color,border-color,color,transform] duration-150 ease-out active:scale-[0.97] ${
              resumeSessionId === null
                ? 'bg-purple-50 border-purple-300 text-purple-700'
                : 'bg-white border-gray-200 text-gray-600 hover:border-purple-200'
            }`}
          >
            Base model
          </button>
          <button
            onClick={() => onResumeSessionIdChange(resumableSessions[0]?.session_id ?? null)}
            disabled={resumableSessions.length === 0}
            title={
              resumableSessions.length === 0
                ? 'No finished run on this trainer has a checkpoint to continue from yet.'
                : undefined
            }
            className={`flex-1 px-3 py-2 rounded-lg text-xs font-medium border transition-[background-color,border-color,color,transform] duration-150 ease-out ${
              resumableSessions.length === 0
                ? 'bg-gray-50 border-gray-200 text-gray-400 cursor-not-allowed'
                : resumeSessionId !== null
                ? 'bg-purple-50 border-purple-300 text-purple-700 active:scale-[0.97]'
                : 'bg-white border-gray-200 text-gray-600 hover:border-purple-200 active:scale-[0.97]'
            }`}
          >
            My checkpoint
          </button>
        </div>

        {resumeSessionId !== null ? (
          <div className="mb-3">
            <select
              value={resumeSessionId}
              onChange={(e) => onResumeSessionIdChange(e.target.value)}
              className="w-full px-2 py-1.5 text-xs border border-gray-300 rounded-lg bg-white"
            >
              {resumableSessions.map((s) => (
                <option key={s.session_id} value={s.session_id}>
                  {(s.model_type ?? 'model')} {'\u00b7'} {s.session_id.slice(0, 8)}
                  {s.end_time ? ` ${'\u00b7'} ${new Date(s.end_time * 1000).toLocaleDateString()}` : ''}
                </option>
              ))}
            </select>
            <p className="mt-1 text-[0.65rem] text-gray-400">
              Continues training <span className="font-medium">{effectiveModelType}</span> from this run's
              checkpoint, which lives on the worker that produced it.
            </p>
          </div>
        ) : (
          <>
            <label className="block text-xs font-medium text-gray-500 mb-1.5">Base model</label>
            <div className="mb-3 space-y-2">
              {modelGroups.map((group) => {
                const optionsInGroup = modelOptions.filter((o: TrainingModelOption) => o.group === group);
                if (optionsInGroup.length === 0) return null;
                return (
                  <div key={group}>
                    <p className="text-[0.65rem] font-medium text-gray-400 mb-1">{trainingGroupLabel(group)}</p>
                    <div className="flex gap-2">
                      {optionsInGroup.map((opt: TrainingModelOption) => {
                        // Every model is listed. The ones this trainer's GPU
                        // cannot fit are rendered disabled with the backend's
                        // own reason attached, rather than omitted, so "we
                        // don't offer it" and "your hardware can't run it"
                        // stop looking identical.
                        const enabled = isModelTrainable(trainingCapabilities, opt.modelType);
                        const reason = findModelCapability(trainingCapabilities, opt.modelType)?.reason;
                        return (
                          <button
                            key={opt.modelType}
                            onClick={() => onModelTypeChange(opt.modelType)}
                            disabled={!enabled}
                            title={enabled ? undefined : reason || 'This model is not trainable on the current GPU'}
                            className={`flex-1 px-3 py-2 rounded-lg text-xs font-medium border transition-[background-color,border-color,color,transform] duration-150 ease-out ${
                              !enabled
                                ? 'bg-gray-50 border-gray-200 text-gray-400 cursor-not-allowed'
                                : modelType === opt.modelType
                                ? 'bg-purple-50 border-purple-300 text-purple-700 active:scale-[0.97]'
                                : 'bg-white border-gray-200 text-gray-600 hover:border-purple-200 active:scale-[0.97]'
                            }`}
                          >
                            {opt.label}
                          </button>
                        );
                      })}
                    </div>
                  </div>
                );
              })}
            </div>
            {trainingCapabilitiesLoading ? (
              <p className="text-[0.65rem] text-gray-400 -mt-2 mb-3">
                Checking which models this trainer's GPU can fit...
              </p>
            ) : (
              hasUnfitModel && (
                <p className="text-[0.65rem] text-gray-400 -mt-2 mb-3">
                  Greyed-out models need more memory than {trainerGpuLabel ?? 'the training GPU'} has.
                  Hover one to see how much.
                </p>
              )
            )}
          </>
        )}

        {resumableSessionsLoading && resumableSessions.length === 0 && (
          <p className="mb-3 text-[0.65rem] text-gray-400">Looking for checkpoints on this trainer...</p>
        )}

        <TrainingServicePicker className="mb-3" />

        <button
          onClick={onContinueToTraining}
          disabled={isNewSplit || activeSplitLoading || trainPoolEmpty}
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
          Continue to training
        </button>
        <p className="mt-1.5 text-[0.65rem] text-gray-400 text-center">
          You pick the training parameters and start the run on the next page.
        </p>
      </div>
    </div>
  );
};

export default FinetuneView;
