"use client";
import { useTranslations } from "next-intl";
import type { CashSettlementLabels } from "./cash-settlement-fields";

export function useCashSettlementLabels(): CashSettlementLabels {
  const t = useTranslations("Cashier");
  const add = useTranslations("Add");
  return {
    payerCurrency: add("fromCurrency"), title: t("title"), paidFrom: t("paidFrom"), tender: t("tender"), change: t("change"), currency: t("currency"),
    wallet: t("wallet"), addChange: t("addChange"), removeChange: t("removeChange"),
    extraTenderWallet: t("extraTenderWallet"), extraTenderCurrency: t("extraTenderCurrency"), extraTender: t("extraTender"),
    addTender: t("addTender"), removeTender: t("removeTender"),
    selectWallet: t("selectWallet"),
    errors: { amount: t("amountError"), rate: t("rateError"), mismatch: t("mismatch"), unsupportedPair: t("unsupportedPair"), walletUnavailable: t("walletUnavailable") },
  };
}
