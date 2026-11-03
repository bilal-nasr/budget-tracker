import { setRequestLocale } from "next-intl/server";
import { HomeView } from "@/components/home/home-view";
import { getMonthBudgets } from "@/features/budgets/queries";
import { getFixedExpenses } from "@/features/fixed/queries";
import { getInstallments } from "@/features/installments/queries";
import { getProfile } from "@/features/profile/queries";
import { getSalaryStatus } from "@/features/salary/queries";
import { todayIn } from "@/features/transactions/group";
import { fetchTransactions } from "@/features/transactions/queries";
import { getWallets } from "@/features/wallets/queries";
import { timed } from "@/lib/timing";

async function HomeData() {
  const profile = await getProfile();
  const month = todayIn(profile.timezone).slice(0, 7);
  const wallets = await getWallets();
  const held = (["USD", "LBP"] as const).filter((c) => wallets.some((w) => !w.archived && w.currency === c));
  const [{ rows }, salaryStatus, fixed, installments, budgets] = await Promise.all([
    timed("home.recent", () => fetchTransactions({}, null, 5)),
    timed("home.salary", () => getSalaryStatus(profile.timezone)),
    timed("home.fixed", () => getFixedExpenses(profile.timezone)),
    timed("home.installments", () => getInstallments(profile.timezone)),
    Promise.all(held.map((c) => timed("home.budgets", () => getMonthBudgets(month, c)))),
  ]);
  return <HomeView recent={rows} salaryStatus={salaryStatus} fixed={fixed} installments={installments} budgets={budgets.filter((b) => b.totalLimitMinor > 0)} />;
}

export default async function HomePage({ params }: PageProps<"/[locale]">) {
  const { locale } = await params;
  setRequestLocale(locale);
  return <HomeData />;
}
