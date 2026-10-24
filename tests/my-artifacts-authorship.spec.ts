import { test, expect, Page } from '@playwright/test';
import { BASE_URL } from './baseUrl';

/**
 * My Artifacts must list artifacts you are NAMED on, not only the ones you
 * uploaded (myco issue 0006).
 *
 * Nothing here talks to hypha.aicell.io and nothing here touches a real model.
 * `window.__hyphaStore` (a dev-only seam in src/store/hyphaStore.ts, dropped
 * from production bundles) is handed a fake artifact manager serving invented
 * artifacts, so the rendered UI is the real component tree on fake data. The
 * fake `list()` reimplements the three server behaviours the page depends on:
 * `filters.created_by`, full-text `keywords`, and `limit`/`offset` paging.
 *
 * The fixture is shaped like the real case measured against the live
 * collection on 2026-10-24: one author with 10 artifacts they uploaded and 66
 * more that merely name them, out of a collection where they hold write access
 * on nearly everything because they are a reviewer.
 *
 * Run against a dev server (production builds compile the store seam out):
 *   BROWSER=none PORT=3061 ./node_modules/.bin/react-scripts start
 *   E2E_BASE_URL=http://localhost:3061 npx playwright test tests/my-artifacts-authorship.spec.ts
 */

test.use({
  baseURL: BASE_URL,
  viewport: { width: 1280, height: 900 },
  serviceWorkers: 'block',
  launchOptions: { args: ['--disable-gpu'] },
});

// ---------------------------------------------------------------------------
// Fixtures. Every id, name and address below is invented for this spec.
// ---------------------------------------------------------------------------

/**
 * A Google session: an id with no GitHub handle in it, and a display name.
 * This is the identity shape the issue is about. Matching authors by email
 * alone finds nothing for it, because the manifests carry a null author email.
 */
const AUTHOR_SESSION = {
  id: 'google-oauth2|stub-000000000000000000',
  email: 'stub-author@example.org',
  name: 'Stub Authorson',
  roles: [] as string[],
};

const OWNED = 10;
const AUTHORED_ONLY = 66;
const EXPECTED_ROWS = OWNED + AUTHORED_ONLY; // 76, the number from the issue
const PER_PAGE = 12; // hyphaStore itemsPerPage

/**
 * The stub collection: 300 artifacts.
 *   - 10 carry the user's uploader email (owned)
 *   - 66 name the user as an author, with a null author email and a
 *     github_user the session cannot supply, uploaded by somebody else
 *   -  1 merely mentions the user's name in its description (a keyword hit
 *      that the client-side post-filter must drop)
 *   - the rest are other people's, and EVERY one of them grants the user `rw+`
 *     because they are a collection reviewer
 */
function buildCollection() {
  const items: any[] = [];
  const reviewerGrant = {
    permissions: {
      [AUTHOR_SESSION.id]: 'rw+',
      [AUTHOR_SESSION.email]: 'rw+',
    },
  };
  const reviewerOps = {
    [AUTHOR_SESSION.id]: ['read', 'edit', 'commit', 'put_file'],
  };

  for (let i = 0; i < OWNED; i++) {
    items.push({
      id: `bioimage-io/stub-owned-${i}`,
      alias: `stub-owned-${i}`,
      type: 'model',
      created_by: 'github|stub-someone-else',
      last_modified: 2_000_000 + i,
      versions: [{ version: 'v0', comment: '', created_at: 1 }],
      config: reviewerGrant,
      _permissions: reviewerOps,
      manifest: {
        name: `Owned model ${i}`,
        description: 'Uploaded by the signed-in user.',
        status: 'published',
        authors: [{ name: 'Stub Authorson', github_user: 'stubauthor', email: null }],
        // Like the live data: some of a user's own uploads name the uploader,
        // some only give an address. One is enough to recover the name.
        uploader:
          i < 3
            ? { email: AUTHOR_SESSION.email, name: 'Stub Authorson' }
            : { email: AUTHOR_SESSION.email },
      },
    });
  }

  for (let i = 0; i < AUTHORED_ONLY; i++) {
    const types = ['model', 'application', 'dataset'];
    items.push({
      id: `bioimage-io/stub-authored-${i}`,
      alias: `stub-authored-${i}`,
      type: types[i % 3],
      created_by: 'github|stub-someone-else',
      last_modified: 1_000_000 + i,
      versions: [{ version: 'v0', comment: '', created_at: 1 }],
      config: reviewerGrant,
      // Half of them give the user a real edit right, half do not, so the
      // spec covers both the enabled and the disabled Edit button.
      _permissions: i % 2 === 0 ? reviewerOps : {},
      manifest: {
        name: `Authored artifact ${i}`,
        description: 'Somebody else uploaded this one.',
        status: 'published',
        authors: [
          { name: 'Someone Else', email: 'someone.else@example.org' },
          { name: 'Stub Authorson', github_user: 'stubauthor', email: null },
        ],
        uploader: { email: 'someone.else@example.org' },
      },
    });
  }

  items.push({
    id: 'bioimage-io/stub-mentions-only',
    alias: 'stub-mentions-only',
    type: 'model',
    created_by: 'github|stub-someone-else',
    last_modified: 3_000_000,
    versions: [{ version: 'v0', comment: '', created_at: 1 }],
    config: reviewerGrant,
    _permissions: reviewerOps,
    manifest: {
      name: 'Reimplementation',
      description: 'Reimplements the method of Stub Authorson et al.',
      status: 'published',
      authors: [{ name: 'Someone Else', email: 'someone.else@example.org' }],
      uploader: { email: 'someone.else@example.org' },
    },
  });

  while (items.length < 300) {
    const i = items.length;
    items.push({
      id: `bioimage-io/stub-other-${i}`,
      alias: `stub-other-${i}`,
      type: 'model',
      created_by: 'github|stub-someone-else',
      last_modified: 500_000 + i,
      versions: [{ version: 'v0', comment: '', created_at: 1 }],
      // The trap: the user can WRITE every one of these.
      config: reviewerGrant,
      _permissions: reviewerOps,
      manifest: {
        name: `Other model ${i}`,
        description: 'Belongs to somebody else entirely.',
        status: 'published',
        authors: [{ name: 'Someone Else', email: 'someone.else@example.org' }],
        uploader: { email: 'someone.else@example.org' },
      },
    });
  }
  return items;
}

