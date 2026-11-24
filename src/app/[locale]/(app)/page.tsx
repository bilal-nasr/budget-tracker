import { Suspense } from "react";
import { notFound } from "next/navigation";
import { hasLocale } from "next-intl";
import { setRequestLocale } from "next-intl/server";
import { routing } from "@/i18n/routing";
import { HomeView, HomeBudgetSummary, HomeCommitments, HomeRecent } from "@/components/home/home-view";
import { getSpendingSummary } from "@/features/budgets/summary";
import { getFixedExpenses } from "@/features/fixed/queries";
import { getCycleSummary } from "@/features/installments/queries";
import { getProfile } from "@/features/profile/queries";
import { salaryStatusFromReceipt } from "@/features/salary/schema";
import { fetchTransactions } from "@/features/transactions/queries";
import { timed } from "@/lib/timing";

type ProfilePromise = ReturnType<typeof getProfile>;

async function BudgetData({ profile }: { profile: ProfilePromise }) {
  const { timezone } = await profile;
  const { calendarMonth, salaryCycle } = await timed("home.budgets", () => getSpendingSummary(timezone, "active"));
  const budgets = salaryCycle?.budgets ?? calendarMonth?.budgets ?? [];
  return <HomeBudgetSummary cycle={salaryCycle !== null} budgets={budgets.filter((b) => b.totalLimitMinor > 0)} />;
}

async function CommitmentData({ profile }: { profile: ProfilePromise }) {
  const { timezone } = await profile;
  const [snapshot, fixed] = await Promise.all([
    timed("home.cycles", () => getCycleSummary(timezone)).catch(() => null),
    timed("home.fixed", () => getFixedExpenses(timezone)),
  ]);
  return <HomeCommitments cycleUnavailable={snapshot === null} salaryStatus={salaryStatusFromReceipt(snapshot?.receipt ?? null, timezone)}
    fixed={fixed} installments={snapshot?.installments ?? []} />;
}

async function RecentData({ recent }: { recent: ReturnType<typeof fetchTransactions> }) {
  return <HomeRecent recent={(await recent).rows} />;
}

export default async function HomePage({ params }: PageProps<"/[locale]">) {
  const { locale } = await params;
  // Same guard as the (app) layout: this page's reads start in parallel with it.
  if (!hasLocale(routing.locales, locale)) notFound();
  setRequestLocale(locale);
  // Start independent reads before the profile resolves. Separate boundaries let
  // the wallet hero and recent activity render while slower sections are pending.
  const profile = getProfile();
  const recent = timed("home.recent", () => fetchTransactions({}, null, 5));
  return <HomeView
    budgetSummary={<Suspense fallback={<div className="mt-3 h-12 animate-pulse rounded-lg bg-white/10" />}><BudgetData profile={profile} /></Suspense>}
    commitments={<Suspense fallback={<div className="h-64 animate-pulse rounded-xl bg-accent" />}><CommitmentData profile={profile} /></Suspense>}
    recent={<Suspense fallback={<div className="h-48 animate-pulse rounded-xl bg-accent" />}><RecentData recent={recent} /></Suspense>}
  />;
}
