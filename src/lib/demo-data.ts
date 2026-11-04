import "server-only";
import type { Category } from "@/features/categories/schema";
import type { FixedExpense } from "@/features/fixed/schema";
import { withProgress, type Installment, type InstallmentPayment } from "@/features/installments/schema";
import type { SalaryReceipt } from "@/features/installments/cycle";
import type { Currency } from "@/lib/money";
import type { Wallet } from "@/features/wallets/schema";
import { addDays, todayIn } from "@/features/transactions/group";
import type { Cursor, Filters, Page, Transaction } from "@/features/transactions/schema";
import { emptyTransactionMetadata } from "@/features/transactions/schema";
import { matchesActivityKind } from "@/features/transactions/activity-filter";
import type { Loan, LoanEvent } from "@/features/loans/schema";
import type { BudgetLimit, CategorySpend } from "@/features/budgets/schema";

/**
 * Synthetic data shown only when Supabase is not configured (a fresh
 * checkout or the end-to-end tests). Read-only: writes report "not configured".
 */
const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;

export const DEMO_CATEGORIES: Category[] = [
  { id: id(101), kind: "expense", nameEn: "Groceries", nameAr: "بقالة", tile: 3, color: "teal", position: 1, parentId: null, archivedAt: null },
  { id: id(102), kind: "expense", nameEn: "Transport", nameAr: "مواصلات", tile: 2, color: "oxblood", position: 2, parentId: null, archivedAt: null },
  { id: id(103), kind: "expense", nameEn: "Eating out", nameAr: "مطاعم", tile: 4, color: "ochre", position: 3, parentId: null, archivedAt: null },
  { id: id(104), kind: "expense", nameEn: "Bills", nameAr: "فواتير", tile: 1, color: "teal", position: 4, parentId: null, archivedAt: null },
  { id: id(105), kind: "expense", nameEn: "Health", nameAr: "صحة", tile: 6, color: "oxblood", position: 5, parentId: null, archivedAt: null },
  { id: id(106), kind: "expense", nameEn: "Rent", nameAr: "إيجار", tile: 7, color: "ochre", position: 6, parentId: null, archivedAt: null },
  { id: id(107), kind: "expense", nameEn: "Fun", nameAr: "ترفيه", tile: 8, color: "teal", position: 7, parentId: null, archivedAt: null },
  { id: id(108), kind: "expense", nameEn: "Shopping", nameAr: "تسوق", tile: 5, color: "oxblood", position: 8, parentId: null, archivedAt: null },
  { id: id(109), kind: "expense", nameEn: "Education", nameAr: "تعليم", tile: 3, color: "ochre", position: 9, parentId: null, archivedAt: null },
  { id: id(110), kind: "expense", nameEn: "Other", nameAr: "أخرى", tile: 6, color: "teal", position: 10, parentId: null, archivedAt: null },
  { id: id(201), kind: "income", nameEn: "Salary", nameAr: "راتب", tile: 7, color: "teal", position: 1, parentId: null, archivedAt: null },
  { id: id(202), kind: "income", nameEn: "Other income", nameAr: "دخل آخر", tile: 1, color: "ochre", position: 2, parentId: null, archivedAt: null },
  { id: id(111), kind: "expense", nameEn: "Old gifts", nameAr: "هدايا قديمة", tile: 4, color: "ochre", position: 11, parentId: null, archivedAt: "2020-03-01T00:00:00Z" },
  { id: id(112), kind: "expense", nameEn: "Loan fees", nameAr: "رسوم القروض", tile: 2, color: "teal", position: 12, parentId: null, archivedAt: null },
];

export const DEMO_WALLETS: Wallet[] = [
  { id: id(1), name: "Cash", kind: "cash", currency: "USD", openingBalanceMinor: 30000, balanceMinor: 23000, position: 1, archived: false },
  { id: id(2), name: "Bank", kind: "bank", currency: "USD", openingBalanceMinor: 100000, balanceMinor: 184630, position: 2, archived: false },
  { id: id(3), name: "Cash", kind: "cash", currency: "LBP", openingBalanceMinor: 3000000, balanceMinor: 2450000, position: 3, archived: false },
  { id: id(5), name: "Old savings", kind: "bank", currency: "USD", openingBalanceMinor: 0, balanceMinor: 0, position: 5, archived: true },
  { id: id(4), name: "Card", kind: "card", currency: "USD", openingBalanceMinor: 0, balanceMinor: -12000, position: 4, archived: false },
  { id: id(6), name: "Syrian cash", kind: "cash", currency: "SYP", openingBalanceMinor: 60000, balanceMinor: 58750, position: 6, archived: false },
  { id: id(7), name: "Syrian bank", kind: "bank", currency: "SYP", openingBalanceMinor: 100000, balanceMinor: 100000, position: 7, archived: false },
  { id: id(8), name: "Loan demo USD", kind: "bank", currency: "USD", openingBalanceMinor: 1000000, balanceMinor: 966000, position: 8, archived: false },
];

