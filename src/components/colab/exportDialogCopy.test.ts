import fs from 'fs';
import path from 'path';

/**
 * Two things the export dialog must not do, both measured on a real export.
 *
 * It said "Building package... (usually about 20 seconds)". Measured on a
 * cpsam run with a two-epoch checkpoint, polling the dialog every fifteen
 * seconds: about five minutes building, and still staging when a fifteen and a
 * half minute run was cut short. That is fifteen times the number on screen
 * and counting, and the first run of all ended with the panel gone and nothing
 * to explain it. A number that wrong is worse than none, because the reader
 * concludes the page has hung.
 *
 * And the message was set ONCE, before the poll loop, so it could not follow
 * the work even if the number had been right. The service reports its own
 * sub-phases in `status.message` ("staging package"), and the panel showed
 * those only while `phase === 'building'`, which is why ten minutes of staging
 * sat under a heading that said building.
 *
 * Asserted as SOURCE TEXT, like the other copy guards here: the dialog needs a
 * Hypha server, a kernel and a live export to render, so this cannot tell you
 * what it looks like. It can tell you the false promise has not come back.
 */

const SRC = fs.readFileSync(
  path.join(__dirname, 'ExportModelDialog.tsx'),
  'utf8',
);

/** Strip comments, which deliberately quote the old wording to explain it. */
const codeOnly = (source: string) =>
  source
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split('\n')
    .map((line) => line.replace(/\/\/.*$/, ''))
    .join('\n');

describe('the export dialog, while an export runs', () => {
  const code = codeOnly(SRC);

  it('promises no duration it cannot keep', () => {
    expect(code).not.toMatch(/usually about \d+ seconds/i);
    // Nor any other bare estimate in the status copy. The measured range is
    // minutes and depends on the model, so the sentence says that instead.
    expect(code).not.toMatch(/about \d+ seconds/i);
    expect(code).toMatch(/can take several minutes for a large model/);
  });

  it('shows the service\'s own sub-phase in every in-progress phase', () => {
    // Not gated on `phase === 'building'` any more: the service says "staging
    // package" long after the build, and hiding it left a frozen heading.
    expect(code).toMatch(/\{exportStatus\?\.message && \(/);
    expect(code).not.toMatch(/phase === 'building' && exportStatus\?\.message/);
  });

  it('names the package SIZE once it knows it', () => {
    // The only thing that predicts the upload wait, and it is known by then:
    // measured at 1.07 GB for a cpsam export, of which the weights file alone
    // is 1.22 GB uncompressed. A spinner with no number beside a gigabyte is
    // how a working page looks broken.
    expect(code).toMatch(/Uploading model files \(\$\{\(finalStatus\.size_bytes \/ 1e9\)\.toFixed\(2\)\} GB\)/);
    // And it falls back rather than printing "undefined GB".
    expect(code).toMatch(/finalStatus\.size_bytes\s*\?/);
  });

  it('is addressable as a dialog', () => {
    // It was a plain overlay: no role, no aria-modal, no label, where the
    // import dialog next door has all three. A screen reader announced
    // nothing, and the end-to-end check could find the button that opens it
    // and not the thing it opened.
    expect(code).toMatch(/role="dialog"/);
    expect(code).toMatch(/aria-modal="true"/);
    expect(code).toMatch(/aria-labelledby="export-model-dialog-title"/);
    expect(code).toMatch(/id="export-model-dialog-title"/);
  });
});
