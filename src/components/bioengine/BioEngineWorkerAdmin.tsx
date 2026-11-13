import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useHyphaStore } from '../../store/hyphaStore';
import BioEnginePageHeader from './BioEnginePageHeader';
import BioEngineWorker from './BioEngineWorker';
import BioEngineWorkerList, { FEATURED_SERVICE_NAME } from './BioEngineWorkerList';
import AgentPromptBox from './AgentPromptBox';

/**
 * `/bioengine/worker-admin` — managing workers you have admin rights to.
 *
 * Two states on one route:
 *   - with `?service_id=…`, the existing worker dashboard (unchanged);
 *   - without it, the agent prompt plus a selectable list of workers.
 *
 * The dashboard lives here rather than at the old `/bioengine/worker` so that
 * "administer a worker" is one place; `/bioengine/worker` redirects, keeping
 * any bookmarked `?service_id=` intact.
 */

const SKILL_URL = 'https://bioimage.io/skills/bioengine/SKILL.md';

// Managing a worker is a longer session than setting one up, and every call the
// agent makes is authenticated, so the token needs to outlive the conversation.
const TOKEN_LIFETIME_SECONDS = 12 * 3600;
const TOKEN_LIFETIME_LABEL = '12 hours';

/**
 * Build the prompt from the selected worker ids and the workspace token.
 *
 * The task list deliberately spans both halves of app work: deploying an
 * existing app from the collection, and building a brand new one. The second
 * used to be advertised by a "Copy AI Coding Skill" button on the dashboard's
 * app list, which handed over a bare skill URL with no worker and no
 * credentials. Folding it in here means one prompt covers the whole job and
 * already knows which worker to build against.
 */
const buildPrompt = (workerIds: string[], token: string): string => {
  const base = `Read ${SKILL_URL} and follow it to work with an existing BioEngine worker. Ask me what I want to do before changing anything. You can:
  - deploy an app that already exists in a Hypha artifact collection
  - build a new BioEngine app from scratch, then deploy it to the worker
  - update, redeploy or undeploy an app that is already running
  - inspect worker and app status, logs and resource usage`;
  const parts = [base];
  if (workerIds.length > 0) {
    const noun = workerIds.length === 1 ? 'this worker' : 'these workers';
    parts.push(`Work against ${noun}:\n${workerIds.map(id => `  - ${id}`).join('\n')}`);
  }
  if (token) {
    parts.push(
      `Use this Hypha token (valid for ${TOKEN_LIFETIME_LABEL}, ask me to generate a new one if it has expired):\nHYPHA_TOKEN=${token}`,
    );
  }
  return parts.join('\n\n');
};