/** One shared, synthetic source for Loans history and corresponding Activity rows. */
export function demoLoans(): Loan[] {
  const today = todayIn("Asia/Beirut");
  const base: Loan = { id: id(7001), name: "Workshop loan", direction: "borrowed", currency: "USD", walletId: id(1), feeCategoryId: id(112),
    openedOn: "2026-01-01", creationMode: "existing", principalMinor: 100000, feeBps: 725, feeMinor: 7250, totalDueMinor: 107250,
    principalPaidBeforeMinor: 40000, feePaidBeforeMinor: 0, principalPaidMinor: 40000, feePaidMinor: 0,
    principalRemainingMinor: 60000, feeRemainingMinor: 7250, remainingMinor: 67250, archivedAt: null, deletedAt: null, events: [] };
  const event = (loanId: string, n: number, amountMinor: number, principalMinor: number, feeMinor: number, flow: "in" | "out", overrides: Partial<LoanEvent> = {}): LoanEvent => ({
    transactionId: id(n), revision: 1, loanId, event: "repayment", flow, sequence: 1, walletId: id(8), occurredOn: today,
    amountMinor, principalMinor, feeMinor, categoryId: flow === "out" ? id(112) : id(202), deletedAt: null, ...overrides,
  });
  return [base,
    { ...base, id: id(7002), name: "Friend advance", direction: "lent", feeCategoryId: id(202), principalMinor: 20000, feeBps: 500,
      feeMinor: 1000, totalDueMinor: 21000, principalPaidBeforeMinor: 0, principalPaidMinor: 0, principalRemainingMinor: 20000, feeRemainingMinor: 1000, remainingMinor: 21000 },
    { ...base, id: id(7003), name: "Loan repayment demo", walletId: id(8), principalPaidMinor: 100000, feePaidMinor: 5000,
      principalRemainingMinor: 0, feeRemainingMinor: 2250, remainingMinor: 2250,
      events: [event(id(7003), 7103, 65000, 60000, 5000, "out", { sequence: 2 }), event(id(7003), 7102, 10000, 10000, 0, "out", { revision: 2, deletedAt: `${today}T00:00:00Z` })] },
    { ...base, id: id(7004), name: "Loan income demo", direction: "lent", walletId: id(8), feeCategoryId: id(202), principalMinor: 20000, feeBps: 500,
      feeMinor: 1000, totalDueMinor: 21000, principalPaidBeforeMinor: 0, principalPaidMinor: 20000, feePaidMinor: 1000,
      principalRemainingMinor: 0, feeRemainingMinor: 0, remainingMinor: 0, events: [event(id(7004), 7104, 21000, 20000, 1000, "in")] },
    { ...base, id: id(7005), name: "Loan restore demo", walletId: id(8), principalMinor: 10000, feeBps: 500, feeMinor: 500, totalDueMinor: 10500,
      principalPaidBeforeMinor: 0, principalPaidMinor: 0, principalRemainingMinor: 10000, feeRemainingMinor: 500, remainingMinor: 10500,
      events: [event(id(7005), 7105, 10000, 10000, 0, "out", { revision: 2, deletedAt: `${today}T00:00:00Z` })] },
    { ...base, id: id(7006), name: "Loan principal demo", walletId: id(8), creationMode: "new", openedOn: today, principalMinor: 10000,
      feeBps: 0, feeMinor: 0, totalDueMinor: 10000, principalPaidBeforeMinor: 0, principalPaidMinor: 0,
      principalRemainingMinor: 10000, feeRemainingMinor: 0, remainingMinor: 10000,
      events: [event(id(7006), 7106, 10000, 10000, 0, "in", { event: "disbursement", categoryId: null, sequence: 0 })] },
    { ...base, id: id(7007), name: "SYP loan demo", currency: "SYP", walletId: id(6), principalMinor: 1250, feeMinor: 91, totalDueMinor: 1341,
      principalPaidBeforeMinor: 0, principalPaidMinor: 0, principalRemainingMinor: 1250, feeRemainingMinor: 91, remainingMinor: 1341 },
  ];
}

