// Schemes that would run or embed content instead of navigating to the app that asked.
const UNSAFE_SCHEMES = new Set(["javascript:", "data:", "vbscript:", "blob:", "file:"]);

/**
 * A redirect address from Supabase Auth, if it is a real URL the browser can be sent to.
 * Assistant apps may register their own scheme (a desktop app's callback), so any parseable
 * URL is allowed except schemes that would execute or embed content.
 */
export function usableRedirect(value: unknown): string | null {
  if (typeof value !== "string" || value === "") return null;
  try {
    const url = new URL(value);
    return UNSAFE_SCHEMES.has(url.protocol) ? null : url.href;
  } catch {
    return null;
  }
}

/**
 * The host the approval is sent to, from the client's registered redirect URI, for the
 * consent screen. Null when there is no host to show (unparseable, or a scheme with none).
 */
export function redirectHost(value: unknown): string | null {
  if (typeof value !== "string" || usableRedirect(value) === null) return null;
  const host = new URL(value).host;
  return host === "" ? null : host;
}

// Bidi overrides and isolates, and other invisible format characters a name could use to
// disguise itself. The name is still shown inside <bdi>; this keeps it from reordering itself.
const FORMAT_CHARACTERS = /[\u0000-\u001f\u007f-\u009f؜​-‏‪-‮⁠-⁩﻿]/g;

/** The name the app gives itself, as plain text with control and direction characters removed. */
export function clientName(value: unknown): string {
  return typeof value === "string" ? value.replace(FORMAT_CHARACTERS, "").trim() : "";
}
