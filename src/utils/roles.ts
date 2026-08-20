// Central definitions of who may do what to model artifacts in the
// bioimage-io/bioimage.io collection.
//
// Three distinct concepts, deliberately kept separate (they used to be
// conflated into a single "isCollectionAdmin" flag):
//
//   - isReviewer        moderator who may edit / stage / add-remove files /
//                       create versions / commit (accept) / discard staged
//                       changes on ANY model in the zoo. Cannot delete.
//   - isCollectionAdmin delete-capable admin (site / workspace owner). The
//                       ONLY role that may finalize a deletion.
//   - artifact rights   the ACTUAL Hypha permission the current user holds on
//                       one specific artifact (uploader / per-artifact edit /
//                       per-artifact delete). Gating actions on these avoids
//                       showing buttons that would 403.
//
// See model-artifact-handling-plan.md for the full capability matrix.

export interface RoleUser {
  id: string;
  /**
   * The stable human user id when `id` is an ephemeral token id. Hypha's
   * `generate_token` mints a child token whose `id` is random (e.g.
   * "helix-mind-47125673") and carries the real id (e.g. "github|49943582")
   * in `parent`. See `UserInfo.get_effective_user_id()` in hypha/core.
   */
  parent?: string;
  email?: string;
  roles?: string[];
}

export interface CollectionConfig {
  permissions?: Record<string, string>;
}

// Collection permission codes that grant write (edit / commit) access.
const REVIEWER_CODES = new Set(['rw', 'rw+', '*']);

/**
 * Every identity a Hypha permissions map may be keyed on for this user.
 *
 * Hypha resolves a permission entry by token id, then by effective (parent)
 * id, then by email (artifact.py `_check_permissions`), so a grant written
 * against any one of them is honoured by the backend. Matching only on
 * `user.id` here made the UI treat an email-keyed or parent-keyed grant as no
 * permission at all, hiding actions the backend would have allowed.
 *
 * `email` and `parent` are both optional on a Hypha UserInfo, so blanks are
 * dropped rather than being looked up as a literal "undefined" key.
 */
function permissionKeys(user: RoleUser): string[] {
  return [user.id, user.parent, user.email].filter(
    (key): key is string => typeof key === 'string' && key.length > 0,
  );
}

/**
 * True when the entry under ANY of the user's identities satisfies `grants`.
 *
 * Checks every identity rather than stopping at the first entry found, because
 * hypha does the same: a user whose id-keyed entry lacks an operation is still
 * allowed it when their email-keyed entry grants it.
 */
function anyIdentityGrants(
  permissions: Record<string, unknown> | null | undefined,
  user: RoleUser,
  grants: (permission: unknown) => boolean,
): boolean {
  if (!permissions) return false;
  return permissionKeys(user).some((key) => {
    const permission = permissions[key];
    return permission !== undefined && grants(permission);
  });
}

/**
 * Reviewer / moderator. May edit, stage, add/remove files, create versions,
 * commit (accept to the zoo) and discard staged changes on any model. Granted
 * by a write-level entry in the collection permissions, or the site-admin role.
 * Reviewers cannot delete models.
 */
export function getIsReviewer(
  user: RoleUser | null | undefined,
  collectionConfig: CollectionConfig | null | undefined,
): boolean {
  if (!user) return false;
  if (user.roles?.includes('admin')) return true;
  return anyIdentityGrants(
    collectionConfig?.permissions,
    user,
    (code) => typeof code === 'string' && REVIEWER_CODES.has(code),
  );
}

/**
 * The reviewer permission level granted on a model when it enters review.
 * `rw+` lets reviewers read, edit and commit (accept) the model but not delete
 * it, matching the reviewer capability matrix above.
 */
export const REVIEWER_PERMISSION_LEVEL = 'rw+';

/**
 * Build the `config.permissions` map a model should carry while under review.
 *
 * Starts from the model's existing permissions (so the uploader keeps their
 * `*`) and grants every reviewer from the collection `rw+`. A reviewer is any
 * user whose collection permission code is a write-level code (`rw`/`rw+`/`*`),
 * exactly the same rule `getIsReviewer` uses, so the two never drift. Existing
 * `*` or `rw+` entries are left untouched (never downgrade the uploader).
 *
 * This is what "Submit for Review" applies in-place (staged edit, no commit) so
 * reviewers can act on the model. Programmatic submission must do the same.
 */
export function buildReviewerPermissions(
  collectionConfig: CollectionConfig | null | undefined,
  existingPermissions: Record<string, string> | null | undefined,
): Record<string, string> {
  const permissions: Record<string, string> = { ...(existingPermissions || {}) };
  const collectionPerms = collectionConfig?.permissions || {};
  for (const [userId, code] of Object.entries(collectionPerms)) {
    if (typeof code !== 'string' || !REVIEWER_CODES.has(code)) continue;
    // Never downgrade an owner (`*`) or an already-reviewer (`rw+`) entry.
    const current = permissions[userId];
    if (current === '*' || current === REVIEWER_PERMISSION_LEVEL) continue;
    permissions[userId] = REVIEWER_PERMISSION_LEVEL;
  }
  return permissions;
}

/**
 * The permission level granted to a model's RDF authors/maintainers. Same
 * level as reviewers: edit, add/remove files, create versions, commit; not
 * delete.
 */
export const CONTRIBUTOR_PERMISSION_LEVEL = 'rw+';

interface ContributorEntry {
  email?: string;
}

export interface ContributorManifest {
  authors?: ContributorEntry[];
  maintainers?: ContributorEntry[];
}

