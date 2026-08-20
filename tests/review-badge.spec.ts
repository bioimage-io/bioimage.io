import { test, expect, Page } from '@playwright/test';

// Two screenshots, both taken against the dev server with a STUBBED Hypha
// session. Nothing here talks to hypha.aicell.io and nothing here touches a
// real model in the bioimage-io collection: `window.__hyphaStore` (a dev-only
// seam in src/store/hyphaStore.ts) is handed a fake artifact manager that
// serves invented toy artifacts, so the rendered UI is the real component tree
// driven by fake data.
//
// Run against a dev server:
//   PORT=3021 BROWSER=none pnpm start
//   BASE_URL=http://localhost:3021 npx playwright test tests/review-badge.spec.ts

test.use({
  baseURL: process.env.BASE_URL || 'http://localhost:3000',
  viewport: { width: 1280, height: 800 },
  deviceScaleFactor: 3,
  // The site registers a cleanup service worker on load. Left running, it owns
  // the fetches these specs stub, and page.route() never sees them.
  serviceWorkers: 'block',
  // Headless chromium's swiftshader GPU process intermittently wedges
  // Page.captureScreenshot on this stack. Software rendering is plenty for a
  // navbar crop and a form page, and it makes the capture deterministic.
  launchOptions: { args: ['--disable-gpu'] },
});

// ---------------------------------------------------------------------------
// Stub fixtures. Every id below is invented for this spec.
// ---------------------------------------------------------------------------

const REVIEWER = {
  id: 'stub-reviewer-id',
  email: 'stub-reviewer@example.org',
  roles: [] as string[],
};

const UPLOADER = {
  id: 'stub-uploader-id',
  email: 'stub-uploader@example.org',
  roles: [] as string[],
};

// Three 'in-review' models plus two that must NOT be counted, so the assertion
// on "3" also proves the badge ignores 'in-revision' and 'draft'.
const STAGED_STATUSES: Record<string, string> = {
  'bioimage-io/stub-toy-alpha': 'in-review',
  'bioimage-io/stub-toy-beta': 'in-review',
  'bioimage-io/stub-toy-gamma': 'in-review',
  'bioimage-io/stub-toy-delta': 'in-revision',
  'bioimage-io/stub-toy-epsilon': 'draft',
};

const TOY_ID = 'bioimage-io/stub-toy-in-revision';

/**
 * Cut the page off from every origin except the dev server. These specs drive
 * the UI purely from the stubbed store, so real hypha.aicell.io reads, partner
 * logos and analytics are pure noise: left alive they retry for the whole run
 * and keep the renderer too busy for Playwright to capture a screenshot.
 *
 * Registered FIRST so the per-test stubs, registered after it, take precedence
 * (Playwright runs route handlers in reverse registration order).
 */
async function blockExternalNetwork(page: Page) {
  const origin = new URL(process.env.BASE_URL || 'http://localhost:3000').origin;
  await page.route('**/*', async (route) => {
    const url = route.request().url();
    if (url.startsWith(origin) || url.startsWith('data:') || url.startsWith('blob:')) {
      await route.fallback();
      return;
    }
    await route.abort();
  });
}

/**
 * The offline stub above makes every real Hypha fetch fail, which raises the
 * global "services are currently unreachable" banner. That banner is an
 * artefact of the stub, not of the UI under test, so clear it just before
 * capturing.
 */
async function clearUnreachableBanner(page: Page) {
  await page.evaluate(() => (window as any).__hyphaStore.getState().markHyphaReachable());
}

async function waitForStoreSeam(page: Page) {
  await page.waitForFunction(() => !!(window as any).__hyphaStore, null, { timeout: 30000 });
}

