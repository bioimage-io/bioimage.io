import { defineConfig } from '@playwright/test';

// Model-test integration specs run against the dev server and switch to the
// deNBI v1.15.2 async model-runner (bioimage-io/bioengine-worker-denbi-*:model-runner)
// by clicking the deNBI option in the Test Model options dialog. Start the
// dev server, then run the tests:
//   pnpm start
//   npx playwright test

export default defineConfig({
  testDir: './tests',
  timeout: 30000,
  use: {
    baseURL: 'http://localhost:3000',
    headless: true,
  },
});
