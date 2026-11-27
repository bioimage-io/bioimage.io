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

  it('drops the build\'s sub-phase when the build is over', () => {
    // Polling stops at READY, so an exportStatus left in place shows the
    // build's last message frozen under the two phases that follow it. A
    // review caught that "staging package" was still on screen under
    // "Uploading model files", which is the stale sub-phase this dialog was
    // just fixed for, one phase along.
    expect(code).toMatch(/setExportStatus\(\{ \.\.\.finalStatus, message: undefined \}\)/);
    // The MESSAGE only. Clearing the whole status took the done panel's
    // download link with it, because that link reads
    // `exportStatus.download_url`, and a live run then finished an export
    // with nothing to download. This is the assertion that would have
    // caught it without a fifteen-minute run.
    expect(code).not.toMatch(/setExportStatus\(null\)/);
    expect(code).toMatch(/exportStatus\?\.download_url/);
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

  it('warns, while the export runs, that a reload loses it', () => {
    // Said BEFORE the loss, because after it there is nothing left to say it
    // with. The export id lives only in the component: nothing writes it to
    // storage or the url, so a reload unmounts the dialog and the id is gone.
    // The user is not shown a refusal, they are shown nothing at all, which
    // is how the very first run of this flow ended.
    expect(code).toMatch(/Keep this tab open/);
    expect(code).toMatch(/does not keep track of an export across a reload/);
  });

  it('blames the PAGE, not the sign-in', () => {
    // An earlier version read "This export is tied to the sign-in that
    // started it". A review caught that my own measurement had refuted it:
    // only a signed-in owner can reach this dialog, the token survives the
    // reload in localStorage, and a second connection carrying it polled an
    // export the first had started. Telling the user their sign-in is the
    // problem points them at an action that would change nothing.
    expect(code).not.toMatch(/tied to the sign-in/);
    expect(code).not.toMatch(/sign in again to/i);
    // And it says the export is not cancelled by the reload, which is the
    // other thing a reader needs to know.
    expect(code).toMatch(/The export itself carries on/);
  });

  it('keeps that warning OUT of the finished and failed states', () => {
    // It belongs to the in-progress block only. A warning about losing an
    // export that has already finished is noise, and one shown beside an
    // error blames the wrong thing.
    //
    // A review pointed out that the first version of this case checked only
    // that the string was PRESENT in the in-progress branch, which its name
    // does not say and which a copy pasted into every branch would satisfy.
    // It now cuts the file at the branch boundaries and asserts the absence
    // where the name promises it.
    const [, afterInProgress = ''] = code.split("{(phase === 'building'");
    const [inProgress = '', rest = ''] = afterInProgress.split("{phase === 'done'");
    expect(inProgress).toMatch(/Keep this tab open/);
    // Everything from the done branch onwards, which includes the error
    // branch below it.
    expect(rest).not.toMatch(/Keep this tab open/);
    expect(rest.length).toBeGreaterThan(200);
  });

  it('does not claim the export can be recovered, because it cannot', () => {
    // The page must not promise recovery it does not perform. Note this is
    // NOT because recovery is impossible: measured, the export is bound to
    // the user and a second connection with the same token can poll it, so
    // keeping the id would be enough. It is simply not done, and a sentence
    // offering it would be describing a page that does not exist.
    expect(code).not.toMatch(/resume (the|this) export/i);
    expect(code).not.toMatch(/pick up where you left off/i);
  });

});
