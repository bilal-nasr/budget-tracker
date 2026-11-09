// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import en from "@/messages/en.json";

const mocks = vi.hoisted(() => ({
  replace: vi.fn(),
  completeOnboarding: vi.fn(),
  updateProfile: vi.fn(),
  afterSignInPath: vi.fn(),
}));
vi.mock("@/i18n/navigation", () => ({ useRouter: () => ({ replace: mocks.replace }) }));
vi.mock("@/features/profile/actions", () => ({ completeOnboarding: mocks.completeOnboarding, updateProfile: mocks.updateProfile }));
vi.mock("@/features/auth/actions", () => ({ afterSignInPath: mocks.afterSignInPath }));
vi.mock("@/components/wallets/wallet-sheet", () => ({ WalletForm: () => null }));
import { OnboardingForm } from "./onboarding-form";

const joinPath = `/invoices/join/${"ab".repeat(32)}`;

beforeEach(() => {
  mocks.replace.mockReset();
  mocks.completeOnboarding.mockReset().mockResolvedValue({ ok: true });
  mocks.updateProfile.mockReset().mockResolvedValue({ ok: true });
  mocks.afterSignInPath.mockReset().mockResolvedValue(null);
});
afterEach(cleanup);

async function finishOnboarding() {
  render(<NextIntlClientProvider locale="en" messages={en}><OnboardingForm currencies={[]} /></NextIntlClientProvider>);
  await act(async () => { fireEvent.click(screen.getByRole("button", { name: en.Onboarding.continue })); });
  await act(async () => { fireEvent.click(screen.getByRole("button", { name: en.Onboarding.skip })); });
}

it("opens the share link remembered before sign-up once onboarding is done", async () => {
  mocks.afterSignInPath.mockResolvedValue(joinPath);
  await finishOnboarding();
  expect(mocks.completeOnboarding).toHaveBeenCalledTimes(1);
  expect(mocks.replace).toHaveBeenCalledWith(joinPath, { locale: "en" });
});

it("goes home as before when no link was remembered", async () => {
  await finishOnboarding();
  expect(mocks.replace).toHaveBeenCalledWith("/", { locale: "en" });
});

it("still goes home if the remembered-link lookup fails", async () => {
  mocks.afterSignInPath.mockRejectedValue(new Error("down"));
  await finishOnboarding();
  expect(mocks.replace).toHaveBeenCalledWith("/", { locale: "en" });
});
