import { test, expect } from '@playwright/test';
import fs from 'fs';
import { BASE_URL } from './baseUrl';

// Regression guard for issue #0026.
//
// Stopping a fine-tuning run from the training-sessions page used to look like
// it worked and then undo itself: the row flipped to STOPPED, and roughly 20
// seconds later the page's 5 s poll showed TRAINING again, because the child
// training process was never actually reaped and kept writing its own status.
// A user could not tell whether their run had been stopped or not, and the GPU
// stayed occupied either way.
//
// The backend fix (model-finetune 0.16.1) makes the stop path wait for the
// child to exit before writing the terminal status. This spec covers the half
// of #0026 that lives in the browser: after clicking Stop and confirming, the
// row must reach STOPPED within a few seconds and STAY there across more than
// two minutes of the page's own polling.
//
// LIVE SIDE EFFECT: this starts a real GPU training run on the shared
// model-finetune deployment and stops it again through the UI. It is short
// (stopped ~30 s in) and is always stopped from the backend as well in the
// cleanup step, but it is not free and it is not offline.
//
// Requires: HYPHA_TOKEN (falls back to /data/nmechtel/bioengine/.env) and a dev
// server at E2E_BASE_URL.

test.use({ baseURL: BASE_URL });

const HYPHA_SERVER_URL = process.env.HYPHA_SERVER_URL || 'https://hypha.aicell.io';
const DATASET_ALIAS = 'annotation-mst3ebzz-o5px';
const ARTIFACT_ID = `bioimage-io/${DATASET_ALIAS}`;
const ANNOTATION_LABEL = 'cells';
// The page finds "this dataset's" runs by the `<alias>/<label>` tag the finetune
// view writes, so a run started outside the UI has to carry the same tag to
// show up in the list at all.
const SESSION_TAG = `${DATASET_ALIAS}/${ANNOTATION_LABEL}`;
// Long enough that the run cannot finish on its own inside the observation
// window: a STOPPED row that would have gone terminal anyway proves nothing.
const N_EPOCHS = 60;
const MODEL_TYPE = 'vit_t_lm';
const MAX_PAIRS = 6;
// Time to leave the run training before stopping it, so there is a live child
// process with a heartbeat to reap rather than one that has only just spawned.
const TRAIN_BEFORE_STOP_MS = 45000;
// #0026's own reproduction window was ~20 s. Watch well past it.
const HOLD_MS = 150000;

// The training UI resolves `bioimage-io/model-finetune` across every worker
// that registers it, so the run has to be started on the exact replica the page
// will talk to. localStorage's service override pins both to one id.
const TRAINING_OVERRIDE_KEY = 'bioimage_training_service_override';

function readHyphaToken(): string | undefined {
  if (process.env.HYPHA_TOKEN) return process.env.HYPHA_TOKEN;
  try {
    return fs.readFileSync('/data/nmechtel/bioengine/.env', 'utf8').match(/HYPHA_TOKEN=(\S+)/)?.[1];
  } catch {
    return undefined;
  }
}

type Req = import('@playwright/test').APIRequestContext;

async function rpc(request: Req, token: string, service: string, method: string, args: unknown): Promise<any> {
  const res = await request.post(`${HYPHA_SERVER_URL}/${service}/${method}`, {
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    data: args,
    timeout: 120000,
  });
  expect(res.ok(), `${method} failed: ${res.status()} ${await res.text()}`).toBeTruthy();
  return res.json();
}

const AM = 'public/services/artifact-manager';

/** Fully qualified id of a model-finetune replica, or null when none is up. */
async function resolveFinetuneService(request: Req, token: string): Promise<string | null> {
  const services: Array<{ id: string }> = await rpc(request, token, 'public/services/ws', 'list_services', {
    query: 'bioimage-io',
  });
  // `model-finetune-rtc` is the same app's WebRTC front door, not a second
  // replica, so match the service name exactly rather than by prefix.
  return services.map((s) => s.id).find((id) => id.endsWith(':model-finetune')) || null;
}

/**
 * Presigned URL pairs for the dataset's annotated images.
 *
 * Uses the `.geojson` label siblings rather than the mask PNGs: the per-user
 * masks this fixture carries are RGB, which the trainer rejects outright.
 */
async function buildTrainingPairs(request: Req, token: string) {
  const images: Array<{ name: string }> = await rpc(request, token, AM, 'list_files', {
    artifact_id: ARTIFACT_ID,
    dir_path: 'images',
  });
  const imageNames = new Set(images.map((f) => f.name));

  const labelDirs: Array<{ name: string; type?: string }> = await rpc(request, token, AM, 'list_files', {
    artifact_id: ARTIFACT_ID,
    dir_path: `label_${ANNOTATION_LABEL}`,
  });

  const trainImages: string[] = [];
  const trainLabels: string[] = [];
  for (const dir of labelDirs) {
    if (trainImages.length >= MAX_PAIRS) break;
    const dirPath = `label_${ANNOTATION_LABEL}/${dir.name}`;
    let files: Array<{ name: string }>;
    try {
      files = await rpc(request, token, AM, 'list_files', { artifact_id: ARTIFACT_ID, dir_path: dirPath });
    } catch {
      continue; // a plain file at this level, not a per-user directory
    }
    for (const f of files) {
      if (trainImages.length >= MAX_PAIRS) break;
      if (!f.name.endsWith('.geojson')) continue;
      // `<stem>-<date>-<time>.geojson` -> `<stem>`
      const stem = f.name.split('-').slice(0, -2).join('-');
      if (!imageNames.has(`${stem}.png`)) continue;
      trainImages.push(await rpc(request, token, AM, 'get_file', { artifact_id: ARTIFACT_ID, file_path: `images/${stem}.png` }));
      trainLabels.push(await rpc(request, token, AM, 'get_file', { artifact_id: ARTIFACT_ID, file_path: `${dirPath}/${f.name}` }));
    }
  }
  return { trainImages, trainLabels };
}

