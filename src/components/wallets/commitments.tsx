import { Calculator, ChevronRight, HandCoins, Hourglass } from "lucide-react";
import { getTranslations } from "next-intl/server";
import { Amount } from "@/components/money/amount";
import { getShoppingItems } from "@/features/items/queries";
import { getLoans } from "@/features/loans/queries";
import { getPendingPayments } from "@/features/pending-payments/queries";
import { Link } from "@/i18n/navigation";

type Total = { currency: string; minor: number };

function sum(rows: readonly Total[]): Total[] {
  const totals = new Map<string, number>();
  for (const row of rows) totals.set(row.currency, (totals.get(row.currency) ?? 0) + row.minor);
  return [...totals].map(([currency, minor]) => ({ currency, minor })).filter((total) => total.minor > 0);
}

function Amounts({ totals }: { totals: Total[] }) {
  const shown = totals.slice(0, 2);
  return <>
    {shown.map((total, index) => <span key={total.currency}>{index > 0 ? " · " : null}<Amount minor={total.minor} currency={total.currency} /></span>)}
    {totals.length > shown.length ? <span className="text-muted-foreground"> +{totals.length - shown.length}</span> : null}
  </>;
}

function Row({ href, icon: Icon, title, hint, children }: { href: "/loans" | "/pending-payments" | "/items"; icon: typeof HandCoins; title: string; hint: string; children?: React.ReactNode }) {
  return (
    <Link href={href} className="flex min-h-[72px] items-center gap-3 px-3.5 py-3 hover:bg-accent/50 active:bg-accent focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ring">
      <span className="grid size-10 shrink-0 place-items-center rounded-md border border-border bg-secondary text-primary"><Icon aria-hidden className="size-5" /></span>
      <span className="min-w-0 flex-1">
        <span className="block font-medium">{title}</span>
        <span className="block text-[13px] text-muted-foreground">{hint}</span>
      </span>
      {children ? <span className="flex min-w-0 max-w-[45%] flex-col items-end gap-0.5 text-[13px]">{children}</span> : null}
      <ChevronRight aria-hidden className="size-4 shrink-0 text-muted-foreground rtl:-scale-x-100" />
    </Link>
  );
}

/** Loans, client payments and the item calculator at a glance; each opens its own screen. Totals stay per currency, never mixed. */
export async function Commitments() {
  const [t, loans, jobs, items] = await Promise.all([getTranslations("Wallets"), getLoans().catch(() => []), getPendingPayments().catch(() => []), getShoppingItems().catch(() => [])]);
  const l = await getTranslations("Loans");
  const p = await getTranslations("PendingPayments");
  const i = await getTranslations("Items");
  const active = loans.filter((loan) => !loan.deletedAt && !loan.archivedAt && loan.remainingMinor > 0);
  const owe = sum(active.filter((loan) => loan.direction === "borrowed").map((loan) => ({ currency: loan.currency, minor: loan.remainingMinor })));
  const owed = sum(active.filter((loan) => loan.direction === "lent").map((loan) => ({ currency: loan.currency, minor: loan.remainingMinor })));
  const waiting = jobs.filter((job) => job.remainingMinor > 0);
  const clientOwes = sum(waiting.map((job) => ({ currency: job.currency, minor: job.remainingMinor })));
  const listed = items.filter((item) => !item.boughtOn);
  const toBuy = sum(listed.map((item) => ({ currency: item.currency, minor: item.priceMinor })));
  return (
    <ul className="divide-y divide-border overflow-hidden rounded-xl border border-border bg-card">
      <li>
        <Row href="/loans" icon={HandCoins} title={l("title")} hint={active.length > 0 ? t("activeCount", { count: active.length }) : t("noneActive")}>
          {owe.length > 0 ? <span><span className="text-muted-foreground">{t("youOwe")} </span><Amounts totals={owe} /></span> : null}
          {owed.length > 0 ? <span><span className="text-muted-foreground">{t("owedToYou")} </span><Amounts totals={owed} /></span> : null}
        </Row>
      </li>
      <li>
        <Row href="/pending-payments" icon={Hourglass} title={p("title")} hint={waiting.length > 0 ? t("waitingCount", { count: waiting.length }) : t("nothingPending")}>
          {clientOwes.length > 0 ? <span><Amounts totals={clientOwes} /></span> : null}
        </Row>
      </li>
      <li>
        <Row href="/items" icon={Calculator} title={i("title")} hint={listed.length > 0 ? t("itemsCount", { count: listed.length }) : t("nothingListed")}>
          {toBuy.length > 0 ? <span><Amounts totals={toBuy} /></span> : null}
        </Row>
      </li>
    </ul>
  );
}
