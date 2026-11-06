"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import dynamic from "next/dynamic";
import { useLocale } from "next-intl";
import type { ComposerPreset, ComposerState, DraftSnapshot } from "@/components/add/transaction-sheet";
import { Toaster } from "@/components/ui/sonner";
import type { FixedSheetState } from "@/components/fixed/fixed-sheet";
import type { BudgetsSheetState } from "@/components/budget/budgets-sheet";
import type { InstallmentPayState } from "@/components/installments/installment-pay-sheet";
import type { InstallmentSheetState } from "@/components/installments/installment-sheet";
import type { WalletSheetState } from "@/components/wallets/wallet-sheet";
import type { FixedExpense } from "@/features/fixed/schema";
import type { Installment } from "@/features/installments/schema";
import type { Transaction } from "@/features/transactions/schema";
import type { WalletContainer } from "@/features/wallets/schema";

const loadTransactionSheet = () => import("@/components/add/transaction-sheet");
const TransactionSheet = dynamic(() => loadTransactionSheet().then((m) => m.TransactionSheet));
const DetailSheet = dynamic(() => import("@/components/transactions/detail-sheet").then((m) => m.DetailSheet));
const WalletSheet = dynamic(() => import("@/components/wallets/wallet-sheet").then((m) => m.WalletSheet));
const SalarySheet = dynamic(() => import("@/components/salary/salary-sheet").then((m) => m.SalarySheet));
const FixedSheet = dynamic(() => import("@/components/fixed/fixed-sheet").then((m) => m.FixedSheet));
const InstallmentSheet = dynamic(() => import("@/components/installments/installment-sheet").then((m) => m.InstallmentSheet));
const InstallmentPaySheet = dynamic(() => import("@/components/installments/installment-pay-sheet").then((m) => m.InstallmentPaySheet));
const BudgetsSheet = dynamic(() => import("@/components/budget/budgets-sheet").then((m) => m.BudgetsSheet));

/** Defer the first mount, then retain the drawer root for its normal exit animation. */
function useSheetState<T>(initial: T) {
  const [state, setState] = useState(initial);
  const [mounted, setMounted] = useState(false);
  const update = useCallback((next: T) => {
    setMounted(true);
    setState(next);
  }, []);
  return [state, update, mounted] as const;
}

type Composer = {
  openAdd: (preset?: ComposerPreset) => void;
  openDetail: (transaction: Transaction) => void;
  openWallet: (wallet: WalletContainer | null) => void;
  openSalary: () => void;
  openFixed: (item: FixedExpense | null) => void;
  openInstallment: (item: Installment) => void;
  openInstallmentPay: (item: Installment, intent?: "normal" | "again") => void;
  openBudgets: (state: BudgetsSheetState) => void;
};

const Context = createContext<Composer | null>(null);

/**
 * Owns the app's sheets (add/edit, transaction detail, wallet) so any screen
 * can open them, and the toast area that carries Undo.
 */
