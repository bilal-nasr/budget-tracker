import { useTranslations } from "next-intl";
import { setRequestLocale } from "next-intl/server";
import { Suspense, use } from "react";
import { PageBody } from "@/components/shell/page-body";
import { ScreenHeader } from "@/components/shell/screen-header";
import { ActivityView } from "@/components/transactions/activity-view";
import { fetchTransactions } from "@/features/transactions/queries";
import { filtersSchema } from "@/features/transactions/schema";

type SearchParams = Record<string, string | string[] | undefined>;

function parseFilters(params: SearchParams) {
  const pick = (key: string) => {
    const value = params[key];
    return typeof value === "string" && value !== "" ? value : undefined;
  };
  const parsed = filtersSchema.safeParse({
    q: pick("q"),
    kind: pick("kind"),
    walletId: pick("walletId"),
    categoryId: pick("categoryId"),
    from: pick("from"),
    to: pick("to"),
  });
  // A bad value in the URL just drops that filter.
  if (parsed.success) return parsed.data;
  const fields = filtersSchema.shape;
  return Object.fromEntries(
    Object.entries(fields)
      .map(([key, schema]) => [key, schema.safeParse(pick(key)).data])
      .filter(([, v]) => v !== undefined),
  );
}

async function ActivityData({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const filters = parseFilters(await searchParams);
  const initial = await fetchTransactions(filters, null);
  return <ActivityView key={JSON.stringify(filters)} filters={filters} initial={initial} />;
}

export default function ActivityPage({ params, searchParams }: PageProps<"/[locale]/activity">) {
  const { locale } = use(params);
  setRequestLocale(locale);
  const nav = useTranslations("Nav");
  return (
    <>
      <ScreenHeader title={nav("activity")} />
      <PageBody className="gap-3">
        <Suspense fallback={<div className="h-48 animate-pulse rounded-xl bg-accent" />}>
          <ActivityData searchParams={searchParams} />
        </Suspense>
      </PageBody>
    </>
  );
}
