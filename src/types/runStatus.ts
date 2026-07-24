// Shape of the per-step status the model-runner returns from get_test_status and
// get_infer_status (v1.15.23+). Each stage carries execution start/end (unix
// seconds) and, where the step can be queued, a queue position. queue_position:
// N = N jobs ahead, 0 = running now, null = not currently in this step.

export interface StageInfo {
  start: number | null;
  end: number | null;
  /** Absent for model_download (never queued); null when not in this step. */
  queue_position?: number | null;
}

export interface RunnerStages {
  model_download?: StageInfo | null;
  env_setup?: StageInfo | null; // always null on the infer path (no conda build)
  run?: StageInfo | null;
}

export interface ResolvedStep {
  startTs: number | null;
  endTs: number | null;
  queuePosition: number | null;
}

/**
 * Resolve a StepTimeline step's fields from a runner stage. Falls back to a flat
 * legacy timestamp (older runners that expose only `model_download`/`env_setup`/
 * `running` scalars and no `stages` object) so the timeline still renders.
 */
export const resolveStage = (
  stage: StageInfo | null | undefined,
  flatStart?: number | null,
): ResolvedStep => ({
  startTs: stage ? stage.start : (flatStart ?? null),
  endTs: stage ? stage.end : null,
  queuePosition: stage ? (stage.queue_position ?? null) : null,
});
