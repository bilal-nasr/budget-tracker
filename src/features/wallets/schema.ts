import { z } from "zod";
import { MAX_MINOR } from "@/lib/money";

export const currencySchema = z.enum(["USD", "LBP"]);
export const walletKindSchema = z.enum(["cash", "bank", "card"]);

export type WalletKind = z.infer<typeof walletKindSchema>;

export const walletInputSchema = z.object({
  name: z.string().trim().min(1).max(40),
  kind: walletKindSchema,
  currency: currencySchema,
  /** Signed: a card or overdraft can start negative. */
  openingBalanceMinor: z.number().int().min(-MAX_MINOR).max(MAX_MINOR),
});

export type WalletInput = z.infer<typeof walletInputSchema>;

export type Wallet = {
  id: string;
  name: string;
  kind: WalletKind;
  currency: "USD" | "LBP";
  openingBalanceMinor: number;
  balanceMinor: number;
  position: number;
  archived: boolean;
};

/** Totals per currency over active wallets. Never combines currencies. */
export function totalsByCurrency(wallets: readonly Wallet[]): { USD: number; LBP: number } {
  const totals = { USD: 0, LBP: 0 };
  for (const wallet of wallets) if (!wallet.archived) totals[wallet.currency] += wallet.balanceMinor;
  return totals;
}
