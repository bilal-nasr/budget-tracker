import "server-only";
import { z } from "zod";
import { getCurrencies } from "@/features/currencies/queries";
import { getProfile } from "@/features/profile/queries";
import { todayIn } from "@/features/transactions/group";
import { getWallets } from "@/features/wallets/queries";
import { currencyIntent } from "@/lib/currency-intent";
import { amountFormatter } from "@/lib/mcp/amounts";
import { defineTool, ToolError } from "@/lib/mcp/tool";
import { ACTION_ERROR_TEXT, balancesOut, requestIdSchema, unwrap } from "@/lib/mcp/write";
import { createLoan, deleteLoan, recordLoanPayment, updateLoan, voidLoanPayment } from "./actions";
import { getLoanHistory, getLoans } from "./queries";
import { loanCreateSchema, loanEditSchema, loanPaymentSchema, type Loan, type LoanEvent } from "./schema";

const nullable = <T>(value: number | null, format: (minor: number) => T): T | null => (value === null ? null : format(value));
type Amount = ReturnType<typeof amountFormatter>;

const LOAN_NOT_FOUND = "That loan does not exist. Use loans_list to find its id.";
const PAYMENT_NOT_FOUND = "That payment is not in this loan's history. Use loans_history with the loan id to find its transactionId and revision.";
const NOT_REPAYMENT = "Only a repayment can be removed this way; the principal movement belongs to the loan itself.";
const DELETE_REFUSED = "Only an archived (fully repaid) or canceled loan can be deleted; this loan is still active.";
const NOT_READ_BACK = "The change was saved but the loan could not be read back. Read loans_list to see it.";

/** A loan as loans_list gives it: every minor figure with an amount in the loan's currency, without the never-filled event history. */
function loanOut(loan: Loan, amount: Amount) {
  const money = (minor: number) => amount(minor, loan.currency);
  // getLoans never fills the event history from the database (`events` is always empty,
  // `historyComplete` false), so neither is passed on; loans_history reads the events.
  const rest: Partial<typeof loan> = { ...loan };
  delete rest.events;
  delete rest.historyComplete;
  return {
    ...(rest as Omit<Loan, "events" | "historyComplete">),
    principal: money(loan.principalMinor),
    fee: money(loan.feeMinor),
    totalDue: money(loan.totalDueMinor),
    principalPaidBefore: money(loan.principalPaidBeforeMinor),
    feePaidBefore: money(loan.feePaidBeforeMinor),
    principalPaid: money(loan.principalPaidMinor),
    feePaid: money(loan.feePaidMinor),
    principalRemaining: money(loan.principalRemainingMinor),
    feeRemaining: money(loan.feeRemainingMinor),
    remaining: money(loan.remainingMinor),
    monthlyPayment: nullable(loan.monthlyPaymentMinor, money),
    finalPayment: nullable(loan.finalPaymentMinor, money),
  };
}

/** An event as loans_history gives it; without the loan's currency the amounts stay raw. */
function eventOut(event: LoanEvent, currency: string | undefined, amount: Amount) {
  return currency
    ? { ...event, amount: amount(event.amountMinor, currency), principal: amount(event.principalMinor, currency), fee: amount(event.feeMinor, currency) }
    : event;
}

async function loansOut() {
  const [loans, currencies] = await Promise.all([getLoans(), getCurrencies()]);
  const amount = amountFormatter(currencies);
  return loans.map((loan) => loanOut(loan, amount));
}

async function loanOutById(id: string, missing = LOAN_NOT_FOUND) {
  const loan = (await loansOut()).find((item) => item.id === id);
  if (!loan) throw new ToolError(missing);
  return loan;
}

/** Every event of a loan, newest first, following the history pages to the end. */
async function allEvents(loanId: string): Promise<LoanEvent[]> {
  const events: LoanEvent[] = [];
  let before: number | null = null;
  do {
    const page = await getLoanHistory(loanId, before);
    events.push(...page.rows);
    before = page.next;
  } while (before !== null);
  return events;
}

async function findEvent(loanId: string, transactionId: string): Promise<LoanEvent | undefined> {
  let before: number | null = null;
  do {
    const page = await getLoanHistory(loanId, before);
    const found = page.rows.find((event) => event.transactionId === transactionId);
    if (found) return found;
    before = page.next;
  } while (before !== null);
  return undefined;
}

