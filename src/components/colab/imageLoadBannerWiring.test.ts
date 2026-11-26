import fs from 'fs';
import path from 'path';

/**
 * That the annotate page ACTS on a denied image load, and does not merely
 * decide about it.
 *
 * `imageLoadBanner` returning `deniesAccess` is worth nothing on its own: the
 * whole point of the flag is that the caller puts the access card up, and the
 * defect it exists for was precisely a decision that nothing acted on. A
 * reviewer found the first version silent in a state where no other surface
 * was showing: `permissionDenied` is set at mount time and in the save path
 * and NOWHERE else, so a role revoked while the page was open left the user
 * looking at the previous image with no card, no banner and no sentence.
 *
 * Asserted as SOURCE TEXT, like the wiring guards beside it and for the same
 * stated reason: `AnnotatePage.tsx` is a 2,500-line component behind a Hypha
 * server, a kernel, a router and a store, so a harness that mounts it is a
 * piece of work in its own right. This cannot tell you the card renders. It
 * can tell you the call that raises it is still there, which is the thing that
 * went missing.
 *
 * The behaviour either side of the wire is covered where it can be: the
 * decision in `imageLoadBanner.test.ts`, and the card itself in the anonymous
 * session spec, which drives a real refusal in a real browser.
 */

const read = (rel: string) => fs.readFileSync(path.join(__dirname, rel), 'utf8');

const PAGE = read('../../pages/AnnotatePage.tsx');

/** The image-load catch, from the console.error that opens it to the finally. */
function imageLoadCatch(source: string): string {
  const start = source.indexOf("console.error('[AnnotatePage] loadImageByStem failed:'");
  expect(start).toBeGreaterThan(-1);
  const end = source.indexOf('} finally {', start);
  expect(end).toBeGreaterThan(start);
  return source.slice(start, end);
}

describe('a denied image load reaches the access card', () => {
  it('the catch asks imageLoadBanner what to do', () => {
    expect(imageLoadCatch(PAGE)).toMatch(/const banner = imageLoadBanner\(err\)/);
  });

  it('and RAISES the card when the answer is a denial', () => {
    // The line the defect was missing. Without it the decision is made and
    // discarded, which is how "suppress the traceback" became "show nothing
    // at all" in the one state where nothing else speaks.
    const body = imageLoadCatch(PAGE);
    expect(body).toMatch(/if \(banner\.deniesAccess\)/);
    expect(body).toMatch(/setPermissionDenied\(true\)/);
  });

  it('does not raise it unconditionally', () => {
    // The control. A `setPermissionDenied(true)` on every failure would put
    // the access card over a service fault and over our own refusals, which
    // is a worse lie than the one this replaced.
    const body = imageLoadCatch(PAGE);
    const calls = body.match(/setPermissionDenied\(true\)/g) || [];
    expect(calls).toHaveLength(1);
    // It sits INSIDE the guard: the guard's opening brace comes first and the
    // call is before the banner block that follows it.
    expect(body.indexOf('if (banner.deniesAccess)')).toBeLessThan(
      body.indexOf('setPermissionDenied(true)'),
    );
  });

  it('matches what the save path already does on the same error shape', () => {
    // Not a new pattern, which is part of why it is the right one: the save
    // catch has raised the card on this error for as long as the card has
    // existed, and an image load refusing the same way should not be quieter.
    expect(PAGE.match(/setPermissionDenied\(true\)/g)?.length).toBeGreaterThanOrEqual(2);
  });
});