export function demoLoanTransactions(): Transaction[] {
  return demoLoans().flatMap((loan) => loan.events.filter((event) => event.deletedAt === null).map((event) => ({
    ...emptyTransactionMetadata(), id: event.transactionId, revision: event.revision, kind: "loan" as const,
    occurredOn: event.occurredOn, createdAt: `${event.occurredOn}T00:10:00Z`, amountMinor: event.amountMinor, currency: loan.currency,
    walletId: event.walletId, categoryId: event.categoryId, toWalletId: null, toAmountMinor: null, note: loan.name,
    source: "loan" as const, loanId: loan.id, loanFlow: event.flow, loanEvent: event.event,
    loanPrincipalMinor: event.principalMinor, loanFeeMinor: event.feeMinor, loanEventSeq: event.sequence,
  })));
}

/** Demo salary: lands in the demo Bank (USD) wallet. */
/** Demo USD to LBP rate (LBP per 1 USD). */
export const DEMO_RATE = 89500;

export const DEMO_SALARY = { amountMinor: 180000, walletId: id(2) };

/** Demo fixed expenses. The first one shows as already paid this month. */
export function demoFixed(): FixedExpense[] {
  const today = todayIn("Asia/Beirut");
  return [
    { id: id(301), name: "Rent share", amountMinor: 40000, walletId: id(2), categoryId: id(106), dueDay: 1, paidOn: today },
    { id: id(302), name: "Internet", amountMinor: 3000, walletId: id(2), categoryId: id(104), dueDay: 5, paidOn: null },
    { id: id(303), name: "Generator", amountMinor: 4500, walletId: id(1), categoryId: id(104), dueDay: 10, paidOn: null },
    { id: id(304), name: "Mobile plan", amountMinor: 1250, walletId: id(6), categoryId: id(104), dueDay: 12, paidOn: null },
  ];
}

/** Stable synthetic receipt, shared by salary status and every demo installment. */
export function demoSalaryReceipt(timezone = "Asia/Beirut"): SalaryReceipt {
  const date = addDays(todayIn(timezone), -1);
  return { id: id(601), occurredOn: date, createdAt: `${date}T08:00:00.000000Z` };
}

/** Receipt-based history; descriptive transaction data is retained for Edit. */
export function demoInstallments(timezone = "Asia/Beirut"): Installment[] {
  const today = todayIn(timezone);
  const monthStart = `${today.slice(0, 7)}-01`;
  const cycle = demoSalaryReceipt(timezone).id;
  const payment = (n: number, amountMinor: number, date: string, installment = 501,
    salaryCycleId = cycle, currency: Currency = "USD", wallet = 2): InstallmentPayment => {
    const name = installment === 501 ? "Laptop" : installment === 502 ? "Fridge" : "Synthetic phone";
    const transaction: Transaction = { ...emptyTransactionMetadata(), id: id(n), kind: "expense", amountMinor,
      occurredOn: date, createdAt: `${date}T12:00:00.000000Z`, walletId: id(wallet), currency, categoryId: id(108),
      note: name, toWalletId: null, toAmountMinor: null, source: "installment", installmentId: id(installment) };
    if (n === 401) {
      transaction.note = "Laptop payment";
      transaction.revision = 3;
      transaction.items = [
        { id:id(801),description:"Device installment",amountMinor:7000,position:0 },
        { id:id(802),description:"Accessories installment",amountMinor:3000,position:1 },
      ];
    }
    return { transactionId: transaction.id, amountMinor, occurredOn: date, createdAt: transaction.createdAt,
      walletId: transaction.walletId, salaryCycleId, revision: transaction.revision, transaction };
  };
  const common = { currency: "USD" as const, walletId: id(2), categoryId: id(108), paidBeforeMinor: 0 };
  return [
    withProgress({ ...common, id: id(501), name: "Laptop", totalMinor: 120000, monthlyMinor: 10000, dueDay: 15 }, [
      payment(401,10000,today), payment(402,10000,addDays(monthStart,-20),501,id(602)),
      payment(403,10000,addDays(monthStart,-50),501,id(603)),
    ],cycle),
    withProgress({ ...common, id: id(502), name: "Fridge", totalMinor: 60000, monthlyMinor: 15000, dueDay: null },
      [0,1,2,3].map((n) => payment(410+n,15000,addDays(monthStart,-60-n*30),502,id(610+n))),cycle),
    withProgress({ id:id(503),name:"Synthetic phone",currency:"SYP",walletId:id(7),categoryId:id(108),
      totalMinor:10000,paidBeforeMinor:1250,monthlyMinor:625,dueDay:18 },
      [payment(450,125,today,503,cycle,"SYP",7)],cycle),
  ];
}

