import { exportFailureMessage } from './exportFailureMessage';

/**
 * The fixture is the real thing: the error a deployed export actually
 * produced, copied from `get_export_status`. A hand-written "traceback" would
 * let the parser pass against a shape the service never sends.
 */
const REAL_FAILURE = [
  'ray::ServeReplica:model-finetune:RuntimeApp.handle_request_with_rejection()',
  ' (pid=492359, ip=172.25.5.249, actor_id=d38300d16de47f9464a8b5cb01000000,',
  ' repr=<ray.serve._private.replica.ServeReplica:model-finetune:RuntimeApp object at 0x713c6ca791d0>)',
  '    async for result in self._replica_impl.handle_request_with_rejection(',
  '  File "/home/ray/anaconda3/lib/python3.11/site-packages/ray/serve/_private/replica.py", line 1640, in handle_request_with_rejection',  // agent-env-check: allow (a path inside the service container, not a person)
  '    raise self._maybe_wrap_grpc_exception(e, request_metadata) from e',
  '  File "/home/bioengine/apps/bioimage-io-model-finetune/source/runtime.py", line 870, in export_bioimageio',
  '    raise RuntimeError(',
  'RuntimeError: BioImage.IO export failed (rc=1)',
].join('\n');

/**
 * The SECOND real failure, from a later run of the same export. The service
 * appended three thousand characters of the subprocess's own output to the
 * same RuntimeError, and the live page then read:
 *
 *   "The training service said: BioImage.IO export failed (rc=1): 2 |"
 *
 * which is a line-number gutter from a build log presented as a reason.
 */
const REAL_FAILURE_WITH_LOG = [
  'Traceback (most recent call last):',
  '  File "/home/bioengine/apps/bioimage-io-model-finetune/source/runtime.py", line 870, in export_bioimageio',
  '    raise RuntimeError(',
  'RuntimeError: BioImage.IO export failed (rc=1): 2 |',
  '  3 | conda.gateways.disk.delete:unlink_or_rename_to_trash(184): Could not remove or rename',
  '/home/ray/anaconda3/conda-meta/idna-3.10-pyhd8ed1ab_1.json.  Please remove this file manually',  // agent-env-check: allow (a path inside the service container, not a person)
  'micro_sam not found timm not found bioimageio.core not found',
].join('\n');

