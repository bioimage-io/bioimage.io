import { defineConfig } from '@playwright/test';

// Playwright tests target the v1.15.0 dev runner (bioimage-io/model-runner-dev).
// Start the dev server with the flag before running tests:
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
