import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useHyphaStore } from '../../store/hyphaStore';
import BioEnginePageHeader from './BioEnginePageHeader';

/**
 * `/bioengine/token` — generate a Hypha token from a link.
 *
 * Exists because an agent that cannot run Python has no way to help a user
 * obtain a token: the documented flow (`references/hypha_setup.md`) calls
 * `hypha_rpc.login()`, which assumes the agent has an interpreter and the
 * package installed. Such an agent can instead hand the user a pre-configured
 * URL and ask them to paste `HYPHA_TOKEN=…` back.
 *
 *   /#/bioengine/token?workspace=my-ws&permission=read_write&expires-in=3600
 *
 * Parameter names are accepted in both the short form above and the longer
 * `permission-level` / `expiry-time` spellings, because an agent writing the
 * link from memory will reach for either.
 */

const PERMISSIONS = ['read', 'read_write', 'admin'] as const;
type Permission = (typeof PERMISSIONS)[number];

const UNITS = { hours: 3600, days: 86400 } as const;
type Unit = keyof typeof UNITS;

const DEFAULT_PERMISSION: Permission = 'read_write';
const DEFAULT_EXPIRES = 3600;
const MAX_EXPIRES = 365 * 24 * 3600;

/**
 * Split a duration into a round number plus the largest unit that divides it.
 *
 * A link may carry any number of seconds, so the control has to be able to
 * show 36 hours as well as 1 day without rounding the value away.
 */
const splitDuration = (seconds: number): { value: number; unit: Unit } =>
  seconds % UNITS.days === 0
    ? { value: seconds / UNITS.days, unit: 'days' }
    : { value: Math.max(1, Math.round(seconds / UNITS.hours)), unit: 'hours' };

/** First parameter present wins, so both spellings work. */
const readParam = (params: URLSearchParams, ...names: string[]): string | null => {
  for (const n of names) {
    const v = params.get(n);
    if (v !== null && v.trim() !== '') return v.trim();
  }
  return null;
};

const parsePermission = (raw: string | null): Permission => {
  const v = (raw || '').toLowerCase().replace(/-/g, '_');
  return (PERMISSIONS as readonly string[]).includes(v) ? (v as Permission) : DEFAULT_PERMISSION;
};

/** Seconds, clamped to something a server will accept. Junk falls back. */
const parseExpires = (raw: string | null): number => {
  const n = Number.parseInt(raw || '', 10);
  if (!Number.isFinite(n) || n <= 0) return DEFAULT_EXPIRES;
  return Math.min(n, MAX_EXPIRES);
};

const describeLifetime = (seconds: number): string => {
  const { value, unit } = splitDuration(seconds);
  return `${value} ${value === 1 ? unit.slice(0, -1) : unit}`;
};