export interface ContributorPermissionsResult {
  permissions: Record<string, string>;
  contributorKeys: string[];
}

function contributorEmails(manifest: ContributorManifest | null | undefined): Set<string> {
  const emails = new Set<string>();
  const collect = (entries?: ContributorEntry[]) => {
    for (const entry of entries || []) {
      const email = entry?.email?.trim().toLowerCase();
      if (email) emails.add(email);
    }
  };
  collect(manifest?.authors);
  collect(manifest?.maintainers);
  return emails;
}

/**
 * Build the `config.permissions` map (and the provenance list that should
 * accompany it) for a model's current RDF authors/maintainers, matched by
 * email. Every author/maintainer with an email gets `rw+`, never downgrading
 * an existing `*` or `rw+` entry.
 *
 * Also revokes access for anyone who *was* granted access by a previous run
 * of this function (tracked via `previousContributorKeys`, meant to be
 * persisted as `config.contributor_permission_keys`) but is no longer an
 * author/maintainer. A revoke only happens if the entry still holds exactly
 * `rw+` — if it has since become something else (e.g. an uploader's `*`, or
 * a reviewer/ops grant), this function is no longer the sole owner of that
 * entry and leaves it alone, only dropping it from the provenance list.
 *
 * This is what makes the sync safe to run on every commit without clobbering
 * permissions granted for unrelated reasons (uploader, reviewer, manual ops).
 */
export function buildContributorPermissions(
  manifest: ContributorManifest | null | undefined,
  existingPermissions: Record<string, string> | null | undefined,
  previousContributorKeys: string[] | null | undefined,
): ContributorPermissionsResult {
  const permissions: Record<string, string> = { ...(existingPermissions || {}) };
  const desired = contributorEmails(manifest);

  for (const key of previousContributorKeys || []) {
    if (desired.has(key)) continue;
    if (permissions[key] === CONTRIBUTOR_PERMISSION_LEVEL) {
      delete permissions[key];
    }
  }

  for (const key of desired) {
    const current = permissions[key];
    if (current === '*' || current === CONTRIBUTOR_PERMISSION_LEVEL) continue;
    permissions[key] = CONTRIBUTOR_PERMISSION_LEVEL;
  }

  return { permissions, contributorKeys: Array.from(desired) };
}

/** The Hypha workspace that owns the model collection. */
export const COLLECTION_WORKSPACE = 'bioimage-io';

/**
 * Collection admin: a delete-capable moderator. Delete under `bioimage-io/*` is
 * granted by **workspace ownership** (Wei, Nils, …), NOT the global Hypha
 * `admin` role — workspace owners report an empty `roles` array yet can delete,
 * which is exactly why the old `roles.includes('admin')` check hid the Deletion
 * Request page from the very people meant to use it. So gate on membership in
 * the `bioimage-io` workspace `owners` list (fetched via fetchCollectionOwners),
 * keeping global admins as an additional allow.
 */
export function getIsCollectionAdmin(
  user: RoleUser | null | undefined,
  owners?: string[] | null,
): boolean {
  if (!user) return false;
  if (user.roles?.includes('admin')) return true;
  if (!Array.isArray(owners)) return false;
  // Hypha matches workspace owners on id OR email, and deliberately NOT on
  // `parent` (see the owners check in hypha/core). Accepting `parent` here
  // would show Delete to a session hypha would then reject.
  return (
    (!!user.id && owners.includes(user.id)) ||
    (!!user.email && owners.includes(user.email))
  );
}

/**
 * Fetch the `bioimage-io` workspace owners (the delete-capable admins). Works
 * cross-workspace from a normal user session; returns [] on any error so the
 * caller simply treats the user as non-admin.
 */
export async function fetchCollectionOwners(server: any): Promise<string[]> {
  try {
    const info = await server.getWorkspaceInfo(COLLECTION_WORKSPACE);
    return (info && (info.owners as string[])) || [];
  } catch {
    return [];
  }
}

export interface ArtifactRights {
  /** Current user uploaded / owns this specific artifact. */
  isUploader: boolean;
  /** Current user holds `edit` (or `*`) on this specific artifact. */
  hasArtifactEdit: boolean;
  /** Current user holds `delete` (or `*`) on this specific artifact. */
  hasArtifactDelete: boolean;
}

/**
 * Per-artifact capabilities derived from the artifact's resolved `_permissions`
 * map plus uploader identity. Reflects the real Hypha permission on THIS
 * artifact, independent of collection-wide roles.
 */
export function getArtifactRights(
  user: RoleUser | null | undefined,
  artifact: any,
): ArtifactRights {
  if (!user || !artifact) {
    return { isUploader: false, hasArtifactEdit: false, hasArtifactDelete: false };
  }
  const holds = (operation: string) => (permission: unknown) =>
    Array.isArray(permission)
      ? permission.includes(operation) || permission.includes('*')
      : permission === '*';
  const hasArtifactEdit = anyIdentityGrants(artifact._permissions, user, holds('edit'));
  const hasArtifactDelete = anyIdentityGrants(artifact._permissions, user, holds('delete'));
  const uploaderEmail = artifact.manifest?.uploader?.email?.toLowerCase?.();
  const matchesUploaderEmail =
    !!uploaderEmail && uploaderEmail === user.email?.toLowerCase?.();
  const isUploader =
    (!!artifact.created_by && artifact.created_by === user.id) || matchesUploaderEmail;
  return { isUploader, hasArtifactEdit, hasArtifactDelete };
}

/** A model is "published" once it has at least one committed version. */
export function isPublished(artifact: any): boolean {
  return Array.isArray(artifact?.versions) && artifact.versions.length > 0;
}
