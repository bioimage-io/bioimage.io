/**
 * In-memory ring buffer of recent failures, so an error report can carry what
 * actually went wrong instead of a generic message (svamp #0046).
 *
 * The recurring gap this closes is not "no error was logged" but "the error was
 * logged without the context needed to place it": a Hypha RemoteException
 * stringifies to a truncated traceback, and the fully-qualified service id
 * (which carries the compute site and the ReplicaSet hash) is usually dropped
 * by the time the failure surfaces in the UI.
 *
 * VERBATIM SERVER PAYLOADS ARE INCLUDED ON PURPOSE. The destination collection
 * `bioimage-io/issues` is admin-only, verified 2026-10-01: an anonymous read
 * returns HTTP 403. Redacting the payload there would destroy the evidence the
 * report exists to carry. If that collection is ever made world-readable this
 * decision has to be revisited, because a Hypha error body can carry artifact
 * paths and email addresses.
 *
 * TOKENS ARE NEVER LOGGED, and that is absolute regardless of the above. Several
 * of these call sites have the user token in scope via hyphaStore, so
 * {@link redactSecrets} scrubs token-shaped substrings on the way in rather than
 * trusting every caller to pass clean input.
 */

/** How many failures to keep. Old entries are dropped oldest-first. */
export const FAILURE_LOG_CAPACITY = 50;

/** The operations worth distinguishing in a report. */
export type FailureOperation =
  | 'upload'
  | 'edit'
  | 'review'
  | 'bioengine';

export interface FailureRecord {
  /** Epoch milliseconds, so records sort without parsing. */
  at: number;
  operation: FailureOperation;
  /** Free-text step within the operation, e.g. 'put_file' or 'commit'. */
  step: string;
  /** Artifact this failed against, when the call site knows it. */
  artifactId?: string;
  /** Artifact version, when known. Staged work often has none. */
  version?: string;
  /**
   * FULLY-QUALIFIED service id where applicable. The qualified form carries the
   * site and ReplicaSet hash, which is what makes a BioEngine failure
   * attributable to one replica rather than to "the runner".
   */
  serviceId?: string;
  /** Constructor name of the thrown value, e.g. 'RemoteException'. */
  errorClass: string;
  /** Message, secrets scrubbed. */
  message: string;
  /** Server payload or traceback, secrets scrubbed. Absent when there was none. */
  detail?: string;
}

/**
 * Scrub token-shaped substrings.
 *
 * Deliberately over-broad: a false positive costs one unreadable field in a
 * report, a false negative leaks a credential. The JWT pattern is the important
 * one because Hypha tokens are JWTs and they appear in connection errors and in
 * presigned-URL query strings.
 */
export const redactSecrets = (text: string): string =>
  text
    // JWTs: three base64url segments separated by dots.
    .replace(/\beyJ[A-Za-z0-9_-]{5,}\.[A-Za-z0-9_-]{5,}\.[A-Za-z0-9_-]{5,}\b/g, '[REDACTED_JWT]')
    // token=... / access_token=... in query strings and key-value dumps.
    .replace(/\b((?:access_|api_|auth_)?token)["']?\s*[=:]\s*["']?[A-Za-z0-9._-]{8,}/gi, '$1=[REDACTED]')
    // AWS-style presigned signature parameters on put_file URLs.
    .replace(/\b(X-Amz-Signature|Signature|AWSAccessKeyId)=[A-Za-z0-9%._-]+/gi, '$1=[REDACTED]')
    // Bearer headers.
    .replace(/\bBearer\s+[A-Za-z0-9._-]{8,}/gi, 'Bearer [REDACTED]');

const buffer: FailureRecord[] = [];

/** Constructor name of an arbitrary thrown value. */
const classOf = (error: unknown): string => {
  if (error instanceof Error) return error.constructor?.name || 'Error';
  if (error === null) return 'null';
  return typeof error;
};

/**
 * Pull a server payload out of a thrown value, if there is one.
 *
 * Hypha RemoteExceptions carry the useful part on the error rather than in the
 * message, and different transports put it in different places, so check the
 * shapes rather than assuming one.
 */
const detailOf = (error: unknown): string | undefined => {
  if (error == null || typeof error !== 'object') return undefined;
  const e = error as Record<string, unknown>;
  for (const key of ['detail', 'data', 'response', 'body', 'cause']) {
    const v = e[key];
    if (v == null) continue;
    try {
      return typeof v === 'string' ? v : JSON.stringify(v);
    } catch {
      /* circular or unserialisable: fall through to the stack below */
    }
  }
  if (error instanceof Error && error.stack) return error.stack;
  return undefined;
};

export interface LogFailureContext {
  operation: FailureOperation;
  step: string;
  artifactId?: string;
  version?: string;
  serviceId?: string;
}

/**
 * Record a failure. Never throws: a logger that can break the path it observes
 * is worse than no logger, and these call sites are already in a catch block.
 */
export const logFailure = (error: unknown, context: LogFailureContext): void => {
  try {
    const rawMessage = error instanceof Error ? error.message : String(error);
    const rawDetail = detailOf(error);
    const record: FailureRecord = {
      at: Date.now(),
      operation: context.operation,
      step: context.step,
      artifactId: context.artifactId,
      version: context.version,
      serviceId: context.serviceId,
      errorClass: classOf(error),
      message: redactSecrets(rawMessage),
      detail: rawDetail === undefined ? undefined : redactSecrets(rawDetail),
    };
    buffer.push(record);
    while (buffer.length > FAILURE_LOG_CAPACITY) buffer.shift();
    // console.* is exempt from the user-visible text rules, so this can be blunt.
    console.error(
      `[${record.operation}:${record.step}]`,
      record.artifactId ?? '(no artifact)',
      record.serviceId ? `via ${record.serviceId}` : '',
      record.errorClass,
      record.message,
    );
  } catch {
    /* logging must never break the operation it is observing */
  }
};

/** Newest-last snapshot of the buffer, for attaching to a report. */
export const getRecentFailures = (): FailureRecord[] => [...buffer];

/** Drop everything. Exposed for tests and for a "start a fresh report" action. */
export const clearFailureLog = (): void => {
  buffer.length = 0;
};