async function eventOutById(loanId: string, transactionId: string, currency: string) {
  const [event, currencies] = await Promise.all([findEvent(loanId, transactionId), getCurrencies()]);
  return event ? eventOut(event, currency, amountFormatter(currencies)) : null;
}

/** Currency-intent header for the chosen balance's currency, built the way the loan sheets build it. */
async function intentForBalance(balanceId: string) {
  const [wallets, currencies] = await Promise.all([
    getWallets({ includeDeleted: true, includeNeedsAttention: true, includeDisabledBalances: true }),
    getCurrencies(),
  ]);
  const balance = wallets.flatMap((wallet) => wallet.balances).find((item) => item.id === balanceId);
  const definition = balance && currencies.find((currency) => currency.code === balance.currency);
  if (!definition) throw new ToolError(ACTION_ERROR_TEXT.walletUnavailable);
  return currencyIntent(definition);
}

const today = async () => todayIn((await getProfile()).timezone);

const create = loanCreateSchema.shape;
const edit = loanEditSchema.shape;
const payment = loanPaymentSchema.shape;
const loanIdField = z.uuid().describe("Loan id from loans_list.");
const nameField = create.name.describe("Loan name, 1 to 60 characters.");
const balanceField = create.balanceId.describe(
  "Wallet balance id from wallets_list (balances[].id). Its currency is the loan's currency; every amount of the loan is in it.",
);
const feeCategoryField = create.feeCategoryId.describe(
  "Category id from categories_list that the fee is reported under: an expense category for a borrowed loan, an income category for a lent loan.",
);
const monthlyField = create.monthlyPaymentMinor.describe(
  "Optional planned monthly payment in integer minor units. Send it together with paymentCount (or both null to have no plan). Only a suggestion: it never changes what is owed.",
);
const countField = create.paymentCount.describe(
  "Optional number of planned payments including the last one (1 to 1200), sent together with monthlyPaymentMinor. The last payment is the total due minus monthlyPaymentMinor times (paymentCount - 1) and must be above zero.",
);
const dateField = (what: string) => payment.occurredOn.optional().describe(`${what} as YYYY-MM-DD, not in the future. Defaults to today in the person's time zone.`);

