import { setRequestLocale } from "next-intl/server";
import { Suspense } from "react";
import { HomeView } from "@/components/home/home-view";
import { getProfile } from "@/features/profile/queries";
import { getSalaryStatus } from "@/features/salary/queries";
import { fetchTransactions } from "@/features/transactions/queries";

async function HomeData() {
  const profile = await getProfile();
  const [{ rows }, salaryStatus] = await Promise.all([
    fetchTransactions({}, null, 5),
    getSalaryStatus(profile.timezone),
  ]);
  return <HomeView recent={rows} salaryStatus={salaryStatus} />;
}

export default async function HomePage({ params }: PageProps<"/[locale]">) {
  const { locale } = await params;
  setRequestLocale(locale);
  return (
    <Suspense fallback={<div className="h-40 bg-shell" />}>
      <HomeData />
    </Suspense>
  );
}
