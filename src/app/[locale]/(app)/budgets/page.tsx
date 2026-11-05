import { setRequestLocale } from "next-intl/server";
import { BudgetsView } from "@/components/budget/budgets-view";
import { getMonthBudgets } from "@/features/budgets/queries";
import { getFixedExpenses } from "@/features/fixed/queries";
import { summarizeFixed } from "@/features/fixed/summary";
import { getInstallments } from "@/features/installments/queries";
import { getProfile } from "@/features/profile/queries";
import { todayIn } from "@/features/transactions/group";
import { getWallets } from "@/features/wallets/queries";
import { getCurrencies } from "@/features/currencies/queries";
import { availableBudgetCurrencies } from "@/features/budgets/rows";

const MONTH = /^\d{4}-(0[1-9]|1[0-2])$/;

export default async function BudgetsPage({ params, searchParams }: PageProps<"/[locale]/budgets">) {
  const { locale } = await params;
  setRequestLocale(locale);
  const query = await searchParams;

  const [profile, wallets, catalog] = await Promise.all([getProfile(), getWallets({ includeDeleted: true, includeNeedsAttention: true, includeDisabledBalances: true }), getCurrencies()]);
  const rawMonth = typeof query.month === "string" ? query.month : "";
  const month = MONTH.test(rawMonth) ? rawMonth : todayIn(profile.timezone).slice(0, 7);

  const [months, fixed, installments] = await Promise.all([
    Promise.all(catalog.map((currency) => getMonthBudgets(month, currency.code))),
    getFixedExpenses(profile.timezone),
    getInstallments(profile.timezone),
  ]);
  const held = availableBudgetCurrencies(catalog, months);
  const requested = typeof query.currency === "string" ? query.currency : null;
  const currency = requested && held.includes(requested) ? requested : (held[0] ?? catalog[0].code);
  const data = months.find((data) => data.currency === currency)!;
  const salaryAfter = summarizeFixed(fixed, (id) => { const wallet = wallets.find((wallet) => wallet.balances.some((balance) => balance.id === id)); const balance = wallet?.balances.find((balance) => balance.id === id); return balance && wallet ? { ...balance, position: wallet.position } : undefined; }, profile.salary, installments, catalog.map((currency) => currency.code))
    .salaryAfter;

  return (
    <BudgetsView
      data={data}
      currencies={held.length > 0 ? held : [currency]}
      salaryAfterMinor={salaryAfter?.currency === currency ? salaryAfter.minor : null}
    />
  );
}
