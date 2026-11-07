/**
 * Renders the "salary received" email with synthetic data, to preview or to send.
 *
 *   npx tsx --env-file=.env.local scripts/salary-email-sample.ts [--locale ar] [--out sample.html] [--send you@example.com]
 *
 * --send needs SMTP_HOST / SMTP_USER / SMTP_PASS (see .env.example). Never real money.
 */
import { writeFileSync } from "node:fs";
import { createTranslator } from "next-intl";
import en from "../src/messages/en.json";
import ar from "../src/messages/ar.json";
import { renderSalaryEmail, type SalaryEmailModel } from "../src/features/salary/email/render";
import { sendMail } from "../src/features/salary/email/send";

const args = process.argv.slice(2);
const flag = (name: string) => { const i = args.indexOf(name); return i === -1 ? undefined : args[i + 1]; };
const locale = flag("--locale") === "ar" ? "ar" : "en";

const USD = { code: "USD", symbol: "$", decimalPlaces: 2, disabled: false, firstUsed: true };
const LBP = { code: "LBP", symbol: "LBP", decimalPlaces: 0, disabled: false, firstUsed: true };

const model: SalaryEmailModel = {
  locale, digits: "latin", receivedOn: "2026-11-07", periodFrom: "2026-10-03",
  salary: { amountMinor: 120000, currency: USD, walletName: locale === "ar" ? "الحساب الرئيسي" : "Main account" },
  totals: [
    { currency: USD, incomeMinor: 120000, spentMinor: 61250, nowMinor: 318075 },
    { currency: LBP, incomeMinor: 2000000, spentMinor: 14750000, nowMinor: 9250000 },
  ],
  wallets: [
    { name: locale === "ar" ? "الحساب الرئيسي" : "Main account", kind: "bank", rows: [
      { currency: USD, incomeMinor: 120000, spentMinor: 48200, nowMinor: 301075 },
    ] },
    { name: locale === "ar" ? "جيب" : "Pocket cash", kind: "cash", rows: [
      { currency: USD, incomeMinor: 0, spentMinor: 13050, nowMinor: 17000 },
      { currency: LBP, incomeMinor: 2000000, spentMinor: 14750000, nowMinor: 9250000 },
    ] },
  ],
  appUrl: "http://localhost:3000/" + locale,
};

const translator = createTranslator({ locale, messages: locale === "ar" ? ar : en, namespace: "SalaryEmail" });
const t = (key: string, values?: Record<string, string | number>) => (translator as (k: string, v?: Record<string, string | number>) => string)(key, values);
const email = renderSalaryEmail(model, t);

const out = flag("--out");
if (out) { writeFileSync(out, email.html, "utf8"); console.log(`wrote ${out}`); }

const to = flag("--send");
if (to) {
  sendMail({ to, ...email }).then((sent) => {
    console.log(sent ? `sent "${email.subject}" to ${to}` : "SMTP is not configured (SMTP_HOST, SMTP_USER, SMTP_PASS)");
    process.exitCode = sent ? 0 : 1;
  }, (error: unknown) => { console.error("send failed:", error instanceof Error ? error.message : error); process.exitCode = 1; });
}
