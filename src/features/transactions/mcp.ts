import "server-only";
import { z } from "zod";
import { getCurrencies } from "@/features/currencies/queries";
import { getProfile } from "@/features/profile/queries";
import { getWallets } from "@/features/wallets/queries";
import { currencyIntent } from "@/lib/currency-intent";
import { amountFormatter } from "@/lib/mcp/amounts";
import { defineTool, ToolError } from "@/lib/mcp/tool";
import { ACTION_ERROR_TEXT, balancesOut, requestIdSchema, unwrap } from "@/lib/mcp/write";
import { MAX_MINOR, MAX_RATE, supportsUsdLbpRate, type CurrencyDefinition } from "@/lib/money";
import type { ActionResult } from "@/lib/supabase/action";
import {
  correctTransactionDate, createTransaction, createTransfer, deleteTransaction, restoreTransaction, updateTransaction,
} from "./actions";
import { MAX_EXPENSE_ITEMS, MAX_ITEM_DESCRIPTION_LENGTH } from "./breakdown";
import { todayIn } from "./group";
import type { TransactionMutation } from "./mutations-core";
import { fetchTransactions } from "./queries";
import { cursorSchema, filtersSchema, type Cursor, type Filters, type Transaction, type TransactionInput } from "./schema";

/** Every stored wallet and balance, so history and just-written rows always resolve. */
const ALL = { includeDeleted: true, includeNeedsAttention: true, includeDisabledBalances: true } as const;

const NOT_FOUND = "That transaction does not exist or was deleted. Use transactions_list to find its id and current revision.";
const SAVED_NOT_READABLE = "The change was saved, but the transaction cannot be read now (it may have been deleted since). Read transactions_list to check.";
const BALANCE_NOT_FOUND = "That balance does not exist. Use wallets_list to find the balance id.";
const REQUEST_CONFLICT =
  "This requestId was already used for a different transaction, or that transaction was changed or deleted since. Read transactions_list to check; to record a new transaction, use a new requestId.";
const MANAGED_FIELDS =
  "Only the date of a transfer, loan, salary, installment or fixed-expense transaction can change here. Use that feature's tools for anything else.";
const COST_NEEDS_SETTLEMENT =
  "A purchase cost in another currency than the paying balance needs a cash settlement, which this tool cannot record. Leave costCurrency out or set it to the balance's currency.";
const SAME_CURRENCY_AMOUNTS = "Both balances are in the same currency, so receivedMinor must equal sentMinor.";
const RECEIVED_REQUIRED = "The balances are in different currencies: give receivedMinor, the amount that arrived, in the destination balance's currency.";
const RATE_UNSUPPORTED = "A rate can only be recorded for an exchange between USD and LBP. Leave rate out.";

/** Paging used to find one row by id; fetchTransactions has no id filter. */
const SCAN_PAGE = 200;
const SCAN_PAGES = 50;

type Amount = ReturnType<typeof amountFormatter>;
type Saved = { ok: true } & TransactionMutation;

/** One row in the shape transactions_list gives. */
function rowOut(row: Transaction, amount: Amount, currencyOf: ReadonlyMap<string, string>) {
  const toCurrency = row.toBalanceId === null ? undefined : currencyOf.get(row.toBalanceId);
  const { settlement } = row;
  return {
    ...row,
    amount: amount(row.amountMinor, row.currency),
    // Without the destination balance's currency the received amount stays raw rather than risk a wrong figure.
    ...(row.toAmountMinor !== null && toCurrency ? { toAmount: amount(row.toAmountMinor, toCurrency) } : {}),
    ...(row.loanPrincipalMinor !== null ? { loanPrincipal: amount(row.loanPrincipalMinor, row.currency) } : {}),
    ...(row.loanFeeMinor !== null ? { loanFee: amount(row.loanFeeMinor, row.currency) } : {}),
    // Breakdown lines itemize the purchase cost, so they share its currency.
    items: row.items.map((item) => ({ ...item, amount: amount(item.amountMinor, row.currency) })),
    settlement: settlement && {
      ...settlement,
      tender: amount(settlement.tenderMinor, settlement.tenderCurrency),
      ...(settlement.extraTenders
        ? { extraTenders: settlement.extraTenders.map((line) => ({ ...line, amount: amount(line.amountMinor, line.currency) })) }
        : {}),
      changes: settlement.changes.map((line) => ({ ...line, amount: amount(line.amountMinor, line.currency) })),
    },
  };
}

