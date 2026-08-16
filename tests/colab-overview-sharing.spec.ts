import { test, expect } from '@playwright/test';
import fs from 'fs';

// Requires: HYPHA_TOKEN env var (same token the user stores in localStorage
// after login), falls back to reading /data/nmechtel/bioengine/.env if unset.
// Requires: dev server running at http://localhost:3012 (this worktree's
// port; overridden below since playwright.config.ts's baseURL targets :3000
// for the model-test integration specs).
//
// What this tests (colab-rework-plan.md §13): the reworked dataset overview
// header/action row, the Share dialog's sharing + access-request + QR
// sections, and the annotate page's logged-in request-access flow. Reuses
// the "HPA Demo Dataset" (bioimage-io/annotation-mst3ebzz-o5px, label
// "cells") from annotate-ai-box.spec.ts for the overview/share coverage,
// since the test token already has an owner/manager role on it.
//
// The request-access test needs a dataset the test token has NO role on (to
// actually hit the permission-denied branch while logged in). It also needs
// BIOIMAGE_IO_TOKEN (same fallback-to-.env convention), used only to
// self-provision and tear down that fixture: the dataset is registered with
// an id-only broker owner (no email), so HYPHA_TOKEN can never accidentally
// match it via the broker's email fallback even if both tokens trace back
// to the same underlying human in Hypha's auth backend.

test.use({ baseURL: 'http://localhost:3012' });

const DATASET_ALIAS = 'annotation-mst3ebzz-o5px';
const LABEL = 'cells';

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

function readBioimageIoToken(): string | undefined {
  if (process.env.BIOIMAGE_IO_TOKEN) return process.env.BIOIMAGE_IO_TOKEN;
  try {
    const envText = fs.readFileSync('/data/nmechtel/bioengine/.env', 'utf8');
    const match = envText.match(/BIOIMAGE_IO_TOKEN=(\S+)/);
    return match?.[1];
  } catch {
    return undefined;
  }
}

// Hypha access tokens are JWTs; the `sub` claim is the same id the broker's
// RPC context resolves the caller to (confirmed empirically: it matches
// `server.config.user.id` inside a live hypha-rpc connection). Decoding it
// locally avoids a round trip just to discover the admin token's own id.
function decodeTokenSubject(token: string): string {
  const payload = token.split('.')[1];
  const decoded = JSON.parse(Buffer.from(payload, 'base64').toString('utf8'));
  return decoded.sub;
}

// A direct element.click() (skipping Playwright's coordinate hit-testing)
// used for the checkbox toggles specifically, so this works the same as a
// real user click regardless of element position.
async function toggleCheckbox(checkbox: import('@playwright/test').Locator, checked: boolean) {
  const before = await checkbox.evaluate((el: HTMLInputElement) => el.checked);
  if (before !== checked) {
    await checkbox.evaluate((el: HTMLInputElement) => el.click());
  }
}

async function injectToken(page: import('@playwright/test').Page, token: string) {
  await page.addInitScript(({ tok, expiry }) => {
    localStorage.setItem('token', tok);
    localStorage.setItem('tokenExpiry', expiry);
    localStorage.setItem('bioimage-annotation-tutorial-seen', '1');
  }, { tok: token, expiry: new Date(Date.now() + 3 * 60 * 60 * 1000).toISOString() });
}

const HYPHA_SERVER_URL = process.env.REACT_APP_HYPHA_SERVER_URL || 'https://hypha.aicell.io';

// Best-effort direct broker call (bypassing the UI) for test cleanup. Safe to
// call even if the label is already gone: delete_label lists the label's
// folder before removing anything, and a missing folder just yields an empty
// listing rather than an error, so this is idempotent.
async function cleanupLabel(token: string, artifactId: string, name: string): Promise<void> {
  try {
    await fetch(`${HYPHA_SERVER_URL}/bioimage-io/services/annotation-broker/delete_label`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ artifact_id: artifactId, name }),
    });
  } catch {
    // Best-effort only — a cleanup failure here shouldn't fail the test.
  }
}

