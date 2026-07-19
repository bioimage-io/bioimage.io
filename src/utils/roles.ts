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
  email?: string;
  roles?: string[];
}

export interface CollectionConfig {
  permissions?: Record<string, string>;
}

// Collection permission codes that grant write (edit / commit) access.
const REVIEWER_CODES = new Set(['rw', 'rw+', '*']);

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
  const code = collectionConfig?.permissions?.[user.id];
  return typeof code === 'string' && REVIEWER_CODES.has(code);
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
  return Array.isArray(owners) && !!user.id && owners.includes(user.id);
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
  const artPerms = artifact._permissions?.[user.id];
  const hasArtifactEdit = Array.isArray(artPerms)
    ? artPerms.includes('edit') || artPerms.includes('*')
    : artPerms === '*';
  const hasArtifactDelete = Array.isArray(artPerms)
    ? artPerms.includes('delete') || artPerms.includes('*')
    : artPerms === '*';
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
