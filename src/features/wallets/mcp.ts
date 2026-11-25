import "server-only";
import { z } from "zod";
import { createCategory } from "@/features/categories/actions";
import { getCategories } from "@/features/categories/queries";
import { getCurrencies } from "@/features/currencies/queries";
import { getProfile } from "@/features/profile/queries";
import { createTransaction } from "@/features/transactions/actions";
import { todayIn } from "@/features/transactions/group";
import { currencyIntent } from "@/lib/currency-intent";
import { amountFormatter } from "@/lib/mcp/amounts";
import { defineTool, ToolError } from "@/lib/mcp/tool";
import { ACTION_ERROR_TEXT, balancesOut, once, requestIdSchema, UnknownOutcomeError, unwrap } from "@/lib/mcp/write";
import { MAX_MINOR, type CurrencyDefinition } from "@/lib/money";
import { createWallet, deleteWallet, reorderWallets, updateWallet } from "./actions";
import { getWallets } from "./queries";
import { walletKindSchema, type WalletContainer } from "./schema";

/** Every stored wallet and balance, so a single wallet is found whatever its state. */
const ALL = { includeDeleted: true, includeNeedsAttention: true, includeDisabledBalances: true } as const;

const WALLET_NOT_FOUND = "That wallet does not exist. Use wallets_list to find its id.";
const BALANCE_NOT_FOUND = "That balance does not exist. Use wallets_list to find the balance id.";
const WALLET_IN_USE =
  "A salary, fixed expense, unfinished installment or open loan still uses this wallet. Move or end those first, then delete the wallet.";
const WALLET_NOT_EMPTY =
  "This wallet still has a balance that is not zero. Bring every balance to zero first: move it with transactions_create (kind transfer) or set it with wallets_adjust_balance.";
const POSITION_OUT_OF_RANGE = "The position is past the end of the wallet list. Use 0 for the first wallet and the number of wallets minus one for the last.";
const POSITION_NEEDS_ATTENTION = "This wallet needs attention in the app, so it has no place in the wallet order yet.";
const NOTHING_TO_CHANGE = "Give at least one of name, kind or position.";
const DIFFERENCE_TOO_LARGE = "The change to this balance is larger than one transaction can record. Adjust it in smaller steps.";
const CORRECTION_NAME_TAKEN =
  "Another category has a name too close to \"Balance correction\" to create it. Rename that category to exactly \"Balance correction\" (or to something else), then try again.";

/** The correction category each adjustment posts to, one per kind. */
export const CORRECTION_CATEGORY = { nameEn: "Balance correction", nameAr: "تصحيح الرصيد", tile: 10, color: "ochre" } as const;

type Amount = ReturnType<typeof amountFormatter>;

/** One wallet in the shape wallets_list gives. */
const walletOut = (wallet: WalletContainer, amount: Amount) => ({
  ...wallet,
  balances: wallet.balances.map((balance) => ({
    ...balance,
    amount: amount(balance.balanceMinor, balance.currency),
    openingAmount: amount(balance.openingBalanceMinor, balance.currency),
  })),
});

/** One wallet re-read after a change, in the shape wallets_list gives. */
async function readWallet(id: string) {
  const [wallets, currencies] = await Promise.all([getWallets(ALL), getCurrencies()]);
  const wallet = wallets.find((item) => item.id === id);
  if (!wallet) throw new ToolError(WALLET_NOT_FOUND);
  return walletOut(wallet, amountFormatter(currencies));
}

const walletId = z.uuid().describe("Wallet id from wallets_list.");
const walletName = z.string().trim().min(1).max(40);

/** The person's own correction category of this kind: reused when it exists, created once otherwise. */
async function correctionCategory(kind: "expense" | "income"): Promise<{ id: string; created: boolean }> {
  const categories = (await getCategories()).filter((c) => c.kind === kind && c.parentId === null && c.archivedAt === null);
  const existing = categories.find((c) => c.nameEn === CORRECTION_CATEGORY.nameEn) ?? categories.find((c) => c.nameAr === CORRECTION_CATEGORY.nameAr);
  if (existing) return { id: existing.id, created: false };
  const result = await createCategory({ kind, ...CORRECTION_CATEGORY });
  if (!result.ok && result.error === "duplicateName") throw new ToolError(CORRECTION_NAME_TAKEN);
  return { id: unwrap<{ ok: true; id: string }>(result).id, created: true };
}