test('screenshot A: pending-review badge on the closed avatar', async ({ page }) => {
  await blockExternalNetwork(page);
  await page.goto('/');
  await waitForStoreSeam(page);

  // STUB: a reviewer session backed by a fake artifact manager. The collection
  // read grants this user `rw+` (so getIsReviewer passes) and the staged
  // list/read pair feeds the store's real refreshPendingReviewCount logic.
  await page.evaluate(
    ({ reviewer, statuses }) => {
      const artifactManager = {
        read: async (args: any) => {
          if (args.artifact_id === 'bioimage-io/bioimage.io') {
            return { config: { permissions: { [reviewer.email]: 'rw+' } } };
          }
          return { id: args.artifact_id, manifest: { status: statuses[args.artifact_id] } };
        },
        list: async () => ({ items: Object.keys(statuses).map((id) => ({ id })) }),
      };
      (window as any).__hyphaStore.setState({
        user: reviewer,
        artifactManager,
        isConnected: true,
        isLoggedIn: true,
        isAuthenticated: true,
        connectionStatus: 'connected',
      });
    },
    { reviewer: REVIEWER, statuses: STAGED_STATUSES }
  );

  const avatar = page.locator('button[aria-label^="User profile menu"]').first();
  const badge = page.getByTestId('pending-review-badge').first();

  await expect(badge).toBeVisible();
  await expect(badge).toHaveText('3');
  // Dropdown stays closed: the whole point is that the signal is visible without it.
  await expect(page.locator('#user-dropdown')).toHaveCount(0);
  await expect(avatar).toHaveAttribute('aria-label', 'User profile menu, 3 models awaiting review');
  await expect(badge).toHaveAttribute('aria-hidden', 'true');

  // Crop to the navbar's right end so the 16px badge is legible at the 3x
  // device scale factor set above.
  await clearUnreachableBanner(page);
  const box = await avatar.boundingBox();
  expect(box).not.toBeNull();
  await page.screenshot({
    path: 'tests/screenshots/review-badge-on-avatar.png',
    clip: {
      x: Math.max(0, box!.x - 300),
      y: Math.max(0, box!.y - 16),
      width: 340,
      height: 56,
    },
  });
});

test('screenshot A2: no badge for a non-reviewer with the same store state', async ({ page }) => {
  await blockExternalNetwork(page);
  await page.goto('/');
  await waitForStoreSeam(page);

  // Same fake data, but the collection grants this user read only, so
  // canAccessReview is false and the badge must not render.
  await page.evaluate(
    ({ uploader, statuses }) => {
      const artifactManager = {
        read: async (args: any) => {
          if (args.artifact_id === 'bioimage-io/bioimage.io') {
            return { config: { permissions: { '*': 'r' } } };
          }
          return { id: args.artifact_id, manifest: { status: statuses[args.artifact_id] } };
        },
        list: async () => ({ items: Object.keys(statuses).map((id) => ({ id })) }),
      };
      (window as any).__hyphaStore.setState({
        user: uploader,
        artifactManager,
        isConnected: true,
        isLoggedIn: true,
        isAuthenticated: true,
        connectionStatus: 'connected',
        pendingReviewCount: 3,
      });
    },
    { uploader: UPLOADER, statuses: STAGED_STATUSES }
  );

  const avatar = page.locator('button[aria-label^="User profile menu"]').first();
  await expect(avatar).toBeVisible();
  await expect(page.getByTestId('pending-review-badge')).toHaveCount(0);
  await expect(avatar).toHaveAttribute('aria-label', 'User profile menu');
});

