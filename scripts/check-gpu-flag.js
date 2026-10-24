#!/usr/bin/env node
/**
 * Pin the GPU flag the worker setup wizard emits for each container runtime.
 *
 * The wizard offers CDI (`--device nvidia.com/gpu=all`) as an opt-in alternative
 * to `--gpus=all` on Docker. CDI needs a host spec and a CDI-capable daemon that
 * installing the NVIDIA Container Toolkit does not give you, so emitting it by
 * accident produces a container that will not start — and the wrong flag is
 * invisible in the UI, because both forms look equally plausible in a copied
 * command. This fixes the whole truth table in place.
 *
 *   node scripts/check-gpu-flag.js
 *
 * getGpuFlag() is EXTRACTED from the component rather than retyped, so this
 * cannot drift into testing a copy that no longer matches what ships. The final
 * assertion runs the pre-CDI body as a control: it must FAIL the docker+CDI row,
 * otherwise a green table here would prove nothing.
 *
 * Exit 0 = the table holds. Exit 1 = a row is wrong. Exit 2 = the extraction
 * failed, which is deliberately NOT a pass.
 */
const fs = require('fs');
const path = require('path');

const SRC = path.join(__dirname, '..', 'src', 'components', 'bioengine', 'BioEngineGuide.tsx');
const match = fs.readFileSync(SRC, 'utf8').match(/const getGpuFlag = \(\) => \{\n([\s\S]*?)\n {2}\};/);
if (!match) {
  console.error('FATAL: could not extract getGpuFlag() from ' + SRC);
  process.exit(2);
}
const body = match[1];

// The body as it stood before CDI was offered, verbatim.
const PRE_CDI = `
    if (gpus <= 0) return '';
    if (containerRuntime === 'podman') return '--device nvidia.com/gpu=all ';
    if (containerRuntime === 'apptainer' || containerRuntime === 'singularity') return '--nv ';
    return '--gpus=all ';`;

const build = (src) => new Function('gpus', 'containerRuntime', 'dockerUseCdi', src);
const shipped = build(body);
const control = build(PRE_CDI);

const CDI = '--device nvidia.com/gpu=all ';
const ALL = '--gpus=all ';
const NV = '--nv ';

const rows = [
  [1, 'docker', false, ALL, 'docker default stays --gpus=all'],
  [1, 'docker', true, CDI, 'docker with CDI ticked emits the CDI form'],
  [0, 'docker', true, '', 'no GPUs: no flag, even with CDI ticked'],
  [1, 'podman', false, CDI, 'podman unchanged'],
  [1, 'podman', true, CDI, 'podman unaffected by the docker toggle'],
  [1, 'apptainer', true, NV, 'apptainer unaffected by the docker toggle'],
  [1, 'singularity', true, NV, 'singularity unaffected by the docker toggle'],
];

let pass = 0;
let fail = 0;
const check = (name, got, want) => {
  if (got === want) {
    console.log('  ok   ' + name);
    pass += 1;
  } else {
    console.log('  FAIL ' + name + ': expected [' + want + '] got [' + got + ']');
    fail += 1;
  }
};

for (const [gpus, runtime, cdi, want, name] of rows) {
  check(name, shipped(gpus, runtime, cdi), want);
}
check('CONTROL: pre-CDI body returns --gpus=all for docker+CDI', control(1, 'docker', true), ALL);

console.log('===== ' + (pass + fail) + ' assertion(s) run: ' + pass + ' pass, ' + fail + ' fail =====');
process.exit(fail === 0 ? 0 : 1);
