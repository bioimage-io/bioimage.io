import { HYPHA_SERVER_URL } from '../../config/hypha';

/**
 * Finding the BioEngine workers registered in a workspace.
 *
 * Extracted from `BioEngineWorkerList` when the apps page needed the same
 * lookup: it discovers workers first, then asks each one what it has deployed.
 * The awkward part is the multi-worker case, which Hypha surfaces as an error
 * rather than a list, so it is worth having exactly one implementation of it.
 */

export type DiscoveredWorker = {
  id: string;
  name: string;
  description: string;
};

/**
 * Pull every service id out of Hypha's "Multiple services found" error.
 *
 * Asking for an unqualified `<workspace>/bioengine-worker` when several workers
 * are registered is an error, not a result — but the error text enumerates
 * them, which is the only way to see them all without workspace-wide list
 * permission.
 */
export const parseMultipleServicesFromError = (errStr: string): string[] => {
  const regex = /services:public\|bioengine-worker:([^@']+)@\*/g;
  const ids: string[] = [];
  let match;
  while ((match = regex.exec(errStr)) !== null) {
    if (!ids.includes(match[1])) ids.push(match[1]);
  }
  return ids;
};

/**
 * Discover the workers in one workspace.
 *
 * Own workspace: enumerate directly. Any other workspace: probe the short id
 * and fall back to parsing the multi-service error. Returns an empty array
 * rather than throwing when a workspace simply has no worker, since callers
 * fan this out over several workspaces and one empty result is normal.
 */
export async function discoverWorkers(
  server: any,
  workspace: string,
  opts: { isLoggedIn: boolean; userWorkspace?: string },
): Promise<DiscoveredWorker[]> {
  if (!server) return [];

  if (opts.isLoggedIn && workspace === opts.userWorkspace) {
    const list = await server.listServices({ type: 'bioengine-worker' });
    return list.map((s: any) => ({
      id: s.id,
      name: s.name || s.id,
      description: s.description || '',
    }));
  }

  try {
    const svc = await server.getService(`${workspace}/bioengine-worker`);
    return [{ id: svc.id, name: svc.name || svc.id, description: svc.description || '' }];
  } catch (err) {
    const errStr = String(err);
    if (!errStr.includes('Multiple services found')) return [];
    const ids = parseMultipleServicesFromError(errStr);
    const results = await Promise.allSettled(ids.map(id => server.getService(id)));
    return results.map((result, i) => {
      if (result.status === 'fulfilled') {
        const s: any = result.value;
        return { id: s.id || ids[i], name: s.name || ids[i], description: s.description || '' };
      }
      return { id: ids[i], name: ids[i], description: '' };
    });
  }
}

export type DeployedApp = {
  /** `<workspace>/<application_id>` — the unqualified form, which resolves to
   *  whichever worker is serving the app. The default display form. */
  shortId: string;
  /** `<workspace>/<client-id>:<app-id>` — one exact deployment.
   *
   *  The client id is per DEPLOYMENT, not per worker: each app on a worker gets
   *  its own `<worker-pod>-<hash>` client. So this is normally 1:1 with the
   *  short id, and only multiplies when the same app id is deployed on more
   *  than one worker. */
  fullId: string;
  appId: string;
  workspace: string;
  workerId: string;
  status?: string;
};

/**
 * Ask one worker what it currently has deployed.
 *
 * `get_app_status` is keyed by application id; the full service id lives at
 * `service_ids.websocket_service_id`. When a worker has not reported one yet
 * the entry is skipped rather than guessed, so the prompt never carries an id
 * that would not resolve.
 */
export async function fetchWorkerApps(
  server: any,
  workerId: string,
  workspace: string,
): Promise<DeployedApp[]> {
  const worker = await server.getService(workerId, { mode: 'random' });
  const status = await worker.get_app_status({ _rkwargs: true });
  if (!status || typeof status !== 'object') return [];

  const apps: DeployedApp[] = [];
  for (const [appId, raw] of Object.entries(status)) {
    if (!raw || typeof raw !== 'object') continue;
    const app = raw as any;
    const fullId: string | undefined = app.service_ids?.websocket_service_id;
    if (!fullId) continue;
    apps.push({
      shortId: `${workspace}/${appId}`,
      fullId,
      appId,
      workspace,
      workerId,
      status: app.status,
    });
  }
  return apps;
}


// ---------------------------------------------------------------------------
// Anonymous (HTTP) discovery
// ---------------------------------------------------------------------------
//
// Browsing public apps must not require signing in. The Hypha store
// deliberately refuses to open an anonymous WEBSOCKET — see the comment in
// `hyphaStore.reconnect`: it would leave the user "connected but logged out"
// with a dead Login button. Hypha also exposes every service method over plain
// HTTP though, which needs no session at all, so the logged-out path uses that
// instead. Same data, no socket, no effect on login state.

const httpJson = async (url: string, signal?: AbortSignal): Promise<any> => {
  const res = await fetch(url, { signal });
  if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
  return res.json();
};

/** Workers in a workspace, without a session. */
export async function discoverWorkersHttp(
  workspace: string,
  signal?: AbortSignal,
): Promise<DiscoveredWorker[]> {
  const list = await httpJson(
    `${HYPHA_SERVER_URL}/public/services/ws/list_services?query=${encodeURIComponent(workspace)}`,
    signal,
  );
  if (!Array.isArray(list)) return [];
  return list
    // Match the workspace exactly: `query` is a search, so a workspace whose
    // name is a prefix of another would otherwise leak its workers in here.
    .filter((s: any) => s?.type === 'bioengine-worker' && String(s.id || '').startsWith(`${workspace}/`))
    .map((s: any) => ({ id: s.id, name: s.name || s.id, description: s.description || '' }));
}

/** Apps deployed on one worker, without a session. */
export async function fetchWorkerAppsHttp(
  workerId: string,
  workspace: string,
  signal?: AbortSignal,
): Promise<DeployedApp[]> {
  // `workspace/rest` -> the HTTP route is /<workspace>/services/<rest>/<method>
  const rest = workerId.slice(workerId.indexOf('/') + 1);
  const status = await httpJson(
    `${HYPHA_SERVER_URL}/${workspace}/services/${rest}/get_app_status`,
    signal,
  );
  if (!status || typeof status !== 'object') return [];

  const apps: DeployedApp[] = [];
  for (const [appId, raw] of Object.entries(status)) {
    if (!raw || typeof raw !== 'object') continue;
    const app = raw as any;
    const fullId: string | undefined = app.service_ids?.websocket_service_id;
    if (!fullId) continue;
    apps.push({ shortId: `${workspace}/${appId}`, fullId, appId, workspace, workerId, status: app.status });
  }
  return apps;
}
