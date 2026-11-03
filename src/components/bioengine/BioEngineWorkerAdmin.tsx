import React, { useCallback, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useHyphaStore } from '../../store/hyphaStore';
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
 * The task list deliberately spans both halves of app work: deploying an
 * existing app from the collection, and building a brand new one. The second
 * used to be advertised by a "Copy AI Coding Skill" button on the dashboard's
 * app list, which handed over a bare skill URL with no worker and no
 * credentials. Folding it in here means one prompt covers the whole job and
 * already knows which worker to build against.
 *
 * Two blocks, not three, and the capability list is a sentence rather than four
 * bullets: it restated what the skill already documents, and the prompt is read
 * by an agent that is about to read the skill anyway. What has to survive the
 * shortening is the skill URL, the instruction to ask first, the worker ids and
 * the credential.
 *
 * With no token, the prompt says to take HYPHA_TOKEN from the environment
 * instead of simply omitting the subject. A worker admits only its configured
 * admin users, so an agent that is never told it needs a credential discovers
 * that on its first authenticated call, as a permission error.
 */
const buildPrompt = (workerIds: string[], token: string): string => {
  const parts = [
    `Read ${SKILL_URL} and follow it to manage a BioEngine worker: deploy an app from an artifact collection, build and deploy a new one, update or remove a running app, and inspect status, logs and resource usage. Ask me what I want to do before changing anything.`,
  ];

  // Second block: what to act on, and what to act with. Both belong together,
  // and a single worker reads better inline than as a one-item bullet list.
  const target: string[] = [];
  if (workerIds.length === 1) {
    target.push(`Worker: ${workerIds[0]}`);
  } else if (workerIds.length > 1) {
    target.push(`Workers:\n${workerIds.map(id => `  - ${id}`).join('\n')}`);
  }
  target.push(
    token
      ? `HYPHA_TOKEN=${token} (valid for ${TOKEN_LIFETIME_LABEL}, ask me for a new one if it has expired)`
      : 'Authenticate with HYPHA_TOKEN from the environment. Ask me for one if it is not set.',
  );
  parts.push(target.join('\n'));

  return parts.join('\n\n');
};

const BioEngineWorkerAdmin: React.FC = () => {
  const [searchParams] = useSearchParams();
  const serviceId = searchParams.get('service_id');
  const { isLoggedIn } = useHyphaStore();

  const [selectedIds, setSelectedIds] = useState<string[]>([]);

  // The default selection is applied once, the first time the featured worker
  // shows up. The list refreshes every 10 s, so re-applying it on every poll
  // would make the worker impossible to deselect.
  const defaultApplied = useRef(false);
  // Ticked by default. On the apps page a token is genuinely optional, because
  // a public app can be called with no credential at all. A worker is not like
  // that: it admits only the admin users it was configured with, so a
  // token-free session can read nothing and change nothing. Defaulting on keeps
  // the common case working and makes the box an escape hatch for the one thing
  // it could not do before, namely obtain the prompt without a secret in it.
  const [includeToken, setIncludeToken] = useState(true);

  // Scoped to read_write, NOT admin. Managing apps on a worker needs to read and
  // write artifacts in the workspace; it never needs to hand out permissions or
  // delete the workspace. This prompt is copied into a third-party agent and
  // pasted around, so it should carry the narrowest credential that still does
  // the job. Worker setup is the case that genuinely needs admin, because it
  // registers a new service against the workspace.
  //
  // `auto` is the checkbox, so the token is minted up front exactly as before
  // while the box is ticked, and nothing is minted at all once it is unticked.
  // The hook also wipes the token on logout, which the hand-rolled state this
  // replaced did not.
  const {
    token,
    isGenerating: isGeneratingToken,
    error: tokenError,
    generate: generateToken,
    clearToken,
  } = useWorkspaceToken({
    permission: 'read_write',
    expiresInSeconds: TOKEN_LIFETIME_SECONDS,
    auto: includeToken,
  });

  // Untick: drop the token, so a live credential never lingers in a prompt that
  // no longer advertises one. Tick: nothing to do here, because `auto` turning
  // true mints a fresh one, and fresh is what we want. The lifetime is counted
  // from issue, so reusing a token minted earlier in the session would hand the
  // agent less time than the label promises.
  const handleIncludeToken = useCallback((next: boolean) => {
    setIncludeToken(next);
    if (!next) clearToken();
  }, [clearToken]);

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
  // Only a prompt that promises a token is blocked for the want of one. With the
  // box unticked there is nothing to wait for, which is the whole point of the
  // box: a prompt with no secret in it, copyable while logged out.
  const missingToken = includeToken && !token;
  const blocked = missingWorker || missingToken;

  const tokenHint = !isLoggedIn
    ? 'Log in to generate the Hypha token, or untick the token box to copy the prompt without one.'
    : isGeneratingToken
      ? 'Generating the Hypha token...'
      : (tokenError ?? 'A Hypha token is required to manage a worker.');

  const blockedHint = missingToken && missingWorker
    ? `Select at least one worker below. ${tokenHint}`
    : missingToken
      ? tokenHint
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
          intro="Select the workers you administer below, then copy this prompt into your AI agent (Claude Code, Codex, Gemini CLI, and so on). It loads the BioEngine skill, points the agent at the workers you selected, and can carry a Hypha token so it authenticates as you. Use it to deploy existing apps, build new ones, or inspect what is running. You can also open any worker's dashboard directly."
          prompt={prompt}
          disabled={blocked}
          disabledHint={blockedHint}
          selectionSummary={
            missingWorker
              ? 'No worker selected'
              : `${selectedIds.length} worker${selectedIds.length === 1 ? '' : 's'} selected`
          }
        >
          {/* Deliberately NOT disabled while logged out, unlike the same box on
              the apps page. Logging out is exactly when someone wants the
              token-free prompt, and a box they cannot reach to untick would
              leave the page as unusable as it was before this existed. */}
          <label className="flex items-start mt-3 cursor-pointer">
            <input
              type="checkbox"
              data-testid="include-token"
              checked={includeToken}
              onChange={e => handleIncludeToken(e.target.checked)}
              className="mt-0.5 w-4 h-4 text-blue-600 border-gray-300 rounded"
            />
            <span className="ml-2 text-sm text-gray-700">
              Include a read-write Hypha token for my workspace (valid for {TOKEN_LIFETIME_LABEL})
              {includeToken && isLoggedIn && isGeneratingToken && <span className="text-gray-500"> (generating...)</span>}
              <span className="block text-xs text-gray-500">
                A worker admits only the admin users it was configured with, so the agent needs a token to do anything. Untick to copy the prompt without a secret in it, then supply the token yourself.
              </span>
            </span>
          </label>

          {/* Only meaningful while the box is ticked. With it unticked there is
              no credential to report on, and the amber "required" banner would
              contradict a Copy button that is now deliberately enabled. */}
          {includeToken && (
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
                    : 'A worker only admits the admin users it was configured with, so the agent must authenticate as you. Log in to generate one, or untick the box above to copy the prompt without a token.'}
                </p>
              ) : (
                <p className="text-green-800">
                  A read-write Hypha token for your workspace is included in the prompt, valid for {TOKEN_LIFETIME_LABEL}. Treat the copied prompt as a secret until it expires.
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
          )}
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
