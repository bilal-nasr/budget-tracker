import { z } from "zod";
import { CURRENCIES, MAX_MINOR, type Currency } from "@/lib/money";
export { attachedBalances, defaultBalance, nextDefaultBalance, totalsByCurrency } from "./totals";

export const currencySchema = z.enum(CURRENCIES);
export const walletKindSchema = z.enum(["cash", "bank", "card"]);

export type WalletKind = z.infer<typeof walletKindSchema>;

const minorSchema = z.number().int().min(-MAX_MINOR).max(MAX_MINOR);

export const walletBalanceSchema = z.object({
  id: z.string().min(1),
  walletId: z.string().min(1),
  currency: z.string().regex(/^[A-Z][A-Z0-9]{0,11}$/),
  openingBalanceMinor: minorSchema,
  balanceMinor: minorSchema,
  position: z.number().int().nonnegative(),
  detached: z.boolean(),
});

export type WalletBalance = z.infer<typeof walletBalanceSchema>;

/** Strict container model; promoted to Wallet when existing callers migrate. */
export const walletContainerSchema = z.object({
  id: z.string().min(1),
  name: z.string().trim().min(1).max(40),
  kind: walletKindSchema,
  position: z.number().int().nonnegative(),
  deleted: z.boolean(),
  needsAttention: z.boolean(),
  defaultBalanceId: z.string().min(1).nullable(),
  balances: z.array(walletBalanceSchema),
}).superRefine((wallet, context) => {
  const currencies = new Set<string>();
  const ids = new Set<string>();
  for (const [index, balance] of wallet.balances.entries()) {
    if (balance.walletId !== wallet.id || currencies.has(balance.currency) || ids.has(balance.id)) {
      context.addIssue({ code: "custom", path: ["balances", index], message: "Invalid wallet balance ownership or duplicate balance" });
    }
    currencies.add(balance.currency);
    ids.add(balance.id);
  }
  if (wallet.deleted && wallet.defaultBalanceId === null && wallet.balances.length === 0) return;
  const selected = wallet.balances.find((balance) => balance.id === wallet.defaultBalanceId);
  if (!selected || (!wallet.deleted && selected.detached)) {
    context.addIssue({ code: "custom", path: ["defaultBalanceId"], message: "Default must be an attached balance owned by this wallet" });
  }
});

export type WalletContainer = z.infer<typeof walletContainerSchema>;

export const walletCreateInputSchema = z.object({
  name: z.string().trim().min(1).max(40),
  kind: walletKindSchema,
  currency: z.string().trim().toUpperCase().regex(/^[A-Z][A-Z0-9]{0,11}$/),
  openingBalanceMinor: minorSchema.default(0),
}).strict();
export type WalletCreateInput = z.input<typeof walletCreateInputSchema>;

export const walletUpdateInputSchema = z.object({
  name: z.string().trim().min(1).max(40),
  kind: walletKindSchema,
}).strict();
export type WalletUpdateInput = z.infer<typeof walletUpdateInputSchema>;

export const walletBalanceInputSchema = z.object({
  currency: z.string().trim().toUpperCase().regex(/^[A-Z][A-Z0-9]{0,11}$/),
}).strict();
export type WalletBalanceInput = z.infer<typeof walletBalanceInputSchema>;

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

/** Temporary single-currency model for untouched queries and UI. */
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
