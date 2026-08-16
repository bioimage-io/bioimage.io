import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import {
  DatasetLabelRef,
  buildAnnotateQuery,
  discoverLabels,
} from './datasetApi';
import {
  BrokerAccessError,
  BrokerErrorCode,
  BrokerRole,
  DatasetSplit,
  DatasetWithRole,
  getDataset,
  getSplit,
  getTrainingUrls,
} from './brokerApi';
import { resolvePinnedMicroSamTrainingService } from '../../utils/microSamTrainingPin';
import LoginButton from '../LoginButton';

export interface FinetuneProps {
  artifactId: string;
  artifactAlias: string;
  server: any;
  user: any;
  artifactManager: any;
}

// μSAM fine-tuning is restricted to the two models the deNBI T4 runtime can
// actually train (colab-rework-plan.md §20.2): vit_l_lm OOMs during training,
// so it stays inference-only (see utils/microSamService.ts's
// MICRO_SAM_MODEL_TYPE) and is deliberately excluded here.
const MODEL_OPTIONS: { value: 'vit_t_lm' | 'vit_b_lm'; label: string; description: string }[] = [
  { value: 'vit_t_lm', label: 'ViT-Tiny (vit_t_lm)', description: 'Smallest and fastest to train' },
  { value: 'vit_b_lm', label: 'ViT-Base (vit_b_lm)', description: 'Larger, typically more accurate' },
];

type TrainingStatusValue = 'PREPARING' | 'TRAINING' | 'COMPLETED' | 'FAILED' | 'STOPPED' | 'UNKNOWN';

interface TrainingSessionStatus {
  session_id: string;
  status: TrainingStatusValue;
  message?: string;
  created_at?: number;
  model_type?: string;
  label?: string;
  n_train_inputs?: number;
  checkpoint_available: boolean;
  elapsed_s?: number;
  start_time?: number;
  end_time?: number;
}

const TERMINAL_STATUSES: TrainingStatusValue[] = ['COMPLETED', 'FAILED', 'STOPPED'];

const STATUS_BADGE: Record<TrainingStatusValue, string> = {
  PREPARING: 'bg-blue-50 text-blue-700 border-blue-200',
  TRAINING: 'bg-blue-50 text-blue-700 border-blue-200',
  COMPLETED: 'bg-emerald-50 text-emerald-700 border-emerald-200',
  FAILED: 'bg-red-50 text-red-700 border-red-200',
  STOPPED: 'bg-gray-100 text-gray-600 border-gray-200',
  UNKNOWN: 'bg-gray-100 text-gray-600 border-gray-200',
};

const formatElapsed = (seconds?: number): string => {
  if (seconds == null) return '';
  if (seconds < 60) return `${Math.round(seconds)}s`;
  const m = Math.floor(seconds / 60);
  const s = Math.round(seconds % 60);
  return `${m}m ${s}s`;
};

const formatUnixTime = (seconds?: number): string => {
  if (!seconds) return '';
  return new Date(seconds * 1000).toLocaleString();
};

const Spinner: React.FC<{ className?: string }> = ({ className = 'w-8 h-8 text-purple-600' }) => (
  <svg className={`animate-spin ${className}`} fill="none" viewBox="0 0 24 24">
    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
    <path
      className="opacity-75"
      fill="currentColor"
      d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
    />
  </svg>
);

// The `label` field start_training accepts is just a free-form tag (broker/
// micro-sam has no concept of "which dataset" for a session — sessions are
// tracked per worker replica, not per artifact). We prefix every session we
// start with `<alias>/<annotationLabel>` so the sessions list below can find
// "this dataset's" sessions among everything else running on the same pinned
// worker, and so the tag stays human-readable in any other tooling.
const sessionTag = (alias: string, annotationLabel: string) => `${alias}/${annotationLabel}`;

