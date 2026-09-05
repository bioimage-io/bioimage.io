import { defineConfig } from '@playwright/test';

// The suite drives a dev server, so start one first and point the suite at it:
//   BROWSER=none pnpm start
//   npx playwright test
//
// Every spec resolves its base URL through tests/baseUrl.ts, so a single
// E2E_BASE_URL retargets all of them (e.g. a second checkout on another port).
//
// Several specs are live: they drive real BioEngine inference and rewrite real
// test reports in the bioimage-io collection. Grep a spec's header before
// running it in isolation.

export default defineConfig({
  testDir: './tests',
  // Verifies the base URL is actually serving this site before anything runs.
  globalSetup: require.resolve('./tests/globalSetup'),
  timeout: 30000,
  use: {
    baseURL: process.env.E2E_BASE_URL || 'http://localhost:3000',
    headless: true,
    // This machine has no usable GPU for headless Chromium, and the site
    // registers a cleanup service worker that would otherwise own the fetches
    // the stubbing specs install with page.route().
    launchOptions: { args: ['--disable-gpu', '--no-sandbox'] },
    serviceWorkers: 'block',
  },
});
