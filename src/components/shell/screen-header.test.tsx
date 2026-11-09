// @vitest-environment jsdom
import { afterEach, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import en from "@/messages/en.json";

vi.mock("@/i18n/navigation", () => ({
  Link: ({ children, href, ...rest }: { children: React.ReactNode; href: string }) => <a href={href} {...rest}>{children}</a>,
}));
vi.mock("./cycle-switcher", () => ({ CycleSwitcher: () => null }));
vi.mock("./month-switcher", () => ({ MonthSwitcher: () => null }));
import { ScreenHeader } from "./screen-header";

afterEach(cleanup);

it("a long title wraps and can never shrink the 44px settings button", () => {
  render(
    <NextIntlClientProvider locale="en" messages={en}>
      <ScreenHeader title={"x".repeat(60)} />
    </NextIntlClientProvider>,
  );
  const settings = screen.getByRole("link", { name: en.Nav.settings });
  expect(settings.className).toContain("size-11");
  expect(settings.className).toContain("shrink-0");
  const title = screen.getByRole("heading", { level: 1 });
  expect(title.className).toContain("min-w-0");
  expect(title.className).toContain("[overflow-wrap:anywhere]");
  // A name is an isolated run, so a Latin name in an Arabic screen cannot reorder its neighbours.
  expect(title.querySelector("bdi")?.textContent).toBe("x".repeat(60));
});
