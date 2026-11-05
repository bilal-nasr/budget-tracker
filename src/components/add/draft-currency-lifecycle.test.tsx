// @vitest-environment jsdom
import { afterEach, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import type { ReactNode } from "react";
import en from "@/messages/en.json";
import { AppDataProvider } from "@/components/providers/app-data";
import type { CurrencyDefinition } from "@/lib/currency";
import type { WalletContainer } from "@/features/wallets/schema";
vi.mock("@/features/pending-payments/actions",()=>({createPendingPayment:vi.fn(),updatePendingPayment:vi.fn()}));
vi.mock("@/features/transactions/actions",()=>({createTransaction:vi.fn(),createTransfer:vi.fn(),updateTransaction:vi.fn(),deleteTransaction:vi.fn()}));
vi.mock("@/i18n/navigation",()=>({useRouter:()=>({refresh:vi.fn(),push:vi.fn()})}));
vi.mock("@/components/ui/sheet-shell",()=>({SheetShell:({children,footer}:{children:ReactNode;footer?:ReactNode})=><div>{children}{footer}</div>}));
import { PaymentSheet } from "@/components/pending-payments/payment-sheet";
import { TransactionSheet } from "@/components/add/transaction-sheet";
vi.mock("@/features/budgets/actions",()=>({saveBudgets:vi.fn()}));
import { BudgetsSheet } from "@/components/budget/budgets-sheet";
import { buildWalletDeletionPlan, resolveWalletSettlements } from "@/features/wallets/deletion";
const catalog:CurrencyDefinition[]=[{code:"USD",symbol:"$",decimalPlaces:2,disabled:false,firstUsed:false},{code:"TOKEN8",symbol:"T",decimalPlaces:8,disabled:false,firstUsed:false}];
const base:WalletContainer[]=[1,2].map(n=>({id:`20000000-0000-4000-8000-00000000000${n}`,name:`Wallet ${n}`,kind:"cash",position:n-1,deleted:false,needsAttention:false,defaultBalanceId:`30000000-0000-4000-8000-0000000000${n}1`,balances:catalog.map((c,i)=>({id:`30000000-0000-4000-8000-0000000000${n}${i+1}`,walletId:`20000000-0000-4000-8000-00000000000${n}`,currency:c.code,openingBalanceMinor:0,balanceMinor:0,position:i,detached:false}))}));
const view=(child:ReactNode,definitions=catalog)=><NextIntlClientProvider locale="en" messages={en}><AppDataProvider walletContainers={base.map(w=>({...w,balances:definitions.map((c,i)=>({...w.balances[i],currency:c.code}))}))} currencies={definitions} categories={[{id:"10000000-0000-4000-8000-000000000001",kind:"expense",parentId:null,archivedAt:null,nameEn:"Fees",nameAr:"Fees",tile:1,color:"teal",position:0}]} timezone="Asia/Beirut" salary={null} usdLbpRate={null}>{child}</AppDataProvider></NextIntlClientProvider>;
afterEach(()=>{cleanup();vi.clearAllMocks();});
it("keeps a pending draft recoverable and clears amounts after currency removal",()=>{
 const child=<PaymentSheet item={null} onClose={()=>{}}/>;const root=render(view(child));
 fireEvent.click(screen.getByRole("radio",{name:"TOKEN8"}));
 fireEvent.change(screen.getByLabelText(`${en.PendingPayments.total} (TOKEN8)`),{target:{value:"1.00000001"}});
 expect(()=>root.rerender(view(child,[catalog[0]]))).not.toThrow();
 expect(screen.getByRole("button", {name: en.PendingPayments.save}).hasAttribute("disabled")).toBe(true);
});
it.each(["removal","rename"])("keeps a cash-purchase draft recoverable after currency %s",(event)=>{
 const child=<TransactionSheet state={{mode:"add",draftId:"40000000-0000-4000-8000-000000000001"}} onClose={()=>{}}/>;
 const root=render(view(child));fireEvent.click(screen.getByRole("radio",{name:en.Cashier.cashPurchase}));
 fireEvent.change(screen.getByLabelText(en.Cashier.purchaseCurrency),{target:{value:"TOKEN8"}});
 fireEvent.click(screen.getByRole("button",{name:"1"}));
 expect(()=>root.rerender(view(child,event==="removal"?[catalog[0]]:[catalog[0],{...catalog[1],code:"RENAMED"}]))).not.toThrow();
 expect(screen.getByRole("button",{name:en.Add.save}).matches(":disabled")).toBe(true);
 fireEvent.change(screen.getByLabelText(en.Cashier.purchaseCurrency),{target:{value:"USD"}});
 expect(screen.getByLabelText(en.Add.amount).textContent).toBe("$0");
});
it("binds deletion confirmation to the exact signed balance plan",()=>{
 const wallets=(amount:number)=>base.map((w,i)=>({...w,balances:w.balances.map((b,j)=>({...b,balanceMinor:i===0&&j===0?amount:0}))}));
 const before=buildWalletDeletionPlan(base[0].id,wallets(10000),catalog,[]);
 const after=buildWalletDeletionPlan(base[0].id,wallets(-5000),catalog,[]);
 expect(before.lines[0].direction).toBe("out");expect(after.lines[0].direction).toBe("in");
 const choices={[base[0].balances[0].id]:base[1].id};
 expect(resolveWalletSettlements(before,choices)).not.toEqual(resolveWalletSettlements(after,choices));
});

it("clears a renamed pending unit and allows explicit selection of its replacement",()=>{
 const child=<PaymentSheet item={null} onClose={()=>{}}/>;const root=render(view(child));
 fireEvent.click(screen.getByRole("radio",{name:"TOKEN8"}));
 fireEvent.change(screen.getByLabelText(`${en.PendingPayments.total} (TOKEN8)`),{target:{value:"1.00000001"}});
 const renamed=[catalog[0],{...catalog[1],code:"RENAMED"}];
 root.rerender(view(child,renamed));expect(screen.getByRole("status").textContent).toContain(en.Currencies.draftUnavailable);
 expect((screen.getByLabelText(`${en.PendingPayments.total} (TOKEN8)`) as HTMLInputElement).value).toBe("");
 fireEvent.click(screen.getByRole("radio",{name:"RENAMED"}));
 expect((screen.getByLabelText(`${en.PendingPayments.total} (RENAMED)`) as HTMLInputElement).value).toBe("");
});
it.each(["removal","rename"])("clears an unsaved budget on unit %s and does not recover old text",(event)=>{
 const child=<BudgetsSheet state={{data:{month:"2026-11",currency:"TOKEN8",rows:[],totalLimitMinor:0,totalSpentMinor:0},salaryAfterMinor:null}} onClose={()=>{}}/>;
 const root=render(view(child));const input=screen.getByLabelText(en.Budgets.amountFor.replace("{name}","Fees")) as HTMLInputElement;
 fireEvent.change(input,{target:{value:"1.00000001"}});root.rerender(view(child,event==="removal"?[catalog[0]]:[catalog[0],{...catalog[1],code:"RENAMED"}]));
 expect(input.value).toBe("");expect(screen.getByRole("button",{name:en.Budgets.save}).matches(":disabled")).toBe(true);
 root.rerender(view(child));expect(input.value).toBe("");
});
it("preserves unrelated cashier returns when one selected currency is removed",()=>{
 const child=<TransactionSheet state={{mode:"add",draftId:"40000000-0000-4000-8000-000000000001"}} onClose={()=>{}}/>;const root=render(view(child));
 fireEvent.click(screen.getByRole("radio",{name:en.Cashier.cashPurchase}));
 fireEvent.change(screen.getByLabelText(en.Cashier.tender),{target:{value:"5"}});
 fireEvent.click(screen.getByRole("button",{name:en.Cashier.addChange}));
 fireEvent.change(screen.getByLabelText(en.Cashier.change),{target:{value:"1.25"}});
 fireEvent.click(screen.getByRole("button",{name:en.Cashier.addChange}));
 fireEvent.change(screen.getAllByRole("combobox",{name:en.Cashier.currency})[1],{target:{value:base[0].balances[1].id}});
 fireEvent.change(screen.getAllByLabelText(en.Cashier.change)[1],{target:{value:"0.00000001"}});
 root.rerender(view(child,[catalog[0]]));
 expect(screen.getAllByLabelText(en.Cashier.change).map(e=>(e as HTMLInputElement).value)).toEqual(["1.25",""]);
 expect((screen.getByLabelText(en.Cashier.tender) as HTMLInputElement).value).toBe("5");
 expect(screen.getByRole("button",{name:en.Add.save}).matches(":disabled")).toBe(true);
});
it("keeps corrupt historical currency references strict",()=>{
 const item={id:"40000000-0000-4000-8000-000000000001",client:"Client",project:"Project",currency:"MISSING",totalMinor:123,receivedMinor:0,remainingMinor:123,dueOn:null,revision:1,hasReceiptHistory:false};
 expect(()=>render(view(<PaymentSheet item={item} onClose={()=>{}}/>))).toThrow("App currency data unavailable");
});

it.each(["removal","rename"])("clears a cashier payer on currency %s while keeping the form recoverable",(event)=>{
 const child=<TransactionSheet state={{mode:"add",draftId:"40000000-0000-4000-8000-000000000001"}} onClose={()=>{}}/>;const root=render(view(child));
 fireEvent.click(screen.getByRole("radio",{name:en.Cashier.cashPurchase}));
 fireEvent.change(screen.getByRole("combobox",{name:en.Add.fromCurrency}),{target:{value:base[0].balances[1].id}});
 fireEvent.change(screen.getByLabelText(en.Cashier.tender),{target:{value:"1.00000001"}});
 expect(()=>root.rerender(view(child,event==="removal"?[catalog[0]]:[catalog[0],{...catalog[1],code:"RENAMED"}]))).not.toThrow();
 expect((screen.getByLabelText(en.Cashier.tender) as HTMLInputElement).value).toBe("");
 expect(screen.getByRole("button",{name:en.Add.save}).matches(":disabled")).toBe(true);
});
