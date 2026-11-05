// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { NextIntlClientProvider } from "next-intl";
import { AppDataProvider } from "@/components/providers/app-data";
import { emptyTransactionMetadata, type Transaction } from "@/features/transactions/schema";
import { SEED_CURRENCY_DEFINITIONS } from "@/lib/currency";
import en from "@/messages/en.json";
import { TransactionRow } from "./transaction-row";
import { DetailSheet } from "./detail-sheet";
vi.mock("@/features/transactions/actions",()=>({deleteTransaction:vi.fn(),restoreTransaction:vi.fn(),correctTransactionNote:vi.fn()}));
import { correctTransactionNote } from "@/features/transactions/actions";
vi.mock("@/i18n/navigation",()=>({Link:({children}:{children:React.ReactNode})=><a>{children}</a>}));
vi.mock("@/components/ui/sheet-shell",()=>({SheetShell:({children}:{children:React.ReactNode})=><div role="dialog">{children}</div>}));
const wallets=["one","two"].map((id,index)=>({id,name:index===0?"Pocket":"Bank",kind:"cash" as const,position:index,deleted:false,needsAttention:false,defaultBalanceId:`${id}-USD`,balances:SEED_CURRENCY_DEFINITIONS.map((c,position)=>({id:`${id}-${c.code}`,walletId:id,currency:c.code,position,openingBalanceMinor:0,balanceMinor:0,detached:false}))}));
const transaction:Transaction={...emptyTransactionMetadata(),id:"tx",kind:"transfer",occurredOn:"2026-11-05",amountMinor:89500,currency:"LBP",balanceId:"one-LBP",toBalanceId:"two-LBP",toAmountMinor:89500,categoryId:null,note:null,createdAt:"2026-11-05T00:00:00Z"};
function mount(tx:Transaction,detail=false){return render(<NextIntlClientProvider locale="en" messages={en}><AppDataProvider walletContainers={wallets} currencies={[...SEED_CURRENCY_DEFINITIONS]} categories={[]} timezone="UTC" salary={null} usdLbpRate={null}>{detail?<DetailSheet transaction={tx} onClose={vi.fn()} onEdit={vi.fn()} onDuplicate={vi.fn()}/>:<ul><TransactionRow transaction={tx} onOpen={vi.fn()}/></ul>}</AppDataProvider></NextIntlClientProvider>);}
afterEach(cleanup);
it("keeps tombstoned managed-loan history read-only with its loan navigation", () => {
 const historical = wallets.map((wallet) => ({ ...wallet, deleted: wallet.id === "one" }));
 const loan: Transaction = { ...transaction, kind: "loan", source: "loan", loanId: "loan-id", loanFlow: "in", loanEvent: "repayment", toBalanceId: null, toAmountMinor: null };
 render(<NextIntlClientProvider locale="en" messages={en}><AppDataProvider walletContainers={historical} currencies={[...SEED_CURRENCY_DEFINITIONS]} categories={[]} timezone="UTC" salary={null} usdLbpRate={null}><DetailSheet transaction={loan} onClose={vi.fn()} onEdit={vi.fn()} onDuplicate={vi.fn()} /></AppDataProvider></NextIntlClientProvider>);
 expect(screen.queryByLabelText(en.Detail.historyNote)).toBeNull();
 expect(screen.queryByRole("button", { name: en.Detail.saveHistoryNote })).toBeNull();
 expect(screen.getByText(en.Breakdown.managedTransaction)).toBeTruthy();
 expect(screen.getByText(en.Loans.openLoan).tagName).toBe("A");
});
it("labels cross-wallet same/cross-currency transfers Move using exact owner identity",()=>{
 const view=mount(transaction);
 expect(screen.getByText(en.Detail.move)).toBeTruthy();
 expect(screen.getByText("LBP 89,500")).toBeTruthy();
 view.unmount();mount({...transaction,toBalanceId:"two-USD",toAmountMinor:100});
 expect(screen.getByText(en.Detail.move)).toBeTruthy();
 expect(screen.getByText("+$1.00")).toBeTruthy();
});
it("labels same-wallet currency conversion Exchange and details use actual denominations",()=>{
 mount({...transaction,toBalanceId:"one-USD",toAmountMinor:100},true);
 expect(screen.getByText(en.Detail.exchange)).toBeTruthy();
 expect(screen.getByText(en.Detail.exchangeLine)).toBeTruthy();
 expect(screen.getByText("−LBP 89,500")).toBeTruthy();
 expect(screen.getByText("+$1.00")).toBeTruthy();
 expect(screen.queryByRole("button",{name:en.Detail.edit})).toBeNull();
});

it.each(["one", "two"])("retains both exact transfer legs and hides monetary controls when %s is deleted", (deletedId) => {
 const historical = wallets.map((wallet) => ({ ...wallet, deleted: wallet.id === deletedId }));
 render(<NextIntlClientProvider locale="en" messages={en}><AppDataProvider walletContainers={historical} currencies={[...SEED_CURRENCY_DEFINITIONS]} categories={[]} timezone="UTC" salary={null} usdLbpRate={null}><DetailSheet transaction={transaction} onClose={vi.fn()} onEdit={vi.fn()} onDuplicate={vi.fn()}/></AppDataProvider></NextIntlClientProvider>);
 expect(screen.getByText("Pocket")).toBeTruthy(); expect(screen.getByText("Bank")).toBeTruthy();
 expect(screen.queryByRole("button", { name: en.Detail.delete })).toBeNull();
 expect(screen.queryByRole("button", { name: en.Detail.duplicate })).toBeNull();
 expect(screen.queryByRole("button", { name: en.Detail.edit })).toBeNull();
 expect(screen.getByLabelText(en.Detail.historyNote)).toBeTruthy();
});

it("locks the entire expense when only a cashier-change receiver is tombstoned and saves only its note", async () => {
 const historical = wallets.map((wallet) => ({ ...wallet, deleted: wallet.id === "one" }));
 const expense: Transaction = { ...transaction, kind: "expense", balanceId: "two-USD", currency: "USD", amountMinor: 1250, toBalanceId: null, toAmountMinor: null, settlement: { tenderMinor: 2000, tenderCurrency: "USD", changes: [{ balanceId: "one-LBP", currency: "LBP", amountMinor: 500 }] } };
 vi.mocked(correctTransactionNote).mockResolvedValue({ ok: true, id: "tx", revision: 2 });
 const done = vi.fn();
 render(<NextIntlClientProvider locale="en" messages={en}><AppDataProvider walletContainers={historical} currencies={[...SEED_CURRENCY_DEFINITIONS]} categories={[]} timezone="UTC" salary={null} usdLbpRate={null}><DetailSheet transaction={expense} onClose={done} onEdit={vi.fn()} onDuplicate={vi.fn()}/></AppDataProvider></NextIntlClientProvider>);
 for (const name of [en.Detail.edit, en.Detail.delete, en.Detail.duplicate]) expect(screen.queryByRole("button", { name })).toBeNull();
 expect(screen.getByText("Pocket")).toBeTruthy();
 fireEvent.change(screen.getByLabelText(en.Detail.historyNote), { target: { value: "Corrected note" } });
 fireEvent.click(screen.getByRole("button", { name: en.Detail.saveHistoryNote }));
 await waitFor(() => expect(done).toHaveBeenCalledOnce());
 expect(correctTransactionNote).toHaveBeenCalledWith("tx", 1, { note: "Corrected note" });
});
