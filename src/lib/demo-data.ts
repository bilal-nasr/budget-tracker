import "server-only";
import type { Category } from "@/features/categories/schema";
import type { FixedExpense } from "@/features/fixed/schema";
import type { Wallet } from "@/features/wallets/schema";
import { addDays, todayIn } from "@/features/transactions/group";
import type { Cursor, Filters, Page, Transaction } from "@/features/transactions/schema";

/**
 * Synthetic data shown only when Supabase is not configured (a fresh
 * checkout or the end-to-end tests). Read-only: writes report "not configured".
 */
const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;

export const DEMO_CATEGORIES: Category[] = [
  { id: id(101), kind: "expense", nameEn: "Groceries", nameAr: "بقالة", tile: 3, color: "teal", position: 1 },
  { id: id(102), kind: "expense", nameEn: "Transport", nameAr: "مواصلات", tile: 2, color: "oxblood", position: 2 },
  { id: id(103), kind: "expense", nameEn: "Eating out", nameAr: "مطاعم", tile: 4, color: "ochre", position: 3 },
  { id: id(104), kind: "expense", nameEn: "Bills", nameAr: "فواتير", tile: 1, color: "teal", position: 4 },
  { id: id(105), kind: "expense", nameEn: "Health", nameAr: "صحة", tile: 6, color: "oxblood", position: 5 },
  { id: id(106), kind: "expense", nameEn: "Rent", nameAr: "إيجار", tile: 7, color: "ochre", position: 6 },
  { id: id(107), kind: "expense", nameEn: "Fun", nameAr: "ترفيه", tile: 8, color: "teal", position: 7 },
  { id: id(108), kind: "expense", nameEn: "Shopping", nameAr: "تسوق", tile: 5, color: "oxblood", position: 8 },
  { id: id(109), kind: "expense", nameEn: "Education", nameAr: "تعليم", tile: 3, color: "ochre", position: 9 },
  { id: id(110), kind: "expense", nameEn: "Other", nameAr: "أخرى", tile: 6, color: "teal", position: 10 },
  { id: id(201), kind: "income", nameEn: "Salary", nameAr: "راتب", tile: 7, color: "teal", position: 1 },
  { id: id(202), kind: "income", nameEn: "Other income", nameAr: "دخل آخر", tile: 1, color: "ochre", position: 2 },
];

export const DEMO_WALLETS: Wallet[] = [
  { id: id(1), name: "Cash", kind: "cash", currency: "USD", openingBalanceMinor: 30000, balanceMinor: 23000, position: 1, archived: false },
  { id: id(2), name: "Bank", kind: "bank", currency: "USD", openingBalanceMinor: 100000, balanceMinor: 184630, position: 2, archived: false },
  { id: id(3), name: "Cash", kind: "cash", currency: "LBP", openingBalanceMinor: 3000000, balanceMinor: 2450000, position: 3, archived: false },
  { id: id(5), name: "Old savings", kind: "bank", currency: "USD", openingBalanceMinor: 0, balanceMinor: 0, position: 5, archived: true },
  { id: id(4), name: "Card", kind: "card", currency: "USD", openingBalanceMinor: 0, balanceMinor: -12000, position: 4, archived: false },
];

/** Demo salary: lands in the demo Bank (USD) wallet. */
export const DEMO_SALARY = { amountMinor: 180000, walletId: id(2) };

/** Demo fixed expenses. The first one shows as already paid this month. */
export function demoFixed(): FixedExpense[] {
  const today = todayIn("Asia/Beirut");
  return [
    { id: id(301), name: "Rent share", amountMinor: 40000, walletId: id(2), categoryId: id(106), dueDay: 1, paidOn: today },
    { id: id(302), name: "Internet", amountMinor: 3000, walletId: id(2), categoryId: id(104), dueDay: 5, paidOn: null },
    { id: id(303), name: "Generator", amountMinor: 4500, walletId: id(1), categoryId: id(104), dueDay: 10, paidOn: null },
  ];
}

type Seed = [daysAgo: number, wallet: number, category: number, amount: number, note: string | null, kind?: "income"];
const SEEDS: Seed[] = [
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
    kind: "transfer" as const,
    categoryId: null,
    note: null,
  };
  return [
    // Bank to Cash, both USD.
    { ...base, id: id(2000), occurredOn: addDays(today, -1), amountMinor: 20000, currency: "USD", walletId: id(2), toWalletId: id(1), toAmountMinor: 20000, createdAt: `${addDays(today, -1)}T22:00:00+00:00` },
    // An exchange: $20 became 1,800,000 lira.
    { ...base, id: id(2001), occurredOn: addDays(today, -6), amountMinor: 2000, currency: "USD", walletId: id(1), toWalletId: id(3), toAmountMinor: 1800000, createdAt: `${addDays(today, -6)}T22:00:00+00:00` },
  ];
}

function build(): Transaction[] {
  const today = todayIn("Asia/Beirut");
  const wallets = new Map(DEMO_WALLETS.map((w) => [w.id, w]));
  return [...demoTransfers(today), ...SEEDS.map(([ago, walletN, cat, amount, note, kind], index) => {
    const walletId = id(walletN);
    return {
      id: id(1000 + index),
      kind: kind ?? "expense",
      occurredOn: addDays(today, -ago),
      amountMinor: amount,
      currency: wallets.get(walletId)!.currency,
      walletId,
      categoryId: id(cat),
      note,
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
      (!filters.kind || t.kind === filters.kind) &&
      (!filters.walletId || t.walletId === filters.walletId) &&
      (!filters.categoryId || t.categoryId === filters.categoryId) &&
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
