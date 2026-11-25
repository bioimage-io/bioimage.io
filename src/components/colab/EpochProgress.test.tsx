import React from 'react';
import { render, screen } from '@testing-library/react';
import EpochProgress from './EpochProgress';
import { epochProgressOf, outcomeForStatus } from '../../utils/trainingProgress';

// These exist because the only case reachable against the worker the page
// talks to today is the EMPTY one: deNBI runs model-finetune 0.16.1, which
// never writes the epoch fields, so a browser check there sees nothing
// rendered. "Nothing rendered" is also exactly what a broken implementation
// looks like, so the live check cannot tell the two apart on its own. These
// supply the other side: given a measured payload, this is what appears.

const measured = (n_epochs: number | null, n_epochs_completed: number) =>
  epochProgressOf({
    n_epochs,
    n_epochs_completed,
    n_epochs_completed_basis: 'measured',
  });

describe('EpochProgress renders a measured count', () => {
  it('shows the count against the total, with a bar at the right width', () => {
    render(<EpochProgress progress={measured(10, 3)} isRunning />);
    expect(screen.getByTestId('epoch-progress')).toBeInTheDocument();
    expect(screen.getByText('3 of 10 epochs completed')).toBeInTheDocument();

    const bar = screen.getByRole('progressbar');
    expect(bar).toHaveAttribute('aria-valuenow', '3');
    expect(bar).toHaveAttribute('aria-valuemax', '10');
    expect(bar.firstElementChild).toHaveStyle({ width: '30%' });
  });

  it('advances when a later poll reports a higher count', () => {
    const { rerender } = render(<EpochProgress progress={measured(10, 3)} isRunning />);
    expect(screen.getByText('3 of 10 epochs completed')).toBeInTheDocument();

    rerender(<EpochProgress progress={measured(10, 7)} isRunning />);
    expect(screen.queryByText('3 of 10 epochs completed')).not.toBeInTheDocument();
    expect(screen.getByText('7 of 10 epochs completed')).toBeInTheDocument();
    expect(screen.getByRole('progressbar').firstElementChild).toHaveStyle({ width: '70%' });
  });

  it('shows a bare count and no bar when the backend reported no total', () => {
    render(<EpochProgress progress={measured(null, 4)} isRunning />);
    expect(screen.getByText('4 epochs completed')).toBeInTheDocument();
    expect(screen.queryByRole('progressbar')).not.toBeInTheDocument();
  });

  it('colours the bar by whether the run is still going', () => {
    const { rerender } = render(<EpochProgress progress={measured(10, 10)} isRunning />);
    expect(screen.getByRole('progressbar').firstElementChild).toHaveClass('bg-blue-500');

    // The outcome is now REQUIRED for green. This case used to omit it and
    // still expect emerald, which is precisely the fail-open behaviour a
    // review flagged: a caller that forgets the prop must not get the success
    // colour.
    rerender(<EpochProgress progress={measured(10, 10)} isRunning={false} outcome="completed" />);
    expect(screen.getByRole('progressbar').firstElementChild).toHaveClass('bg-emerald-500');
  });
});

describe('EpochProgress renders nothing when no claim is allowed', () => {
  // The case this component is most responsible for getting right.
  it('renders nothing for a Cellpose floor_if_completed count', () => {
    const progress = epochProgressOf({
      n_epochs: 10,
      n_epochs_completed: 4,
      n_epochs_completed_basis: 'floor_if_completed',
    });
    const { container } = render(<EpochProgress progress={progress} isRunning />);
    expect(container).toBeEmptyDOMElement();
    expect(screen.queryByTestId('epoch-progress')).not.toBeInTheDocument();
  });

  // What every session on deNBI 0.16.1 looks like today.
  it('renders nothing when the worker never wrote the fields', () => {
    const { container } = render(<EpochProgress progress={epochProgressOf({})} isRunning />);
    expect(container).toBeEmptyDOMElement();
  });

  it('renders nothing for an absent count with a present total', () => {
    const progress = epochProgressOf({ n_epochs: 10, n_epochs_completed_basis: 'measured' });
    const { container } = render(<EpochProgress progress={progress} isRunning />);
    expect(container).toBeEmptyDOMElement();
  });
});

// Added after a REFUSE in round 1. The bar used to take the SUCCESS colour for
// any terminal run, so a FAILED run looked exactly like a clean finish on a
// page whose purpose is telling those apart.
describe('a run that did not succeed does not get the success colour', () => {
  const measured = (total: number | null, completed: number) =>
    epochProgressOf({
      n_epochs: total ?? undefined,
      n_epochs_completed: completed,
      n_epochs_completed_basis: 'measured',
    });

  it('does not paint an unsuccessful run the completed green', () => {
    render(<EpochProgress progress={measured(10, 3)} isRunning={false} outcome="unsuccessful" />);
    const bar = screen.getByRole('progressbar').firstElementChild;
    expect(bar).not.toHaveClass('bg-emerald-500');
    expect(bar).toHaveClass('bg-gray-400');
  });

  it('still paints a clean finish green', () => {
    render(<EpochProgress progress={measured(10, 10)} isRunning={false} outcome="completed" />);
    expect(screen.getByRole('progressbar').firstElementChild).toHaveClass('bg-emerald-500');
  });

  it('keeps aria-valuenow within aria-valuemax when the count overruns', () => {
    render(<EpochProgress progress={measured(10, 12)} isRunning={false} outcome="completed" />);
    const bar = screen.getByRole('progressbar');
    expect(bar).toHaveAttribute('aria-valuemax', '10');
    expect(bar).toHaveAttribute('aria-valuenow', '10');
    // The raw count stays readable in the label rather than being rounded away.
    expect(bar).toHaveAttribute('aria-label', '12 of 10 epochs completed');
  });
});


// Added after round 2: the colour must FAIL SAFE. The first fix tested for
// 'unsuccessful', so a caller that omitted the prop fell through to green.
describe('the bar only goes green on an explicit success', () => {
  const measured = (total: number | null, completed: number) =>
    epochProgressOf({
      n_epochs: total ?? undefined,
      n_epochs_completed: completed,
      n_epochs_completed_basis: 'measured',
    });

  it('is not green when the outcome prop is missing entirely', () => {
    render(<EpochProgress progress={measured(10, 3)} isRunning={false} />);
    expect(screen.getByRole('progressbar').firstElementChild).not.toHaveClass('bg-emerald-500');
  });

  it.each(['FAILED', 'STOPPED', 'SOMETHING_NEW'])('is not green for status %s', (status) => {
    render(
      <EpochProgress
        progress={measured(10, 3)}
        isRunning={false}
        outcome={outcomeForStatus(status)}
      />,
    );
    expect(screen.getByRole('progressbar').firstElementChild).not.toHaveClass('bg-emerald-500');
  });

  it('is green for COMPLETED, driven through the same mapping', () => {
    render(
      <EpochProgress
        progress={measured(10, 10)}
        isRunning={false}
        outcome={outcomeForStatus('COMPLETED')}
      />,
    );
    expect(screen.getByRole('progressbar').firstElementChild).toHaveClass('bg-emerald-500');
  });
});
