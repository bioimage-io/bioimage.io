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
 * WHAT THIS IS STILL FOR, now that the limit is smaller. Adding IMAGES no
 * longer needs a mount: the broker mints a presigned PUT for one local image,
 * and a file picker uploads through it, so every browser can contribute its
 * own data. What still needs the API is picking a FOLDER, which is how a
 * dataset is created from one in a single step and how a mounted folder keeps
 * its images available without uploading them.
 *
 * So the sentence below is no longer a dead end, and it must not read like
 * one. It names the browsers, because the first question a reader has is which
 * one to open, and it names what they can do HERE rather than only elsewhere.
 */

/** True when this browser can hand back a directory handle. */
export function canMountLocalFolder(): boolean {
  return typeof (globalThis as any)?.showDirectoryPicker === 'function';
}

/**
 * The sentence shown instead of a folder button that cannot work.
 *
 * It names the browsers rather than saying "your browser is unsupported",
 * because the first question a reader has is which one to open, and it names
 * the picker first, because that is what does the same job.
 *
 * It says "from the dataset's own page" rather than "with the file picker",
 * and takes FOLDERS as well as files. Both were review findings on the first
 * wording: this sentence is also shown while CREATING a dataset, where no
 * picker exists yet, and the picker was never one file at a time.
 */
export const NO_LOCAL_FOLDER_SUPPORT =
  'Mounting a folder needs the File System Access API, which Chrome and Edge have and Firefox ' +
  'and Safari do not. In this browser you can still add images, or a whole folder of them, from ' +
  "the dataset's own page, open a dataset someone shared with you, or add images from a remote URL.";

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