async function rowsOut(rows: readonly Transaction[], currencies: readonly CurrencyDefinition[]) {
  const amount = amountFormatter(currencies);
  // The destination currency of a transfer is the destination balance's; deleted and
  // disabled balances are included so history still resolves.
  const needsBalances = rows.some((row) => row.toBalanceId !== null && row.toAmountMinor !== null);
  const wallets = needsBalances ? await getWallets(ALL) : [];
  const currencyOf = new Map(wallets.flatMap((wallet) => wallet.balances.map((balance) => [balance.id, balance.currency] as const)));
  return rows.map((row) => rowOut(row, amount, currencyOf));
}

/** One live row by id, paging through the activity list (optionally narrowed by a filter). */
async function findTransaction(id: string, filters: Filters = {}): Promise<Transaction | null> {
  let cursor: Cursor | null = null;
  for (let page = 0; page < SCAN_PAGES; page += 1) {
    const result = await fetchTransactions(filters, cursor, SCAN_PAGE);
    const row = result.rows.find((item) => item.id === id);
    if (row) return row;
    if (!result.next) return null;
    cursor = result.next;
  }
  return null;
}

/** Tries the narrow filter first, then the whole list (the row may have moved date or balance since). */
async function locate(id: string, hint?: Filters): Promise<Transaction | null> {
  const key = id.toLowerCase();
  return (hint ? await findTransaction(key, hint) : null) ?? findTransaction(key);
}

/** Every balance a row moves money in: payer, destination and cashier legs. */
function balanceIdsOf(row: Transaction): string[] {
  const ids = [row.balanceId, row.toBalanceId, ...(row.settlement?.extraTenders ?? []).map((line) => line.balanceId),
    ...(row.settlement?.changes ?? []).map((line) => line.balanceId)];
  return [...new Set(ids.filter((id): id is string => typeof id === "string"))];
}

/** The written row in the transactions_list shape, plus the balances it touched. */
async function writtenOut(id: string, hint?: Filters, alsoTouched: readonly string[] = []) {
  const [row, currencies] = await Promise.all([locate(id, hint), getCurrencies()]);
  if (!row) throw new ToolError(SAVED_NOT_READABLE);
  const [transaction] = await rowsOut([row], currencies);
  return { transaction, balances: await balancesOut([...new Set([...balanceIdsOf(row), ...alsoTouched])]) };
}

/** Balance id -> currency, over every stored balance. */
async function balanceIndex() {
  const [wallets, currencies] = await Promise.all([getWallets(ALL), getCurrencies()]);
  const balances = new Map(wallets.flatMap((wallet) => wallet.balances.map((balance) => [balance.id, balance] as const)));
  return {
    currencies,
    balance(id: string) {
      const found = balances.get(id.toLowerCase());
      if (!found) throw new ToolError(BALANCE_NOT_FOUND);
      return found;
    },
  };
}

/**
 * The x-budget-units header the UI sends: the decimals of each currency the write touches, from
 * the person's own list. The database refuses a money write without it (currency.intentConflict).
 */
function unitsFor(currencies: readonly CurrencyDefinition[], codes: readonly (string | undefined)[]) {
  const definitions = [...new Set(codes)].flatMap((code) => currencies.filter((currency) => currency.code === code));
  return definitions.length ? currencyIntent(...definitions) : undefined;
}

/** A create with a requestId the model chose: the database's own replay refusal gets a clearer sentence. */
function unwrapCreate(result: ActionResult<TransactionMutation>, modelRequestId: boolean) {
  if (!result.ok && result.error === "conflict" && modelRequestId) throw new ToolError(REQUEST_CONFLICT);
  return unwrap<Saved>(result);
}

async function today() {
  return todayIn((await getProfile()).timezone);
}

const date = z.iso.date().refine((value) => value >= "2000-01-01");
const minor = z.number().int().min(1).max(MAX_MINOR);
const code = z.string().regex(/^[A-Z][A-Z0-9]{0,11}$/);
const note = z.string().trim().max(140);
const transactionId = z.uuid().describe("Transaction id from transactions_list.");
const revision = z.number().int().min(1).max(2_147_483_647)
  .describe("The transaction's current revision, from transactions_list or from the result of the last change to it.");
