/** What went wrong with a sign-in key (passkey) action, in terms the screen can word. */
export type PasskeyErrorKind =
  /** The person closed or declined the browser/phone prompt. Not an error to show. */
  | "cancelled"
  /** This browser or device cannot make or use sign-in keys. */
  | "unsupported"
  /** This device already has a sign-in key for the account. */
  | "duplicate"
  /** The site address does not match the server's passkey setup (a deployment problem). */
  | "domain"
  /** The bot check failed or was missing. */
  | "captcha"
  | "failed";

type ErrorLike = { name?: unknown; code?: unknown; message?: unknown; cause?: unknown };

const asLike = (value: unknown): ErrorLike => (value && typeof value === "object" ? (value as ErrorLike) : {});

/**
 * Sorts an error from the Supabase passkey calls (WebAuthn errors from the
 * browser prompt, or Auth server errors) into a few kinds the UI has words for.
 */
export function passkeyErrorKind(error: unknown): PasskeyErrorKind {
  const e = asLike(error);
  const cause = asLike(e.cause);
  const names = [e.name, cause.name];
  const code = typeof e.code === "string" ? e.code : "";
  const message = typeof e.message === "string" ? e.message : "";

  if (names.includes("NotAllowedError") || names.includes("AbortError") || code === "ERROR_CEREMONY_ABORTED") {
    return "cancelled";
  }
  if (code === "ERROR_AUTHENTICATOR_PREVIOUSLY_REGISTERED") return "duplicate";
  if (code === "ERROR_INVALID_DOMAIN" || code === "ERROR_INVALID_RP_ID") return "domain";
  if (/does not support webauthn/i.test(message) || names.includes("NotSupportedError")) return "unsupported";
  if (code === "captcha_failed" || /captcha/i.test(message)) return "captcha";
  return "failed";
}

/** A short device label for naming a new sign-in key, from the browser's user agent. */
export function deviceLabel(userAgent: string): string {
  if (/iPhone/i.test(userAgent)) return "iPhone";
  if (/iPad/i.test(userAgent)) return "iPad";
  if (/Android/i.test(userAgent)) return "Android";
  if (/Windows/i.test(userAgent)) return "Windows";
  if (/Mac OS X|Macintosh/i.test(userAgent)) return "Mac";
  if (/CrOS/i.test(userAgent)) return "Chromebook";
  if (/Linux/i.test(userAgent)) return "Linux";
  return "Device";
}
