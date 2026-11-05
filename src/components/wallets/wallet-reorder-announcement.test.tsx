// @vitest-environment jsdom
import { afterEach, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { AppDataProvider } from "@/components/providers/app-data";
import type { WalletContainer } from "@/features/wallets/schema";
import en from "@/messages/en.json";
vi.mock("@dnd-kit/core",()=>({closestCenter:()=>null,PointerSensor:class{},useSensor:()=>null,useSensors:()=>[],DndContext:({children,onDragStart}:{children:React.ReactNode;onDragStart:(event:unknown)=>void})=>{return <>{children}<button onClick={()=>onDragStart({active:{id:"bank"}})}>Start pointer</button></>;}}));
vi.mock("@dnd-kit/sortable",()=>({arrayMove:()=>[],verticalListSortingStrategy:()=>null,SortableContext:({children}:{children:React.ReactNode})=>children,useSortable:()=>({attributes:{},listeners:{},setNodeRef:()=>{},setActivatorNodeRef:()=>{},transform:null,transition:undefined,isDragging:false})}));
vi.mock("@/features/wallets/actions",()=>({reorderWallets:vi.fn()}));
import { WalletReorder } from "./wallet-reorder";
afterEach(cleanup);
const wallets:WalletContainer[]=["pocket","bank"].map((id,position)=>({id,name:id,kind:"cash",position,deleted:false,needsAttention:false,defaultBalanceId:id+"-usd",balances:[{id:id+"-usd",walletId:id,currency:"USD",openingBalanceMinor:0,balanceMinor:0,position:0,detached:false}]}));
const view=(input:WalletContainer[])=><NextIntlClientProvider locale="en" messages={en}><AppDataProvider walletContainers={input} currencies={[{code:"USD",symbol:"$",decimalPlaces:2,disabled:false,firstUsed:false}]} categories={[]} timezone="UTC" salary={null} usdLbpRate={null}><WalletReorder>{wallet=><span>{wallet.name}</span>}</WalletReorder></AppDataProvider></NextIntlClientProvider>;
it("a refreshed keyboard cancellation does not mask the next pointer announcement",()=>{
 const root=render(view(wallets));fireEvent.keyDown(screen.getByRole("button",{name:"Reorder pocket"}),{key:" "});
 root.rerender(view(wallets.map(wallet=>({...wallet}))));
 expect(screen.getByRole("status").textContent).toContain("Cancelled");
 fireEvent.click(screen.getByRole("button",{name:"Start pointer"}));
 expect(screen.getByRole("status").textContent).toBe("Picked up bank, position 2 of 2.");
});