test('screenshot B: uploader can resubmit an in-revision model for review', async ({ page }) => {
  // The RDF the Edit page lists and fetches for the toy model.
  const TOY_RDF = [
    'type: model',
    'format_version: 0.5.4',
    'name: Stub Toy Model',
    'description: Throwaway artifact used only by this Playwright spec.',
    '',
  ].join('\n');

  await blockExternalNetwork(page);
  await page.route(/stub-toy-files\/bioimageio\.yaml/, (route) =>
    route.fulfill({ status: 200, contentType: 'text/yaml', body: TOY_RDF })
  );
  // The Edit page looks for a remote test report; serve a passing one so the
  // "Review & Publish" test gate is satisfied without a live BioEngine run.
  await page.route(/test-report-stub-toy-in-revision.*test_report\.json/, (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ status: 'passed', name: 'stub toy model', tests: [] }),
    })
  );

  // The app is a HashRouter SPA. Land on the home route first so the store seam
  // exists, install the stub, then hash-navigate into the Edit page so its load
  // effect runs with the fake artifact manager already in place.
  await page.goto('/');
  await waitForStoreSeam(page);

  // STUB: the uploader's own session on a toy model whose staged manifest is
  // 'in-revision'. `created_by` matches the user id, which is what
  // getArtifactRights uses to decide isUploader, and the collection read grants
  // this user nothing, so isReviewer is false. Whatever renders below is
  // therefore strictly the uploader-facing surface.
  await page.evaluate(
    ({ uploader, toyId, rdf }) => {
      const artifact = {
        id: toyId,
        alias: 'stub-toy-in-revision',
        created_by: uploader.id,
        staging: [],
        versions: [],
        manifest: {
          id: 'stub-toy-in-revision',
          type: 'model',
          name: 'Stub Toy Model',
          description: 'Throwaway artifact used only by this Playwright spec.',
          status: 'in-revision',
          uploader: { email: uploader.email },
          tags: [],
          covers: [],
        },
        _permissions: { [uploader.id]: '*' },
      };
      const artifactManager = {
        read: async (args: any) => {
          if (args.artifact_id === 'bioimage-io/bioimage.io') {
            return { config: { permissions: { '*': 'r' } } };
          }
          return artifact;
        },
        list: async () => ({ items: [] }),
        list_files: async () => [
          { name: 'bioimageio.yaml', type: 'file', size: rdf.length, last_modified: 1 },
        ],
        get_file: async () => '/stub-toy-files/bioimageio.yaml',
        // Record what the UI would write, instead of writing anything.
        edit: async (args: any) => {
          (window as any).__stubEdits.push(args);
          if (args.manifest) artifact.manifest = args.manifest;
          return artifact;
        },
      };
      // Edit.loadArtifactFiles bails unless `server` is set too. A minimal fake
      // is enough: the page only reads server.config.user, and the model-runner
      // hooks degrade to "unavailable" when getService rejects.
      const server = {
        config: { user: uploader, workspace: 'stub-workspace' },
        getService: async () => { throw new Error('stubbed: no services'); },
        get_service: async () => { throw new Error('stubbed: no services'); },
        getWorkspaceInfo: async () => ({ owners: [] }),
        listServices: async () => [],
      };
      (window as any).__stubEdits = [];
      (window as any).__hyphaStore.setState({
        user: uploader,
        server,
        artifactManager,
        isConnected: true,
        isLoggedIn: true,
        isAuthenticated: true,
        connectionStatus: 'connected',
      });
    },
    { uploader: UPLOADER, toyId: TOY_ID, rdf: TOY_RDF }
  );

  await page.evaluate((toyId) => {
    window.location.hash = `#/edit/${encodeURIComponent(toyId)}/stage`;
  }, TOY_ID);

  // The uploader opens the Review & Publish tab from the Files view.
  const reviewTabButton = page.getByRole('button', { name: 'Review & Publish' });
  await expect(reviewTabButton).toBeVisible({ timeout: 20000 });
  await expect(reviewTabButton).toBeEnabled();
  await reviewTabButton.click();

  // The affordance under test: a model sitting in 'in-revision' offers the
  // uploader "Submit for Review", which flips manifest.status back to
  // 'in-review'. No reviewer-only Admin Review Area is present.
  const submit = page.getByRole('button', { name: 'Submit for Review' });
  await expect(submit).toBeVisible();
  await expect(submit).toBeEnabled();
  await expect(page.getByText('Needs Revision')).toBeVisible();
  await expect(page.getByText('Admin Review Area')).toHaveCount(0);

  await clearUnreachableBanner(page);
  await page.screenshot({
    path: 'tests/screenshots/resubmit-after-revision.png',
    fullPage: false,
  });

  // Follow it through: the confirmation dialog's Submit for Review writes a
  // staged manifest edit flipping status back to 'in-review'. This is the whole
  // uploader-facing round trip out of revision, from the website alone.
  await submit.click();
  await page.getByRole('heading', { name: 'Submit for Review' }).waitFor();
  await page.getByRole('button', { name: 'Submit for Review' }).last().click();

  await expect
    .poll(() => page.evaluate(() => (window as any).__stubEdits.length))
    .toBeGreaterThan(0);
  const edits = await page.evaluate(() => (window as any).__stubEdits);
  expect(edits[0].artifact_id).toBe(TOY_ID);
  expect(edits[0].stage).toBe(true);
  expect(edits[0].manifest.status).toBe('in-review');

  // And the page settles into the under-review state, with Withdraw offered.
  await expect(page.getByRole('button', { name: 'Withdraw from Review' })).toBeVisible();
});
