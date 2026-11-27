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
    // A dotted name whose LAST segment is capitalised, then a colon. Not a
    // list of known suffixes: the service's own ownership error is
    // `training.NotTheOwner`, which ends in none of Error, Exception,
    // Interrupt or Exit, so a suffix list silently failed to see the one
    // exception this file most needs to recognise.
    //
    // Capitalisation is what keeps log noise out. conda prints lines like
    // `conda.gateways.disk.delete:unlink_or_rename_to_trash(184): Could not
    // remove`, whose last segment is lowercase, so they are not read as the
    // raised exception.
    const m = /^((?:[A-Za-z_][\w]*\.)*[A-Z]\w*)\s*:\s*(.*)$/.exec(lines[i]);
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

  // OWNERSHIP, read from the FINAL exception line only, and only when that
  // line is about the thing it claims. Matching the whole raw text was
  // wrong twice over, and a review measured both.
  //
  // The service raises the same NotTheOwner for a RUN as for an export
  // ("this training run belongs to another caller"), so exporting somebody
  // else's run produced a sentence about an export the service never
  // mentioned, offering an action that would be refused for the same
  // reason. And `PermissionError` appears inside build logs for reasons
  // that have nothing to do with people: conda prints "PermissionError:
  // [Errno 13] Permission denied" while tidying its own files, so a disk
  // failure in the packaging step was reported to the user as a sign-in
  // problem.
  const ownership = final && /NotTheOwner|PermissionError/i.test(final.type)
    ? final.text
    : '';
  if (/belongs to another caller|belongs to another user|not the owner/i.test(ownership)) {
    const aboutARun = /training run|\brun\b/i.test(ownership) && !/export/i.test(ownership);
    return {
      sentence: aboutARun
        ? 'This training run belongs to someone else, and only the person who started it can '
          + 'export it.'
        : 'This export belongs to a different sign-in, so it cannot be followed from here. '
          + 'Sign in as the person who started it, or start a new export.',
      details,
    };
  }

  const reason = final?.text || (multiline ? '' : raw);
  if (!reason || SUBPROCESS_FAILURE.test(reason)) {
    // Does the service's message carry the step's OWN output, or only a
    // return code? Pointing at details that hold nothing but a Ray wrapper
    // asserts output the service never gave, which a review caught.
    //
    // Read from the WHOLE message, not from the final exception line: the
    // captured log runs on past that line, so asking the line alone said
    // "nothing was printed" about a message carrying three thousand
    // characters of build output.
    const afterCode = raw.split(/\(rc=\d+\)/).slice(1).join('');
    const printed = afterCode.replace(/[\s:|0-9]/g, '');
    return {
      sentence: printed
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
