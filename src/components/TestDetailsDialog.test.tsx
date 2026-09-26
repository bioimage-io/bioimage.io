import React from 'react';
import { render, screen } from '@testing-library/react';
import TestDetailsDialog from './TestDetailsDialog';

// The inference check has three states, and `skipped` must not be painted as a
// failure. model-runner 2.10.4+ records it for models that declare their own
// conda environment, where the default-environment check could only ever fail
// on a missing import and says nothing about the model. Live case:
// stupendous-sheep passes with test_environment=custom while its report used to
// carry inference_check failed / ModuleNotFoundError: No module named empanada.

const report = (inference: { status: string; error: string | null }) => ({
  name: 'MitoNet 2D',
  source_name: 'stupendous-sheep',
  id: 'stupendous-sheep',
  version: '0.1.0',
  type: 'model',
  format_version: '0.5.4',
  status: 'valid-format',
  inference_check: inference,
  details: [],
  env: [['bioimageio.core', '0.11.0']],
  conda_list: null,
});

const open = (inference: { status: string; error: string | null }) =>
  render(
    <TestDetailsDialog
      open
      onClose={() => {}}
      data={report(inference) as any}
      isLoading={false}
      type="test-report"
    />,
  );

describe('TestDetailsDialog inference check', () => {
  it('presents a skipped check as not-run rather than failed', () => {
    open({ status: 'skipped', error: 'model declares its own environment; the default-environment check does not apply' });

    expect(screen.getByText('Inference check')).toBeInTheDocument();
    expect(screen.getByText('skipped')).toBeInTheDocument();
    // The body must say the check did not run and that this is not a verdict.
    expect(screen.getByText(/This check was not run/)).toBeInTheDocument();
    expect(screen.getByText(/says nothing about whether the model works/)).toBeInTheDocument();
  });

  it('shows the reason as information, not as an error alert', () => {
    const { baseElement } = open({ status: 'skipped', error: 'model declares its own environment' });
    expect(baseElement.querySelector('.MuiAlert-standardInfo')).toBeTruthy();
    expect(baseElement.querySelector('.MuiAlert-standardError')).toBeNull();
  });

  it('still shows a real failure as an error', () => {
    const { baseElement } = open({ status: 'failed', error: "ModuleNotFoundError: No module named 'empanada'" });
    expect(screen.getByText('failed')).toBeInTheDocument();
    expect(baseElement.querySelector('.MuiAlert-standardError')).toBeTruthy();
    expect(baseElement.querySelector('.MuiAlert-standardInfo')).toBeNull();
    expect(screen.queryByText(/This check was not run/)).toBeNull();
  });

  it('describes the check normally when it passed', () => {
    open({ status: 'passed', error: null });
    expect(screen.getByText('passed')).toBeInTheDocument();
    expect(screen.getByText(/Verifies the model runs in the standard bioimageio.core environment/)).toBeInTheDocument();
  });
});
