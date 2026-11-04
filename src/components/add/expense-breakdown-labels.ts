"use client";

// Separate from the editor so read-only breakdowns (Home's fixed card) do not
// pull in the editor and its zod validation.
import { useTranslations } from "next-intl";

/** Copy is supplied by the translated parent; this component owns no locale. */
export type ExpenseBreakdownLabels = {
  title: string;
  description: string;
  amount: string;
  addItem: string;
  removeItem: (index: number) => string;
  itemCount: (count: number) => string;
  itemizedTotal: string;
  remainder: string;
  fullyItemized: string;
  exceedsTotal: string;
  invalidItem: string;
  invalidDescription: string;
  invalidAmount: string;
  maxItems: string;
};

export function useExpenseBreakdownLabels(): ExpenseBreakdownLabels {
  const t = useTranslations("Breakdown");
  return {
    title: t("title"), description: t("description"), amount: t("amount"), addItem: t("addItem"),
    removeItem: (index) => t("removeItem", { index }), itemCount: (count) => t("itemCount", { count }),
    itemizedTotal: t("itemizedTotal"), remainder: t("remainder"), fullyItemized: t("fullyItemized"),
    exceedsTotal: t("exceedsTotal"), invalidItem: t("invalidItem"), invalidDescription: t("invalidDescription"),
    invalidAmount: t("invalidAmount"), maxItems: t("maxItems"),
  };
}