/**
 * Cut the page off from every origin except the dev server, so real Hypha
 * reads and partner logos do not retry underneath the stub.
 */
async function blockExternalNetwork(page: Page) {
  const origin = new URL(BASE_URL).origin;
  await page.route('**/*', async (route) => {
    const url = route.request().url();
    if (url.startsWith(origin) || url.startsWith('data:') || url.startsWith('blob:')) {
      await route.fallback();
      return;
    }
    await route.abort();
  });
}

async function waitForStoreSeam(page: Page) {
  await page.waitForFunction(() => !!(window as any).__hyphaStore, null, { timeout: 30000 });
}

/**
 * Install the fake session. `listCalls` on window records every list() the page
 * made, so the spec can assert on paging rather than inferring it.
 */
async function installStub(page: Page, items: any[], session: any) {
  await page.evaluate(
    ({ items, session }) => {
      (window as any).__listCalls = [];
      const artifactManager = {
        read: async (args: any) => {
          if (args.artifact_id === 'bioimage-io/bioimage.io') {
            // Reviewer: write access on the whole collection.
            return { config: { permissions: { [session.id]: 'rw+' } } };
          }
          return { id: args.artifact_id, manifest: {} };
        },
        list: async (args: any) => {
          (window as any).__listCalls.push(args);
          let matching = items;
          if (args.stage === true) matching = [];
          if (args.filters?.created_by) {
            matching = matching.filter((a: any) => a.created_by === args.filters.created_by);
          }
          for (const keyword of args.keywords || []) {
            const needle = String(keyword).toLowerCase();
            matching = matching.filter((a: any) =>
              JSON.stringify(a.manifest).toLowerCase().includes(needle)
            );
          }
          const offset = args.offset || 0;
          const limit = args.limit ?? matching.length;
          return matching.slice(offset, offset + limit);
        },
      };
      (window as any).__hyphaStore.setState({
        user: session,
        artifactManager,
        isConnected: true,
        isLoggedIn: true,
        isAuthenticated: true,
        connectionStatus: 'connected',
        myArtifactsPage: 1,
      });
    },
    { items, session }
  );
}

async function clearUnreachableBanner(page: Page) {
  await page.evaluate(() => (window as any).__hyphaStore.getState().markHyphaReachable());
}

// ---------------------------------------------------------------------------

test('signed out: the page asks for a login and lists nothing', async ({ page }) => {
  await blockExternalNetwork(page);
  await page.goto('/#/my-artifacts');
  await waitForStoreSeam(page);
  await page.evaluate(() =>
    (window as any).__hyphaStore.setState({ user: null, isLoggedIn: false })
  );

  await expect(page.getByText('Login Required')).toBeVisible();
  await expect(
    page.getByText('Please login to view the artifacts you uploaded or are listed on')
  ).toBeVisible();
  await expect(page.locator('text=Listed as author')).toHaveCount(0);
  await clearUnreachableBanner(page);
  await page.screenshot({ path: 'tests/screenshots/my-artifacts-signed-out.png' });
});

