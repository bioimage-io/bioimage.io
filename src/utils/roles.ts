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

/**
 * Collection admin: delete-capable moderator (site / workspace owner). Only
 * these users may finalize a deletion on the Deletion Request page. Reviewers
 * (rw+) cannot delete; uploaders may delete only their own unpublished models.
 */
export function getIsCollectionAdmin(user: RoleUser | null | undefined): boolean {
  return !!user?.roles?.includes('admin');
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
