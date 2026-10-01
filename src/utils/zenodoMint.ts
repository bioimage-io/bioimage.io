/**
 * Mint a Zenodo version for an artifact after a successful commit (svamp #0062).
 *
 * The rule this implements: every model-change commit should produce a Zenodo
 * version, while a Hypha version is cut only when the weights change. The Hypha
 * half already holds without new code, enforced by `weightGuard` in Edit.tsx
 * (:1940, :2208): a weights change cannot be made in place on a published
 * version, so it is forced into a new version, and a non-weights change edits in
 * place. This module adds the missing half.
 *
 * NOTE: before this, the website had NEVER minted anything. There is no other
 * `publish()` call in src/. The 19 existing sandbox DOIs were minted by
 * scripts/publish_to_zenodo.py, a standalone batch script. So this is the first
 * frontend minting path, not a rewiring of an existing one.
 *
 * ## Why real Zenodo is gated behind an explicit opt-in
 *
 * `publish()` resolves its target from `config.publish_to`, which on the
 * bioimage.io collection is `sandbox_zenodo`. Minting on every commit is
 * harmless there: sandbox DOIs do not resolve and the site does not show them.
 *
 * Against REAL Zenodo the same code mints a real DOI on every commit, and a DOI
 * is permanent. It cannot be deleted or un-minted. A typo-fix commit would
 * produce a citable record forever. Inheriting whatever `publish_to` happens to
 * say would mean that flipping one config value silently converts every save
 * into a permanent public act, with no code change to review. So the target is
 * checked here and real Zenodo requires `allowRealZenodo` to be passed
 * deliberately.
 */

/** Sandbox target. DOIs minted here use the 10.5072 prefix and do not resolve. */
export const SANDBOX_ZENODO = 'sandbox_zenodo';
/** Production target. DOIs minted here are PERMANENT. */
export const REAL_ZENODO = 'zenodo';

export interface MintableConfig {
  publish_to?: string | null;
}

/** The target `publish()` would resolve, or null when the artifact declares none. */
export const resolveMintTarget = (config: MintableConfig | null | undefined): string | null =>
  config?.publish_to ?? null;

/**
 * True only for the production target.
 *
 * Deliberately a allow-list of one rather than `!== SANDBOX_ZENODO`: an unknown
 * or misspelled target must not be treated as production (which would block
 * minting) nor as sandbox (which would mint somewhere unintended). Callers
 * handle "neither" as "do not mint".
 */
export const isRealZenodo = (target: string | null): boolean => target === REAL_ZENODO;

export type MintOutcome =
  /** publish() was called and returned. */
  | { status: 'minted'; target: string }
  /** No publish_to on the artifact, so there is nothing to mint to. */
  | { status: 'skipped'; reason: 'no-target' }
  /** Target is real Zenodo and the caller did not opt in. */
  | { status: 'refused'; reason: 'real-zenodo-not-opted-in'; target: string }
  /** Target is set but recognised as neither sandbox nor production. */
  | { status: 'skipped'; reason: 'unknown-target'; target: string }
  /** publish() threw. The commit itself already succeeded and is NOT rolled back. */
  | { status: 'failed'; target: string; error: unknown };

export interface MintArgs {
  artifactManager: { publish: (args: any) => Promise<unknown> } | null | undefined;
  artifactId: string;
  config: MintableConfig | null | undefined;
  /** Must be passed explicitly to mint a PERMANENT DOI. */
  allowRealZenodo?: boolean;
}

/**
 * Mint a Zenodo version. Never throws.
 *
 * The commit has already succeeded by the time this runs, so a minting failure
 * must not surface as a failed save or trigger a rollback: the artifact state is
 * correct either way, and only the Zenodo record is missing. Callers report the
 * outcome rather than treating it as fatal.
 */
export const mintZenodoVersion = async ({
  artifactManager,
  artifactId,
  config,
  allowRealZenodo = false,
}: MintArgs): Promise<MintOutcome> => {
  const target = resolveMintTarget(config);
  if (!target) return { status: 'skipped', reason: 'no-target' };
  if (isRealZenodo(target) && !allowRealZenodo) {
    return { status: 'refused', reason: 'real-zenodo-not-opted-in', target };
  }
  if (target !== SANDBOX_ZENODO && !isRealZenodo(target)) {
    return { status: 'skipped', reason: 'unknown-target', target };
  }
  if (!artifactManager) return { status: 'skipped', reason: 'no-target' };
  try {
    await artifactManager.publish({ artifact_id: artifactId, to: target, _rkwargs: true });
    return { status: 'minted', target };
  } catch (error) {
    return { status: 'failed', target, error };
  }
};
