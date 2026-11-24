// A model card is ONE link covering the whole card, and every interactive thing on it sits above
// that link rather than under it.
//
// WHAT THIS COVERS AND WHAT IT DOES NOT, because the difference matters and an earlier version of
// this header overstated it.
//
// It renders the component and asserts the structure the whole-card link depends on: exactly one
// anchor to the model, the stretched-overlay classes on that anchor, and, for every interactive
// element that is NOT that anchor, a computed position other than static and a computed z-index
// above the overlay's. It asserts the PROPERTY rather than one way of reaching it, because two
// mechanisms are in use and both are correct: the absolutely positioned controls carry their own
// zIndex in `sx`, while the statically positioned ones get position and zIndex from the
// `.card-control` rule. An earlier version required the class and failed on the download button,
// which was correct code.
//
// It renders TWICE, signed out and signed in, because the bookmark and edit buttons only exist
// for a signed-in user who may edit, and a single signed-out render checked 3 of the 5 buttons
// while claiming to check every control.
//
// It CANNOT see a stacking-context problem. jsdom does not lay out or paint, so nothing here can
// tell that the ID row's `backdrop-blur` creates a context a button cannot escape, which was the
// second half of the real bug this file exists for. Only a browser hit-test shows that, and that
// is `notes/check-card-new-tab.mjs` on its branch, run by hand against a dev server. Treat this
// file as a structural guard, not as proof the overlay works.
import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

// Mutable so one file can render both signed-out and signed-in. The factory closes over this object, so assigning to its fields between renders changes what the component sees.
const mockStore: any = {
  setSelectedResource: jest.fn(),
  fetchResource: jest.fn(),
  user: null,
  isLoggedIn: false,
  artifactManager: null,
};

jest.mock('../store/hyphaStore', () => ({
  useHyphaStore: () => mockStore,
}));

jest.mock('../hooks/useBookmarks', () => ({
  useBookmarks: () => ({ isBookmarked: () => false, toggleBookmark: jest.fn() }),
}));

jest.mock('./PreviewDialog', () => ({ PreviewDialog: () => null }));

// eslint-disable-next-line import/first
import { ArtifactCard } from './ArtifactCard';

const USER_ID = 'user-who-owns-this';

/** The fixture carries a BADGE on purpose: badge links are `<a class="card-control">`, are
 *  statically positioned, and are lifted ONLY by that class. Without a badge in the manifest none
 *  renders, and removing the class from it went uncaught. */
const makeArtifact = (extra: Record<string, unknown> = {}): any => ({
  id: 'bioimage-io/powerful-fish',
  created_by: USER_ID,
  manifest: {
    name: '3D UNet Mouse Embryo',
    description: 'A model used as a fixture.',
    covers: ['https://example.invalid/cover.png'],
    tags: ['3d', 'unet'],
    id_emoji: '🐟',
    badges: [{ url: 'https://example.invalid/run', label: 'Run model' }],
  },
  ...extra,
});

const renderCard = () =>
  render(
    <MemoryRouter>
      <ArtifactCard artifact={makeArtifact()} />
    </MemoryRouter>,
  );

function signOut() {
  mockStore.user = null;
  mockStore.isLoggedIn = false;
  mockStore.artifactManager = null;
}

/** Signed in AS THE OWNER, which is the branch of the permission check that returns early:
 *  `artifact.created_by === user.id` sets canEdit without reaching artifactManager.read. That is
 *  what makes the edit button reachable here without mocking a collection read. */
function signInAsOwner() {
  mockStore.user = { id: USER_ID, email: 'owner@example.invalid', roles: [] };
  mockStore.isLoggedIn = true;
  mockStore.artifactManager = { read: jest.fn().mockResolvedValue({ config: { permissions: {} } }) };
}

/** Every interactive element on the card EXCEPT the whole-card link itself. Buttons alone are not
 *  enough: a badge is an anchor, and it is lifted only by a class. */
function interactiveControls(container: HTMLElement): HTMLElement[] {
  const all = Array.from(container.querySelectorAll('button, a')) as HTMLElement[];
  return all.filter((el) => !(el.tagName === 'A' && el.getAttribute('href')?.includes('/artifacts/')));
}

