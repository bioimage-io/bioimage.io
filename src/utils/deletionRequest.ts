// Helpers for the "request deletion" flow. Uploaders and reviewers cannot
// delete models outright (only site-admins can, and only via the Deletion
// Request page). Instead they MARK a model for deletion with a required
// reason; a site-admin later finalizes the actual delete.
//
// The mark is written into the STAGED manifest (never committed), so:
//   - the live/published version is never mutated,
//   - a published model under review doesn't get its pending staged edits
//     accidentally published,
//   - the mark is discoverable by reading the staged children of the collection.
// The reason is also appended to the model's comment thread (comments.json),
// matching "state a reason for deletion in the comments".

import { v4 as uuidv4 } from 'uuid';
import { Comment, CommentsData } from '../types/comments';
import { RoleUser } from './roles';

export interface DeletionRequest {
  requested_by: string;
  requested_by_email?: string;
  reason: string;
  requested_at: number;
}

/** Read a valid (non-empty-reason) deletion request off an artifact, or null. */
export function getDeletionRequest(artifact: any): DeletionRequest | null {
  const r = artifact?.manifest?.request_deletion;
  if (r && typeof r.reason === 'string' && r.reason.trim()) {
    return r as DeletionRequest;
  }
  return null;
}

// Append a "Deletion requested" entry to comments.json (best-effort). The
// artifact must already be in staging (requestDeletion stages it first).
async function appendDeletionComment(
  artifactManager: any,
  artifactId: string,
  reason: string,
  user: RoleUser,
): Promise<void> {
  let comments: Comment[] = [];
  try {
    const url = await artifactManager.get_file({
      artifact_id: artifactId,
      file_path: 'comments.json',
      version: 'stage',
      _rkwargs: true,
    });
    const resp = await fetch(url);
    if (resp.ok) {
      const data: CommentsData = await resp.json();
      comments = data.comments || [];
    }
  } catch {
    // No comments yet — start a fresh thread.
  }

  comments.push({
    id: uuidv4(),
    content: `🗑️ Deletion requested — ${reason}`,
    userId: user.id,
    userName: user.email || user.id,
    createdAt: new Date().toISOString(),
  });

  const body: CommentsData = { comments, lastUpdated: new Date().toISOString() };
  const putUrl = await artifactManager.put_file({
    artifact_id: artifactId,
    file_path: 'comments.json',
    _rkwargs: true,
  });
  await fetch(putUrl, {
    method: 'PUT',
    body: JSON.stringify(body, null, 2),
    headers: { 'Content-Type': '' }, // s3 presigned-url workaround (see Comments.tsx)
  });
}

/**
 * Mark a model for deletion with a required reason. Stages the flag onto the
 * manifest (no commit) and appends the reason to the comment thread.
 * Throws if the reason is empty (the request is invalid without one).
 */
export async function requestDeletion(
  artifactManager: any,
  artifact: any,
  reason: string,
  user: RoleUser,
): Promise<void> {
  const trimmed = reason.trim();
  if (!trimmed) {
    throw new Error('A reason is required to request deletion.');
  }

  // Read the freshest full manifest (staged if present, else committed) so we
  // don't drop fields when replacing the staged manifest.
  let current: any;
  try {
    current = await artifactManager.read({ artifact_id: artifact.id, stage: true, _rkwargs: true });
  } catch {
    current = await artifactManager.read({ artifact_id: artifact.id, _rkwargs: true });
  }

  const manifest = {
    ...(current?.manifest || {}),
    request_deletion: {
      requested_by: user.id,
      requested_by_email: user.email,
      reason: trimmed,
      requested_at: Date.now(),
    } as DeletionRequest,
  };

  await artifactManager.edit({
    artifact_id: artifact.id,
    manifest,
    stage: true,
    _rkwargs: true,
  });

  try {
    await appendDeletionComment(artifactManager, artifact.id, trimmed, user);
  } catch (e) {
    // Reason is still preserved on manifest.request_deletion; comment is a bonus.
    console.error('Failed to append deletion-request comment:', e);
  }
}
