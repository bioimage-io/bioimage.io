/**
 * What a browser without the File System Access API is told.
 *
 * The defect: both folder pickers called `window.showDirectoryPicker()`
 * unguarded, so Firefox and Safari rendered their own exception as the
 * user-facing error, "Failed to select folder: window.showDirectoryPicker is
 * not a function". The assertions here are mostly about what must NOT appear.
 */

import {
  canMountLocalFolder,
  describeFolderPickError,
  NO_LOCAL_FOLDER_SUPPORT,
} from './localFolderSupport';

/**
 * jsdom has no `showDirectoryPicker`, so "unsupported" is the default state
 * here and support has to be installed to test the other arm. Deleting the
 * key afterwards rather than assigning undefined: a saved-and-restored
 * `undefined` is a own-property that `typeof` still reads as undefined but
 * that other code can see, and that difference has bitten this repository
 * before.
 */
const withPickerSupport = (fn: () => void) => {
  (globalThis as any).showDirectoryPicker = async () => ({ name: 'folder' });
  try {
    fn();
  } finally {
    delete (globalThis as any).showDirectoryPicker;
  }
};

describe('canMountLocalFolder', () => {
  it('is false where the API is absent, which is Firefox and Safari', () => {
    expect(canMountLocalFolder()).toBe(false);
  });

  it('is true where it is present', () => {
    withPickerSupport(() => expect(canMountLocalFolder()).toBe(true));
  });

  it('is false when the key exists but is not callable', () => {
    // A polyfill stub or a shim that sets the key to something else must not
    // read as support, because the call would still throw.
    (globalThis as any).showDirectoryPicker = 'yes';
    try {
      expect(canMountLocalFolder()).toBe(false);
    } finally {
      delete (globalThis as any).showDirectoryPicker;
    }
  });
});

describe('the sentence an unsupported browser gets', () => {
  it('names the browsers rather than calling the browser unsupported', () => {
    // The reader's first question is which browser to open.
    expect(NO_LOCAL_FOLDER_SUPPORT).toMatch(/Chrome and Edge/);
    expect(NO_LOCAL_FOLDER_SUPPORT).toMatch(/Firefox and Safari/);
    // And it names the route that now does the same job in the same place.
    // Before the picker existed this sentence could only send the reader
    // somewhere else, and keeping that wording would understate what the
    // page can do.
    expect(NO_LOCAL_FOLDER_SUPPORT).toMatch(/file picker/);
  });

  it('names the routes that still work, so the page is not a dead end', () => {
    expect(NO_LOCAL_FOLDER_SUPPORT).toMatch(/dataset someone shared/);
    expect(NO_LOCAL_FOLDER_SUPPORT).toMatch(/remote URL/);
  });

  it('never shows the raw exception', () => {
    expect(NO_LOCAL_FOLDER_SUPPORT).not.toMatch(/showDirectoryPicker|TypeError|not a function/);
  });
});

describe('describeFolderPickError', () => {
  it('says NOTHING when the user cancelled the dialog', () => {
    // Closing a file dialog is not a failure, and reporting it as one puts an
    // error on screen for an action the user took on purpose.
    const abort = Object.assign(new Error('aborted'), { name: 'AbortError' });
    expect(describeFolderPickError(abort)).toBeNull();
  });

  it('explains the browser rather than echoing its TypeError', () => {
    const real = new TypeError('window.showDirectoryPicker is not a function');
    const out = describeFolderPickError(real);
    expect(out).toBe(NO_LOCAL_FOLDER_SUPPORT);
    expect(out).not.toMatch(/is not a function/);
  });

  it('passes a REAL failure through on a browser that does support it', () => {
    // The control: with the API present, a genuine failure must still reach
    // the user. Swallowing it into the browser-support sentence would blame
    // the browser for something else entirely.
    withPickerSupport(() => {
      const out = describeFolderPickError(new Error('permission denied'));
      expect(out).toMatch(/permission denied/);
      expect(out).not.toBe(NO_LOCAL_FOLDER_SUPPORT);
    });
  });

  it('still says something for a failure with no message', () => {
    withPickerSupport(() => {
      expect(describeFolderPickError({})).toMatch(/Could not open that folder/);
    });
  });
});