const items = z.array(z.strictObject({
  description: z.string().trim().min(1).max(MAX_ITEM_DESCRIPTION_LENGTH).describe("What the line is, 1 to 140 characters."),
  amountMinor: minor.describe("Line amount in integer minor units of the purchase cost currency."),
})).max(MAX_EXPENSE_ITEMS);

const ENTRY_FIELDS = ["balanceId", "amountMinor", "categoryId", "costCurrency", "items"] as const;
const TRANSFER_FIELDS = ["sourceBalanceId", "destinationBalanceId", "sentMinor", "receivedMinor", "rate"] as const;

const createInput = z.strictObject({
  kind: z.enum(["expense", "income", "transfer"])
    .describe("expense or income (money out of / into one balance, with a category), or transfer (money moved between two balances, possibly in different currencies)."),
  requestId: requestIdSchema,
  occurredOn: date.optional().describe("All kinds. Date, YYYY-MM-DD, not in the future. Default: today in the person's timezone. Send the same value when retrying."),
  note: note.optional().describe("All kinds. Optional note, up to 140 characters."),
  balanceId: z.uuid().optional().describe("expense/income only, required. Balance id from wallets_list that pays or receives."),
  amountMinor: minor.optional().describe("expense/income only, required. Amount in integer minor units of the balance's currency (cents for USD, whole lira for LBP, whole pounds for SYP)."),
  categoryId: z.uuid().optional().describe("expense/income only, required. Active category of the same kind, from categories_list."),
  costCurrency: code.optional().describe("expense/income only, optional. Must be the balance's own currency (a cost in another currency needs a cash settlement, which this tool does not record)."),
  items: items.optional().describe("expense only, optional. Descriptive breakdown lines (up to 50); they never move money and must not add up to more than amountMinor."),
  sourceBalanceId: z.uuid().optional().describe("transfer only, required. Balance id from wallets_list the money leaves."),
  destinationBalanceId: z.uuid().optional().describe("transfer only, required. A different balance id from wallets_list the money arrives in."),
  sentMinor: minor.optional().describe("transfer only, required. Amount that left, in integer minor units of the source balance's currency."),
  receivedMinor: minor.optional().describe("transfer only. Amount that arrived, in integer minor units of the destination balance's currency. Required when the currencies differ; when they are the same it must equal sentMinor (default)."),
  rate: z.number().int().min(1).max(MAX_RATE).optional().describe("transfer only, optional. Whole LBP per 1 USD, recorded for reference on a USD-LBP exchange only; it never changes the amounts."),
}).superRefine((input, ctx) => {
  const transfer = input.kind === "transfer";
  const required = transfer ? ["sourceBalanceId", "destinationBalanceId", "sentMinor"] as const : ["balanceId", "amountMinor", "categoryId"] as const;
  for (const key of required) if (input[key] === undefined) ctx.addIssue({ code: "custom", path: [key], message: `Required for kind ${input.kind}` });
  for (const key of transfer ? ENTRY_FIELDS : TRANSFER_FIELDS) {
    if (input[key] !== undefined) ctx.addIssue({ code: "custom", path: [key], message: `Not used for kind ${input.kind}` });
  }
  if (input.kind === "income" && input.items !== undefined) ctx.addIssue({ code: "custom", path: ["items"], message: "Only expenses can have items" });
  if (transfer && input.sourceBalanceId !== undefined && input.sourceBalanceId.toLowerCase() === input.destinationBalanceId?.toLowerCase()) {
    ctx.addIssue({ code: "custom", path: ["destinationBalanceId"], message: "Must differ from sourceBalanceId" });
  }
});

const updateInput = z.strictObject({
  id: transactionId,
  revision,
  occurredOn: date.optional().describe("New date, YYYY-MM-DD, not in the future. The only field a transfer, loan, salary, installment or fixed-expense transaction accepts."),
  balanceId: z.uuid().optional().describe("Plain expense/income only. New paying or receiving balance id from wallets_list."),
  amountMinor: minor.optional().describe("Plain expense/income only. New amount in integer minor units of the purchase cost currency."),
  categoryId: z.uuid().optional().describe("Plain expense/income only. New active category of the same kind, from categories_list."),
  note: note.optional().describe("Plain expense/income only. New note, up to 140 characters; an empty string clears it."),
  costCurrency: code.optional().describe("Plain expense/income only. Purchase cost currency; leave out to keep it."),
  items: items.optional().describe("Plain expenses only. Replaces the descriptive breakdown lines; [] removes them all; leave out to keep them."),
}).refine((input) => Object.keys(input).some((key) => key !== "id" && key !== "revision" && input[key as keyof typeof input] !== undefined), {
  message: "Give at least one field to change",
});

