import { z } from "zod";
import { CURRENCIES, MAX_MINOR, type Currency } from "@/lib/money";
export { totalsByCurrency } from "./totals";

export const currencySchema = z.enum(CURRENCIES);
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

/** Take a new wallet's starting balance from an existing wallet instead of creating new money. */
export const walletFundingSchema = z.object({
  fromWalletId: z.uuid(),
  /** What leaves the source wallet, in the source wallet's currency. */
  takenMinor: z.number().int().min(1).max(MAX_MINOR),
});
export type WalletFunding = z.infer<typeof walletFundingSchema>;

export type Wallet = {
  id: string;
  name: string;
  kind: WalletKind;
  currency: Currency;
  openingBalanceMinor: number;
  balanceMinor: number;
  position: number;
  archived: boolean;
};
