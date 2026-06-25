/**
 * Single source of truth for the Hypha server URL.
 *
 * Defaults to the production endpoint (https://hypha.aicell.io). Override
 * via the REACT_APP_HYPHA_SERVER_URL environment variable at build time —
 * useful for staging deployments, self-hosted Hypha instances, or local
 * outage simulations during development.
 *
 * Always import this constant instead of hardcoding the URL so that
 * environment-based overrides flow through every fetch, link, and code
 * example consistently.
 */
export const HYPHA_SERVER_URL =
  process.env.REACT_APP_HYPHA_SERVER_URL || 'https://hypha.aicell.io';