/**
 * Demo budgets and spending for a month (YYYY-MM). Limits start two months back,
 * so earlier months are empty. Spending is fixed so layouts are predictable:
 * Groceries and Eating out are over budget, Fun has spending but no budget.
 */
export function demoBudgetData(month: string): {
  budgets: BudgetLimit[];
  spend: CategorySpend[];
} {
  const now = todayIn("Asia/Beirut").slice(0, 7);
  const [y, m] = now.split("-").map(Number);
  const start = new Date(Date.UTC(y, m - 3, 1)).toISOString().slice(0, 7);
  if (month === "2020-02") return { budgets: [{ categoryId: id(111), currency: "USD", limitMinor: 5000 }], spend: [{ categoryId: id(111), currency: "USD", spentMinor: 1500 }] };
  if (month < start) return { budgets: [], spend: [] };
  return {
    budgets: [
      { categoryId: id(101), currency: "USD", limitMinor: 30000 },
      { categoryId: id(103), currency: "USD", limitMinor: 8000 },
      { categoryId: id(102), currency: "USD", limitMinor: 12000 },
      { categoryId: id(105), currency: "USD", limitMinor: 6000 },
      { categoryId: id(102), currency: "LBP", limitMinor: 1000000 },
      { categoryId: id(101), currency: "SYP", limitMinor: 5000 },
    ],
    spend: [
      { categoryId: id(101), currency: "USD", spentMinor: 34000 },
      { categoryId: id(103), currency: "USD", spentMinor: 9500 },
      { categoryId: id(102), currency: "USD", spentMinor: 4200 },
      { categoryId: id(107), currency: "USD", spentMinor: 1500 },
      { categoryId: id(102), currency: "LBP", spentMinor: 700000 },
      { categoryId: id(101), currency: "SYP", spentMinor: 1250 },
      ...(month === now ? [{ categoryId: id(112), currency: "USD" as const, spentMinor: 5000 }] : []),
    ],
  };
}

type Seed = [daysAgo: number, wallet: number, category: number, amount: number, note: string | null, kind?: "income"];
const SEEDS: Seed[] = [
  [3, 6, 101, 1250, "Synthetic SYP groceries"], [4, 7, 202, 5000, "Synthetic SYP income", "income"],
  [0, 1, 101, 5420, "Supermarket"], [0, 1, 103, 350, "Coffee"], [0, 3, 102, 400000, "Taxi"],
  [1, 2, 201, 180000, "Salary", "income"], [1, 2, 104, 4500, "Generator bill"],
  [2, 3, 105, 1200000, "Pharmacy"], [2, 1, 103, 1800, "Lunch"], [3, 1, 101, 3210, null],
  [4, 4, 108, 6400, "Shoes"], [4, 3, 102, 300000, "Taxi"], [5, 1, 107, 1500, "Cinema"],
  [6, 2, 106, 40000, "Rent share"], [7, 1, 101, 7210, "Vegetables"], [7, 3, 103, 900000, "Dinner"],
  [8, 2, 104, 3000, "Internet"], [9, 1, 102, 800, null], [10, 3, 101, 2500000, "Bakery and dairy"],
  [11, 1, 103, 2200, "Coffee with friends"], [12, 4, 108, 5500, null], [13, 2, 202, 25000, "Side job", "income"],
  [14, 1, 101, 4100, null], [15, 3, 105, 600000, null], [16, 1, 109, 8000, "Course"],
  [18, 2, 104, 12000, "Electricity"], [19, 1, 103, 1400, null], [20, 3, 102, 250000, "Taxi"],
  [21, 1, 101, 6800, "Supermarket"], [23, 2, 201, 180000, "Salary", "income"], [24, 1, 110, 900, null],
  [26, 3, 101, 1900000, "Groceries"], [28, 4, 107, 3000, "Game"], [30, 1, 103, 2600, null],
  [32, 2, 106, 40000, "Rent share"], [34, 1, 101, 5300, null], [36, 3, 103, 700000, "Falafel"],
];

