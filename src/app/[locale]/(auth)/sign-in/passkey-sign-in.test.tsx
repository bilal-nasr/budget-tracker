// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import en from "@/messages/en.json";

const mocks = vi.hoisted(() => ({ replace: vi.fn(), refresh: vi.fn(), signIn: vi.fn(), afterSignInPath: vi.fn() }));
vi.mock("@/i18n/navigation", () => ({ useRouter: () => ({ replace: mocks.replace, refresh: mocks.refresh }) }));
vi.mock("@/features/passkeys/client", () => ({
  passkeysConfigured: () => true,
  passkeysSupported: () => true,
  signInWithPasskey: mocks.signIn,
}));
vi.mock("@/features/auth/actions", () => ({ afterSignInPath: mocks.afterSignInPath }));
import { PasskeySignIn } from "./passkey-sign-in";

const joinPath = `/invoices/join/${"ab".repeat(32)}`;

beforeEach(() => {
  mocks.replace.mockReset();
  mocks.signIn.mockReset().mockResolvedValue({ ok: true, data: undefined });
  mocks.afterSignInPath.mockReset().mockResolvedValue(null);
});
afterEach(cleanup);

async function press() {
  render(<NextIntlClientProvider locale="en" messages={en}><PasskeySignIn captchaToken={() => undefined} onAttempt={() => {}} /></NextIntlClientProvider>);
  await act(async () => { fireEvent.click(screen.getByRole("button", { name: en.SignIn.passkey })); });
}

it("goes to the remembered share link after a sign-in key works", async () => {
  mocks.afterSignInPath.mockResolvedValue(joinPath);
  await press();
  expect(mocks.replace).toHaveBeenCalledWith(joinPath);
});

it("goes home as before when no link was remembered or the lookup fails", async () => {
  await press();
  expect(mocks.replace).toHaveBeenLastCalledWith("/");
  cleanup();
  mocks.afterSignInPath.mockRejectedValue(new Error("down"));
  await press();
  expect(mocks.replace).toHaveBeenLastCalledWith("/");
});
