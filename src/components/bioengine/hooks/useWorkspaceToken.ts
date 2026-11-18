import { useCallback, useEffect, useState } from 'react';
import { useHyphaStore } from '../../../store/hyphaStore';

/**
 * Mint a Hypha token for the logged-in user's workspace.
 *
 * Shared by the BioEngine pages that hand a prompt to an AI agent. Each of
 * them needs the same three things — generate, report progress, surface the
 * failure — and each gets them wrong differently when written out by hand.
 *
 * `permission` is deliberately a required argument rather than defaulting to
 * `admin`: these tokens are pasted into third-party agents, so the scope should
 * be a decision at every call site. `read_write` covers reading and writing
 * artifacts, which is what managing or calling apps needs; `admin` additionally
 * grants permission changes and is only appropriate when registering a new
 * service against the workspace.
 */
export function useWorkspaceToken(opts: {
  permission: 'read_write' | 'admin' | 'read';
  expiresInSeconds: number;
  /** Generate as soon as the user is logged in, rather than on demand. */
  auto?: boolean;
}) {
  const { permission, expiresInSeconds, auto } = opts;
  const { server, isLoggedIn } = useHyphaStore();

  const [token, setToken] = useState('');
  const [isGenerating, setIsGenerating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const generate = useCallback(async () => {
    if (!isLoggedIn || !server) return;
    setIsGenerating(true);
    setError(null);
    try {
      setToken(await server.generateToken({ permission, expires_in: expiresInSeconds }));
    } catch (err) {
      setError(`Failed to generate token: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setIsGenerating(false);
    }
  }, [isLoggedIn, server, permission, expiresInSeconds]);

  // Retried only on an explicit `generate()` call: without the error guard a
  // failing workspace would be hammered once per render.
  useEffect(() => {
    if (auto && isLoggedIn && !token && !isGenerating && !error) void generate();
  }, [auto, isLoggedIn, token, isGenerating, error, generate]);

  const clearToken = useCallback(() => {
    setToken('');
    setError(null);
  }, []);

  // A logout must not leave a live credential sitting in a prompt on screen.
  useEffect(() => {
    if (!isLoggedIn && token) setToken('');
  }, [isLoggedIn, token]);

  return { token, isGenerating, error, generate, clearToken, isLoggedIn };
}
