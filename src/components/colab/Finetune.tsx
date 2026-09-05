import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { buildAnnotateQuery } from './datasetApi';
import {
  BrokerAccessError,
  BrokerErrorCode,
  BrokerRole,
  DatasetWithRole,
  getDataset,
  getTrainingUrls,
  listSplits,
  setSplitCheckpoint,
  SplitSummary,
} from './brokerApi';
import { resolvePinnedTrainingService } from '../../utils/trainingServicePin';
import { useTrainingCapabilities } from '../../hooks/useTrainingCapabilities';
import {
  backendOfModel,
  buildTrainingModelOptions,
  defaultTrainingParams,
  trainingParamsFor,
  validateTrainingParams,
} from '../../utils/trainingModels';
import { resolveInitCheckpointUrl } from '../../utils/finetuneCheckpoints';
import LoginButton from '../LoginButton';
import ExportModelDialog from './ExportModelDialog';
import TrainingServicePicker from './TrainingServicePicker';

export interface FinetuneProps {
  artifactId: string;
  artifactAlias: string;
  server: any;
  user: any;
  artifactManager: any;
}

type TrainingStatusValue = 'PREPARING' | 'TRAINING' | 'COMPLETED' | 'FAILED' | 'STOPPED' | 'UNKNOWN';

