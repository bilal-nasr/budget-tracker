// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { BalancePicker } from "./balance-picker";
const balance=(id:string,walletId:string,currency:string)=>({id,walletId,currency,position:0,balanceMinor:0,openingBalanceMinor:0,detached:false});
const currencies=[{code:"USD",symbol:"$",decimalPlaces:2,disabled:false,firstUsed:false},{code:"TOK",symbol:"T",decimalPlaces:8,disabled:false,firstUsed:false}];
const wallets=[{id:"one",name:"Cash",kind:"cash" as const,position:0,deleted:false,needsAttention:false,defaultBalanceId:"one-tok",balances:[balance("one-usd","one","USD"),balance("one-tok","one","TOK")]},{id:"two",name:"Bank",kind:"bank" as const,position:1,deleted:false,needsAttention:false,defaultBalanceId:"two-usd",balances:[balance("two-usd","two","USD"),balance("two-tok","two","TOK")]}];
afterEach(cleanup);
it("offers every enabled exact currency in each wallet, choosing that wallet's default",()=>{
 const onChange=vi.fn();
 render(<BalancePicker label="From" wallets={wallets} currencies={currencies} value="one-usd" onChange={onChange}/>);
 fireEvent.change(screen.getByRole("combobox",{name:"From"}),{target:{value:"two"}});
 expect(onChange).toHaveBeenLastCalledWith("two-usd");
 fireEvent.change(screen.getByRole("combobox",{name:"From currency"}),{target:{value:"one-tok"}});
 expect(onChange).toHaveBeenLastCalledWith("one-tok");
});
it("excludes deleted wallets, detached balances and disabled history",()=>{
 render(<BalancePicker label="To" wallets={[{...wallets[0],balances:[...wallets[0].balances,balance("old","one","OLD"),{...balance("detached","one","DETACHED"),detached:true}]},{...wallets[1],deleted:true}]} currencies={[...currencies,{code:"DETACHED",symbol:"D",decimalPlaces:0,disabled:false,firstUsed:false},{code:"OLD",symbol:"O",decimalPlaces:0,disabled:true,firstUsed:true}]} value="one-usd" onChange={vi.fn()}/>);
 expect(screen.queryByRole("option",{name:"Bank"})).toBeNull();
 expect(screen.queryByRole("option",{name:"OLD"})).toBeNull();
 expect(screen.queryByRole("option",{name:"DETACHED"})).toBeNull();
});