export const walletTools = [
  defineTool({
    name: "wallets_list",
    title: "List wallets",
    description:
      "List the person's wallets, each with one balance per currency (current balance as amount, opening balance, ids). " +
      "Balances in different currencies are never summed. Use the balance ids as balanceId filters in transactions_list.",
    kind: "read",
    run: async () => {
      const [wallets, currencies] = await Promise.all([getWallets(), getCurrencies()]);
      const amount = amountFormatter(currencies);
      return { wallets: wallets.map((wallet) => walletOut(wallet, amount)) };
    },
  }),
  defineTool({
    name: "wallets_create",
    title: "Create wallet",
    description:
      "Create a wallet (cash, bank or card). It gets one balance for every enabled currency; `currency` (a code from currencies_list) is its default balance, " +
      "and `openingBalanceMinor` (integer minor units of that currency, e.g. cents for USD; negative for money owed; default 0) is that balance's opening amount. " +
      "Returns the new wallet in the shape wallets_list gives (plus `balances` when an opening amount was set). " +
      "Send a requestId and reuse it when retrying so the wallet is never created twice.",
    kind: "write",
    input: z.strictObject({
      requestId: requestIdSchema,
      name: walletName.describe("Wallet name, 1 to 40 characters."),
      kind: walletKindSchema.describe("cash, bank or card."),
      currency: z.string().regex(/^[A-Z][A-Z0-9]{0,11}$/).describe("Currency code of the default balance, as currencies_list gives it (for example USD)."),
      openingBalanceMinor: z.number().int().min(-MAX_MINOR).max(MAX_MINOR).optional()
        .describe("Opening amount of the default balance in integer minor units of that currency. Negative means owed. Default 0."),
    }),
    run: ({ requestId, name, kind, currency, openingBalanceMinor }) =>
      once("wallets_create", requestId, async () => {
        const definition = (await getCurrencies()).find((item) => item.code === currency);
        if (!definition) throw new ToolError(ACTION_ERROR_TEXT.currencyUnavailable);
        if (definition.disabled) throw new ToolError(ACTION_ERROR_TEXT.currencyDisabled);
        const created = unwrap<{ ok: true; id: string }>(await createWallet({
          expectedUnits: currencyIntent(definition),
          name, kind, currency: definition.code, openingBalanceMinor: openingBalanceMinor ?? 0,
        }));
        // The wallet exists now: a failed re-read must keep the requestId claimed, or a retry would create a second one.
        const wallet = await readWallet(created.id).catch((error: unknown) => {
          throw error instanceof ToolError ? new UnknownOutcomeError() : error;
        });
        return openingBalanceMinor
          ? { wallet, balances: await balancesOut(wallet.balances.map((balance) => balance.id)) }
          : { wallet };
      }),
  }),
  defineTool({
    name: "wallets_update",
    title: "Update wallet",
    description:
      "Rename a wallet, change its kind, and/or move it to another place in the wallet order. Wallet id comes from wallets_list. " +
      "`position` is the 0-based place in the list wallets_list returns (0 = first). Fields you leave out keep their current value; give at least one. " +
      "Money is never touched. Returns the updated wallet in the shape wallets_list gives.",
    kind: "write",
    input: z.strictObject({
      walletId,
      name: walletName.optional().describe("New name, 1 to 40 characters."),
      kind: walletKindSchema.optional().describe("New kind: cash, bank or card."),
      position: z.number().int().min(0).max(10_000).optional().describe("New 0-based place in the wallet list (0 = first)."),
    }).refine((input) => input.name !== undefined || input.kind !== undefined || input.position !== undefined, { message: NOTHING_TO_CHANGE }),
    run: async ({ walletId: id, name, kind, position }) => {
      const all = await getWallets(ALL);
      const current = all.find((wallet) => wallet.id === id);
      if (!current) throw new ToolError(WALLET_NOT_FOUND);
      if (current.deleted) throw new ToolError(ACTION_ERROR_TEXT.walletDeleted);
      let order: string[] | null = null;
      if (position !== undefined) {
        if (current.needsAttention) throw new ToolError(POSITION_NEEDS_ATTENTION);
        // reorder_wallets takes the complete ordinary list: live wallets that do not need attention.
        const ids = all.filter((wallet) => !wallet.deleted && !wallet.needsAttention)
          .sort((a, b) => a.position - b.position).map((wallet) => wallet.id);
        if (position > ids.length - 1) throw new ToolError(POSITION_OUT_OF_RANGE);
        const next = ids.filter((item) => item !== id);
        next.splice(position, 0, id);
        if (next.some((item, index) => item !== ids[index])) order = next;
      }
      if (name !== undefined || kind !== undefined) {
        unwrap(await updateWallet(id, { name: name ?? current.name, kind: kind ?? current.kind }));
      }
      if (order) unwrap(await reorderWallets(order));
      return { wallet: await readWallet(id) };
    },
  }),
  defineTool({
    name: "wallets_delete",
    title: "Delete wallet",
    description:
      "Delete a wallet (it is kept in history; its past transactions stay). Wallet id comes from wallets_list. " +
      "Every balance of the wallet must be zero: this tool never moves money. If a balance is not zero it refuses; bring it to zero first with " +
      "transactions_create (kind transfer) or wallets_adjust_balance. A wallet still used by the salary, a fixed expense, an unfinished installment or an open loan cannot be deleted. " +
      "Returns { deleted: true, id, balances }.",
    kind: "destructive",
    input: z.strictObject({ walletId }),
    run: async ({ walletId: id }) => {
      const current = (await getWallets(ALL)).find((wallet) => wallet.id === id);
      if (!current) throw new ToolError(WALLET_NOT_FOUND);
      const balanceIds = current.balances.map((balance) => balance.id);
      // Already deleted (a retry after a lost response, say): report it rather than fail.
      if (current.deleted) return { deleted: true, id, balances: await balancesOut(balanceIds) };
      if (current.balances.some((balance) => balance.balanceMinor !== 0)) throw new ToolError(WALLET_NOT_EMPTY);
      // The database rechecks both rules under lock (wallet.nonzero, wallet.inUse).
      const result = await deleteWallet(id);
      if (!result.ok && result.error === "inUse") throw new ToolError(WALLET_IN_USE);
      if (!result.ok && result.error === "walletNonzero") throw new ToolError(WALLET_NOT_EMPTY);
      unwrap(result);
      return { deleted: true, id, balances: await balancesOut(balanceIds) };
    },
  }),
  defineTool({
    name: "wallets_adjust_balance",
    title: "Set balance",
    description:
      "Set one or more balances to the amount the person actually has, for example after counting cash. Balance ids come from wallets_list. " +
      "`targetMinor` is the wanted balance in integer minor units of that balance's own currency (cents for USD, whole lira for LBP, whole pounds for SYP); it may be negative. " +
      "For each balance the difference is recorded as one transaction in the category \"Balance correction\" (created once if the person has none): income when the balance goes up, " +
      "expense when it goes down, nothing when it is already right. Each balance is handled in its own currency; amounts in different currencies are never combined. " +
      "Retrying is safe: the difference is computed again from the current balance. " +
      "Returns per target: balanceId, currency, previousMinor, targetMinor, transactionId (null when nothing was needed), matched (false when the balance changed in between), plus `balances`.",
    kind: "destructive",
    input: z.strictObject({
      targets: z.array(z.strictObject({
        balanceId: z.uuid().describe("Balance id from wallets_list (wallets[].balances[].id)."),
        targetMinor: z.number().int().min(-MAX_MINOR).max(MAX_MINOR).describe("Wanted balance in integer minor units of this balance's currency."),
      })).min(1).max(20)
        .refine((targets) => new Set(targets.map((target) => target.balanceId)).size === targets.length, { message: "Each balanceId may appear once" })
        .describe("The balances to set, 1 to 20, each balance id at most once."),
      occurredOn: z.iso.date().optional().describe("Date of the correction transactions, YYYY-MM-DD, not in the future. Default: today in the person's timezone."),
      note: z.string().trim().max(140).optional().describe("Optional note on each correction transaction, up to 140 characters."),
    }),
    run: async ({ targets, occurredOn, note }) => {
      const [wallets, currencies] = await Promise.all([getWallets(ALL), getCurrencies()]);
      const found = new Map(wallets.flatMap((wallet) => wallet.balances.map((balance) => [balance.id, { wallet, balance }] as const)));
      // Validate every target before the first write, so a refusal changes nothing.
      const plans = targets.map((target) => {
        const entry = found.get(target.balanceId);
        if (!entry) throw new ToolError(BALANCE_NOT_FOUND);
        const { wallet, balance } = entry;
        // Same balance, same currency: the only subtraction this tool makes.
        const diff = target.targetMinor - balance.balanceMinor;
        let definition: CurrencyDefinition | undefined;
        if (diff !== 0) {
          if (wallet.deleted) throw new ToolError(ACTION_ERROR_TEXT.walletDeleted);
          if (wallet.needsAttention) throw new ToolError(ACTION_ERROR_TEXT.walletNeedsAttention);
          if (balance.detached) throw new ToolError(ACTION_ERROR_TEXT.balanceDetached);
          definition = currencies.find((currency) => currency.code === balance.currency);
          if (!definition) throw new ToolError(ACTION_ERROR_TEXT.currencyUnavailable);
          if (definition.disabled) throw new ToolError(ACTION_ERROR_TEXT.currencyDisabled);
          if (Math.abs(diff) > MAX_MINOR) throw new ToolError(DIFFERENCE_TOO_LARGE);
        }
        return { target, balance, diff, definition };
      });
      const changing = plans.filter((plan) => plan.diff !== 0);
      const date = changing.length && !occurredOn ? todayIn((await getProfile()).timezone) : occurredOn;
      const categories = new Map<"expense" | "income", string>();
      const posted = new Map<string, { id: string; revision: number; categoryId: string }>();
      for (const plan of changing) {
        const kind = plan.diff > 0 ? "income" : "expense";
        if (!categories.has(kind)) categories.set(kind, (await correctionCategory(kind)).id);
        const categoryId = categories.get(kind)!;
        const saved = unwrap<{ ok: true; id: string; revision: number }>(await createTransaction({
          expectedUnits: currencyIntent(plan.definition),
          kind,
          occurredOn: date!,
          balanceId: plan.balance.id,
          amountMinor: Math.abs(plan.diff),
          categoryId,
          ...(note ? { note } : {}),
        }, crypto.randomUUID()));
        posted.set(plan.balance.id, { id: saved.id, revision: saved.revision, categoryId });
      }
      const after = changing.length ? await getWallets(ALL) : wallets;
      const now = new Map(after.flatMap((wallet) => wallet.balances.map((balance) => [balance.id, balance.balanceMinor] as const)));
      const amount = amountFormatter(currencies);
      const ids = plans.map((plan) => plan.balance.id);
      return {
        results: plans.map(({ target, balance }) => {
          const currentMinor = now.get(balance.id);
          const transaction = posted.get(balance.id);
          const matched = currentMinor === target.targetMinor;
          return {
            balanceId: balance.id,
            walletId: balance.walletId,
            currency: balance.currency,
            previousMinor: balance.balanceMinor,
            targetMinor: target.targetMinor,
            previous: amount(balance.balanceMinor, balance.currency),
            target: amount(target.targetMinor, balance.currency),
            transactionId: transaction?.id ?? null,
            ...(transaction ? { revision: transaction.revision, categoryId: transaction.categoryId } : {}),
            matched,
            ...(matched || currentMinor === undefined ? {} : { currentMinor, current: amount(currentMinor, balance.currency) }),
          };
        }),
        balances: await balancesOut(ids),
      };
    },
  }),
];