function demoTransfers(today: string): Transaction[] {
  const base = {
    ...emptyTransactionMetadata(),
    kind: "transfer" as const,
    categoryId: null,
    note: null,
  };
  return [
    // Bank to Cash, both USD.
    { ...base, id: id(2000), occurredOn: addDays(today, -1), amountMinor: 20000, currency: "USD", walletId: id(2), toWalletId: id(1), toAmountMinor: 20000, createdAt: `${addDays(today, -1)}T22:00:00+00:00` },
    // An exchange: $20 became 1,800,000 lira.
    { ...base, id: id(2001), occurredOn: addDays(today, -6), amountMinor: 2000, currency: "USD", walletId: id(1), toWalletId: id(3), toAmountMinor: 1800000, createdAt: `${addDays(today, -6)}T22:00:00+00:00` },
    // Synthetic actual amounts only; there is deliberately no SYP rate.
    { ...base, id: id(2002), occurredOn: addDays(today, -7), amountMinor: 100, currency: "USD", walletId: id(1), toWalletId: id(6), toAmountMinor: 1250, createdAt: `${addDays(today, -7)}T22:00:00+00:00` },
    { ...base, id: id(2003), occurredOn: addDays(today, -8), amountMinor: 125, currency: "SYP", walletId: id(6), toWalletId: id(7), toAmountMinor: 125, createdAt: `${addDays(today, -8)}T22:00:00+00:00` },
  ];
}

function build(): Transaction[] {
  const today = todayIn("Asia/Beirut");
  const wallets = new Map(DEMO_WALLETS.map((w) => [w.id, w]));
  const archive: Transaction = { ...emptyTransactionMetadata(), id: id(2100), kind: "expense", occurredOn: "2020-02-10", walletId: id(1), amountMinor: 1500, currency: "USD", categoryId: id(111), note: "Gift", toWalletId: null, toAmountMinor: null, createdAt: "2020-02-10T12:00:00Z" };
  return [archive, ...demoLoanTransactions(), ...demoTransfers(today), ...SEEDS.map(([ago, walletN, cat, amount, note, kind], index) => {
    const walletId = id(walletN);
    return {
      ...emptyTransactionMetadata(),
      id: id(1000 + index),
      kind: kind ?? "expense",
      occurredOn: addDays(today, -ago),
      amountMinor: amount,
      currency: wallets.get(walletId)!.currency,
      walletId,
      categoryId: id(cat),
      note,
      settlement: note === "Coffee" && ago === 0 ? {
        tenderMinor: 1000,
        change: { walletId: id(3), amountMinor: 581750, currency: "LBP" as const,
          rate: { base: "USD" as const, quote: "LBP" as const, quoteMajorNumerator: 89500, quoteMajorDenominator: 1 } },
      } : note === "Synthetic SYP groceries" ? {
        tenderMinor: 2500,
        change: { walletId: id(3), amountMinor: 1250, currency: "LBP" as const,
          rate: { base: "LBP" as const, quote: "SYP" as const, quoteMajorNumerator: 1, quoteMajorDenominator: 100 } },
      } : null,
      // Synthetic composition enriches one existing parent; no extra ledger row.
      items: note === "Supermarket" && ago === 0 && wallets.get(walletId)!.currency === "USD" ? [
        { id: id(9001), description: "Phone credits", amountMinor: 2000, position: 0 },
        { id: id(9002), description: "For sister", amountMinor: 3000, position: 1 },
      ] : [],
      toWalletId: null,
      toAmountMinor: null,
      // Newer rows of the same day sort first.
      createdAt: `${addDays(today, -ago)}T${String(20 - (index % 12)).padStart(2, "0")}:00:00+00:00`,
    } satisfies Transaction;
  })].sort(
    (a, b) =>
      b.occurredOn.localeCompare(a.occurredOn) ||
      b.createdAt.localeCompare(a.createdAt) ||
      b.id.localeCompare(a.id),
  );
}

const before = (t: Transaction, c: Cursor) =>
  t.occurredOn < c.occurredOn ||
  (t.occurredOn === c.occurredOn &&
    (t.createdAt < c.createdAt || (t.createdAt === c.createdAt && t.id < c.id)));

export function demoPage(filters: Filters, cursor: Cursor | null, limit: number): Page {
  const q = filters.q?.toLowerCase();
  const matches = build().filter(
    (t) =>
      (!q || (t.note ?? "").toLowerCase().includes(q)) &&
      matchesActivityKind(t, filters.kind) &&
      (!filters.walletId || t.walletId === filters.walletId || t.toWalletId === filters.walletId || t.settlement?.change?.walletId === filters.walletId) &&
      (!filters.categoryId || (t.categoryId === filters.categoryId && (t.kind !== "loan" || (t.loanFeeMinor ?? 0) > 0))) &&
      (!filters.from || t.occurredOn >= filters.from) &&
      (!filters.to || t.occurredOn <= filters.to) &&
      (!cursor || before(t, cursor)),
  );
  const rows = matches.slice(0, limit);
  const last = rows[rows.length - 1];
  const more = matches.length > limit && last;
  return {
    rows,
    next: more ? { occurredOn: last.occurredOn, createdAt: last.createdAt, id: last.id } : null,
  };
}
