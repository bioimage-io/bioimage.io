import { imageLoadBanner } from './imageLoadBanner';

/**
 * What a failed image load is allowed to put on screen.
 *
 * Written from a measurement rather than from a worry. Logged out, on a
 * private dataset reached by an `&image=` deep link, the page showed the
 * refusal card AND a persistent red banner holding 6,115 characters of raw Ray
 * traceback: an internal cluster IP, `/tmp/ray/session` paths and a module's
 * line numbers, covering the right third of the viewport. The visitor had no
 * access to that dataset, and the one sentence they could act on was beside a
 * wall of Python.
 *
 * The fixtures below are the real shapes, trimmed. The permission one is what
 * the broker's refusal looks like by the time hypha-rpc has delivered it:
 * `str(exception)` only, with no class, which is why the decision is made on
 * the text.
 */

/** A broker refusal, as the page receives it. */
const PERMISSION_TRACEBACK = new Error(
  [
    'RemoteException: Traceback (most recent call last):',
    '  File "/tmp/ray/session_2026-11-19_11-14-32_549568_1/runtime_resources/py_modules_files/_x/bioengine/_app/decorators.py", line 144, in wrapper',
    '    return await f(*args, **kwargs)',
    '  File "/home/bioengine/apps/bioimage-io-annotation-broker/source/broker.py", line 209, in _require_role',
    '    raise PermissionError(',
    "PermissionError: caller has role 'none'; 'public' or higher is required",
  ].join('\n'),
);

/** A service fault that is NOT about permission, delivered the same way. */
const FAULT_TRACEBACK = new Error(
  [
    'RemoteException: Traceback (most recent call last):',
    // The container's own home, part of the traceback shape this fixture
    // reproduces. Marked on the line, which is where the check reads it.
    '  File "/home/ray/anaconda3/lib/python3.11/site-packages/ray/serve/_private/replica.py", line 3657, in call_user_method',  // agent-env-check: allow
    '  File "/home/bioengine/apps/bioimage-io-annotation-broker/source/broker.py", line 2132, in get_dataset_index',
    "OSError: [Errno 30] Read-only file system: '/home/ray/.bioengine'",  // agent-env-check: allow
  ].join('\n'),
);

/** One of OUR sentences, written for the person reading it. */
const OUR_REFUSAL = new Error(
  "This source's z axis is sampled differently at each resolution, and no usable slice was "
  + 'recorded for it, so there is no way to tell which slice an annotation would be drawn on.',
);

describe('imageLoadBanner', () => {
  it('shows NOTHING for a permission refusal', () => {
    // The page already has a surface for this: the "This dataset is private"
    // card with a Login button. A second telling beside it is noise, and this
    // is the case whose error text is the service's internals.
    expect(imageLoadBanner(PERMISSION_TRACEBACK)).toEqual({ show: false, message: '' });
  });

  it('never puts a remote traceback in the banner TEXT', () => {
    // The absence that matters. Asserted on both traceback fixtures, because
    // suppressing only the permission one would leave the fault case leaking
    // the same paths to any logged-in user.
    for (const err of [PERMISSION_TRACEBACK, FAULT_TRACEBACK]) {
      const banner = imageLoadBanner(err);
      expect(banner.message).not.toMatch(/Traceback/);
      expect(banner.message).not.toMatch(/\/tmp\/ray/);
      expect(banner.message).not.toMatch(/broker\.py/);
      expect(banner.message).not.toMatch(/\d+\.\d+\.\d+\.\d+/);
    }
  });

  it('classifies a service fault and keeps the raw text in the details', () => {
    // Not discarded: a developer still needs it, and the banner has a details
    // affordance for exactly this. It is simply not the headline.
    const banner = imageLoadBanner(FAULT_TRACEBACK);
    expect(banner.show).toBe(true);
    expect(banner.message).toMatch(/could not be opened/i);
    expect(banner.details).toMatch(/Read-only file system/);
  });

  it('shows OUR OWN sentence verbatim, with no details popup', () => {
    // The control, and the reason this is not just "hide every error". These
    // messages are written for the reader and name the thing they can change.
    // A fix that classified them away would lose the only part that helps.
    const banner = imageLoadBanner(OUR_REFUSAL);
    expect(banner.show).toBe(true);
    expect(banner.message).toBe(OUR_REFUSAL.message);
    expect(banner.details).toBeUndefined();
  });

  it('says something rather than nothing for an error with no message', () => {
    expect(imageLoadBanner(new Error(''))).toEqual({
      show: true,
      message: 'This image could not be opened.',
    });
    expect(imageLoadBanner(undefined).show).toBe(true);
  });

  it('passes a readable SERVICE sentence through, classified or not', () => {
    // These two carry no traceback, so they take the verbatim path even
    // though `classifyBrokerError` recognises them. That is the right
    // outcome and it is worth pinning: the test for it was written the other
    // way round first, expecting a rewrite, and the behaviour was better than
    // the expectation. A sentence somebody wrote for a reader should reach
    // the reader, whoever wrote it.
    const unavailable = new Error('The annotation-broker service is not available right now.');
    expect(imageLoadBanner(unavailable).message).toBe(unavailable.message);
    expect(imageLoadBanner(unavailable).details).toBeUndefined();

    const unregistered = new Error("Dataset 'bioimage-io/x' is not registered with the broker.");
    expect(imageLoadBanner(unregistered).message).toBe(unregistered.message);
  });

  it('classifies by CODE, not by text, once a traceback forces a rewrite', () => {
    // And when the text cannot be shown, the classification is what decides
    // which sentence replaces it. A service fault and an expired session read
    // differently to the person stuck in front of them.
    const expired = new Error(
      'RemoteException: Traceback (most recent call last):\n  ...\nAuthentication expired',
    );
    // `classifyBrokerError` keys auth-expired off a reconnect error type
    // rather than this text, so this one lands on the default sentence. The
    // case exists to say that out loud: the fallback is a sentence, never the
    // traceback.
    const banner = imageLoadBanner(expired);
    expect(banner.message).toMatch(/could not be opened/i);
    expect(banner.message).not.toMatch(/Traceback/);
    expect(banner.details).toMatch(/Traceback/);
  });
});
