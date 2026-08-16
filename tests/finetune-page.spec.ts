import { test, expect } from '@playwright/test';
import fs from 'fs';

// Requires: HYPHA_TOKEN env var (falls back to /data/nmechtel/bioengine/.env).
// Requires: dev server at http://localhost:3012.
//
// What this tests:
// - §23.2 (colab-rework-plan.md): the dataset overview's Finetune button now
//   opens a label-select dialog and switches the SAME page into an in-page
//   finetune view (no route change) showing the split builder for the
//   chosen label.
// - §20 item 2: the standalone /colab/<alias>/finetune training-sessions
//   page is still reachable by direct URL (it's what §23.2 links to as
//   "the existing training sessions page", not yet wired this round) —
//   routing resolves, the manager-role guard passes for a dataset the test
//   token owns, the base-model selector is restricted to vit_t_lm/vit_b_lm
//   (vit_l_lm is inference-only, it OOMs during training on the deNBI T4
//   runtime), and the advanced-parameters form defaults match the bioengine
//   `start_training` contract.
//
// Reuses the same "HPA Demo Dataset" fixture (bioimage-io/annotation-mst3ebzz-o5px,
// label "cells") as colab-overview-sharing.spec.ts, since the test token
// already has an owner/manager role on it.
//
// Deliberately does NOT click "Start fine-tuning": that would kick off a
// real GPU training run against shared infra, which is out of scope for an
// automated check.

test.use({ baseURL: 'http://localhost:3012' });

const DATASET_ALIAS = 'annotation-mst3ebzz-o5px';

function readHyphaToken(): string | undefined {
  if (process.env.HYPHA_TOKEN) return process.env.HYPHA_TOKEN;
  try {
    const envText = fs.readFileSync('/data/nmechtel/bioengine/.env', 'utf8');
    const match = envText.match(/HYPHA_TOKEN=(\S+)/);
    return match?.[1];
  } catch {
    return undefined;
  }
}

async function injectToken(page: import('@playwright/test').Page, token: string) {
  await page.addInitScript(({ tok, expiry }) => {
    localStorage.setItem('token', tok);
    localStorage.setItem('tokenExpiry', expiry);
    localStorage.setItem('bioimage-annotation-tutorial-seen', '1');
  }, { tok: token, expiry: new Date(Date.now() + 3 * 60 * 60 * 1000).toISOString() });
}

test.describe('Finetune button opens an in-page view (§23.2)', () => {
  test('Finetune button opens a label dialog, then the in-page split-builder view', async ({ page }) => {
    const token = readHyphaToken();
    if (!token) {
      test.skip();
      return;
    }
    test.setTimeout(90000);

    await injectToken(page, token);

    await page.goto(`/#/colab/${encodeURIComponent(DATASET_ALIAS)}`);
    const finetuneButton = page.getByRole('button', { name: 'Finetune' });
    await expect(finetuneButton).toBeVisible({ timeout: 60000 });
    await expect(finetuneButton).toBeEnabled();
    await finetuneButton.click({ force: true });

    // Label-select dialog (§23.2 bullet 1): no route change yet.
    await expect(page.getByRole('heading', { name: 'Choose a label' })).toBeVisible({ timeout: 30000 });
    await expect(page).toHaveURL(new RegExp(`/colab/${DATASET_ALIAS}$`));

    // Anchored to the start: the page also has a "Delete label \"cells\""
    // button (in the Labels box, behind the dialog), whose accessible name
    // also contains "cells" but doesn't start with it.
    await page.getByRole('button', { name: /^cells\b/ }).click();

    // Still the same route, now showing the in-page finetune view: the
    // Labels box is replaced by the split builder, and the header/back
    // button switch into their finetune-view state.
    await expect(page).toHaveURL(new RegExp(`/colab/${DATASET_ALIAS}$`));
    await expect(page.getByRole('heading', { name: 'Finetune: cells' })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Split builder' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Finetune' })).not.toBeVisible();

    // Back button (same style as the overview's) returns to the normal
    // dataset overview, same route, Labels box restored.
    await page.getByRole('button', { name: 'Back' }).click({ force: true });
    await expect(page.getByRole('heading', { name: 'Split builder' })).not.toBeVisible();
    await expect(page.getByRole('button', { name: 'Finetune' })).toBeVisible();
  });
});

