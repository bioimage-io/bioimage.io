import {
  logFailure,
  getRecentFailures,
  clearFailureLog,
  redactSecrets,
  FAILURE_LOG_CAPACITY,
} from './failureLog';

// svamp #0046. The buffer exists so an error report can carry what actually
// went wrong. Two properties matter more than the rest: it must never leak a
// token, and it must never throw, because every call site is already inside a
// catch block handling something that went wrong.

beforeEach(() => {
  clearFailureLog();
  jest.spyOn(console, 'error').mockImplementation(() => {});
});
afterEach(() => jest.restoreAllMocks());

describe('redactSecrets', () => {
  // Hypha tokens are JWTs and they turn up in connection errors and in
  // presigned-URL query strings, so this is the case that actually occurs.
  it('scrubs a JWT anywhere in the text', () => {
    const jwt = 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.dBjftJeZ4CVPmB92K27uhbUJU1p1r_wW1gFWFOEjXk';
    const out = redactSecrets(`connect failed: token=${jwt} at endpoint`);
    expect(out).not.toContain(jwt);
    expect(out).toContain('[REDACTED');
  });

  it('scrubs key-value token forms', () => {
    expect(redactSecrets('access_token: abcdef1234567890')).not.toContain('abcdef1234567890');
    expect(redactSecrets('{"token":"abcdef1234567890"}')).not.toContain('abcdef1234567890');
  });

  it('scrubs presigned-URL signatures, which appear on put_file errors', () => {
    const url = 'https://s3/x?X-Amz-Signature=deadbeefcafe1234&X-Amz-Expires=60';
    const out = redactSecrets(url);
    expect(out).not.toContain('deadbeefcafe1234');
    expect(out).toContain('X-Amz-Expires=60'); // non-secret params survive
  });

  it('scrubs Bearer headers', () => {
    expect(redactSecrets('Authorization: Bearer abcdef1234567890')).not.toContain('abcdef1234567890');
  });

  it('leaves ordinary diagnostic text intact, which is the whole point', () => {
    const msg = "ValidationError: outputs[output0].dtype 'uint16' does not match 'int16'";
    expect(redactSecrets(msg)).toBe(msg);
  });
});

describe('logFailure', () => {
  it('captures the context that makes a failure placeable', () => {
    logFailure(new TypeError('boom'), {
      operation: 'bioengine',
      step: 'test',
      artifactId: 'stupendous-sheep',
      version: 'stage',
      serviceId: 'bioimage-io/bioengine-worker-kth-77dc978fcd-49nhd-4dcbe5dc:model-runner',
    });
    const [rec] = getRecentFailures();
    expect(rec.operation).toBe('bioengine');
    expect(rec.step).toBe('test');
    expect(rec.artifactId).toBe('stupendous-sheep');
    expect(rec.version).toBe('stage');
    // the qualified id is what attributes a failure to ONE replica
    expect(rec.serviceId).toContain('kth-77dc978fcd-49nhd');
    expect(rec.errorClass).toBe('TypeError');
    expect(rec.message).toBe('boom');
  });

  it('redacts secrets in both the message and the payload', () => {
    const err: any = new Error('auth failed with token=supersecrettoken123');
    err.detail = '{"Authorization":"Bearer supersecrettoken123"}';
    logFailure(err, { operation: 'upload', step: 'put_file' });
    const [rec] = getRecentFailures();
    expect(rec.message).not.toContain('supersecrettoken123');
    expect(rec.detail).not.toContain('supersecrettoken123');
  });

  it('keeps the server payload verbatim when it holds no secret', () => {
    const err: any = new Error('commit rejected');
    err.detail = '{"status":422,"reason":"version 0.1.0 already exists"}';
    logFailure(err, { operation: 'edit', step: 'commit', artifactId: 'affable-shark' });
    const [rec] = getRecentFailures();
    expect(rec.detail).toContain('version 0.1.0 already exists');
  });

  it('handles a thrown non-Error without losing it', () => {
    logFailure('plain string failure', { operation: 'review', step: 'accept' });
    const [rec] = getRecentFailures();
    expect(rec.errorClass).toBe('string');
    expect(rec.message).toBe('plain string failure');
  });

  // A logger that can break the path it observes is worse than no logger.
  it('never throws, even on a circular payload', () => {
    const err: any = new Error('circular');
    const loop: any = {}; loop.self = loop;
    err.detail = loop;
    expect(() => logFailure(err, { operation: 'upload', step: 'create' })).not.toThrow();
    expect(getRecentFailures()).toHaveLength(1);
  });

  it('drops oldest-first past capacity rather than growing without bound', () => {
    for (let i = 0; i < FAILURE_LOG_CAPACITY + 10; i++) {
      logFailure(new Error(`e${i}`), { operation: 'upload', step: 'put_file' });
    }
    const recs = getRecentFailures();
    expect(recs).toHaveLength(FAILURE_LOG_CAPACITY);
    // the oldest ten are gone, the newest survived
    expect(recs[0].message).toBe('e10');
    expect(recs[recs.length - 1].message).toBe(`e${FAILURE_LOG_CAPACITY + 9}`);
  });
});
