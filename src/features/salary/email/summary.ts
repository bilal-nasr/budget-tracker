import "server-only";

import { createTranslator } from "next-intl";
import { getCurrencies } from "@/features/currencies/queries";
import { todayIn } from "@/features/transactions/group";
import { attachedBalances } from "@/features/wallets/schema";
import { getWallets } from "@/features/wallets/queries";
import { readMinor, sumMinor, type Digits } from "@/lib/money";
import { createClient } from "@/lib/supabase/server";
import { readAllByKey } from "@/lib/supabase/read-all";
import { summarizeActivity, type ActivityRow } from "./activity";
import { renderSalaryEmail, type EmailBlock, type EmailRow, type SalaryEmailModel } from "./render";

function appUrl(locale: string): string | null {
  const site = process.env.NEXT_PUBLIC_SITE_URL?.trim().replace(/\/+$/, "");
  if (!site) return null;
  const base = (process.env.NEXT_PUBLIC_BASE_PATH ?? "").replace(/\/+$/, "");
  return `${site}${base}/${locale}`;
}

/** First day of the month a YYYY-MM-DD date falls in. */
function monthStart(date: string): string {
  return `${date.slice(0, 7)}-01`;
}

/**
 * Builds the email for one recorded salary receipt: per-wallet income and spending
 * since the previous salary (or since the start of the month when there is none),
 * next to what each wallet holds now, in the person's language. Runs with the signed-in user's session, so
 * row-level security keeps it to that person's own money.
 */
export async function buildSalaryEmail(receiptId: string, displayLocale?: string): Promise<{ to: string; subject: string; html: string; text: string } | null> {
  const supabase = await createClient();
  const { data: auth } = await supabase.auth.getUser();
  const to = auth.user?.email;
  const userId = auth.user?.id;
  if (!to || !userId) return null;

  // The preference column comes from a later migration; until it is applied the email stays on.
  let profile: { timezone: string; locale: string; digits: string; salary_email_enabled?: boolean } | null = null;
  const withPreference = await supabase.from("profiles").select("timezone, locale, digits, salary_email_enabled").eq("user_id", userId).maybeSingle();
  if (!withPreference.error) profile = withPreference.data;
  else {
    const legacy = await supabase.from("profiles").select("timezone, locale, digits").eq("user_id", userId).maybeSingle();
    if (!legacy.error) profile = legacy.data;
  }
  if (!profile) throw new Error("salary_email_profile_unavailable");
  if (profile.salary_email_enabled === false) return null;
  // The language the app was showing when salary was pressed wins; the saved profile language is the fallback.
  const locale: "en" | "ar" = (displayLocale === "en" || displayLocale === "ar" ? displayLocale : profile.locale) === "ar" ? "ar" : "en";
  const digits: Digits = profile.digits === "arabic" ? "arabic" : "latin";

  const receipt = await supabase.from("transactions")
    .select("id, balance_id, amount_minor, occurred_on")
    .eq("id", receiptId).eq("user_id", userId).eq("source", "salary").is("deleted_at", null).maybeSingle();
  if (receipt.error || !receipt.data) throw new Error("salary_email_receipt_unavailable");

  const previous = await supabase.from("transactions").select("occurred_on")
    .eq("user_id", userId).eq("source", "salary").is("deleted_at", null).neq("id", receiptId)
    .lte("occurred_on", todayIn(profile.timezone))
    .order("occurred_on", { ascending: false }).order("created_at", { ascending: false }).limit(1).maybeSingle();
  if (previous.error) throw new Error("salary_email_period_unavailable");
  const periodFrom: string | null = previous.data?.occurred_on ?? null;
  const from = periodFrom ?? monthStart(receipt.data.occurred_on);

  const [currencies, wallets, activityRows] = await Promise.all([
    getCurrencies(),
    getWallets(),
    readAllByKey(async (after, limit) => {
      let query = supabase.from("transactions")
        .select("id, balance_id, kind, amount_minor, tender_minor, cashier_changes(balance_id, amount_minor)")
        .eq("user_id", userId).is("deleted_at", null).in("kind", ["income", "expense"])
        .gte("occurred_on", from).neq("id", receiptId)
        .order("id").limit(limit);
      if (after !== null) query = query.gt("id", after);
      return query;
    }, (row) => row.id, "Salary email activity unavailable"),
  ]);
  const activity = summarizeActivity(activityRows as unknown as ActivityRow[]);

  const blocks: EmailBlock[] = [];
  const perCurrency = new Map<string, { income: number[]; spent: number[]; now: number[] }>();
  for (const wallet of wallets) {
    const rows: EmailRow[] = [];
    for (const balance of attachedBalances(wallet, currencies)) {
      const currency = currencies.find((c) => c.code === balance.currency)!;
      const a = activity.get(balance.id) ?? { incomeMinor: 0, spentMinor: 0 };
      const totals = perCurrency.get(currency.code) ?? { income: [], spent: [], now: [] };
      totals.income.push(a.incomeMinor); totals.spent.push(a.spentMinor); totals.now.push(balance.balanceMinor);
      perCurrency.set(currency.code, totals);
      if (a.incomeMinor === 0 && a.spentMinor === 0 && balance.balanceMinor === 0) continue;
      rows.push({ currency, incomeMinor: a.incomeMinor, spentMinor: a.spentMinor, nowMinor: balance.balanceMinor });
    }
    if (rows.length > 0) blocks.push({ name: wallet.name, kind: wallet.kind, rows });
  }
  const totals: EmailRow[] = [];
  for (const currency of currencies) {
    const sums = perCurrency.get(currency.code);
    if (!sums) continue;
    const row = { currency, incomeMinor: sumMinor(sums.income), spentMinor: sumMinor(sums.spent), nowMinor: sumMinor(sums.now) };
    if (row.incomeMinor !== 0 || row.spentMinor !== 0 || row.nowMinor !== 0) totals.push(row);
  }

  const salaryBalanceId = receipt.data.balance_id;
  const salaryWallet = wallets.find((w) => w.balances.some((b) => b.id === salaryBalanceId));
  const salaryBalance = salaryWallet?.balances.find((b) => b.id === salaryBalanceId);
  const salaryCurrency = salaryBalance && currencies.find((c) => c.code === salaryBalance.currency);
  if (!salaryWallet || !salaryCurrency) throw new Error("salary_email_wallet_unavailable");

  const model: SalaryEmailModel = {
    locale, digits, receivedOn: receipt.data.occurred_on, periodFrom,
    salary: { amountMinor: readMinor(receipt.data.amount_minor), currency: salaryCurrency, walletName: salaryWallet.name },
    totals, wallets: blocks, appUrl: appUrl(locale),
  };
  const messages = (await import(`@/messages/${locale}.json`)).default;
  const translator = createTranslator({ locale, messages, namespace: "SalaryEmail" });
  const t = (key: string, values?: Record<string, string | number>) => (translator as (k: string, v?: Record<string, string | number>) => string)(key, values);
  return { to, ...renderSalaryEmail(model, t) };
}
