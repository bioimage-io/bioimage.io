import {
  axisRoles,
  displayedPlanes,
  displayedPlanesForProbe,
  ngffChannelAxis,
  NgffAxis,
} from './ngffLayout';

/**
 * The planes the VIEWER shows equal the planes the TRAINER reads.
 *
 * This is the one leg of the channel-axis work that nothing on the service's
 * side can assert. The cross-app test over there goes service to trainer: it
 * loads the region reader by path and checks the pixels it ends up with.
 * Nothing there runs the browser, and nothing here runs the trainer, so the
 * equality has to be made out of the two halves' shared quantity, which is
 * WHICH DIMENSION HOLDS THE CHANNELS.
 *
 * The chain, which is what makes that sufficient:
 *
 *   the trainer takes its channel axis from the manifest's `layout.axis_roles`,
 *   written at import by the broker's `ngff_channel_axis`;
 *   the plane record the page writes comes from the SAME `layout.axis_roles`,
 *   through `displayedPlanesForProbe`;
 *   and the viewer draws through `axisRoles`, which is the browser's own
 *   resolver.
 *
 * So two things have to hold, and both are asserted below: the browser's
 * resolver must agree with the broker's rule, and the record the page writes
 * must pin the same axes the viewer pinned to draw. If the first fails the
 * user annotates one image while the model trains on another; if the second
 * fails the record describes a plane nobody looked at.
 *
 * THE FIXTURE IS THE ARGUMENT. A store whose channel axis is merely RENAMED
 * (`ch`, typed `channel`) is handled identically by a name-only resolver and a
 * type-first one, so it cannot discriminate. The fixture here puts a SPATIAL
 * axis named `c` beside a channel axis named `ch`: a name-only resolver picks
 * the spatial one, a type-first resolver picks the channel one, and they pin
 * different dimensions.
 */

/** A spatial axis called `c` beside a channel axis called `ch`. */
const TRAP: NgffAxis[] = [
  { name: 'c', type: 'space' },
  { name: 'ch', type: 'channel' },
  { name: 'y', type: 'space' },
  { name: 'x', type: 'space' },
];
/** 4 spatial `c` slices, 3 channels, 8x8. */
const SHAPE = [4, 3, 8, 8];

/**
 * What the BROKER writes into the manifest for this store, under its approved
 * rule: type first, name only when no type is declared.
 *
 * Hardcoded rather than imported, because it comes from a Python module in
 * another repository that this suite cannot load. That is the honest limit of
 * this test and it is stated rather than hidden: it pins the browser to a
 * WRITTEN-DOWN expectation of the broker's answer, not to the broker itself.
 * The broker's own suite pins that answer on its side, and the two expectations
 * are the same three numbers.
 */
const BROKER_ROLES = { y: 2, x: 3, c: 1 };

describe('the viewer and the trainer agree on which dimension holds the channels', () => {
  it('the browser resolves the SAME channel axis the broker records', () => {
    expect(ngffChannelAxis(TRAP)).toBe(BROKER_ROLES.c);
    const roles = axisRoles(TRAP, SHAPE.length);
    expect({ y: roles.y, x: roles.x, c: roles.c }).toEqual(BROKER_ROLES);
  });

  it('the record the page WRITES pins the same axes the viewer DREW', () => {
    // The left side is built from the broker's roles, which is how the page
    // really writes it. The right side is built from the browser's own
    // resolution, which is how the viewer really draws. They have to be the
    // same mapping or the record describes a plane nobody looked at.
    const written = displayedPlanesForProbe({
      axes: TRAP.map((a) => a.name),
      axis_roles: BROKER_ROLES,
      level0_shape: SHAPE,
    });
    const drawn = displayedPlanes(SHAPE, axisRoles(TRAP, SHAPE.length), TRAP);
    expect(written).toEqual(drawn);
    // And it is the SPATIAL `c` that gets pinned, not the channels: a
    // multichannel store is drawn as channels, not as a stack to scroll.
    //
    // Index 0, not the middle. `planeSelection` pins `z` to its middle slice
    // and every other indexed axis to 0, and this axis is named `c`. I
    // expected the middle here and the test said otherwise, which is the
    // version worth keeping: the number is read off the rule rather than off
    // my memory of it.
    expect(written).toEqual({ c: 0 });
  });

  it('a NAME-ONLY resolver would disagree, which is why this fixture is used', () => {
    // The control, stated as a measurement rather than as a claim about the
    // old code: on this fixture the name picks dimension 0 and the type picks
    // dimension 1, so the two rules really do differ here. A fixture where
    // they coincide would make the cases above pass under either.
    const byName = TRAP.map((a) => (a.name || '').toLowerCase()).indexOf('c');
    expect(byName).toBe(0);
    expect(ngffChannelAxis(TRAP)).toBe(1);
    expect(byName).not.toBe(ngffChannelAxis(TRAP));
  });

  it('a store whose channel axis is merely RENAMED cannot discriminate', () => {
    // Said out loud so the fixture above is not "simplified" later. Here the
    // name finds nothing and the type finds dimension 0, so a name-only
    // resolver and a type-first one differ only in that one answers; on a
    // conventional `c`/`channel` store they agree outright.
    const renamed: NgffAxis[] = [
      { name: 'ch', type: 'channel' },
      { name: 'y', type: 'space' },
      { name: 'x', type: 'space' },
    ];
    const conventional: NgffAxis[] = [
      { name: 'c', type: 'channel' },
      { name: 'y', type: 'space' },
      { name: 'x', type: 'space' },
    ];
    const byName = (axes: NgffAxis[]) =>
      axes.map((a) => (a.name || '').toLowerCase()).indexOf('c');
    expect(byName(conventional)).toBe(ngffChannelAxis(conventional));
    expect(byName(renamed)).toBe(-1);
  });
});