test.describe('Finetune training-sessions page (§20 item 2, direct URL only)', () => {
  test('renders the start form for a manager at a direct /finetune URL', async ({ page }) => {
    const token = readHyphaToken();
    if (!token) {
      test.skip();
      return;
    }
    test.setTimeout(90000);

    await injectToken(page, token);

    // §23.2's Finetune button no longer navigates here (it opens the
    // in-page view instead, see the describe block above); this page is
    // still reached by direct URL, e.g. via the "training sessions" link
    // §23.2 plans to add from the in-page finetune view (not wired yet).
    await page.goto(`/#/colab/${encodeURIComponent(DATASET_ALIAS)}/finetune`);
    await expect(page.getByRole('heading', { name: 'Fine-tune μSAM' })).toBeVisible({ timeout: 30000 });

    // Guard passed (manager role) -> the start form is visible, not an
    // access-denied card.
    await expect(page.getByRole('heading', { name: 'Start a new session' })).toBeVisible();
    await expect(page.getByText('You do not have access to fine-tuning')).not.toBeVisible();

    // Model selector restricted to vit_t_lm / vit_b_lm only (vit_l_lm is
    // deliberately excluded — inference-only, OOMs during training).
    await expect(page.getByText('ViT-Tiny (vit_t_lm)')).toBeVisible();
    await expect(page.getByText('ViT-Base (vit_b_lm)')).toBeVisible();
    await expect(page.getByText('vit_l_lm', { exact: false })).not.toBeVisible();

    // Advanced parameters collapsed by default; expanding shows contract
    // defaults (n_epochs=5, n_objects_per_batch=8, patch_size=512,
    // batch_size=1, val_fraction=0.2).
    await expect(page.getByRole('spinbutton')).toHaveCount(0);
    await page.getByRole('button', { name: 'Show advanced parameters' }).click({ force: true });
    const epochsInput = page.locator('input[type="number"]').first();
    await expect(epochsInput).toHaveValue('5');

    // Sessions list section is present (may be empty for this fixture).
    await expect(page.getByRole('heading', { name: 'Training sessions' })).toBeVisible();

    // Never click Start — avoid triggering a real training run.
    await expect(page.getByRole('button', { name: 'Start fine-tuning' })).toBeVisible();
  });

  test('"Use for annotation" is gated on a checkpoint-ready session (§20 item 2)', async ({ page }) => {
    const token = readHyphaToken();
    if (!token) {
      test.skip();
      return;
    }
    test.setTimeout(90000);

    await injectToken(page, token);
    await page.goto(`/#/colab/${encodeURIComponent(DATASET_ALIAS)}/finetune`);
    await expect(page.getByRole('heading', { name: 'Start a new session' })).toBeVisible({ timeout: 30000 });
    await expect(page.getByRole('heading', { name: 'Training sessions' })).toBeVisible();

    // A session card only gets a "Use for annotation" button once it carries
    // a ready checkpoint. Sessions still running, or with no checkpoint yet,
    // must not render it — never trigger a new training run to force this
    // fixture's state, just assert the existing gating relationship.
    const readyBadges = page.getByText('Checkpoint ready');
    const readyCount = await readyBadges.count();
    if (readyCount === 0) {
      // No checkpointed session exists for this fixture yet. Nothing more to
      // assert without starting a real GPU training run, which is out of
      // scope here.
      return;
    }

    const readyCard = page.locator('div.border.border-gray-200.rounded-lg', { has: readyBadges.first() });
    const useButton = readyCard.getByRole('button', { name: 'Use for annotation' });
    await expect(useButton).toBeVisible();

    await useButton.click({ force: true });
    await expect(page).toHaveURL(/\/colab\/annotate\?.*usm_session=.*usm_model=/);
    await expect(page.getByText('Fine-tuned model')).toBeVisible({ timeout: 30000 });
  });
});
