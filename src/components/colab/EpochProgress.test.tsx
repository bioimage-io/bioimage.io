import React from 'react';
import { render, screen } from '@testing-library/react';
import EpochProgress from './EpochProgress';
import { epochProgressOf } from '../../utils/trainingProgress';

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
    expect(screen.getByText('Epoch 3 of 10')).toBeInTheDocument();

    const bar = screen.getByRole('progressbar');
    expect(bar).toHaveAttribute('aria-valuenow', '3');
    expect(bar).toHaveAttribute('aria-valuemax', '10');
    expect(bar.firstElementChild).toHaveStyle({ width: '30%' });
  });

  it('advances when a later poll reports a higher count', () => {
    const { rerender } = render(<EpochProgress progress={measured(10, 3)} isRunning />);
    expect(screen.getByText('Epoch 3 of 10')).toBeInTheDocument();

    rerender(<EpochProgress progress={measured(10, 7)} isRunning />);
    expect(screen.queryByText('Epoch 3 of 10')).not.toBeInTheDocument();
    expect(screen.getByText('Epoch 7 of 10')).toBeInTheDocument();
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

    rerender(<EpochProgress progress={measured(10, 10)} isRunning={false} />);
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
