import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  configured: true,
  userId: "ac000000-0000-4000-8000-000000000009" as string | null,
  signInWithPassword: vi.fn(),
  updateUser: vi.fn(),
  pendingJoin: vi.fn(),
  forgetJoin: vi.fn(),
  hasJoin: vi.fn(),
  pendingAuthorization: vi.fn(),
  forgetAuthorization: vi.fn(),
  hasAuthorization: vi.fn(),
  getUserId: vi.fn(),
  signOut: vi.fn(),
  redirect: vi.fn((target: unknown) => { throw Object.assign(new Error("NEXT_REDIRECT"), { target }); }),
}));
vi.mock("server-only", () => ({}));
vi.mock("@/lib/supabase/proxy", () => ({ supabaseConfigured: () => mocks.configured }));
vi.mock("@/lib/supabase/user", () => ({ getUserId: mocks.getUserId }));
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({ auth: { signInWithPassword: mocks.signInWithPassword, updateUser: mocks.updateUser, signOut: mocks.signOut } }),
}));
vi.mock("@/i18n/navigation", () => ({ redirect: mocks.redirect }));
vi.mock("@/features/invoices/pending-join", () => ({ pendingJoinAfterSignIn: mocks.pendingJoin, forgetPendingJoin: mocks.forgetJoin, hasPendingJoin: mocks.hasJoin }));
vi.mock("@/features/connect/pending-authorization", () => ({
  pendingAuthorizationAfterSignIn: mocks.pendingAuthorization,
  forgetPendingAuthorization: mocks.forgetAuthorization,
  hasPendingAuthorization: mocks.hasAuthorization,
}));
import { afterSignInPath, signIn, signOut, updatePassword } from "./actions";

const me = "ac000000-0000-4000-8000-000000000009";
const joinPath = `/invoices/join/${"ab".repeat(32)}`;
const connectPath = "/connect?authorization_id=3f1c6a2e-9b7d-4c1a-8e2f-0a1b2c3d4e5f";

const form = (fields: Record<string, string>) => {
  const data = new FormData();
  for (const [key, value] of Object.entries(fields)) data.set(key, value);
  return data;
};
const signInForm = (locale: string) => form({ email: "person@example.test", password: "synthetic-password", locale });

beforeEach(() => {
  mocks.configured = true;
  mocks.userId = me;
  mocks.signInWithPassword.mockReset().mockResolvedValue({ data: { user: { id: me } }, error: null });
  mocks.updateUser.mockReset().mockResolvedValue({ error: null });
  mocks.pendingJoin.mockReset().mockResolvedValue(null);
  mocks.forgetJoin.mockReset().mockResolvedValue(undefined);
  mocks.hasJoin.mockReset().mockResolvedValue(true);
  mocks.pendingAuthorization.mockReset().mockResolvedValue(null);
  mocks.forgetAuthorization.mockReset().mockResolvedValue(undefined);
  mocks.hasAuthorization.mockReset().mockResolvedValue(false);
  mocks.getUserId.mockReset().mockImplementation(async () => mocks.userId);
  mocks.signOut.mockReset().mockResolvedValue({ error: null });
  mocks.redirect.mockClear();
});

describe("signIn", () => {
  it.each(["en", "ar"])("%s: goes to the remembered share link after signing in", async (locale) => {
    mocks.pendingJoin.mockResolvedValue(joinPath);
    await expect(signIn({ error: null }, signInForm(locale))).rejects.toThrow("NEXT_REDIRECT");
    expect(mocks.redirect).toHaveBeenCalledWith({ href: joinPath, locale });
    expect(mocks.pendingJoin).toHaveBeenCalledWith(expect.anything(), me);
  });

  it("goes home exactly as before when no link was remembered", async () => {
    await expect(signIn({ error: null }, signInForm("en"))).rejects.toThrow("NEXT_REDIRECT");
    expect(mocks.redirect).toHaveBeenCalledWith({ href: "/", locale: "en" });
  });

  it("a remembered share link wins over a remembered authorization, which is left for later", async () => {
    mocks.pendingJoin.mockResolvedValue(joinPath);
    mocks.pendingAuthorization.mockResolvedValue(connectPath);
    await expect(signIn({ error: null }, signInForm("en"))).rejects.toThrow("NEXT_REDIRECT");
    expect(mocks.redirect).toHaveBeenCalledWith({ href: joinPath, locale: "en" });
    expect(mocks.pendingAuthorization).not.toHaveBeenCalled();
  });

  it.each(["en", "ar"])("%s: with no share link, goes to the remembered authorization's connect page", async (locale) => {
    mocks.pendingAuthorization.mockResolvedValue(connectPath);
    await expect(signIn({ error: null }, signInForm(locale))).rejects.toThrow("NEXT_REDIRECT");
    expect(mocks.redirect).toHaveBeenCalledWith({ href: connectPath, locale });
    expect(mocks.pendingAuthorization).toHaveBeenCalledWith(expect.anything(), me);
  });

  it("goes home when looking up the authorization fails", async () => {
    mocks.pendingAuthorization.mockRejectedValue(new Error("down"));
    await expect(signIn({ error: null }, signInForm("en"))).rejects.toThrow("NEXT_REDIRECT");
    expect(mocks.redirect).toHaveBeenCalledWith({ href: "/", locale: "en" });
  });

  it("never looks at the remembered link when sign-in fails", async () => {
    mocks.signInWithPassword.mockResolvedValue({ data: { user: null }, error: { code: "invalid_credentials" } });
    expect(await signIn({ error: null }, signInForm("en"))).toEqual({ error: "credentials" });
    expect(mocks.pendingJoin).not.toHaveBeenCalled();
    expect(mocks.pendingAuthorization).not.toHaveBeenCalled();
  });
});

