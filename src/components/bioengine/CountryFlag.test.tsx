import React from 'react';
import { render } from '@testing-library/react';
import CountryFlag from './CountryFlag';
import WorkspaceStatusDot from './WorkspaceStatusDot';

// The flag sits beside a place name that is already on screen, so the property
// that matters is that a missing or malformed code leaves NOTHING behind rather
// than a broken-image glyph. The worker's geo block is self-reported, so the
// code cannot be assumed well-formed.
describe('CountryFlag', () => {
  it('renders a flag for a valid code', () => {
    const { container } = render(<CountryFlag countryCode="SE" countryName="Sweden" />);
    const img = container.querySelector('img');
    expect(img).toBeTruthy();
    expect(img!.getAttribute('src')).toBe('https://flagcdn.com/w40/se.png');
  });

  it('lower-cases the code, since the CDN path is lower-case', () => {
    const { container } = render(<CountryFlag countryCode="DE" />);
    expect(container.querySelector('img')!.getAttribute('src')).toContain('/de.png');
  });

  it('renders nothing without a code', () => {
    const { container } = render(<CountryFlag countryName="Sweden" />);
    expect(container.querySelector('img')).toBeNull();
  });

  // Would otherwise fire a 404 on every render.
  it('renders nothing for a malformed code', () => {
    for (const bad of ['', '  ', 'SWE', 'x', '12', 'se-x']) {
      const { container } = render(<CountryFlag countryCode={bad} />);
      expect(container.querySelector('img')).toBeNull();
    }
  });

  // Decorative: the country name is rendered next to it already.
  it('is hidden from screen readers rather than repeating the country', () => {
    const { container } = render(<CountryFlag countryCode="fr" countryName="France" />);
    const img = container.querySelector('img')!;
    expect(img.getAttribute('alt')).toBe('');
    expect(img.getAttribute('aria-hidden')).toBe('true');
    expect(img.getAttribute('title')).toBe('France');
  });
});

// The distinction worth protecting: "answered, found none" and "has not
// answered yet" must not look the same, or an unknown state reads as empty.
describe('WorkspaceStatusDot', () => {
  const cls = (ui: React.ReactElement) =>
    render(ui).container.firstElementChild!.getAttribute('class') ?? '';

  it('is green when the workspace answered with items', () => {
    expect(cls(<WorkspaceStatusDot status="loaded" count={3} />)).toContain('bg-green-500');
  });

  it('is grey when the workspace answered with nothing', () => {
    expect(cls(<WorkspaceStatusDot status="loaded" count={0} />)).toContain('bg-gray-400');
  });

  it('distinguishes not-yet-asked from answered-and-empty', () => {
    const notAsked = cls(<WorkspaceStatusDot status={undefined} />);
    const empty = cls(<WorkspaceStatusDot status="loaded" count={0} />);
    expect(notAsked).toContain('bg-gray-300');
    expect(notAsked).not.toBe(empty);
  });

  it('is red on error and spins while loading', () => {
    expect(cls(<WorkspaceStatusDot status="error" />)).toContain('bg-red-400');
    expect(cls(<WorkspaceStatusDot status="loading" />)).toContain('animate-spin');
  });

  it('names the noun in the title so the colour is explained', () => {
    const { container } = render(<WorkspaceStatusDot status="loaded" count={2} noun="worker" />);
    expect(container.firstElementChild!.getAttribute('title')).toBe('2 workers');
  });
});