test('a run stopped from the sessions page stays stopped (#0026)', async ({ page, request }, testInfo) => {
  const token = readHyphaToken();
  if (!token) {
    test.skip();
    return;
  }
  test.setTimeout(600000);

  const serviceId = await resolveFinetuneService(request, token);
  if (!serviceId) {
    testInfo.annotations.push({
      type: 'skip-reason',
      description: 'no model-finetune replica is registered, so there is nothing to train on.',
    });
    test.skip();
    return;
  }
  const finetuneService = `bioimage-io/services/${serviceId.split('/')[1]}`;

  const { trainImages, trainLabels } = await buildTrainingPairs(request, token);
  expect(trainImages.length, 'no annotated image/label pairs found in the fixture dataset').toBeGreaterThan(0);

  const started = await rpc(request, token, finetuneService, 'start_training', {
    train_images: trainImages,
    train_labels: trainLabels,
    model_type: MODEL_TYPE,
    n_epochs: N_EPOCHS,
    label: SESSION_TAG,
  });
  const sessionId: string = started.session_id;
  expect(sessionId, 'start_training returned no session_id').toBeTruthy();

  try {
    await page.addInitScript(
      ({ tok, expiry, overrideKey, overrideValue }) => {
        localStorage.setItem('token', tok);
        localStorage.setItem('tokenExpiry', expiry);
        localStorage.setItem('bioimage-annotation-tutorial-seen', '1');
        localStorage.setItem(overrideKey, overrideValue);
      },
      {
        tok: token,
        expiry: new Date(Date.now() + 3 * 60 * 60 * 1000).toISOString(),
        overrideKey: TRAINING_OVERRIDE_KEY,
        overrideValue: serviceId,
      },
    );

    await page.goto(`/#/colab/${encodeURIComponent(DATASET_ALIAS)}/finetune`);
    await expect(page.getByRole('heading', { name: 'Training sessions' })).toBeVisible({ timeout: 60000 });

    const row = page.locator('div.border.border-gray-200.rounded-lg').filter({ hasText: sessionId });
    await expect(row).toBeVisible({ timeout: 60000 });

    // The status badge is the row's first pill and the only element whose whole
    // text is one of the status words.
    const badge = row.locator('span').filter({ hasText: /^(PREPARING|TRAINING|COMPLETED|FAILED|STOPPED|UNKNOWN)$/ }).first();

    // Stop while the run is genuinely training. Stopping during PREPARING never
    // reproduced #0026, because there is no child process to leave behind yet.
    await expect(badge).toHaveText('TRAINING', { timeout: 300000 });

    // Let the run get properly under way first. The badge can flip to TRAINING
    // on the poll immediately after the status write, i.e. before the child has
    // done any real work, and the revert #0026 describes came from the child's
    // per-epoch heartbeat. Stopping a child that has not started an epoch would
    // pass without ever exercising the case.
    await page.waitForTimeout(TRAIN_BEFORE_STOP_MS);
    await expect(badge).toHaveText('TRAINING');

    // Forced, like the rest of the suite: the list re-renders on every 5 s poll
    // (the elapsed counter ticks), so Playwright's stability check can keep
    // deferring a plain click indefinitely on a row that is otherwise visible
    // and enabled. Visibility is asserted separately above so a genuinely
    // missing button still fails rather than silently clicking nothing.
    const stopButton = row.getByRole('button', { name: 'Stop' });
    await expect(stopButton).toBeVisible();
    await row.scrollIntoViewIfNeeded();
    await stopButton.click({ force: true });
    await expect(row.getByText('Stop this run?')).toBeVisible();
    await row.getByRole('button', { name: 'Confirm' }).click({ force: true });

    // "Within a few seconds": generous enough for the confirm round trip and
    // one poll interval, far short of the ~20 s window the bug lived in.
    await expect(badge).toHaveText('STOPPED', { timeout: 30000 });

    // ...and it has to hold. The regression showed up as a revert to TRAINING
    // on a later poll, so sample the live DOM rather than re-reading once at
    // the end, and record every state the row passes through.
    const seen = new Set<string>();
    const holdUntil = Date.now() + HOLD_MS;
    while (Date.now() < holdUntil) {
      const text = (await badge.textContent())?.trim() || '';
      seen.add(text);
      expect(text, `row reverted to "${text}" after being stopped`).toBe('STOPPED');
      await page.waitForTimeout(5000);
    }
    expect([...seen]).toEqual(['STOPPED']);

    // The controls belong to running rows only, so a truly terminal row has no
    // Stop button left to offer.
    await expect(row.getByRole('button', { name: 'Stop' })).not.toBeVisible();
  } finally {
    // Never leave a GPU run behind, whatever the assertions did. Only stop a
    // session that is still live: a second stop on an already-terminal session
    // rewrites its message and end_time, which would overwrite the very record
    // this test exists to inspect after a failure.
    try {
      const status = await rpc(request, token, finetuneService, 'get_training_status', { session_id: sessionId });
      if (!['COMPLETED', 'FAILED', 'STOPPED'].includes(status?.status)) {
        await rpc(request, token, finetuneService, 'stop_training', { session_id: sessionId });
      }
    } catch {
      // Cleanup is best effort. A failure here must not mask the real result.
    }
  }
});