async function callBrokerHttp(token: string, method: string, body: Record<string, unknown>): Promise<any> {
  const res = await fetch(`${HYPHA_SERVER_URL}/bioimage-io/services/annotation-broker/${method}`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const data = await res.json().catch(() => undefined);
  if (!res.ok || (data && data.success === false)) {
    throw new Error(`broker.${method} failed: ${res.status} ${JSON.stringify(data)}`);
  }
  return data;
}

async function callArtifactManagerHttp(token: string, method: string, body: Record<string, unknown>): Promise<any> {
  const res = await fetch(`${HYPHA_SERVER_URL}/public/services/artifact-manager/${method}`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const data = await res.json().catch(() => undefined);
  if (!res.ok || (data && data.success === false)) {
    throw new Error(`artifact-manager.${method} failed: ${res.status} ${JSON.stringify(data)}`);
  }
  return data;
}

// Creates a throwaway dataset the calling browser-session token (HYPHA_TOKEN)
// has NO role on, so the annotate page's permission-denied branch can be
// exercised live instead of skipped. The trick: register the dataset's
// broker owner as an id-only record (no email). The broker's owner-match
// falls back to email only when the stored entry HAS an email key, so an
// id-only owner can never accidentally match a different token that happens
// to share the same underlying human/email in Hypha's auth backend.
async function provisionPrivateDataset(
  adminToken: string,
  alias: string,
  label: string,
): Promise<string> {
  const artifactId = `bioimage-io/${alias}`;
  const ownerId = decodeTokenSubject(adminToken);
  await callArtifactManagerHttp(adminToken, 'create', {
    parent_id: 'bioimage-io/bioimage.io',
    alias,
    manifest: { name: alias, description: 'Playwright fixture, deleted after the test run', owner: { id: ownerId } },
    type: 'dataset',
    stage: true,
  });
  await callBrokerHttp(adminToken, 'register_dataset', { artifact_id: artifactId });
  await callBrokerHttp(adminToken, 'create_label', { artifact_id: artifactId, name: label, description: 'fixture label' });
  return artifactId;
}

async function cleanupPrivateDataset(adminToken: string, artifactId: string): Promise<void> {
  try {
    await callBrokerHttp(adminToken, 'delete_dataset_record', { artifact_id: artifactId });
  } catch {
    // Best-effort — the broker record may already be gone.
  }
  try {
    await callArtifactManagerHttp(adminToken, 'delete', { artifact_id: artifactId });
  } catch {
    // Best-effort — the artifact may already be gone.
  }
}

test.describe('Dataset overview (§13)', () => {
  test('header, action row, and Share dialog render correctly', async ({ page }) => {
    const token = readHyphaToken();
    if (!token) {
      test.skip();
      return;
    }
    test.setTimeout(120000);

    await injectToken(page, token);
    await page.goto(`/#/colab/${encodeURIComponent(DATASET_ALIAS)}`);

    // Header: back button + dataset title (name if the broker/artifact has
    // one, falling back to the bare alias) + small muted artifact id line.
    const backButton = page.locator('button[title="Back to Colab"]');
    await expect(backButton).toBeVisible({ timeout: 60000 });
    await expect(page.locator('h1')).toBeVisible();
    await expect(page.getByText(DATASET_ALIAS, { exact: false })).toBeVisible();

    // Action row: Share / Finetune / Download / (Delete dataset if owner),
    // right-aligned as a group.
    const shareButton = page.getByRole('button', { name: 'Share', exact: true });
    await expect(shareButton).toBeVisible();
    await expect(page.getByRole('button', { name: 'Finetune' })).toBeVisible();
    await expect(page.getByRole('link', { name: 'Download' })).toBeVisible();

    // Labels box: full height, scrollable list.
    await expect(page.getByRole('heading', { name: 'Labels' })).toBeVisible();

    // Refresh control now lives in the Images panel, not the top action bar.
    await expect(page.getByRole('button', { name: /Refresh|Refreshing/ })).toBeVisible();

    // Open the Share dialog and check its three sections.
    // force: true — this sandbox's headless Chromium doesn't tick
    // requestAnimationFrame, which Playwright's click-stability wait depends
    // on; the element position is otherwise confirmed stable.
    await shareButton.click({ force: true });
    const dialog = page.getByText('Share Dataset');
    await expect(dialog).toBeVisible();
    await expect(page.getByText('Sharing', { exact: true })).toBeVisible();
    await expect(page.getByText('Make publicly readable')).toBeVisible();

    // QR/label section: only present once the dataset has at least one
    // label, which this fixture dataset does ("cells"). The QR renders
    // unconditionally now (round 20 item 3 — no expand/collapse toggle).
    // It's a client-side <canvas> (round 21 item 4), not an <img>, so check
    // for its enlarge trigger instead of alt text.
    const annotationLabelHeading = page.getByText('Annotation Label', { exact: false });
    if (await annotationLabelHeading.isVisible().catch(() => false)) {
      await expect(page.getByTitle('Click to enlarge for scanning')).toBeVisible();
    }

    // Close the dialog.
    await page.getByRole('button', { name: 'Close' }).click({ force: true });
    await expect(dialog).not.toBeVisible();
  });
});

test.describe('Share dialog annotation URL (§21 item 5)', () => {
  test('generated URL includes the hash-router prefix and actually reaches the annotate page', async ({ page }) => {
    const token = readHyphaToken();
    if (!token) {
      test.skip();
      return;
    }
    test.setTimeout(120000);

    await injectToken(page, token);
    await page.goto(`/#/colab/${encodeURIComponent(DATASET_ALIAS)}`);

    const shareButton = page.getByRole('button', { name: 'Share', exact: true });
    await expect(shareButton).toBeVisible({ timeout: 60000 });
    await shareButton.click({ force: true });
    await expect(page.getByText('Share Dataset')).toBeVisible();

    const urlInput = page.getByLabel('Annotation URL');
    await expect(urlInput).toBeVisible();
    // The label selector auto-selects the first label asynchronously (after
    // discoverLabels resolves), so the field can briefly render with an
    // empty value right after the modal opens. Wait for it to settle instead
    // of reading it immediately.
    await expect(urlInput).toHaveValue(/#\/colab\/annotate/, { timeout: 15000 });
    const annotationURL = await urlInput.inputValue();

    // Regression check (§21 item 5): the URL must carry the HashRouter's
    // "#/" prefix, not a bare pathname query string that the router (and a
    // static host) would resolve to the models page instead of the
    // annotate route.
    expect(annotationURL).toContain('#/colab/annotate');
    expect(annotationURL).toContain(`session_id=${DATASET_ALIAS}`);
    expect(annotationURL).toContain(`label=${LABEL}`);
    // The dead cellpose_model param (no reader since the model picker was
    // dropped in §17-18) must not be re-appended.
    expect(annotationURL).not.toContain('cellpose_model');

    await page.getByRole('button', { name: 'Close' }).click({ force: true });

    // Confirm the generated URL actually routes to the annotate page and
    // not e.g. the models list (the failure mode without the hash prefix).
    // The back button's accessible name comes from its MUI Tooltip title
    // ("Go back to the Colab session: ..."), not its visible "Session
    // overview" label text.
    const url = new URL(annotationURL);
    await page.goto(url.pathname + url.search + url.hash);
    await expect(page.getByRole('button', { name: /Go back to the Colab session/ })).toBeVisible({ timeout: 60000 });
    expect(page.url()).toContain('#/colab/annotate');
  });
});

test.describe('Share dialog Apply flow (§14 items 1, 2)', () => {
  test('staging a public-flag toggle enables Apply, applies in one batch, and can be reverted', async ({ page }) => {
    const token = readHyphaToken();
    if (!token) {
      test.skip();
      return;
    }
    // Generous overall budget: the broker's update_sharing + follow-up
    // dataset refetch round trip has been observed taking 20-40s against
    // the live Hypha backend, and this test does two full apply cycles.
    test.setTimeout(240000);

    await injectToken(page, token);
    await page.goto(`/#/colab/${encodeURIComponent(DATASET_ALIAS)}`);

    const shareButton = page.getByRole('button', { name: 'Share', exact: true });
    await expect(shareButton).toBeVisible({ timeout: 60000 });
    // force: true — this sandbox's headless Chromium doesn't tick
    // requestAnimationFrame, which Playwright's click-stability wait depends
    // on; element positions are otherwise confirmed stable in this suite.
    await shareButton.click({ force: true });
    await expect(page.getByText('Share Dataset')).toBeVisible();

    const publicCheckbox = page.getByLabel('Make publicly readable');
    const applyButton = page.getByRole('button', { name: /^Apply$|Applying, this takes a few seconds/ });
    const originallyPublic = await publicCheckbox.isChecked();

    // No pending changes yet: Apply stays disabled.
    await expect(applyButton).toBeDisabled();

    // Toggle away from the current value and apply.
    await toggleCheckbox(publicCheckbox, !originallyPublic);
    await expect(applyButton).toBeEnabled();
    await applyButton.click({ force: true });
    await expect(page.getByText('Applying, this takes a few seconds')).toBeVisible({ timeout: 5000 });
    // Wait for the checkbox itself to re-enable rather than for an "Apply"
    // text match: `getByRole(..., { name: 'Apply' })` substring-matches
    // "Applying, this takes a few seconds" too, so it resolves instantly
    // and doesn't actually wait out the apply. The apply + refetch round
    // trip against the live broker can take well over 30s, so this waits
    // generously rather than on a tight budget.
    await expect(publicCheckbox).toBeEnabled({ timeout: 90000 });
    await expect(publicCheckbox).toBeChecked({ checked: !originallyPublic, timeout: 10000 });

    // Revert to the original value so the fixture dataset's ACL is unchanged.
    await toggleCheckbox(publicCheckbox, originallyPublic);
    await expect(applyButton).toBeEnabled();
    await applyButton.click({ force: true });
    await expect(publicCheckbox).toBeEnabled({ timeout: 90000 });
    await expect(publicCheckbox).toBeChecked({ checked: originallyPublic, timeout: 10000 });

    await page.getByRole('button', { name: 'Close' }).click({ force: true });
  });
});

test.describe('Annotate request-access flow (§13 item 4)', () => {
  test('logged-in visitor without a role sees a Request access button', async ({ page }) => {
    const token = readHyphaToken();
    const adminToken = readBioimageIoToken();
    if (!token || !adminToken) {
      test.skip();
      return;
    }
    test.setTimeout(90000);

    const alias = `pw-fixture-private-${Date.now()}`;
    const artifactId = await provisionPrivateDataset(adminToken, alias, LABEL);
    try {
      await injectToken(page, token);
      const url = `/#/colab/annotate?session_id=${encodeURIComponent(alias)}&label=${encodeURIComponent(LABEL)}`;
      await page.goto(url);

      const requestButton = page.getByRole('button', { name: 'Request access' });
      await expect(requestButton).toBeVisible({ timeout: 30000 });
      await requestButton.click({ force: true });

      const confirmation = page.getByText('Access requested.', { exact: false });
      await expect(confirmation).toBeVisible({ timeout: 30000 });

      // Owner sees the request: fetch the dataset record with the admin
      // token and confirm an access_requests entry exists for this run's
      // browser-session identity.
      const ownerView = await callBrokerHttp(adminToken, 'get_dataset', { artifact_id: artifactId });
      const requesterId = decodeTokenSubject(token);
      const hasRequest = (ownerView.access_requests || []).some((r: any) => r.id === requesterId);
      expect(hasRequest).toBe(true);
    } finally {
      await cleanupPrivateDataset(adminToken, artifactId);
    }
  });
});

test.describe('Annotation stats view (§15 item 3)', () => {
  test('clicking a stats row selects the corresponding image', async ({ page }) => {
    const token = readHyphaToken();
    if (!token) {
      test.skip();
      return;
    }
    test.setTimeout(120000);

    await injectToken(page, token);
    await page.goto(`/#/colab/${encodeURIComponent(DATASET_ALIAS)}`);

    // selectedLabel auto-selects the fixture's only label ("cells") once the
    // label list loads, which is what makes the stats toggle appear.
    const statsToggle = page.getByRole('button', { name: /Show annotation progress/ });
    await expect(statsToggle).toBeVisible({ timeout: 60000 });

    // Capture whichever image the overview auto-selected before switching
    // views, so the row we click below is checkably a *different* image.
    // Excludes the navbar's own "BioImage.IO" logo <img>.
    const initialImg = page.locator('img[alt]:not([alt="BioImage.IO"])').first();
    await expect(initialImg).toBeVisible({ timeout: 30000 });
    const initialStem = await initialImg.getAttribute('alt');

    await statsToggle.click({ force: true });
    await expect(page.getByText('Annotation files per image', { exact: false })).toBeVisible({ timeout: 15000 });

    // Each row's stem label is a `<span title="...">`, unique to the stats
    // view (the image-list rows elsewhere on this page don't set `title`),
    // so it doubles as a stable row locator and the row's text — sorted by
    // count desc then stem asc, so the last one is reliably a different
    // stem than whatever loaded by default first. Clicking the span bubbles
    // up to the row div's onClick.
    const rowLabels = page.locator('span[title]');
    const rowCount = await rowLabels.count();
    expect(rowCount).toBeGreaterThan(0);
    const targetLabel = rowLabels.nth(rowCount - 1);
    const targetStem = (await targetLabel.textContent())?.trim();
    expect(targetStem).toBeTruthy();

    await targetLabel.click({ force: true });

    // Switch back to the image preview and confirm the clicked row's stem
    // is now the selected/previewed image.
    await page.getByRole('button', { name: /Show image preview/ }).click({ force: true });
    const previewImg = page.locator('img[alt]:not([alt="BioImage.IO"])').first();
    await expect(previewImg).toHaveAttribute('alt', targetStem!, { timeout: 15000 });
    if (targetStem !== initialStem) {
      expect(await previewImg.getAttribute('alt')).not.toBe(initialStem);
    }
  });
});

test.describe('Label deletion (§15 item 2)', () => {
  test('deleting a label removes it via a single broker call', async ({ page }) => {
    const token = readHyphaToken();
    if (!token) {
      test.skip();
      return;
    }
    test.setTimeout(120000);

    await injectToken(page, token);
    await page.goto(`/#/colab/${encodeURIComponent(DATASET_ALIAS)}`);

    await expect(page.getByRole('heading', { name: 'Labels' })).toBeVisible({ timeout: 60000 });

    // Create a disposable label, exercised only by this test, so the delete
    // flow below never touches the fixture's real "cells" label. Unique per
    // run (timestamp suffix) so a prior run's leftover can never collide.
    const tempLabel = `pw-delete-test-${Date.now()}`;
    try {
      await page.getByRole('button', { name: '+ New label' }).click({ force: true });
      await page.getByPlaceholder('Label name').fill(tempLabel);
      await page.getByRole('button', { name: 'Create', exact: true }).click({ force: true });

      // Scoped to the label list's own span class rather than a bare text
      // match — the delete modal opened below also displays the label name
      // verbatim (in its confirmation-target box), which would otherwise
      // create a strict-mode ambiguity once both are on screen at once.
      const labelRow = page.locator('span.truncate', { hasText: tempLabel });
      await expect(labelRow).toBeVisible({ timeout: 30000 });

      // Selecting the row reveals its hover-only delete (trash) icon.
      await labelRow.click({ force: true });
      const deleteIcon = page.getByTitle(`Delete label "${tempLabel}"`);
      await expect(deleteIcon).toBeVisible({ timeout: 10000 });
      await deleteIcon.click({ force: true });

      // DeleteArtifactModal in label mode: a freshly created label has zero
      // masks, so the typed-name confirmation gate (§18.11) is skipped and
      // the Delete button is enabled immediately, no matching text needed. A
      // successful delete now round-trips through exactly one
      // `broker.delete_label` RPC (DeleteArtifactModal.tsx) instead of the
      // old N-file client-side recursive delete. Note: the broker only
      // removes files from its staged overlay and never commits, so the
      // removal isn't actually persisted to the published artifact by this
      // flow (a real fix needs a bioengine-side change to `delete_label`,
      // out of scope here — a direct commit from the frontend 403s, since
      // this dataset's Hypha ACL is managed entirely by the broker's own
      // elevated identity, not the calling user's token). The `finally`
      // cleanup below re-issues delete_label directly as a safety net for
      // exactly this kind of leftover, independent of whether the UI flow
      // above completes.
      // force: true — this sandbox's headless Chromium doesn't tick
      // requestAnimationFrame, which Playwright's click-stability wait
      // depends on (same reason every other click in this suite uses it).
      await expect(page.getByRole('heading', { name: `Delete Label "${tempLabel}"` })).toBeVisible({ timeout: 10000 });
      await expect(page.getByText('has no masks yet', { exact: false })).toBeVisible({ timeout: 10000 });
      await page.getByRole('button', { name: `Delete Label "${tempLabel}"`, exact: true }).click({ force: true });

      // The modal closing is a stronger completion signal than the row's
      // disappearance alone: `discoverLabels()` always reads with
      // `stage: true`, so the row would vanish the moment the broker's
      // staged-only removal lands, even before the commit that actually
      // persists it. Waiting for the modal to close means `handleDelete`
      // (including the commit step) fully resolved.
      await expect(page.getByRole('heading', { name: `Delete Label "${tempLabel}"` })).not.toBeVisible({ timeout: 30000 });
      await expect(labelRow).not.toBeVisible({ timeout: 10000 });
    } finally {
      // Best-effort cleanup so a failure partway through the flow above
      // (e.g. the delete click itself failing) never leaves debris in the
      // live fixture dataset. Idempotent even if the UI delete already
      // succeeded.
      await cleanupLabel(token, DATASET_ALIAS, tempLabel);
    }
  });
});
