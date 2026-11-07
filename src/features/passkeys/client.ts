"use client";

import { createClient } from "@/lib/supabase/client";
import { deviceLabel, passkeyErrorKind, type PasskeyErrorKind } from "./errors";

/**
 * Sign-in keys (passkeys) run in the browser: the phone's prompt (fingerprint,
 * face, screen lock, or a password manager) can only be shown from page code.
 * Supabase Auth checks the result and creates the session, which the browser
 * client stores in the same cookies the server reads. The secret part never
 * leaves the person's device.
 */

export type PasskeyItem = {
  id: string;
  name: string | null;
  createdAt: string;
  lastUsedAt: string | null;
};

export type PasskeyResult<T = void> = { ok: true; data: T } | { ok: false; error: PasskeyErrorKind };

const fail = (error: unknown): { ok: false; error: PasskeyErrorKind } => ({ ok: false, error: passkeyErrorKind(error) });

/** True when this browser can show the sign-in key prompt. Safe to call during render on the client only. */
export function passkeysSupported(): boolean {
  return typeof window !== "undefined" && typeof window.PublicKeyCredential === "function";
}

/** True when public Supabase settings exist. Without them (the demo) there is nothing to sign in to. */
export const passkeysConfigured = () =>
  Boolean(process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY);

export async function listPasskeys(): Promise<PasskeyResult<PasskeyItem[]>> {
  const { data, error } = await createClient().auth.passkey.list();
  if (error || !data) return fail(error);
  const items = data
    .map((p) => ({
      id: p.id,
      name: p.friendly_name?.trim() || null,
      createdAt: p.created_at,
      lastUsedAt: p.last_used_at ?? null,
    }))
    .sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt));
  return { ok: true, data: items };
}

/** Asks the device to make a new key, then names it after the device so the list is readable. */
export async function addPasskey(): Promise<PasskeyResult> {
  const auth = createClient().auth;
  const { data, error } = await auth.registerPasskey();
  if (error || !data) return fail(error);
  // Naming is a nicety: the key already works if it fails.
  await auth.passkey.update({ passkeyId: data.id, friendlyName: deviceLabel(navigator.userAgent) });
  return { ok: true, data: undefined };
}

export async function renamePasskey(passkeyId: string, friendlyName: string): Promise<PasskeyResult> {
  const { error } = await createClient().auth.passkey.update({ passkeyId, friendlyName: friendlyName.trim().slice(0, 120) });
  return error ? fail(error) : { ok: true, data: undefined };
}

export async function removePasskey(passkeyId: string): Promise<PasskeyResult> {
  const { error } = await createClient().auth.passkey.delete({ passkeyId });
  return error ? fail(error) : { ok: true, data: undefined };
}

/** Shows the device prompt and signs in with the key the person picks. No email or password needed. */
export async function signInWithPasskey(captchaToken?: string): Promise<PasskeyResult> {
  const { data, error } = await createClient().auth.signInWithPasskey({
    options: captchaToken ? { captchaToken } : undefined,
  });
  if (error || !data) return fail(error);
  return { ok: true, data: undefined };
}