export function ComposerProvider({ children }: { children: React.ReactNode }) {
  const locale = useLocale();
  const [add, setAdd, addMounted] = useSheetState<ComposerState | null>(null);
  const [detail, setDetail, detailMounted] = useSheetState<Transaction | null>(null);
  const [wallet, setWallet, walletMounted] = useSheetState<WalletSheetState | null>(null);
  const [salaryOpen, setSalaryOpen, salaryMounted] = useSheetState(false);
  const [fixed, setFixed, fixedMounted] = useSheetState<FixedSheetState | null>(null);
  const [installment, setInstallment, installmentMounted] = useSheetState<InstallmentSheetState | null>(null);
  const [installmentPay, setInstallmentPay, installmentPayMounted] = useSheetState<InstallmentPayState | null>(null);
  const [budgets, setBudgets, budgetsMounted] = useSheetState<BudgetsSheetState | null>(null);

  // Add is the main flow: fetch its code once the page is idle so the first tap
  // never waits on the network. Skipped when the visitor asked to save data.
  useEffect(() => {
    if ((navigator as Navigator & { connection?: { saveData?: boolean } }).connection?.saveData) return;
    const warm = () => { loadTransactionSheet().catch(() => {}); };
    if ("requestIdleCallback" in window) {
      const id = requestIdleCallback(warm, { timeout: 4000 });
      return () => cancelIdleCallback(id);
    }
    const id = setTimeout(warm, 2000);
    return () => clearTimeout(id);
  }, []);

  // An Add entry the sheet was dismissed on without saving. A plain Add brings it back; an
  // explicit preset (budget row, Add money) starts clean and leaves it for later.
  const stashedDraft = useRef<DraftSnapshot | null>(null);
  const openAdd = useCallback((preset?: ComposerPreset) => {
    const restore = preset ? undefined : stashedDraft.current ?? undefined;
    if (!preset) stashedDraft.current = null;
    setAdd({ mode: "add", draftId: crypto.randomUUID(), preset, restore });
  }, [setAdd]);
  const openDetail = useCallback((t: Transaction) => setDetail(t), [setDetail]);
  const openWallet = useCallback((w: WalletContainer | null) => setWallet({ wallet: w }), [setWallet]);

  const openSalary = useCallback(() => setSalaryOpen(true), [setSalaryOpen]);
  const openFixed = useCallback((item: FixedExpense | null) => setFixed({ item }), [setFixed]);

  const openInstallment = useCallback((item: Installment) => setInstallment({ item }), [setInstallment]);
  const openInstallmentPay = useCallback((item: Installment, intent: "normal" | "again" = "normal") => setInstallmentPay({ item, intent, requestId: crypto.randomUUID() }), [setInstallmentPay]);

  const openBudgets = useCallback((state: BudgetsSheetState) => setBudgets(state), [setBudgets]);

  const value = useMemo(
    () => ({ openAdd, openDetail, openWallet, openSalary, openFixed, openInstallment, openInstallmentPay, openBudgets }),
    [openAdd, openDetail, openWallet, openSalary, openFixed, openInstallment, openInstallmentPay, openBudgets],
  );

  return (
    <Context value={value}>
      {children}
      {addMounted && <TransactionSheet
        state={add}
        // Clear first: the form stashes only afterwards, on a dismissal. Saving leaves nothing behind.
        onClose={() => { stashedDraft.current = null; setAdd(null); }}
        onCreateWallet={() => setWallet({ wallet: null })}
        onStash={(draft) => { stashedDraft.current = draft; }}
        onStartOver={() => setAdd({ mode: "add", draftId: crypto.randomUUID() })}
      />}
      {detailMounted && <DetailSheet
        transaction={detail}
        onClose={() => setDetail(null)}
        onEdit={(t) => {
          setDetail(null);
          setAdd({ mode: "edit", initial: t });
        }}
        onDuplicate={(t) => {
          setDetail(null);
          setAdd({ mode: "add", draftId: crypto.randomUUID(), initial: t });
        }}
      />}
      {walletMounted && <WalletSheet
        state={wallet}
        onClose={() => setWallet(null)}
        onAddMoney={(w) => {
          setWallet(null);
          setAdd({ mode: "add", draftId: crypto.randomUUID(), preset: { kind: "income", walletId: w.id } });
        }}
      />}
      {salaryMounted && <SalarySheet open={salaryOpen} onClose={() => setSalaryOpen(false)} />}
      {fixedMounted && <FixedSheet state={fixed} onClose={() => setFixed(null)} />}
      {installmentMounted && <InstallmentSheet state={installment} onClose={() => setInstallment(null)} />}
      {installmentPayMounted && <InstallmentPaySheet state={installmentPay} onClose={() => setInstallmentPay(null)} />}
      {budgetsMounted && <BudgetsSheet state={budgets} onClose={() => setBudgets(null)} />}
      <Toaster
        dir={locale === "ar" ? "rtl" : "ltr"}
        position="bottom-center"
        mobileOffset={{ bottom: 104 }}
        offset={24}
      />
    </Context>
  );
}

export function useComposer(): Composer {
  const value = useContext(Context);
  if (!value) throw new Error("useComposer must be used inside ComposerProvider");
  return value;
}
