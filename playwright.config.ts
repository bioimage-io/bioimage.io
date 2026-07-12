import { defineConfig } from '@playwright/test';

// Playwright tests target the deNBI v1.15.2 async model-runner
// (bioimage-io/bioengine-worker-denbi-*:model-runner), which dev mode
// promotes to the default site. Start the dev server with the flag first:
//   REACT_APP_MODEL_RUNNER_DEV=true pnpm start
//   npx playwright test

export default defineConfig({
  testDir: './tests',
  timeout: 30000,
  use: {
    baseURL: 'http://localhost:3000',
    headless: true,
  },
});
