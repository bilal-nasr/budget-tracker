"use client";

import { useEffect, useRef, useState } from "react";
import Script from "next/script";

type Turnstile = {
  render: (el: HTMLElement, options: Record<string, unknown>) => string;
  remove: (id: string) => void;
};

const SITE_KEY = process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY;

/**
 * Cloudflare Turnstile bot check. Renders only when NEXT_PUBLIC_TURNSTILE_SITE_KEY
 * is set, and puts the solved token in a hidden `captchaToken` field of the
 * surrounding form. A token works once: give the component a new `key` after
 * each submit so it solves a fresh one. Turn on the matching captcha
 * protection in the Supabase dashboard, or the token is ignored.
 */
export function Captcha() {
  const box = useRef<HTMLDivElement>(null);
  const [token, setToken] = useState("");
  const [ready, setReady] = useState(false);

  useEffect(() => {
    const turnstile = (window as unknown as { turnstile?: Turnstile }).turnstile;
    if (!SITE_KEY || !ready || !box.current || !turnstile) return;
    const id = turnstile.render(box.current, {
      sitekey: SITE_KEY,
      callback: (value: string) => setToken(value),
      "expired-callback": () => setToken(""),
      "error-callback": () => setToken(""),
    });
    return () => turnstile.remove(id);
  }, [ready]);

  if (!SITE_KEY) return null;
  return (
    <>
      <Script
        src="https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit"
        strategy="afterInteractive"
        onReady={() => setReady(true)}
      />
      <div ref={box} />
      <input type="hidden" name="captchaToken" value={token} readOnly />
    </>
  );
}