function unlifted(controls: HTMLElement[]) {
  return controls
    .map((el) => {
      const cs = window.getComputedStyle(el);
      return { el, position: cs.position, z: parseInt(cs.zIndex, 10) };
    })
    // z-index only applies to a positioned element, so both halves are checked. This is what
    // would have caught the Copy ID bug: with its class dropped by a duplicate `className`, that
    // button rendered static with no z-index at all.
    .filter((c) => c.position === 'static' || !(c.z >= 2))
    .map((c) => `<${c.el.tagName.toLowerCase()} class="${c.el.className.slice(0, 40)}"> position=${c.position} z=${c.z}`);
}

beforeEach(signOut);

describe('ArtifactCard is one link over the whole card', () => {
  test('renders exactly one anchor to the model', () => {
    const { container } = renderCard();
    const links = container.querySelectorAll('a[href*="/artifacts/"]');
    // Two anchors was the earlier shape, and it made a screen reader announce every model
    // twice, which is why one of them had to be hidden from the accessibility tree.
    expect(links).toHaveLength(1);
    expect(links[0].getAttribute('href')).toContain('powerful-fish');
  });

  test('that anchor carries the stretched overlay, including its explicit layer', () => {
    const { container } = renderCard();
    const link = container.querySelector('a[href*="/artifacts/"]')!;
    const cls = link.getAttribute('class') || '';
    // Without these the card reverts to a link on the title only, which measured about 44%
    // of the card and left the reported problem reproducing on the rest.
    expect(cls).toContain('after:absolute');
    expect(cls).toContain('after:inset-0');
    // The explicit layer is load-bearing: at `z-index: auto` the overlay paints in DOM order,
    // so the ID row wins and three sample points per card land on the ID chip.
    expect(cls).toContain('after:z-[1]');
  });

  test('the anchor is named, so it is not a bare link for a screen reader', () => {
    renderCard();
    expect(screen.getByRole('link', { name: /3D UNet Mouse Embryo/i })).toBeInTheDocument();
  });

  test('the badge link really renders, so the next assertion is not vacuous', () => {
    const { container } = renderCard();
    // Guards the fixture itself. The previous version had no badge, so the badge case passed by
    // never existing, and a reviewer caught exactly that.
    const badge = container.querySelector('a[href="https://example.invalid/run"]');
    expect(badge).not.toBeNull();
    expect(badge!.className).toContain('card-control');
  });

  test('every control is painted above the overlay, signed out', () => {
    const { container } = renderCard();
    const controls = interactiveControls(container);
    // Signed out this is preview, download and copy-ID, plus the badge anchor.
    expect(controls.length).toBeGreaterThanOrEqual(4);
    expect(unlifted(controls)).toEqual([]);
  });

  test('every control is painted above the overlay, signed in as the owner', async () => {
    signInAsOwner();
    const { container } = renderCard();
    // The edit button appears from an async permission check, so wait for it rather than
    // asserting into the gap and reporting a pass for a control that had not rendered yet.
    // Located by class, not by accessible name: it is an icon button with no label, which is
    // its own defect and not this row's. getByRole('button', {name: /edit/i}) finds nothing.
    await waitFor(() => expect(container.querySelector('.edit-button')).not.toBeNull());
    expect(container.querySelector('.bookmark-button')).not.toBeNull();
    const controls = interactiveControls(container);
    // Signed in adds bookmark and edit, which are the two the signed-out render never saw.
    expect(controls.length).toBeGreaterThanOrEqual(6);
    expect(unlifted(controls)).toEqual([]);
  });

  test('no control is nested inside the model link', () => {
    const { container } = renderCard();
    // Invalid HTML, and it breaks assistive technology. The overlay makes this easy to get
    // wrong, because wrapping more of the card in the anchor looks like the simpler fix.
    // Checked for any interactive descendant, not only buttons: a badge anchor nested inside
    // the model link is the same defect and the button-only form could not see it.
    const link = container.querySelector('a[href*="/artifacts/"]')!;
    expect(link.querySelectorAll('button, a, input, select, textarea')).toHaveLength(0);
  });
});
