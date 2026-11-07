import { describe, expect, it } from "vitest";
import { createTranslator } from "next-intl";
import en from "@/messages/en.json";
import ar from "@/messages/ar.json";
import { summarizeActivity } from "./activity";
import { renderSalaryEmail, type SalaryEmailModel } from "./render";
import { smtpSettings } from "./send";

const USD = { code: "USD", symbol: "$", decimalPlaces: 2, disabled: false, firstUsed: true };
const LBP = { code: "LBP", symbol: "LBP", decimalPlaces: 0, disabled: false, firstUsed: true };

describe("summarizeActivity", () => {
  it("adds income and expenses per balance", () => {
    const result = summarizeActivity([
      { balance_id: "a", kind: "income", amount_minor: 120000, tender_minor: null, cashier_changes: [] },
      { balance_id: "a", kind: "expense", amount_minor: 3050, tender_minor: null, cashier_changes: null },
      { balance_id: "a", kind: "expense", amount_minor: 950, tender_minor: null, cashier_changes: [] },
    ]);
    expect(result.get("a")).toEqual({ incomeMinor: 120000, spentMinor: 4000 });
  });

  it("charges the tender and credits change to the balance that received it", () => {
    const result = summarizeActivity([
      { balance_id: "usd", kind: "expense", amount_minor: 500, tender_minor: 1000, cashier_changes: [{ balance_id: "usd", amount_minor: 200 }, { balance_id: "lbp", amount_minor: 90000 }] },
    ]);
    expect(result.get("usd")).toEqual({ incomeMinor: 0, spentMinor: 800 });
    expect(result.get("lbp")).toEqual({ incomeMinor: 90000, spentMinor: 0 });
  });

  it("ignores transfers and loans", () => {
    expect(summarizeActivity([{ balance_id: "a", kind: "transfer", amount_minor: 100, tender_minor: null, cashier_changes: [] }]).size).toBe(0);
  });
});

const model: SalaryEmailModel = {
  locale: "en", digits: "latin", receivedOn: "2026-11-07", periodFrom: "2026-10-03",
  salary: { amountMinor: 120000, currency: USD, walletName: "Main <wallet>" },
  totals: [
    { currency: USD, incomeMinor: 120000, spentMinor: 34050, nowMinor: 250000 },
    { currency: LBP, incomeMinor: 0, spentMinor: 4500000, nowMinor: 12000000 },
  ],
  wallets: [
    { name: "Main <wallet>", kind: "bank", rows: [{ currency: USD, incomeMinor: 120000, spentMinor: 20000, nowMinor: 200000 }] },
    { name: "Pocket", kind: "cash", rows: [{ currency: LBP, incomeMinor: 0, spentMinor: 4500000, nowMinor: 12000000 }] },
  ],
  appUrl: "https://budget.example/en",
};

function translator(locale: "en" | "ar") {
  const t = createTranslator({ locale, messages: locale === "ar" ? ar : en, namespace: "SalaryEmail" });
  return (key: string, values?: Record<string, string | number>) => (t as (k: string, v?: Record<string, string | number>) => string)(key, values);
}

describe("renderSalaryEmail", () => {
  it("renders amounts, wallets, escapes names and keeps currencies apart", () => {
    const { subject, html, text } = renderSalaryEmail(model, translator("en"));
    expect(subject).toBe("Salary received: $1,200.00");
    expect(html).toContain("Main &lt;wallet&gt;");
    expect(html).not.toContain("Main <wallet>");
    expect(html).toContain("+$1,200.00");
    expect(html).toContain("−LBP 4,500,000");
    expect(html).toContain("https://budget.example/en");
    expect(html).toContain("Your wallets since Oct 3");
    expect(text).toContain("Pocket (Cash)");
    expect(text).toContain("Now: LBP 12,000,000");
  });

  it("renders right-to-left Arabic with its own copy", () => {
    const { subject, html } = renderSalaryEmail({ ...model, locale: "ar" }, translator("ar"));
    expect(subject).toBe("تم استلام الراتب: $1,200.00");
    expect(html).toContain('lang="ar" dir="rtl"');
    expect(html).toContain("كل المحافظ");
    expect(html).toContain('dir="ltr"');
  });

  it("explains an empty summary and omits the link without a site address", () => {
    const { html } = renderSalaryEmail({ ...model, wallets: [], totals: [], periodFrom: null, appUrl: null }, translator("en"));
    expect(html).toContain("No wallet activity to show yet.");
    expect(html).toContain("Your wallets this month");
    expect(html).not.toContain("Open Budget Tracker");
  });
});

describe("smtpSettings", () => {
  it("is null until host, user and password are all set", () => {
    expect(smtpSettings({})).toBeNull();
    expect(smtpSettings({ SMTP_HOST: "h", SMTP_USER: "u" })).toBeNull();
  });
  it("defaults to implicit TLS and a friendly sender", () => {
    expect(smtpSettings({ SMTP_HOST: "smtp.example.com", SMTP_USER: "me@example.com", SMTP_PASS: "x" }))
      .toMatchObject({ port: 465, from: "Budget Tracker <me@example.com>" });
  });
});
