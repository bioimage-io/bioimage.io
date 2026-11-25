/**
 * What happens when the annotation service is older than the import.
 *
 * MEASURED against the deployed service on 2026-11-25, which is why this file
 * exists at all: `import_ngff_image` there raises
 *
 *   TypeError: got an unexpected keyword argument 'planes'
 *
 * at argument binding. The version that accepts one is merged but not rolled
 * out. A control in the same probe sent `zzznotathing: 1` and got the same
 * error naming that key, while the call with no extra key at all reached the
 * store and failed on DNS, so the error is about the ARGUMENT and not about
 * the source.
 *
 * Two consequences are tested here. The first is that the plane is omitted
 * rather than sent as null when there is nothing to record, so every 2-D
 * import keeps working against that service: sending `planes: null` would have
 * broken all of them, which is a regression this page would have shipped. The
 * second is that the one case which cannot work there says so in a sentence
 * instead of showing a Python traceback.
 */

import { rewriteMissingPlanesSupport } from './brokerApi';

const asMessage = (v: unknown) => String((v as any)?.message ?? v);

describe('rewriteMissingPlanesSupport', () => {
  // The real thing, shortened. Matching has to survive the traceback around
  // it, because that is the only form this error ever arrives in.
  const real = new Error(
    'RemoteError: Traceback (most recent call last): File "inspect.py", ' +
      "line 3184, in _bind raise TypeError( TypeError: got an unexpected " +
      "keyword argument 'planes'",
  );

  it('explains the refusal when a plane was actually needed', () => {
    const out = rewriteMissingPlanesSupport(real, { z: 4 });
    expect(asMessage(out)).toMatch(/more than one slice/);
    expect(asMessage(out)).toMatch(/v0\.12\.6 or newer/);
    // The traceback must not survive into what the user reads.
    expect(asMessage(out)).not.toMatch(/Traceback|inspect\.py|TypeError/);
  });

  it('passes the error through untouched when no plane was sent', () => {
    // Then the key was never in the payload, so this error is about something
    // else that happens to mention the word, and rewriting it would replace a
    // true message with a wrong one.
    expect(rewriteMissingPlanesSupport(real, undefined)).toBe(real);
  });

  it('passes every OTHER failure through untouched', () => {
    const cors = new Error('Could not reach https://host/x.zarr/zarr.json: CORS');
    expect(rewriteMissingPlanesSupport(cors, { z: 4 })).toBe(cors);
    const denied = new Error('PermissionError: manager role required');
    expect(rewriteMissingPlanesSupport(denied, { z: 4 })).toBe(denied);
  });

  it('survives an error that is not an Error', () => {
    // Hypha hands back strings and plain objects as well as Errors.
    const out = rewriteMissingPlanesSupport(
      "TypeError: got an unexpected keyword argument 'planes'",
      { z: 4 },
    );
    expect(asMessage(out)).toMatch(/more than one slice/);
    expect(rewriteMissingPlanesSupport(null, { z: 4 })).toBeNull();
    expect(rewriteMissingPlanesSupport(undefined, { z: 4 })).toBeUndefined();
  });
});
