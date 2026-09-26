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

// The recorded package list is not necessarily conda. A standard-environment run
// records the serving venv as a pip freeze list, which carries no conda header.
// Requiring that header rendered nothing for those, and pushed the producer to
// synthesise a fake one just to satisfy the parser.
describe('installed-package list', () => {
  const withList = (saved: string) =>
    render(
      <TestDetailsDialog
        open
        onClose={() => {}}
        data={{ ...report({ status: 'passed', error: null }), saved_conda_list: saved } as any}
        isLoading={false}
        type="test-report"
      />,
    );

  it('renders a conda list and drops the stderr noise above the header', () => {
    withList(
      'WARNING conda.gateways.disk.delete: could not remove something\n'
      + '# packages in environment at /opt/envs/abc123:\n'
      + 'numpy                     1.26.4           pypi_0    pypi\n',
    );
    // The claim is that the parser produced a CLEAN block, not that the warning
    // is absent from the page: "Raw Data" also dumps the whole report verbatim,
    // warning and all, and that is correct because raw means raw. So assert that
    // at least one rendered block carries the header WITHOUT the warning.
    const blocks = screen.getAllByText(/packages in environment at \/opt\/envs\/abc123/);
    const clean = blocks.filter(el => !/conda.gateways.disk.delete/.test(el.textContent || ''));
    expect(clean.length).toBeGreaterThan(0);
  });

  it('renders a pip freeze list that has no conda header', () => {
    withList('torch==2.1.0\nnumpy==1.26.4\n');
    expect(screen.getAllByText(/torch==2\.1\.0/).length).toBeGreaterThan(0);
  });

  it('calls the section Installed packages, not Conda List', () => {
    withList('torch==2.1.0\n');
    expect(screen.getAllByText('Installed packages').length).toBeGreaterThan(0);
    expect(screen.queryByText('Conda List')).toBeNull();
  });
});

// The two shapes the runner actually emits, excerpted verbatim from the live
// 2.10.5 reports. Recorded as fixtures because the shape was described wrongly
// once already: the marker is mamba's, not conda's, because the runner swaps
// conda for mamba to get the libmamba solver.
const MAMBA_REAL = [
  'List of packages in environment: "/home/bioengine/apps/bioimage-io-model-runner/home/.bioengine/envs/abc123"',
  '',
  '  Name                                  Version       Build                              Channel',
  '──────────────────────────────────────────────────────────────────────────────────────────────────',
  '  _openmp_mutex                         4.5           20_gnu                             conda-forge',
  '  empanada-dl                           0.1.7         pyhd8ed1ab_0                       conda-forge',
].join('\n');

const PIP_REAL = ['absl-py==2.5.0', 'adlfs==2023.8.0', 'torch==2.1.0'].join('\n');

describe('package list: the shapes the runner really emits', () => {
  const withList = (saved: string) =>
    render(
      <TestDetailsDialog
        open
        onClose={() => {}}
        data={{ ...report({ status: 'passed', error: null }), saved_conda_list: saved } as any}
        isLoading={false}
        type="test-report"
      />,
    );

  it('renders a mamba list, which carries no conda header at all', () => {
    withList(MAMBA_REAL);
    expect(MAMBA_REAL).not.toContain('# packages in environment at');
    const blocks = screen.getAllByText(/List of packages in environment:/);
    expect(blocks.length).toBeGreaterThan(0);
    // the model's own declared dependency must survive the parse
    expect(screen.getAllByText(/empanada-dl\s+0\.1\.7/).length).toBeGreaterThan(0);
  });

  it('keeps mamba column alignment by stripping the indent uniformly', () => {
    withList(MAMBA_REAL);
    const block = screen.getAllByText(/List of packages in environment:/)[0];
    const lines = (block.textContent || '').split('\n');
    const header = lines.find(l => l.startsWith('Name'))!;
    const pkg = lines.find(l => l.startsWith('empanada-dl'))!;
    // both rows were indented by the same amount, so the columns still line up
    expect(pkg.indexOf('0.1.7')).toBe(header.indexOf('Version'));
  });

  it('renders a pip freeze list unchanged', () => {
    withList(PIP_REAL);
    expect(screen.getAllByText(/torch==2\.1\.0/).length).toBeGreaterThan(0);
  });
});
