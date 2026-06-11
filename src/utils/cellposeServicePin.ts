/**
 * Resolves the ``bioimage-io/cellpose-finetuning`` service, pinning a
 * specific worker replica for the duration of the browser session.
 *
 * Why pinning matters
 * -------------------
 * cellpose-finetuning persists per-session state to the *replica's* local
 * disk: trained model weights, training history, intermediate
 * checkpoints. With ``mode: 'random'`` (or even ``'last'``) the next call
 * may resolve a different replica that has none of that state. Symptoms:
 * - ``start_training`` succeeds on worker A; ``get_training_status``
 *   randomly hits worker B and reports "session not found".
 * - The trained model that lives on worker A is invisible to inference
 *   calls that resolve worker B.
 *
 * Pinning behaviour
 * -----------------
 * On the first call of a tab, we resolve via ``mode: 'random'`` and stash
 * the returned service id (e.g.
 * ``bioimage-io/bioengine-worker-denbi-…/cellpose-finetuning``) in
 * ``sessionStorage``. Every subsequent call re-fetches *that exact id* so
 * Hypha lands the request on the same replica. If the pinned replica has
 * disappeared (Ray Serve roll, worker eviction, etc.), the second call
 * throws — we clear the pin and resolve a fresh random replica.
 *
 * The session-level scope (``sessionStorage``) is intentional:
 * - Long-running training and its polling stay on the same replica even
 *   across page navigations.
 * - Each new tab gets its own pin, so users running parallel work see
 *   independent load-balancing.
 * - The pin clears when the tab closes; nothing leaks into future sessions
 *   that might span a worker rollout.
 */
const STORAGE_KEY = 'bioimage_pinned_cellpose_service_id';

/** Pure read helper, exported for diagnostics / tests. */
export function getPinnedCellposeServiceId(): string | null {
  try {
    return window.sessionStorage.getItem(STORAGE_KEY);
  } catch {
    return null;
  }
}

function setPinnedCellposeServiceId(id: string): void {
  try {
    window.sessionStorage.setItem(STORAGE_KEY, id);
  } catch {
    // sessionStorage unavailable (private mode, embedded contexts).
    // We continue without persistence; the in-flight call still works,
    // but pinning won't survive across page navigations.
  }
}

function clearPinnedCellposeServiceId(): void {
  try {
    window.sessionStorage.removeItem(STORAGE_KEY);
  } catch {
    // ignore
  }
}

/**
 * Resolve a cellpose-finetuning service handle, pinning the worker
 * replica for the rest of this tab's session. Hypha service handles can
 * expire mid-session, so callers should call this *per RPC* rather than
 * caching the returned handle.
 *
 * @param server  An already-connected hypha-rpc server proxy.
 * @returns       The remote service proxy from ``server.getService``.
 * @throws        Re-throws the underlying ``getService`` error when no
 *                replica can be found.
 */
export async function resolvePinnedCellposeService(server: any): Promise<any> {
  if (!server || typeof server.getService !== 'function') {
    throw new Error('resolvePinnedCellposeService: invalid server proxy');
  }
  const pinned = getPinnedCellposeServiceId();
  if (pinned) {
    try {
      const svc = await server.getService(pinned);
      return svc;
    } catch (err) {
      // The replica id we had is gone (worker rolled, deployment moved).
      // Clear the pin and re-resolve below.
      console.warn(
        '[resolvePinnedCellposeService] Pinned id no longer reachable, re-resolving:',
        (err as Error)?.message || err,
      );
      clearPinnedCellposeServiceId();
    }
  }
  // First call of the tab, or the previous pin disappeared — let Hypha
  // pick a replica and remember which one.
  const svc = await server.getService('bioimage-io/cellpose-finetuning', { mode: 'random' });
  const id = (svc && (svc as any).id) as string | undefined;
  if (id) {
    setPinnedCellposeServiceId(id);
    console.log('[resolvePinnedCellposeService] Pinned cellpose-finetuning replica:', id);
  }
  return svc;
}
