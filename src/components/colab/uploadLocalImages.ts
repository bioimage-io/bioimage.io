import { finishLocalImageUpload, startLocalImageUpload } from './brokerApi';

/**
 * Put images the user picked from a file dialog into a dataset.
 *
 * The route every other upload takes goes through the data-provider service
 * that a MOUNTED folder registers with the kernel, and mounting needs the File
 * System Access API, which Chromium has and Firefox and Safari do not. So on
 * those browsers a user could open somebody else's dataset and annotate it but
 * could never contribute an image of their own, and the page could only tell
 * them to change browser.
 *
 * This is the other route: the broker mints a presigned PUT for one image, the
 * browser sends the bytes straight to storage, and the broker finishes. The
 * manifest entry is written by neither of them. The object lands at
 * `images/<stem><ext>` and the dataset's ordinary listing reconciliation turns
 * it into a `local` entry, which is what happens to an image uploaded through
 * a mount, so an image added this way is indistinguishable afterwards rather
 * than merely similar.
 *
 * THE PUT SENDS THE BODY BARE. The presigned signature covers the
 * `Content-Type` header, so setting one is a 403 rather than a mis-typed
 * object. `fetch` adds no such header for a `Blob` body unless the blob
 * carries a type, which a `File` from a picker does, so the body is sent as a
 * plain `ArrayBuffer` and not as the `File`.
 */

/** The extensions the broker accepts. A file picker filters on these too. */
export const LOCAL_IMAGE_EXTENSIONS = ['.png', '.jpg', '.jpeg', '.tif', '.tiff'] as const;

/** `accept` for an `<input type="file">`, from the same list. */
export const LOCAL_IMAGE_ACCEPT = LOCAL_IMAGE_EXTENSIONS.join(',');

export type UploadOutcome =
  | { status: 'uploaded'; filename: string; stem: string }
  /** The dataset already has that stem. Not an error, and nothing was changed. */
  | { status: 'already'; filename: string; stem: string }
  | { status: 'skipped'; filename: string; reason: string }
  | { status: 'failed'; filename: string; reason: string };

export interface UploadLocalImagesOptions {
  server: any;
  artifactId: string;
  files: File[];
  /** Called after each file, so a long run is not silent. */
  onProgress?: (done: number, total: number, outcome: UploadOutcome) => void;
  /** Injected so the tests need no network. Defaults to `fetch`. */
  put?: (url: string, body: ArrayBuffer) => Promise<{ ok: boolean; status: number }>;
}

/** `'scan01.png'` from a `File`, with no path, which is what the broker wants. */
function filenameOf(file: File): string {
  // `webkitRelativePath` is set when the picker was a directory one, and it
  // carries the folder. The broker REFUSES a path rather than taking its
  // basename, so the basename is taken here, deliberately and visibly.
  const raw = file.name || '';
  const cut = Math.max(raw.lastIndexOf('/'), raw.lastIndexOf('\\'));
  return cut >= 0 ? raw.slice(cut + 1) : raw;
}

function hasUploadableExtension(filename: string): boolean {
  const lower = filename.toLowerCase();
  return LOCAL_IMAGE_EXTENSIONS.some((ext) => lower.endsWith(ext));
}

const defaultPut = async (url: string, body: ArrayBuffer) => {
  const res = await fetch(url, { method: 'PUT', body });
  return { ok: res.ok, status: res.status };
};

/** A sentence, from whatever the failure actually was. */
const readable = (err: unknown): string =>
  (err as Error)?.message || 'Something went wrong. Please try again.';

/**
 * Upload the files, one at a time, and report every outcome.
 *
 * ONE AT A TIME on purpose. Each upload is a mint, a PUT and a finish against
 * one dataset, and the mint reconciles the dataset's whole image listing to
 * answer "is this stem taken?". Running several at once would have them race
 * that question, which is the race the broker's no-overwrite check exists to
 * lose safely rather than one worth creating here.
 *
 * NEVER THROWS for one bad file. A picker returns whatever the user selected,
 * including a PDF among the images, and failing the batch on the first of them
 * would lose the uploads that worked. Every file gets an outcome and the
 * caller decides what to say.
 */
export async function uploadLocalImages(
  opts: UploadLocalImagesOptions,
): Promise<UploadOutcome[]> {
  const { server, artifactId, files, onProgress, put = defaultPut } = opts;
  const outcomes: UploadOutcome[] = [];

  for (const file of files) {
    const filename = filenameOf(file);
    let outcome: UploadOutcome;
    try {
      if (!hasUploadableExtension(filename)) {
        outcome = {
          status: 'skipped',
          filename,
          reason: `only ${LOCAL_IMAGE_EXTENSIONS.join(', ')} can be uploaded`,
        };
      } else {
        const start = await startLocalImageUpload(server, artifactId, filename);
        if (start.already) {
          outcome = { status: 'already', filename, stem: start.stem };
        } else if (file.size > start.max_bytes) {
          // Refused BEFORE the bytes are sent. The broker enforces the same
          // ceiling after they land, which costs an upload and a deletion;
          // knowing the limit here means neither happens.
          outcome = {
            status: 'skipped',
            filename,
            reason:
              `${Math.round(file.size / 1024 / 1024)} MB is over the `
              + `${Math.round(start.max_bytes / 1024 / 1024)} MB limit for one image`,
          };
        } else {
          const body = await file.arrayBuffer();
          const res = await put(start.put_url, body);
          if (!res.ok) {
            // NOT reported as success. A presigned PUT can be refused after
            // the URL was minted, and a 403 in particular is what a
            // Content-Type header on the request produces.
            outcome = { status: 'failed', filename, reason: `upload refused (${res.status})` };
          } else {
            const done = await finishLocalImageUpload(
              server,
              artifactId,
              filename,
              start.mint_id,
            );
            outcome = { status: 'uploaded', filename, stem: done.stem };
          }
        }
      }
    } catch (err) {
      outcome = { status: 'failed', filename, reason: readable(err) };
    }
    outcomes.push(outcome);
    onProgress?.(outcomes.length, files.length, outcome);
  }

  return outcomes;
}

/** One sentence summarising a batch, for a banner. */
export function summariseUploads(outcomes: UploadOutcome[]): string {
  const count = (status: UploadOutcome['status']) =>
    outcomes.filter((o) => o.status === status).length;
  const uploaded = count('uploaded');
  const already = count('already');
  const skipped = count('skipped');
  const failed = count('failed');

  const parts: string[] = [];
  parts.push(`${uploaded} image${uploaded === 1 ? '' : 's'} added`);
  // Each of the other three is named ONLY when it happened, so the sentence
  // does not report three zeroes at somebody who picked three files and got
  // three images.
  if (already > 0) parts.push(`${already} already in the dataset`);
  if (skipped > 0) parts.push(`${skipped} skipped`);
  if (failed > 0) parts.push(`${failed} failed`);
  return `${parts.join(', ')}.`;
}
