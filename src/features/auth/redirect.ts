/**
 * The public address of the app. Behind a proxy or in Docker the request's own
 * origin is often internal (localhost:3000), so the configured site URL wins;
 * the request origin is only a fallback for local development.
 */
export function siteBase(configured: string | undefined, requestOrigin: string): string {
  const value = configured?.trim().replace(/\/+$/, "");
  if (!value) return requestOrigin;
  try {
    return new URL(value).origin;
  } catch {
    return requestOrigin;
  }
}

const SAFE_PATH = /^\/(en|ar)(\/[\w-]+)*\/?$/;

/**
 * Where to send someone after they confirm their email. The `next` value comes
 * from a link, so only same-site paths under /en or /ar are honoured; anything
 * else (another site, protocol-relative, path tricks) goes to /en. A full URL
 * is accepted only when it is on `origin`, and reduced to its path.
 */
export function safeNext(next: string | null, origin?: string): string {
  if (!next) return "/en";
  let path = next;
  if (/^https?:\/\//i.test(next)) {
    if (!origin) return "/en";
    try {
      const url = new URL(next);
      if (url.origin !== origin) return "/en";
      path = url.pathname;
    } catch {
      return "/en";
    }
  }
  return SAFE_PATH.test(path) ? path : "/en";
}
