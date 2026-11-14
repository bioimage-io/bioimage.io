import React from 'react';
import { render, screen } from '@testing-library/react';
import '@testing-library/jest-dom';
import { MemoryRouter } from 'react-router-dom';
import BioEngineGuide from './BioEngineGuide';

// The worker-setup fields are a visible <label> beside its control. Nothing joins the
// two unless htmlFor/id does, so without that wiring the control has NO accessible
// name: a screen reader announces an unnamed edit field, and getByLabelText cannot
// find it either.
//
// THE FIRST VERSION OF THIS SUITE WAS VACUOUS and it is worth saying why, because the
// defect it was written for has exactly this shape. Rendered with the default store,
// the page shows a signed-out prompt and almost none of the 38 labelled fields, so the
// "every control has a name" assertion passed against UNFIXED main as well. A test
// that passes on both trees measures nothing.
//
// Two things fix that. The store is mocked as signed in so the form actually renders,
// and the suite asserts a FLOOR on how many controls it examined. If the fields stop
// rendering, the floor fails loudly instead of the suite quietly passing over an empty
// DOM.
jest.mock('../../store/hyphaStore', () => ({
  useHyphaStore: () => ({
    server: null,
    isLoggedIn: true,
    user: { email: 'tester@example.org', id: 'tester' },
  }),
}));

// Below this many controls, assume the form did not render and fail rather than report
// success over a near-empty DOM. Measured: the agent panel (the default) renders 1, and
// the wizard's default single-machine view renders 10. 8 separates those two decisively
// while leaving room for a field to be added or removed without a brittle failure.
const MIN_CONTROLS = 8;

// `?mode=human` is what selects the setup wizard. Anything else, including absent,
// resolves to the agent panel, which renders a single control. That default is why the
// first version of this suite examined an almost empty DOM and passed on both trees.
const renderGuide = () =>
  render(
    <MemoryRouter initialEntries={['/bioengine?mode=human']}>
      <BioEngineGuide />
    </MemoryRouter>,
  );

const formControls = (container: HTMLElement) =>
  Array.from(container.querySelectorAll('input, select, textarea')) as HTMLElement[];

describe('worker-setup fields have accessible names', () => {
  it('renders enough of the setup form for this suite to mean anything', () => {
    const { container } = renderGuide();
    expect(formControls(container).length).toBeGreaterThanOrEqual(MIN_CONTROLS);
  });

  it('gives every rendered labelled control a non-empty accessible name', () => {
    const { container } = renderGuide();
    const controls = formControls(container);
    expect(controls.length).toBeGreaterThanOrEqual(MIN_CONTROLS);

    const unnamed = controls.filter((c) => {
      if (c.getAttribute('aria-label')) return false;
      if (c.getAttribute('aria-labelledby')) return false;
      if (c.closest('label')) return false; // a wrapping label supplies the name
      const id = c.getAttribute('id');
      if (!id) return true;
      return !container.querySelector(`label[for="${id}"]`);
    });

    if (unnamed.length) {
      const described = unnamed.map(
        (c) =>
          `${c.tagName.toLowerCase()}[type=${c.getAttribute('type') || '-'}]` +
          `#${c.getAttribute('id') || '(no id)'}` +
          ` placeholder=${JSON.stringify(c.getAttribute('placeholder'))}`,
      );
      throw new Error(
        `${unnamed.length} of ${controls.length} rendered control(s) have no accessible ` +
          `name: ${described.join(', ')}`,
      );
    }
    expect(unnamed).toHaveLength(0);
  });

  // Queried BY LABEL on purpose. Querying by id would still pass if the label pointed
  // somewhere else, which is what a single-character typo in htmlFor produces.
  it('resolves a named field by its visible label text', () => {
    renderGuide();
    const el = screen.getAllByLabelText(/^Worker Name$/i)[0];
    expect(el).toBeInTheDocument();
    expect(['INPUT', 'SELECT', 'TEXTAREA']).toContain(el.tagName);
  });
});
