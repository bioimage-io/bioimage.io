/**
 * Who an artifact belongs to, for the My Artifacts page.
 *
 * The page used to answer a narrower question than the one users ask. It listed
 * what you UPLOADED (`created_by == user.id`, or `manifest.uploader.email ==
 * user.email`), while a contributor asking "where are my models?" means every
 * model that carries their name. For Daniel Franco-Barranco that gap is 10 rows
 * shown against 76 that list him (measured 2026-10-24 against the live
 * collection: 52 models, 15 applications, 9 datasets).
 *
 * WHY NOT MATCH ON PERMISSIONS. "Everything I can edit" looks like the obvious
 * rule and is wrong. The collection grants its 13 reviewers write access on
 * every model, so for a reviewer that query returns the whole zoo: 294 of 316
 * artifacts for the same user, measured 2026-10-24. Nothing in this module
 * reads `config.permissions` or `_permissions`, and nothing should start to.
 *
 * WHY NAME IS ONE OF THE SIGNALS. Author entries frequently carry
 * `github_user` and a null `email`, while a Google session carries an email and
 * no GitHub handle, so the two never meet: matching authors by email alone
 * finds 0 of Daniel's 74 authored artifacts. The display name is the only field
 * that bridges session and manifest, so the match is a union of whatever
 * signals both sides happen to have.
 *
 * A name is a weak key, and that is acceptable HERE ONLY because this is a
 * view. A same-name collision shows someone one extra row in their own list of
 * an artifact that is already publicly listed. It grants nothing. This is not a
 * licence to match names when deciding permissions.
 */

/** The identity fields a Hypha session can offer. All are optional. */
export interface OwnershipUser {
  id?: string;
  /** Real user id when `id` is an ephemeral token id (see roles.ts). */
  parent?: string;
  email?: string;
  /** Display name. Present on some sessions and absent on others. */
  name?: string;
}

/** One `authors` / `maintainers` / `uploader` entry of an RDF manifest. */
interface ContributorEntry {
  name?: string;
  email?: string;
  github_user?: string;
}

export interface OwnershipMatch {
  /**
   * The user created or uploaded this artifact. A strong signal: it rests on
   * the session id or the uploader email, never on a display name.
   */
  isOwner: boolean;
  /** The user is named as an author, maintainer or uploader in the manifest. */
  isContributor: boolean;
}

/** No match at all, shared so callers can compare cheaply. */
const NO_MATCH: OwnershipMatch = { isOwner: false, isContributor: false };

/**
 * Compare two human-entered strings. Trims, collapses runs of whitespace and
 * lowercases, so "Daniel  Franco-Barranco" and "daniel franco-barranco" match.
 */
function normalize(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const normalized = value.trim().replace(/\s+/g, ' ').toLowerCase();
  return normalized.length > 0 ? normalized : null;
}

/** Every authorship entry of a manifest: authors, maintainers and the uploader. */
function contributorEntries(manifest: any): ContributorEntry[] {
  const entries: ContributorEntry[] = [];
  for (const key of ['authors', 'maintainers']) {
    const list = manifest?.[key];
    if (Array.isArray(list)) {
      for (const entry of list) {
        if (entry && typeof entry === 'object') entries.push(entry as ContributorEntry);
      }
    }
  }
  const uploader = manifest?.uploader;
  if (uploader && typeof uploader === 'object') entries.push(uploader as ContributorEntry);
  return entries;
}

/**
 * A display name short enough to be ambiguous is not used as a search key.
 * Three characters keeps real names ("Tom Lee" is 7) while dropping initials
 * and placeholder values that would match half the zoo.
 */
const MIN_NAME_LENGTH = 3;

/** The user's display name, normalized, when it is usable as a match key. */
export function matchableName(user: OwnershipUser | null | undefined): string | null {
  const name = normalize(user?.name);
  return name && name.length >= MIN_NAME_LENGTH ? name : null;
}

