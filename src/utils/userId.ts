/**
 * Display helpers for the signed-in user's id.
 *
 * Why the id is shown at all: the same email address can belong to different
 * accounts depending on the sign-in provider, and only the id distinguishes
 * them. A contributor lost edit access to his own models exactly this way. They
 * were owned by `github|32868330` while he was signed in as
 * `google-oauth2|1093981...`, the dropdown showed the same email either way,
 * and nothing on screen revealed the mismatch. The symptom was baffling from
 * both sides: the models were his, the server was right to refuse, and the UI
 * showed nothing that could explain it.
 */

/** Longest id rendered in full before the middle is elided. */
const MAX_LEN = 22;
/** Characters kept from the tail, enough to tell two ids of one provider apart. */
const TAIL = 6;

/**
 * Shorten a user id for a narrow dropdown while keeping it identifiable.
 *
 * Keeps the PROVIDER PREFIX and the last few characters, eliding the middle:
 * `google-oauth2|109398169297807010606` -> `google-oauth2|1…010606`
 *
 * The prefix carries the information that matters most here, which provider the
 * session belongs to, so truncating from the right (the obvious choice) would
 * hide the one part worth seeing. Two accounts on the same provider are still
 * distinguishable by the tail.
 */
export function truncateUserId(id: string): string {
  if (!id) return '';
  if (id.length <= MAX_LEN) return id;

  const sep = id.indexOf('|');
  // No provider prefix: keep the head, elide the tail.
  if (sep < 0) return `${id.slice(0, MAX_LEN - 1)}…`;

  const prefix = id.slice(0, sep + 1);
  const rest = id.slice(sep + 1);
  // A prefix so long that eliding the rest would gain nothing: keep head only.
  if (prefix.length >= MAX_LEN - TAIL) return `${id.slice(0, MAX_LEN - 1)}…`;

  const headRoom = MAX_LEN - prefix.length - TAIL - 1;
  if (rest.length <= headRoom + TAIL) return id;
  return `${prefix}${rest.slice(0, Math.max(0, headRoom))}…${rest.slice(-TAIL)}`;
}

/**
 * Copy text, resolving to whether it actually landed.
 *
 * navigator.clipboard is undefined on insecure origins and can reject when the
 * document is not focused, so the caller must not promise "Copied" before this
 * resolves true.
 */
export async function copyText(text: string): Promise<boolean> {
  try {
    if (!navigator?.clipboard?.writeText) return false;
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}
