import { useEffect } from 'react';
import { useHyphaStore } from '../store/hyphaStore';

// Read the cached login token honoring its expiry, mirroring hyphaStore's
// getSavedToken. Used only to decide whether a live session even exists.
const hasValidToken = (): boolean => {
  const token = localStorage.getItem('token');
  if (!token) return false;
  const expiry = localStorage.getItem('tokenExpiry');
  return !!(expiry && new Date(expiry) > new Date());
};

// Active liveness probe. `isConnected` can go stale-true after hypha-rpc's own
// background-tab auto-reconnect quietly gives up, so a boolean check isn't
// enough: we actually round-trip a ping to the manager with a short timeout.
// Returns false on any failure (dead socket, timeout, missing internals).
const isServerAlive = async (server: any): Promise<boolean> => {
  try {
    const rpc = server?.rpc;
    if (!rpc || typeof rpc.ping !== 'function') return false;
    const conn = rpc._connection;
    // Fast-fail if the underlying socket is already closed/closing.
    const ws = conn?._websocket;
    if (ws && ws.readyState !== 1 /* WebSocket.OPEN */) return false;
    const target = conn?.manager_id;
    if (!target) return false;
    // ping asserts a "pong" round-trip; throws on timeout or dead socket.
    await rpc.ping(target, 2);
    return true;
  } catch {
    return false;
  }
};

/**
 * Proactively recover the Hypha connection using window/document events only
 * (no polling heartbeat). Browsers throttle hypha-rpc's token-refresh timer in
 * backgrounded tabs, so a long-idle tab often wakes with a dead socket while the
 * store still reads connected. When the tab returns to the foreground or the
 * network comes back, we probe the live connection and reconnect if it's dead.
 *
 * Mount once, high in the tree (App). No-ops entirely when logged out.
 */
export function useConnectionLiveness(): void {
  useEffect(() => {
    let checking = false;

    const checkAndRecover = async () => {
      // A live session requires a still-valid token. If it expired, the normal
      // logout path owns the transition; don't fight it here.
      if (!hasValidToken()) return;

      const { server, isConnected, connectionStatus, attemptReconnect } =
        useHyphaStore.getState();

      // Already recovering: let the in-flight reconnect finish.
      if (connectionStatus === 'reconnecting') return;

      // Coalesce overlapping triggers (visibilitychange + online can fire
      // together) into a single probe.
      if (checking) return;
      checking = true;
      try {
        const alive = server ? await isServerAlive(server) : false;
        if (!alive || !isConnected) {
          await attemptReconnect();
        }
      } finally {
        checking = false;
      }
    };

    const onVisibility = () => {
      if (document.visibilityState === 'visible') void checkAndRecover();
    };
    const onOnline = () => {
      void checkAndRecover();
    };

    document.addEventListener('visibilitychange', onVisibility);
    window.addEventListener('online', onOnline);

    return () => {
      document.removeEventListener('visibilitychange', onVisibility);
      window.removeEventListener('online', onOnline);
    };
  }, []);
}

export default useConnectionLiveness;
