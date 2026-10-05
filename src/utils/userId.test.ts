import { truncateUserId } from './userId';

// The point of showing the id is to let someone tell two accounts apart when
// both display the same email. So the property that matters is not "it is
// short", it is "the provider stays visible and two different ids stay
// different". These are the real ids from the incident that prompted it.
const GOOGLE = 'google-oauth2|109398169297807010606';
const GITHUB = 'github|32868330';

describe('truncateUserId', () => {
  it('keeps a short id intact', () => {
    expect(truncateUserId(GITHUB)).toBe(GITHUB);
  });

  it('keeps the provider prefix visible on a long id', () => {
    const out = truncateUserId(GOOGLE);
    expect(out.startsWith('google-oauth2|')).toBe(true);
    expect(out.length).toBeLessThan(GOOGLE.length);
  });

  // The whole reason the id is on screen: these two must not look alike.
  it('renders the two providers distinguishably', () => {
    expect(truncateUserId(GOOGLE)).not.toBe(truncateUserId(GITHUB));
  });

  // Two accounts on the SAME provider differ only in the digits, so a
  // prefix-only rendering would collapse them into one string.
  it('distinguishes two long ids from the same provider', () => {
    const a = truncateUserId('google-oauth2|109398169297807010606');
    const b = truncateUserId('google-oauth2|109398169297807019999');
    expect(a).not.toBe(b);
  });

  it('elides the middle rather than the prefix', () => {
    const out = truncateUserId(GOOGLE);
    expect(out).toContain('…');
    // the tail survives, which is what makes same-provider ids distinguishable
    expect(out.endsWith('010606')).toBe(true);
  });

  it('handles an id with no provider separator', () => {
    const out = truncateUserId('x'.repeat(60));
    expect(out.length).toBeLessThanOrEqual(22);
    expect(out.endsWith('…')).toBe(true);
  });

  it('handles empty and short input without throwing', () => {
    expect(truncateUserId('')).toBe('');
    expect(truncateUserId('abc')).toBe('abc');
  });
});