const Finetune: React.FC<FinetuneProps> = ({ artifactId, artifactAlias, server, user, artifactManager }) => {
  const navigate = useNavigate();
  const location = useLocation();
  const prefillLabel = (location.state as any)?.label as string | undefined;

  const [dataset, setDataset] = useState<DatasetWithRole | null>(null);
  const [guardError, setGuardError] = useState<string | null>(null);
  const [guardErrorCode, setGuardErrorCode] = useState<BrokerErrorCode | null>(null);

  const [labels, setLabels] = useState<DatasetLabelRef[]>([]);
  const [labelsLoading, setLabelsLoading] = useState(false);
  const [selectedLabel, setSelectedLabel] = useState('');
  const [split, setSplitState] = useState<DatasetSplit>({ train: [], test: [] });

  const [modelType, setModelType] = useState<'vit_t_lm' | 'vit_b_lm'>('vit_t_lm');
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [nEpochs, setNEpochs] = useState(5);
  const [nObjectsPerBatch, setNObjectsPerBatch] = useState(8);
  const [patchSize, setPatchSize] = useState(512);
  const [batchSize, setBatchSize] = useState(1);
  const [learningRate, setLearningRate] = useState(1e-5);
  const [valFraction, setValFraction] = useState(0.2);
  const [nSamples, setNSamples] = useState<number | ''>('');

  const [isStarting, setIsStarting] = useState(false);
  const [startError, setStartError] = useState<string | null>(null);

  const [sessions, setSessions] = useState<Record<string, TrainingSessionStatus>>({});
  const [sessionsLoading, setSessionsLoading] = useState(false);
  const [sessionsError, setSessionsError] = useState<string | null>(null);
  const [stoppingSessionId, setStoppingSessionId] = useState<string | null>(null);
  const [confirmStopId, setConfirmStopId] = useState<string | null>(null);

  const role: BrokerRole | undefined = dataset?.role;
  const canManage = role === 'owner' || role === 'manager';

  // --- Role guard (same shape as DatasetOverview's, condensed) ---
  useEffect(() => {
    if (!server || !user) return;
    let active = true;
    (async () => {
      try {
        const d = await getDataset(server, artifactId);
        if (active) {
          setDataset(d);
          setGuardError(null);
          setGuardErrorCode(null);
        }
      } catch (err) {
        if (active) {
          setGuardError((err as Error).message || 'Access denied.');
          setGuardErrorCode(err instanceof BrokerAccessError ? err.code : 'unknown');
        }
      }
    })();
    return () => {
      active = false;
    };
  }, [server, user, artifactId]);

  // --- Labels + split ---
  useEffect(() => {
    if (!canManage) return;
    let active = true;
    setLabelsLoading(true);
    (async () => {
      try {
        const found = await discoverLabels(artifactManager, artifactId);
        if (!active) return;
        setLabels(found);
        setSelectedLabel((prev) => {
          if (prev && found.some((l) => l.name === prev)) return prev;
          if (prefillLabel && found.some((l) => l.name === prefillLabel)) return prefillLabel;
          return found[0]?.name ?? '';
        });
      } catch {
        // best-effort; the label select just stays empty
      } finally {
        if (active) setLabelsLoading(false);
      }
    })();
    (async () => {
      try {
        const s = await getSplit(server, artifactId);
        if (active) setSplitState(s);
      } catch {
        // best-effort; falls back to "no split" default
      }
    })();
    return () => {
      active = false;
    };
  }, [server, artifactManager, artifactId, canManage]);

  // --- Sessions list, polled while any tracked session is non-terminal ---
  const refreshSessions = useCallback(async (): Promise<Record<string, TrainingSessionStatus>> => {
    const svc = await resolvePinnedMicroSamTrainingService(server);
    const all: Record<string, TrainingSessionStatus> = await svc.list_training_sessions({ _rkwargs: true });
    const tag = sessionTag(artifactAlias, '');
    const mine: Record<string, TrainingSessionStatus> = {};
    Object.values(all || {}).forEach((s) => {
      if (s?.label?.startsWith(tag)) mine[s.session_id] = s;
    });
    setSessions(mine);
    return mine;
  }, [server, artifactAlias]);

  const pollTimer = useRef<NodeJS.Timeout | null>(null);
  useEffect(() => {
    if (!canManage || !server) return;
    let active = true;

    const tick = async () => {
      setSessionsError(null);
      try {
        const mine = await refreshSessions();
        if (!active) return;
        const hasRunning = Object.values(mine).some((s) => !TERMINAL_STATUSES.includes(s.status));
        if (hasRunning) {
          pollTimer.current = setTimeout(tick, 5000);
        }
      } catch (err) {
        if (active) setSessionsError((err as Error).message || 'Failed to load training sessions.');
      }
    };

    setSessionsLoading(true);
    tick().finally(() => {
      if (active) setSessionsLoading(false);
    });

    return () => {
      active = false;
      if (pollTimer.current) clearTimeout(pollTimer.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [canManage, server, artifactAlias]);

  const handleManualRefresh = async () => {
    setSessionsError(null);
    setSessionsLoading(true);
    try {
      const mine = await refreshSessions();
      const hasRunning = Object.values(mine).some((s) => !TERMINAL_STATUSES.includes(s.status));
      if (hasRunning && !pollTimer.current) {
        pollTimer.current = setTimeout(async () => {
          pollTimer.current = null;
          await refreshSessions();
        }, 5000);
      }
    } catch (err) {
      setSessionsError((err as Error).message || 'Failed to load training sessions.');
    } finally {
      setSessionsLoading(false);
    }
  };

  const handleStart = async () => {
    if (!selectedLabel) return;
    setIsStarting(true);
    setStartError(null);
    try {
      const urls = await getTrainingUrls(server, artifactId, selectedLabel);
      if (urls.train.length === 0) {
        setStartError(`No annotated training images found for label "${selectedLabel}" yet.`);
        return;
      }
      const params: any = {
        train_images: urls.train.map((e) => e.image_url),
        train_labels: urls.train.map((e) => e.geojson_url),
        model_type: modelType,
        n_epochs: nEpochs,
        n_objects_per_batch: nObjectsPerBatch,
        patch_size: patchSize,
        batch_size: batchSize,
        learning_rate: learningRate,
        val_fraction: valFraction,
        label: sessionTag(artifactAlias, selectedLabel),
        _rkwargs: true,
      };
      if (urls.test.length > 0) {
        params.val_images = urls.test.map((e) => e.image_url);
        params.val_labels = urls.test.map((e) => e.geojson_url);
      }
      if (nSamples !== '') {
        params.n_samples = nSamples;
      }

      const svc = await resolvePinnedMicroSamTrainingService(server);
      const status: TrainingSessionStatus = await svc.start_training(params);
      setSessions((prev) => ({ ...prev, [status.session_id]: status }));
      if (!pollTimer.current) {
        pollTimer.current = setTimeout(async () => {
          pollTimer.current = null;
          try {
            const mine = await refreshSessions();
            const hasRunning = Object.values(mine).some((s) => !TERMINAL_STATUSES.includes(s.status));
            if (hasRunning) pollTimer.current = setTimeout(async () => { await refreshSessions(); }, 5000);
          } catch {
            // next manual refresh will surface the error
          }
        }, 5000);
      }
    } catch (err) {
      setStartError((err as Error).message || 'Failed to start training.');
    } finally {
      setIsStarting(false);
    }
  };

  const handleStop = async (sessionId: string) => {
    setConfirmStopId(null);
    setStoppingSessionId(sessionId);
    try {
      const svc = await resolvePinnedMicroSamTrainingService(server);
      const status: TrainingSessionStatus = await svc.stop_training({ session_id: sessionId, _rkwargs: true });
      setSessions((prev) => ({ ...prev, [sessionId]: status }));
    } catch (err) {
      setSessionsError((err as Error).message || 'Failed to stop training.');
    } finally {
      setStoppingSessionId(null);
    }
  };

  // --- Guard states ---
  if (!server) {
    return (
      <div className="flex items-center justify-center h-64">
        <Spinner />
      </div>
    );
  }

  if (guardError || (dataset && !canManage)) {
    const isAuthExpired = guardErrorCode === 'auth-expired';
    if (isAuthExpired) {
      return (
        <div className="max-w-lg mx-auto text-center py-16">
          <h2 className="text-lg font-semibold text-gray-900 mb-1">Your session has expired</h2>
          <p className="text-sm text-gray-500 mb-6">Please log in again to continue.</p>
          <div className="flex justify-center">
            <LoginButton />
          </div>
        </div>
      );
    }
    return (
      <div className="max-w-lg mx-auto text-center py-16">
        <h2 className="text-lg font-semibold text-gray-900 mb-1">You do not have access to fine-tuning</h2>
        <p className="text-sm text-gray-500 mb-6">Only the dataset owner and its managers can fine-tune models here.</p>
        <button
          onClick={() => navigate(`/colab/${artifactAlias}`)}
          className="px-5 py-2.5 bg-white border border-gray-200 rounded-xl hover:bg-gray-50 text-gray-900 font-medium shadow-sm transition-all"
        >
          Back to dataset
        </button>
      </div>
    );
  }

  if (!dataset) {
    return (
      <div className="flex items-center justify-center h-64">
        <Spinner />
      </div>
    );
  }

  const sortedSessions = Object.values(sessions).sort((a, b) => (b.created_at || 0) - (a.created_at || 0));

  return (
    <div className="max-w-4xl mx-auto">
      <div className="flex items-center gap-3 mb-6">
        <button
          onClick={() => navigate(`/colab/${artifactAlias}`)}
          className="px-3 py-1.5 bg-white border border-gray-200 rounded-lg hover:bg-gray-50 text-sm font-medium text-gray-700 transition-colors"
        >
          Back
        </button>
        <div>
          <h1 className="text-xl font-semibold text-gray-900">Fine-tune μSAM</h1>
          <p className="text-sm text-gray-500">{dataset.name || artifactAlias}</p>
        </div>
      </div>

      {/* Start form */}
      <div className="bg-white rounded-2xl shadow-sm border border-gray-200 p-6 mb-6">
        <h2 className="text-base font-semibold text-gray-900 mb-4">Start a new session</h2>

        <div className="grid sm:grid-cols-2 gap-4 mb-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1.5">Label</label>
            <select
              value={selectedLabel}
              onChange={(e) => setSelectedLabel(e.target.value)}
              disabled={labelsLoading || labels.length === 0}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-purple-400"
            >
              {labels.length === 0 && <option value="">No labels yet</option>}
              {labels.map((l) => (
                <option key={l.name} value={l.name}>
                  {l.name}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1.5">Validation data</label>
            <p className="text-sm text-gray-600 px-3 py-2 bg-gray-50 rounded-lg border border-gray-200">
              {split.test.length > 0
                ? `${split.test.length} test image(s) from the dataset split`
                : `No test split defined, an automatic ${Math.round(valFraction * 100)}% validation split will be used`}
            </p>
          </div>
        </div>

        <div className="mb-4">
          <label className="block text-sm font-medium text-gray-700 mb-1.5">Base model</label>
          <div className="grid sm:grid-cols-2 gap-3">
            {MODEL_OPTIONS.map((opt) => (
              <button
                key={opt.value}
                type="button"
                onClick={() => setModelType(opt.value)}
                className={`text-left px-4 py-3 rounded-lg border transition-colors ${
                  modelType === opt.value
                    ? 'border-purple-400 bg-purple-50'
                    : 'border-gray-200 hover:border-purple-200'
                }`}
              >
                <div className="text-sm font-medium text-gray-900">{opt.label}</div>
                <div className="text-xs text-gray-500 mt-0.5">{opt.description}</div>
              </button>
            ))}
          </div>
        </div>

        <div className="flex items-start gap-2 mb-4 px-3.5 py-2.5 bg-amber-50 border border-amber-200 rounded-lg">
          <svg className="w-4 h-4 text-amber-600 mt-0.5 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
          </svg>
          <p className="text-xs text-amber-800">
            Fine-tuning needs densely annotated images. Every object in each training image should have a mask.
            Partially annotated images will teach the model to miss real cells.
          </p>
        </div>

        <button
          type="button"
          onClick={() => setShowAdvanced((v) => !v)}
          className="block text-sm text-purple-700 hover:text-purple-900 font-medium mb-4"
        >
          {showAdvanced ? 'Hide advanced parameters' : 'Show advanced parameters'}
        </button>

        {showAdvanced && (
          <div className="grid sm:grid-cols-3 gap-4 mb-4 p-4 bg-gray-50 rounded-lg border border-gray-200">
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">Epochs</label>
              <input
                type="number"
                min={1}
                value={nEpochs}
                onChange={(e) => setNEpochs(Number(e.target.value))}
                className="w-full px-2.5 py-1.5 border border-gray-300 rounded-md text-sm"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">Objects per batch</label>
              <input
                type="number"
                min={1}
                value={nObjectsPerBatch}
                onChange={(e) => setNObjectsPerBatch(Number(e.target.value))}
                className="w-full px-2.5 py-1.5 border border-gray-300 rounded-md text-sm"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">Patch size</label>
              <input
                type="number"
                min={64}
                step={64}
                value={patchSize}
                onChange={(e) => setPatchSize(Number(e.target.value))}
                className="w-full px-2.5 py-1.5 border border-gray-300 rounded-md text-sm"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">Batch size</label>
              <input
                type="number"
                min={1}
                value={batchSize}
                onChange={(e) => setBatchSize(Number(e.target.value))}
                className="w-full px-2.5 py-1.5 border border-gray-300 rounded-md text-sm"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">Learning rate</label>
              <input
                type="number"
                min={0}
                step={0.000001}
                value={learningRate}
                onChange={(e) => setLearningRate(Number(e.target.value))}
                className="w-full px-2.5 py-1.5 border border-gray-300 rounded-md text-sm"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">Val fraction (if no test split)</label>
              <input
                type="number"
                min={0}
                max={1}
                step={0.05}
                value={valFraction}
                onChange={(e) => setValFraction(Number(e.target.value))}
                className="w-full px-2.5 py-1.5 border border-gray-300 rounded-md text-sm"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">Samples per epoch (optional)</label>
              <input
                type="number"
                min={1}
                placeholder="Auto"
                value={nSamples}
                onChange={(e) => setNSamples(e.target.value === '' ? '' : Number(e.target.value))}
                className="w-full px-2.5 py-1.5 border border-gray-300 rounded-md text-sm"
              />
            </div>
          </div>
        )}

        {startError && (
          <div className="mb-4 px-3.5 py-2.5 bg-red-50 border border-red-200 rounded-lg text-sm text-red-700">
            {startError}
          </div>
        )}

        <button
          type="button"
          onClick={handleStart}
          disabled={isStarting || !selectedLabel}
          className="px-5 py-2.5 bg-gradient-to-r from-purple-600 to-pink-600 text-white rounded-lg hover:from-purple-700 hover:to-pink-700 text-sm font-medium shadow-sm transition-all disabled:opacity-50"
        >
          {isStarting ? 'Starting...' : 'Start fine-tuning'}
        </button>
      </div>

      {/* Sessions list */}
      <div className="bg-white rounded-2xl shadow-sm border border-gray-200 p-6">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-base font-semibold text-gray-900">Training sessions</h2>
          <button
            type="button"
            onClick={handleManualRefresh}
            disabled={sessionsLoading}
            className="text-sm text-purple-700 hover:text-purple-900 font-medium disabled:opacity-50"
          >
            {sessionsLoading ? 'Refreshing...' : 'Refresh'}
          </button>
        </div>

        {sessionsError && (
          <div className="mb-4 px-3.5 py-2.5 bg-red-50 border border-red-200 rounded-lg text-sm text-red-700">
            {sessionsError}
          </div>
        )}

        {sortedSessions.length === 0 && !sessionsLoading && (
          <p className="text-sm text-gray-500">No training sessions yet for this dataset.</p>
        )}

        <div className="space-y-3">
          {sortedSessions.map((s) => {
            const annotationLabel = s.label?.startsWith(`${artifactAlias}/`)
              ? s.label.slice(artifactAlias.length + 1)
              : s.label;
            const isRunning = !TERMINAL_STATUSES.includes(s.status);
            return (
              <div key={s.session_id} className="border border-gray-200 rounded-lg p-4">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium border ${STATUS_BADGE[s.status] || STATUS_BADGE.UNKNOWN}`}>
                        {s.status}
                      </span>
                      {s.model_type && <span className="text-xs text-gray-500">{s.model_type}</span>}
                      {annotationLabel && <span className="text-xs text-gray-500">label: {annotationLabel}</span>}
                      {s.checkpoint_available && (
                        <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-emerald-50 text-emerald-700 border border-emerald-200">
                          Checkpoint ready
                        </span>
                      )}
                    </div>
                    <div className="text-xs text-gray-500 mt-1 font-mono truncate" title={s.session_id}>
                      {s.session_id}
                    </div>
                    {s.message && <div className="text-xs text-gray-600 mt-1">{s.message}</div>}
                    <div className="text-xs text-gray-400 mt-1">
                      {s.created_at ? `Started ${formatUnixTime(s.created_at)}` : ''}
                      {s.elapsed_s != null ? ` · Elapsed ${formatElapsed(s.elapsed_s)}` : ''}
                    </div>
                  </div>
                  {isRunning && (
                    <div className="flex-shrink-0">
                      {confirmStopId === s.session_id ? (
                        <div className="flex items-center gap-1.5">
                          <span className="text-xs text-gray-500">Stop this run?</span>
                          <button
                            onClick={() => handleStop(s.session_id)}
                            disabled={stoppingSessionId === s.session_id}
                            className="px-2.5 py-1 bg-red-600 text-white rounded-md text-xs font-medium hover:bg-red-700 disabled:opacity-50"
                          >
                            {stoppingSessionId === s.session_id ? 'Stopping...' : 'Confirm'}
                          </button>
                          <button
                            onClick={() => setConfirmStopId(null)}
                            className="px-2.5 py-1 text-xs text-gray-500 hover:text-gray-700"
                          >
                            Cancel
                          </button>
                        </div>
                      ) : (
                        <button
                          onClick={() => setConfirmStopId(s.session_id)}
                          className="px-2.5 py-1 bg-white border border-gray-200 rounded-md text-xs font-medium text-gray-700 hover:border-red-300 hover:bg-red-50 hover:text-red-600 transition-colors"
                        >
                          Stop
                        </button>
                      )}
                    </div>
                  )}
                </div>
                {isRunning && (
                  <p className="text-xs text-gray-400 mt-2">
                    Stopping requests cancellation. An epoch already in progress may finish first.
                  </p>
                )}
                {s.checkpoint_available && annotationLabel && s.model_type && (
                  <div className="mt-3 pt-3 border-t border-gray-100">
                    <button
                      type="button"
                      onClick={() =>
                        navigate(
                          `/colab/annotate?${buildAnnotateQuery(artifactId, annotationLabel, undefined, undefined, {
                            sessionId: s.session_id,
                            modelType: s.model_type as string,
                          })}`,
                        )
                      }
                      className="px-3 py-1.5 bg-emerald-600 text-white rounded-md text-xs font-medium hover:bg-emerald-700 transition-colors"
                    >
                      Use for annotation
                    </button>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
};

export default Finetune;
