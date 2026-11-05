// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import type { ReactNode } from "react";
import messages from "@/messages/en.json";
const mocks = vi.hoisted(() => ({ receive: vi.fn(), remove: vi.fn(), refresh: vi.fn(), push: vi.fn(), appData: vi.fn(), openSalary: vi.fn(), toast: Object.assign(vi.fn(),{error:vi.fn()}) }));
vi.mock("@/features/salary/actions",()=>({receiveSalary:mocks.receive}));
vi.mock("@/features/transactions/actions",()=>({deleteTransaction:mocks.remove}));
vi.mock("sonner",()=>({toast:mocks.toast}));
vi.mock("@/i18n/navigation",()=>({useRouter:()=>({refresh:mocks.refresh,push:mocks.push})}));
vi.mock("@/components/shell/composer",()=>({useComposer:()=>({openSalary:mocks.openSalary})}));
vi.mock("@/components/providers/app-data",async (importOriginal) => ({ ...await importOriginal<typeof import("@/components/providers/app-data")>(), useAppData:()=>mocks.appData()}));
vi.mock("@/components/ui/confirm-sheet",()=>({ConfirmSheet:({open,onConfirm,children}:{open:boolean;onConfirm:()=>void;children:ReactNode})=>open?<div>{children}<button type="button" onClick={onConfirm}>Confirm salary</button></div>:null}));
import { SalaryCard } from "./salary-card";
const id="a1000000-0000-4000-8000-000000000001";
const status={receiptId:id,lastReceivedOn:"2026-11-01",receivedThisMonth:true};
const view=(receiptId=id)=><NextIntlClientProvider locale="en" messages={messages}><SalaryCard status={{...status,receiptId}}/></NextIntlClientProvider>;
const bank = {id:"bank",name:"Bank",currency:"USD",archived:false};
beforeEach(()=>{vi.clearAllMocks();mocks.receive.mockResolvedValue({ok:false,error:"notConfigured"});
  mocks.appData.mockReturnValue({salary:{amountMinor:180000,walletId:"bank"},timezone:"Asia/Beirut",legacyWalletById:()=>bank});
});
afterEach(cleanup);
it("retains the original receipt request after an unknown result even when new server props arrive",async()=>{
  mocks.receive.mockResolvedValueOnce({ok:false,error:"failed"});
  const rendered=render(view());
  fireEvent.click(screen.getByRole("button",{name:"Got salary"}));
  fireEvent.click(await screen.findByRole("button",{name:"Confirm salary"}));
  await waitFor(()=>expect(screen.getByRole("button",{name:"Retry same salary"}).matches(":disabled")).toBe(false));
  const first=mocks.receive.mock.calls[0][0];
  expect(first.expectedCycleId).toBe(id);
  rendered.rerender(view("a2000000-0000-4000-8000-000000000001"));
  fireEvent.click(screen.getByRole("button",{name:"Retry same salary"}));
  await waitFor(()=>expect(mocks.receive).toHaveBeenCalledTimes(2));
  expect(mocks.receive.mock.calls[1][0]).toEqual(first);
});
it("returns stale receipt confirmation to review without automatically recording another salary",async()=>{
  mocks.receive.mockResolvedValue({ok:false,error:"cycleChanged"});
  render(view());
  fireEvent.click(screen.getByRole("button",{name:"Got salary"}));
  fireEvent.click(await screen.findByRole("button",{name:"Confirm salary"}));
  await waitFor(()=>expect(mocks.refresh).toHaveBeenCalledOnce());
  expect(mocks.receive).toHaveBeenCalledOnce();
  expect(mocks.toast.error).toHaveBeenCalledWith(messages.Salary.cycleChanged);
});

it.each(["salary cleared","wallet archived","wallet removed"])("keeps the uncertain receipt retry after provider refresh: %s",async(change)=>{
  mocks.receive.mockResolvedValueOnce({ok:false,error:"failed"});
  const rendered=render(view());
  fireEvent.click(screen.getByRole("button",{name:"Got salary"}));
  fireEvent.click(await screen.findByRole("button",{name:"Confirm salary"}));
  await waitFor(()=>expect(screen.getByRole("button",{name:"Retry same salary"}).matches(":disabled")).toBe(false));
  const first=mocks.receive.mock.calls[0][0];
  mocks.appData.mockReturnValue({salary:change==="salary cleared"?null:{amountMinor:180000,walletId:"bank"},
    timezone:"Asia/Beirut",legacyWalletById:()=>change==="wallet removed"?undefined:{...bank,archived:change==="wallet archived"}});
  rendered.rerender(view("a2000000-0000-4000-8000-000000000001"));
  expect(screen.queryByRole("button",{name:"Set salary"})).toBeNull();
  expect(screen.queryByRole("button",{name:/^Edit$/})).toBeNull();
  fireEvent.click(screen.getByRole("button",{name:"Retry same salary"}));
  // Reconciliation of an already-confirmed receipt must not depend on a new
  // salary configuration or the current active-wallet eligibility rules.
  await waitFor(()=>expect(mocks.receive).toHaveBeenCalledTimes(2));
  expect(mocks.receive.mock.calls[1][0]).toEqual(first);
  expect(mocks.openSalary).not.toHaveBeenCalled();
});

it("keeps salary setup locked when provider configuration disappears during a pending receipt",async()=>{
  let finish: (value: {ok:false;error:"failed"}) => void = () => {};
  mocks.receive.mockImplementationOnce(()=>new Promise((resolve)=>{finish=resolve;}));
  const rendered=render(view());
  fireEvent.click(screen.getByRole("button",{name:"Got salary"}));
  fireEvent.click(await screen.findByRole("button",{name:"Confirm salary"}));
  await waitFor(()=>expect(mocks.receive).toHaveBeenCalledOnce());
  const original=mocks.receive.mock.calls[0][0];
  mocks.appData.mockReturnValue({salary:null,timezone:"Asia/Beirut",legacyWalletById:()=>undefined});
  rendered.rerender(view());
  expect(screen.queryByRole("button",{name:"Set salary"})).toBeNull();
  expect(screen.getByRole("button",{name:"Retry same salary"}).matches(":disabled")).toBe(true);
  finish({ok:false,error:"failed"});
  await waitFor(()=>expect(screen.getByRole("button",{name:"Retry same salary"}).matches(":disabled")).toBe(false));
  fireEvent.click(screen.getByRole("button",{name:"Retry same salary"}));
  await waitFor(()=>expect(mocks.receive).toHaveBeenCalledTimes(2));
  expect(mocks.receive.mock.calls[1][0]).toEqual(original);
});
