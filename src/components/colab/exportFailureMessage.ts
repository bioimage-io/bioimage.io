/**
 * What to show a user when an export fails.
 *
 * The export dialog used to render the service's error text unchanged. What
 * that produced, measured on a real failure, began:
 *
 *     ray::ServeReplica:model-finetune:RuntimeApp.handle_request_with_rejection()
 *     (pid=492359, ip=172.25.5.249, actor_id=d38300d16de47f9464a8b5cb01000000,
 *     repr=<ray.serve._private.replica.ServeReplica:model-finetune:RuntimeApp
 *     object at 0x713c6ca791d0>) ...
 *
 * and ran through six frames of Ray internals before reaching the only line
 * that carries meaning: `RuntimeError: BioImage.IO export failed (rc=1)`. A
 * user is handed a process id, a container address and a Python object
 * address, and is not told what happened or what to do.
 *
 * So the panel shows a sentence, and keeps the raw text for whoever can use
 * it. The sentence is built from what the service actually said rather than
 * from a guess: where the service gave a reason, it is quoted, and where it
 * gave none, the sentence says so instead of inventing one.
 */

export interface ExportFailure {
  /** One sentence, always present, safe to show on its own. */
  sentence: string;
  /**
   * The service's own text, when it is something a reader should not be
   * shown first: a traceback, or anything spanning several lines. Absent
   * when the service's message was already a single readable line, since
   * repeating it under a details toggle adds nothing.
   */
  details?: string;
}

/** A remote Python failure, however it is wrapped on the way here. */
const REMOTE_TRACEBACK = /Traceback \(most recent call last\)|ray::ServeReplica|File "[^"]+", line \d+/;

/**
 * The last `SomeError: text` line of a Python traceback, which is the
 * exception that was actually raised. Earlier lines of that shape belong to
 * frames and to chained causes, so this takes the LAST one.
 */
function finalException(raw: string): { type: string; text: string } | null {
  const lines = raw.split('\n').map((l) => l.trim()).filter(Boolean);
  for (let i = lines.length - 1; i >= 0; i--) {
    const m = /^([A-Za-z_][\w.]*(?:Error|Exception|Interrupt|Exit))\s*:\s*(.*)$/.exec(lines[i]);
    if (m) return { type: m[1], text: m[2].trim() };
  }
  return null;
}

/**
 * The trainer's "a subprocess exited non-zero" shape, which carries no
 * sentence a reader can act on however long it is.
 *
 * Measured twice on the deployed service, and the two runs looked different
 * enough to be worth naming. One raised `BioImage.IO export failed (rc=1)`
 * with nothing after it. Another raised the same thing with three thousand
 * characters of the subprocess's own output appended, ending in conda
 * warnings about files it could not remove and the words "micro_sam not
 * found timm not found bioimageio.core not found".
 *
 * Neither is a reason. The first says only that something exited 1, and the
 * second says that plus a build log. Quoting either into a sentence produces
 * what the live page showed before this: "The training service said:
 * BioImage.IO export failed (rc=1): 2 |". So anything carrying `(rc=N)`
 * goes to the details, and the sentence says where to look.
 */
const SUBPROCESS_FAILURE = /\(rc=\d+\)/;

/**
 * The first line of a reason, capped. Even a legitimate exception message
 * can carry a paragraph behind it, and the headline is one sentence.
 */
function firstLine(text: string): string {
  const line = text.split('\n')[0].trim();
  return line.length > 180 ? `${line.slice(0, 177)}...` : line;
}

export function exportFailureMessage(rawInput: unknown): ExportFailure {
  const raw = String((rawInput as Error)?.message ?? rawInput ?? '').trim();
  if (!raw) {
    return { sentence: 'The export failed, and the training service gave no reason.' };
  }

  const isRemote = REMOTE_TRACEBACK.test(raw);
  const multiline = raw.includes('\n');
  const details = isRemote || multiline ? raw : undefined;
  const final = finalException(raw);

  // The reload case, and the one a user can act on: the service binds an
  // export to the identity that started it.
  if (/NotTheOwner|not the owner|belongs to another|PermissionError/i.test(raw)) {
    return {
      sentence:
        'This export belongs to a different sign-in, so it cannot be followed from here. '
        + 'Sign in as the person who started it, or start a new export.',
      details,
    };
  }

  const reason = final?.text || (multiline ? '' : raw);
  if (!reason || SUBPROCESS_FAILURE.test(reason)) {
    // Where the output is kept matters, so the sentence says so only when
    // there IS something to open.
    return {
      sentence: details
        ? 'The export could not be built. A packaging step on the training service '
          + 'failed, and what it printed is under the details below. Try again, and if it '
          + 'keeps failing, the service operators can read the full run log.'
        : 'The export could not be built. The training service reported a failure '
          + 'without saying why. Try again, and if it keeps failing, the service '
          + 'operators can read the run log.',
      details,
    };
  }

  // A single clean line is worth quoting, and it is the only case where the
  // service's own words reach the reader.
  return {
    sentence: `The export could not be built. The training service said: ${firstLine(reason)}`,
    details,
  };
}
