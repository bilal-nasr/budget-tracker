import { beforeEach, expect, it, vi } from "vitest";
const mocks=vi.hoisted(()=>({client:vi.fn(),insert:vi.fn(),update:vi.fn(),upsert:vi.fn(),rpc:vi.fn(),error:null as null|{message:string},eq:vi.fn()}));
vi.mock("server-only",()=>({}));vi.mock("next/cache",()=>({revalidatePath:vi.fn()}));
vi.mock("@/lib/supabase/action",()=>({actionClient:mocks.client}));
vi.mock("@/features/profile/queries",()=>({getProfile:async()=>({timezone:"Asia/Beirut"})}));
import {saveSalary} from "./salary/actions";
import {createFixedExpense} from "./fixed/actions";
import {createInstallment,payInstallment} from "./installments/actions";
import {createLoan,recordLoanPayment} from "./loans/actions";
import {createPendingPayment,recordPendingReceipt} from "./pending-payments/actions";
import {saveBudgets} from "./budgets/actions";
const balance="b0000000-0000-4000-8000-000000000001",request="b0000000-0000-4000-8000-000000000002",category="b0000000-0000-4000-8000-000000000003";
beforeEach(()=>{vi.clearAllMocks();mocks.error=null;const result=()=>({data:[{id:request,revision:1}],error:mocks.error});
 mocks.insert.mockImplementation(result);mocks.upsert.mockImplementation(result);mocks.eq.mockImplementation(result);mocks.update.mockReturnValue({eq:mocks.eq});mocks.rpc.mockImplementation(result);
 mocks.client.mockResolvedValue({userId:request,supabase:{from:()=>({insert:mocks.insert,update:mocks.update,upsert:mocks.upsert}),rpc:mocks.rpc}});
});
const cases=[
 {name:"salary",run:()=>saveSalary({expectedUnits:{TOKEN8:8},amountMinor:123456789,balanceId:balance}),boundary:()=>mocks.update.mock.calls[0][0],expected:{salary_amount_minor:123456789,salary_balance_id:balance}},
 {name:"fixed",run:()=>createFixedExpense({expectedUnits:{TOKEN8:8},name:"Fixed",amountMinor:123456789,balanceId:balance,categoryId:category,dueDay:null}),boundary:()=>mocks.insert.mock.calls[0][0],expected:{amount_minor:123456789,balance_id:balance}},
 {name:"installment",run:()=>createInstallment({expectedUnits:{TOKEN8:8},name:"Plan",totalMinor:123456789,paidBeforeMinor:0,balanceId:balance,categoryId:category,monthlyMinor:1,dueDay:null}),boundary:()=>mocks.insert.mock.calls[0][0],expected:{total_minor:123456789,balance_id:balance}},
 {name:"cycle payment",run:()=>payInstallment({expectedUnits:{TOKEN8:8},requestId:request,installmentId:category,balanceId:balance,amountMinor:123456789,occurredOn:"2026-01-01",salaryCycleId:null,overrideOfTransactionId:null}),boundary:()=>mocks.rpc.mock.calls[0][1],expected:{p_balance_id:balance,p_amount_minor:123456789}},
 {name:"loan",run:()=>createLoan({expectedUnits:{TOKEN8:8},requestId:request,name:"Loan",direction:"borrowed",principalMinor:123456789,feeBps:0,balanceId:balance,feeCategoryId:category,openedOn:"2026-01-01",creationMode:"new",principalPaidBeforeMinor:0,feePaidBeforeMinor:0}),boundary:()=>mocks.rpc.mock.calls[0][1].p_input,expected:{balanceId:balance,principalMinor:123456789}},
 {name:"loan payment",run:()=>recordLoanPayment({expectedUnits:{TOKEN8:8},requestId:request,loanId:category,balanceId:balance,amountMinor:123456789,occurredOn:"2026-01-01"}),boundary:()=>mocks.rpc.mock.calls[0][1].p_input,expected:{balanceId:balance,amountMinor:123456789}},
 {name:"pending job",run:()=>createPendingPayment({expectedUnits:{TOKEN8:8},requestId:request,client:"Client",project:"Project",currency:"TOKEN8",totalMinor:123456789,dueOn:null}),boundary:()=>mocks.rpc.mock.calls[0][1].p_input,expected:{currency:"TOKEN8",totalMinor:123456789}},
 {name:"pending receipt",run:()=>recordPendingReceipt({expectedUnits:{TOKEN8:8},requestId:request,paymentId:category,balanceId:balance,categoryId:category,amountMinor:123456789,occurredOn:"2026-01-01"}),boundary:()=>mocks.rpc.mock.calls[0][1].p_input,expected:{balanceId:balance,amountMinor:123456789}},
 {name:"budget",run:()=>saveBudgets({expectedUnits:{TOKEN8:8},month:"2026-11",currency:"TOKEN8",limits:[{categoryId:category,limitMinor:123456789}]}),boundary:()=>mocks.upsert.mock.calls[0][0][0],expected:{currency:"TOKEN8",limit_minor:123456789}},
];
for(const family of cases){
 it(`${family.name} sends exact balance/currency and safe minor units to its atomic database boundary`,async()=>{expect((await family.run()).ok).toBe(true);expect(family.boundary()).toMatchObject(family.expected);expect(mocks.client).toHaveBeenCalledWith({TOKEN8:8});expect(family.boundary()).not.toHaveProperty("expectedUnits");expect(family.boundary()).not.toHaveProperty("walletId");expect(family.boundary()).not.toHaveProperty("wallet_id");});
 it(`${family.name} cannot report success when the database rejects a disabled denomination`,async()=>{mocks.error={message:"currency.disabled"};expect((await family.run()).ok).toBe(false);expect(family.boundary()).toMatchObject(family.expected);});
}
