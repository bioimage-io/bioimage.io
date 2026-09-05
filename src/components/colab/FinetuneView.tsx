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
import { ExportedCheckpoint } from '../../utils/finetuneCheckpoints';

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
  // Which of the three starting points the run uses. See CheckpointSource.
  checkpointSource: CheckpointSource;
  onCheckpointSourceChange: (value: CheckpointSource) => void;
  // Finished runs on the pinned replica whose checkpoint can be trained on
  // further. `resume_session_id` resolves against that replica's local disk,
  // so this list is by definition replica-scoped.
  resumableSessions: ResumableSession[];
  resumableSessionsLoading: boolean;
  resumeSessionId: string | null;
  onResumeSessionIdChange: (value: string | null) => void;
  // Models the user already exported to bioimage.io that carry resumable
  // weights. Unlike the sessions above these outlive the worker that trained
  // them, because the trainer downloads them by URL.
  exportedCheckpoints: ExportedCheckpoint[];
  exportedCheckpointsLoading: boolean;
  exportedCheckpointId: string | null;
  onExportedCheckpointIdChange: (value: string | null) => void;
  // False on a model-finetune replica older than 0.15.0, which has no
  // `init_checkpoint` parameter. The exported-model source is then hidden
  // rather than shown as a control that would fail on use.
  initCheckpointSupported: boolean;
  onContinueToTraining: () => void;
}

/**
 * Where the run's initial weights come from.
 *
 * 'base'     the foundation model's published weights, nothing to look up.
 * 'session'  a finished run's checkpoint on the trainer's own disk, passed as
 *            `resume_session_id`. Replica-local, so it disappears when the pod
 *            restarts or the tab pins a different worker.
 * 'exported' a model the user pushed to bioimage.io, passed as
 *            `init_checkpoint` (a signed download URL). Durable and reachable
 *            from any worker.
 */
export type CheckpointSource = 'base' | 'session' | 'exported';

/** One prior run offered as a starting checkpoint. */
export interface ResumableSession {
  session_id: string;
  model_type?: string;
  label?: string;
  end_time?: number;
  created_at?: number;
}

// Session ids are `YYYY-MM-DD-HHMMSS-xxxxxxxx`, so the distinguishing part is
// the trailing segment, not the front. Slicing off the head yields the date
// prefix, which every run of the same day shares.
const shortSessionId = (sessionId: string): string => {
  const tail = sessionId.split('-').pop();
  return tail && tail.length >= 4 ? tail : sessionId;
};

/**
 * One line for the "Previous run" picker. The list is every finished run on
 * this trainer, not just this dataset's, because continuing from a run trained
 * elsewhere is legitimate. That makes the origin the thing worth showing: a run
 * from this dataset shows only its annotation label, a foreign one shows the
 * whole `<dataset>/<label>` tag so it cannot be mistaken for a local one.
 */
