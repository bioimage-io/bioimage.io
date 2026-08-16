import { test, expect } from '@playwright/test';
import fs from 'fs';

// Requires: HYPHA_TOKEN env var (falls back to /data/nmechtel/bioengine/.env).
// Requires: dev server at http://localhost:3012.
//
// What this tests (colab-rework-plan.md §20 item 2): the new Finetune page
// at /colab/<alias>/finetune — routing resolves, the manager-role guard
// passes for a dataset the test token owns, the base-model selector is
// restricted to vit_t_lm/vit_b_lm (vit_l_lm is inference-only, it OOMs
// during training on the deNBI T4 runtime), and the advanced-parameters
// form defaults match the bioengine `start_training` contract. Reuses the
// same "HPA Demo Dataset" fixture (bioimage-io/annotation-mst3ebzz-o5px,
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

test.describe('Finetune page (§20 item 2)', () => {
  test('routes correctly and renders the start form for a manager', async ({ page }) => {
    const token = readHyphaToken();
    if (!token) {
      test.skip();
      return;
    }
    test.setTimeout(90000);

    await injectToken(page, token);

    // Navigate via the dataset overview's Finetune button rather than a
    // direct deep link, to also cover ColabPage.tsx's isFinetuneRoute branch
    // and the navigate() call carrying the selected label as prefill state.
    await page.goto(`/#/colab/${encodeURIComponent(DATASET_ALIAS)}`);
    const finetuneButton = page.getByRole('button', { name: 'Finetune' });
    await expect(finetuneButton).toBeVisible({ timeout: 60000 });
    await expect(finetuneButton).toBeEnabled();
    await finetuneButton.click({ force: true });

    await expect(page).toHaveURL(new RegExp(`/colab/${DATASET_ALIAS}/finetune`));
    await expect(page.getByRole('heading', { name: 'Fine-tune μSAM' })).toBeVisible({ timeout: 30000 });

    // Guard passed (manager role) -> the start form is visible, not an
    // access-denied card.
    await expect(page.getByRole('heading', { name: 'Start a new session' })).toBeVisible();
    await expect(page.getByText('You do not have access to fine-tuning')).not.toBeVisible();

    // Label prefilled from the overview's selected label.
    const labelSelect = page.locator('select').first();
    await expect(labelSelect).toHaveValue('cells');

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
});
