/**
 * Whether this browser can mount a local folder, and what to say when it
 * cannot.
 *
 * Mounting uses the File System Access API (`window.showDirectoryPicker`),
 * which Chromium has and Firefox and Safari do not. Both call sites used to
 * invoke it unguarded, so on those browsers the user got the raw exception
 * rendered as the error: "Failed to select folder:
 * window.showDirectoryPicker is not a function". That sentence tells a
 * scientist nothing they can act on, and it reads like a broken page rather
 * than an unsupported browser.
 *
 * WHAT THIS DOES NOT FIX. There is no browser-side upload path for local
 * images: every upload goes through the data-provider service the mounted
 * folder registers, and the broker has no method to mint a presigned PUT for
 * one. So on a browser without the API a user cannot add local images at all,
 * and the frontend cannot change that on its own. This module makes the limit
 * legible and names the routes that do work; the capability itself is tracked
 * separately.
 */

/** True when this browser can hand back a directory handle. */
export function canMountLocalFolder(): boolean {
  return typeof (globalThis as any)?.showDirectoryPicker === 'function';
}

/**
 * The sentence shown instead of a folder button that cannot work.
 *
 * It names the browsers rather than saying "your browser is unsupported",
 * because the first question a reader has is which one to open. It also names
 * the two routes that need no local folder, so the page is not a dead end.
 */
export const NO_LOCAL_FOLDER_SUPPORT =
  'Mounting a local folder needs the File System Access API, which Chrome and Edge have and ' +
  'Firefox and Safari do not. In this browser you can still open a dataset someone shared with ' +
  'you, or add images from a remote URL.';

/**
 * Turn a folder-picker failure into something worth reading.
 *
 * A cancelled picker is NOT an error: the user closed the dialog on purpose,
 * and reporting that as a failure is noise. `null` means "say nothing".
 */
export function describeFolderPickError(err: unknown): string | null {
  if ((err as Error)?.name === 'AbortError') return null;
  if (!canMountLocalFolder()) return NO_LOCAL_FOLDER_SUPPORT;
  const message = (err as Error)?.message;
  return message ? `Could not open that folder: ${message}` : 'Could not open that folder.';
}
