import { execFileSync } from 'child_process';
import { realpathSync } from 'fs';
import path from 'path';
import { BASE_URL } from './baseUrl';

/**
 * Refuse to run against something that is not this site, or not this CHECKOUT.
 *
 * Dev servers from several checkouts (and from unrelated projects) share this
 * machine, and whoever starts first takes port 3000. Two different failures live
 * here and they need different checks:
 *
 *   wrong PRODUCT   another project's dev server held the port and the suite
 *                   drove it, producing a wall of confusing selector failures.
 *                   Caught by the manifest check below.
 *
 *   wrong CHECKOUT  every bioimage.io worktree serves short_name "BioImage.IO",
 *                   so the manifest check passes and the run looks clean while
 *                   measuring a different branch. This is the dangerous one: the
 *                   cost is not a broken test, it is a passing test you believe.
 *                   Caught by resolving the listening process below.
 *
 * The checkout check works by asking the OS which process owns the port and
 * reading its working directory, rather than by having the app serve a build
 * marker. That keeps it out of src/ entirely, needs no cooperation from however
 * the server was started, and also catches a server that is stale rather than
 * foreign: a process still running from this directory but started before your
 * last change is the same identity, so this does not catch that, but a process
 * from a sibling worktree is a different cwd and is caught.
 *
 * FAILURE POSTURE: a positively identified mismatch is an error. An inability to
 * check (remote URL, no `ss`, unreadable /proc) is a warning, never an error.
 * A guard that cannot run must not make the suite unrunnable.
 */

/** The checkout this test run belongs to. tests/ sits directly under the root. */
const REPO_ROOT = realpathSync(path.resolve(__dirname, '..'));

/** Working directory of whatever is listening on a local port, if knowable. */
function serverCwd(port: string): { cwd?: string; pid?: string; why?: string } {
  let out: string;
  try {
    out = execFileSync('ss', ['-ltnp'], { encoding: 'utf8' });
  } catch (err) {
    return { why: `could not run \`ss -ltnp\` (${(err as Error).message})` };
  }
  const line = out.split('\n').find(l => new RegExp(`[:.]${port}\\s`).test(l));
  if (!line) return { why: `nothing is listening on port ${port} according to \`ss\`` };
  const pid = /pid=(\d+)/.exec(line)?.[1];
  if (!pid) return { why: `\`ss\` did not report a pid for port ${port} (not our process?)` };
  try {
    return { cwd: realpathSync(`/proc/${pid}/cwd`), pid };
  } catch (err) {
    return { pid, why: `could not read /proc/${pid}/cwd (${(err as Error).message})` };
  }
}

export default async function globalSetup() {
  let manifest: { short_name?: string };
  try {
    const res = await fetch(`${BASE_URL}/manifest.json`);
    manifest = await res.json();
  } catch (err) {
    throw new Error(
      `No dev server answering at ${BASE_URL}.\n` +
        `Start one with \`BROWSER=none pnpm start\`, or point the suite at an ` +
        `existing one with E2E_BASE_URL.\n(${(err as Error).message})`,
    );
  }
  if (manifest.short_name !== 'BioImage.IO') {
    throw new Error(
      `${BASE_URL} is serving "${manifest.short_name}", not BioImage.IO.\n` +
        `Another project's dev server holds that port. Set E2E_BASE_URL to this ` +
        `checkout's server instead.`,
    );
  }

  // Which bioimage.io is it? Several answer to that name on this machine.
  const url = new URL(BASE_URL);
  const local = ['localhost', '127.0.0.1', '::1'].includes(url.hostname);
  if (!local) {
    console.warn(
      `[globalSetup] ${BASE_URL} is not local, so the checkout serving it cannot be ` +
        `verified. Results are attributed to whatever is running there.`,
    );
    return;
  }

  const { cwd, pid, why } = serverCwd(url.port || '80');
  if (!cwd) {
    console.warn(
      `[globalSetup] Serving ${BASE_URL}, but the checkout behind it could not be ` +
        `identified: ${why}. Proceeding unverified.`,
    );
    return;
  }
  if (cwd !== REPO_ROOT) {
    throw new Error(
      `${BASE_URL} is served by a DIFFERENT checkout of this site.\n\n` +
        `  serving   ${cwd}  (pid ${pid})\n` +
        `  expected  ${REPO_ROOT}\n\n` +
        `Both serve short_name "BioImage.IO", so the product check cannot tell them ` +
        `apart. Running anyway would report another branch's behaviour as yours.\n` +
        `Either stop that server and start one here, or set E2E_BASE_URL to this ` +
        `checkout's own port.`,
    );
  }
  // Say it out loud even on success: the failure this guards against is silence.
  console.log(`[globalSetup] ${BASE_URL} -> ${cwd} (pid ${pid}), this checkout.`);
}