describe('exportFailureMessage', () => {
  it('leads with a sentence, not with Ray', () => {
    const { sentence, details } = exportFailureMessage(REAL_FAILURE);
    expect(sentence).not.toMatch(/ray::|ServeReplica|pid=|0x[0-9a-f]{6}/);
    expect(sentence).not.toMatch(/File "/);
    // And the raw text is not thrown away: it is kept for whoever can read it.
    expect(details).toBe(REAL_FAILURE);
  });

  it('says there is no reason WHEN THERE IS NONE, rather than quoting a return code', () => {
    // Measured: the deployed trainer raises this with an empty captured
    // stderr, so "rc=1" is the whole of what it knows. Printing that as a
    // reason would look like an explanation and is not one.
    const { sentence } = exportFailureMessage(REAL_FAILURE);
    expect(sentence).not.toMatch(/rc=1/);
    // THIS fixture carries no captured output: the packaging step printed
    // nothing and the details hold only a Ray wrapper. Saying "what it
    // printed is under the details below" would assert output the service
    // never gave, which a review caught, so the sentence says how little
    // was said instead.
    expect(sentence).toMatch(/without saying why/i);
    expect(sentence).not.toMatch(/under the details below/i);
  });

  it('says plainly that there is no reason when there is also nothing to open', () => {
    // A single line carrying only a return code: no traceback, so no details
    // toggle, so the sentence must not send the reader to one.
    const { sentence, details } = exportFailureMessage('BioImage.IO export failed (rc=1)');
    expect(details).toBeUndefined();
    expect(sentence).toMatch(/without saying why/i);
    expect(sentence).not.toMatch(/details below/i);
  });

  it('does NOT quote a build log as a reason, however long it is', () => {
    // This is the case the live page got wrong: the subprocess output was
    // appended to the exception text, so the "reason" began with a line
    // number from a log gutter.
    const { sentence, details } = exportFailureMessage(REAL_FAILURE_WITH_LOG);
    expect(sentence).not.toMatch(/rc=1/);
    expect(sentence).not.toMatch(/\|/);
    expect(sentence).not.toMatch(/conda|micro_sam|anaconda/);
    // It points at where the output IS, since it is kept.
    expect(sentence).toMatch(/under the details below/i);
    expect(details).toBe(REAL_FAILURE_WITH_LOG);
  });

  it('keeps a quoted reason to ONE line', () => {
    const { sentence } = exportFailureMessage(
      'Traceback (most recent call last):\n'
      + 'ValueError: the checkpoint is missing\nand here is a paragraph\nof extra output',
    );
    expect(sentence).toContain('the checkpoint is missing');
    expect(sentence).not.toContain('paragraph');
  });

  it('QUOTES a reason when the service gives one', () => {
    const { sentence } = exportFailureMessage(
      'Traceback (most recent call last):\n'
      + '  File "/x.py", line 3, in f\n'
      + 'ValueError: the checkpoint for this run is missing',
    );
    expect(sentence).toContain('the checkpoint for this run is missing');
    expect(sentence).not.toMatch(/without saying why/i);
  });

  it('takes the LAST exception line, not an earlier one', () => {
    // A chained traceback carries the cause first and the raised error last,
    // and the raised one is what happened.
    const { sentence } = exportFailureMessage(
      'Traceback (most recent call last):\n'
      + 'KeyError: weights\n'
      + '\nThe above exception was the direct cause of the following:\n\n'
      + 'Traceback (most recent call last):\n'
      + 'RuntimeError: packaging step failed',
    );
    expect(sentence).toContain('packaging step failed');
    expect(sentence).not.toContain('KeyError');
  });

  it('does NOT read a disk permission failure as a sign-in problem', () => {
    // The shape this nearly shipped with. conda prints
    // "PermissionError: [Errno 13] Permission denied" while tidying its own
    // files, and the service appends that log to the exception, so matching
    // PermissionError anywhere in the raw text turned a disk failure inside
    // the packaging step into "this export belongs to a different sign-in".
    const withPermissionNoise = [
      'Traceback (most recent call last):',
      '  File "/home/bioengine/apps/x/source/runtime.py", line 870, in export_bioimageio',  // agent-env-check: allow (a path inside the service container, not a person)
      'RuntimeError: BioImage.IO export failed (rc=1): 2 |',
      '  3 | PermissionError: [Errno 13] Permission denied: /opt/conda/pkgs/urllib3.json',
      '  4 | conda.gateways.disk.delete: Could not remove or rename',
    ].join('\n');
    const { sentence } = exportFailureMessage(withPermissionNoise);
    expect(sentence).not.toMatch(/different sign-in/i);
    expect(sentence).not.toMatch(/start a new export/i);
    expect(sentence).toMatch(/packaging step/i);
  });

  it('does not call a RUN ownership refusal an export ownership refusal', () => {
    // The service raises the same error class for a run as for an export.
    // Reported as an export problem it named something the service never
    // mentioned, and offered "start a new export", which would be refused
    // again for the same reason. This is the service's own wording, from
    // its run-ownership guard.
    const { sentence } = exportFailureMessage(
      'Traceback (most recent call last):\n'
      + 'training.NotTheOwner: this training run belongs to another caller; only its owner '
      + 'or a workspace administrator can change it',
    );
    expect(sentence).toMatch(/training run belongs to someone else/i);
    expect(sentence).not.toMatch(/start a new export/i);
  });

  it('names the ownership case, which is the one a user can act on', () => {
    const { sentence } = exportFailureMessage(
      'Traceback (most recent call last):\n'
      + 'training.NotTheOwner: export 1b3e belongs to another user',
    );
    expect(sentence).toMatch(/belongs to a different sign-in/i);
    expect(sentence).toMatch(/sign in as the person who started it/i);
  });

  it('passes a short single-line message straight through, with no details toggle', () => {
    // Nothing is gained by hiding a sentence the service already wrote well,
    // and a details toggle holding the same words is noise.
    const { sentence, details } = exportFailureMessage('Export cancelled.');
    expect(sentence).toContain('Export cancelled.');
    expect(details).toBeUndefined();
  });

  it('says something when the service says nothing at all', () => {
    for (const empty of ['', '   ', null, undefined]) {
      const { sentence } = exportFailureMessage(empty);
      expect(sentence).toMatch(/gave no reason/i);
    }
  });

  it('reads an Error as well as a string', () => {
    const { sentence } = exportFailureMessage(new Error(REAL_FAILURE));
    expect(sentence).toMatch(/without saying why/i);
  });

  it('obeys the project rules for user-visible text', () => {
    const inputs = [REAL_FAILURE, 'ValueError: nope', 'training.NotTheOwner: x', '', 'short'];
    for (const input of inputs) {
      const { sentence } = exportFailureMessage(input);
      expect(sentence).not.toMatch(/—/); // em dash
      expect(sentence).not.toMatch(/–/); // en dash
      expect(sentence).not.toMatch(/;/);
    }
  });
});
