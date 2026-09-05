import { BASE_URL } from './baseUrl';

/**
 * Refuse to run against something that is not this site.
 *
 * Dev servers from several checkouts (and from unrelated projects) share this
 * machine, and whoever starts first takes port 3000. Without this check the
 * suite happily drove another product's dev server and reported a wall of
 * confusing selector failures. Fail once, up front, with the actual reason.
 */
export default async function globalSetup() {
  let manifest: { short_name?: string };
  try {
    const res = await fetch(`${BASE_URL}/manifest.json`);
    manifest = await res.json();
  } catch (err) {
    throw new Error(
      `No dev server answering at ${BASE_URL}.\n` +
        `Start one with \`BROWSER=none pnpm start\`, or point the suite at an ` +
        `existing one with E2E_BASE_URL.\n(${(err as Error).message})`,
    );
  }
  if (manifest.short_name !== 'BioImage.IO') {
    throw new Error(
      `${BASE_URL} is serving "${manifest.short_name}", not BioImage.IO.\n` +
        `Another project's dev server holds that port. Set E2E_BASE_URL to this ` +
        `checkout's server instead.`,
    );
  }
}
