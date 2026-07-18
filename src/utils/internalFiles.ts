// Files stored inside a model artifact for internal platform use. They are
// never shown in the user-facing file lists (editor tree or the public Files
// view) so they can't be accidentally edited or deleted — e.g. `comments.json`
// backs the review comment thread and is managed entirely by the Comments UI.
//
// Hidden for EVERYONE, including reviewers and site admins.
export const INTERNAL_ARTIFACT_FILES = ['comments.json'];

/** True if `name` (a file name or path) is an internal, non-user-visible file. */
export function isInternalArtifactFile(name: string | undefined | null): boolean {
  if (!name) return false;
  const base = name.split('/').pop() || name;
  return INTERNAL_ARTIFACT_FILES.includes(base);
}
