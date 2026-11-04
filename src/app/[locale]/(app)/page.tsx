import { setRequestLocale } from "next-intl/server";
import { HomeView } from "@/components/home/home-view";
import { getMonthBudgets } from "@/features/budgets/queries";
import { getFixedExpenses } from "@/features/fixed/queries";
import { getCycleSnapshot } from "@/features/installments/queries";
import { getProfile } from "@/features/profile/queries";
import { salaryStatusFromReceipt } from "@/features/salary/schema";
import { todayIn } from "@/features/transactions/group";
import { fetchTransactions } from "@/features/transactions/queries";
import { timed } from "@/lib/timing";
import { CURRENCIES } from "@/lib/money";

async function HomeData() {
  const profile = await getProfile();
  const month = todayIn(profile.timezone).slice(0, 7);
  const [{ rows }, snapshot, fixed, budgets] = await Promise.all([
    timed("home.recent", () => fetchTransactions({}, null, 5)),
    timed("home.cycles", () => getCycleSnapshot(profile.timezone)).catch(() => null),
    timed("home.fixed", () => getFixedExpenses(profile.timezone)),
    Promise.all(CURRENCIES.map((c) => timed("home.budgets", () => getMonthBudgets(month, c)))),
  ]);
  return <HomeView recent={rows} cycleUnavailable={snapshot === null} salaryStatus={salaryStatusFromReceipt(snapshot?.receipt ?? null, profile.timezone)} fixed={fixed} installments={snapshot?.installments ?? []} budgets={budgets.filter((b) => b.totalLimitMinor > 0)} />;
}

export default async function HomePage({ params }: PageProps<"/[locale]">) {
  const { locale } = await params;
  setRequestLocale(locale);
  return <HomeData />;
}
