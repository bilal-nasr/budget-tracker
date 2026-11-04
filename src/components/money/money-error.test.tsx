// @vitest-environment jsdom
import { afterEach, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import en from "@/messages/en.json";
import ar from "@/messages/ar.json";
import LocaleError from "@/app/[locale]/error";
import { MoneyRangeError } from "@/lib/money";

afterEach(cleanup);
it.each(["en", "ar"] as const)("%s amount error withholds raw financial details and offers retry", (locale) => {
  const messages = locale === "en" ? en : ar;
  const reset = vi.fn();
  render(<NextIntlClientProvider locale={locale} messages={messages}>
    <LocaleError error={new MoneyRangeError()} reset={reset} />
  </NextIntlClientProvider>);
  expect(screen.queryByText(/supported integer money range/)).toBeNull();
  expect(screen.getByRole("heading", { name: messages.MoneyError.title })).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: messages.MoneyError.retry }));
  expect(reset).toHaveBeenCalledOnce();
});
