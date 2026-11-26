import { classifyBrokerError } from './brokerApi';

/**
 * What to put on screen when one image fails to load.
 *
 * Extracted from the annotate page's catch so the decision can be tested
 * without a server, a kernel and a router, and because it has three outcomes
 * rather than one.
 *
 * The defect that produced it: the catch showed `err.message` verbatim, and on
 * a dataset the visitor may not read that message is the broker's refusal as
 * Hypha delivers it, which is a raw Ray traceback. Measured logged out, 6,115
 * characters of it covering the right third of the viewport, carrying an
 * internal cluster IP, `/tmp/ray/session` paths and a module's line numbers.
 * Two things wrong at once: a visitor with no access was shown the service's
 * internals, and the one sentence they could have acted on was beside a wall
 * of Python.
 *
 * The three outcomes:
 *
 *   SILENT      a permission refusal. The page already has a surface for it,
 *               the "This dataset is private" card with a Login button, and a
 *               second telling of the same news beside it is noise. This is
 *               also the case that was leaking.
 *   CLASSIFIED  anything whose text is a remote traceback. The banner says
 *               something a reader can act on and the raw text goes to the
 *               details affordance, which is where a developer can still find
 *               it, and to `console.error`.
 *   VERBATIM    everything else. These are OUR sentences, written for the
 *               person reading them: the refusal naming a resampled axis, the
 *               one naming a channel count. Rewriting them would lose the only
 *               part that helps.
 */

export interface ImageLoadBanner {
  /** False when nothing should be shown. */
  show: boolean;
  /** The banner's text. Empty when `show` is false. */
  message: string;
  /** Raw error text, for the banner's details popup. Absent when the message IS the raw text. */
  details?: string;
}

/**
 * The marker of a remote Python traceback arriving as a message.
 *
 * Chosen over "is it long" or "does it contain a path": hypha-rpc does not
 * carry the remote exception's class across the wire, only `str(exception)`,
 * and for a Ray-served app that string begins with this line. A length rule
 * would catch a long sentence of ours; this catches the thing itself.
 */
const REMOTE_TRACEBACK = /Traceback \(most recent call last\)/;

/** A sentence for an error whose own text cannot be shown. */
function classifiedSentence(err: unknown): string {
  switch (classifyBrokerError(err)) {
    case 'not-registered':
      return 'This dataset is not registered with the annotation service, so its images cannot be opened.';
    case 'unavailable':
      return 'The annotation service is unavailable, so this image could not be opened. Try again in a moment.';
    case 'auth-expired':
      return 'Your session expired, so this image could not be opened. Log in again to continue.';
    default:
      return 'This image could not be opened. The annotation service reported an error, and the details are below.';
  }
}

export function imageLoadBanner(err: unknown): ImageLoadBanner {
  // A refusal has its own card. Suppressed BEFORE anything is read off the
  // error, because this is the case where the error text is the service's
  // internals and the reader has no access to this dataset at all.
  if (classifyBrokerError(err) === 'permission-denied') {
    return { show: false, message: '' };
  }

  const raw = String((err as Error)?.message ?? err ?? '').trim();
  if (!raw) {
    return { show: true, message: 'This image could not be opened.' };
  }
  if (REMOTE_TRACEBACK.test(raw)) {
    return { show: true, message: classifiedSentence(err), details: raw };
  }
  return { show: true, message: raw };
}
