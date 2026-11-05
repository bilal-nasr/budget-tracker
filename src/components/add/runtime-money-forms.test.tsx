// @vitest-environment jsdom
import { afterEach, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import type { ReactNode } from "react";
import en from "@/messages/en.json";
import { AppDataProvider } from "@/components/providers/app-data";
import type { CurrencyDefinition } from "@/lib/currency";
import type { WalletContainer } from "@/features/wallets/schema";
const actions = vi.hoisted(() => ({ saveSalary: vi.fn(), createFixedExpense: vi.fn(), createInstallment: vi.fn(), createLoan: vi.fn(), createPendingPayment: vi.fn(), recordPendingReceipt: vi.fn(), saveBudgets: vi.fn(), payInstallment: vi.fn() }));
vi.mock("@/features/budgets/actions", () => ({saveBudgets: actions.saveBudgets}));
vi.mock("@/features/transactions/actions", () => ({deleteTransaction:vi.fn()}));
vi.mock("@/features/salary/actions", () => ({ ...actions, clearSalary: vi.fn() }));
vi.mock("@/features/fixed/actions", () => ({ ...actions, updateFixedExpense: vi.fn(), deleteFixedExpense: vi.fn() }));
vi.mock("@/features/installments/actions", () => ({ ...actions, updateInstallment: vi.fn(), deleteInstallment: vi.fn() }));
vi.mock("@/features/loans/actions", () => ({ ...actions, updateLoan: vi.fn() }));
vi.mock("@/features/pending-payments/actions", () => ({ ...actions, updatePendingPayment: vi.fn() }));
vi.mock("@/features/pending-payments/history-actions", () => ({ loadPendingReceipts: vi.fn() }));
vi.mock("@/features/installments/history-actions", () => ({ loadInstallmentHistory: vi.fn() }));
vi.mock("@/i18n/navigation", () => ({ Link: ({children,href}: {children:ReactNode;href:string}) => <a href={href}>{children}</a>, useRouter: () => ({ refresh: vi.fn() }) }));
vi.mock("@/components/ui/sheet-shell", () => ({ SheetShell: ({children, footer}: {children: ReactNode; footer?: ReactNode}) => <div>{children}{footer}</div> }));
vi.mock("@/components/categories/category-select", () => ({ CategorySelect: ({label, value, onChange}: {label: string; value: string; onChange: (value: string) => void}) => <select aria-label={label} value={value} onChange={(e) => onChange(e.target.value)}><option value=""/><option value="10000000-0000-4000-8000-000000000001">Fees</option></select> }));
import { BudgetsSheet } from "@/components/budget/budgets-sheet";
import { InstallmentPaySheet } from "@/components/installments/installment-pay-sheet";
import { SalarySheet } from "@/components/salary/salary-sheet";
import { FixedSheet } from "@/components/fixed/fixed-sheet";
import { InstallmentForm } from "@/components/installments/installment-sheet";
import { LoanSheet } from "@/components/loans/loan-sheet";
import { PendingPaymentsView } from "@/components/pending-payments/pending-payments-view";
import { ReceiptSheet } from "@/components/pending-payments/receipt-sheet";
import { PaymentSheet } from "@/components/pending-payments/payment-sheet";
const catalog: CurrencyDefinition[] = [
 {code:"USD",symbol:"$",decimalPlaces:2,disabled:false,firstUsed:false},
 {code:"TOKEN8",symbol:"T",decimalPlaces:8,disabled:false,firstUsed:false},
];
const wallets: WalletContainer[] = [1,2].map((n) => ({id:`20000000-0000-4000-8000-00000000000${n}`,name:`Wallet ${n}`,kind:"cash",position:n,deleted:false,needsAttention:false,defaultBalanceId:`30000000-0000-4000-8000-0000000000${n}2`,balances:catalog.map((c,i) => ({id:`30000000-0000-4000-8000-0000000000${n}${i+1}`,walletId:`20000000-0000-4000-8000-00000000000${n}`,currency:c.code,openingBalanceMinor:0,balanceMinor:900000000,position:i,detached:false}))}));
const category = {id:"10000000-0000-4000-8000-000000000001",kind:"expense" as const,parentId:null,archivedAt:null,nameEn:"Fees",nameAr:"Fees",tile:1 as const,color:"teal" as const,position:0};
const view = (child: ReactNode, definitions = catalog) => <NextIntlClientProvider locale="en" messages={en}><AppDataProvider walletContainers={wallets.map((wallet) => ({...wallet,defaultBalanceId:definitions.find((currency) => currency.code === "TOKEN8")?.disabled ? wallet.balances[0].id : wallet.defaultBalanceId}))} currencies={definitions} categories={[category]} timezone="Asia/Beirut" salary={null} usdLbpRate={null}>{child}</AppDataProvider></NextIntlClientProvider>;
afterEach(() => {cleanup();vi.clearAllMocks();});
const families = [
 {name:"salary",component:<SalarySheet open onClose={()=>{}}/>,label:en.Salary.amount},
 {name:"fixed",component:<FixedSheet state={{item:null}} onClose={()=>{}}/>,label:en.Fixed.amount},
 {name:"installments",component:<InstallmentForm item={null} onClose={()=>{}}/>,label:en.Installments.total},
 {name:"loans",component:<LoanSheet item={null} onClose={()=>{}}/>,label:en.Loans.principal},
 {name:"pending",component:<PaymentSheet item={null} onClose={()=>{}}/>,label:`${en.PendingPayments.total} (USD)`},
];
for (const family of families) it(`${family.name} permanently discards incompatible drafts on precision round trips`, () => {
 const root = render(view(family.component));
 const input = screen.getByLabelText(family.label) as HTMLInputElement;
 fireEvent.change(input,{target:{value:"1.23456789"}});
 root.rerender(view(family.component,catalog.map((c)=>({...c,decimalPlaces:c.decimalPlaces===8?3:3}))));
 expect(input.value).toBe("");
 root.rerender(view(family.component));
 expect(input.value).toBe("");
});
it("salary defaults to the first wallet TOKEN8 balance, offers both currencies in the other wallet and writes literal exact balance ID",async()=>{
 actions.saveSalary.mockResolvedValue({ok:true});render(view(<SalarySheet open onClose={()=>{}}/>));
 const pick=screen.getByLabelText(en.Add.walletCurrency) as HTMLSelectElement;
 expect(pick.value).toBe("30000000-0000-4000-8000-000000000012");
 fireEvent.change(screen.getByLabelText(en.Salary.wallet),{target:{value:wallets[1].id}});
 expect(pick.options.length).toBe(2);expect(pick.value).toBe("30000000-0000-4000-8000-000000000022");
 fireEvent.change(screen.getByLabelText(en.Salary.amount),{target:{value:"1.23456789"}});
 fireEvent.click(screen.getByRole("button",{name:en.Salary.save}));
 await waitFor(()=>expect(actions.saveSalary).toHaveBeenCalledWith({expectedUnits:{TOKEN8:8},amountMinor:123456789,balanceId:"30000000-0000-4000-8000-000000000022"}));
});

for(const family of [
 {name:"fixed",child:<FixedSheet state={{item:null}} onClose={()=>{}}/>,nameLabel:en.Fixed.name,amountLabel:en.Fixed.amount,categoryLabel:en.Fixed.category,save:en.Fixed.save,action:actions.createFixedExpense,amountField:"amountMinor"},
 {name:"installment",child:<InstallmentForm item={null} onClose={()=>{}}/>,nameLabel:en.Installments.name,amountLabel:en.Installments.total,categoryLabel:en.Installments.category,save:en.Installments.save,action:actions.createInstallment,amountField:"totalMinor"},
 {name:"loan",child:<LoanSheet item={null} onClose={()=>{}}/>,nameLabel:en.Loans.name,amountLabel:en.Loans.principal,categoryLabel:en.Loans.category,save:en.Loans.save,action:actions.createLoan,amountField:"principalMinor"},
]) it(`${family.name} saves custom8 minor units against the selected exact balance`,async()=>{
 family.action.mockResolvedValue({ok:true,id:"40000000-0000-4000-8000-000000000001"});render(view(family.child));
 expect((screen.getByLabelText(en.Add.walletCurrency) as HTMLSelectElement).value).toBe("30000000-0000-4000-8000-000000000012");
 fireEvent.change(screen.getByLabelText(family.nameLabel),{target:{value:"Custom item"}});
 fireEvent.change(screen.getByLabelText(family.amountLabel),{target:{value:"1.23456789"}});
 fireEvent.change(screen.getByLabelText(family.categoryLabel),{target:{value:category.id}});
 if(family.name==="loan")fireEvent.click(screen.getByRole("radio",{name:en.Loans.new}));
 fireEvent.click(screen.getByRole("button",{name:family.save}));
 await waitFor(()=>expect(family.action).toHaveBeenCalledOnce());
 expect(family.action.mock.calls[0][0]).toMatchObject({expectedUnits:{TOKEN8:8},balanceId:"30000000-0000-4000-8000-000000000012",[family.amountField]:123456789});
 expect(family.action.mock.calls[0][0]).not.toHaveProperty("walletId");
});
it("pending job accepts custom8 catalog currency without assigning a wallet",async()=>{
 actions.createPendingPayment.mockResolvedValue({ok:true});render(view(<PaymentSheet item={null} onClose={()=>{}}/>));
 fireEvent.change(screen.getByLabelText(en.PendingPayments.client),{target:{value:"Client"}});
 fireEvent.change(screen.getByLabelText(en.PendingPayments.project),{target:{value:"Project"}});
 fireEvent.click(screen.getByRole("radio",{name:"TOKEN8"}));
 fireEvent.change(screen.getByLabelText(`${en.PendingPayments.total} (TOKEN8)`),{target:{value:"1.23456789"}});
 fireEvent.click(screen.getByRole("button",{name:en.PendingPayments.save}));
 await waitFor(()=>expect(actions.createPendingPayment).toHaveBeenCalledOnce());
 expect(actions.createPendingPayment.mock.calls[0][0]).toMatchObject({expectedUnits:{TOKEN8:8},currency:"TOKEN8",totalMinor:123456789});
});
for(const family of families) it(`${family.name} preserves typed amounts on symbol-only edits`,()=>{
 const root=render(view(family.component));const input=screen.getByLabelText(family.label) as HTMLInputElement;
 fireEvent.change(input,{target:{value:"1.23456789"}});
 root.rerender(view(family.component,catalog.map((currency)=>({...currency,symbol:"new"}))));
 expect(input.value).toBe("1.23456789");
});

for(const family of families) it(`${family.name} clears a draft permanently through disable and re-enable`,()=>{
 const root=render(view(family.component));const input=screen.getByLabelText(family.label) as HTMLInputElement;
 fireEvent.change(input,{target:{value:"1.23456789"}});
 const target=family.name==="pending"?"USD":"TOKEN8";
 const disabled=catalog.map((currency)=>({...currency,disabled:currency.code===target}));
 root.rerender(view(family.component,disabled));expect(input.value).toBe("");
 root.rerender(view(family.component));expect(input.value).toBe("");
});
it("disabled pending history keeps exact eight-decimal text and rejects saving",()=>{
 const item={id:"40000000-0000-4000-8000-000000000001",client:"Client",project:"Project",currency:"TOKEN8",totalMinor:123456789,receivedMinor:0,remainingMinor:123456789,dueOn:null,revision:1,hasReceiptHistory:false};
 render(view(<PaymentSheet item={item} onClose={()=>{}}/>,catalog.map((currency)=>({...currency,disabled:currency.code==="TOKEN8"}))));
 expect((screen.getByLabelText(`${en.PendingPayments.total} (TOKEN8)`) as HTMLInputElement).value).toBe("1.23456789");
 expect(screen.getByRole("button",{name:en.PendingPayments.save}).matches(":disabled")).toBe(true);
});

it("pending history includes disabled custom-currency outstanding totals with exact eight-place formatting",()=>{
 const item={id:"40000000-0000-4000-8000-000000000001",client:"Client",project:"Project",currency:"TOKEN8",totalMinor:123456789,receivedMinor:0,remainingMinor:123456789,dueOn:null,revision:1,hasReceiptHistory:false};
 render(view(<PendingPaymentsView payments={[item]}/>,catalog.map((currency)=>({...currency,disabled:currency.code==="TOKEN8"}))));
 expect(within(screen.getByRole("region",{name:en.PendingPayments.outstanding})).getByText("T 1.23456789")).toBeTruthy();
});

it("budget editor preserves disabled custom history and writes enabled custom8 limits exactly",async()=>{
 const data={month:"2026-11",currency:"TOKEN8",rows:[{categoryId:category.id,limitMinor:123456789,spentMinor:0,leftMinor:123456789,progress:0}],totalLimitMinor:123456789,totalSpentMinor:0};
 const child=<BudgetsSheet state={{data,salaryAfterMinor:null}} onClose={()=>{}}/>;
 const root=render(view(child));expect((screen.getByLabelText(en.Budgets.amountFor.replace("{name}","Fees")) as HTMLInputElement).value).toBe("1.23456789");
 actions.saveBudgets.mockResolvedValue({ok:true});
 fireEvent.change(screen.getByLabelText(en.Budgets.amountFor.replace("{name}","Fees")),{target:{value:"2.00000001"}});
 fireEvent.click(screen.getByRole("button",{name:en.Budgets.save}));await waitFor(()=>expect(actions.saveBudgets).toHaveBeenCalledWith({expectedUnits:{TOKEN8:8},month:"2026-11",currency:"TOKEN8",limits:[{categoryId:category.id,limitMinor:200000001}]}));
 root.unmount();render(view(child,catalog.map((currency)=>({...currency,disabled:currency.code==="TOKEN8"}))));
 expect(screen.getByText("T 1.23456789")).toBeTruthy();expect(screen.getByRole("button",{name:en.Budgets.save}).matches(":disabled")).toBe(true);
});
it("installment payment prefers its saved exact balance over the first wallet and writes custom8 cycle amount",async()=>{
 const item={id:"40000000-0000-4000-8000-000000000001",name:"Plan",currency:"TOKEN8",balanceId:"30000000-0000-4000-8000-000000000022",categoryId:category.id,totalMinor:246913578,paidBeforeMinor:0,monthlyMinor:123456789,dueDay:null,paidMinor:0,remainingMinor:246913578,salaryCycleId:null,paidThisCycleMinor:0,cyclePaymentCount:0,cycleLatestPaymentId:null,cycleStatus:"unpaid" as const,payments:[]};
 actions.payInstallment.mockResolvedValue({ok:true,id:"40000000-0000-4000-8000-000000000002",revision:1});
 render(view(<InstallmentPaySheet state={{item,intent:"normal",requestId:"40000000-0000-4000-8000-000000000002"}} onClose={()=>{}}/>));
 expect((screen.getByLabelText(en.Installments.paidFrom) as HTMLSelectElement).value).toBe(wallets[1].id);
 expect((screen.getByLabelText(en.Installments.amount) as HTMLInputElement).value).toBe("1.23456789");
 fireEvent.click(screen.getByRole("button",{name:en.Installments.record}));await waitFor(()=>expect(actions.payInstallment).toHaveBeenCalledOnce());
 expect(actions.payInstallment.mock.calls[0][0]).toMatchObject({expectedUnits:{TOKEN8:8},balanceId:"30000000-0000-4000-8000-000000000022",amountMinor:123456789,salaryCycleId:null,overrideOfTransactionId:null});
});

it("hydrates the saved salary exact balance in another wallet", () => {
 render(<NextIntlClientProvider locale="en" messages={en}><AppDataProvider walletContainers={wallets} currencies={catalog} categories={[category]} timezone="Asia/Beirut" salary={{balanceId:wallets[1].balances[1].id,amountMinor:123456789}} usdLbpRate={null}><SalarySheet open onClose={()=>{}}/></AppDataProvider></NextIntlClientProvider>);
 expect((screen.getByLabelText(en.Salary.wallet) as HTMLSelectElement).value).toBe(wallets[1].id);
 expect((screen.getByLabelText(en.Add.walletCurrency) as HTMLSelectElement).value).toBe(wallets[1].balances[1].id);
 expect((screen.getByLabelText(en.Salary.amount) as HTMLInputElement).value).toBe("1.23456789");
});

it("pending receipt carries the same exact custom unit used for its typed amount",async()=>{
 actions.recordPendingReceipt.mockResolvedValue({ok:true,id:"40000000-0000-4000-8000-000000000099"});
 const item={id:"40000000-0000-4000-8000-000000000001",client:"Client",project:"Project",currency:"TOKEN8",totalMinor:200000001,receivedMinor:0,remainingMinor:200000001,dueOn:null,revision:1,hasReceiptHistory:true};
 render(<NextIntlClientProvider locale="en" messages={en}><AppDataProvider walletContainers={wallets} currencies={catalog} categories={[{...category,kind:"income"}]} timezone="UTC" salary={null} usdLbpRate={null}><ReceiptSheet item={item} onClose={()=>{}}/></AppDataProvider></NextIntlClientProvider>);
 fireEvent.change(screen.getByLabelText(en.PendingPayments.receiptAmount),{target:{value:"1.00000001"}});fireEvent.click(screen.getByRole("button",{name:en.PendingPayments.saveReceipt}));
 await waitFor(()=>expect(actions.recordPendingReceipt).toHaveBeenCalledOnce());expect(actions.recordPendingReceipt.mock.calls[0][0]).toMatchObject({expectedUnits:{TOKEN8:8},balanceId:wallets[0].balances[1].id,amountMinor:100000001});
});