export const loanTools = [
  defineTool({
    name: "loans_list",
    title: "List loans",
    description:
      "List loans the person borrowed or lent: principal, fee, total due, what is paid and what remains (principal and fee separately), and the planned monthly payment. " +
      "`remaining` is still owed in total; each loan has one currency and loans in different currencies are never summed. A loan's disbursements and repayments (its events) are not listed here; use loans_history with a loan id for them. " +
      "Archived and deleted loans are included and flagged: `archivedAt` is set on an archived loan and `deletedAt` on a deleted one; do not count a deleted loan as live.",
    kind: "read",
    run: async () => ({ loans: await loansOut() }),
  }),
  defineTool({
    name: "loans_history",
    title: "Loan history",
    description:
      "One page (30 events) of a loan's disbursements and repayments, newest first, each split into principal and fee. " +
      "Get `loanId` from loans_list; when `next` is not null pass it back as `before` for older events. " +
      "Deleted events are included and flagged with `deletedAt`; they no longer count toward what is paid.",
    kind: "read",
    input: z.object({ loanId: z.uuid(), before: z.number().int().optional() }),
    run: async ({ loanId, before }) => {
      const [page, loans, currencies] = await Promise.all([getLoanHistory(loanId, before ?? null), getLoans(), getCurrencies()]);
      const amount = amountFormatter(currencies);
      // Every event of a loan is in the loan's currency; without the loan the amounts stay raw.
      const currency = loans.find((loan) => loan.id === loanId)?.currency;
      return { rows: page.rows.map((event) => eventOut(event, currency, amount)), next: page.next };
    },
  }),
  defineTool({
    name: "loans_create",
    title: "Create loan",
    description:
      "Start tracking a loan the person borrowed or lent. Balance ids come from wallets_list, the fee category from categories_list. " +
      "All amounts are integer minor units of the balance's currency. The fee is `feeBps` basis points of the principal (100 = 1%), added on top of the principal; " +
      "principal and fee are tracked separately and only the fee is reported as spending (borrowed) or income (lent). " +
      "creationMode \"new\" (the default) records the principal moving on openedOn: into the balance for a borrowed loan, out of it for a lent loan. " +
      "creationMode \"existing\" tracks a loan that already exists without moving money; principalPaidBeforeMinor and feePaidBeforeMinor are what was already repaid before tracking (both must be 0 for \"new\"). " +
      "Returns { loan } in the shape loans_list gives, plus `balances` (as wallets_list gives them) when money moved. " +
      "Send a requestId and reuse it with exactly the same values when retrying: the same loan is returned instead of a second one (a requestId reused with different values is refused as invalid).",
    kind: "write",
    input: z.strictObject({
      requestId: requestIdSchema,
      name: nameField,
      direction: create.direction.describe("\"borrowed\": the person owes the money. \"lent\": someone owes the person."),
      principalMinor: create.principalMinor.describe("Principal in integer minor units (for example cents), at least 1."),
      feeBps: create.feeBps.describe("Fee as basis points of the principal, 0 to 10000 (250 = 2.5%). Use 0 for no fee."),
      balanceId: balanceField,
      feeCategoryId: feeCategoryField,
      openedOn: dateField("Day the loan started"),
      creationMode: create.creationMode.optional().describe("\"new\" (default) moves the principal now; \"existing\" only tracks a loan that already exists."),
      principalPaidBeforeMinor: create.principalPaidBeforeMinor.optional().describe("Only for \"existing\": principal already repaid before tracking, in minor units. Default 0."),
      feePaidBeforeMinor: create.feePaidBeforeMinor.optional().describe("Only for \"existing\": fee already paid before tracking, in minor units. Default 0."),
      monthlyPaymentMinor: monthlyField,
      paymentCount: countField,
    }),
    run: async ({ requestId, openedOn, creationMode, principalPaidBeforeMinor, feePaidBeforeMinor, ...fields }) => {
      const mode = creationMode ?? "new";
      const created = unwrap<{ ok: true; id: string }>(await createLoan({
        ...fields,
        expectedUnits: await intentForBalance(fields.balanceId),
        requestId: requestId ?? crypto.randomUUID(),
        openedOn: openedOn ?? (await today()),
        creationMode: mode,
        principalPaidBeforeMinor: principalPaidBeforeMinor ?? 0,
        feePaidBeforeMinor: feePaidBeforeMinor ?? 0,
      }));
      const loan = await loanOutById(created.id, NOT_READ_BACK);
      return mode === "new" ? { loan, balances: await balancesOut([loan.balanceId]) } : { loan };
    },
  }),
  defineTool({
    name: "loans_update",
    title: "Update loan",
    description:
      "Change a loan's name, default balance, fee category or repayment plan. Id comes from loans_list; fields you leave out keep their current value. " +
      "The principal, fee, direction and dates cannot change here. The new balance must be in the loan's currency; changing it moves no money already recorded. " +
      "To change the plan send monthlyPaymentMinor and paymentCount together (both null removes the plan). Returns { loan } in the shape loans_list gives.",
    kind: "write",
    input: z.strictObject({
      id: loanIdField,
      name: edit.name.optional().describe("New name, 1 to 60 characters."),
      balanceId: edit.balanceId.optional().describe("New default wallet balance id from wallets_list, in the loan's currency."),
      feeCategoryId: edit.feeCategoryId.optional().describe(feeCategoryField.description!),
      monthlyPaymentMinor: monthlyField,
      paymentCount: countField,
    }),
    run: async ({ id, name, balanceId, feeCategoryId, monthlyPaymentMinor, paymentCount }) => {
      const current = (await getLoans()).find((loan) => loan.id === id);
      if (!current) throw new ToolError(LOAN_NOT_FOUND);
      const nextBalanceId = balanceId ?? current.balanceId;
      unwrap(await updateLoan(id, {
        expectedUnits: await intentForBalance(nextBalanceId),
        name: name ?? current.name,
        balanceId: nextBalanceId,
        feeCategoryId: feeCategoryId ?? current.feeCategoryId,
        // Left out, the plan is untouched (the database keeps it); the schema refuses one without the other.
        ...(monthlyPaymentMinor !== undefined ? { monthlyPaymentMinor } : {}),
        ...(paymentCount !== undefined ? { paymentCount } : {}),
      }));
      return { loan: await loanOutById(id, NOT_READ_BACK) };
    },
  }),
  defineTool({
    name: "loans_delete",
    title: "Delete loan",
    description:
      "Permanently delete a loan and every transaction linked to it: the principal movement and all payments, voided ones included. " +
      "Only a loan that is archived (fully repaid and archived in the app) or canceled (`archivedAt` or `deletedAt` set in loans_list) can be deleted; an active loan is refused. " +
      "Removing the transactions reverses their wallet effects and fee reporting. This cannot be undone. Id comes from loans_list. " +
      "Returns { deleted: true, id } plus the affected `balances` when money moved.",
    kind: "destructive",
    input: z.strictObject({ id: loanIdField }),
    run: async ({ id }) => {
      const loan = (await getLoans()).find((item) => item.id === id);
      if (!loan) throw new ToolError(LOAN_NOT_FOUND);
      // Only live entries still move a balance; voided ones have no wallet effect left to reverse.
      const moved = [...new Set((await allEvents(id)).filter((event) => event.deletedAt === null).map((event) => event.balanceId))];
      const result = await deleteLoan(id);
      if (!result.ok && result.error === "inUse") throw new ToolError(DELETE_REFUSED);
      unwrap(result);
      return moved.length > 0 ? { deleted: true, id, balances: await balancesOut(moved) } : { deleted: true, id };
    },
  }),
  defineTool({
    name: "loans_record_payment",
    title: "Record loan payment",
    description:
      "Record one repayment of a loan: for a borrowed loan money leaves the balance, for a lent loan it arrives. Loan ids come from loans_list, balance ids from wallets_list (a balance in the loan's currency). " +
      "`amountMinor` is integer minor units of the loan's currency, at most the loan's `remaining`. It pays the principal first and the rest is fee; only the fee part is reported as spending or income. " +
      "Payments must be in date order: occurredOn cannot be before the latest payment. " +
      "Returns { loan } (loans_list shape), { payment } (loans_history shape, with the transactionId and revision loans_delete_payment needs) and the affected `balances`. " +
      "Send a requestId and reuse it with exactly the same values when retrying: the same payment is returned instead of a second one.",
    kind: "write",
    input: z.strictObject({
      requestId: requestIdSchema,
      loanId: loanIdField,
      balanceId: payment.balanceId.describe("Wallet balance id from wallets_list (balances[].id), in the loan's currency."),
      amountMinor: payment.amountMinor.describe("Amount paid in integer minor units of the loan's currency, at least 1 and at most what remains."),
      occurredOn: dateField("Day of the payment"),
    }),
    run: async ({ requestId, loanId, balanceId, amountMinor, occurredOn }) => {
      const recorded = unwrap<{ ok: true; id: string; revision: number }>(await recordLoanPayment({
        expectedUnits: await intentForBalance(balanceId),
        requestId: requestId ?? crypto.randomUUID(),
        loanId,
        balanceId,
        amountMinor,
        occurredOn: occurredOn ?? (await today()),
      }));
      const loan = await loanOutById(loanId, NOT_READ_BACK);
      return { loan, payment: await eventOutById(loanId, recorded.id, loan.currency), balances: await balancesOut([balanceId]) };
    },
  }),
  defineTool({
    name: "loans_delete_payment",
    title: "Void loan payment",
    description:
      "Void (reverse) a loan repayment: its wallet movement and fee reporting are undone and its amount is owed again. The entry stays in the history flagged with `deletedAt`, " +
      "so the person can restore it in the app (Restore in the loan's history); it is not erased. Only the latest live payment of a loan can be voided; void newer ones first. " +
      "Take loanId from loans_list and the payment's transactionId and current revision from loans_history (or from loans_record_payment's result). " +
      "Returns { deleted: true, voided: true, id, revision } (the voided payment's new revision), the voided { payment } and updated { loan }, and the affected `balances`.",
    kind: "destructive",
    input: z.strictObject({
      loanId: loanIdField,
      transactionId: z.uuid().describe("The payment's transactionId from loans_history."),
      revision: z.number().int().positive().describe("The payment's current revision from loans_history; a stale one is refused."),
    }),
    run: async ({ loanId, transactionId, revision }) => {
      // voidLoanPayment, not deleteLoanPayment: voiding is reversible and keeps the history; deleting is permanent.
      const event = await findEvent(loanId, transactionId);
      if (!event) throw new ToolError(PAYMENT_NOT_FOUND);
      if (event.event !== "repayment") throw new ToolError(NOT_REPAYMENT);
      const voided = unwrap<{ ok: true; id: string; revision: number }>(await voidLoanPayment(transactionId, revision));
      const loan = await loanOutById(loanId, NOT_READ_BACK);
      return {
        deleted: true,
        voided: true,
        id: transactionId,
        revision: voided.revision,
        payment: await eventOutById(loanId, transactionId, loan.currency),
        loan,
        balances: await balancesOut([event.balanceId]),
      };
    },
  }),
];
