import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import ExportModelDialog from './ExportModelDialog';

/**
 * The dialog's ERROR PATH, rendered, with a service that fails the way the
 * real one does.
 *
 * A review named this gap exactly: the classifier had its own cases, the
 * source had a grep, and the live spec drove a real export but skipped
 * without two environment variables and asserted only that the headline
 * lacked `ray::`. None of those says the sentence comes FIRST or that the
 * service's text starts hidden, which is what the row asks for. This does,
 * in jsdom, in a second, and it red-greens against the mutant that puts the
 * raw text back in the headline.
 *
 * The fixture is the real failure, copied from `get_export_status` on the
 * deployed trainer.
 */

const REAL_FAILURE = [
  'ray::ServeReplica:model-finetune:RuntimeApp.handle_request_with_rejection()',
  ' (pid=492359, ip=172.25.5.249, actor_id=d38300d16de47f9464a8b5cb01000000,',
  ' repr=<ray.serve._private.replica.ServeReplica:model-finetune:RuntimeApp object at 0x713c6ca791d0>)',
  '  File "/home/ray/anaconda3/lib/python3.11/site-packages/ray/serve/_private/replica.py", line 1640',  // agent-env-check: allow (a path inside the service container, not a person)
  'RuntimeError: BioImage.IO export failed (rc=1)',
].join('\n');

jest.mock('../../utils/trainingServicePin', () => ({
  resolvePinnedTrainingService: jest.fn(),
}));
const { resolvePinnedTrainingService } = jest.requireMock('../../utils/trainingServicePin');

const renderDialog = () => render(
  <ExportModelDialog
    open
    onClose={() => {}}
    server={{}}
    artifactManager={{}}
    user={{ id: 'github|1', email: 'someone@example.org' }}
    datasetArtifactId="bioimage-io/annotation-abc"
    annotationLabel="cells"
    session={{ session_id: '2026-11-26-221026-9625fda8', model_type: 'vit_t_lm' }}
    onExported={() => {}}
  />,
);

beforeEach(() => {
  jest.clearAllMocks();
  resolvePinnedTrainingService.mockResolvedValue({
    // The failure arrives from the very first call, which is the shortest
    // path to the error panel and exercises the same catch.
    export_model: jest.fn().mockRejectedValue(new Error(REAL_FAILURE)),
  });
});

describe('the export dialog when the service fails', () => {
  it('leads with a sentence and starts the service text COLLAPSED', async () => {
    renderDialog();
    // The name field is reachable by its label, which it was not before:
    // both labels here were plain text beside an input.
    await userEvent.type(screen.getByLabelText(/model name/i), 'A model');
    await userEvent.click(screen.getByRole('button', { name: /^export as model$/i }));

    const panel = await screen.findByText(/could not be built/i, {}, { timeout: 5000 });

    // FIRST: no Ray internals in what the reader meets.
    expect(panel.textContent).not.toMatch(/ray::|ServeReplica|pid=\d+|0x[0-9a-f]{6,}/);

    const details = screen.getByTestId('export-error-details');
    // The raw text is kept.
    expect(details.textContent).toMatch(/ray::ServeReplica/);
    // COLLAPSED. `<details>` without `open` hides its content, and the row
    // asks for the sentence first rather than a wall of traceback.
    const element = details.closest('details') as HTMLDetailsElement;
    expect(element).not.toBeNull();
    expect(element.open).toBe(false);

    // DOM ORDER: the sentence precedes the details, so "first" is true of
    // the document and not only of the screenshot I happened to take.
    const position = panel.compareDocumentPosition(element);
    // eslint-disable-next-line no-bitwise
    expect(position & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it('shows the raw text once the reader asks for it', async () => {
    renderDialog();
    await userEvent.type(screen.getByLabelText(/model name/i), 'A model');
    await userEvent.click(screen.getByRole('button', { name: /^export as model$/i }));
    await screen.findByText(/could not be built/i, {}, { timeout: 5000 });

    const element = screen.getByTestId('export-error-details').closest('details') as HTMLDetailsElement;
    await userEvent.click(screen.getByText(/what the training service reported/i));
    await waitFor(() => expect(element.open).toBe(true));
  });
});
