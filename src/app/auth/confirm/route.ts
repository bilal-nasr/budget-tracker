import { NextResponse, type NextRequest } from "next/server";
import { safeNext, siteBase } from "@/features/auth/redirect";
import { createClient } from "@/lib/supabase/server";

function privateRedirect(url: URL) {
  return NextResponse.redirect(url, {
    headers: {
      "Cache-Control": "private, no-cache, no-store, must-revalidate, max-age=0",
      Expires: "0",
      Pragma: "no-cache",
    },
  });
}

/**
 * The link in the confirmation and password-reset emails lands here. Verifying the token signs the
 * person in, then they continue to `next` (onboarding for a new account).
 * This route sits outside [locale] so the locale proxy does not rewrite it.
 */
export async function GET(request: NextRequest) {
  const { searchParams } = request.nextUrl;
  const origin = siteBase(process.env.NEXT_PUBLIC_SITE_URL, request.nextUrl.origin);
  const tokenHash = searchParams.get("token_hash");
  const type = searchParams.get("type");
  const next = safeNext(searchParams.get("next"), origin);
  const locale = next.startsWith("/ar") ? "ar" : "en";

  if (tokenHash && (type === "email" || type === "recovery")) {
    const supabase = await createClient();
    const { error } = await supabase.auth.verifyOtp({ type, token_hash: tokenHash });
    if (!error) return privateRedirect(new URL(next, origin));
  }
  // Expired, reused or malformed link. A reset link goes back to ask for a new one.
  const retry = type === "recovery" ? "forgot-password" : "sign-in";
  return privateRedirect(new URL(`/${locale}/${retry}?error=link`, origin));
}
