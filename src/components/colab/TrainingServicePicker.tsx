import React, { useEffect, useState } from 'react';
import {
  DEFAULT_TRAINING_SERVICE_ID,
  getEffectiveTrainingServiceId,
  getPinnedTrainingServiceId,
  getTrainingServiceOverride,
  setTrainingServiceOverride,
  subscribeTrainingServiceOverride,
} from '../../utils/trainingServicePin';
import { resetTrainingCapabilitiesCache } from '../../utils/trainingCapabilities';

export interface TrainingServicePickerProps {
  /** Called after the target changes, so the caller can re-read capabilities. */
  onChange?: () => void;
  className?: string;
}

/**
 * Lets the user point every fine-tuning call at a service id of their own
 * (a development deployment of model-finetune, or one specific worker replica)
 * instead of the shared `bioimage-io/model-finetune`.
 *
 * Also the one place the *pinned replica* is visible. That matters more than it
 * looks: a fine-tuning session's checkpoints live on the replica that ran it,
 * so "which replica am I on" is the difference between finding your previous
 * run and not. Changing the target deliberately drops the pin, since the old
 * one names a client of the previous service.
 */
const TrainingServicePicker: React.FC<TrainingServicePickerProps> = ({ onChange, className }) => {
  const [override, setOverride] = useState<string | null>(() => getTrainingServiceOverride());
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(() => getTrainingServiceOverride() ?? '');

  useEffect(
    () =>
      subscribeTrainingServiceOverride(() => {
        const next = getTrainingServiceOverride();
        setOverride(next);
        setDraft(next ?? '');
      }),
    [],
  );

  const apply = (value: string | null) => {
    setTrainingServiceOverride(value);
    // Capabilities are cached per tab and describe the GPU of whichever replica
    // answered, so they are wrong the moment the target changes.
    resetTrainingCapabilitiesCache();
    setEditing(false);
    onChange?.();
  };

  const pinned = getPinnedTrainingServiceId();
  const effective = getEffectiveTrainingServiceId();

  return (
    <div className={className}>
      {!editing ? (
        <div className="flex items-center gap-2 text-[0.65rem] text-gray-400">
          <span className="truncate">
            Training service:{' '}
            <span className="font-mono text-gray-500">{effective}</span>
            {override && <span className="ml-1 text-amber-600">(custom)</span>}
          </span>
          <button
            onClick={() => setEditing(true)}
            className="shrink-0 font-medium text-gray-500 hover:text-gray-700 transition-colors duration-150"
          >
            Change
          </button>
        </div>
      ) : (
        <div className="rounded-lg border border-gray-200 bg-gray-50 p-2.5">
          <label className="block text-[0.65rem] font-medium text-gray-500 mb-1">
            Fine-tuning service id
          </label>
          <input
            type="text"
            value={draft}
            spellCheck={false}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') apply(draft);
              if (e.key === 'Escape') setEditing(false);
            }}
            placeholder={DEFAULT_TRAINING_SERVICE_ID}
            className="w-full px-2 py-1 text-xs font-mono border border-gray-300 rounded-lg focus:outline-none focus:border-purple-300"
          />
          <p className="mt-1 text-[0.65rem] text-gray-400">
            Leave empty for the shared service. A workspace name balances across every worker
            running it, a fully qualified id targets one replica.
          </p>
          <div className="mt-2 flex items-center gap-2">
            <button
              onClick={() => apply(draft)}
              className="px-2.5 py-1 rounded-lg bg-gray-900 text-white text-[0.7rem] font-medium transition-transform duration-150 ease-out active:scale-[0.97]"
            >
              Use this service
            </button>
            {override && (
              <button
                onClick={() => apply(null)}
                className="px-2.5 py-1 rounded-lg border border-gray-200 bg-white text-gray-600 text-[0.7rem] font-medium transition-transform duration-150 ease-out active:scale-[0.97]"
              >
                Reset
              </button>
            )}
            <button
              onClick={() => setEditing(false)}
              className="text-[0.7rem] font-medium text-gray-500 hover:text-gray-700 transition-colors duration-150"
            >
              Cancel
            </button>
          </div>
          {pinned && (
            <p className="mt-2 text-[0.65rem] text-gray-400 truncate">
              Pinned replica: <span className="font-mono">{pinned}</span>
            </p>
          )}
        </div>
      )}
    </div>
  );
};

export default TrainingServicePicker;