const BioEngineWorkerAdmin: React.FC = () => {
  const [searchParams] = useSearchParams();
  const serviceId = searchParams.get('service_id');
  const { server, isLoggedIn } = useHyphaStore();

  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [token, setToken] = useState('');
  const [isGeneratingToken, setIsGeneratingToken] = useState(false);
  const [tokenError, setTokenError] = useState<string | null>(null);

  // The default selection is applied once, the first time the featured worker
  // shows up. The list refreshes every 10 s, so re-applying it on every poll
  // would make the worker impossible to deselect.
  const defaultApplied = useRef(false);

  const generateToken = useCallback(async () => {
    if (!isLoggedIn || !server) return;
    setIsGeneratingToken(true);
    setTokenError(null);
    try {
      setToken(await server.generateToken({ permission: 'read_write', expires_in: TOKEN_LIFETIME_SECONDS }));
    } catch (err) {
      setTokenError(`Failed to generate token: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setIsGeneratingToken(false);
    }
  }, [isLoggedIn, server]);

  // Unlike worker setup, where the token is optional, administering a worker is
  // authenticated end to end: a worker admits only the admin users it was
  // configured with, so an agent without a token cannot do anything useful.
  // Generate one up front rather than making the user ask for it.
  //
  // Scoped to read_write, NOT admin. Managing apps on a worker needs to read and
  // write artifacts in the workspace; it never needs to hand out permissions or
  // delete the workspace. This prompt is copied into a third-party agent and
  // pasted around, so it should carry the narrowest credential that still does
  // the job. Worker setup is the case that genuinely needs admin, because it
  // registers a new service against the workspace.
  useEffect(() => {
    if (isLoggedIn && !token && !isGeneratingToken && !tokenError) generateToken();
  }, [isLoggedIn, token, isGeneratingToken, tokenError, generateToken]);

  const toggleSelect = useCallback((id: string) => {
    setSelectedIds(prev => (prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id]));
  }, []);

  const handleServicesChange = useCallback((services: { id: string; name: string }[]) => {
    if (services.length === 0) return;
    const live = services.map(s => s.id);
    // Match the featured worker by name: its service id embeds a ReplicaSet
    // hash that changes on every pod roll, so a hardcoded id would go stale.
    const featured = services.find(s => s.name === FEATURED_SERVICE_NAME);

    // Seed the default only once the featured worker is actually present.
    // Workers arrive per workspace, so the first non-empty batch is often some
    // other site; latching on that would burn the one chance to apply the
    // default against a list that does not contain the worker it names, and
    // nothing would ever be selected.
    //
    // The latch is also flipped OUT here rather than inside the updater below.
    // React may invoke a state updater more than once for the same update
    // (StrictMode does exactly that in development), and a ref mutated inside
    // it would read as already-true on the second pass.
    const seedDefault = !defaultApplied.current && !!featured;
    if (seedDefault) defaultApplied.current = true;

    setSelectedIds(prev => {
      // Drop anything that has since disappeared, so the prompt never names a
      // worker that is no longer registered.
      const kept = prev.filter(id => live.includes(id));
      if (seedDefault && featured && !kept.includes(featured.id)) {
        return [...kept, featured.id];
      }
      return kept.length === prev.length ? prev : kept;
    });
  }, []);

  const prompt = useMemo(() => buildPrompt(selectedIds, token), [selectedIds, token]);

  const missingWorker = selectedIds.length === 0;
  const missingToken = !token;
  const blocked = missingWorker || missingToken;

  const blockedHint = !isLoggedIn
    ? 'Log in to generate the Hypha token this prompt needs.'
    : missingToken && missingWorker
      ? 'Select at least one worker below, and wait for the Hypha token to be generated.'
      : missingToken
        ? isGeneratingToken
          ? 'Generating the Hypha token...'
          : (tokenError ?? 'A Hypha token is required to manage a worker.')
        : 'Select at least one worker below to enable copying.';

  // The dashboard brings its own full-page chrome, so it is rendered bare.
  if (serviceId) {
    return <BioEngineWorker />;
  }

  return (
    <div className="max-w-[1400px] mx-auto px-4 py-8">
      <BioEnginePageHeader backTo="/bioengine" />

      <div className="max-w-6xl mx-auto space-y-6">
        <AgentPromptBox
          title="Manage a BioEngine Worker"
          intro="Select the workers you administer below, then copy this prompt into your AI agent (Claude Code, Codex, Gemini CLI, and so on). It loads the BioEngine skill, points the agent at the workers you selected, and carries a Hypha token so it can authenticate as you. Use it to deploy existing apps, build new ones, or inspect what is running. You can also open any worker's dashboard directly."
          prompt={prompt}
          disabled={blocked}
          disabledHint={blockedHint}
          selectionSummary={
            missingWorker
              ? 'No worker selected'
              : `${selectedIds.length} worker${selectedIds.length === 1 ? '' : 's'} selected`
          }
        >
          {/* A worker admits only the admin users it was configured with, so an
              agent with no token cannot manage it at all. Unlike the setup page,
              where a token merely saves a round trip, here it is a hard
              requirement and copying stays blocked without one. */}
          <div
            className={`mt-3 flex items-start gap-2 p-3 rounded-lg border ${
              missingToken ? 'bg-amber-50 border-amber-200' : 'bg-green-50 border-green-200'
            }`}
          >
            <svg
              className={`w-4 h-4 mt-0.5 flex-shrink-0 ${missingToken ? 'text-amber-600' : 'text-green-600'}`}
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              {missingToken ? (
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01M5.07 19h13.86c1.54 0 2.5-1.67 1.73-3L13.73 4a2 2 0 00-3.46 0L3.34 16c-.77 1.33.19 3 1.73 3z" />
              ) : (
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
              )}
            </svg>
            <div className="text-xs">
              {missingToken ? (
                <p className="text-amber-800">
                  <span className="font-semibold">A Hypha token is required.</span>{' '}
                  {isLoggedIn
                    ? isGeneratingToken
                      ? 'Generating one now...'
                      : (tokenError ?? 'A worker only admits the admin users it was configured with, so the agent must authenticate as you.')
                    : 'A worker only admits the admin users it was configured with, so the agent must authenticate as you. Log in to generate one.'}
                </p>
              ) : (
                <p className="text-green-800">
                  A read-write Hypha token for your workspace is included in the prompt, valid for {TOKEN_LIFETIME_LABEL}. Treat the prompt as a secret while it is.
                </p>
              )}
              {isLoggedIn && (missingToken && !isGeneratingToken) && (
                <button
                  type="button"
                  onClick={generateToken}
                  className="mt-1 underline font-medium text-amber-900 hover:text-amber-700"
                >
                  Try again
                </button>
              )}
            </div>
          </div>
        </AgentPromptBox>

        <BioEngineWorkerList
          selectable
          selectedIds={selectedIds}
          onToggleSelect={toggleSelect}
          onServicesChange={handleServicesChange}
        />
      </div>
    </div>
  );
};

export default BioEngineWorkerAdmin;
