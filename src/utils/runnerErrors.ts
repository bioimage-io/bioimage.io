/**
 * Shared handling for the transient "GPU runtime is still starting" condition
 * the model-runner reports from its GPU methods (infer / test / validate).
 *
 * The backend calls an internal `_check_runtime_available()` guard at the top of
 * every GPU method and raises a RuntimeError whose message contains
 * {@link RUNTIME_STARTING_MARKER} when the runtime deployment has not finished
 * starting yet — expected right after the model-runner app is updated. The UI
 * translates this into the friendly {@link RUNTIME_STARTING_MESSAGE} instead of
 * surfacing the raw traceback.
 */

/** Substring present in the runner's error when the GPU runtime is not ready. */
export const RUNTIME_STARTING_MARKER = 'GPU runtime deployment is not available';

/** Friendly, non-alarming copy for the runtime-still-starting condition. */
export const RUNTIME_STARTING_MESSAGE =
  'The BioEngine is still starting up and will be available shortly. This is ' +
  'expected right after the model runner was updated. Please try again in a moment.';

/** True when an error (or error string) is the transient runtime-not-ready one. */
export const isRuntimeStartingError = (error: unknown): boolean => {
  const msg = error instanceof Error ? error.message : String(error);
  return msg.includes(RUNTIME_STARTING_MARKER);
};
