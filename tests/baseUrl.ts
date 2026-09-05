/**
 * One base URL for the whole suite.
 *
 * Specs used to pin their own port with `test.use({ baseURL: 'http://localhost:5199' })`,
 * a leftover from the worktree each round was written in. That made the suite
 * unrunnable as a suite (different specs pointed at different servers) and,
 * worse, let a spec silently drive a *different* checkout's dev server that
 * happened to be listening on that port. Everything resolves through here now,
 * so one `E2E_BASE_URL` moves the entire suite.
 *
 * `DEV_BASE_URL` and `BASE_URL` are honoured too because a handful of specs
 * documented those names in their header comments.
 */
export const BASE_URL =
  process.env.E2E_BASE_URL || process.env.DEV_BASE_URL || process.env.BASE_URL || 'http://localhost:3000';