/**
 * The display names this user has signed their OWN uploads with, normalized.
 *
 * A Hypha session does not reliably carry a `name`: two of the most recent
 * sessions to leave a comment on the live zoo wrote a bare `github|NNN` /
 * `google-oauth2|NNN` as their author name, which is what the UI falls back to
 * when `user.name` is absent. Without a name there is nothing to match an
 * author entry on, and the whole widening collapses back to created-or-uploaded.
 *
 * So take the name from the artifacts the user has already PROVED are theirs.
 * `manifest.uploader.name` on an artifact matched by their own email or id is
 * their own account of who they are, and it is exactly the name they used in
 * the author lists. It also catches the spellings a session name cannot: the
 * author in this issue appears as both "Daniel Franco-Barranco" (74 artifacts)
 * and "Daniel Franco Barranco" (2), and his own uploads carry both.
 *
 * Only artifacts the user owns are read, so a stranger's manifest can never
 * contribute a name here.
 */
export function ownedDisplayNames(
  artifacts: any[] | null | undefined,
  user: OwnershipUser | null | undefined,
): string[] {
  const names = new Set<string>();
  for (const artifact of artifacts || []) {
    if (!getOwnership(artifact, user).isOwner) continue;
    const name = normalize(artifact?.manifest?.uploader?.name);
    if (name && name.length >= MIN_NAME_LENGTH) names.add(name);
  }
  return Array.from(names);
}

/**
 * The keywords to search the collection for, to find artifacts that NAME this
 * user. Hypha's full-text index covers manifest content, so an exact-match
 * post-filter with `getOwnership` is still required: the name "Daniel" alone
 * returns 84 artifacts where the full name returns 74 (measured 2026-10-24).
 */
export function identityKeywords(user: OwnershipUser | null | undefined): string[] {
  const keywords: string[] = [];
  const email = normalize(user?.email);
  if (email) keywords.push(email);
  const name = matchableName(user);
  if (name) keywords.push(name);
  return keywords;
}

/**
 * Why this artifact belongs in the user's My Artifacts list, if it does.
 *
 * Reads only `created_by` and the RDF manifest. Permissions are deliberately
 * not consulted (see the module comment).
 *
 * `extraNames` adds display names beyond `user.name`, normalized, typically
 * the ones `ownedDisplayNames` recovered from the user's own uploads.
 */
export function getOwnership(
  artifact: any,
  user: OwnershipUser | null | undefined,
  extraNames: string[] = [],
): OwnershipMatch {
  if (!artifact || !user) return NO_MATCH;

  const email = normalize(user.email);
  const names = new Set<string>(extraNames.filter((n) => n && n.length >= MIN_NAME_LENGTH));
  const sessionName = matchableName(user);
  if (sessionName) names.add(sessionName);

  const createdByUser =
    (!!user.id && artifact.created_by === user.id) ||
    (!!user.parent && artifact.created_by === user.parent);

  const manifest = artifact.manifest;
  const uploaderEmail = normalize(manifest?.uploader?.email);
  const uploadedByUser = !!email && uploaderEmail === email;

  let isContributor = false;
  for (const entry of contributorEntries(manifest)) {
    if (email && normalize(entry.email) === email) {
      isContributor = true;
      break;
    }
    const entryName = normalize(entry.name);
    if (entryName && names.has(entryName)) {
      isContributor = true;
      break;
    }
  }

  return { isOwner: createdByUser || uploadedByUser, isContributor };
}

/** True when the artifact belongs in the user's My Artifacts list at all. */
export function isMyArtifact(
  artifact: any,
  user: OwnershipUser | null | undefined,
  extraNames: string[] = [],
): boolean {
  const ownership = getOwnership(artifact, user, extraNames);
  return ownership.isOwner || ownership.isContributor;
}

/**
 * True when the ONLY reason the artifact is listed is that the manifest names
 * the user. These rows are labelled as authorship in the UI and do not offer
 * the owner actions (delete, request deletion).
 */
export function isContributorOnly(
  artifact: any,
  user: OwnershipUser | null | undefined,
  extraNames: string[] = [],
): boolean {
  const ownership = getOwnership(artifact, user, extraNames);
  return ownership.isContributor && !ownership.isOwner;
}
