"use client";
import { useTranslations } from "next-intl";
import type { CashSettlementLabels } from "./cash-settlement-fields";

export function useCashSettlementLabels(): CashSettlementLabels {
  const t = useTranslations("Cashier");
  return {
    title: t("title"), tender: t("tender"), change: t("change"), currency: t("currency"),
    wallet: t("wallet"), rate: t("rate"), confirmRate: t("confirmRate"), createWallet: t("createWallet"),
    selectWallet: t("selectWallet"), noChange: t("noChange"), needWallet: (currency) => t("needWallet", { currency }),
    errors: { amount: t("amountError"), rate: t("rateError"), mismatch: t("mismatch"), unsupportedPair: t("unsupportedPair"), walletUnavailable: t("walletUnavailable") },
  };
}
