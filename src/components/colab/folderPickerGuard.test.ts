import fs from 'fs';
import path from 'path';

/**
 * Neither folder picker may be called without checking for it first.
 *
 * Both call sites used to invoke `window.showDirectoryPicker()` unguarded, so
 * Firefox and Safari rendered their own TypeError as the error message. That
 * is the defect this row exists to end, and it is the one thing here that
 * cannot be caught by mounting anything: jest never mounts either component,
 * and the production build compiles an unguarded call happily. So it is
 * checked as source text.
 *
 * WHY THIS FILE EXISTS AT ALL, since the check is not new. It lived in the
 * runs page's wiring test, which belongs to another row and is not on this
 * branch. Rebuilding this row onto main dropped that file, and a review
 * measured what the drop cost: with the guard deleted from
 * `CreateDatasetModal.tsx`, the whole unit suite still passed, 444 of 444.
 * The block is portable, reads only files this branch carries, and is the
 * only thing that catches the guard being removed, so it travels with the
 * code it guards rather than with the page it happened to be written in.
 */

const read = (file: string) => fs.readFileSync(path.join(__dirname, file), 'utf8');

describe('no folder picker is called without checking for it first', () => {
  const callers = ['CreateDatasetModal.tsx', 'DatasetOverview.tsx'];

  it.each(callers)('%s guards the call', (file) => {
    const source = read(file);
    expect(source).toContain('showDirectoryPicker');
    expect(source).toContain('canMountLocalFolder()');
    // The guard has to come BEFORE the call, or it guards nothing.
    expect(source.indexOf('canMountLocalFolder()')).toBeLessThan(
      source.indexOf('await (window as any).showDirectoryPicker()'),
    );
    // And it has to REFUSE. The line above compares the first occurrence of
    // the name with the call, so another mention of it earlier in the file,
    // for anything at all, would satisfy it while the call itself went
    // unguarded. This pins the shape instead: a negated check that returns,
    // and the call after it.
    expect(source).toMatch(
      /if \(!canMountLocalFolder\(\)\)[\s\S]{0,200}?return;[\s\S]{0,600}?await \(window as any\)\.showDirectoryPicker\(\)/,
    );
  });

  it.each(callers)('%s no longer echoes the raw exception', (file) => {
    const source = read(file);
    // The two phrasings that used to put a TypeError on screen.
    expect(source).not.toMatch(/Failed to select folder: \$\{/);
    expect(source).toContain('describeFolderPickError');
  });
});
