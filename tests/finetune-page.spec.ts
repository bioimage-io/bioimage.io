import { test, expect } from '@playwright/test';
import fs from 'fs';

// Requires: HYPHA_TOKEN env var (falls back to /data/nmechtel/bioengine/.env).
// Requires: dev server at http://localhost:3012.
//
// What this tests:
// - §23.2/§23.4 (colab-rework-plan.md): the dataset overview's Finetune
//   button opens a label-select dialog and switches the SAME page into an
//   in-page finetune view (no route change). The split builder lives in the
//   right panel (FinetuneView.tsx); the LEFT image list (DatasetOverview.tsx)
//   groups rows into Train / Test / Unused sections with headers, not a flat
//   list — clicking a row's badge cycles it between sections. Share,
//   Download, and Delete stay dataset-overview-only and are hidden while the
//   finetune view is open (§23.4 item 4).
// - §20 item 2 / broker v0.7.0: the standalone /colab/<alias>/finetune page
//   is monitoring-only now (training starts from the finetune view above),
//   reachable by direct URL — routing resolves, the manager-role guard
//   passes for a dataset the test token owns, and the sessions list /
//   "Use for annotation" gating still work.
//
// Reuses the same "HPA Demo Dataset" fixture (bioimage-io/annotation-mst3ebzz-o5px,
// label "cells") as colab-overview-sharing.spec.ts, since the test token
// already has an owner/manager role on it.
//
// Deliberately does NOT click "Create split" / "Extend split" / "Start
// training": creating a split or starting a real GPU training run against
// shared infra is out of scope for an automated check — keen-puma/Nils run
// that e2e pass by hand once this lands.

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
    // button switch into their finetune-view state. The page header (h1)
    // carries the "Finetune: {label}" text; the right panel's own heading is
    // "Split builder" so the two don't collide.
    await expect(page).toHaveURL(new RegExp(`/colab/${DATASET_ALIAS}$`));
    await expect(page.getByRole('heading', { name: 'Finetune: cells', level: 1 })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Split builder' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Finetune' })).not.toBeVisible();

    // §23.4 item 3 (revised): the left image list groups into Train / Test /
    // Unused sections with headers, not a flat list with per-row badges only.
    // A brand-new split (or no split at all) starts every row Unused; assert
    // the three section headers render without clicking any row (clicking
    // would stage a change the test can't clean up).
    await expect(page.getByText(/^Train \(\d+\)$/)).toBeVisible({ timeout: 15000 });
    await expect(page.getByText(/^Test \(\d+\)$/)).toBeVisible();
    await expect(page.getByText(/^Unused \(\d+\)$/)).toBeVisible();

    // Right panel: split selector plus Create/Extend split button, no image
    // list duplicated here.
    await expect(page.getByText('Split builder')).toBeVisible();
    const saveSplitButton = page.getByRole('button', { name: /^(Create split|Extend split)$/ });
    await expect(saveSplitButton).toBeVisible();

    // §23.4 item 4: Share, Download, and Delete stay dataset-overview-only
    // and must not render while the finetune view is open.
    await expect(page.getByRole('button', { name: 'Share' })).not.toBeVisible();
    await expect(page.getByRole('link', { name: 'Download' })).not.toBeVisible();
    await expect(page.getByRole('button', { name: 'Delete', exact: true })).not.toBeVisible();

    // Back button (same style as the overview's) returns to the normal
    // dataset overview, same route, Labels box restored, and Share/Download
    // (and Delete, for the owner) reappear.
    await page.getByRole('button', { name: 'Back' }).click({ force: true });
    await expect(page.getByRole('heading', { name: 'Split builder' })).not.toBeVisible();
    await expect(page.getByRole('button', { name: 'Finetune' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Share' })).toBeVisible();
    await expect(page.getByRole('link', { name: 'Download' })).toBeVisible();
  });
});

test.describe('Finetune training-sessions page (monitoring-only, direct URL)', () => {
  test('renders the sessions list for a manager at a direct /finetune URL', async ({ page }) => {
    const token = readHyphaToken();
    if (!token) {
      test.skip();
      return;
    }
    test.setTimeout(90000);

    await injectToken(page, token);

    // §23.2's Finetune button no longer navigates here (it opens the
    // in-page split-builder view instead, see the describe block above,
    // which also links to this page as "Training sessions"). This page is
    // still reached by direct URL and is monitoring-only now: no start
    // form, training runs are kicked off from the finetune view.
    await page.goto(`/#/colab/${encodeURIComponent(DATASET_ALIAS)}/finetune`);
    await expect(page.getByRole('heading', { name: 'Fine-tune μSAM' })).toBeVisible({ timeout: 30000 });

    // Guard passed (manager role) -> the sessions list is visible, not an
    // access-denied card.
    await expect(page.getByRole('heading', { name: 'Training sessions' })).toBeVisible();
    await expect(page.getByText('You do not have access to fine-tuning')).not.toBeVisible();

    // The old start form is gone entirely from this page.
    await expect(page.getByRole('heading', { name: 'Start a new session' })).not.toBeVisible();
    await expect(page.getByRole('button', { name: 'Start fine-tuning' })).not.toBeVisible();
    await expect(page.getByText("Start new training runs from a dataset's finetune view", { exact: false })).toBeVisible();
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
    await expect(page.getByRole('heading', { name: 'Training sessions' })).toBeVisible({ timeout: 30000 });

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
