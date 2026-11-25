/**
 * The plane is only useful if it is actually SENT, and no behavioural test in
 * this repository can see that.
 *
 * `displayedPlanes` is unit-tested next door and would stay green with its
 * caller deleted: jest never mounts `ImportRemoteSourceModal`, and the
 * production build only proves the module compiles, which it does with the
 * argument dropped because every parameter on the path is optional. So the
 * three links between a correct computation and a correct import are checked
 * here as SOURCE TEXT.
 *
 * This is explicitly not a behavioural test. It cannot tell whether the value
 * is right; the tests in ngffLayout.test.ts do that. It tells whether the
 * right value reaches the broker, which is the half that fails silently. A
 * previous round of this work shipped a helper whose call sites still read the
 * old field, with the whole suite green, which is the failure this guards.
 */

import fs from 'fs';
import path from 'path';

const read = (file: string) =>
  fs.readFileSync(path.join(__dirname, file), 'utf8');

describe('the displayed plane reaches the import call', () => {
  const modal = read('ImportRemoteSourceModal.tsx');
  const api = read('brokerApi.ts');

  it('the import dialog computes the plane from the probe', () => {
    expect(modal).toContain('displayedPlanesForProbe(probe)');
  });

  it('the import dialog PASSES it to importNgffImage', () => {
    // Argument order matters here and position is the only thing that carries
    // it, so the call is matched as a whole rather than by the name appearing
    // anywhere in the file.
    const call = modal.match(/importNgffImage\([\s\S]*?\);/);
    expect(call).not.toBeNull();
    expect(call![0]).toContain('planeChoice.planes');
  });

  it('the same value is what the dialog describes to the user', () => {
    // One computation, two uses. If the note were computed separately, the
    // dialog could say "slice 4" while the import recorded something else,
    // and nothing would contradict it.
    expect(modal).toMatch(/planeNote[\s\S]*?planeChoice\.planes/);
  });

  it('a layout no plane can describe blocks the import', () => {
    expect(modal).toContain('!!planeChoice.error');
  });

  it('and blocks it in the SUBMIT path too, not only on the button', () => {
    // A form can still be submitted by pressing Enter in a text field, so the
    // disabled button is not the whole guard. A reviewer deleted this check
    // and the entire suite stayed green, which is why it is pinned here: the
    // commit message claims the guard exists, and nothing else could tell.
    const submit = modal.match(/const handleSubmit[\s\S]*?\n  \};/);
    expect(submit).not.toBeNull();
    expect(submit![0]).toMatch(/if \(planeChoice\.error\)/);
    expect(submit![0]).toMatch(/return;/);
  });

  it('shows the PREVIEW at the plane it is about to record', () => {
    // Otherwise the dialog draws one slice and records another: the preview
    // pinned the drawn level's own middle slice, and on a pyramid that
    // downsamples z that is a different slice from the recorded level-0 one.
    const open = modal.match(/openImageSource\(\{[\s\S]*?\}\);/);
    expect(open).not.toBeNull();
    expect(open![0]).toMatch(/planes:/);
    expect(open![0]).toMatch(/planeChoice\.planes/);
    expect(open![0]).toMatch(/level0_shape/);
  });

  it('the pyramid derives EVERY level from the record', () => {
    const pyramid = read('ngffPyramid.ts');
    // The call that reads each level has to carry the record, or the levels
    // the canvas picks still pin their own middles.
    expect(pyramid).toMatch(/planeSelection\(array\.shape, levelRoles, axes, crop, recordedPlanes\)/);
  });

  it('the pyramid REFUSES a source whose plane cannot be resolved', () => {
    // The gap a review found: the record was threaded everywhere and passed
    // by one caller. On the page that actually draws, the ref carries no
    // record today, so without this the levels silently pin their own middle
    // slice. The refusal has to run BEFORE any pixel is fetched, which is
    // what the position of the call asserts.
    const pyramid = read('ngffPyramid.ts');
    expect(pyramid).toContain('assertPlaneIsResolvable(');
    const beforeReads = pyramid.indexOf('assertPlaneIsResolvable(');
    const firstRead = pyramid.indexOf('async function readBands');
    expect(beforeReads).toBeGreaterThan(0);
    expect(beforeReads).toBeLessThan(firstRead);
  });

  it('the ANNOTATOR’s ref carries the record, not only the preview', () => {
    // imageSourceRefFor is the one translation the annotate page and the
    // dataset overview both go through, so the record has to pass through it
    // or it never reaches the canvas where the region is drawn.
    const api = read('brokerApi.ts');
    const fn = api.match(/export function imageSourceRefFor[\s\S]*?\n\}/);
    expect(fn).not.toBeNull();
    expect(fn![0]).toMatch(/planes:/);
    expect(fn![0]).toMatch(/url\.level0_shape/);
  });

  it('and both pages still open through that one translation', () => {
    // If a page built its own ref inline, the record would be carried in one
    // place and dropped in another, which is the shape of this whole finding.
    for (const file of ['../../pages/AnnotatePage.tsx', 'DatasetOverview.tsx']) {
      const page = read(file);
      if (!page.includes('openImageSource')) continue;
      expect(page).toMatch(/imageSourceRefFor\(/);
    }
  });

  it('importNgffImage puts it in the RPC payload', () => {
    expect(api).toContain('payload.planes = wanted');
    expect(api).toContain('broker.import_ngff_image(payload)');
  });

  it('and OMITS the key entirely when there is no plane to record', () => {
    // Measured: the deployed service rejects an unknown kwarg, so sending
    // `planes: null` on every import would break the 2-D ones too. The
    // assignment must therefore be guarded, and the literal must not carry a
    // planes key of its own.
    expect(api).toMatch(/if \(wanted\) payload\.planes = wanted;/);
    const literal = api.match(/const payload: Record<string, unknown> = \{[\s\S]*?\};/);
    expect(literal).not.toBeNull();
    expect(literal![0]).not.toMatch(/planes/);
  });
});