test('empty: a session that names nobody gets the explanatory empty state', async ({ page }) => {
  await blockExternalNetwork(page);
  await page.goto('/#/my-artifacts');
  await waitForStoreSeam(page);
  await installStub(page, buildCollection(), {
    id: 'google-oauth2|stub-nobody',
    email: 'stub-nobody@example.org',
    name: 'Stub Nobody',
    roles: [],
  });

  await expect(page.getByText(/Nothing here yet/)).toBeVisible({ timeout: 20000 });
  await expect(page.getByRole('button', { name: 'Upload Your First Model' })).toBeVisible();
  await clearUnreachableBanner(page);
  await page.screenshot({ path: 'tests/screenshots/my-artifacts-empty.png' });
});

test('loading: the spinner is shown while the queries are in flight', async ({ page }) => {
  await blockExternalNetwork(page);
  await page.goto('/#/my-artifacts');
  await waitForStoreSeam(page);

  // A list() that never resolves holds the page in its loading state.
  await page.evaluate((session) => {
    (window as any).__hyphaStore.setState({
      user: session,
      artifactManager: {
        read: async () => ({ config: { permissions: {} } }),
        list: () => new Promise(() => {}),
      },
      isConnected: true,
      isLoggedIn: true,
      isAuthenticated: true,
      connectionStatus: 'connected',
    });
  }, AUTHOR_SESSION);

  await expect(page.getByText('Loading artifacts...')).toBeVisible({ timeout: 20000 });
  await clearUnreachableBanner(page);
  await page.screenshot({ path: 'tests/screenshots/my-artifacts-loading.png' });
});

test('populated: 76 rows, authorship labelled, reviewer grant ignored', async ({ page }) => {
  await blockExternalNetwork(page);
  await page.goto('/#/my-artifacts');
  await waitForStoreSeam(page);
  const items = buildCollection();
  await installStub(page, items, AUTHOR_SESSION);

  // CLAUSE 1+2: the authorship union is listed, not just the 10 uploads.
  const count = page.locator('text=/^\\d+ items$/').first();
  await expect(count).toHaveText(`${EXPECTED_ROWS} items`, { timeout: 20000 });

  // CLAUSE 3: 300 artifacts grant this user rw+ and 224 of them are nobody
  // else's business. None may appear.
  await expect(page.getByText('Other model 100')).toHaveCount(0);
  // Nor may an artifact that merely mentions the name in its description.
  await expect(page.getByText('Reimplementation', { exact: true })).toHaveCount(0);

  // The rows the user did not upload are labelled, the ones they did are not.
  // Sorted by last_modified, the first page holds the 10 owned rows and the
  // two most recent authorship rows.
  const cards = page.locator('.grid > div');
  await expect(cards).toHaveCount(PER_PAGE);
  await expect(page.getByText('Owned model 9')).toBeVisible();
  await expect(page.getByText('Listed as author')).toHaveCount(PER_PAGE - OWNED);
  // Owner rows keep the owner action, authorship rows do not.
  await expect(page.getByRole('button', { name: 'Request deletion' })).toHaveCount(OWNED);

  await clearUnreachableBanner(page);
  await page.screenshot({ path: 'tests/screenshots/my-artifacts-populated-owned.png' });
});

