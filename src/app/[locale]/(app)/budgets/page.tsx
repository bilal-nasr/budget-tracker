import { setRequestLocale } from "next-intl/server";
import { BudgetsView } from "@/components/budget/budgets-view";
import { getMonthBudgets } from "@/features/budgets/queries";
import { getFixedExpenses } from "@/features/fixed/queries";
import { summarizeFixed } from "@/features/fixed/summary";
import { getInstallments } from "@/features/installments/queries";
import { getProfile } from "@/features/profile/queries";
import { todayIn } from "@/features/transactions/group";
import { getWallets } from "@/features/wallets/queries";
import type { Currency } from "@/lib/money";

const MONTH = /^\d{4}-(0[1-9]|1[0-2])$/;

export default async function BudgetsPage({ params, searchParams }: PageProps<"/[locale]/budgets">) {
  const { locale } = await params;
  setRequestLocale(locale);
  const query = await searchParams;

  const [profile, wallets] = await Promise.all([getProfile(), getWallets()]);
  const rawMonth = typeof query.month === "string" ? query.month : "";
  const month = MONTH.test(rawMonth) ? rawMonth : todayIn(profile.timezone).slice(0, 7);

  // Only currencies the owner actually holds money in.
  const held = (["USD", "LBP"] as Currency[]).filter((c) => wallets.some((w) => !w.archived && w.currency === c));
  const requested = query.currency === "LBP" || query.currency === "USD" ? query.currency : null;
  const currency: Currency = requested && held.includes(requested) ? requested : (held[0] ?? "USD");

  const [data, fixed, installments] = await Promise.all([
    getMonthBudgets(month, currency),
    getFixedExpenses(profile.timezone),
    getInstallments(profile.timezone),
  ]);
  const salaryAfter = summarizeFixed(fixed, (id) => wallets.find((w) => w.id === id), profile.salary, installments)
    .salaryAfter;

  return (
    <BudgetsView
      data={data}
      currencies={held.length > 0 ? held : [currency]}
      salaryAfterMinor={salaryAfter?.currency === currency ? salaryAfter.minor : null}
    />
  );
}