const revisionRef = z.strictObject({ id: transactionId, revision });

export const transactionTools = [
  defineTool({
    name: "transactions_list",
    title: "List transactions",
    description:
      "List one page of transactions, newest first, optionally filtered by text, kind, balance, category and dates. " +
      "When `next` is not null, pass it back as `cursor` to get the following page. " +
      "`amount`/`currency` are the purchase cost in the cost currency, and `items` (a descriptive breakdown) are in that currency too. " +
      "For a cash purchase, what was actually paid and returned is in `settlement`: `tender` (from the paying balance), `extraTenders` and `changes`, each in its own currency. " +
      "For a transfer or exchange, `amount` is what left the source balance and `toAmount` is what arrived in the destination balance, in that balance's currency. " +
      "Never add amounts in different currencies.",
    kind: "read",
    input: z.object({ filters: filtersSchema.optional(), cursor: cursorSchema.optional() }),
    run: async ({ filters, cursor }) => {
      const [page, currencies] = await Promise.all([fetchTransactions(filters ?? {}, cursor ?? null), getCurrencies()]);
      return { rows: await rowsOut(page.rows, currencies), next: page.next };
    },
  }),
  defineTool({
    name: "transactions_create",
    title: "Add transaction",
    description:
      "Record one expense, income or transfer. Ids come from wallets_list (balance ids) and categories_list; every amount is an integer in minor units of its balance's currency " +
      "(cents for USD, whole lira for LBP, whole pounds for SYP). " +
      "expense/income: balanceId, amountMinor, categoryId (same kind), optional items (expense only), costCurrency, note, occurredOn. " +
      "A cash purchase with change returned (a cashier settlement) cannot be recorded here; record it in the app. " +
      "transfer: sourceBalanceId, destinationBalanceId, sentMinor and, when the currencies differ, receivedMinor (what actually arrived; no rate is applied), optional rate (USD-LBP only, for reference), note, occurredOn. " +
      "Send a requestId and, when retrying after a timeout or error, send it again with exactly the same arguments: the first transaction is returned instead of a second one. " +
      "Returns { transaction } in the shape transactions_list gives (with its id and revision) and `balances`, the current balances it touched.",
    kind: "write",
    input: createInput,
    run: async (input) => {
      const draftId = input.requestId ?? crypto.randomUUID();
      const { currencies, balance } = await balanceIndex();
      const occurredOn = input.occurredOn ?? await today();
      const extras = input.note ? { note: input.note } : {};
      if (input.kind === "transfer") {
        const source = balance(input.sourceBalanceId!);
        const destination = balance(input.destinationBalanceId!);
        const sameCurrency = source.currency === destination.currency;
        if (!sameCurrency && input.receivedMinor === undefined) throw new ToolError(RECEIVED_REQUIRED);
        const receivedMinor = input.receivedMinor ?? input.sentMinor!;
        if (sameCurrency && receivedMinor !== input.sentMinor) throw new ToolError(SAME_CURRENCY_AMOUNTS);
        if (input.rate !== undefined && !supportsUsdLbpRate(source.currency, destination.currency)) throw new ToolError(RATE_UNSUPPORTED);
        const saved = unwrapCreate(await createTransfer({
          requestId: draftId,
          expectedUnits: unitsFor(currencies, [source.currency, destination.currency]),
          occurredOn,
          sourceBalanceId: source.id,
          destinationBalanceId: destination.id,
          sentMinor: input.sentMinor!,
          receivedMinor,
          ...(input.rate !== undefined ? { rate: input.rate } : {}),
          ...extras,
        }), input.requestId !== undefined);
        return writtenOut(saved.id, { kind: "transfer", balanceId: source.id, from: occurredOn, to: occurredOn });
      }
      const payer = balance(input.balanceId!);
      if (input.costCurrency !== undefined && input.costCurrency !== payer.currency) throw new ToolError(COST_NEEDS_SETTLEMENT);
      const saved = unwrapCreate(await createTransaction({
        expectedUnits: unitsFor(currencies, [payer.currency]),
        kind: input.kind,
        occurredOn,
        balanceId: payer.id,
        amountMinor: input.amountMinor!,
        categoryId: input.categoryId!.toLowerCase(),
        ...(input.costCurrency ? { costCurrency: input.costCurrency } : {}),
        ...(input.items?.length ? { items: input.items } : {}),
        ...extras,
      }, draftId), input.requestId !== undefined);
      return writtenOut(saved.id, { balanceId: payer.id, from: occurredOn, to: occurredOn });
    },
  }),
  defineTool({
    name: "transactions_update",
    title: "Edit transaction",
    description:
      "Change an existing transaction. Give its id and current revision (from transactions_list) and only the fields to change; the rest keep their value. " +
      "A plain expense or income accepts occurredOn, balanceId, amountMinor (integer minor units), categoryId, note, costCurrency and items; a cash settlement it already has is kept. " +
      "A transfer, loan, salary, installment or fixed-expense transaction accepts only occurredOn; any other field is refused. " +
      "Returns { transaction } with its new revision, in the shape transactions_list gives, and `balances`.",
    kind: "write",
    input: updateInput,
    run: async ({ id, revision: expected, occurredOn, balanceId, amountMinor, categoryId, note: newNote, costCurrency, items: newItems }) => {
      const current = await locate(id);
      if (!current) throw new ToolError(NOT_FOUND);
      if (current.revision !== expected) throw new ToolError(ACTION_ERROR_TEXT.conflict);
      const plain = (current.kind === "expense" || current.kind === "income") && current.source === null
        && current.loanId === null && current.fixedExpenseId === null && current.installmentId === null;
      if (!plain) {
        const others = [balanceId, amountMinor, categoryId, newNote, costCurrency, newItems];
        if (others.some((value) => value !== undefined) || occurredOn === undefined) throw new ToolError(MANAGED_FIELDS);
        const saved = unwrap<Saved>(await correctTransactionDate(current.id, expected, occurredOn));
        return writtenOut(saved.id, { balanceId: current.balanceId, from: occurredOn, to: occurredOn });
      }
      const { currencies, balance } = await balanceIndex();
      const payer = balance(balanceId ?? current.balanceId);
      const settlement = current.settlement;
      const legs = settlement
        ? [settlement.tenderCurrency, ...(settlement.extraTenders ?? []).map((line) => line.currency), ...settlement.changes.map((line) => line.currency)]
        : [];
      const kept = newNote ?? current.note ?? undefined;
      const date = occurredOn ?? current.occurredOn;
      const input: TransactionInput = {
        expectedUnits: unitsFor(currencies, [payer.currency, costCurrency ?? current.currency, ...legs]),
        kind: current.kind as "expense" | "income",
        occurredOn: date,
        balanceId: payer.id,
        amountMinor: amountMinor ?? current.amountMinor,
        categoryId: (categoryId ?? current.categoryId ?? "").toLowerCase(),
        // An omitted note would clear the stored one, so the current note is sent back.
        ...(kept !== undefined ? { note: kept } : {}),
        ...(costCurrency ? { costCurrency } : {}),
        // Omitted items (and settlement) keep what is stored.
        ...(newItems !== undefined ? { items: newItems } : {}),
      };
      const saved = unwrap<Saved>(await updateTransaction(current.id, input, expected));
      return writtenOut(saved.id, { balanceId: payer.id, from: date, to: date }, balanceIdsOf(current));
    },
  }),
  defineTool({
    name: "transactions_delete",
    title: "Delete transaction",
    description:
      "Delete a transaction (soft delete: it can be brought back with transactions_restore). Give its id and current revision from transactions_list. " +
      "Loan, salary and installment transactions may refuse; use that feature's tools. " +
      "Returns { deleted: true, id, revision } (the revision to pass to transactions_restore) and `balances`.",
    kind: "destructive",
    input: revisionRef,
    run: async ({ id, revision: expected }) => {
      const current = await locate(id);
      const saved = unwrap<Saved>(await deleteTransaction(id, expected));
      return { deleted: true, id: saved.id, revision: saved.revision, balances: await balancesOut(current ? balanceIdsOf(current) : undefined) };
    },
  }),
  defineTool({
    name: "transactions_restore",
    title: "Restore transaction",
    description:
      "Bring back a deleted transaction. Give its id and the revision transactions_delete returned. " +
      "Returns { transaction } in the shape transactions_list gives and `balances`.",
    kind: "write",
    input: revisionRef,
    run: async ({ id, revision: expected }) => {
      const saved = unwrap<Saved>(await restoreTransaction(id, expected));
      return writtenOut(saved.id);
    },
  }),
];