test('no query truncates at 100: 150 authored artifacts all arrive', async ({ page }) => {
  await blockExternalNetwork(page);
  await page.goto('/#/my-artifacts');
  await waitForStoreSeam(page);

  // A more prolific author than the one above: 150 authorship matches, so the
  // keyword query needs a second page. The old code asked for `limit: 100`
  // once and would have stopped at 100 without saying so.
  const PROLIFIC = 150;
  const items: any[] = [];
  for (let i = 0; i < PROLIFIC; i++) {
    items.push({
      id: `bioimage-io/stub-many-${i}`,
      alias: `stub-many-${i}`,
      type: 'model',
      created_by: 'github|stub-someone-else',
      last_modified: 1_000_000 + i,
      versions: [{ version: 'v0', comment: '', created_at: 1 }],
      _permissions: {},
      manifest: {
        name: `Prolific artifact ${i}`,
        description: 'Somebody else uploaded this one.',
        status: 'published',
        authors: [{ name: 'Stub Authorson', github_user: 'stubauthor', email: null }],
        uploader: { email: 'someone.else@example.org' },
      },
    });
  }
  await installStub(page, items, AUTHOR_SESSION);

  await expect(page.locator('text=/^\\d+ items$/').first()).toHaveText(`${PROLIFIC} items`, {
    timeout: 20000,
  });

  // The store's own reviewer-badge refresh shares this artifact manager and
  // still asks for `limit: 1000, pagination: true`. It belongs to the navbar,
  // not to this page, so it is excluded by its pagination flag rather than
  // being counted against the page.
  const allCalls = await page.evaluate(() => (window as any).__listCalls);
  const calls = allCalls.filter((c: any) => !c.pagination && !c.filters?.type);
  expect(calls.length).toBeGreaterThan(0);
  for (const call of calls) {
    expect(call.limit).toBeLessThanOrEqual(100);
    expect(typeof call.offset).toBe('number');
  }
  const nameCalls = calls.filter((c: any) =>
    (c.keywords || []).some((k: string) => k === 'stub authorson')
  );
  expect(nameCalls.length).toBeGreaterThanOrEqual(2);
  expect(nameCalls.some((c: any) => c.offset === 100)).toBe(true);

  // Every one of the 150 is reachable: the last page holds the oldest row.
  const lastPage = Math.ceil(PROLIFIC / PER_PAGE);
  await page.getByRole('button', { name: String(lastPage), exact: true }).first().click();
  await expect(page.getByText('Prolific artifact 0')).toBeVisible({ timeout: 20000 });
});

test('populated: the authorship rows carry the label and no owner actions', async ({ page }) => {
  await blockExternalNetwork(page);
  await page.goto('/#/my-artifacts');
  await waitForStoreSeam(page);
  await installStub(page, buildCollection(), AUTHOR_SESSION);
  await expect(page.locator('text=/^\\d+ items$/').first()).toHaveText(`${EXPECTED_ROWS} items`, {
    timeout: 20000,
  });

  // Page 2 is past the 10 owned rows, so every row on it is authorship.
  await page.getByRole('button', { name: 'Next' }).click();
  const cards = page.locator('.grid > div');
  await expect(cards).toHaveCount(PER_PAGE);
  await expect(page.getByText('Listed as author')).toHaveCount(PER_PAGE);
  // Authorship confers nothing: no delete, no deletion request.
  await expect(page.getByRole('button', { name: 'Request deletion' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: /^Delete$/ })).toHaveCount(0);
  // Edit is offered only where the artifact actually grants it, and the
  // disabled one says why rather than disappearing.
  const editButtons = page.getByRole('button', { name: 'Edit' });
  await expect(editButtons).toHaveCount(PER_PAGE);
  const disabled = page.locator(
    'button[title="You do not have edit rights on this artifact"]'
  );
  await expect(disabled).toHaveCount(PER_PAGE / 2);
  await expect(disabled.first()).toBeDisabled();

  await clearUnreachableBanner(page);
  await page.screenshot({ path: 'tests/screenshots/my-artifacts-populated-authored.png' });
});

test('a session with no display name recovers it from its own uploads', async ({ page }) => {
  await blockExternalNetwork(page);
  await page.goto('/#/my-artifacts');
  await waitForStoreSeam(page);
  // Many Hypha sessions carry no `name` at all, which is why the fix cannot
  // rest on `user.name` alone. The page finds the user's own uploads by email,
  // reads the name off `manifest.uploader.name`, and queries again with it.
  await installStub(page, buildCollection(), {
    id: 'github|stub-no-name',
    email: AUTHOR_SESSION.email,
    roles: [],
  });

  await expect(page.locator('text=/^\\d+ items$/').first()).toHaveText(`${EXPECTED_ROWS} items`, {
    timeout: 20000,
  });
  const calls = await page.evaluate(() => (window as any).__listCalls);
  // The name query happened, and only on the second pass: the session itself
  // never supplied the name.
  const nameCalls = calls.filter((c: any) =>
    (c.keywords || []).some((k: string) => k === 'stub authorson')
  );
  expect(nameCalls.length).toBeGreaterThanOrEqual(1);
});

test('a nameless session with no uploads of its own sees nothing it should not', async ({
  page,
}) => {
  await blockExternalNetwork(page);
  await page.goto('/#/my-artifacts');
  await waitForStoreSeam(page);
  // No name, no uploads: there is nothing to recover a name from, so the page
  // must fall back to empty rather than guessing.
  await installStub(page, buildCollection(), {
    id: 'github|stub-stranger',
    email: 'stub-stranger@example.org',
    roles: [],
  });

  await expect(page.getByText(/Nothing here yet/)).toBeVisible({ timeout: 20000 });
});