export const describeResumableSession = (s: ResumableSession, alias: string): string => {
  const parts = [s.model_type ?? 'model'];
  const tag = s.label ?? '';
  const local = alias && tag.startsWith(`${alias}/`);
  const origin = local ? tag.slice(alias.length + 1) : tag;
  if (origin) parts.push(origin);
  if (s.end_time) parts.push(new Date(s.end_time * 1000).toLocaleDateString());
  parts.push(shortSessionId(s.session_id));
  return parts.join(' · ');
};

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
  checkpointSource,
  onCheckpointSourceChange,
  resumableSessions,
  resumableSessionsLoading,
  resumeSessionId,
  onResumeSessionIdChange,
  exportedCheckpoints,
  exportedCheckpointsLoading,
  exportedCheckpointId,
  onExportedCheckpointIdChange,
  initCheckpointSupported,
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

  // Continuing from a checkpoint locks the architecture: start_training
  // rejects weights whose model_type differs from the one they were trained
  // with, so the architecture follows the chosen checkpoint rather than
  // letting the two drift apart.
  const resumeSession =
    checkpointSource === 'session' && resumeSessionId
      ? resumableSessions.find((s) => s.session_id === resumeSessionId) ?? null
      : null;
  const exportedCheckpoint =
    checkpointSource === 'exported' && exportedCheckpointId
      ? exportedCheckpoints.find((c) => c.artifactId === exportedCheckpointId) ?? null
      : null;
  const effectiveModelType =
    resumeSession?.model_type ?? exportedCheckpoint?.modelType ?? modelType;

  // The two checkpoint sources need a selection, the base model does not.
  const checkpointChosen =
    checkpointSource === 'base' ||
    (checkpointSource === 'session' ? !!resumeSession : !!exportedCheckpoint);

  // A source with nothing to offer stays visible but disabled, carrying the
  // reason. Hiding it would leave the user wondering whether continuing from
  // their own weights is possible at all.
  const sourceButtons: Array<{
    key: CheckpointSource;
    label: string;
    disabled?: boolean;
    title?: string;
  }> = [
    { key: 'base', label: 'Base model' },
    {
      key: 'session',
      label: 'Previous run',
      disabled: resumableSessions.length === 0,
      title:
        resumableSessions.length === 0
          ? 'No finished run on this trainer has a checkpoint to continue from yet.'
          : undefined,
    },
  ];
  // Older trainers have no init_checkpoint parameter, so there is nothing to
  // offer and the source is left out entirely rather than shown as disabled.
  if (initCheckpointSupported) {
    sourceButtons.push({
      key: 'exported',
      label: 'Exported model',
      disabled: exportedCheckpoints.length === 0,
      title:
        exportedCheckpoints.length === 0
          ? 'None of your exported models carry weights that training can continue from.'
          : undefined,
    });
  }

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
          {sourceButtons.map((source) => {
            const active = checkpointSource === source.key;
            return (
              <button
                key={source.key}
                onClick={() => onCheckpointSourceChange(source.key)}
                disabled={source.disabled}
                title={source.title}
                className={`flex-1 px-3 py-2 rounded-lg text-xs font-medium border transition-[background-color,border-color,color,transform] duration-150 ease-out ${
                  source.disabled
                    ? 'bg-gray-50 border-gray-200 text-gray-400 cursor-not-allowed'
                    : active
                    ? 'bg-purple-50 border-purple-300 text-purple-700 active:scale-[0.97]'
                    : 'bg-white border-gray-200 text-gray-600 hover:border-purple-200 active:scale-[0.97]'
                }`}
              >
                {source.label}
              </button>
            );
          })}
        </div>

        {checkpointSource === 'session' ? (
          <div className="mb-3">
            <select
              value={resumeSessionId ?? ''}
              onChange={(e) => onResumeSessionIdChange(e.target.value || null)}
              className="w-full px-2 py-1.5 text-xs border border-gray-300 rounded-lg bg-white"
            >
              {resumableSessions.map((s) => (
                <option key={s.session_id} value={s.session_id}>
                  {describeResumableSession(s, alias)}
                </option>
              ))}
            </select>
            <p className="mt-1 text-[0.65rem] text-gray-400">
              Continues training <span className="font-medium">{effectiveModelType}</span> from this run's
              checkpoint, which lives on the worker that produced it.
            </p>
          </div>
        ) : checkpointSource === 'exported' ? (
          <div className="mb-3">
            <select
              value={exportedCheckpointId ?? ''}
              onChange={(e) => onExportedCheckpointIdChange(e.target.value || null)}
              className="w-full px-2 py-1.5 text-xs border border-gray-300 rounded-lg bg-white"
            >
              {exportedCheckpoints.map((c) => (
                <option key={c.artifactId} value={c.artifactId}>
                  {c.name} {'\u00b7'} {c.modelType}
                </option>
              ))}
            </select>
            <p className="mt-1 text-[0.65rem] text-gray-400">
              Continues training <span className="font-medium">{effectiveModelType}</span> from the weights
              in this model, which any worker can download.
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

        {(resumableSessionsLoading || exportedCheckpointsLoading) &&
          resumableSessions.length === 0 &&
          exportedCheckpoints.length === 0 && (
            <p className="mb-3 text-[0.65rem] text-gray-400">Looking for checkpoints to continue from...</p>
          )}

        <TrainingServicePicker className="mb-3" />

        <button
          onClick={onContinueToTraining}
          disabled={isNewSplit || activeSplitLoading || trainPoolEmpty || !checkpointChosen}
          title={
            isNewSplit
              ? 'Create the split first.'
              : activeSplitLoading
              ? 'Loading split details...'
              : trainPoolEmpty
              ? 'This split has no training images yet.'
              : !checkpointChosen
              ? 'Pick the checkpoint to start from.'
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