describe("signOut", () => {
  it.each(["en", "ar"])("%s: signs out, forgets a remembered share link and goes to sign in", async (locale) => {
    await expect(signOut(form({ locale }))).rejects.toThrow("NEXT_REDIRECT");
    expect(mocks.signOut).toHaveBeenCalledTimes(1);
    expect(mocks.forgetJoin).toHaveBeenCalledTimes(1);
    expect(mocks.forgetAuthorization).toHaveBeenCalledTimes(1);
    expect(mocks.redirect).toHaveBeenCalledWith({ href: "/sign-in", locale });
  });

  it("forgets the link in preview mode too, and a failure to forget never blocks signing out", async () => {
    mocks.configured = false;
    mocks.forgetJoin.mockRejectedValue(new Error("no cookies here"));
    mocks.forgetAuthorization.mockRejectedValue(new Error("no cookies here"));
    await expect(signOut(form({ locale: "en" }))).rejects.toThrow("NEXT_REDIRECT");
    expect(mocks.forgetAuthorization).toHaveBeenCalledTimes(1);
    expect(mocks.signOut).not.toHaveBeenCalled();
    expect(mocks.redirect).toHaveBeenCalledWith({ href: "/sign-in", locale: "en" });
  });
});

describe("updatePassword", () => {
  it("goes to the remembered share link after a reset, otherwise home", async () => {
    const reset = form({ password: "synthetic-new-pass", confirm: "synthetic-new-pass", locale: "ar" });
    mocks.pendingJoin.mockResolvedValue(joinPath);
    await expect(updatePassword({ error: null }, reset)).rejects.toThrow("NEXT_REDIRECT");
    expect(mocks.redirect).toHaveBeenLastCalledWith({ href: joinPath, locale: "ar" });
    mocks.pendingJoin.mockResolvedValue(null);
    await expect(updatePassword({ error: null }, reset)).rejects.toThrow("NEXT_REDIRECT");
    expect(mocks.redirect).toHaveBeenLastCalledWith({ href: "/", locale: "ar" });
  });

  it("after a reset: share link first, then the remembered authorization, then home", async () => {
    const reset = form({ password: "synthetic-new-pass", confirm: "synthetic-new-pass", locale: "en" });
    mocks.pendingJoin.mockResolvedValue(joinPath);
    mocks.pendingAuthorization.mockResolvedValue(connectPath);
    await expect(updatePassword({ error: null }, reset)).rejects.toThrow("NEXT_REDIRECT");
    expect(mocks.redirect).toHaveBeenLastCalledWith({ href: joinPath, locale: "en" });
    mocks.pendingJoin.mockResolvedValue(null);
    await expect(updatePassword({ error: null }, reset)).rejects.toThrow("NEXT_REDIRECT");
    expect(mocks.redirect).toHaveBeenLastCalledWith({ href: connectPath, locale: "en" });
    expect(mocks.pendingAuthorization).toHaveBeenLastCalledWith(expect.anything(), me);
  });
});

describe("afterSignInPath (passkey sign-in and the end of onboarding)", () => {
  it("returns the remembered link for the signed-in person", async () => {
    mocks.pendingJoin.mockResolvedValue(joinPath);
    expect(await afterSignInPath()).toBe(joinPath);
    expect(mocks.pendingJoin).toHaveBeenCalledWith(expect.anything(), me);
  });

  it("without a remembered link it is null at once, with no auth call at all", async () => {
    mocks.hasJoin.mockResolvedValue(false);
    mocks.hasAuthorization.mockResolvedValue(false);
    expect(await afterSignInPath()).toBeNull();
    expect(mocks.getUserId).not.toHaveBeenCalled();
    expect(mocks.pendingJoin).not.toHaveBeenCalled();
  });

  it("is null when nobody is signed in or in preview mode", async () => {
    mocks.userId = null;
    expect(await afterSignInPath()).toBeNull();
    mocks.userId = me;
    mocks.configured = false;
    expect(await afterSignInPath()).toBeNull();
    expect(mocks.pendingJoin).not.toHaveBeenCalled();
  });

  it("a share link wins; with none, the remembered authorization; with neither, null", async () => {
    mocks.hasAuthorization.mockResolvedValue(true);
    mocks.pendingJoin.mockResolvedValue(joinPath);
    mocks.pendingAuthorization.mockResolvedValue(connectPath);
    expect(await afterSignInPath()).toBe(joinPath);
    expect(mocks.pendingAuthorization).not.toHaveBeenCalled();
    mocks.pendingJoin.mockResolvedValue(null);
    expect(await afterSignInPath()).toBe(connectPath);
    expect(mocks.pendingAuthorization).toHaveBeenCalledWith(expect.anything(), me);
    mocks.pendingAuthorization.mockResolvedValue(null);
    expect(await afterSignInPath()).toBeNull();
  });

  it("looks up a remembered authorization even when no share link was remembered", async () => {
    mocks.hasJoin.mockResolvedValue(false);
    mocks.hasAuthorization.mockResolvedValue(true);
    mocks.pendingAuthorization.mockResolvedValue(connectPath);
    expect(await afterSignInPath()).toBe(connectPath);
  });

  it("is null instead of throwing when the lookup fails", async () => {
    mocks.pendingJoin.mockRejectedValue(new Error("down"));
    expect(await afterSignInPath()).toBeNull();
  });
});