const BioEngineTokenPage: React.FC = () => {
  const [searchParams, setSearchParams] = useSearchParams();
  const { server, isLoggedIn } = useHyphaStore();
  const ownWorkspace = (server?.config?.workspace as string | undefined) || '';

  const requested = useMemo(() => ({
    workspace: readParam(searchParams, 'workspace', 'ws'),
    permission: parsePermission(readParam(searchParams, 'permission', 'permission-level', 'permission_level')),
    expiresIn: parseExpires(readParam(searchParams, 'expires-in', 'expires_in', 'expiry-time', 'expiry_time')),
  }), [searchParams]);

  const [workspace, setWorkspace] = useState(requested.workspace ?? '');
  const [permission, setPermission] = useState<Permission>(requested.permission);
  const initialDuration = useMemo(() => splitDuration(requested.expiresIn), [requested.expiresIn]);
  const [durationValue, setDurationValue] = useState(initialDuration.value);
  const [durationUnit, setDurationUnit] = useState<Unit>(initialDuration.unit);

  const expiresIn = Math.min(Math.max(1, durationValue) * UNITS[durationUnit], MAX_EXPIRES);

  const [token, setToken] = useState('');
  const [isGenerating, setIsGenerating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  // Blank means "my own workspace", which is what generate_token does when no
  // workspace is passed. Naming one you have no rights in is a PermissionError
  // from the server, surfaced as-is rather than dressed up: it is the honest
  // answer and tells the user exactly which workspace to ask for access to.
  const effectiveWorkspace = workspace.trim() || ownWorkspace;

  const generate = useCallback(async () => {
    if (!isLoggedIn || !server) return;
    setIsGenerating(true);
    setError(null);
    setToken('');
    try {
      const config: Record<string, unknown> = { permission, expires_in: expiresIn };
      if (workspace.trim() && workspace.trim() !== ownWorkspace) config.workspace = workspace.trim();
      setToken(await server.generateToken(config));
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setIsGenerating(false);
    }
  }, [isLoggedIn, server, permission, expiresIn, workspace, ownWorkspace]);

  // Settings -> URL, so the link in the address bar always matches the form and
  // can be copied and handed on. `replace` keeps typing in a field out of the
  // back-button history; `preventScrollReset` stops each keystroke jumping the
  // page to the top.
  useEffect(() => {
    setSearchParams(prev => {
      const params = new URLSearchParams(prev);
      // One canonical spelling is written back, even though several are
      // accepted on the way in, so the URL does not accumulate synonyms.
      params.delete('ws');
      params.delete('permission-level');
      params.delete('permission_level');
      params.delete('expires_in');
      params.delete('expiry-time');
      params.delete('expiry_time');

      if (workspace.trim()) params.set('workspace', workspace.trim());
      else params.delete('workspace');
      params.set('permission', permission);
      params.set('expires-in', String(expiresIn));
      return params;
    }, { replace: true, preventScrollReset: true });
  }, [workspace, permission, expiresIn, setSearchParams]);

  const line = token ? `HYPHA_TOKEN=${token}` : '';

  const copy = async () => {
    if (!line) return;
    try {
      await navigator.clipboard.writeText(line);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch (_) {
      /* clipboard denied; the value is selectable on screen */
    }
  };

  return (
    <div className="max-w-[1400px] mx-auto px-4 py-8">
      <BioEnginePageHeader backTo="/bioengine" />

      <div className="max-w-3xl mx-auto space-y-6">
        <div className="p-5 bg-blue-50 rounded-xl border border-blue-200">
          <p className="text-sm text-blue-800">
            Generate a Hypha token, then paste the whole <code className="font-mono">HYPHA_TOKEN=…</code> line
            back to whoever asked for it. An AI agent can send you a link with the workspace, permission and
            lifetime already filled in, so you only need to press Generate and Copy.
          </p>
        </div>

        <div className="bg-white/80 backdrop-blur-sm rounded-2xl shadow-sm border border-white/20 p-6 space-y-5">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Workspace</label>
            <input
              type="text"
              value={workspace}
              onChange={e => setWorkspace(e.target.value)}
              placeholder={ownWorkspace || 'your workspace'}
              className="w-full px-3 py-2 border border-gray-200 rounded-lg font-mono text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
            <p className="mt-1 text-xs text-gray-500">
              Leave blank for your own workspace{ownWorkspace ? ` (${ownWorkspace})` : ''}. You can only mint a
              token for a workspace you already have permission in.
            </p>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Permission</label>
              <select
                value={permission}
                onChange={e => setPermission(e.target.value as Permission)}
                className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              >
                {PERMISSIONS.map(p => <option key={p} value={p}>{p}</option>)}
              </select>
              <p className="mt-1 text-xs text-gray-500">
                {permission === 'admin'
                  ? 'Full control, including changing permissions. Only needed to register a new worker.'
                  : permission === 'read_write'
                    ? 'Read and write artifacts. Enough to deploy and manage apps.'
                    : 'Read only.'}
              </p>
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Valid for</label>
              <div className="flex gap-2">
                <input
                  type="number"
                  min={1}
                  value={durationValue}
                  onChange={e => setDurationValue(Math.max(1, Number(e.target.value) || 1))}
                  aria-label="Token lifetime"
                  className="w-24 px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
                <select
                  value={durationUnit}
                  onChange={e => setDurationUnit(e.target.value as Unit)}
                  aria-label="Token lifetime unit"
                  className="flex-1 px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                >
                  <option value="hours">hours</option>
                  <option value="days">days</option>
                </select>
              </div>
              <p className="mt-1 text-xs text-gray-500">Shorter is safer. The clock starts when you press Generate.</p>
            </div>
          </div>

          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={generate}
              disabled={!isLoggedIn || isGenerating}
              className="px-5 py-2.5 bg-gradient-to-r from-blue-600 to-blue-700 text-white text-sm font-semibold rounded-xl hover:from-blue-700 hover:to-blue-800 disabled:opacity-50 disabled:cursor-not-allowed transition-all"
            >
              {isGenerating ? 'Generating...' : token ? 'Generate a new token' : 'Generate token'}
            </button>
            {!isLoggedIn && <span className="text-sm text-gray-500">Log in to generate a token.</span>}
            {isLoggedIn && !token && !error && (
              <span className="text-sm text-gray-500">
                For <span className="font-mono">{effectiveWorkspace || 'your workspace'}</span>, {permission},{' '}
                {describeLifetime(expiresIn)}.
              </span>
            )}
          </div>

          {error && (
            <div className="p-3 bg-red-50 border border-red-200 rounded-lg">
              <p className="text-xs text-red-800 break-words">{error}</p>
            </div>
          )}

          {token && (
            <div className="p-4 bg-gray-50 rounded-xl border border-gray-200">
              <div className="flex items-center justify-between mb-2">
                <h5 className="text-sm font-semibold text-gray-800">
                  Token for <span className="font-mono">{effectiveWorkspace}</span>
                </h5>
                <button
                  type="button"
                  onClick={copy}
                  className="flex items-center px-2 py-1 text-xs text-gray-600 bg-white border border-gray-200 rounded hover:bg-gray-100"
                >
                  {copied ? 'Copied!' : 'Copy'}
                </button>
              </div>
              <p className="text-xs text-gray-700 mb-2">
                Paste this whole line back. It is valid for {describeLifetime(expiresIn)} and grants{' '}
                <span className="font-semibold">{permission}</span>. Treat it like a password.
              </p>
              <pre className="bg-white border border-gray-200 rounded p-3 text-xs font-mono text-gray-800 whitespace-pre-wrap break-all">
                {line}
              </pre>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default BioEngineTokenPage;
