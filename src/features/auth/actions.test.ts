import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  configured: true,
  userId: "ac000000-0000-4000-8000-000000000009" as string | null,
  signInWithPassword: vi.fn(),
  updateUser: vi.fn(),
  pendingJoin: vi.fn(),
  forgetJoin: vi.fn(),
  hasJoin: vi.fn(),
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
import { afterSignInPath, signIn, signOut, updatePassword } from "./actions";

const me = "ac000000-0000-4000-8000-000000000009";
const joinPath = `/invoices/join/${"ab".repeat(32)}`;

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

  it("never looks at the remembered link when sign-in fails", async () => {
    mocks.signInWithPassword.mockResolvedValue({ data: { user: null }, error: { code: "invalid_credentials" } });
    expect(await signIn({ error: null }, signInForm("en"))).toEqual({ error: "credentials" });
    expect(mocks.pendingJoin).not.toHaveBeenCalled();
  });
});

describe("signOut", () => {
  it.each(["en", "ar"])("%s: signs out, forgets a remembered share link and goes to sign in", async (locale) => {
    await expect(signOut(form({ locale }))).rejects.toThrow("NEXT_REDIRECT");
    expect(mocks.signOut).toHaveBeenCalledTimes(1);
    expect(mocks.forgetJoin).toHaveBeenCalledTimes(1);
    expect(mocks.redirect).toHaveBeenCalledWith({ href: "/sign-in", locale });
  });

  it("forgets the link in preview mode too, and a failure to forget never blocks signing out", async () => {
    mocks.configured = false;
    mocks.forgetJoin.mockRejectedValue(new Error("no cookies here"));
    await expect(signOut(form({ locale: "en" }))).rejects.toThrow("NEXT_REDIRECT");
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
});

describe("afterSignInPath (passkey sign-in and the end of onboarding)", () => {
  it("returns the remembered link for the signed-in person", async () => {
    mocks.pendingJoin.mockResolvedValue(joinPath);
    expect(await afterSignInPath()).toBe(joinPath);
    expect(mocks.pendingJoin).toHaveBeenCalledWith(expect.anything(), me);
  });

  it("without a remembered link it is null at once, with no auth call at all", async () => {
    mocks.hasJoin.mockResolvedValue(false);
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

  it("is null instead of throwing when the lookup fails", async () => {
    mocks.pendingJoin.mockRejectedValue(new Error("down"));
    expect(await afterSignInPath()).toBeNull();
  });
});