export interface TrainingSessionStatus {
  session_id: string;
  status: TrainingStatusValue;
  message?: string;
  created_at?: number;
  model_type?: string;
  label?: string;
  n_train_inputs?: number;
  checkpoint_available: boolean;
  val_reused_train?: boolean;
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

export const Spinner: React.FC<{ className?: string }> = ({ className = 'w-8 h-8 text-purple-600' }) => (
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
// tracked per worker replica, not per artifact). Sessions started from the
// dataset's finetune view (DatasetOverview.tsx) are tagged
// `<alias>/<annotationLabel>`, so this page finds "this dataset's" sessions
// by prefix among everything else running on the same pinned worker.
const sessionTag = (alias: string, annotationLabel: string) => `${alias}/${annotationLabel}`;

export type ResolvedExportSplit = { split: SplitSummary; exact: boolean } | null;

/**
 * Pick the data split a finished run trained on, for the exported model's
 * provenance.
 *
 * A split records only its most recent run, and it records it when the run is
 * submitted rather than when it finishes. So the instant a second run starts,
 * nothing points back at the first one any more, and a run that is stopped or
 * fails leaves the split pointing at a session that has no checkpoint to
 * export. Attribution is therefore best-effort: fall back through
 * progressively weaker evidence, and treat "no idea" as a gap in provenance
 * rather than a reason to refuse the export.
 */
export const resolveExportSplit = (splits: SplitSummary[], sessionId: string): ResolvedExportSplit => {
  const current = splits.find((sp) => sp.checkpoint?.session_id === sessionId);
  if (current) return { split: current, exact: true };
  // Runs started after the history fix carry their predecessors along, so an
  // overwritten pointer is still recoverable.
  const historic = splits.find((sp) => {
    const history = sp.checkpoint?.session_history;
    return Array.isArray(history) && history.includes(sessionId);
  });
  if (historic) return { split: historic, exact: false };
  // A label almost always has exactly one split, in which case there is only
  // one thing the run can have trained on regardless of what the pointer says.
  if (splits.length === 1) return { split: splits[0], exact: false };
  return null;
};

// Step 2 of the fine-tuning flow. The dataset's finetune view (step 1) picks
// the split, the architecture and the checkpoint to start from, then hands
// those over in the query string. Everything about HOW to train lives here:
// the parameter form for the chosen backend, the start_training call, the
// progress monitoring and the export to a bioimage.io draft.
//
// The handover travels in the URL rather than in router state so a reload
// keeps the configuration and the link can be shared.
const Finetune: React.FC<FinetuneProps> = ({ artifactId, artifactAlias, server, user, artifactManager }) => {
  const navigate = useNavigate();

  const [dataset, setDataset] = useState<DatasetWithRole | null>(null);
  const [guardError, setGuardError] = useState<string | null>(null);
  const [guardErrorCode, setGuardErrorCode] = useState<BrokerErrorCode | null>(null);

  const [sessions, setSessions] = useState<Record<string, TrainingSessionStatus>>({});
  const [sessionsLoading, setSessionsLoading] = useState(false);
  const [sessionsError, setSessionsError] = useState<string | null>(null);
  const [stoppingSessionId, setStoppingSessionId] = useState<string | null>(null);
  const [confirmStopId, setConfirmStopId] = useState<string | null>(null);

  const [exportTarget, setExportTarget] = useState<{
    session: TrainingSessionStatus;
    annotationLabel: string;
    // Undefined when the run could not be attributed to a split. The export
    // still runs, it just carries no split name in its provenance.
    splitName?: string;
    // True only while the split still points at THIS run, which is the one
    // case where stamping the exported model onto it cannot clobber a newer
    // run's pointer.
    ownsSplitPointer: boolean;
    checkpoint: Record<string, any> | null;
  } | null>(null);
  const [resolvingExportSessionId, setResolvingExportSessionId] = useState<string | null>(null);

  // --- New run, configured from step 1's query string ---
  const [searchParams, setSearchParams] = useSearchParams();
  const pendingLabel = searchParams.get('label');
  const pendingSplit = searchParams.get('split');
  const pendingModelType = searchParams.get('model');
  const pendingResumeId = searchParams.get('resume');
  // An exported model to start from: the artifact holding it, the package
  // member with the weights, and whether that artifact is still an unpublished
  // draft. Set by the dataset's finetune view, see utils/finetuneCheckpoints.ts.
  const pendingInitArtifact = searchParams.get('initArtifact');
  const pendingInitFile = searchParams.get('initFile');
  const pendingInitStaged = searchParams.get('initStaged') === '1';
  const hasPendingRun = !!(pendingLabel && pendingSplit && pendingModelType);

  const { capabilities: trainingCapabilities } = useTrainingCapabilities(hasPendingRun ? server : null);
  // Which parameters start_training accepts depends on the backend the chosen
  // architecture belongs to: micro-sam takes n_objects_per_batch and
  // patch_size, Cellpose takes diam_mean, the rest are shared. The trainer
  // reports that mapping itself; utils/trainingModels.ts adapts it into form
  // fields and falls back to a static table on an older replica.
  const pendingBackend = pendingModelType
    ? backendOfModel(buildTrainingModelOptions(trainingCapabilities), pendingModelType)
    : undefined;
  const paramSpecs = trainingParamsFor(trainingCapabilities, pendingBackend);

  // Held as strings so a field can be cleared, which is how "let the backend
  // decide" is expressed for a parameter with no default. Empty fields are
  // dropped from the call rather than sent as zero.
  const [params, setParams] = useState<Record<string, string>>(() => defaultTrainingParams(paramSpecs));
  const [starting, setStarting] = useState(false);
  const [startError, setStartError] = useState<string | null>(null);
  const [showEmptyTestWarning, setShowEmptyTestWarning] = useState(false);

  // Capabilities land after the first render, so the real field list (and its
  // defaults, which the backend owns) arrives late. Reseed when the set of
  // fields changes, keeping anything the user already typed into a field that
  // survived the change.
  const paramSpecKey = paramSpecs.map((s) => s.name).join(',');
  useEffect(() => {
    setParams((prev) => {
      const seeded = defaultTrainingParams(paramSpecs);
      Object.keys(seeded).forEach((name) => {
        if (prev[name] !== undefined) seeded[name] = prev[name];
      });
      return seeded;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [paramSpecKey]);

  const handleStartTraining = async (skipEmptyTestWarning = false) => {
    if (!pendingLabel || !pendingSplit || !pendingModelType) return;
    setStartError(null);
    const parsed = validateTrainingParams(paramSpecs, params);
    if (parsed.error) {
      setStartError(parsed.error);
      return;
    }
    setStarting(true);
    try {
      const urls = await getTrainingUrls(server, artifactId, pendingLabel, pendingSplit);
      if (urls.train.length === 0) {
        setStartError(`Split "${pendingSplit}" has no training images yet.`);
        return;
      }
      if (!skipEmptyTestWarning && urls.test.length === 0) {
        setShowEmptyTestWarning(true);
        return;
      }
      setShowEmptyTestWarning(false);
      const call: any = {
        train_images: urls.train.map((e) => e.image_url),
        train_labels: urls.train.map((e) => e.geojson_url),
        model_type: pendingModelType,
        label: sessionTag(artifactAlias, pendingLabel),
        // Only what this backend accepts. Passing a foreign parameter is
        // rejected outright, so the filtering paramSpecs did is what keeps one
        // form usable for both backends.
        ...parsed.values,
        _rkwargs: true,
      };
      if (urls.test.length > 0) {
        call.val_images = urls.test.map((e) => e.image_url);
        call.val_labels = urls.test.map((e) => e.geojson_url);
      }
      // Resuming is replica-local by construction, which is fine because every
      // call on this page goes through the same pin.
      if (pendingResumeId) call.resume_session_id = pendingResumeId;
      // Starting from an exported model instead: sign a download URL for the
      // weights here, with the user's own token, and hand the worker only the
      // URL. Mutually exclusive with resume_session_id, which step 1 enforces
      // by offering the two as separate sources.
      if (!pendingResumeId && pendingInitArtifact && pendingInitFile) {
        call.init_checkpoint = await resolveInitCheckpointUrl(artifactManager, {
          artifactId: pendingInitArtifact,
          name: pendingInitArtifact,
          modelType: pendingModelType,
          checkpointFile: pendingInitFile,
          staged: pendingInitStaged,
        });
      }

      const svc = await resolvePinnedTrainingService(server);
      const status = await svc.start_training(call);
      // The split holds one pointer, so starting this run displaces whatever
      // ran before it. Carry the displaced session along, otherwise every
      // earlier run on this split loses the only link back to the data it was
      // trained on (see resolveExportSplit).
      const prior = urls.split?.checkpoint;
      const priorHistory: string[] = Array.isArray(prior?.session_history) ? prior!.session_history : [];
      const history =
        prior?.session_id && !priorHistory.includes(prior.session_id)
          ? [...priorHistory, prior.session_id]
          : priorHistory;
      await setSplitCheckpoint(server, artifactId, pendingLabel, pendingSplit, {
        session_id: status.session_id,
        model_type: pendingModelType,
        // Bounded so a split that is retrained many times cannot grow its
        // record without limit.
        ...(history.length > 0 ? { session_history: history.slice(-50) } : {}),
      });
      // Drop the handover parameters so a reload does not offer to start the
      // same run a second time.
      setSearchParams({}, { replace: true });
      await refreshSessions();
    } catch (err) {
      setStartError((err as Error).message || 'Failed to start training.');
    } finally {
      setStarting(false);
    }
  };

  const handleOpenExport = async (s: TrainingSessionStatus, annotationLabel: string) => {
    setResolvingExportSessionId(s.session_id);
    let resolved: ResolvedExportSplit = null;
    try {
      const splits = await listSplits(server, artifactId, annotationLabel);
      resolved = resolveExportSplit(splits, s.session_id);
    } catch (err) {
      // Attribution is provenance, not a precondition. A broker hiccup here
      // must not cost the user a finished checkpoint.
      console.error('resolveExportSplit: listSplits failed', err);
    } finally {
      setResolvingExportSessionId(null);
    }
    setExportTarget({
      session: s,
      annotationLabel,
      splitName: resolved?.split.name,
      ownsSplitPointer: !!resolved?.exact,
      checkpoint: resolved?.split.checkpoint ?? null,
    });
  };

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

  // --- Sessions list, polled while any tracked session is non-terminal ---
  const refreshSessions = useCallback(async (): Promise<Record<string, TrainingSessionStatus>> => {
    const svc = await resolvePinnedTrainingService(server);
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

  const handleStop = async (sessionId: string) => {
    setConfirmStopId(null);
    setStoppingSessionId(sessionId);
    try {
      const svc = await resolvePinnedTrainingService(server);
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
          <h1 className="text-xl font-semibold text-gray-900">Fine-tune a model</h1>
          <p className="text-sm text-gray-500">{dataset.name || artifactAlias}</p>
        </div>
      </div>

      {!hasPendingRun && (
        <p className="text-sm text-gray-500 mb-6">
          Pick a split and a starting model in the dataset's finetune view to set up a new run. This page
          tracks progress and lets you use a finished checkpoint for annotation.
        </p>
      )}

      {hasPendingRun && (
        <div className="bg-white rounded-2xl shadow-sm border border-gray-200 p-6 mb-6">
          <h2 className="text-base font-semibold text-gray-900 mb-1">New training run</h2>
          <p className="text-sm text-gray-500 mb-4">
            Split <span className="font-medium text-gray-700">{pendingSplit}</span> of label{' '}
            <span className="font-medium text-gray-700">{pendingLabel}</span>, training{' '}
            <span className="font-medium text-gray-700">{pendingModelType}</span>
            {pendingResumeId ? (
              <>
                {' '}from the checkpoint of run{' '}
                <span className="font-mono text-gray-700">{pendingResumeId.slice(0, 8)}</span>
              </>
            ) : pendingInitArtifact ? (
              <>
                {' '}from the weights in{' '}
                <span className="font-mono text-gray-700">{pendingInitArtifact.split('/').pop()}</span>
              </>
            ) : (
              ' from its base weights'
            )}
            .
          </p>

          <div className="grid grid-cols-2 gap-3 mb-4">
            {paramSpecs.map((spec) => (
              <label key={spec.name} className="text-xs text-gray-500">
                {spec.label}
                <input
                  type="number"
                  step={spec.step}
                  min={spec.min ?? undefined}
                  max={spec.max ?? undefined}
                  value={params[spec.name] ?? ''}
                  placeholder={spec.default == null ? 'auto' : undefined}
                  onChange={(e) => setParams((prev) => ({ ...prev, [spec.name]: e.target.value }))}
                  className="mt-0.5 w-full px-2 py-1 text-sm border border-gray-300 rounded-lg focus:outline-none focus:border-purple-300"
                />
                {spec.help && <span className="block mt-0.5 text-[0.65rem] text-gray-400">{spec.help}</span>}
              </label>
            ))}
          </div>

          <TrainingServicePicker className="mb-4" />

          {startError && (
            <div className="mb-3 px-3.5 py-2.5 bg-red-50 border border-red-200 rounded-lg text-sm text-red-700">
              {startError}
            </div>
          )}

          <div className="flex items-center gap-2">
            <button
              onClick={() => handleStartTraining()}
              disabled={starting}
              className="px-4 py-2 bg-gradient-to-r from-emerald-600 to-teal-600 text-white rounded-lg hover:from-emerald-700 hover:to-teal-700 text-sm font-medium shadow-sm transition-all disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
            >
              {starting && <Spinner className="w-4 h-4 text-white" />}
              Start training
            </button>
            <button
              onClick={() => setSearchParams({}, { replace: true })}
              disabled={starting}
              className="px-3.5 py-2 text-sm font-medium text-gray-500 hover:text-gray-700 transition-colors disabled:opacity-50"
            >
              Discard
            </button>
          </div>
        </div>
      )}

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
                    {s.val_reused_train && (
                      <div className="text-xs text-amber-600 mt-1">Validation reused the training image(s).</div>
                    )}
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
                  <div className="mt-3 pt-3 border-t border-gray-100 flex items-center gap-2 flex-wrap">
                    <button
                      type="button"
                      onClick={() =>
                        navigate(
                          `/colab/annotate?${buildAnnotateQuery(artifactId, annotationLabel, undefined, {
                            sessionId: s.session_id,
                            modelType: s.model_type as string,
                          })}`,
                        )
                      }
                      className="px-3 py-1.5 bg-emerald-600 text-white rounded-md text-xs font-medium hover:bg-emerald-700 transition-colors"
                    >
                      Use for annotation
                    </button>
                    {s.status === 'COMPLETED' && (
                      <button
                        type="button"
                        onClick={() => handleOpenExport(s, annotationLabel)}
                        disabled={resolvingExportSessionId === s.session_id}
                        className="px-3 py-1.5 bg-white border border-gray-200 rounded-md text-xs font-medium text-gray-700 hover:border-purple-300 hover:bg-purple-50 hover:text-purple-700 transition-colors disabled:opacity-50"
                      >
                        {resolvingExportSessionId === s.session_id ? 'Resolving split...' : 'Export as model'}
                      </button>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>
      {showEmptyTestWarning && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-50 animate-fadeIn p-4">
          <div className="bg-white rounded-2xl shadow-lg max-w-sm w-full border border-gray-100">
            <div className="p-6">
              <h3 className="text-base font-semibold text-gray-900 mb-1">Test split is empty</h3>
              <p className="text-sm text-gray-500">
                Training will fall back to an internal validation slice instead of your held-out images.
                Start anyway?
              </p>
            </div>
            <div className="px-6 py-4 border-t border-gray-100 flex justify-end gap-2">
              <button
                onClick={() => setShowEmptyTestWarning(false)}
                className="px-3.5 py-2 text-sm font-medium text-gray-500 hover:text-gray-700 transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={() => handleStartTraining(true)}
                className="px-3.5 py-2 bg-gradient-to-r from-emerald-600 to-teal-600 text-white rounded-lg hover:from-emerald-700 hover:to-teal-700 text-sm font-medium shadow-sm transition-all"
              >
                Start anyway
              </button>
            </div>
          </div>
        </div>
      )}
      {exportTarget && (
        <ExportModelDialog
          open
          onClose={() => setExportTarget(null)}
          server={server}
          artifactManager={artifactManager}
          user={user}
          datasetArtifactId={artifactId}
          annotationLabel={exportTarget.annotationLabel}
          session={exportTarget.session}
          splitName={exportTarget.splitName}
          onExported={async (exportedModelId) => {
            // Only stamp the export onto the split while the split still
            // points at this run. Once a newer run owns the pointer, writing
            // here would redirect step 1's "start from the previous run"
            // default back onto the older session.
            if (!exportTarget.splitName || !exportTarget.ownsSplitPointer) return;
            await setSplitCheckpoint(server, artifactId, exportTarget.annotationLabel, exportTarget.splitName, {
              ...(exportTarget.checkpoint || {}),
              session_id: exportTarget.session.session_id,
              model_type: exportTarget.session.model_type || exportTarget.checkpoint?.model_type || '',
              exported_model_id: exportedModelId,
            });
          }}
        />
      )}
    </div>
  );
};

export default Finetune;
