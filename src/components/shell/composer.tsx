"use client";

import { createContext, useCallback, useContext, useMemo, useState } from "react";
import { useLocale } from "next-intl";
import { TransactionSheet, type ComposerPreset, type ComposerState } from "@/components/add/transaction-sheet";
import { Toaster } from "@/components/ui/sonner";
import { DetailSheet } from "@/components/transactions/detail-sheet";
import { FixedSheet, type FixedSheetState } from "@/components/fixed/fixed-sheet";
import { SalarySheet } from "@/components/salary/salary-sheet";
import { WalletSheet, type WalletSheetState } from "@/components/wallets/wallet-sheet";
import type { FixedExpense } from "@/features/fixed/schema";
import type { Transaction } from "@/features/transactions/schema";
import type { Wallet } from "@/features/wallets/schema";

type Composer = {
  openAdd: (preset?: ComposerPreset) => void;
  openDetail: (transaction: Transaction) => void;
  openWallet: (wallet: Wallet | null) => void;
  openSalary: () => void;
  openFixed: (item: FixedExpense | null) => void;
};

const Context = createContext<Composer | null>(null);

/**
 * Owns the app's sheets (add/edit, transaction detail, wallet) so any screen
 * can open them, and the toast area that carries Undo.
 */
export function ComposerProvider({ children }: { children: React.ReactNode }) {
  const locale = useLocale();
  const [add, setAdd] = useState<ComposerState | null>(null);
  const [detail, setDetail] = useState<Transaction | null>(null);
  const [wallet, setWallet] = useState<WalletSheetState | null>(null);
  const [salaryOpen, setSalaryOpen] = useState(false);
  const [fixed, setFixed] = useState<FixedSheetState | null>(null);

  const openAdd = useCallback((preset?: ComposerPreset) => setAdd({ mode: "add", preset }), []);
  const openDetail = useCallback((t: Transaction) => setDetail(t), []);
  const openWallet = useCallback((w: Wallet | null) => setWallet({ wallet: w }), []);

  const openSalary = useCallback(() => setSalaryOpen(true), []);
  const openFixed = useCallback((item: FixedExpense | null) => setFixed({ item }), []);

  const value = useMemo(
    () => ({ openAdd, openDetail, openWallet, openSalary, openFixed }),
    [openAdd, openDetail, openWallet, openSalary, openFixed],
  );

  return (
    <Context value={value}>
      {children}
      <TransactionSheet state={add} onClose={() => setAdd(null)} />
      <DetailSheet
        transaction={detail}
        onClose={() => setDetail(null)}
        onEdit={(t) => {
          setDetail(null);
          setAdd({ mode: "edit", initial: t });
        }}
        onDuplicate={(t) => {
          setDetail(null);
          setAdd({ mode: "add", initial: t });
        }}
      />
      <WalletSheet
        state={wallet}
        onClose={() => setWallet(null)}
        onAddMoney={(w) => {
          setWallet(null);
          setAdd({ mode: "add", preset: { kind: "income", walletId: w.id } });
        }}
      />
      <SalarySheet open={salaryOpen} onClose={() => setSalaryOpen(false)} />
      <FixedSheet state={fixed} onClose={() => setFixed(null)} />
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
