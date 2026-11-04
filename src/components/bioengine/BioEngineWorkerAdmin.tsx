import React, { useCallback, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import BioEnginePageHeader from './BioEnginePageHeader';
import BioEngineWorker from './BioEngineWorker';
import BioEngineWorkerList, { FEATURED_SERVICE_NAME } from './BioEngineWorkerList';
import AgentPromptBox from './AgentPromptBox';
import { useWorkspaceToken } from './hooks/useWorkspaceToken';

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
 * One line per fact, no blank lines. This started out as three blank-line
 * separated blocks with a four-bullet capability list, which read well on the
 * page and badly as a pasted prompt: the bullets restated what the skill at
 * SKILL_URL documents in far more detail, and the agent reads the skill first
 * thing anyway. What the skill cannot know is the two things that are left —
 * which workers, and which credential.
 *
 * The one-sentence task summary is kept rather than dropped entirely. It spans
 * both halves of app work on purpose: deploying an existing app from the
 * collection, and building a brand new one. The second used to be advertised by
 * a separate "Copy AI Coding Skill" button that handed over a bare skill URL
 * with no worker and no credentials, and folding it in here is what let that
 * button go.
 *
 * `includeToken` is not the same question as `token` being non-empty: with the
 * box ticked and the token still being minted, both are falsy-but-different, and
 * only the first means "say nothing about credentials here".
 */
const buildPrompt = (workerIds: string[], token: string, includeToken: boolean): string => {
  const lines = [
    `Read ${SKILL_URL} and follow it to manage an existing BioEngine worker: deploy an app from a Hypha artifact collection, build and deploy a new one, update, redeploy or undeploy what is already running, or inspect status, logs and resource usage. Ask me what I want to do before changing anything.`,
  ];
  if (workerIds.length > 0) {
    // Comma-separated on one line. Service ids cannot contain a comma, so this
    // stays unambiguous, and the <pre> wraps it rather than scrolling.
    lines.push(`${workerIds.length === 1 ? 'Worker' : 'Workers'}: ${workerIds.join(', ')}`);
  }
  if (includeToken) {
    lines.push(`HYPHA_TOKEN=${token} (read-write, valid for ${TOKEN_LIFETIME_LABEL}, ask me for a new one if it has expired)`);
  } else {
    // Omitting the credential silently would send the agent off to fail on its
    // first authenticated call with no idea why.
    lines.push('You need a read-write Hypha token for my workspace to do any of this. Read it from HYPHA_TOKEN if I have already set it, otherwise ask me for one.');
  }
  return lines.join('\n');
};

const BioEngineWorkerAdmin: React.FC = () => {
  const [searchParams] = useSearchParams();
  const serviceId = searchParams.get('service_id');

  const [selectedIds, setSelectedIds] = useState<string[]>([]);

  // Ticked by default, which is the opposite of the apps page. There a token is
  // genuinely optional, because a public app can be called without one. A worker
  // admits only the admin users it was configured with, so here there is no
  // useful token-free session, and defaulting off would hand every existing user
  // a prompt that fails on its first call. The checkbox is an escape hatch for
  // the case the default cannot serve: getting the prompt out of the page
  // without a live credential in it, to paste somewhere it should not go.
  const [includeToken, setIncludeToken] = useState(true);

  // The default selection is applied once, the first time the featured worker
  // shows up. The list refreshes every 10 s, so re-applying it on every poll
  // would make the worker impossible to deselect.
  const defaultApplied = useRef(false);

  // Scoped to read_write, NOT admin. Managing apps on a worker needs to read and
  // write artifacts in the workspace; it never needs to hand out permissions or
  // delete the workspace. This prompt is copied into a third-party agent and
  // pasted around, so it should carry the narrowest credential that still does
  // the job. Worker setup is the case that genuinely needs admin, because it
  // registers a new service against the workspace.
  //
  // `auto` is tied to the checkbox, so unticking it stops the hook regenerating
  // and ticking it again mints a fresh one. The hook also clears the token on
  // logout, which the hand-rolled state this replaced did not.
  const {
    token,
    isGenerating: isGeneratingToken,
    error: tokenError,
    generate: generateToken,
    clearToken,
    isLoggedIn,
  } = useWorkspaceToken({
    permission: 'read_write',
    expiresInSeconds: TOKEN_LIFETIME_SECONDS,
    auto: includeToken,
  });

  const handleIncludeToken = useCallback(
    (next: boolean) => {
      setIncludeToken(next);
      // Drop the credential rather than merely hiding it, so an untick leaves
      // nothing live behind the checkbox. Re-ticking mints a new one via `auto`.
      if (!next) clearToken();
    },
    [clearToken],
  );

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

  const prompt = useMemo(
    () => buildPrompt(selectedIds, token, includeToken),
    [selectedIds, token, includeToken],
  );

  const missingWorker = selectedIds.length === 0;
  // Only a problem while the token is actually wanted. Unticking the box is how
  // a user asks for a prompt with no credential in it, so it has to unblock the
  // copy rather than leaving the button dead for a reason that no longer exists.
  const missingToken = includeToken && !token;
  const blocked = missingWorker || missingToken;

  const blockedHint = missingToken
    ? !isLoggedIn
      ? 'Log in to generate a Hypha token, or untick the token option to copy the prompt without one.'
      : missingWorker
        ? 'Select at least one worker below, and wait for the Hypha token to be generated.'
        : isGeneratingToken
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
          intro="Select the workers you administer below, then copy this prompt into your AI agent (Claude Code, Codex, Gemini CLI, and so on). It loads the BioEngine skill, points the agent at the workers you selected, and by default carries a Hypha token so it can authenticate as you. Use it to deploy existing apps, build new ones, or inspect what is running. You can also open any worker's dashboard directly."
          prompt={prompt}
          disabled={blocked}
          disabledHint={blockedHint}
          selectionSummary={
            missingWorker
              ? 'No worker selected'
              : `${selectedIds.length} worker${selectedIds.length === 1 ? '' : 's'} selected`
          }
        >
          {/* Ticked by default: a worker admits only the admin users it was
              configured with, so an agent with no token cannot manage it at
              all. Untick it to get the prompt without a live credential in it,
              which is the only thing the default cannot give you. */}
          <label
            className="mt-3 flex items-start cursor-pointer"
            data-testid="include-token-label"
          >
            <input
              type="checkbox"
              checked={includeToken}
              onChange={e => handleIncludeToken(e.target.checked)}
              className="mt-0.5 w-4 h-4 text-blue-600 border-gray-300 rounded"
              data-testid="include-token"
            />
            <span className="ml-2 text-sm text-gray-700">
              Include a read-write Hypha token for my workspace (valid for {TOKEN_LIFETIME_LABEL})
              <span className="block text-xs text-gray-500">
                A worker only admits the admin users it was configured with, so the agent needs one to do anything.
              </span>
            </span>
          </label>

          <div
            className={`mt-3 flex items-start gap-2 p-3 rounded-lg border ${
              !includeToken
                ? 'bg-gray-50 border-gray-200'
                : missingToken
                  ? 'bg-amber-50 border-amber-200'
                  : 'bg-green-50 border-green-200'
            }`}
          >
            <svg
              className={`w-4 h-4 mt-0.5 flex-shrink-0 ${
                !includeToken ? 'text-gray-500' : missingToken ? 'text-amber-600' : 'text-green-600'
              }`}
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              {!includeToken ? (
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
              ) : missingToken ? (
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01M5.07 19h13.86c1.54 0 2.5-1.67 1.73-3L13.73 4a2 2 0 00-3.46 0L3.34 16c-.77 1.33.19 3 1.73 3z" />
              ) : (
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
              )}
            </svg>
            <div className="text-xs">
              {!includeToken ? (
                <p className="text-gray-700">
                  No token is included, so this prompt is safe to paste anywhere. The agent will ask you for one before it can reach the worker.
                </p>
              ) : missingToken ? (
                <p className="text-amber-800">
                  <span className="font-semibold">A Hypha token is required.</span>{' '}
                  {isLoggedIn
                    ? isGeneratingToken
                      ? 'Generating one now...'
                      : (tokenError ?? 'A worker only admits the admin users it was configured with, so the agent must authenticate as you.')
                    : 'Log in to generate one, or untick the option above to copy the prompt without a token.'}
                </p>
              ) : (
                <p className="text-green-800">
                  A read-write Hypha token for your workspace is included in the prompt, valid for {TOKEN_LIFETIME_LABEL}. Treat the prompt as a secret while it is.
                </p>
              )}
              {isLoggedIn && missingToken && !isGeneratingToken && (
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
